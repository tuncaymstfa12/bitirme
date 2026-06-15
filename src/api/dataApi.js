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
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Sunucu yanıt vermiyor.');
  }

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

export async function getQuestions(filters = {}) {
  const params = new URLSearchParams();
  if (filters.examType) params.set('examType', filters.examType);
  if (filters.lesson) params.set('lesson', filters.lesson);
  if (filters.topicName) params.set('topicName', filters.topicName);
  const qs = params.toString() ? '?' + params.toString() : '';
  return request('GET', '/questions' + qs);
}

export async function createQuestion(question) {
  return request('POST', '/questions', question);
}

export async function updateQuestion(id, updates) {
  return request('PUT', '/questions/' + id, updates);
}

export async function autoTagQuestions(options = {}) {
  return request('POST', '/questions/auto-tag', options);
}

export async function deleteQuestion(id) {
  return request('DELETE', '/questions/' + id);
}

export async function answerQuestion(questionId, selectedOption) {
  return request('POST', '/questions/' + questionId + '/answer', { selectedOption });
}

export async function getQuizBookletLessons(examType) {
  const params = new URLSearchParams({ examType });
  return request('GET', '/quiz/booklet-lessons?' + params.toString());
}

export async function getQuizBookletTopics(examType) {
  const params = new URLSearchParams({ examType });
  return request('GET', '/quiz/booklet-topics?' + params.toString());
}

export async function getQuizBookletBranches(examType) {
  const params = new URLSearchParams({ examType });
  return request('GET', '/quiz/booklet-branches?' + params.toString());
}

export async function getBookletTopicStats(examType = '') {
  const params = new URLSearchParams();
  if (examType) params.set('examType', examType);
  const qs = params.toString() ? '?' + params.toString() : '';
  return request('GET', '/quiz/booklet-topic-stats' + qs);
}

export async function getQuizBookletQuestions({ examType, lessonKey = '', branchKey = '', topicKey = '', limit = 10 }) {
  const params = new URLSearchParams({
    examType,
    limit: String(limit),
  });
  if (lessonKey) params.set('lessonKey', lessonKey);
  if (branchKey) params.set('branchKey', branchKey);
  if (topicKey) params.set('topicKey', topicKey);
  return request('GET', '/quiz/booklet-questions?' + params.toString());
}

export async function answerQuizBookletQuestion(questionId, selectedOption) {
  return request('POST', '/quiz/booklet-questions/' + questionId + '/answer', { selectedOption });
}

export async function extractQuestionsWithOcr({ fileName, fileBase64, lang = 'tur+eng' }) {
  return request('POST', '/ocr/questions', { fileName, fileBase64, lang });
}

export async function getAdminQuestionImports() {
  return request('GET', '/admin/question-imports');
}

export async function importAdminQuestionPdf(payload) {
  return request('POST', '/admin/question-imports', payload);
}

export async function getBookletTests() {
  return request('GET', '/admin/booklet-tests');
}

export async function createBookletTest(payload) {
  return request('POST', '/admin/booklet-tests', payload);
}

export async function deleteBookletTest(testId) {
  return request('DELETE', '/admin/booklet-tests/' + testId);
}

export async function uploadBookletTestPdf(testId, payload) {
  return request('POST', '/admin/booklet-tests/' + testId + '/upload', payload);
}

export async function getBookletReview(testId) {
  return request('GET', '/admin/booklet-tests/' + testId + '/review');
}

export async function updateBookletReviewQuestion(testId, tempId, payload) {
  return request('PATCH', '/admin/booklet-tests/' + testId + '/review/questions/' + tempId, payload);
}

export async function createBookletReviewQuestion(testId, payload) {
  return request('POST', '/admin/booklet-tests/' + testId + '/review/questions', payload);
}

export async function deleteBookletReviewQuestion(testId, tempId) {
  return request('DELETE', '/admin/booklet-tests/' + testId + '/review/questions/' + tempId);
}

export async function applyBookletAnswerKey(testId, answerKeyText) {
  return request('POST', '/admin/booklet-tests/' + testId + '/answer-key', { answerKeyText });
}

export async function finalizeBookletTest(testId) {
  return request('POST', '/admin/booklet-tests/' + testId + '/finalize');
}

export async function autoTagBookletTest(testId, options = {}) {
  return request('POST', '/admin/booklet-tests/' + testId + '/auto-tag', options);
}

export async function getFinalBookletQuestions(testId) {
  return request('GET', '/admin/booklet-tests/' + testId + '/questions');
}

export async function deleteFinalBookletQuestion(testId, questionId) {
  return request('DELETE', '/admin/booklet-tests/' + testId + '/questions/' + questionId);
}

export async function getSettings() {
  return request('GET', '/settings');
}

export async function updateSettings(updates) {
  return request('PUT', '/settings', updates);
}
