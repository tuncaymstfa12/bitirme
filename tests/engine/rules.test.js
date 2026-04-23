/**
 * Tests for Rules & Constraint module
 * Verifies schedule validation, constraint violation detection,
 * and spaced repetition checks.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RULES,
  validateSchedule,
  checkSpacedRepetition,
} from '../../src/engine/rules.js';

// --- Helpers ---

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    topicId: 'topic-1',
    slotId: 'slot-1',
    date: '2026-05-01',
    startHour: 9,
    startMinute: 0,
    durationMinutes: 30,
    status: 'scheduled',
    ...overrides,
  };
}

// --- Tests ---

describe('DEFAULT_RULES', () => {
  it('has all required constraint fields', () => {
    expect(DEFAULT_RULES.maxConsecutiveSameSubject).toBeDefined();
    expect(DEFAULT_RULES.breakFrequency).toBeDefined();
    expect(DEFAULT_RULES.minDailySubjects).toBeDefined();
    expect(DEFAULT_RULES.maxDailySlotsCount).toBeDefined();
    expect(DEFAULT_RULES.spacedRepetitionGapDays).toBeDefined();
    expect(DEFAULT_RULES.slotDurationMinutes).toBeDefined();
  });

  it('has priority weight fields that sum to ~1.0', () => {
    const w = DEFAULT_RULES.weights;
    const sum = w.urgency + w.topicWeight + w.weakness + w.performance;
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
  });

  it('has rescheduling configuration', () => {
    expect(DEFAULT_RULES.rescheduling).toBeDefined();
    expect(DEFAULT_RULES.rescheduling.highPriorityThreshold).toBeGreaterThan(0);
    expect(DEFAULT_RULES.rescheduling.compressionFactor).toBeGreaterThan(0);
    expect(DEFAULT_RULES.rescheduling.compressionFactor).toBeLessThan(1);
  });
});

describe('validateSchedule', () => {
  it('returns empty array for valid schedule', () => {
    const sessions = [
      makeSession({ id: 's1', topicId: 't1', startHour: 9 }),
      makeSession({ id: 's2', topicId: 't2', startHour: 10 }),
    ];
    const violations = validateSchedule(sessions);
    expect(violations).toHaveLength(0);
  });

  it('detects max daily slots violation', () => {
    const sessions = [];
    for (let i = 0; i < 15; i++) {
      sessions.push(makeSession({
        id: `s${i}`,
        topicId: `t${i % 5}`,
        startHour: 8 + i,
        startMinute: 0,
      }));
    }

    const rules = { ...DEFAULT_RULES, maxDailySlotsCount: 12 };
    const violations = validateSchedule(sessions, rules);
    const maxDailyViolations = violations.filter(v => v.type === 'maxDailySlots');
    expect(maxDailyViolations.length).toBeGreaterThan(0);
  });

  it('detects consecutive same-subject violation', () => {
    const sessions = [
      makeSession({ id: 's1', topicId: 't1', startHour: 9, startMinute: 0 }),
      makeSession({ id: 's2', topicId: 't1', startHour: 9, startMinute: 30 }),
      makeSession({ id: 's3', topicId: 't1', startHour: 10, startMinute: 0 }),
      makeSession({ id: 's4', topicId: 't1', startHour: 10, startMinute: 30 }),
    ];

    const rules = { ...DEFAULT_RULES, maxConsecutiveSameSubject: 3 };
    const violations = validateSchedule(sessions, rules);
    const consViolations = violations.filter(v => v.type === 'consecutiveSameSubject');
    expect(consViolations.length).toBeGreaterThan(0);
  });

  it('detects min daily subjects violation', () => {
    // 4+ slots but only 1 unique subject
    const sessions = [
      makeSession({ id: 's1', topicId: 't1', startHour: 8 }),
      makeSession({ id: 's2', topicId: 't1', startHour: 9 }),
      makeSession({ id: 's3', topicId: 't1', startHour: 10 }),
      makeSession({ id: 's4', topicId: 't1', startHour: 11 }),
    ];

    const rules = { ...DEFAULT_RULES, minDailySubjects: 2 };
    const violations = validateSchedule(sessions, rules);
    const subjectViolations = violations.filter(v => v.type === 'minDailySubjects');
    expect(subjectViolations.length).toBeGreaterThan(0);
  });

  it('does not flag min subjects when fewer than 4 slots', () => {
    const sessions = [
      makeSession({ id: 's1', topicId: 't1', startHour: 9 }),
      makeSession({ id: 's2', topicId: 't1', startHour: 10 }),
    ];

    const rules = { ...DEFAULT_RULES, minDailySubjects: 2 };
    const violations = validateSchedule(sessions, rules);
    const subjectViolations = violations.filter(v => v.type === 'minDailySubjects');
    expect(subjectViolations).toHaveLength(0);
  });

  it('detects break frequency violation', () => {
    const sessions = [
      makeSession({ id: 's1', topicId: 't1', startHour: 8 }),
      makeSession({ id: 's2', topicId: 't2', startHour: 9 }),
      makeSession({ id: 's3', topicId: 't3', startHour: 10 }),
      makeSession({ id: 's4', topicId: 't1', startHour: 11 }),
    ];

    const rules = { ...DEFAULT_RULES, breakFrequency: 2 };
    const violations = validateSchedule(sessions, rules);
    const breakViolations = violations.filter(v => v.type === 'breakFrequency');
    expect(breakViolations.length).toBeGreaterThan(0);
  });

  it('does not flag break when break sessions exist', () => {
    const sessions = [
      makeSession({ id: 's1', topicId: 't1', startHour: 9 }),
      makeSession({ id: 's2', topicId: 't2', startHour: 10 }),
      makeSession({ id: 's3', topicId: null, status: 'break', startHour: 11 }),
      makeSession({ id: 's4', topicId: 't3', startHour: 12 }),
    ];

    const rules = { ...DEFAULT_RULES, breakFrequency: 3 };
    const violations = validateSchedule(sessions, rules);
    const breakViolations = violations.filter(v => v.type === 'breakFrequency');
    expect(breakViolations).toHaveLength(0);
  });

  it('handles multiple days independently', () => {
    const day1Sessions = [
      makeSession({ id: 's1', date: '2026-05-01', topicId: 't1', startHour: 9 }),
      makeSession({ id: 's2', date: '2026-05-01', topicId: 't2', startHour: 10 }),
    ];
    const day2Sessions = [
      makeSession({ id: 's3', date: '2026-05-02', topicId: 't1', startHour: 9 }),
      makeSession({ id: 's4', date: '2026-05-02', topicId: 't2', startHour: 10 }),
    ];

    const violations = validateSchedule([...day1Sessions, ...day2Sessions]);
    expect(violations).toHaveLength(0);
  });
});

describe('checkSpacedRepetition', () => {
  it('returns true when no prior sessions exist', () => {
    expect(checkSpacedRepetition('t1', '2026-05-05', [])).toBe(true);
  });

  it('returns true when gap is sufficient', () => {
    const sessions = [
      makeSession({ topicId: 't1', date: '2026-05-01', status: 'completed' }),
    ];
    const rules = { ...DEFAULT_RULES, spacedRepetitionGapDays: 1 };
    expect(checkSpacedRepetition('t1', '2026-05-03', sessions, rules)).toBe(true);
  });

  it('returns false when dates are too close', () => {
    const sessions = [
      makeSession({ topicId: 't1', date: '2026-05-01', status: 'completed' }),
    ];
    const rules = { ...DEFAULT_RULES, spacedRepetitionGapDays: 3 };
    // 2 days apart but gap requires 3
    expect(checkSpacedRepetition('t1', '2026-05-02', sessions, rules)).toBe(false);
  });

  it('ignores missed sessions', () => {
    const sessions = [
      makeSession({ topicId: 't1', date: '2026-05-01', status: 'missed' }),
    ];
    const rules = { ...DEFAULT_RULES, spacedRepetitionGapDays: 3 };
    expect(checkSpacedRepetition('t1', '2026-05-02', sessions, rules)).toBe(true);
  });

  it('only checks sessions for the specified topic', () => {
    const sessions = [
      makeSession({ topicId: 't2', date: '2026-05-01', status: 'completed' }),
    ];
    const rules = { ...DEFAULT_RULES, spacedRepetitionGapDays: 3 };
    expect(checkSpacedRepetition('t1', '2026-05-02', sessions, rules)).toBe(true);
  });
});
