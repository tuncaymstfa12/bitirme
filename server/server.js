import http from 'node:http';
import { execFile as execFileCallback } from 'node:child_process';
import { scrypt as scryptCallback, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query, getClient } from './db.js';
import { CURRICULUM } from '../src/data/curriculum.js';
import { parseAnswerKeyText } from './bookletImport/answerKeyParser.js';
import { runBookletExtractor, regenerateBookletCrop } from './bookletImport/pythonBridge.js';
import {
  ensureTestStorage,
  getBookletStorageRoot,
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
const BOOKLET_EXAM_TYPES = ['TYT', 'AYT', 'YDT'];
const BOOKLET_QUIZ_SYNC_TTL_MS = 30 * 1000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_FLASH_API_KEY ||
  process.env.GOOGLE_GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.VITE_GEMINI_API_KEY;
const GEMINI_TIMEOUT_MS = Math.max(Number(process.env.GEMINI_TIMEOUT_MS) || 45000, 5000);
let bookletQuizSyncState = {
  promise: null,
  completedAt: 0,
};

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
    if (req.method === 'POST' && path === '/api/questions/auto-tag') {
      return await autoTagQuestions(studentId, req, res);
    }

    const questionAnswerMatch = path.match(/^\/api\/questions\/([a-f0-9-]+)\/answer$/);
    if (questionAnswerMatch && req.method === 'POST') {
      return await answerQuestion(studentId, questionAnswerMatch[1], req, res);
    }

    if (req.method === 'GET' && path === '/api/quiz/booklet-lessons') {
      return await getQuizBookletLessons(studentId, url, res);
    }
    if (req.method === 'GET' && path === '/api/quiz/booklet-branches') {
      return await getQuizBookletBranches(studentId, url, res);
    }
    if (req.method === 'GET' && path === '/api/quiz/booklet-topics') {
      return await getQuizBookletTopics(studentId, url, res);
    }
    if (req.method === 'GET' && path === '/api/quiz/booklet-topic-stats') {
      return await getBookletTopicStats(studentId, url, res);
    }
    if (req.method === 'GET' && path === '/api/quiz/booklet-questions') {
      return await getQuizBookletQuestions(studentId, url, res);
    }

    const quizBookletAnswerMatch = path.match(/^\/api\/quiz\/booklet-questions\/([a-f0-9-]+)\/answer$/);
    if (quizBookletAnswerMatch && req.method === 'POST') {
      return await answerQuizBookletQuestion(studentId, quizBookletAnswerMatch[1], req, res);
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
    if (bookletTestMatch) {
      if (req.method === 'GET') return await getBookletTest(bookletTestMatch[1], res);
      if (req.method === 'DELETE') return await deleteBookletTest(bookletTestMatch[1], res);
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

    const bookletAutoTagMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/auto-tag$/);
    if (bookletAutoTagMatch && req.method === 'POST') {
      return await autoTagBookletTest(bookletAutoTagMatch[1], req, res);
    }

    const bookletFinalizeMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/finalize$/);
    if (bookletFinalizeMatch && req.method === 'POST') {
      return await finalizeBookletTest(bookletFinalizeMatch[1], res);
    }

    const bookletQuestionsMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/questions$/);
    if (bookletQuestionsMatch && req.method === 'GET') {
      return await getBookletQuestions(bookletQuestionsMatch[1], res);
    }

    const bookletQuestionDeleteMatch = path.match(/^\/api\/admin\/booklet-tests\/([a-f0-9-]+)\/questions\/([a-f0-9-]+)$/);
    if (bookletQuestionDeleteMatch && req.method === 'DELETE') {
      return await deleteBookletQuestion(bookletQuestionDeleteMatch[1], bookletQuestionDeleteMatch[2], res);
    }

    // Settings
    if (req.method === 'GET' && path === '/api/settings') return await getSettings(studentId, res);
    if (req.method === 'PUT' && path === '/api/settings') return await updateSettings(studentId, req, res);

    if (req.method === 'GET' && path === '/api/profile') return await getProfile(studentId, res);
    if (req.method === 'PUT' && path === '/api/profile') return await updateProfile(studentId, req, res);
    console.warn(`Unhandled route: ${req.method} ${path}`);
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
    `INSERT INTO topics (exam_id, student_id, name, exam_type, track, lesson, weight, self_assessment, estimated_minutes, completed_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [body.examId, studentId, body.name, body.examType || 'TYT', body.track || 'sayisal', body.lesson || '', body.weight || 5, body.selfAssessment || 3, body.estimatedMinutes || 60, body.completedMinutes || 0]
  );
  return sendJson(res, 201, mapTopic(rows[0]));
}

async function updateTopic(studentId, id, req, res) {
  const body = await readJsonBody(req);
  const fields = [];
  const values = [];
  let n = 1;
  for (const [key, col] of [['examId','exam_id'], ['name','name'], ['examType','exam_type'], ['track','track'], ['lesson','lesson'], ['weight','weight'], ['selfAssessment','self_assessment'], ['estimatedMinutes','estimated_minutes'], ['completedMinutes','completed_minutes']]) {
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

async function autoTagQuestions(studentId, req, res) {
  if (!GEMINI_API_KEY) {
    return sendJson(res, 503, { error: 'Gemini API anahtarı tanımlı değil. GEMINI_API_KEY env variable ekleyin.' });
  }

  const body = await readJsonBody(req);
  const questionIds = Array.isArray(body.questionIds)
    ? body.questionIds.map(id => String(id)).filter(Boolean)
    : [];
  const overwrite = body.overwrite === true;
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

  const { rows } = await getQuestionRows(studentId, {});
  const idFilter = questionIds.length ? new Set(questionIds) : null;
  const candidates = rows
    .map(mapQuestion)
    .filter(question => !idFilter || idFilter.has(question.id))
    .filter(question => overwrite || !question.lesson || !question.topicName)
    .slice(0, limit);

  if (candidates.length === 0) {
    return sendJson(res, 200, { success: true, analyzed: 0, updated: 0, skipped: 0, updatedQuestions: [], results: [] });
  }

  const rawResults = [];
  const batchSize = 10;
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const analyzed = await analyzeQuestionTagsWithGemini(batch);
    rawResults.push(...analyzed);
  }

  const questionById = new Map(candidates.map(question => [question.id, question]));
  const updatedIds = [];
  const results = [];

  for (const raw of rawResults) {
    const question = questionById.get(String(raw.id || ''));
    if (!question) continue;

    const normalized = normalizeGeminiTag(raw, question);
    if (!normalized.valid) {
      results.push({ id: question.id, updated: false, reason: normalized.reason });
      continue;
    }

    await query(
      `UPDATE questions
       SET exam_type = $1, track = $2, lesson = $3, topic_name = $4, difficulty = $5
       WHERE id = $6 AND student_id = $7`,
      [
        normalized.examType,
        normalized.track,
        normalized.lesson,
        normalized.topicName,
        normalized.difficulty,
        question.id,
        studentId,
      ]
    );
    updatedIds.push(question.id);
    results.push({
      id: question.id,
      updated: true,
      examType: normalized.examType,
      track: normalized.track,
      lesson: normalized.lesson,
      topicName: normalized.topicName,
      difficulty: normalized.difficulty,
      confidence: normalized.confidence,
    });
  }

  const updatedRows = updatedIds.length
    ? await getQuestionRows(studentId, { ids: updatedIds })
    : { rows: [] };

  return sendJson(res, 200, {
    success: true,
    analyzed: candidates.length,
    updated: updatedIds.length,
    skipped: candidates.length - updatedIds.length,
    updatedQuestions: mapQuestions(updatedRows.rows),
    results,
  });
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

async function getQuizBookletLessons(studentId, url, res) {
  const examType = String(url.searchParams.get('examType') || '').toUpperCase();
  if (!BOOKLET_EXAM_TYPES.includes(examType)) {
    return sendJson(res, 400, { error: 'Geçerli bir sınav türü seçiniz.' });
  }

  let rows = await getQuizBookletLessonRows(studentId, examType);
  if (!rows.length) {
    await syncBookletQuizInventory(true);
    rows = await getQuizBookletLessonRows(studentId, examType);
  }

  return sendJson(res, 200, rows.map(mapQuizBookletLesson));
}

async function getQuizBookletTopics(studentId, url, res) {
  const examType = String(url.searchParams.get('examType') || '').toUpperCase();
  if (!BOOKLET_EXAM_TYPES.includes(examType)) {
    return sendJson(res, 400, { error: 'Geçerli bir sınav türü seçiniz.' });
  }

  let rows = await getQuizBookletTopicRows(studentId, examType);
  if (!rows.length) {
    await syncBookletQuizInventory(true);
    rows = await getQuizBookletTopicRows(studentId, examType);
  }

  return sendJson(res, 200, rows.map(mapQuizBookletTopic));
}

async function getQuizBookletBranches(studentId, url, res) {
  const examType = String(url.searchParams.get('examType') || '').toUpperCase();
  if (!BOOKLET_EXAM_TYPES.includes(examType)) {
    return sendJson(res, 400, { error: 'Geçerli bir sınav türü seçiniz.' });
  }

  let rows = await getQuizBookletBranchRows(studentId, examType);
  if (!rows.length) {
    await syncBookletQuizInventory(true);
    rows = await getQuizBookletBranchRows(studentId, examType);
  }

  return sendJson(res, 200, rows.map(mapQuizBookletBranch));
}

async function getBookletTopicStats(studentId, url, res) {
  const examType = String(url.searchParams.get('examType') || '').toUpperCase();
  if (examType && !BOOKLET_EXAM_TYPES.includes(examType)) {
    return sendJson(res, 400, { error: 'Geçerli bir sınav türü seçiniz.' });
  }

  await syncBookletQuizInventory();
  const rows = await getBookletTopicStatRows(studentId, examType);
  return sendJson(res, 200, rows.map(mapBookletTopicStat));
}

async function getQuizBookletQuestions(studentId, url, res) {
  const examType = String(url.searchParams.get('examType') || '').toUpperCase();
  const lessonKey = String(url.searchParams.get('lessonKey') || '').trim();
  const branchKey = String(url.searchParams.get('branchKey') || '').trim();
  const topicKey = String(url.searchParams.get('topicKey') || '').trim();
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 10) || 10));

  if (!BOOKLET_EXAM_TYPES.includes(examType)) {
    return sendJson(res, 400, { error: 'Geçerli bir sınav türü seçiniz.' });
  }
  if (!lessonKey && !branchKey && !topicKey) {
    return sendJson(res, 400, { error: 'Geçerli bir branş veya konu seçiniz.' });
  }

  let rows = await getFilteredQuizBookletQuestionRows(studentId, examType, { lessonKey, branchKey, topicKey }, limit);
  if (rows.length < limit) {
    await syncBookletQuizInventory(true);
    rows = await getFilteredQuizBookletQuestionRows(studentId, examType, { lessonKey, branchKey, topicKey }, limit);
  }

  if (rows.length < limit) {
    return sendJson(res, 409, { error: 'Bu filtre için en az ' + limit + ' yeni soru yok.' });
  }

  return sendJson(res, 200, rows.map(row => mapQuizBookletQuestion(row)));
}

async function answerQuizBookletQuestion(studentId, questionId, req, res) {
  const body = await readJsonBody(req);
  const selectedOption = String(body.selectedOption || '').toUpperCase();
  if (!['A', 'B', 'C', 'D', 'E'].includes(selectedOption)) {
    return sendJson(res, 400, { error: 'Geçerli bir şık seçiniz.' });
  }

  const { rows: questionRows } = await query(
    `SELECT q.id, q.correct_answer, q.choices
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     WHERE q.id = $1
       AND bt.exam_type IN ('TYT', 'AYT', 'YDT')`,
    [questionId]
  );
  if (!questionRows.length) {
    return sendJson(res, 404, { error: 'Soru bulunamadı.' });
  }

  const validChoices = Array.isArray(questionRows[0].choices) && questionRows[0].choices.length
    ? questionRows[0].choices.map(choice => String(choice || '').toUpperCase())
    : ['A', 'B', 'C', 'D', 'E'];
  if (!validChoices.includes(selectedOption)) {
    return sendJson(res, 400, { error: 'Bu soru için geçerli bir şık seçiniz.' });
  }

  const isCorrect = selectedOption === String(questionRows[0].correct_answer || '').toUpperCase();
  const { rows } = await query(
    `INSERT INTO student_booklet_answers
      (student_id, booklet_question_id, selected_option, is_correct)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id, booklet_question_id)
     DO UPDATE SET
       selected_option = EXCLUDED.selected_option,
       is_correct = EXCLUDED.is_correct,
       answered_at = now()
     RETURNING *`,
    [studentId, questionId, selectedOption, isCorrect]
  );

  return sendJson(res, 200, mapBookletQuizAnswer(rows[0]));
}

async function getQuizBookletLessonRows(studentId, examType) {
  const { rows } = await query(
    `SELECT
       s.section_code,
       s.section_name,
       COUNT(*) FILTER (WHERE sba.id IS NULL) AS available_count
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     JOIN booklet_sections s ON s.id = q.section_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $2
     WHERE bt.exam_type = $1
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
     GROUP BY s.section_code, s.section_name
     ORDER BY s.section_name`,
    [examType, studentId]
  );
  return rows;
}

async function getQuizBookletTopicRows(studentId, examType) {
  const { rows } = await query(
    `SELECT
       bt.exam_type,
       q.lesson,
       q.topic_name,
       COUNT(*) FILTER (WHERE sba.id IS NULL) AS available_count,
       COUNT(*) AS total_count
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $2
     WHERE bt.exam_type = $1
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
       AND coalesce(q.lesson, '') <> ''
       AND coalesce(q.topic_name, '') <> ''
     GROUP BY bt.exam_type, q.lesson, q.topic_name
     HAVING COUNT(*) FILTER (WHERE sba.id IS NULL) > 0
     ORDER BY q.lesson, q.topic_name`,
    [examType, studentId]
  );
  return rows;
}

async function getQuizBookletBranchRows(studentId, examType) {
  const { rows } = await query(
    `SELECT
       bt.exam_type,
       q.lesson,
       COUNT(*) FILTER (WHERE sba.id IS NULL) AS available_count,
       COUNT(*) AS total_count
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $2
     WHERE bt.exam_type = $1
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
       AND coalesce(q.lesson, '') <> ''
     GROUP BY bt.exam_type, q.lesson
     HAVING COUNT(*) FILTER (WHERE sba.id IS NULL) > 0
     ORDER BY q.lesson`,
    [examType, studentId]
  );
  return rows;
}

async function getBookletTopicStatRows(studentId, examType = '') {
  const values = [studentId];
  const examCondition = examType ? 'AND bt.exam_type = $2' : '';
  if (examType) values.push(examType);

  const { rows } = await query(
    `SELECT
       bt.exam_type,
       q.lesson,
       q.topic_name,
       COUNT(*) AS total_count,
       COUNT(*) FILTER (WHERE sba.id IS NULL) AS available_count,
       COUNT(sba.id) AS answered_count,
       COUNT(*) FILTER (WHERE sba.is_correct = true) AS correct_count,
       COUNT(*) FILTER (WHERE sba.is_correct = false) AS wrong_count
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $1
     WHERE bt.exam_type IN ('TYT', 'AYT', 'YDT')
       ${examCondition}
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
       AND coalesce(q.lesson, '') <> ''
       AND coalesce(q.topic_name, '') <> ''
     GROUP BY bt.exam_type, q.lesson, q.topic_name
     ORDER BY bt.exam_type, q.lesson, q.topic_name`,
    values
  );
  return rows;
}

async function getFilteredQuizBookletQuestionRows(studentId, examType, filters, limit) {
  if (filters.topicKey) {
    return await getQuizBookletQuestionRowsByTopic(studentId, examType, filters.topicKey, limit);
  }
  if (filters.branchKey) {
    return await getQuizBookletQuestionRowsByBranch(studentId, examType, filters.branchKey, limit);
  }
  return await getQuizBookletQuestionRows(studentId, examType, filters.lessonKey, limit);
}

async function getQuizBookletQuestionRows(studentId, examType, lessonKey, limit) {
  const { rows } = await query(
    `SELECT
       q.id,
       q.test_id,
       s.section_code,
       s.section_name,
       s.section_order,
       q.section_question_number,
       q.global_question_order,
       q.image_path,
       q.correct_answer,
       q.choices,
       q.lesson,
       q.topic_name,
       q.created_at,
       bt.exam_type
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     JOIN booklet_sections s ON s.id = q.section_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $3
     WHERE bt.exam_type = $1
       AND s.section_code = $2
       AND sba.id IS NULL
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
     ORDER BY random()
     LIMIT $4`,
    [examType, lessonKey, studentId, limit]
  );
  return rows;
}

async function getQuizBookletQuestionRowsByTopic(studentId, examType, topicKey, limit) {
  const { lesson, topicName } = parseTopicKey(topicKey);
  if (!lesson || !topicName) return [];

  const { rows } = await query(
    `SELECT
       q.id,
       q.test_id,
       s.section_code,
       s.section_name,
       s.section_order,
       q.section_question_number,
       q.global_question_order,
       q.image_path,
       q.correct_answer,
       q.choices,
       q.lesson,
       q.topic_name,
       q.created_at,
       bt.exam_type
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     JOIN booklet_sections s ON s.id = q.section_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $4
     WHERE bt.exam_type = $1
       AND q.lesson = $2
       AND q.topic_name = $3
       AND sba.id IS NULL
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
     ORDER BY random()
     LIMIT $5`,
    [examType, lesson, topicName, studentId, limit]
  );
  return rows;
}

async function getQuizBookletQuestionRowsByBranch(studentId, examType, branchKey, limit) {
  const lesson = String(branchKey || '').trim();
  if (!lesson) return [];

  const { rows } = await query(
    `SELECT
       q.id,
       q.test_id,
       s.section_code,
       s.section_name,
       s.section_order,
       q.section_question_number,
       q.global_question_order,
       q.image_path,
       q.correct_answer,
       q.choices,
       q.lesson,
       q.topic_name,
       q.created_at,
       bt.exam_type
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     JOIN booklet_sections s ON s.id = q.section_id
     LEFT JOIN student_booklet_answers sba
       ON sba.booklet_question_id = q.id AND sba.student_id = $3
     WHERE bt.exam_type = $1
       AND q.lesson = $2
       AND sba.id IS NULL
       AND q.image_path <> ''
       AND q.correct_answer IS NOT NULL
     ORDER BY random()
     LIMIT $4`,
    [examType, lesson, studentId, limit]
  );
  return rows;
}

async function getQuestionRows(studentId, filters = {}) {
  const conditions = ['q.student_id = $1'];
  const values = [studentId];
  let n = 2;

  if (filters.id) {
    conditions.push(`q.id = $${n++}`);
    values.push(filters.id);
  }
  if (Array.isArray(filters.ids) && filters.ids.length) {
    conditions.push(`q.id = ANY($${n++}::uuid[])`);
    values.push(filters.ids);
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

async function analyzeQuestionTagsWithGemini(questions) {
  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(GEMINI_MODEL) +
    ':generateContent?key=' +
    encodeURIComponent(GEMINI_API_KEY);

  const response = await fetchGeminiWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildGeminiTagPrompt(questions) }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = await response.json();
      detail = errorBody.error?.message || '';
    } catch {
      detail = await response.text();
    }
    throw httpError(response.status, 'Gemini etiketleme hatası: ' + (detail || response.statusText));
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
  const parsed = parseJsonObject(text);
  return Array.isArray(parsed?.tags) ? parsed.tags : [];
}

async function analyzeBookletQuestionTagsWithGemini(questions) {
  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(GEMINI_MODEL) +
    ':generateContent?key=' +
    encodeURIComponent(GEMINI_API_KEY);

  const parts = [{ text: buildBookletGeminiTagPrompt(questions) }];
  questions.forEach(question => {
    parts.push({
      text: 'Soru ID: ' + question.id + ', soru no: ' + (question.questionNo || '-') + ', bolum: ' + question.sectionName,
    });
    parts.push({
      inlineData: {
        mimeType: question.mimeType || 'image/png',
        data: question.imageBase64,
      },
    });
  });

  const response = await fetchGeminiWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = await response.json();
      detail = errorBody.error?.message || '';
    } catch {
      detail = await response.text();
    }
    throw httpError(response.status, 'Gemini booklet tagleme hatası: ' + (detail || response.statusText));
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
  const parsed = parseJsonObject(text);
  return Array.isArray(parsed?.tags) ? parsed.tags : [];
}

async function fetchGeminiWithTimeout(endpoint, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    return await fetch(endpoint, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw httpError(504, 'Gemini ' + Math.round(GEMINI_TIMEOUT_MS / 1000) + ' saniye içinde yanıt vermedi. Model, API key veya sunucunun internet erişimini kontrol edin.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildBookletGeminiTagPrompt(questions) {
  const allowedTopics = questions[0]?.allowedTopics || [];
  const payload = questions.map(question => ({
    id: question.id,
    examType: question.examType,
    sectionName: question.sectionName,
    questionNo: question.questionNo,
    correctOption: question.correctOption,
    choices: question.choices,
  }));

  return [
    'Sen Turkiye MEB lise/YKS mufredatina gore gorsel soru etiketleyen bir asistansin.',
    'Her soru icin ONCE allowedTopics listesini oku.',
    'lesson ve topicName alanlarini yalnizca allowedTopics listesindeki degerlerden birebir kopyala.',
    'allowedTopics disinda ders veya konu uretme; emin degilsen listedeki en yakin ust konuyu sec ve confidence dusuk ver.',
    'Soru metni gorselde olabilir; gorseli okuyup ders ve konuyu belirle.',
    'track alanini selected allowedTopics kaydindaki track degeri olarak yaz.',
    'difficulty 1-5 arasinda tam sayi olsun. confidence 0-1 arasinda sayi olsun.',
    'Cevabinda allowedTopics disinda konu olursa sistem reddedecek.',
    'Sadece su JSON semasinda yanit ver: {"tags":[{"id":"...","examType":"TYT|AYT|YDT","track":"tyt|sayisal|esit_agirlik|sozel|dil","lesson":"...","topicName":"...","difficulty":3,"confidence":0.8,"reason":"kisa neden"}]}',
    'Allowed topics:',
    JSON.stringify(allowedTopics),
    'Soru metadata:',
    JSON.stringify(payload),
  ].join('\n');
}

async function mapBookletQuestionForGemini(row) {
  const imagePath = normalizeBookletImagePath(row.image_path);
  const filePath = path.resolve(getTestDir(row.test_id), imagePath);
  let imageBase64 = '';
  try {
    imageBase64 = (await readFile(filePath)).toString('base64');
  } catch {
    imageBase64 = '';
  }

  return {
    id: row.id,
    examType: String(row.exam_type || 'TYT').toUpperCase(),
    track: '',
    lesson: row.lesson || '',
    topicName: row.topic_name || '',
    difficulty: row.difficulty || 3,
    sectionName: row.section_name || row.section_code || '',
    questionNo: row.section_question_number || row.global_question_order || null,
    correctOption: row.correct_answer || '',
    choices: Array.isArray(row.choices) ? row.choices : ['A', 'B', 'C', 'D', 'E'],
    allowedTopics: getAllowedBookletTopics(
      String(row.exam_type || 'TYT').toUpperCase(),
      row.section_name || row.section_code || '',
      row.section_question_number || row.global_question_order || null
    ),
    imageBase64,
    mimeType: getImageMimeType(imagePath),
  };
}

function getImageMimeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function getAllowedBookletTopics(examType, sectionName = '', questionNo = null) {
  const lessonFilter = inferBookletLessonFilter(examType, sectionName, questionNo);
  if (examType === 'TYT') {
    return flattenCurriculumTopics('TYT', ['tyt'], lessonFilter);
  }

  if (examType === 'AYT') {
    return flattenCurriculumTopics('AYT', ['sayisal', 'esit_agirlik', 'sozel', 'dil'], lessonFilter);
  }

  if (examType === 'YDT') {
    return flattenCurriculumTopics('YDT', ['dil'], lessonFilter);
  }

  return [];
}

function inferBookletLessonFilter(examType, sectionName, questionNo) {
  const normalized = removeTurkishMarks(String(sectionName || '').toLowerCase());
  const no = Number(questionNo || 0);

  if (examType === 'TYT') {
    if (normalized.includes('turkce')) return ['Türkçe'];
    if (normalized.includes('matematik')) return ['Matematik'];
    if (normalized.includes('fen')) {
      if (no >= 1 && no <= 7) return ['Fizik'];
      if (no >= 8 && no <= 14) return ['Kimya'];
      if (no >= 15) return ['Biyoloji'];
      return ['Fizik', 'Kimya', 'Biyoloji'];
    }
    if (normalized.includes('sosyal')) {
      if (no >= 1 && no <= 5) return ['Tarih'];
      if (no >= 6 && no <= 10) return ['Coğrafya'];
      if (no >= 11 && no <= 15) return ['Felsefe'];
      if (no >= 16) return ['Din Kültürü'];
      return ['Tarih', 'Coğrafya', 'Felsefe', 'Din Kültürü'];
    }
  }

  if (examType === 'AYT') {
    if (normalized.includes('matematik')) return ['Matematik'];
    if (normalized.includes('fen')) {
      if (no >= 1 && no <= 14) return ['Fizik'];
      if (no >= 15 && no <= 27) return ['Kimya'];
      if (no >= 28) return ['Biyoloji'];
      return ['Fizik', 'Kimya', 'Biyoloji'];
    }
    if (normalized.includes('sosyal') && normalized.includes('2')) {
      if (no >= 1 && no <= 11) return ['Tarih-2'];
      if (no >= 12 && no <= 17) return ['Coğrafya-2'];
      if (no >= 18 && no <= 29) return ['Felsefe Grubu'];
      if (no >= 40 && no <= 45) return ['Felsefe Grubu'];
      if (no >= 30) return ['Din Kültürü'];
      return ['Tarih-2', 'Coğrafya-2', 'Felsefe Grubu', 'Din Kültürü'];
    }
    if (normalized.includes('edebiyat') || normalized.includes('sosyal')) {
      if (no >= 1 && no <= 24) return ['Türk Dili ve Edebiyatı'];
      if (no >= 25 && no <= 34) return ['Tarih-1'];
      if (no >= 35) return ['Coğrafya-1'];
      return ['Türk Dili ve Edebiyatı', 'Tarih-1', 'Coğrafya-1'];
    }
  }

  if (examType === 'YDT') return ['İngilizce', 'Almanca', 'Fransızca', 'Arapça'];
  return null;
}

function flattenCurriculumTopics(examType, tracks, lessonFilter = null) {
  const allowed = [];
  const seen = new Set();

  if (examType === 'TYT') {
    for (const [lesson, topics] of Object.entries(CURRICULUM.TYT || {})) {
      if (lessonFilter && !lessonFilter.includes(lesson)) continue;
      for (const topicName of topics) {
        const key = 'TYT|tyt|' + lesson + '|' + topicName;
        if (seen.has(key)) continue;
        seen.add(key);
        allowed.push({ examType: 'TYT', track: 'tyt', lesson, topicName });
      }
    }
    return allowed;
  }

  const curriculumExamType = examType === 'YDT' ? 'AYT' : examType;
  for (const track of tracks) {
    const lessons = CURRICULUM[curriculumExamType]?.[track] || {};
    for (const [lesson, topics] of Object.entries(lessons)) {
      if (lessonFilter && !lessonFilter.includes(lesson)) continue;
      for (const topicName of topics) {
        const key = examType + '|' + track + '|' + lesson + '|' + topicName;
        if (seen.has(key)) continue;
        seen.add(key);
        allowed.push({ examType, track, lesson, topicName });
      }
    }
  }

  return allowed;
}

function normalizeBookletGeminiTag(raw, question) {
  const lesson = String(raw.lesson || '').trim();
  const topicName = String(raw.topicName || '').trim();
  const confidence = Number(raw.confidence) || 0;
  const difficulty = Math.min(Math.max(Number(raw.difficulty) || question.difficulty || 3, 1), 5);
  const allowed = question.allowedTopics || [];
  const match = findAllowedTopicMatch(lesson, topicName, allowed);

  if (!match) {
    return { valid: false, reason: 'Konu seçilen sınav türünün MEB/YKS konu listesinde yok: ' + lesson + ' / ' + topicName };
  }
  if (confidence < 0.35) {
    return { valid: false, reason: 'Gemini güven skoru düşük.' };
  }

  return {
    valid: true,
    examType: match.examType,
    track: match.track,
    lesson: match.lesson,
    topicName: match.topicName,
    difficulty: Math.round(difficulty),
    confidence,
  };
}

function findAllowedTopicMatch(lesson, topicName, allowed) {
  if (!allowed.length) return null;

  const exact = allowed.find(item => item.lesson === lesson && item.topicName === topicName);
  if (exact) return exact;

  const normalizedLesson = normalizeMatchText(lesson);
  const normalizedTopic = normalizeMatchText(topicName);
  const lessonMatches = allowed.filter(item => normalizeMatchText(item.lesson) === normalizedLesson);
  const candidates = lessonMatches.length ? lessonMatches : allowed;

  const normalizedExact = candidates.find(item => normalizeMatchText(item.topicName) === normalizedTopic);
  if (normalizedExact) return normalizedExact;

  let best = null;
  let bestScore = 0;
  for (const item of candidates) {
    const score = topicSimilarityScore(topicName, item.topicName);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  if (best && bestScore >= 0.28) return best;

  const uniqueLessons = new Set(allowed.map(item => item.lesson));
  if (uniqueLessons.size === 1 && topicName) return candidates[0] || allowed[0];

  return null;
}

function topicSimilarityScore(left, right) {
  const leftWords = tokenizeTopic(left);
  const rightWords = tokenizeTopic(right);
  if (!leftWords.length || !rightWords.length) return 0;

  let overlap = 0;
  for (const leftWord of leftWords) {
    if (rightWords.some(rightWord => rightWord === leftWord || rightWord.includes(leftWord) || leftWord.includes(rightWord))) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftWords.length, rightWords.length);
}

function normalizeMatchText(value) {
  return removeTurkishMarks(String(value || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildGeminiTagPrompt(questions) {
  const payload = questions.map(question => ({
    id: question.id,
    current: {
      examType: question.examType,
      track: question.track,
      lesson: question.lesson,
      topicName: question.topicName,
      difficulty: question.difficulty,
    },
    questionNo: question.questionNo,
    questionText: question.questionText,
    options: (question.options || []).map(option => ({
      key: option.optionKey,
      text: option.optionText,
    })),
    correctOption: question.correctOption,
    explanation: question.explanation,
    sourceName: question.sourceName,
    sourceYear: question.sourceYear,
  }));

  return [
    'Sen Turkiye MEB lise/YKS mufredatina gore soru etiketleyen bir asistansin.',
    'Her soru icin yalnizca verilen mufredat listesindeki examType, track, lesson ve topicName degerlerinden secim yap.',
    'TYT icin track alaninda sorunun mevcut track degerini koruyabilirsin. AYT icin track mutlaka mufredatta olan alanlardan biri olmali.',
    'difficulty 1-5 arasinda tam sayi olsun. confidence 0-1 arasinda sayi olsun.',
    'Emin degilsen en yakin ust konuya secim yap, fakat confidence 0.55 altina dusuyorsa belirt.',
    'Sadece su JSON semasinda yanit ver: {"tags":[{"id":"...","examType":"TYT|AYT","track":"sayisal|esit_agirlik|sozel|dil","lesson":"...","topicName":"...","difficulty":3,"confidence":0.8,"reason":"kisa neden"}]}',
    'Mufredat:',
    JSON.stringify(CURRICULUM),
    'Sorular:',
    JSON.stringify(payload),
  ].join('\n');
}

function parseJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw httpError(502, 'Gemini yanıtı JSON olarak okunamadı.');
  }
}

function normalizeGeminiTag(raw, question) {
  const examType = String(raw.examType || question.examType || 'TYT').toUpperCase();
  const track = String(raw.track || question.track || 'sayisal');
  const lesson = String(raw.lesson || '').trim();
  const topicName = String(raw.topicName || '').trim();
  const difficulty = Math.min(Math.max(Number(raw.difficulty) || question.difficulty || 3, 1), 5);
  const confidence = Number(raw.confidence) || 0;

  if (!['TYT', 'AYT'].includes(examType)) {
    return { valid: false, reason: 'Geçersiz sınav türü.' };
  }
  if (confidence < 0.55) {
    return { valid: false, reason: 'Gemini güven skoru düşük.' };
  }

  const validTopics = getCurriculumTopics(examType, track, lesson);
  if (!validTopics.length) {
    return { valid: false, reason: 'Ders müfredatta bulunamadı.' };
  }
  if (!validTopics.includes(topicName)) {
    return { valid: false, reason: 'Konu müfredatta bulunamadı.' };
  }

  return {
    valid: true,
    examType,
    track,
    lesson,
    topicName,
    difficulty: Math.round(difficulty),
    confidence,
  };
}

function getCurriculumTopics(examType, track, lesson) {
  if (examType === 'TYT') return CURRICULUM.TYT[lesson] || [];
  return CURRICULUM.AYT[track]?.[lesson] || [];
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

async function deleteBookletTest(testId, res) {
  const { rows } = await query('DELETE FROM booklet_tests WHERE id = $1 RETURNING id', [testId]);
  if (!rows.length) return sendJson(res, 404, { error: 'Test bulunamadı.' });
  await rm(getTestDir(testId), { recursive: true, force: true });
  return sendJson(res, 200, { success: true });
}

async function createBookletTest(req, res) {
  const body = await readJsonBody(req);
  const title = String(body.title || '').trim();
  const examType = String(body.examType || '').trim().toUpperCase();
  const bookletType = String(body.bookletType || '').trim();

  if (!title) return sendJson(res, 400, { error: 'Test başlığı gereklidir.' });
  if (!BOOKLET_EXAM_TYPES.includes(examType)) {
    return sendJson(res, 400, { error: 'Geçerli sınav türü seçiniz.' });
  }

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
  const { rows } = await query('SELECT id, title, exam_type, booklet_type, status FROM booklet_tests WHERE id = $1', [testId]);
  if (!rows.length) return sendJson(res, 404, { error: 'Test bulunamadı.' });
  let review;
  try {
    review = await readReview(testId);
  } catch {
    return sendJson(res, 404, { error: 'Bu test icin henuz review dosyasi olusturulmadi.' });
  }
  const test = rows[0];
  return sendJson(res, 200, buildReviewResponse(testId, {
    ...review,
    title: review.title || test.title,
    examType: review.examType || test.exam_type,
    bookletType: review.bookletType || test.booklet_type,
    status: test.status || review.status,
  }));
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

async function autoTagBookletTest(testId, req, res) {
  if (!GEMINI_API_KEY) {
    return sendJson(res, 503, { error: 'Gemini API anahtarı tanımlı değil. GEMINI_API_KEY env variable ekleyin.' });
  }

  const startedAt = Date.now();
  console.log(`Gemini booklet auto-tag started testId=${testId} model=${GEMINI_MODEL}`);
  await ensureBookletTestExists(testId);
  const body = await readJsonBody(req);
  const overwrite = body.overwrite === true;
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 25);
  const batchSize = Math.min(Math.max(Number(body.batchSize) || 1, 1), 3);
  const excludeIds = new Set(
    Array.isArray(body.excludeQuestionIds)
      ? body.excludeQuestionIds.map(id => String(id)).filter(Boolean)
      : []
  );

  const { rows: testRows } = await query('SELECT id, exam_type FROM booklet_tests WHERE id = $1', [testId]);
  const examType = String(testRows[0]?.exam_type || '').toUpperCase();
  if (!['TYT', 'AYT', 'YDT'].includes(examType)) {
    return sendJson(res, 400, { error: 'Gemini tagleme sadece TYT/AYT/YDT booklet testleri için desteklenir.' });
  }

  const { rows } = await query(
    `SELECT q.id, q.test_id, q.section_question_number, q.global_question_order, q.image_path,
            q.correct_answer, q.choices, q.lesson, q.topic_name, q.difficulty,
            s.section_code, s.section_name, s.section_order, bt.exam_type
     FROM booklet_questions q
     JOIN booklet_tests bt ON bt.id = q.test_id
     JOIN booklet_sections s ON s.id = q.section_id
     WHERE q.test_id = $1
     ORDER BY q.global_question_order`,
    [testId]
  );

  const pendingRows = rows
    .filter(row => overwrite || !row.lesson || !row.topic_name)
    .filter(row => !excludeIds.has(String(row.id)));
  const candidateRows = pendingRows.slice(0, limit);
  const candidates = [];
  const unreadable = [];
  for (const row of candidateRows) {
    const mapped = await mapBookletQuestionForGemini(row);
    if (mapped.imageBase64) {
      candidates.push(mapped);
    } else {
      unreadable.push(row.id);
    }
  }

  if (!candidates.length) {
    console.log(`Gemini booklet auto-tag skipped testId=${testId} no readable candidates`);
    const remaining = overwrite
      ? Math.max(pendingRows.length - candidateRows.length, 0)
      : await countUntaggedBookletQuestions(testId);
    return sendJson(res, 200, {
      success: true,
      analyzed: 0,
      updated: 0,
      skipped: unreadable.length,
      remaining,
      hasMore: remaining > 0,
      results: unreadable.map(id => ({ id, updated: false, reason: 'Soru görseli okunamadı.' })),
    });
  }

  const questionById = new Map(candidates.map(question => [question.id, question]));
  const results = [];
  let updated = 0;
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    console.log(`Gemini booklet auto-tag batch testId=${testId} offset=${index} size=${batch.length}`);
    let analyzed = [];
    try {
      analyzed = await analyzeBookletQuestionTagsWithRetry(batch);
    } catch (error) {
      const message = error.expose ? error.message : 'Gemini batch işlenemedi.';
      console.warn(`Gemini booklet auto-tag batch failed testId=${testId} offset=${index}: ${message}`);
      results.push(...batch.map(question => ({ id: question.id, updated: false, reason: message })));
      continue;
    }
    for (const raw of analyzed) {
      const question = questionById.get(String(raw.id || ''));
      if (!question) continue;

      const normalized = normalizeBookletGeminiTag(raw, question);
      if (!normalized.valid) {
        results.push({ id: question.id, updated: false, reason: normalized.reason });
        continue;
      }

      await query(
        `UPDATE booklet_questions
         SET lesson = $1, topic_name = $2, topic_confidence = $3, difficulty = $4
         WHERE id = $5 AND test_id = $6`,
        [
          normalized.lesson,
          normalized.topicName,
          normalized.confidence,
          normalized.difficulty,
          question.id,
          testId,
        ]
      );
      updated += 1;
      results.push({
        id: question.id,
        updated: true,
        lesson: normalized.lesson,
        topicName: normalized.topicName,
        difficulty: normalized.difficulty,
        confidence: normalized.confidence,
      });
    }
    const returnedIds = new Set(analyzed.map(raw => String(raw.id || '')).filter(Boolean));
    for (const question of batch) {
      if (!returnedIds.has(question.id)) {
        results.push({ id: question.id, updated: false, reason: 'Gemini bu soru için tag döndürmedi.' });
      }
    }
    console.log(`Gemini booklet auto-tag batch done testId=${testId} offset=${index} updated=${updated}`);
  }

  const remaining = overwrite
    ? Math.max(pendingRows.length - candidateRows.length, 0)
    : await countUntaggedBookletQuestions(testId);
  console.log(`Gemini booklet auto-tag completed testId=${testId} analyzed=${candidates.length} updated=${updated} remaining=${remaining} ms=${Date.now() - startedAt}`);
  return sendJson(res, 200, {
    success: true,
    analyzed: candidates.length,
    updated,
    skipped: results.filter(result => !result.updated).length + unreadable.length,
    remaining,
    hasMore: remaining > 0,
    results,
  });
}

async function countUntaggedBookletQuestions(testId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
     FROM booklet_questions
     WHERE test_id = $1
       AND (coalesce(lesson, '') = '' OR coalesce(topic_name, '') = '')`,
    [testId]
  );
  return Number(rows[0]?.count || 0);
}

