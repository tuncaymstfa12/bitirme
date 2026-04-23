/**
 * Tests for Rescheduler module
 * Verifies missed session recovery, full rescheduling,
 * and recovery action suggestions.
 */

import { describe, it, expect } from 'vitest';
import {
  handleMissedSessions,
  fullReschedule,
  suggestRecoveryActions,
} from '../../src/engine/rescheduler.js';

// --- Helpers ---

function futureDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

function pastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function makeExam(overrides = {}) {
  return {
    id: 'exam-1',
    name: 'Test Exam',
    date: futureDate(10),
    color: '#6366f1',
    ...overrides,
  };
}

function makeTopic(overrides = {}) {
  return {
    id: 'topic-1',
    examId: 'exam-1',
    name: 'Test Topic',
    weight: 5,
    selfAssessment: 3,
    estimatedMinutes: 60,
    completedMinutes: 0,
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    topicId: 'topic-1',
    slotId: 'slot-1',
    date: futureDate(1),
    startHour: 9,
    startMinute: 0,
    durationMinutes: 30,
    status: 'scheduled',
    ...overrides,
  };
}

const defaultAvailability = {
  0: [{ start: 10, end: 14 }],
  1: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
  2: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
  3: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
  4: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
  5: [{ start: 8, end: 12 }, { start: 14, end: 18 }],
  6: [{ start: 10, end: 14 }],
};

const defaultConstraints = {
  maxConsecutiveSameSubject: 3,
  breakFrequency: 3,
  minDailySubjects: 2,
  maxDailySlotsCount: 12,
  spacedRepetitionGapDays: 1,
  slotDurationMinutes: 30,
};

const defaultWeights = {
  urgency: 0.35,
  topicWeight: 0.25,
  weakness: 0.25,
  performance: 0.15,
};

// --- Tests ---

describe('suggestRecoveryActions', () => {
  it('returns critical suggestion when > 30% sessions missed', () => {
    const suggestions = suggestRecoveryActions(4, 10, 7);
    const critical = suggestions.filter(s => s.severity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.some(s => s.action === 'extend_daily')).toBe(true);
  });

  it('returns focus_critical when exam is very close with many misses', () => {
    const suggestions = suggestRecoveryActions(3, 10, 2);
    expect(suggestions.some(s => s.action === 'focus_critical')).toBe(true);
  });

  it('returns merge suggestion when >= 5 sessions missed', () => {
    const suggestions = suggestRecoveryActions(5, 20, 10);
    expect(suggestions.some(s => s.action === 'merge_topics')).toBe(true);
  });

  it('returns info when few misses and exam is far', () => {
    const suggestions = suggestRecoveryActions(2, 20, 14);
    expect(suggestions.some(s => s.action === 'redistributed')).toBe(true);
  });

  it('returns only info when missed count is low and exam is far', () => {
    // 0 missed, plenty of time → only redistributed info
    const suggestions = suggestRecoveryActions(0, 20, 30);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].severity).toBe('info');
    expect(suggestions[0].action).toBe('redistributed');
  });
});

describe('fullReschedule', () => {
  it('returns sessions when future exams exist', () => {
    const exams = [makeExam({ date: futureDate(10) })];
    const topics = [makeTopic({ estimatedMinutes: 60 })];

    const result = fullReschedule(exams, topics, [], defaultAvailability, defaultConstraints, defaultWeights);
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty sessions when no future exams', () => {
    const exams = [makeExam({ date: pastDate(5) })];
    const topics = [makeTopic()];

    const result = fullReschedule(exams, topics, [], defaultAvailability, defaultConstraints, defaultWeights);
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles multiple exams', () => {
    const exams = [
      makeExam({ id: 'e1', date: futureDate(5) }),
      makeExam({ id: 'e2', date: futureDate(12) }),
    ];
    const topics = [
      makeTopic({ id: 't1', examId: 'e1', estimatedMinutes: 60 }),
      makeTopic({ id: 't2', examId: 'e2', estimatedMinutes: 60 }),
    ];

    const result = fullReschedule(exams, topics, [], defaultAvailability, defaultConstraints, defaultWeights);
    const topicIds = new Set(result.sessions.filter(s => s.topicId).map(s => s.topicId));
    expect(topicIds.has('t1')).toBe(true);
    expect(topicIds.has('t2')).toBe(true);
  });
});

describe('handleMissedSessions', () => {
  it('preserves completed sessions', () => {
    const completed = makeSession({ id: 'c1', status: 'completed', date: pastDate(2) });
    const missed = makeSession({ id: 'm1', status: 'missed', date: pastDate(1) });
    const scheduled = makeSession({ id: 'sc1', status: 'scheduled', date: futureDate(3) });

    const exams = [makeExam({ date: futureDate(10) })];
    const topics = [makeTopic({ estimatedMinutes: 60 })];

    const result = handleMissedSessions(
      ['m1'],
      [completed, missed, scheduled],
      exams,
      topics,
      [],
      defaultAvailability,
      defaultConstraints,
      defaultWeights
    );

    const completedInResult = result.newSessions.filter(s => s.status === 'completed');
    expect(completedInResult.some(s => s.id === 'c1')).toBe(true);
  });

  it('generates change log for missed sessions', () => {
    const missed = makeSession({ id: 'm1', status: 'missed', date: pastDate(1) });
    const exams = [makeExam({ date: futureDate(10) })];
    const topics = [makeTopic({ estimatedMinutes: 60 })];

    const result = handleMissedSessions(
      ['m1'],
      [missed],
      exams,
      topics,
      [],
      defaultAvailability,
      defaultConstraints,
      defaultWeights
    );

    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.changes.some(c => c.type === 'missed')).toBe(true);
  });

  it('returns warnings when no future exams exist', () => {
    const missed = makeSession({ id: 'm1', status: 'missed' });
    const exams = [makeExam({ date: pastDate(5) })];
    const topics = [makeTopic()];

    const result = handleMissedSessions(
      ['m1'],
      [missed],
      exams,
      topics,
      [],
      defaultAvailability,
      defaultConstraints,
      defaultWeights
    );

    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
