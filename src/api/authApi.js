const API_BASE_URL = '/api/auth';
const TOKEN_STORAGE_KEY = 'studyPlanner_authToken';

export async function registerUserApi(payload) {
  const response = await fetch(API_BASE_URL + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Kayıt işlemi başarısız.');

  persistToken(data.token);
  return data;
}

export async function loginUserApi(email, password) {
  const response = await fetch(API_BASE_URL + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Sunucu yanıt vermiyor.');
  }
  if (!response.ok) throw new Error(data.error || 'Giriş işlemi başarısız.');

  persistToken(data.token);
  return data;
}

export async function fetchCurrentUserApi() {
  const token = getStoredToken();
  if (!token) return null;

  const response = await fetch(API_BASE_URL + '/me', {
    headers: { Authorization: 'Bearer ' + token },
  });

  if (response.status === 401) {
    clearStoredToken();
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (!response.ok) throw new Error(data.error || 'Kullanıcı bilgisi alınamadı.');
  return data.user;
}

export async function logoutUserApi() {
  const token = getStoredToken();
  if (!token) return;

  const response = await fetch(API_BASE_URL + '/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });

  clearStoredToken();

  if (!response.ok) {
    try {
      const data = await response.json();
      throw new Error(data.error || 'Çıkış işlemi başarısız.');
    } catch {
      // Silently fail - token already cleared
    }
  }
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function persistToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
}
