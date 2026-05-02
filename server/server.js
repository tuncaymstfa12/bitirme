import http from 'node:http';
import { scrypt as scryptCallback, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.AUTH_API_PORT || 3001);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // --- Health ---
    if (req.method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { success: true, status: 'ok' });
    }

    // --- Auth Routes (no token required) ---
    if (req.method === 'POST' && path === '/api/auth/register') {
      const body = await readJsonBody(req);
      return await handleRegister(body, res);
    }
    if (req.method === 'POST' && path === '/api/auth/login') {
      const body = await readJsonBody(req);
      return await handleLogin(body, res);
    }

    // --- Protected Routes (token required) ---
    const session = await getSession(req);

    if (req.method === 'GET' && path === '/api/auth/me') {
      if (!session) return sendJson(res, 401, { error: 'Unauthorized' });
      return await handleMe(session, res);
    }
    if (req.method === 'POST' && path === '/api/auth/logout') {
      return await handleLogout(req, res);
    }
    if (req.method === 'POST' && path === '/api/auth/change-password') {
      const sess = await getSession(req);
      if (!sess) return sendJson(res, 401, { error: 'Unauthorized' });
      const b = await readJsonBody(req);
      return await handleChangePassword(sess, b, req, res);
    }
    if (!session) return sendJson(res, 401, { error: 'Unauthorized' });

    const studentId = session.student_id;

    // Sync all data
    if (req.method === 'GET' && path === '/api/sync') {
      return await handleSync(studentId, res);
    }

    // Exams
    if (req.method === 'GET' && path === '/api/exams') return await getExams(studentId, res);
    if (req.method === 'POST' && path === '/api/exams') return await createExam(studentId, req, res);

    const examMatch = path.match(/^\/api\/exams\/([a-f0-9-]+)$/);
    if (examMatch) {
      const id = examMatch[1];
      if (req.method === 'PUT') return await updateExam(studentId, id, req, res);
      if (req.method === 'DELETE') return await deleteExam(studentId, id, res);
    }

    // Topics
    if (req.method === 'GET' && path === '/api/topics') return await getTopics(studentId, url, res);
    if (req.method === 'POST' && path === '/api/topics') return await createTopic(studentId, req, res);

    const topicMatch = path.match(/^\/api\/topics\/([a-f0-9-]+)$/);
    if (topicMatch) {
      const id = topicMatch[1];
      if (req.method === 'PUT') return await updateTopic(studentId, id, req, res);
      if (req.method === 'DELETE') return await deleteTopic(studentId, id, res);
    }

    // Sessions
    if (req.method === 'GET' && path === '/api/sessions') return await getSessions(studentId, url, res);
    if (req.method === 'POST' && path === '/api/sessions') return await createSession(studentId, req, res);
    if (req.method === 'PUT' && path === '/api/sessions/batch') return await setSessions(studentId, req, res);
    if (req.method === 'DELETE' && path === '/api/sessions') return await clearSessions(studentId, res);

    const sessionMatch = path.match(/^\/api\/sessions\/([a-f0-9-]+)$/);
    if (sessionMatch) {
      const id = sessionMatch[1];
      if (req.method === 'PUT') return await updateSession(studentId, id, req, res);
      if (req.method === 'DELETE') return await deleteSession(studentId, id, res);
    }

    // Mock Results
    if (req.method === 'GET' && path === '/api/mock-results') return await getMockResults(studentId, url, res);
    if (req.method === 'POST' && path === '/api/mock-results') return await createMockResult(studentId, req, res);

    const mockMatch = path.match(/^\/api\/mock-results\/([a-f0-9-]+)$/);
    if (mockMatch) {
      if (req.method === 'DELETE') return await deleteMockResult(studentId, mockMatch[1], res);
    }

    // Settings
    if (req.method === 'GET' && path === '/api/settings') return await getSettings(studentId, res);
    if (req.method === 'PUT' && path === '/api/settings') return await updateSettings(studentId, req, res);

    if (req.method === 'GET' && path === '/api/profile') return await getProfile(studentId, res);
    if (req.method === 'PUT' && path === '/api/profile') return await updateProfile(studentId, req, res);
    return sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = error.expose ? error.message : 'Internal server error';
    return sendJson(res, statusCode, { error: message });
  }
});

