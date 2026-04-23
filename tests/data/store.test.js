/**
 * Tests for State Store module
 * Verifies CRUD operations, cascade deletion, settings management,
 * event emission, and data export/import.
 *
 * Uses an in-memory localStorage mock since tests run in Node.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- localStorage mock ---
const localStorageMock = (() => {
  let storage = {};
  return {
    getItem: vi.fn(key => storage[key] ?? null),
    setItem: vi.fn((key, value) => { storage[key] = value; }),
    removeItem: vi.fn(key => { delete storage[key]; }),
    clear: vi.fn(() => { storage = {}; }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Import store AFTER mocking localStorage
const { store } = await import('../../src/data/store.js');

// --- Helpers ---

function makeExam(overrides = {}) {
  return {
    id: `exam-${Date.now()}-${Math.random()}`,
    name: 'Test Exam',
    date: '2026-06-15',
    color: '#6366f1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTopic(examId, overrides = {}) {
  return {
    id: `topic-${Date.now()}-${Math.random()}`,
    examId,
    name: 'Test Topic',
    weight: 5,
    selfAssessment: 3,
    estimatedMinutes: 60,
    completedMinutes: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(topicId, overrides = {}) {
  return {
    id: `session-${Date.now()}-${Math.random()}`,
    topicId,
    slotId: 'slot-1',
    date: '2026-05-01',
    startHour: 9,
    startMinute: 0,
    durationMinutes: 30,
    status: 'scheduled',
    ...overrides,
  };
}

function makeMockResult(topicId, overrides = {}) {
  return {
    id: `mock-${Date.now()}-${Math.random()}`,
    topicId,
    score: 50,
    maxScore: 100,
    date: '2026-05-01',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// --- Tests ---

beforeEach(() => {
  store.resetAll();
  localStorageMock.setItem.mockClear();
  localStorageMock.getItem.mockClear();
});

describe('Exam CRUD', () => {
  it('starts with empty exams', () => {
    expect(store.getExams()).toHaveLength(0);
  });

  it('adds an exam', () => {
    const exam = makeExam({ id: 'e1' });
    store.addExam(exam);
    expect(store.getExams()).toHaveLength(1);
    expect(store.getExam('e1')).toBeDefined();
    expect(store.getExam('e1').name).toBe('Test Exam');
  });

  it('updates an exam', () => {
    const exam = makeExam({ id: 'e1' });
    store.addExam(exam);
    store.updateExam('e1', { name: 'Updated Exam' });
    expect(store.getExam('e1').name).toBe('Updated Exam');
  });

  it('deletes an exam', () => {
    const exam = makeExam({ id: 'e1' });
    store.addExam(exam);
    store.deleteExam('e1');
    expect(store.getExams()).toHaveLength(0);
    expect(store.getExam('e1')).toBeUndefined();
  });

  it('returns a copy of exams array', () => {
    store.addExam(makeExam({ id: 'e1' }));
    const exams = store.getExams();
    exams.push(makeExam({ id: 'e2' }));
    expect(store.getExams()).toHaveLength(1); // Original unchanged
  });
});

describe('Topic CRUD', () => {
  it('adds a topic linked to an exam', () => {
    const exam = makeExam({ id: 'e1' });
    store.addExam(exam);

    const topic = makeTopic('e1', { id: 't1' });
    store.addTopic(topic);

    expect(store.getTopics()).toHaveLength(1);
    expect(store.getTopics('e1')).toHaveLength(1);
    expect(store.getTopic('t1').examId).toBe('e1');
  });

  it('filters topics by examId', () => {
    store.addExam(makeExam({ id: 'e1' }));
    store.addExam(makeExam({ id: 'e2' }));
    store.addTopic(makeTopic('e1', { id: 't1' }));
    store.addTopic(makeTopic('e2', { id: 't2' }));
    store.addTopic(makeTopic('e1', { id: 't3' }));

    expect(store.getTopics('e1')).toHaveLength(2);
    expect(store.getTopics('e2')).toHaveLength(1);
    expect(store.getTopics()).toHaveLength(3);
  });

  it('updates a topic', () => {
    store.addTopic(makeTopic('e1', { id: 't1', weight: 5 }));
    store.updateTopic('t1', { weight: 8 });
    expect(store.getTopic('t1').weight).toBe(8);
  });

  it('deletes a topic and its associated sessions and mock results', () => {
    store.addTopic(makeTopic('e1', { id: 't1' }));
    store.addSession(makeSession('t1', { id: 's1' }));
    store.addMockResult(makeMockResult('t1', { id: 'm1' }));

    store.deleteTopic('t1');

    expect(store.getTopic('t1')).toBeUndefined();
    expect(store.getSessions({ topicId: 't1' })).toHaveLength(0);
    expect(store.getMockResults('t1')).toHaveLength(0);
  });
});

describe('Session CRUD', () => {
  it('adds and retrieves sessions', () => {
    store.addSession(makeSession('t1', { id: 's1' }));
    expect(store.getSessions()).toHaveLength(1);
    expect(store.getSession('s1')).toBeDefined();
  });

  it('filters sessions by date', () => {
    store.addSession(makeSession('t1', { id: 's1', date: '2026-05-01' }));
    store.addSession(makeSession('t1', { id: 's2', date: '2026-05-02' }));
    expect(store.getSessions({ date: '2026-05-01' })).toHaveLength(1);
  });

  it('filters sessions by status', () => {
    store.addSession(makeSession('t1', { id: 's1', status: 'completed' }));
    store.addSession(makeSession('t1', { id: 's2', status: 'missed' }));
    store.addSession(makeSession('t1', { id: 's3', status: 'scheduled' }));

    expect(store.getSessions({ status: 'completed' })).toHaveLength(1);
    expect(store.getSessions({ status: 'missed' })).toHaveLength(1);
  });

  it('updates a session', () => {
    store.addSession(makeSession('t1', { id: 's1', status: 'scheduled' }));
    store.updateSession('s1', { status: 'completed' });
    expect(store.getSession('s1').status).toBe('completed');
  });

  it('replaces all sessions with setSessions', () => {
    store.addSession(makeSession('t1', { id: 's1' }));
    store.addSession(makeSession('t1', { id: 's2' }));
    store.setSessions([makeSession('t1', { id: 's3' })]);
    expect(store.getSessions()).toHaveLength(1);
    expect(store.getSession('s3')).toBeDefined();
  });

  it('clears all sessions', () => {
    store.addSession(makeSession('t1', { id: 's1' }));
    store.addSession(makeSession('t1', { id: 's2' }));
    store.clearSessions();
    expect(store.getSessions()).toHaveLength(0);
  });
});

describe('MockResult CRUD', () => {
  it('adds and retrieves mock results', () => {
    store.addMockResult(makeMockResult('t1', { id: 'm1' }));
    expect(store.getMockResults()).toHaveLength(1);
  });

  it('filters mock results by topicId', () => {
    store.addMockResult(makeMockResult('t1', { id: 'm1' }));
    store.addMockResult(makeMockResult('t2', { id: 'm2' }));
    expect(store.getMockResults('t1')).toHaveLength(1);
    expect(store.getMockResults()).toHaveLength(2);
  });

  it('deletes a mock result', () => {
    store.addMockResult(makeMockResult('t1', { id: 'm1' }));
    store.deleteMockResult('m1');
    expect(store.getMockResults()).toHaveLength(0);
  });
});

describe('Cascade Deletion', () => {
  it('deleting an exam removes its topics, sessions, and mock results', () => {
    const exam = makeExam({ id: 'e1' });
    store.addExam(exam);

    const topic = makeTopic('e1', { id: 't1' });
    store.addTopic(topic);

    store.addSession(makeSession('t1', { id: 's1' }));
    store.addMockResult(makeMockResult('t1', { id: 'm1' }));

    store.deleteExam('e1');

    expect(store.getExams()).toHaveLength(0);
    expect(store.getTopics()).toHaveLength(0);
    expect(store.getSessions()).toHaveLength(0);
    expect(store.getMockResults()).toHaveLength(0);
  });
});

describe('Settings', () => {
  it('returns default settings', () => {
    const settings = store.getSettings();
    expect(settings.weights).toBeDefined();
    expect(settings.constraints).toBeDefined();
    expect(settings.dailyAvailability).toBeDefined();
  });

  it('updates settings with deep merge', () => {
    store.updateSettings({ weights: { urgency: 0.5 } });
    const settings = store.getSettings();
    expect(settings.weights.urgency).toBe(0.5);
    // Other weights should remain at default
    expect(settings.weights.topicWeight).toBe(0.25);
  });

  it('returns a copy of settings', () => {
    const settings = store.getSettings();
    settings.weights.urgency = 999;
    expect(store.getSettings().weights.urgency).not.toBe(999);
  });
});

describe('Export / Import', () => {
  it('exports data as JSON string', () => {
    store.addExam(makeExam({ id: 'e1' }));
    const json = store.exportData();
    const parsed = JSON.parse(json);
    expect(parsed.exams).toHaveLength(1);
  });

  it('imports valid JSON', () => {
    const data = {
      exams: [makeExam({ id: 'imported-exam' })],
      topics: [],
      sessions: [],
      mockResults: [],
      timeSlots: [],
    };
    const result = store.importData(JSON.stringify(data));
    expect(result).toBe(true);
    expect(store.getExams()).toHaveLength(1);
    expect(store.getExam('imported-exam')).toBeDefined();
  });

  it('returns false for invalid JSON', () => {
    const result = store.importData('not valid json {{{');
    expect(result).toBe(false);
  });
});

describe('Reset', () => {
  it('clears all data', () => {
    store.addExam(makeExam({ id: 'e1' }));
    store.addTopic(makeTopic('e1', { id: 't1' }));
    store.addSession(makeSession('t1', { id: 's1' }));
    store.addMockResult(makeMockResult('t1', { id: 'm1' }));

    store.resetAll();

    expect(store.getExams()).toHaveLength(0);
    expect(store.getTopics()).toHaveLength(0);
    expect(store.getSessions()).toHaveLength(0);
    expect(store.getMockResults()).toHaveLength(0);
  });
});

describe('Event Emission', () => {
  it('emits change event on addExam', () => {
    const handler = vi.fn();
    const unsub = store.on('change', handler);

    store.addExam(makeExam({ id: 'e1' }));
    expect(handler).toHaveBeenCalled();

    unsub();
  });

  it('emits specific event on changes', () => {
    const handler = vi.fn();
    const unsub = store.on('exams:changed', handler);

    store.addExam(makeExam({ id: 'e1' }));
    expect(handler).toHaveBeenCalled();

    unsub();
  });

  it('unsubscribes correctly', () => {
    const handler = vi.fn();
    const unsub = store.on('exams:changed', handler);
    unsub();

    store.addExam(makeExam({ id: 'e1' }));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Persistence', () => {
  it('calls localStorage.setItem on mutations', () => {
    localStorageMock.setItem.mockClear();
    store.addExam(makeExam({ id: 'e1' }));
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });
});
