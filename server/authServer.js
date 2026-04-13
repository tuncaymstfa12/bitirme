import http from 'node:http';
import { scrypt as scryptCallback, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureStore, readStore, updateStore } from './lib/jsonStore.js';

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.AUTH_API_PORT || 3001);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORE_PATH = join(__dirname, 'data', 'auth-store.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

await ensureStore(STORE_PATH);

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { success: true, status: 'ok' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await readJsonBody(req);
      return await handleRegister(body, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJsonBody(req);
      return await handleLogin(body, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      return await handleMe(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      return await handleLogout(req, res);
    }

    return sendJson(res, 404, { success: false, error: 'Route not found.' });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = error.expose ? error.message : 'Internal server error.';
    return sendJson(res, statusCode, { success: false, error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Auth API listening on http://localhost:${PORT}`);
});

async function handleRegister(body, res) {
  validateRegistration(body);

  const data = await readStore(STORE_PATH);
  const email = body.email.toLowerCase().trim();
  const uniqueId = body.uniqueId.trim();

  if (data.users.some(user => user.email === email)) {
    return sendJson(res, 409, { success: false, error: 'Bu e-posta adresi zaten kayıtlı.' });
  }

  if (data.users.some(user => user.uniqueId === uniqueId)) {
    return sendJson(res, 409, { success: false, error: 'Bu benzersiz ID zaten kullanılıyor.' });
  }

  const passwordHash = await hashPassword(body.password);
  const user = {
    id: randomUUID(),
    email,
    name: body.name.trim(),
    passwordHash,
    uniqueId,
    grade: Number(body.grade),
    strongLectures: body.strongLectures,
    weakLectures: body.weakLectures,
    createdAt: new Date().toISOString(),
  };

  const token = createToken();
  const session = createSession(user.id, token);

  await updateStore(STORE_PATH, current => ({
    ...current,
    users: [...current.users, user],
    sessions: [...cleanupExpiredSessions(current.sessions), session],
  }));

  return sendJson(res, 201, {
    success: true,
    token,
    user: sanitizeUser(user),
  });
}

async function handleLogin(body, res) {
  const email = String(body?.email || '').toLowerCase().trim();
  const password = String(body?.password || '');

  if (!email || !password) {
    return sendJson(res, 400, { success: false, error: 'E-posta ve şifre gereklidir.' });
  }

  const data = await readStore(STORE_PATH);
  const user = data.users.find(entry => entry.email === email);

  if (!user) {
    return sendJson(res, 401, { success: false, error: 'E-posta veya şifre hatalı.' });
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    return sendJson(res, 401, { success: false, error: 'E-posta veya şifre hatalı.' });
  }

  const token = createToken();
  const session = createSession(user.id, token);

  await updateStore(STORE_PATH, current => ({
    ...current,
    sessions: [...cleanupExpiredSessions(current.sessions), session],
  }));

  return sendJson(res, 200, {
    success: true,
    token,
    user: sanitizeUser(user),
  });
}

async function handleMe(req, res) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 401, { success: false, error: 'Unauthorized.' });
  }

  const data = await readStore(STORE_PATH);
  const user = data.users.find(entry => entry.id === session.userId);

  if (!user) {
    return sendJson(res, 404, { success: false, error: 'User not found.' });
  }

  return sendJson(res, 200, {
    success: true,
    user: sanitizeUser(user),
  });
}

async function handleLogout(req, res) {
  const token = extractBearerToken(req);
  if (!token) {
    return sendJson(res, 400, { success: false, error: 'Authorization token is required.' });
  }

  await updateStore(STORE_PATH, current => ({
    ...current,
    sessions: cleanupExpiredSessions(current.sessions).filter(session => session.token !== token),
  }));

  return sendJson(res, 200, {
    success: true,
    message: 'Logged out successfully.',
  });
}

function validateRegistration(body) {
  const requiredFields = ['email', 'name', 'password', 'uniqueId', 'grade'];
  const missing = requiredFields.some(field => !String(body?.[field] || '').trim());
  if (missing) {
    throw httpError(400, 'Tüm alanları doldurunuz.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw httpError(400, 'Geçerli bir e-posta adresi giriniz.');
  }

  if (String(body.password).length < 6) {
    throw httpError(400, 'Şifre en az 6 karakter olmalıdır.');
  }

  if (String(body.uniqueId).trim().length < 3) {
    throw httpError(400, 'Benzersiz ID en az 3 karakter olmalıdır.');
  }

  if (!Array.isArray(body.strongLectures) || body.strongLectures.length === 0) {
    throw httpError(400, 'En az bir güçlü ders seçiniz.');
  }

  if (!Array.isArray(body.weakLectures) || body.weakLectures.length === 0) {
    throw httpError(400, 'En az bir zayıf ders seçiniz.');
  }

  const overlap = body.strongLectures.filter(lesson => body.weakLectures.includes(lesson));
  if (overlap.length > 0) {
    throw httpError(400, `Bir ders hem güçlü hem zayıf olamaz: ${overlap.join(', ')}`);
  }
}

async function getSessionFromRequest(req) {
  const token = extractBearerToken(req);
  if (!token) return null;

  const data = await readStore(STORE_PATH);
  const sessions = cleanupExpiredSessions(data.sessions);
  const session = sessions.find(entry => entry.token === token);

  if (sessions.length !== data.sessions.length) {
    await updateStore(STORE_PATH, current => ({
      ...current,
      sessions: cleanupExpiredSessions(current.sessions),
    }));
  }

  return session || null;
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid JSON body.');
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

function createSession(userId, token) {
  const now = Date.now();

  return {
    id: randomUUID(),
    userId,
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
}

function cleanupExpiredSessions(sessions) {
  const now = Date.now();
  return sessions.filter(session => new Date(session.expiresAt).getTime() > now);
}

function sanitizeUser(user) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
