import http from 'node:http';
import { execFile as execFileCallback } from 'node:child_process';
import { scrypt as scryptCallback, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query, getClient } from './db.js';
import { parseAnswerKeyText } from './bookletImport/answerKeyParser.js';
import { runBookletExtractor, regenerateBookletCrop } from './bookletImport/pythonBridge.js';
import {
  ensureTestStorage,
  getOriginalPdfPath,
  getReviewPath,
  getTestDir,
  readReview,
  toAssetUrl,
  writeReview,
} from './bookletImport/reviewStore.js';

const scrypt = promisify(scryptCallback);
const execFile = promisify(execFileCallback);
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

    const bookletAssetMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/assets\/(.+)$/);
    if (bookletAssetMatch && req.method === 'GET') {
      return await getBookletAsset(bookletAssetMatch[1], bookletAssetMatch[2], res);
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

    // Question Bank
    if (req.method === 'GET' && path === '/api/questions') return await getQuestions(studentId, url, res);
    if (req.method === 'POST' && path === '/api/questions') return await createQuestion(studentId, req, res);

    const questionAnswerMatch = path.match(/^\/api\/questions\/([a-f0-9-]+)\/answer$/);
    if (questionAnswerMatch && req.method === 'POST') {
      return await answerQuestion(studentId, questionAnswerMatch[1], req, res);
    }

    const questionMatch = path.match(/^\/api\/questions\/([a-f0-9-]+)$/);
    if (questionMatch) {
      const id = questionMatch[1];
      if (req.method === 'PUT') return await updateQuestion(studentId, id, req, res);
      if (req.method === 'DELETE') return await deleteQuestion(studentId, id, res);
    }

    if (req.method === 'POST' && path === '/api/ocr/questions') {
      return await extractQuestionsWithOcr(req, res);
    }

    if (req.method === 'GET' && path === '/api/admin/question-imports') {
      return await getAdminQuestionImports(res);
    }
    if (req.method === 'POST' && path === '/api/admin/question-imports') {
      return await importAdminQuestionPdf(studentId, req, res);
    }
    if (req.method === 'GET' && path === '/api/admin/booklet-tests') {
      return await getBookletTests(res);
    }
    if (req.method === 'POST' && path === '/api/admin/booklet-tests') {
      return await createBookletTest(req, res);
    }

    const bookletTestMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)$/);
    if (bookletTestMatch && req.method === 'GET') {
      return await getBookletTest(bookletTestMatch[1], res);
    }

    const bookletUploadMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/upload$/);
    if (bookletUploadMatch && req.method === 'POST') {
      return await uploadBookletTestPdf(bookletUploadMatch[1], req, res);
    }

    const bookletReviewMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/review$/);
    if (bookletReviewMatch && req.method === 'GET') {
      return await getBookletReview(bookletReviewMatch[1], res);
    }

    const bookletReviewCreateMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/review\/questions$/);
    if (bookletReviewCreateMatch && req.method === 'POST') {
      return await createBookletReviewQuestion(bookletReviewCreateMatch[1], req, res);
    }

    const bookletReviewQuestionMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/review\/questions\/([^/]+)$/);
    if (bookletReviewQuestionMatch) {
      const [, testId, tempId] = bookletReviewQuestionMatch;
      if (req.method === 'PATCH') return await updateBookletReviewQuestion(testId, tempId, req, res);
      if (req.method === 'DELETE') return await deleteBookletReviewQuestion(testId, tempId, res);
    }

    const bookletAnswerKeyMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/answer-key$/);
    if (bookletAnswerKeyMatch && req.method === 'POST') {
      return await applyBookletAnswerKey(bookletAnswerKeyMatch[1], req, res);
    }

    const bookletFinalizeMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/finalize$/);
    if (bookletFinalizeMatch && req.method === 'POST') {
      return await finalizeBookletTest(bookletFinalizeMatch[1], res);
    }

    const bookletQuestionsMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/questions$/);
    if (bookletQuestionsMatch && req.method === 'GET') {
      return await getBookletQuestions(bookletQuestionsMatch[1], res);
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
  const age = Math.min(20, Math.max(14, body.age || 17));
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
  const [exams, topics, sessions, mockResults, questions, answers, settings] = await Promise.all([
    query('SELECT * FROM exams WHERE student_id = $1 ORDER BY created_at', [studentId]),
    query('SELECT * FROM topics WHERE student_id = $1 ORDER BY created_at', [studentId]),
    query('SELECT * FROM study_sessions WHERE student_id = $1 ORDER BY date, start_hour, start_minute', [studentId]),
    query('SELECT * FROM mock_results WHERE student_id = $1 ORDER BY created_at', [studentId]),
    getQuestionRows(studentId, {}),
    query('SELECT * FROM student_answers WHERE student_id = $1 ORDER BY answered_at DESC', [studentId]),
    query('SELECT * FROM student_settings WHERE student_id = $1', [studentId]),
  ]);

  const dbSettings = settings.rows[0] || {};

  return sendJson(res, 200, {
    exams: mapExams(exams.rows),
    topics: mapTopics(topics.rows),
    sessions: mapSessions(sessions.rows),
    mockResults: mapMockResults(mockResults.rows),
    questions: mapQuestions(questions.rows),
    questionAnswers: mapQuestionAnswers(answers.rows),
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
  const { rows } = await query('SELECT id FROM study_sessions WHERE id = $1 AND student_id = $2', [id, studentId]);
  if (rows.length === 0) return sendJson(res, 404, { error: 'Session not found' });
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
// QUESTION BANK
// ============================================================

async function getQuestions(studentId, url, res) {
  const filters = {
    examType: url.searchParams.get('examType'),
    lesson: url.searchParams.get('lesson'),
    topicName: url.searchParams.get('topicName'),
  };
  const { rows } = await getQuestionRows(studentId, filters);
  return sendJson(res, 200, mapQuestions(rows));
}

async function createQuestion(studentId, req, res) {
  const body = await readJsonBody(req);
  validateQuestion(body);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO questions
        (id, student_id, exam_type, track, lesson, topic_name, question_no, question_text, question_image_url, correct_option, explanation, source_name, source_year, difficulty)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        body.id || null,
        studentId,
        body.examType || 'TYT',
        body.track || 'sayisal',
        body.lesson,
        body.topicName,
        body.questionNo || null,
        body.questionText,
        body.questionImageUrl || null,
        String(body.correctOption).toUpperCase(),
        body.explanation || '',
        body.sourceName || '',
        body.sourceYear || null,
        body.difficulty || 3,
      ]
    );

    for (const option of normalizeQuestionOptions(body.options)) {
      await client.query(
        `INSERT INTO question_options (question_id, option_key, option_text, option_image_url)
         VALUES ($1, $2, $3, $4)`,
        [rows[0].id, option.optionKey, option.optionText, option.optionImageUrl || null]
      );
    }

    await client.query('COMMIT');
    const created = await getQuestionRows(studentId, { id: rows[0].id });
    return sendJson(res, 201, mapQuestion(created.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateQuestion(studentId, id, req, res) {
  const body = await readJsonBody(req);
  validateQuestion({ ...body, id }, true);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE questions SET
        exam_type = $1, track = $2, lesson = $3, topic_name = $4, question_no = $5,
        question_text = $6, question_image_url = $7, correct_option = $8,
        explanation = $9, source_name = $10, source_year = $11, difficulty = $12
       WHERE id = $13 AND student_id = $14
       RETURNING *`,
      [
        body.examType || 'TYT',
        body.track || 'sayisal',
        body.lesson,
        body.topicName,
        body.questionNo || null,
        body.questionText,
        body.questionImageUrl || null,
        String(body.correctOption).toUpperCase(),
        body.explanation || '',
        body.sourceName || '',
        body.sourceYear || null,
        body.difficulty || 3,
        id,
        studentId,
      ]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'Question not found' });
    }

    await client.query('DELETE FROM student_answers WHERE question_id = $1 AND student_id = $2', [id, studentId]);
    await client.query('DELETE FROM question_options WHERE question_id = $1', [id]);
    for (const option of normalizeQuestionOptions(body.options)) {
      await client.query(
        `INSERT INTO question_options (question_id, option_key, option_text, option_image_url)
         VALUES ($1, $2, $3, $4)`,
        [id, option.optionKey, option.optionText, option.optionImageUrl || null]
      );
    }

    await client.query('COMMIT');
    const updated = await getQuestionRows(studentId, { id });
    return sendJson(res, 200, mapQuestion(updated.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteQuestion(studentId, id, res) {
  const { rows } = await query('DELETE FROM questions WHERE id = $1 AND student_id = $2 RETURNING id', [id, studentId]);
  if (rows.length === 0) return sendJson(res, 404, { error: 'Question not found' });
  return sendJson(res, 200, { success: true });
}

async function answerQuestion(studentId, id, req, res) {
  const body = await readJsonBody(req);
  const selectedOption = String(body.selectedOption || '').toUpperCase();
  if (!['A', 'B', 'C', 'D', 'E'].includes(selectedOption)) {
    return sendJson(res, 400, { error: 'Geçerli bir şık seçiniz.' });
  }

  const { rows: questionRows } = await query('SELECT id, correct_option FROM questions WHERE id = $1 AND student_id = $2', [id, studentId]);
  if (questionRows.length === 0) return sendJson(res, 404, { error: 'Question not found' });

  const isCorrect = selectedOption === questionRows[0].correct_option;
  const { rows } = await query(
    `INSERT INTO student_answers (student_id, question_id, selected_option, is_correct)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id, question_id)
     DO UPDATE SET selected_option = EXCLUDED.selected_option, is_correct = EXCLUDED.is_correct, answered_at = now()
     RETURNING *`,
    [studentId, id, selectedOption, isCorrect]
  );

  return sendJson(res, 200, mapQuestionAnswer(rows[0]));
}

async function getQuestionRows(studentId, filters = {}) {
  const conditions = ['q.student_id = $1'];
  const values = [studentId];
  let n = 2;

  if (filters.id) {
    conditions.push(`q.id = $${n++}`);
    values.push(filters.id);
  }
  if (filters.examType) {
    conditions.push(`q.exam_type = $${n++}`);
    values.push(filters.examType);
  }
  if (filters.lesson) {
    conditions.push(`q.lesson = $${n++}`);
    values.push(filters.lesson);
  }
  if (filters.topicName) {
    conditions.push(`q.topic_name = $${n++}`);
    values.push(filters.topicName);
  }

  return await query(
    `SELECT
       q.*,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'optionKey', qo.option_key,
             'optionText', qo.option_text,
             'optionImageUrl', qo.option_image_url
           )
           ORDER BY qo.option_key
         ) FILTER (WHERE qo.id IS NOT NULL),
         '[]'::jsonb
       ) AS options
     FROM questions q
     LEFT JOIN question_options qo ON qo.question_id = q.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY q.id
     ORDER BY q.created_at DESC`,
    values
  );
}

function validateQuestion(body, isUpdate = false) {
  const required = ['lesson', 'topicName', 'questionText', 'correctOption'];
  for (const field of required) {
    if (!String(body?.[field] || '').trim()) {
      throw httpError(400, `${field} gereklidir.`);
    }
  }
  if (!['TYT', 'AYT'].includes(String(body.examType || 'TYT'))) {
    throw httpError(400, 'Geçerli bir sınav türü seçiniz.');
  }
  if (!['A', 'B', 'C', 'D', 'E'].includes(String(body.correctOption || '').toUpperCase())) {
    throw httpError(400, 'Doğru cevap A-E arasında olmalıdır.');
  }
  const options = normalizeQuestionOptions(body.options);
  if (options.length !== 5) {
    throw httpError(400, 'A, B, C, D ve E şıkları gereklidir.');
  }
  if (options.some(option => !option.optionText && !option.optionImageUrl)) {
    throw httpError(400, 'Her şık için metin veya görsel gereklidir.');
  }
}

function normalizeQuestionOptions(options = []) {
  const optionMap = new Map();
  for (const option of options) {
    const key = String(option.optionKey || option.key || '').toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(key)) continue;
    optionMap.set(key, {
      optionKey: key,
      optionText: String(option.optionText || option.text || '').trim(),
      optionImageUrl: String(option.optionImageUrl || '').trim(),
    });
  }
  return ['A', 'B', 'C', 'D', 'E']
    .map(key => optionMap.get(key))
    .filter(Boolean);
}

async function extractQuestionsWithOcr(req, res) {
  const body = await readJsonBody(req);
  const fileName = String(body.fileName || '').toLowerCase();
  const fileBase64 = String(body.fileBase64 || '');
  const lang = String(body.lang || 'tur+eng');

  if (!fileName || !fileBase64) {
    return sendJson(res, 400, { error: 'Dosya gereklidir.' });
  }

  const data = Buffer.from(fileBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (!data.length) return sendJson(res, 400, { error: 'Dosya okunamadı.' });
  if (data.length > 20 * 1024 * 1024) return sendJson(res, 413, { error: 'Dosya en fazla 20MB olabilir.' });

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'bitirme-ocr-'));
  try {
    const ext = path.extname(fileName) || '.png';
    const inputPath = path.join(workDir, 'input' + ext);
    await writeFile(inputPath, data);

    const imagePaths = await prepareOcrImages(inputPath, ext, workDir);
    const pageTexts = [];
    for (const imagePath of imagePaths) {
      const { stdout } = await execFile('tesseract', [imagePath, 'stdout', '-l', lang, '--psm', '6'], { timeout: 60000 });
      pageTexts.push(stdout);
    }

    const rawText = pageTexts.join('\n\n').trim();
    return sendJson(res, 200, {
      rawText,
      questions: parseOcrQuestions(rawText),
    });
  } catch (error) {
    return sendJson(res, 500, { error: 'OCR çalıştırılamadı: ' + error.message });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function prepareOcrImages(inputPath, ext, workDir) {
  if (ext === '.pdf') {
    const prefix = path.join(workDir, 'page');
    await execFile('pdftoppm', ['-png', '-r', '220', '-f', '1', '-l', '5', inputPath, prefix], { timeout: 60000 });
    const files = await readdir(workDir);
    return files
      .filter(file => file.startsWith('page-') && file.endsWith('.png'))
      .sort()
      .map(file => path.join(workDir, file));
  }
  return [inputPath];
}

function parseOcrQuestions(rawText) {
  const normalized = rawText
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];

  const parts = normalized.split(/\n(?=\s*\d{1,3}\s*[\).:-]\s+)/g);
  return parts
    .map(parseQuestionBlock)
    .filter(question => question.questionText || question.options.some(option => option.optionText));
}

function parseQuestionBlock(block) {
  const questionNoMatch = block.match(/^\s*(\d{1,3})\s*[\).:-]\s*/);
  const questionNo = questionNoMatch ? Number(questionNoMatch[1]) : null;
  const withoutNo = questionNoMatch ? block.slice(questionNoMatch[0].length) : block;
  const optionPattern = /(?:^|\n|\s)(?:\(?([A-E])\)?\s*[\).:-]|([A-E])\s{2,})\s*/g;
  const matches = [...withoutNo.matchAll(optionPattern)];

  if (matches.length === 0) {
    return { questionNo, questionText: withoutNo.trim(), options: [], correctOption: '' };
  }

  const questionText = withoutNo.slice(0, matches[0].index).trim();
  const options = matches.map((match, idx) => {
    const start = match.index + match[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1].index : withoutNo.length;
    return {
      optionKey: match[1] || match[2],
      optionText: withoutNo.slice(start, end).trim(),
    };
  });

  return { questionNo, questionText, options, correctOption: '' };
}

async function getAdminQuestionImports(res) {
  const { rows } = await query(
    `SELECT id, exam_type, track, source_name, source_year, status, imported_count, review_count, created_at
     FROM admin_question_imports
     ORDER BY created_at DESC
     LIMIT 25`
  );
  return sendJson(res, 200, rows.map(mapAdminImport));
}

async function importAdminQuestionPdf(studentId, req, res) {
  const body = await readJsonBody(req);
  const examType = String(body.examType || 'TYT').toUpperCase();
  const track = String(body.track || 'sayisal');
  const sourceName = String(body.sourceName || '').trim();
  const sourceYear = body.sourceYear ? Number(body.sourceYear) : null;
  const curriculumTopics = Array.isArray(body.curriculumTopics) ? body.curriculumTopics : [];

  if (!['TYT', 'AYT'].includes(examType)) return sendJson(res, 400, { error: 'Geçerli sınav türü seçiniz.' });
  if (!sourceName) return sendJson(res, 400, { error: 'Kaynak adı gereklidir.' });
  if (!body.questionFileBase64 || !body.questionFileName) return sendJson(res, 400, { error: 'Soru PDF dosyası gereklidir.' });

  const questionText = await extractTextFromUploadedFile(body.questionFileName, body.questionFileBase64);
  const answerText = body.answerFileBase64
    ? await extractTextFromUploadedFile(body.answerFileName || 'answers.pdf', body.answerFileBase64)
    : questionText;
  const answerKey = parseAnswerKey(answerText);
  const parsedQuestions = parseExamQuestions(questionText);
  const prepared = parsedQuestions
    .filter(question => question.questionNo && question.questionText && question.options.length >= 4)
    .map(question => {
      const topicMatch = matchCurriculumTopic(question, curriculumTopics);
      const correctOption = answerKey[String(question.questionNo)] || null;
      return {
        ...question,
        lesson: topicMatch.lesson || '',
        topicName: topicMatch.topicName || '',
        topicConfidence: topicMatch.confidence || 0,
        correctOption,
        needsReview: !correctOption || !topicMatch.topicName || topicMatch.confidence < 0.18 || question.options.length < 5,
      };
    });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: importRows } = await client.query(
      `INSERT INTO admin_question_imports
        (uploaded_by, exam_type, track, source_name, source_year, raw_text, answer_key, imported_count, review_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        studentId,
        examType,
        track,
        sourceName,
        sourceYear,
        questionText.slice(0, 500000),
        JSON.stringify(answerKey),
        prepared.length,
        prepared.filter(question => question.needsReview).length,
      ]
    );

    const importId = importRows[0].id;
    let saved = 0;
    for (const question of prepared) {
      const { rows } = await client.query(
        `INSERT INTO global_questions
          (import_id, exam_type, track, lesson, topic_name, question_no, question_text, correct_option, topic_confidence, source_name, source_year, needs_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (exam_type, source_name, source_year, question_no)
         DO UPDATE SET
           import_id = EXCLUDED.import_id,
           track = EXCLUDED.track,
           lesson = EXCLUDED.lesson,
           topic_name = EXCLUDED.topic_name,
           question_text = EXCLUDED.question_text,
           correct_option = EXCLUDED.correct_option,
           topic_confidence = EXCLUDED.topic_confidence,
           needs_review = EXCLUDED.needs_review
         RETURNING id`,
        [
          importId,
          examType,
          track,
          question.lesson,
          question.topicName,
          question.questionNo,
          question.questionText,
          question.correctOption,
          question.topicConfidence,
          sourceName,
          sourceYear,
          question.needsReview,
        ]
      );
      const questionId = rows[0].id;
      await client.query('DELETE FROM global_question_options WHERE question_id = $1', [questionId]);
      for (const option of normalizeGlobalOptions(question.options)) {
        await client.query(
          `INSERT INTO global_question_options (question_id, option_key, option_text)
           VALUES ($1,$2,$3)`,
          [questionId, option.optionKey, option.optionText]
        );
      }
      saved++;
    }

    await client.query(
      'UPDATE admin_question_imports SET imported_count = $1 WHERE id = $2',
      [saved, importId]
    );
    await client.query('COMMIT');
    return sendJson(res, 201, {
      import: mapAdminImport({ ...importRows[0], imported_count: saved }),
      importedCount: saved,
      reviewCount: prepared.filter(question => question.needsReview).length,
      detectedQuestions: parsedQuestions.length,
      detectedAnswers: Object.keys(answerKey).length,
      preview: prepared.slice(0, 10),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getBookletTests(res) {
  const { rows } = await query(
    `SELECT id, title, exam_type, booklet_type, status, created_at
     FROM booklet_tests
     ORDER BY created_at DESC
     LIMIT 50`
  );
  return sendJson(res, 200, rows.map(mapBookletTest));
}

async function getBookletTest(testId, res) {
  const { rows } = await query(
    `SELECT id, title, exam_type, booklet_type, status, created_at
     FROM booklet_tests
     WHERE id = $1`,
    [testId]
  );
  if (!rows.length) return sendJson(res, 404, { error: 'Test bulunamadı.' });
  return sendJson(res, 200, mapBookletTest(rows[0]));
}

async function createBookletTest(req, res) {
  const body = await readJsonBody(req);
  const title = String(body.title || '').trim();
  const examType = String(body.examType || '').trim();
  const bookletType = String(body.bookletType || '').trim();

  if (!title) return sendJson(res, 400, { error: 'Test başlığı gereklidir.' });

  const { rows } = await query(
    `INSERT INTO booklet_tests (title, exam_type, booklet_type, status)
     VALUES ($1,$2,$3,'draft')
     RETURNING id, title, exam_type, booklet_type, status, created_at`,
    [title, examType, bookletType]
  );

  const test = mapBookletTest(rows[0]);
  await ensureTestStorage(test.id);
  return sendJson(res, 201, test);
}

async function uploadBookletTestPdf(testId, req, res) {
  const { rows } = await query('SELECT * FROM booklet_tests WHERE id = $1', [testId]);
  if (!rows.length) return sendJson(res, 404, { error: 'Test bulunamadı.' });

  const body = await readJsonBody(req);
  const pdfFileName = String(body.pdfFileName || '').trim();
  const pdfFileBase64 = String(body.pdfFileBase64 || '');
  if (!pdfFileName || !pdfFileBase64) {
    return sendJson(res, 400, { error: 'PDF dosyası gereklidir.' });
  }

  await ensureTestStorage(testId);
  const pdfBuffer = Buffer.from(pdfFileBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (!pdfBuffer.length) return sendJson(res, 400, { error: 'PDF dosyası okunamadı.' });

  const pdfPath = getOriginalPdfPath(testId);
  await writeFile(pdfPath, pdfBuffer);
  await query(
    'UPDATE booklet_tests SET pdf_path = $1, status = $2 WHERE id = $3',
    [pdfPath, 'processing', testId]
  );

  try {
    const review = await runBookletExtractor({
      testId,
      pdfPath,
      testDir: getTestDir(testId),
      title: rows[0].title,
      examType: rows[0].exam_type,
      bookletType: rows[0].booklet_type,
    });

    await writeReview(testId, review);
    await query(
      'UPDATE booklet_tests SET review_path = $1, status = $2 WHERE id = $3',
      [getReviewPath(testId), 'review', testId]
    );
    return sendJson(res, 200, buildReviewResponse(testId, review));
  } catch (error) {
    await query('UPDATE booklet_tests SET status = $1 WHERE id = $2', ['failed', testId]);
    throw httpError(500, 'PDF işlendi fakat extraction başarısız oldu: ' + error.message);
  }
}

async function getBookletReview(testId, res) {
  await ensureBookletTestExists(testId);
  let review;
  try {
    review = await readReview(testId);
  } catch {
    return sendJson(res, 404, { error: 'Bu test icin henuz review dosyasi olusturulmadi.' });
  }
  return sendJson(res, 200, buildReviewResponse(testId, review));
}

async function updateBookletReviewQuestion(testId, tempId, req, res) {
  await ensureBookletTestExists(testId);
  const body = await readJsonBody(req);
  const review = await readReview(testId);
  const question = review.detections.find(item => item.tempId === tempId);
  if (!question) return sendJson(res, 404, { error: 'Geçici soru bulunamadı.' });

  if (body.sectionCode !== undefined) {
    const section = findReviewSection(review, body.sectionCode);
    if (section) {
      question.sectionCode = section.sectionCode;
      question.sectionName = section.sectionName;
      question.sectionOrder = section.sectionOrder;
    }
  }
  if (body.sectionQuestionNumber !== undefined || body.questionNumber !== undefined) {
    const rawNumber = body.sectionQuestionNumber !== undefined ? body.sectionQuestionNumber : body.questionNumber;
    question.sectionQuestionNumber = rawNumber ? Number(rawNumber) : null;
  }
  if (body.globalQuestionOrder !== undefined) question.globalQuestionOrder = body.globalQuestionOrder ? Number(body.globalQuestionOrder) : null;
  if (body.correctAnswer !== undefined) {
    const answer = String(body.correctAnswer || '').toUpperCase();
    question.correctAnswer = ['A', 'B', 'C', 'D', 'E'].includes(answer) ? answer : '';
  }
  if (body.deleted !== undefined) {
    question.deleted = Boolean(body.deleted);
  }

  if (body.crop) {
    question.crop = normalizeCrop(body.crop);
    const rerendered = await rerenderReviewCrop(testId, review, question);
    question.imagePath = rerendered.imagePath;
  }

  await writeReview(testId, review);
  return sendJson(res, 200, buildReviewResponse(testId, review));
}

async function createBookletReviewQuestion(testId, req, res) {
  await ensureBookletTestExists(testId);
  const body = await readJsonBody(req);
  const review = await readReview(testId);
  const pageNumber = Number(body.pageNumber || 0);
  const crop = normalizeCrop(body.crop || {});
  if (!pageNumber || pageNumber < 1 || pageNumber > review.pages.length) {
    return sendJson(res, 400, { error: 'Geçerli sayfa numarası seçiniz.' });
  }

  const fallbackSection = findReviewSection(review, body.sectionCode) || review.sections?.[0] || {
    sectionCode: 'main',
    sectionName: 'Main',
    sectionOrder: 1,
  };

  const question = {
    tempId: randomUUID(),
    sectionCode: fallbackSection.sectionCode,
    sectionName: fallbackSection.sectionName,
    sectionOrder: fallbackSection.sectionOrder,
    sectionQuestionNumber: body.sectionQuestionNumber ? Number(body.sectionQuestionNumber) : (body.questionNumber ? Number(body.questionNumber) : null),
    globalQuestionOrder: body.globalQuestionOrder ? Number(body.globalQuestionOrder) : inferNextGlobalQuestionOrder(review),
    pageNumber,
    columnIndex: 0,
    detectedText: 'Manual',
    confidenceScore: 1,
    correctAnswer: '',
    choices: ['A', 'B', 'C', 'D', 'E'],
    imagePath: '',
    deleted: false,
    manual: true,
    crop,
  };
  const rerendered = await rerenderReviewCrop(testId, review, question);
  question.imagePath = rerendered.imagePath;
  review.detections.push(question);
  review.detections.sort(sortReviewQuestions);
  await writeReview(testId, review);
  return sendJson(res, 201, buildReviewResponse(testId, review));
}

async function deleteBookletReviewQuestion(testId, tempId, res) {
  await ensureBookletTestExists(testId);
  const review = await readReview(testId);
  const question = review.detections.find(item => item.tempId === tempId);
  if (!question) return sendJson(res, 404, { error: 'Geçici soru bulunamadı.' });
  question.deleted = true;
  await writeReview(testId, review);
  return sendJson(res, 200, buildReviewResponse(testId, review));
}

async function applyBookletAnswerKey(testId, req, res) {
  await ensureBookletTestExists(testId);
  const review = await readReview(testId);
  const body = await readJsonBody(req);
  const answerKey = (body.answerKeyText || '').trim()
    ? parseStructuredAnswerKeyText(body.answerKeyText || '', review.sections || [])
    : (review.answerKey || {});

  let matchedCount = 0;
  for (const question of review.detections) {
    if (question.deleted || !question.sectionQuestionNumber) continue;
    const matched = lookupAnswerForQuestion(answerKey, question);
    if (matched) {
      question.correctAnswer = matched;
      matchedCount += 1;
    }
  }

  await writeReview(testId, review);
  return sendJson(res, 200, {
    matchedCount,
    answerCount: countStructuredAnswerEntries(answerKey),
    review: buildReviewResponse(testId, review),
  });
}

async function finalizeBookletTest(testId, res) {
  await ensureBookletTestExists(testId);
  const review = await readReview(testId);
  const active = review.detections
    .filter(item => !item.deleted && item.sectionQuestionNumber)
    .sort(sortReviewQuestions)
    .map((question, index) => ({
      ...question,
      globalQuestionOrder: question.globalQuestionOrder || (index + 1),
    }));
  const duplicates = findDuplicateSectionQuestions(active);
  if (duplicates.length) {
    return sendJson(res, 400, { error: 'Aynı bölüm içinde tekrar eden soru numaraları var: ' + duplicates.join(', ') });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM booklet_sections WHERE test_id = $1', [testId]);
    await client.query('DELETE FROM booklet_questions WHERE test_id = $1', [testId]);
    const sectionIdByCode = new Map();
    for (const section of buildPersistedSections(review, active)) {
      const { rows } = await client.query(
        `INSERT INTO booklet_sections (test_id, section_code, section_name, section_order, start_page, end_page)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [testId, section.sectionCode, section.sectionName, section.sectionOrder, section.startPage || null, section.endPage || null]
      );
      sectionIdByCode.set(section.sectionCode, rows[0].id);
    }
    for (const question of active) {
      await client.query(
        `INSERT INTO booklet_questions (test_id, section_id, section_question_number, global_question_order, image_path, correct_answer, choices)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          testId,
          sectionIdByCode.get(question.sectionCode),
          question.sectionQuestionNumber,
          question.globalQuestionOrder,
          toAssetUrl(testId, question.imagePath),
          question.correctAnswer || null,
          JSON.stringify(question.choices || ['A', 'B', 'C', 'D', 'E']),
        ]
      );
    }
    await client.query('UPDATE booklet_tests SET status = $1 WHERE id = $2', ['finalized', testId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return sendJson(res, 200, { success: true, savedCount: active.length });
}

async function getBookletQuestions(testId, res) {
  await ensureBookletTestExists(testId);
  const { rows } = await query(
    `SELECT q.id, q.test_id, q.section_id, s.section_code, s.section_name, s.section_order,
            q.section_question_number, q.global_question_order, q.image_path, q.correct_answer, q.choices, q.created_at
     FROM booklet_questions q
     JOIN booklet_sections s ON s.id = q.section_id
     WHERE q.test_id = $1
     ORDER BY q.global_question_order`,
    [testId]
  );
  return sendJson(res, 200, rows.map(mapBookletQuestion));
}

async function getBookletAsset(testId, relativePath, res) {
  await ensureBookletTestExists(testId);
  const baseDir = path.resolve(getTestDir(testId));
  const requested = path.normalize(String(relativePath || '')).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.resolve(baseDir, requested);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
    return sendJson(res, 400, { error: 'Geçersiz dosya yolu.' });
  }

  let content;
  try {
    content = await readFile(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Dosya bulunamadi.' });
  }
  const contentType = filePath.endsWith('.png')
    ? 'image/png'
    : filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

async function ensureBookletTestExists(testId) {
  const { rows } = await query('SELECT id FROM booklet_tests WHERE id = $1', [testId]);
  if (!rows.length) throw httpError(404, 'Test bulunamadı.');
}

async function rerenderReviewCrop(testId, review, question) {
  const outputRelativePath = question.imagePath || ('crops/manual-' + question.tempId.slice(0, 8) + '.png');
  return regenerateBookletCrop({
    pdfPath: getOriginalPdfPath(testId),
    testDir: getTestDir(testId),
    pageNumber: question.pageNumber,
    crop: question.crop,
    outputRelativePath,
  });
}

function buildReviewResponse(testId, review) {
  return {
    ...review,
    sections: (review.sections || []).map(section => ({ ...section })),
    pages: (review.pages || []).map(page => ({
      ...page,
      assetUrl: toAssetUrl(testId, page.imagePath),
    })),
    detections: (review.detections || []).map(question => ({
      ...question,
      questionNumber: question.sectionQuestionNumber ?? null,
      assetUrl: question.imagePath ? toAssetUrl(testId, question.imagePath) : '',
    })),
  };
}

function normalizeCrop(crop) {
  return {
    x: Math.max(0, Number(crop.x || 0)),
    y: Math.max(0, Number(crop.y || 0)),
    width: Math.max(1, Number(crop.width || 1)),
    height: Math.max(1, Number(crop.height || 1)),
  };
}

function sortReviewQuestions(left, right) {
  return ((left.sectionOrder || 1) - (right.sectionOrder || 1))
    || (left.pageNumber - right.pageNumber)
    || (left.columnIndex - right.columnIndex)
    || (left.crop.y - right.crop.y)
    || ((left.sectionQuestionNumber || 9999) - (right.sectionQuestionNumber || 9999))
    || ((left.globalQuestionOrder || 9999) - (right.globalQuestionOrder || 9999));
}

function findDuplicateSectionQuestions(questions) {
  const counts = new Map();
  for (const question of questions) {
    const key = String(question.sectionCode || 'main') + ':' + String(question.sectionQuestionNumber);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function inferNextGlobalQuestionOrder(review) {
  const values = (review.detections || []).map(item => Number(item.globalQuestionOrder || 0));
  return Math.max(0, ...values) + 1;
}

function findReviewSection(review, sectionCode) {
  const normalized = normalizeSectionAlias(sectionCode);
  if (!normalized) return null;
  return (review.sections || []).find(section => normalizeSectionAlias(section.sectionCode) === normalized) || null;
}

function buildPersistedSections(review, activeQuestions) {
  const sections = new Map();
  for (const section of review.sections || []) {
    sections.set(section.sectionCode, {
      sectionCode: section.sectionCode,
      sectionName: section.sectionName,
      sectionOrder: section.sectionOrder || 1,
      startPage: section.startPage || null,
      endPage: section.endPage || null,
    });
  }
  for (const question of activeQuestions) {
    if (!sections.has(question.sectionCode)) {
      sections.set(question.sectionCode, {
        sectionCode: question.sectionCode || 'main',
        sectionName: question.sectionName || 'Main',
        sectionOrder: question.sectionOrder || 1,
        startPage: question.pageNumber || null,
        endPage: question.pageNumber || null,
      });
      continue;
    }
    const section = sections.get(question.sectionCode);
    section.startPage = section.startPage ? Math.min(section.startPage, question.pageNumber) : question.pageNumber;
    section.endPage = section.endPage ? Math.max(section.endPage, question.pageNumber) : question.pageNumber;
  }
  return [...sections.values()].sort((left, right) => left.sectionOrder - right.sectionOrder);
}

function parseStructuredAnswerKeyText(rawText, sections) {
  const normalized = String(rawText || '').replace(/\r/g, '\n');
  const answerKey = {};
  const sectionAliases = buildSectionAliasMap(sections);
  const sectionedPattern = /^(.*?)\s+(\d{1,3})\s*[:.\-)]\s*([A-E])\s*$/i;
  const flatPattern = /^(\d{1,3})\s*[:.\-)]\s*([A-E])\s*$/i;

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectioned = line.match(sectionedPattern);
    if (sectioned) {
      const section = matchSectionAlias(sectioned[1], sectionAliases);
      if (section) {
        if (!answerKey[section.sectionCode]) answerKey[section.sectionCode] = {};
        answerKey[section.sectionCode][String(Number(sectioned[2]))] = sectioned[3].toUpperCase();
        continue;
      }
    }

    const flat = line.match(flatPattern);
    if (flat) {
      if ((sections || []).length === 1) {
        const only = sections[0];
        if (!answerKey[only.sectionCode]) answerKey[only.sectionCode] = {};
        answerKey[only.sectionCode][String(Number(flat[1]))] = flat[2].toUpperCase();
      } else {
        if (!answerKey.__global__) answerKey.__global__ = {};
        answerKey.__global__[String(Number(flat[1]))] = flat[2].toUpperCase();
      }
    }
  }

  return answerKey;
}

function buildSectionAliasMap(sections) {
  return (sections || []).map(section => ({
    ...section,
    aliases: [
      section.sectionCode,
      section.sectionName,
      String(section.sectionName || '').replace(/testi|testı|bilimleri|bilimler/gi, '').trim(),
    ].map(normalizeSectionAlias).filter(Boolean),
  }));
}

function matchSectionAlias(value, sectionAliases) {
  const normalized = normalizeSectionAlias(value);
  return sectionAliases.find(section => section.aliases.includes(normalized)) || null;
}

function normalizeSectionAlias(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lookupAnswerForQuestion(answerKey, question) {
  const sectionAnswers = answerKey[question.sectionCode];
  if (sectionAnswers && sectionAnswers[String(question.sectionQuestionNumber)]) {
    return sectionAnswers[String(question.sectionQuestionNumber)];
  }
  if (answerKey.__global__ && answerKey.__global__[String(question.globalQuestionOrder)]) {
    return answerKey.__global__[String(question.globalQuestionOrder)];
  }
  return '';
}

function countStructuredAnswerEntries(answerKey) {
  return Object.values(answerKey || {}).reduce((total, value) => {
    if (value && typeof value === 'object') return total + Object.keys(value).length;
    return total;
  }, 0);
}

async function extractTextFromUploadedFile(fileName, fileBase64) {
  const data = Buffer.from(String(fileBase64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!data.length) throw httpError(400, 'Dosya okunamadı.');
  if (data.length > 60 * 1024 * 1024) throw httpError(413, 'Dosya en fazla 60MB olabilir.');

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'bitirme-admin-import-'));
  try {
    const ext = path.extname(String(fileName || '').toLowerCase()) || '.pdf';
    const inputPath = path.join(workDir, 'input' + ext);
    await writeFile(inputPath, data);

    if (ext === '.pdf') {
      const textPath = path.join(workDir, 'text.txt');
      try {
        await execFile('pdftotext', ['-layout', inputPath, textPath], { timeout: 90000 });
        const text = await readFile(textPath, 'utf8');
        if (text.trim().length > 500) return normalizeExtractedText(text);
      } catch {
        // Fallback to OCR below.
      }
    }

    const imagePaths = await prepareAdminOcrImages(inputPath, ext, workDir);
    const pageTexts = [];
    for (const imagePath of imagePaths) {
      const { stdout } = await execFile('tesseract', [imagePath, 'stdout', '-l', 'tur+eng', '--psm', '6'], { timeout: 90000 });
      pageTexts.push(stdout);
    }
    return normalizeExtractedText(pageTexts.join('\n\n'));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function prepareAdminOcrImages(inputPath, ext, workDir) {
  if (ext === '.pdf') {
    const prefix = path.join(workDir, 'page');
    await execFile('pdftoppm', ['-png', '-r', '220', '-f', '1', '-l', '80', inputPath, prefix], { timeout: 120000 });
    const files = await readdir(workDir);
    return files
      .filter(file => file.startsWith('page-') && file.endsWith('.png'))
      .sort()
      .map(file => path.join(workDir, file));
  }
  return [inputPath];
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function parseExamQuestions(rawText) {
  const text = normalizeExtractedText(rawText);
  const starts = [...text.matchAll(/(?:^|\n)\s*(\d{1,3})\s*[\).:-]\s+/g)]
    .map(match => ({ index: match.index + (match[0].startsWith('\n') ? 1 : 0), no: Number(match[1]) }))
    .filter(item => item.no >= 1 && item.no <= 200);

  const questions = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const block = text.slice(start, end).trim();
    const parsed = parseQuestionBlock(block);
    if (parsed.questionNo) questions.push(parsed);
  }
  return dedupeQuestions(questions);
}

function dedupeQuestions(questions) {
  const byNo = new Map();
  for (const question of questions) {
    const existing = byNo.get(question.questionNo);
    if (!existing || question.options.length > existing.options.length || question.questionText.length > existing.questionText.length) {
      byNo.set(question.questionNo, question);
    }
  }
  return [...byNo.values()].sort((a, b) => a.questionNo - b.questionNo);
}

function parseAnswerKey(text) {
  const normalized = normalizeExtractedText(text).toUpperCase();
  const answerKey = {};
  const patterns = [
    /(?:^|[\s\n])(\d{1,3})\s*[\).:-]?\s*([A-E])(?:\s|$)/g,
    /(?:SORU|CEVAP)\s*(\d{1,3})\D{0,8}([A-E])\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const no = Number(match[1]);
      if (no >= 1 && no <= 200) answerKey[String(no)] = match[2];
    }
  }
  return answerKey;
}

function matchCurriculumTopic(question, curriculumTopics) {
  const haystack = removeTurkishMarks((question.questionText + ' ' + question.options.map(option => option.optionText).join(' ')).toLowerCase());
  let best = { lesson: '', topicName: '', confidence: 0 };

  for (const item of curriculumTopics) {
    const topicName = String(item.topicName || item.name || '').trim();
    const lesson = String(item.lesson || '').trim();
    if (!topicName || !lesson) continue;

    const topicWords = tokenizeTopic(topicName);
    const lessonWords = tokenizeTopic(lesson);
    let score = 0;
    for (const word of topicWords) {
      if (word.length >= 4 && haystack.includes(word)) score += 3;
      else if (word.length >= 3 && haystack.includes(word)) score += 1.5;
    }
    for (const word of lessonWords) {
      if (word.length >= 4 && haystack.includes(word)) score += 0.5;
    }

    const confidence = Math.min(1, score / Math.max(6, topicWords.length * 3));
    if (confidence > best.confidence) best = { lesson, topicName, confidence: Math.round(confidence * 1000) / 1000 };
  }

  return best;
}

function tokenizeTopic(value) {
  return removeTurkishMarks(String(value).toLowerCase())
    .split(/[^a-z0-9]+/g)
    .filter(word => word.length >= 3 && !['tyt', 'ayt', 've', 'ile', 'bir'].includes(word));
}

function removeTurkishMarks(value) {
  return String(value)
    .replaceAll('ı', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replaceAll('İ', 'i')
    .replaceAll('Ğ', 'g')
    .replaceAll('Ü', 'u')
    .replaceAll('Ş', 's')
    .replaceAll('Ö', 'o')
    .replaceAll('Ç', 'c');
}

function normalizeGlobalOptions(options) {
  const optionMap = new Map();
  for (const option of options) {
    const key = String(option.optionKey || '').toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(key)) continue;
    optionMap.set(key, String(option.optionText || '').trim());
  }
  return ['A', 'B', 'C', 'D', 'E']
    .filter(key => optionMap.has(key))
    .map(key => ({ optionKey: key, optionText: optionMap.get(key) }));
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
  if (body.age) { const parsedAge = parseInt(body.age); if (!isNaN(parsedAge) && parsedAge >= 14 && parsedAge <= 20) { parts.push('age = $' + (n++)); vals.push(parsedAge); } }
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
  if (String(body.name || '').trim().length < 2) {
    throw httpError(400, 'İsim en az 2 karakter olmalıdır.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw httpError(400, 'Geçerli bir e-posta adresi giriniz.');
  }
  if (String(body.password).length < 6) {
    throw httpError(400, 'Şifre en az 6 karakter olmalıdır.');
  }
}

let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_RETRY_MS = 1500;
const STARTUP_MAX_ATTEMPTS = 40;

async function getSession(req) {
  const token = extractBearerToken(req);
  if (!token) return null;

  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    await query('SELECT cleanup_expired_sessions()');
    lastCleanup = now;
  }

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

function mapQuestion(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    examType: row.exam_type,
    track: row.track,
    lesson: row.lesson,
    topicName: row.topic_name,
    questionNo: row.question_no,
    questionText: row.question_text,
    questionImageUrl: row.question_image_url || '',
    options: Array.isArray(row.options) ? row.options : [],
    correctOption: row.correct_option,
    explanation: row.explanation || '',
    sourceName: row.source_name || '',
    sourceYear: row.source_year,
    difficulty: row.difficulty,
    createdAt: row.created_at,
  };
}
function mapQuestions(rows) { return rows.map(mapQuestion); }

function mapQuestionAnswer(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    questionId: row.question_id,
    selectedOption: row.selected_option,
    isCorrect: row.is_correct,
    answeredAt: row.answered_at,
  };
}
function mapQuestionAnswers(rows) { return rows.map(mapQuestionAnswer); }

function mapAdminImport(row) {
  return {
    id: row.id,
    examType: row.exam_type,
    track: row.track,
    sourceName: row.source_name,
    sourceYear: row.source_year,
    status: row.status,
    importedCount: row.imported_count,
    reviewCount: row.review_count,
    createdAt: row.created_at,
  };
}

function mapBookletTest(row) {
  return {
    id: row.id,
    title: row.title,
    examType: row.exam_type,
    bookletType: row.booklet_type,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapBookletQuestion(row) {
  return {
    id: row.id,
    testId: row.test_id,
    sectionId: row.section_id,
    sectionCode: row.section_code || '',
    sectionName: row.section_name || '',
    sectionOrder: row.section_order || 1,
    sectionQuestionNumber: row.section_question_number,
    globalQuestionOrder: row.global_question_order,
    imagePath: row.image_path,
    correctAnswer: row.correct_answer || '',
    choices: Array.isArray(row.choices) ? row.choices : ['A', 'B', 'C', 'D', 'E'],
    createdAt: row.created_at,
  };
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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

startServer();

async function startServer() {
  try {
    await ensureQuestionSchemaWithRetry();
    server.listen(PORT, () => {
      console.log(`API server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Question schema migration failed:', error.message);
    process.exit(1);
  }
}

async function ensureQuestionSchemaWithRetry() {
  let lastError = null;
  for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt++) {
    try {
      await ensureQuestionSchema();
      return;
    } catch (error) {
      lastError = error;
      console.error(`Schema init attempt ${attempt}/${STARTUP_MAX_ATTEMPTS} failed: ${error.message}`);
      if (attempt < STARTUP_MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, STARTUP_RETRY_MS));
      }
    }
  }
  throw lastError || new Error('Unknown schema init failure');
}

async function ensureQuestionSchema() {
  // Drop strict birthdate-age consistency constraint that causes registration failures
  try { await query('ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_age_birth'); } catch (e) {}
  await query(`
    CREATE TABLE IF NOT EXISTS questions (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id     UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      exam_type      VARCHAR(3)  NOT NULL CHECK (exam_type IN ('TYT', 'AYT')),
      track          VARCHAR(20) NOT NULL DEFAULT 'sayisal',
      lesson         VARCHAR(100) NOT NULL,
      topic_name     VARCHAR(255) NOT NULL,
      question_no    INT,
      question_text  TEXT        NOT NULL,
      question_image_url TEXT,
      correct_option CHAR(1)     NOT NULL CHECK (correct_option IN ('A','B','C','D','E')),
      explanation    TEXT        NOT NULL DEFAULT '',
      source_name    VARCHAR(255) NOT NULL DEFAULT '',
      source_year    INT,
      difficulty     SMALLINT    NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_questions_student ON questions (student_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions (student_id, exam_type, lesson, topic_name)');
  await query(`
    CREATE TABLE IF NOT EXISTS question_options (
      id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id      UUID    NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      option_key       CHAR(1) NOT NULL CHECK (option_key IN ('A','B','C','D','E')),
      option_text      TEXT    NOT NULL DEFAULT '',
      option_image_url TEXT,
      UNIQUE (question_id, option_key)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options (question_id)');
  await query(`
    CREATE TABLE IF NOT EXISTS student_answers (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id      UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      question_id     UUID        NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      selected_option CHAR(1)     NOT NULL CHECK (selected_option IN ('A','B','C','D','E')),
      is_correct      BOOLEAN     NOT NULL,
      answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (student_id, question_id)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_student_answers_student ON student_answers (student_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_student_answers_question ON student_answers (question_id)');
  await query(`
    CREATE TABLE IF NOT EXISTS admin_question_imports (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_by    UUID        REFERENCES students(id) ON DELETE SET NULL,
      exam_type      VARCHAR(3)  NOT NULL CHECK (exam_type IN ('TYT', 'AYT')),
      track          VARCHAR(20) NOT NULL DEFAULT 'sayisal',
      source_name    VARCHAR(255) NOT NULL,
      source_year    INT,
      status         VARCHAR(20) NOT NULL DEFAULT 'completed',
      raw_text       TEXT        NOT NULL DEFAULT '',
      answer_key     JSONB       NOT NULL DEFAULT '{}'::jsonb,
      imported_count INT         NOT NULL DEFAULT 0,
      review_count   INT         NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_admin_imports_created ON admin_question_imports (created_at DESC)');
  await query(`
    CREATE TABLE IF NOT EXISTS global_questions (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      import_id        UUID        NOT NULL REFERENCES admin_question_imports(id) ON DELETE CASCADE,
      exam_type        VARCHAR(3)  NOT NULL CHECK (exam_type IN ('TYT', 'AYT')),
      track            VARCHAR(20) NOT NULL DEFAULT 'sayisal',
      lesson           VARCHAR(100) NOT NULL DEFAULT '',
      topic_name       VARCHAR(255) NOT NULL DEFAULT '',
      question_no      INT         NOT NULL,
      question_text    TEXT        NOT NULL,
      correct_option   CHAR(1)     CHECK (correct_option IN ('A','B','C','D','E')),
      topic_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
      source_name      VARCHAR(255) NOT NULL DEFAULT '',
      source_year      INT,
      needs_review     BOOLEAN     NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (exam_type, source_name, source_year, question_no)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_global_questions_import ON global_questions (import_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_global_questions_topic ON global_questions (exam_type, lesson, topic_name)');
  await query(`
    CREATE TABLE IF NOT EXISTS global_question_options (
      id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id UUID    NOT NULL REFERENCES global_questions(id) ON DELETE CASCADE,
      option_key  CHAR(1) NOT NULL CHECK (option_key IN ('A','B','C','D','E')),
      option_text TEXT    NOT NULL DEFAULT '',
      UNIQUE (question_id, option_key)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_global_question_options_question ON global_question_options (question_id)');
  await query(`
    CREATE TABLE IF NOT EXISTS booklet_tests (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title        VARCHAR(255) NOT NULL,
      exam_type    VARCHAR(20) NOT NULL DEFAULT '',
      booklet_type VARCHAR(50) NOT NULL DEFAULT '',
      pdf_path     TEXT        NOT NULL DEFAULT '',
      review_path  TEXT        NOT NULL DEFAULT '',
      status       VARCHAR(20) NOT NULL DEFAULT 'draft',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_booklet_tests_created ON booklet_tests (created_at DESC)');
  await query(`
    CREATE TABLE IF NOT EXISTS booklet_sections (
      id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      test_id       UUID         NOT NULL REFERENCES booklet_tests(id) ON DELETE CASCADE,
      section_code  VARCHAR(80)  NOT NULL,
      section_name  VARCHAR(255) NOT NULL,
      section_order INT          NOT NULL DEFAULT 1,
      start_page    INT,
      end_page      INT,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      UNIQUE (test_id, section_code)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_booklet_sections_test ON booklet_sections (test_id, section_order)');
  await query(`
    CREATE TABLE IF NOT EXISTS booklet_questions (
      id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      test_id                 UUID        NOT NULL REFERENCES booklet_tests(id) ON DELETE CASCADE,
      section_id              UUID        REFERENCES booklet_sections(id) ON DELETE CASCADE,
      section_question_number INT,
      global_question_order   INT,
      question_number         INT,
      image_path              TEXT        NOT NULL,
      correct_answer          CHAR(1)     CHECK (correct_answer IN ('A','B','C','D','E')),
      choices                 JSONB       NOT NULL DEFAULT '["A","B","C","D","E"]'::jsonb,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES booklet_sections(id) ON DELETE CASCADE');
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS section_question_number INT');
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS global_question_order INT');
  try { await query('ALTER TABLE booklet_questions DROP CONSTRAINT IF EXISTS booklet_questions_test_id_question_number_key'); } catch {}
  await query('CREATE INDEX IF NOT EXISTS idx_booklet_questions_test ON booklet_questions (test_id, global_question_order)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_booklet_questions_section_unique ON booklet_questions (test_id, section_id, section_question_number) WHERE section_id IS NOT NULL AND section_question_number IS NOT NULL');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_booklet_questions_global_unique ON booklet_questions (test_id, global_question_order) WHERE global_question_order IS NOT NULL');
}
