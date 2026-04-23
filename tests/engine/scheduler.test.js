/**
 * Tests for Scheduler module
 * Verifies slot generation, greedy allocation, break insertion,
 * and constraint enforcement.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  generateAvailableSlots,
  getScheduleStats,
} from '../../src/engine/scheduler.js';

// --- Helpers ---

function futureDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

function makeRankedTopic(overrides = {}) {
  return {
    topic: {
      id: 'topic-1',
      examId: 'exam-1',
      name: 'Test Topic',
      weight: 5,
      selfAssessment: 3,
      estimatedMinutes: 60,
      completedMinutes: 0,
      ...overrides.topic,
    },
    exam: {
      id: 'exam-1',
      name: 'Test Exam',
      date: futureDate(7),
      color: '#6366f1',
      ...overrides.exam,
    },
    score: overrides.score ?? 0.7,
    breakdown: overrides.breakdown ?? {
      urgency: 0.7,
      topicWeight: 0.5,
      weakness: 0.6,
      performanceGap: 0.5,
    },
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

// --- Tests ---

describe('generateAvailableSlots', () => {
  it('generates slots for a single day', () => {
    const start = futureDate(1);
    const end = futureDate(1);
    const slots = generateAvailableSlots(defaultAvailability, defaultConstraints, start, end);

    expect(slots.length).toBeGreaterThan(0);
    // All slots should have the same date
    const uniqueDates = new Set(slots.map(s => s.date));
    expect(uniqueDates.size).toBe(1);
    slots.forEach(slot => {
      expect(slot.durationMinutes).toBe(30);
      expect(slot.allocated).toBe(false);
    });
  });

  it('generates correct number of slots for a 2-hour availability window', () => {
    // Create availability for all days with a 2-hour block → 4 x 30min slots
    const allDayAvail = {};
    for (let i = 0; i < 7; i++) {
      allDayAvail[i] = [{ start: 9, end: 11 }];
    }
    const start = futureDate(1);
    const slots = generateAvailableSlots(allDayAvail, defaultConstraints, start, start);
    // Regardless of day-of-week, we should get exactly 4 slots for a 2h block
    expect(slots).toHaveLength(4); // 9:00, 9:30, 10:00, 10:30
  });

  it('respects custom slot duration', () => {
    const constraints = { ...defaultConstraints, slotDurationMinutes: 60 };
    // Availability on all days so we always get slots regardless of day-of-week
    const allDayAvail = {};
    for (let i = 0; i < 7; i++) {
      allDayAvail[i] = [{ start: 9, end: 11 }];
    }
    const start = futureDate(1);
    const slots = generateAvailableSlots(allDayAvail, constraints, start, start);
    expect(slots).toHaveLength(2); // 9:00, 10:00
    slots.forEach(s => expect(s.durationMinutes).toBe(60));
  });

  it('generates slots across multiple days', () => {
    const start = futureDate(1);
    const end = futureDate(3);
    const slots = generateAvailableSlots(defaultAvailability, defaultConstraints, start, end);
    const uniqueDates = new Set(slots.map(s => s.date));
    expect(uniqueDates.size).toBe(3);
  });

  it('returns empty when no availability is set', () => {
    const emptyAvail = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    const slots = generateAvailableSlots(emptyAvail, defaultConstraints, futureDate(1), futureDate(7));
    expect(slots).toHaveLength(0);
  });

  it('each slot has a unique ID', () => {
    const slots = generateAvailableSlots(defaultAvailability, defaultConstraints, futureDate(1), futureDate(3));
    const ids = slots.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('generateSchedule', () => {
  it('returns an array of sessions', () => {
    const ranked = [makeRankedTopic()];
    const sessions = generateSchedule(ranked, defaultAvailability, defaultConstraints, futureDate(1), futureDate(7));
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('assigns topicId from ranked topics', () => {
    const ranked = [makeRankedTopic()];
    const sessions = generateSchedule(ranked, defaultAvailability, defaultConstraints, futureDate(1), futureDate(7));
    const studySessions = sessions.filter(s => s.topicId !== null);
    expect(studySessions.length).toBeGreaterThan(0);
    studySessions.forEach(s => {
      expect(s.topicId).toBe('topic-1');
    });
  });

  it('inserts break sessions', () => {
    const ranked = [
      makeRankedTopic({ topic: { id: 't1', estimatedMinutes: 300 }, score: 0.9 }),
      makeRankedTopic({ topic: { id: 't2', estimatedMinutes: 300 }, score: 0.8 }),
    ];
    const sessions = generateSchedule(ranked, defaultAvailability, defaultConstraints, futureDate(1), futureDate(7));
    const breaks = sessions.filter(s => s.status === 'break');
    expect(breaks.length).toBeGreaterThan(0);
  });

  it('does not exceed max daily slots', () => {
    const ranked = [
      makeRankedTopic({ topic: { id: 't1', estimatedMinutes: 600 }, score: 0.9 }),
    ];
    const constraints = { ...defaultConstraints, maxDailySlotsCount: 4 };
    const sessions = generateSchedule(ranked, defaultAvailability, constraints, futureDate(1), futureDate(7));

    // Group by date and check
    const byDate = {};
    sessions.forEach(s => {
      if (s.status !== 'break') {
        byDate[s.date] = (byDate[s.date] || 0) + 1;
      }
    });

    Object.values(byDate).forEach(count => {
      expect(count).toBeLessThanOrEqual(4);
    });
  });

  it('sessions are sorted by date and time', () => {
    const ranked = [
      makeRankedTopic({ topic: { id: 't1', estimatedMinutes: 120 }, score: 0.9 }),
      makeRankedTopic({ topic: { id: 't2', estimatedMinutes: 120 }, score: 0.7 }),
    ];
    const sessions = generateSchedule(ranked, defaultAvailability, defaultConstraints, futureDate(1), futureDate(5));

    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1];
      const curr = sessions[i];
      if (prev.date === curr.date) {
        expect(curr.startHour * 60 + curr.startMinute).toBeGreaterThanOrEqual(
          prev.startHour * 60 + prev.startMinute
        );
      } else {
        expect(curr.date >= prev.date).toBe(true);
      }
    }
  });
});

describe('getScheduleStats', () => {
  it('counts sessions by status', () => {
    const sessions = [
      { id: 's1', topicId: 't1', status: 'completed', durationMinutes: 30 },
      { id: 's2', topicId: 't1', status: 'scheduled', durationMinutes: 30 },
      { id: 's3', topicId: 't1', status: 'missed', durationMinutes: 30 },
      { id: 's4', topicId: null, status: 'break', durationMinutes: 15 },
    ];

    const stats = getScheduleStats(sessions, [], []);
    expect(stats.completedSessions).toBe(1);
    expect(stats.scheduledSessions).toBe(1);
    expect(stats.missedSessions).toBe(1);
    expect(stats.totalSessions).toBe(3); // excludes breaks
  });

  it('calculates total and completed minutes', () => {
    const sessions = [
      { id: 's1', topicId: 't1', status: 'completed', durationMinutes: 30 },
      { id: 's2', topicId: 't1', status: 'completed', durationMinutes: 30 },
      { id: 's3', topicId: 't1', status: 'scheduled', durationMinutes: 30 },
    ];

    const stats = getScheduleStats(sessions, [], []);
    expect(stats.totalStudyMinutes).toBe(90);
    expect(stats.completedMinutes).toBe(60);
  });

  it('tracks topic coverage', () => {
    const topics = [
      { id: 't1', name: 'Topic A' },
      { id: 't2', name: 'Topic B' },
    ];
    const sessions = [
      { id: 's1', topicId: 't1', status: 'completed', durationMinutes: 30 },
      { id: 's2', topicId: 't1', status: 'scheduled', durationMinutes: 30 },
      { id: 's3', topicId: 't2', status: 'missed', durationMinutes: 30 },
    ];

    const stats = getScheduleStats(sessions, topics, []);
    expect(stats.topicCoverage['t1'].completed).toBe(1);
    expect(stats.topicCoverage['t1'].scheduled).toBe(1);
    expect(stats.topicCoverage['t2'].missed).toBe(1);
  });
});