// ============================================================
// AUTH HANDLERS
// ============================================================

async function handleRegister(body, res) {
  validateRegistration(body);

  const email = body.email.toLowerCase().trim();
  const { rows } = await query('SELECT id FROM students WHERE lower(email) = $1', [email]);
  if (rows.length > 0) {
    return sendJson(res, 409, { error: 'Bu e-posta adresi zaten kayıtlı.' });
  }

  const uniqueId = "stu" + randomBytes(4).toString("hex");

  const partMap = { say: 1, ea: 2, dil: 3, sozel: 4 };
  const partId = partMap[body.part] || 1;
  const passwordHash = await hashPassword(body.password);
  const birthdate = body.birthdate || String(new Date().getFullYear() - (body.age || 17)) + '-01-01';
  const age = body.age || 17;
  const phone = body.phoneNumber || null;

  const { rows: userRows } = await query(
    `INSERT INTO students (email, name, password_hash, unique_id, grade, age, part_id, phone_number, birthdate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [email, body.name.trim(), passwordHash, uniqueId, body.grade, age, partId, phone, birthdate]
  );

  const user = userRows[0];
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await query(
    'INSERT INTO auth_sessions (student_id, token, expires_at) VALUES ($1,$2,$3)',
    [user.id, token, expiresAt]
  );

  return sendJson(res, 201, { success: true, token, user: sanitizeUser(user) });
}

async function handleLogin(body, res) {
  const email = String(body?.email || '').toLowerCase().trim();
  const password = String(body?.password || '');

  if (!email || !password) {
    return sendJson(res, 400, { error: 'E-posta ve şifre gereklidir.' });
  }

  const { rows } = await query('SELECT * FROM students WHERE lower(email) = $1', [email]);
  if (rows.length === 0) {
    return sendJson(res, 401, { error: 'E-posta veya şifre hatalı.' });
  }

  const user = rows[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return sendJson(res, 401, { error: 'E-posta veya şifre hatalı.' });
  }

  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await query(
    'INSERT INTO auth_sessions (student_id, token, expires_at) VALUES ($1,$2,$3)',
    [user.id, token, expiresAt]
  );

  return sendJson(res, 200, { success: true, token, user: sanitizeUser(user) });
}

async function handleMe(session, res) {
  const { rows } = await query('SELECT * FROM students WHERE id = $1', [session.student_id]);
  if (rows.length === 0) {
    return sendJson(res, 404, { error: 'User not found' });
  }
  return sendJson(res, 200, { success: true, user: sanitizeUser(rows[0]) });
}

async function handleLogout(req, res) {
  const token = extractBearerToken(req);
  if (!token) return sendJson(res, 400, { error: 'Token required' });
  await query('DELETE FROM auth_sessions WHERE token = $1', [token]);
  return sendJson(res, 200, { success: true, message: 'Logged out' });
}

// ============================================================
// SYNC
// ============================================================

async function handleSync(studentId, res) {
  const [exams, topics, sessions, mockResults, settings] = await Promise.all([
    query('SELECT * FROM exams WHERE student_id = $1 ORDER BY created_at', [studentId]),
    query('SELECT * FROM topics WHERE student_id = $1 ORDER BY created_at', [studentId]),
    query('SELECT * FROM study_sessions WHERE student_id = $1 ORDER BY date, start_hour, start_minute', [studentId]),
    query('SELECT * FROM mock_results WHERE student_id = $1 ORDER BY created_at', [studentId]),
    query('SELECT * FROM student_settings WHERE student_id = $1', [studentId]),
  ]);

  const dbSettings = settings.rows[0] || {};

  return sendJson(res, 200, {
    exams: mapExams(exams.rows),
    topics: mapTopics(topics.rows),
    sessions: mapSessions(sessions.rows),
    mockResults: mapMockResults(mockResults.rows),
    settings: mapSettings(dbSettings),
  });
}

// ============================================================
// EXAMS
// ============================================================

async function getExams(studentId, res) {
  const { rows } = await query('SELECT * FROM exams WHERE student_id = $1 ORDER BY created_at', [studentId]);
  return sendJson(res, 200, mapExams(rows));
}

async function createExam(studentId, req, res) {
  const body = await readJsonBody(req);
  const { rows } = await query(
    'INSERT INTO exams (id, student_id, name, date, color) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5) RETURNING *',
    [body.id || null, studentId, body.name, body.date, body.color || '#6366f1']
  );
  return sendJson(res, 201, mapExam(rows[0]));
}

async function updateExam(studentId, id, req, res) {
  const body = await readJsonBody(req);
  const { rows } = await query(
    'UPDATE exams SET name = COALESCE($1, name), date = COALESCE($2, date), color = COALESCE($3, color) WHERE id = $4 AND student_id = $5 RETURNING *',
    [body.name || null, body.date || null, body.color || null, id, studentId]
  );
  if (rows.length === 0) return sendJson(res, 404, { error: 'Exam not found' });
  return sendJson(res, 200, mapExam(rows[0]));
}

async function deleteExam(studentId, id, res) {
  const { rows } = await query('SELECT id FROM exams WHERE id = $1 AND student_id = $2', [id, studentId]);
  if (rows.length === 0) return sendJson(res, 404, { error: 'Exam not found' });

  // Cascade handled by DB foreign keys
  await query('DELETE FROM exams WHERE id = $1 AND student_id = $2', [id, studentId]);
  return sendJson(res, 200, { success: true });
}

// ============================================================
// TOPICS
// ============================================================

async function getTopics(studentId, url, res) {
  const examId = url.searchParams.get('examId');
  if (examId) {
    const { rows } = await query('SELECT * FROM topics WHERE student_id = $1 AND exam_id = $2 ORDER BY created_at', [studentId, examId]);
    return sendJson(res, 200, mapTopics(rows));
  }
  const { rows } = await query('SELECT * FROM topics WHERE student_id = $1 ORDER BY created_at', [studentId]);
  return sendJson(res, 200, mapTopics(rows));
}

async function createTopic(studentId, req, res) {
  const body = await readJsonBody(req);
  const { rows } = await query(
    `INSERT INTO topics (exam_id, student_id, name, weight, self_assessment, estimated_minutes, completed_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [body.examId, studentId, body.name, body.weight || 5, body.selfAssessment || 3, body.estimatedMinutes || 60, body.completedMinutes || 0]
  );
  return sendJson(res, 201, mapTopic(rows[0]));
}

async function updateTopic(studentId, id, req, res) {
  const body = await readJsonBody(req);
  const fields = [];
  const values = [];
  let n = 1;
  for (const [key, col] of [['name','name'], ['weight','weight'], ['selfAssessment','self_assessment'], ['estimatedMinutes','estimated_minutes'], ['completedMinutes','completed_minutes']]) {
    if (body[key] !== undefined) {
      fields.push(`${col} = $${n++}`);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) return sendJson(res, 400, { error: 'No fields to update' });
  values.push(id, studentId);
  const { rows } = await query(
    `UPDATE topics SET ${fields.join(', ')} WHERE id = $${n++} AND student_id = $${n++} RETURNING *`,
    values
  );
  if (rows.length === 0) return sendJson(res, 404, { error: 'Topic not found' });
  return sendJson(res, 200, mapTopic(rows[0]));
}

async function deleteTopic(studentId, id, res) {
  const { rows } = await query('SELECT id FROM topics WHERE id = $1 AND student_id = $2', [id, studentId]);
  if (rows.length === 0) return sendJson(res, 404, { error: 'Topic not found' });
  await query('DELETE FROM topics WHERE id = $1 AND student_id = $2', [id, studentId]);
  return sendJson(res, 200, { success: true });
}

// ============================================================
// SESSIONS
// ============================================================

async function getSessions(studentId, url, res) {
  const { rows } = await query('SELECT * FROM study_sessions WHERE student_id = $1 ORDER BY date, start_hour, start_minute', [studentId]);
  return sendJson(res, 200, mapSessions(rows));
}

async function createSession(studentId, req, res) {
  const body = await readJsonBody(req);
  const { rows } = await query(
    `INSERT INTO study_sessions (topic_id, student_id, date, start_hour, start_minute, duration_minutes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [body.topicId || null, studentId, body.date, body.startHour, body.startMinute || 0, body.durationMinutes || 30, body.status || 'scheduled']
  );
  return sendJson(res, 201, mapSession(rows[0]));
}

async function setSessions(studentId, req, res) {
  const body = await readJsonBody(req);
  const sessions = body.sessions || [];

  await query('DELETE FROM study_sessions WHERE student_id = $1', [studentId]);

  for (const s of sessions) {
    await query(
      `INSERT INTO study_sessions (id, topic_id, student_id, date, start_hour, start_minute, duration_minutes, status, completed_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [s.id, s.topicId || null, studentId, s.date, s.startHour, s.startMinute || 0, s.durationMinutes || 30, s.status || 'scheduled', s.completedAt || null, s.notes || '']
    );
  }

  return sendJson(res, 200, { success: true });
}

async function updateSession(studentId, id, req, res) {
  const body = await readJsonBody(req);
  const fields = [];
  const values = [];
  let n = 1;
  for (const [key, col] of [['status','status'], ['completedAt','completed_at'], ['notes','notes']]) {
    if (body[key] !== undefined) {
      fields.push(`${col} = $${n++}`);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) return sendJson(res, 400, { error: 'No fields to update' });
  values.push(id, studentId);
  const { rows } = await query(
    `UPDATE study_sessions SET ${fields.join(', ')} WHERE id = $${n++} AND student_id = $${n++} RETURNING *`,
    values
  );
  if (rows.length === 0) return sendJson(res, 404, { error: 'Session not found' });
  return sendJson(res, 200, mapSession(rows[0]));
}

async function deleteSession(studentId, id, res) {
  await query('DELETE FROM study_sessions WHERE id = $1 AND student_id = $2', [id, studentId]);
  return sendJson(res, 200, { success: true });
}

async function clearSessions(studentId, res) {
  await query('DELETE FROM study_sessions WHERE student_id = $1', [studentId]);
  return sendJson(res, 200, { success: true });
}

// ============================================================
// MOCK RESULTS
// ============================================================

async function getMockResults(studentId, url, res) {
  const topicId = url.searchParams.get('topicId');
  if (topicId) {
    const { rows } = await query('SELECT * FROM mock_results WHERE student_id = $1 AND topic_id = $2 ORDER BY created_at', [studentId, topicId]);
    return sendJson(res, 200, mapMockResults(rows));
  }
  const { rows } = await query('SELECT * FROM mock_results WHERE student_id = $1 ORDER BY created_at', [studentId]);
  return sendJson(res, 200, mapMockResults(rows));
}

async function createMockResult(studentId, req, res) {
  const body = await readJsonBody(req);
  const { rows } = await query(
    'INSERT INTO mock_results (topic_id, student_id, score, max_score, date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [body.topicId, studentId, body.score, body.maxScore || 100, body.date || new Date().toISOString().split('T')[0]]
  );
  return sendJson(res, 201, mapMockResult(rows[0]));
}

async function deleteMockResult(studentId, id, res) {
  await query('DELETE FROM mock_results WHERE id = $1 AND student_id = $2', [id, studentId]);
  return sendJson(res, 200, { success: true });
}

// ============================================================
// SETTINGS
// ============================================================

async function getSettings(studentId, res) {
  const { rows } = await query('SELECT * FROM student_settings WHERE student_id = $1', [studentId]);
  if (rows.length === 0) {
    return sendJson(res, 200, {
      weights: { urgency: 0.35, topicWeight: 0.25, weakness: 0.25, performance: 0.15 },
      constraints: { maxConsecutiveSameSubject: 3, breakFrequency: 3, minDailySubjects: 2, maxDailySlotsCount: 12, spacedRepetitionGapDays: 1, slotDurationMinutes: 30 },
      dailyAvailability: { '0': [{ start: 10, end: 14 }], '1': [{ start: 8, end: 12 }, { start: 14, end: 18 }], '2': [{ start: 8, end: 12 }, { start: 14, end: 18 }], '3': [{ start: 8, end: 12 }, { start: 14, end: 18 }], '4': [{ start: 8, end: 12 }, { start: 14, end: 18 }], '5': [{ start: 8, end: 12 }, { start: 14, end: 18 }], '6': [{ start: 10, end: 14 }] },
      rescheduling: { compressionFactor: 0.75, mediumPriorityThreshold: 0.4, maxDailyExtension: 2 },
    });
  }
  return sendJson(res, 200, mapSettings(rows[0]));
}

async function updateSettings(studentId, req, res) {  const body = await readJsonBody(req);  await query(`INSERT INTO student_settings (student_id) VALUES ($1) ON CONFLICT DO NOTHING`, [studentId]);  const changes = {};  if (body.weights) changes.weights = JSON.stringify(body.weights);  if (body.constraints) changes.constraints = JSON.stringify(body.constraints);  if (body.dailyAvailability) changes.daily_availability = JSON.stringify(body.dailyAvailability);  if (body.rescheduling) changes.rescheduling = JSON.stringify(body.rescheduling);  const keys = Object.keys(changes);  if (keys.length > 0) {    const pairs = keys.map((k, i) => `\"${k}\" = $${i + 1}`).join(", ");    await query(`UPDATE student_settings SET ${pairs} WHERE student_id = $${keys.length + 1}`, [...Object.values(changes), studentId]);  }  const { rows } = await query("SELECT * FROM student_settings WHERE student_id = $1", [studentId]);  return sendJson(res, 200, mapSettings(rows[0]));}

// ============================================================
// HELPERS

async function handleChangePassword(session, body, req, res) {
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) return sendJson(res, 400, { error: 'Mevcut şifre ve yeni şifre gereklidir.' });
  if (newPassword.length < 6) return sendJson(res, 400, { error: 'Yeni şifre en az 6 karakter olmalıdır.' });

  const { rows } = await query('SELECT password_hash FROM students WHERE id = $1', [session.student_id]);
  if (rows.length === 0) return sendJson(res, 404, { error: 'User not found' });

  const valid = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!valid) return sendJson(res, 400, { error: 'Mevcut şifre hatalı.' });

  const newHash = await hashPassword(newPassword);
  await query('UPDATE students SET password_hash = $1 WHERE id = $2', [newHash, session.student_id]);
  await query("DELETE FROM auth_sessions WHERE student_id = $1 AND token <> $2", [session.student_id, extractBearerToken(req)]);

  return sendJson(res, 200, { success: true, message: 'Şifre değiştirildi.' });
}

async function getProfile(studentId, res) {
  const { rows } = await query('SELECT id, email, name, unique_id, grade, age, part_id, phone_number, birthdate, created_at FROM students WHERE id = $1', [studentId]);
  if (rows.length === 0) return sendJson(res, 404, { error: 'Profile not found' });
  return sendJson(res, 200, rows[0]);
}

async function updateProfile(studentId, req, res) {
  const body = await readJsonBody(req);
  const parts = [];
  const vals = [];
  let n = 1;
  if (body.name) { parts.push('name = $' + (n++)); vals.push(body.name.trim()); }
  if (body.phoneNumber !== undefined) { parts.push('phone_number = $' + (n++)); vals.push(body.phoneNumber || null); }
  if (body.birthdate) { parts.push('birthdate = $' + (n++)); vals.push(body.birthdate); }
  if (body.age) { parts.push('age = $' + (n++)); vals.push(parseInt(body.age)); }
  if (parts.length > 0) {
    vals.push(studentId);
    await query('UPDATE students SET ' + parts.join(', ') + ' WHERE id = $' + n, vals);
  }
  const { rows } = await query('SELECT id, email, name, unique_id, grade, age, part_id, phone_number, birthdate, created_at FROM students WHERE id = $1', [studentId]);
  return sendJson(res, 200, rows[0]);
}
// ============================================================

function validateRegistration(body) {
  const requiredFields = ['email', 'name', 'password', 'grade'];
  for (const field of requiredFields) {
    if (!String(body?.[field] || '').trim()) {
      throw httpError(400, `${field} gereklidir.`);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw httpError(400, 'Geçerli bir e-posta adresi giriniz.');
  }
  if (String(body.password).length < 6) {
    throw httpError(400, 'Şifre en az 6 karakter olmalıdır.');
  }
}

async function getSession(req) {
  const token = extractBearerToken(req);
  if (!token) return null;

  await query('SELECT cleanup_expired_sessions()');

  const { rows } = await query(
    'SELECT * FROM auth_sessions WHERE token = $1 AND expires_at > now()',
    [token]
  );
  return rows[0] || null;
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid JSON body');
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || '').split(':');
  if (!salt || !key) return false;
  const derivedKey = await scrypt(password, salt, 64);
  const storedBuffer = Buffer.from(key, 'hex');
  const currentBuffer = Buffer.from(derivedKey);
  if (storedBuffer.length !== currentBuffer.length) return false;
  return timingSafeEqual(storedBuffer, currentBuffer);
}

function createToken() {
  return randomBytes(32).toString('hex');
}

function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ============================================================
// MAPPERS — convert DB column names to JS camelCase
// ============================================================

function mapExam(row) {
  return { id: row.id, studentId: row.student_id, name: row.name, date: row.date, color: row.color, createdAt: row.created_at };
}
function mapExams(rows) { return rows.map(mapExam); }

function mapTopic(row) {
  return { id: row.id, examId: row.exam_id, studentId: row.student_id, name: row.name, weight: row.weight, selfAssessment: row.self_assessment, estimatedMinutes: row.estimated_minutes, completedMinutes: row.completed_minutes, createdAt: row.created_at };
}
function mapTopics(rows) { return rows.map(mapTopic); }

function mapSession(row) {
  return { id: row.id, topicId: row.topic_id, studentId: row.student_id, date: row.date, startHour: row.start_hour, startMinute: row.start_minute, durationMinutes: row.duration_minutes, status: row.status, completedAt: row.completed_at, notes: row.notes, createdAt: row.created_at };
}
function mapSessions(rows) { return rows.map(mapSession); }

function mapMockResult(row) {
  return { id: row.id, topicId: row.topic_id, studentId: row.student_id, score: row.score, maxScore: row.max_score, date: row.date, createdAt: row.created_at };
}
function mapMockResults(rows) { return rows.map(mapMockResult); }

function mapSettings(row) {
  return {
    weights: row.weights || { urgency: 0.35, topicWeight: 0.25, weakness: 0.25, performance: 0.15 },
    constraints: row.constraints || { maxConsecutiveSameSubject: 3, breakFrequency: 3, minDailySubjects: 2, maxDailySlotsCount: 12, spacedRepetitionGapDays: 1, slotDurationMinutes: 30 },
    dailyAvailability: row.daily_availability || {},
    rescheduling: row.rescheduling || { compressionFactor: 0.75, mediumPriorityThreshold: 0.4, maxDailyExtension: 2 },
  };
}

// ============================================================
// HTTP UTILS
// ============================================================

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

// ============================================================
// STARTUP
// ============================================================

server.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
