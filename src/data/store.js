/**
 * Reactive State Store with LocalStorage persistence
 * Central data management for the Study Planning System.
 * Syncs with PostgreSQL API when available.
 */

import {
  syncAll, createExam as apiCreateExam, updateExam as apiUpdateExam, deleteExam as apiDeleteExam,
  createTopic as apiCreateTopic, updateTopic as apiUpdateTopic, deleteTopic as apiDeleteTopic,
  createSession as apiCreateSession, deleteSession as apiDeleteSession, setSessions as apiSetSessions, updateSession as apiUpdateSession, clearSessions as apiClearSessions,
  createMockResult as apiCreateMockResult, deleteMockResult as apiDeleteMockResult,
  updateSettings as apiUpdateSettings,
} from '../api/dataApi.js';

const STORAGE_KEY = 'studyPlannerState';
let apiOnline = false;

const defaultState = {
  exams: [],
  topics: [],
  timeSlots: [],
  sessions: [],
  mockResults: [],
  settings: {
    weights: {
      urgency: 0.35,
      topicWeight: 0.25,
      weakness: 0.25,
      performance: 0.15,
    },
    constraints: {
      maxConsecutiveSameSubject: 3,
      breakFrequency: 3,
      minDailySubjects: 2,
      maxDailySlotsCount: 12,
      spacedRepetitionGapDays: 1,
      slotDurationMinutes: 30,
    },
    dailyAvailability: {
      0: [{ start: 10, end: 14 }],
      1: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
      2: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
      3: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
      4: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
      5: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
      6: [{ start: 10, end: 14 }],
    },
  },
};

let state = loadState();
const listeners = new Map();

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultState, ...parsed, settings: { ...defaultState.settings, ...parsed.settings } };
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e);
  }
  return JSON.parse(JSON.stringify(defaultState));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e);
  }
}

function emit(event, data) {
  const handlers = listeners.get(event) || [];
  handlers.forEach(fn => fn(data));
  const globalHandlers = listeners.get('change') || [];
  globalHandlers.forEach(fn => fn({ event, data }));
}

function syncToServer(key, action) {
  if (!apiOnline) return;
  action().catch(err => {
    console.warn(`API sync failed for ${key}:`, err.message);
  });
}

// --- Public API ---