async function analyzeBookletQuestionTagsWithRetry(batch) {
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await analyzeBookletQuestionTagsWithGemini(batch);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt === maxAttempts) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

function isRetryableGeminiError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.statusCode === 429 ||
    error?.statusCode === 503 ||
    message.includes('high demand') ||
    message.includes('try again') ||
    message.includes('timeout') ||
    message.includes('saniye içinde yanıt vermedi');
}

async function finalizeBookletTest(testId, res) {
  await ensureBookletTestExists(testId);
  const review = await readReview(testId);
  const active = getActiveReviewQuestions(review);
  const duplicates = findDuplicateSectionQuestions(active);
  if (duplicates.length) {
    return sendJson(res, 400, { error: 'Aynı bölüm içinde tekrar eden soru numaraları var: ' + duplicates.join(', ') });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await persistBookletReviewSnapshot(client, testId, review, active);
    await client.query('UPDATE booklet_tests SET status = $1 WHERE id = $2', ['finalized', testId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  review.status = 'finalized';
  await writeReview(testId, review);

  return sendJson(res, 200, { success: true, savedCount: active.length });
}

async function getBookletQuestions(testId, res) {
  await ensureBookletTestExists(testId);
  const { rows } = await query(
    `SELECT q.id, q.test_id, q.section_id, s.section_code, s.section_name, s.section_order,
            q.section_question_number, q.global_question_order, q.image_path, q.correct_answer,
            q.choices, q.lesson, q.topic_name, q.topic_confidence, q.difficulty, q.created_at
     FROM booklet_questions q
     JOIN booklet_sections s ON s.id = q.section_id
     WHERE q.test_id = $1
     ORDER BY q.global_question_order`,
    [testId]
  );
  return sendJson(res, 200, rows.map(mapBookletQuestion));
}

async function deleteBookletQuestion(testId, questionId, res) {
  await ensureBookletTestExists(testId);
  const { rows } = await query(
    'DELETE FROM booklet_questions WHERE id = $1 AND test_id = $2 RETURNING id',
    [questionId, testId]
  );
  if (!rows.length) return sendJson(res, 404, { error: 'Soru bulunamadı.' });
  return sendJson(res, 200, { success: true });
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

function getActiveReviewQuestions(review) {
  return (review.detections || [])
    .filter(item => !item.deleted && item.sectionQuestionNumber)
    .sort(sortReviewQuestions)
    .map((question, index) => ({
      ...question,
      globalQuestionOrder: question.globalQuestionOrder || (index + 1),
    }));
}

function dedupeReviewSectionQuestions(activeQuestions) {
  const bestByKey = new Map();
  for (const question of activeQuestions) {
    const key = String(question.sectionCode || 'main') + ':' + String(question.sectionQuestionNumber || '');
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, question);
      continue;
    }

    const existingAnswered = normalizeAnswerOption(existing.correctAnswer) ? 1 : 0;
    const nextAnswered = normalizeAnswerOption(question.correctAnswer) ? 1 : 0;
    const existingConfidence = Number(existing.confidenceScore || 0);
    const nextConfidence = Number(question.confidenceScore || 0);
    if (nextAnswered > existingAnswered || (nextAnswered === existingAnswered && nextConfidence >= existingConfidence)) {
      bestByKey.set(key, question);
    }
  }

  return [...bestByKey.values()]
    .sort(sortReviewQuestions)
    .map((question, index) => ({
      ...question,
      globalQuestionOrder: index + 1,
    }));
}

async function persistBookletReviewSnapshot(client, testId, review, activeQuestions = getActiveReviewQuestions(review)) {
  await client.query('DELETE FROM booklet_sections WHERE test_id = $1', [testId]);
  await client.query('DELETE FROM booklet_questions WHERE test_id = $1', [testId]);

  const sectionIdByCode = new Map();
  for (const section of buildPersistedSections(review, activeQuestions)) {
    const { rows } = await client.query(
      `INSERT INTO booklet_sections (test_id, section_code, section_name, section_order, start_page, end_page)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [testId, section.sectionCode, section.sectionName, section.sectionOrder, section.startPage || null, section.endPage || null]
    );
    sectionIdByCode.set(section.sectionCode, rows[0].id);
  }

  for (const question of activeQuestions) {
    await client.query(
      `INSERT INTO booklet_questions (test_id, section_id, section_question_number, global_question_order, image_path, correct_answer, choices)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        testId,
        sectionIdByCode.get(question.sectionCode),
        question.sectionQuestionNumber,
        question.globalQuestionOrder,
        normalizeBookletImagePath(question.imagePath),
        normalizeAnswerOption(question.correctAnswer),
        JSON.stringify(question.choices || ['A', 'B', 'C', 'D', 'E']),
      ]
    );
  }
}

function normalizeBookletImagePath(imagePath) {
  const value = String(imagePath || '').trim();
  if (!value) return '';
  const match = value.match(/^\/api\/admin\/booklet-tests\/[^/]+\/assets\/(.+)$/);
  return match ? match[1] : value.replace(/^\/+/, '');
}

function resolveBookletImageUrl(testId, imagePath) {
  const value = String(imagePath || '').trim();
  if (!value) return '';
  if (/^(https?:)?\/\//.test(value) || value.startsWith('/api/')) return value;
  return toAssetUrl(testId, value);
}

function normalizeAnswerOption(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['A', 'B', 'C', 'D', 'E'].includes(normalized) ? normalized : null;
}

async function syncBookletQuizInventory(force = false) {
  const now = Date.now();
  if (!force && bookletQuizSyncState.promise) return bookletQuizSyncState.promise;
  if (!force && now - bookletQuizSyncState.completedAt < BOOKLET_QUIZ_SYNC_TTL_MS) return;
  if (bookletQuizSyncState.promise) return bookletQuizSyncState.promise;

  bookletQuizSyncState.promise = (async () => {
    await ensureRecoveredBookletTestsFromStorage();
    const { rows: tests } = await query('SELECT id FROM booklet_tests');
    for (const test of tests) {
      try {
        const review = await readReview(test.id);
        const active = dedupeReviewSectionQuestions(getActiveReviewQuestions(review));
        if (!active.length) continue;

        const expectedAnsweredCount = active.reduce((count, question) => (
          count + (normalizeAnswerOption(question.correctAnswer) ? 1 : 0)
        ), 0);

        const {
          rows: [stats],
        } = await query(
          `SELECT
             COUNT(*)::int AS question_count,
             COUNT(*) FILTER (WHERE correct_answer IS NOT NULL)::int AS answered_count,
             COUNT(*) FILTER (WHERE image_path LIKE '/api/%')::int AS absolute_path_count
           FROM booklet_questions
           WHERE test_id = $1`,
          [test.id]
        );

        const shouldSync =
          Number(stats?.question_count || 0) !== active.length ||
          Number(stats?.answered_count || 0) !== expectedAnsweredCount ||
          Number(stats?.absolute_path_count || 0) > 0;

        if (!shouldSync) continue;

        const client = await getClient();
        try {
          await client.query('BEGIN');
          await persistBookletReviewSnapshot(client, test.id, review, active);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        console.warn(`Skipping booklet sync for ${test.id}: ${error.message}`);
      }
    }
  })();

  try {
    await bookletQuizSyncState.promise;
    bookletQuizSyncState.completedAt = Date.now();
  } finally {
    bookletQuizSyncState.promise = null;
  }
}

async function ensureRecoveredBookletTestsFromStorage() {
  let entries = [];
  try {
    entries = await readdir(getBookletStorageRoot(), { withFileTypes: true });
  } catch {
    return;
  }

  const { rows } = await query('SELECT id FROM booklet_tests');
  const existingIds = new Set(rows.map(row => row.id));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const testId = entry.name;
    if (existingIds.has(testId)) continue;

    try {
      const review = await readReview(testId);
      const examType = normalizeRecoveredExamType(review.examType);
      if (!examType) continue;
      await query(
        `INSERT INTO booklet_tests (id, title, exam_type, booklet_type, pdf_path, review_path, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          testId,
          String(review.title || `${examType} recovered test`).trim(),
          examType,
          String(review.bookletType || '').trim(),
          '',
          getReviewPath(testId),
          String(review.status || 'review').trim() || 'review',
        ]
      );
      existingIds.add(testId);
    } catch (error) {
      console.warn(`Skipping recovered booklet test ${testId}: ${error.message}`);
    }
  }
}

function normalizeRecoveredExamType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return BOOKLET_EXAM_TYPES.includes(normalized) ? normalized : '';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  return {
    id: row.id,
    examId: row.exam_id,
    studentId: row.student_id,
    name: row.name,
    examType: row.exam_type,
    track: row.track,
    lesson: row.lesson,
    weight: row.weight,
    selfAssessment: row.self_assessment,
    estimatedMinutes: row.estimated_minutes,
    completedMinutes: row.completed_minutes,
    createdAt: row.created_at
  };
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

function mapQuizBookletLesson(row) {
  return {
    lessonKey: row.section_code || '',
    lessonName: row.section_name || row.section_code || '',
    availableCount: Number(row.available_count || 0),
  };
}

function makeTopicKey(lesson, topicName) {
  return String(lesson || '') + '|||' + String(topicName || '');
}

function parseTopicKey(topicKey) {
  const parts = String(topicKey || '').split('|||');
  return {
    lesson: String(parts[0] || '').trim(),
    topicName: String(parts.slice(1).join('|||') || '').trim(),
  };
}

function mapQuizBookletTopic(row) {
  return {
    topicKey: makeTopicKey(row.lesson, row.topic_name),
    examType: row.exam_type || '',
    lesson: row.lesson || '',
    topicName: row.topic_name || '',
    availableCount: Number(row.available_count || 0),
    totalCount: Number(row.total_count || 0),
  };
}

function mapQuizBookletBranch(row) {
  return {
    branchKey: row.lesson || '',
    examType: row.exam_type || '',
    lesson: row.lesson || '',
    availableCount: Number(row.available_count || 0),
    totalCount: Number(row.total_count || 0),
  };
}

function mapBookletTopicStat(row) {
  const answeredCount = Number(row.answered_count || 0);
  const correctCount = Number(row.correct_count || 0);
  const wrongCount = Number(row.wrong_count || 0);
  return {
    topicKey: makeTopicKey(row.lesson, row.topic_name),
    examType: row.exam_type || '',
    lesson: row.lesson || '',
    topicName: row.topic_name || '',
    totalCount: Number(row.total_count || 0),
    availableCount: Number(row.available_count || 0),
    answeredCount,
    correctCount,
    wrongCount,
    successRate: answeredCount ? Math.round((correctCount / answeredCount) * 1000) / 10 : null,
  };
}

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
    imagePath: resolveBookletImageUrl(row.test_id, row.image_path),
    correctAnswer: row.correct_answer || '',
    choices: Array.isArray(row.choices) ? row.choices : ['A', 'B', 'C', 'D', 'E'],
    lesson: row.lesson || '',
    topicName: row.topic_name || '',
    topicConfidence: Number(row.topic_confidence || 0),
    difficulty: row.difficulty || 3,
    createdAt: row.created_at,
  };
}

function mapQuizBookletQuestion(row) {
  return {
    id: row.id,
    testId: row.test_id,
    examType: row.exam_type,
    lessonKey: row.section_code || '',
    lessonName: row.section_name || '',
    lessonOrder: row.section_order || 1,
    questionNo: row.section_question_number || row.global_question_order || null,
    globalQuestionOrder: row.global_question_order || null,
    questionImageUrl: resolveBookletImageUrl(row.test_id, row.image_path),
    choices: Array.isArray(row.choices) ? row.choices : ['A', 'B', 'C', 'D', 'E'],
    correctAnswer: row.correct_answer || '',
    lesson: row.lesson || '',
    topicName: row.topic_name || '',
    createdAt: row.created_at,
  };
}

function mapBookletQuizAnswer(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    bookletQuestionId: row.booklet_question_id,
    selectedOption: row.selected_option,
    isCorrect: row.is_correct,
    answeredAt: row.answered_at,
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
    try {
      await syncBookletQuizInventory();
    } catch (error) {
      console.warn('Booklet quiz inventory sync skipped:', error.message);
    }
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
  await query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS exam_type VARCHAR(10) NOT NULL DEFAULT 'TYT'`);
  await query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS track VARCHAR(20) NOT NULL DEFAULT 'sayisal'`);
  await query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS lesson VARCHAR(100) NOT NULL DEFAULT ''`);
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
      lesson                  VARCHAR(100) NOT NULL DEFAULT '',
      topic_name              VARCHAR(255) NOT NULL DEFAULT '',
      topic_confidence        NUMERIC(4,3) NOT NULL DEFAULT 0,
      difficulty              SMALLINT    NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES booklet_sections(id) ON DELETE CASCADE');
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS section_question_number INT');
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS global_question_order INT');
  await query("ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS lesson VARCHAR(100) NOT NULL DEFAULT ''");
  await query("ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS topic_name VARCHAR(255) NOT NULL DEFAULT ''");
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS topic_confidence NUMERIC(4,3) NOT NULL DEFAULT 0');
  await query('ALTER TABLE booklet_questions ADD COLUMN IF NOT EXISTS difficulty SMALLINT NOT NULL DEFAULT 3');
  try { await query('ALTER TABLE booklet_questions DROP CONSTRAINT IF EXISTS booklet_questions_test_id_question_number_key'); } catch {}
  await query('CREATE INDEX IF NOT EXISTS idx_booklet_questions_test ON booklet_questions (test_id, global_question_order)');
  await query('CREATE INDEX IF NOT EXISTS idx_booklet_questions_topic ON booklet_questions (test_id, lesson, topic_name)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_booklet_questions_section_unique ON booklet_questions (test_id, section_id, section_question_number) WHERE section_id IS NOT NULL AND section_question_number IS NOT NULL');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_booklet_questions_global_unique ON booklet_questions (test_id, global_question_order) WHERE global_question_order IS NOT NULL');
  await query(`
    CREATE TABLE IF NOT EXISTS student_booklet_answers (
      id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id         UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      booklet_question_id UUID       NOT NULL REFERENCES booklet_questions(id) ON DELETE CASCADE,
      selected_option    CHAR(1)     NOT NULL CHECK (selected_option IN ('A','B','C','D','E')),
      is_correct         BOOLEAN     NOT NULL,
      answered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (student_id, booklet_question_id)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_student_booklet_answers_student ON student_booklet_answers (student_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_student_booklet_answers_question ON student_booklet_answers (booklet_question_id)');
}
