const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('studyPlanner_authToken');
}

async function request(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + path, opts);
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || 'API request failed');
  return data;
}

export async function syncAll() {
  return request('GET', '/sync');
}

export async function getExams() {
  return request('GET', '/exams');
}

export async function createExam(exam) {
  return request('POST', '/exams', exam);
}

export async function updateExam(id, updates) {
  return request('PUT', '/exams/' + id, updates);
}

export async function deleteExam(id) {
  return request('DELETE', '/exams/' + id);
}

export async function getTopics(examId = null) {
  const qs = examId ? '?examId=' + examId : '';
  return request('GET', '/topics' + qs);
}

export async function createTopic(topic) {
  return request('POST', '/topics', topic);
}

export async function updateTopic(id, updates) {
  return request('PUT', '/topics/' + id, updates);
}

export async function deleteTopic(id) {
  return request('DELETE', '/topics/' + id);
}

export async function getSessions() {
  return request('GET', '/sessions');
}

export async function setSessions(sessions) {
  return request('PUT', '/sessions/batch', { sessions });
}

export async function createSession(session) {
  return request('POST', '/sessions', session);
}

export async function updateSession(id, updates) {
  return request('PUT', '/sessions/' + id, updates);
}

export async function deleteSession(id) {
  return request('DELETE', '/sessions/' + id);
}

export async function clearSessions() {
  return request('DELETE', '/sessions');
}

export async function getMockResults(topicId = null) {
  const qs = topicId ? '?topicId=' + topicId : '';
  return request('GET', '/mock-results' + qs);
}

export async function createMockResult(result) {
  return request('POST', '/mock-results', result);
}

export async function deleteMockResult(id) {
  return request('DELETE', '/mock-results/' + id);
}

export async function getSettings() {
  return request('GET', '/settings');
}

export async function updateSettings(updates) {
  return request('PUT', '/settings', updates);
}