export const store = {
  isApiOnline() { return apiOnline; },

  async syncFromServer() {
    try {
      const data = await syncAll();
      apiOnline = true;

      // Merge server data into local state (server is source of truth)
      state.exams = data.exams || [];
      state.topics = data.topics || [];
      state.sessions = data.sessions || [];
      state.mockResults = data.mockResults || [];
      if (data.settings) {
        state.settings = deepMerge(state.settings, data.settings);
      }

      saveState();
      emit('change', { event: 'sync' });
      return true;
    } catch (e) {
      apiOnline = false;
      console.warn('API sync failed, using localStorage:', e.message);
      return false;
    }
  },

  async pushToServer() {
    if (!apiOnline) return false;
    try {
      await apiSetSessions(state.sessions);
      // Settings are pushed separately on update
      // Exams, topics, mock results are pushed individually on create/update/delete
      return true;
    } catch (e) {
      console.warn('Push to server failed:', e.message);
      return false;
    }
  },

  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(handler);
    return () => {
      const arr = listeners.get(event);
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    };
  },

  // --- Exams ---
  getExams() { return [...state.exams]; },
  getExam(id) { return state.exams.find(e => e.id === id); },
  addExam(exam) {
    state.exams.push(exam);
    saveState(); emit('exams:changed', exam);
    syncToServer('exam', () => apiCreateExam(exam));
  },
  updateExam(id, updates) {
    const idx = state.exams.findIndex(e => e.id === id);
    if (idx >= 0) {
      state.exams[idx] = { ...state.exams[idx], ...updates };
      saveState(); emit('exams:changed', state.exams[idx]);
      syncToServer('exam', () => apiUpdateExam(id, updates));
    }
  },
  deleteExam(id) {
    state.exams = state.exams.filter(e => e.id !== id);
    const topicIds = state.topics.filter(t => t.examId === id).map(t => t.id);
    state.topics = state.topics.filter(t => t.examId !== id);
    state.sessions = state.sessions.filter(s => !topicIds.includes(s.topicId));
    state.mockResults = state.mockResults.filter(m => !topicIds.includes(m.topicId));
    saveState(); emit('exams:changed');
    syncToServer('exam', () => apiDeleteExam(id));
  },

  // --- Topics ---
  getTopics(examId = null) {
    if (examId) return state.topics.filter(t => t.examId === examId);
    return [...state.topics];
  },
  getTopic(id) { return state.topics.find(t => t.id === id); },
  addTopic(topic) {
    state.topics.push(topic);
    saveState(); emit('topics:changed', topic);
    syncToServer('topic', () => apiCreateTopic(topic));
  },
  updateTopic(id, updates) {
    const idx = state.topics.findIndex(t => t.id === id);
    if (idx >= 0) {
      state.topics[idx] = { ...state.topics[idx], ...updates };
      saveState(); emit('topics:changed', state.topics[idx]);
      syncToServer('topic', () => apiUpdateTopic(id, updates));
    }
  },
  deleteTopic(id) {
    state.topics = state.topics.filter(t => t.id !== id);
    state.sessions = state.sessions.filter(s => s.topicId !== id);
    state.mockResults = state.mockResults.filter(m => m.topicId !== id);
    saveState(); emit('topics:changed');
    syncToServer('topic', () => apiDeleteTopic(id));
  },

  // --- Sessions ---
  getSessions(filters = {}) {
    let result = [...state.sessions];
    if (filters.date) result = result.filter(s => s.date === filters.date);
    if (filters.topicId) result = result.filter(s => s.topicId === filters.topicId);
    if (filters.status) result = result.filter(s => s.status === filters.status);
    return result;
  },
  getSession(id) { return state.sessions.find(s => s.id === id); },
  setSessions(sessions) {
    state.sessions = sessions;
    saveState(); emit('sessions:changed');
    syncToServer('sessions', () => apiSetSessions(sessions));
  },
  addSession(session) {
    state.sessions.push(session);
    saveState(); emit('sessions:changed', session);
    syncToServer('sessions', () => apiCreateSession(session));
  },
  updateSession(id, updates) {
    const idx = state.sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      state.sessions[idx] = { ...state.sessions[idx], ...updates };
      saveState(); emit('sessions:changed', state.sessions[idx]);
      syncToServer('session', () => apiUpdateSession(id, updates));
    }
  },
  deleteSession(id) {
    state.sessions = state.sessions.filter(s => s.id !== id);
    saveState(); emit('sessions:changed');
    syncToServer('sessions', () => apiDeleteSession(id));
  },
  clearSessions() {
    state.sessions = [];
    saveState(); emit('sessions:changed');
    syncToServer('sessions', () => apiClearSessions());
  },

  // --- Mock Results ---
  getMockResults(topicId = null) {
    if (topicId) return state.mockResults.filter(m => m.topicId === topicId);
    return [...state.mockResults];
  },
  addMockResult(result) {
    state.mockResults.push(result);
    saveState(); emit('mockResults:changed', result);
    syncToServer('mockResult', () => apiCreateMockResult(result));
  },
  deleteMockResult(id) {
    state.mockResults = state.mockResults.filter(m => m.id !== id);
    saveState(); emit('mockResults:changed');
    syncToServer('mockResult', () => apiDeleteMockResult(id));
  },

  // --- Settings ---
  getSettings() { return JSON.parse(JSON.stringify(state.settings)); },
  updateSettings(updates) {
    state.settings = deepMerge(state.settings, updates);
    saveState(); emit('settings:changed', state.settings);
    syncToServer('settings', () => apiUpdateSettings(updates));
  },

  // --- Utility ---
  resetAll() {
    state = JSON.parse(JSON.stringify(defaultState));
    saveState(); emit('change', { event: 'reset' });
  },
  exportData() {
    return JSON.stringify(state, null, 2);
  },
  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      state = { ...defaultState, ...data };
      saveState(); emit('change', { event: 'import' });
      return true;
    } catch {
      return false;
    }
  },
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
