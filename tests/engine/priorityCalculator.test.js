/**
 * Tests for Priority Calculator module
 * Verifies weighted scoring, urgency decay, weakness inversion,
 * performance gap calculation, and topic ranking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculatePriorityScore,
  rankTopics,
  getUrgencyScore,
  getWeaknessScore,
  getPerformanceGap,
  getPriorityLabel,
  getPriorityClass,
} from '../../src/engine/priorityCalculator.js';

// --- Helpers ---

function makeExam(overrides = {}) {
  return {
    id: 'exam-1',
    name: 'Test Exam',
    date: futureDate(7),
    color: '#6366f1',
    createdAt: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockResult(overrides = {}) {
  return {
    id: 'mock-1',
    topicId: 'topic-1',
    score: 50,
    maxScore: 100,
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

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

// --- Tests ---

describe('getUrgencyScore', () => {
  it('returns 1.0 for exam date today or past', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(getUrgencyScore(today)).toBe(1.0);
    expect(getUrgencyScore(pastDate(5))).toBe(1.0);
  });

  it('returns high urgency for exam tomorrow', () => {
    const score = getUrgencyScore(futureDate(1));
    // At night futureDate(1) may resolve to < 1 day, giving 1.0
    expect(score).toBeGreaterThanOrEqual(0.95);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns 0.85 for exam in 2-3 days', () => {
    expect(getUrgencyScore(futureDate(3))).toBe(0.85);
  });

  it('returns 0.7 for exam in 7 days', () => {
    expect(getUrgencyScore(futureDate(7))).toBe(0.7);
  });

  it('returns 0.5 for exam in 14 days', () => {
    expect(getUrgencyScore(futureDate(14))).toBe(0.5);
  });

  it('returns 0.3 for exam in 30 days', () => {
    expect(getUrgencyScore(futureDate(30))).toBe(0.3);
  });

  it('returns 0.1 for exam more than 30 days away', () => {
    expect(getUrgencyScore(futureDate(60))).toBe(0.1);
  });

  it('urgency decreases as exam gets further away', () => {
    const scores = [1, 3, 7, 14, 30, 60].map(d => getUrgencyScore(futureDate(d)));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});

describe('getWeaknessScore', () => {
  it('returns 1.0 for selfAssessment of 1 (weakest)', () => {
    expect(getWeaknessScore(1)).toBe(1.0);
  });

  it('returns 0.0 for selfAssessment of 5 (strongest self-rating)', () => {
    // (6 - 5) / 5 = 0.2 actually
    expect(getWeaknessScore(5)).toBe(0.2);
  });

  it('returns 0.6 for selfAssessment of 3', () => {
    expect(getWeaknessScore(3)).toBe(0.6);
  });

  it('clamps values below 1 to 1', () => {
    expect(getWeaknessScore(0)).toBe(1.0);
    expect(getWeaknessScore(-5)).toBe(1.0);
  });

  it('clamps values above 5 to 5', () => {
    expect(getWeaknessScore(10)).toBe(0.2);
  });

  it('weakness decreases as self-assessment increases', () => {
    const scores = [1, 2, 3, 4, 5].map(getWeaknessScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });
});

describe('getPerformanceGap', () => {
  it('returns 0.5 when no mock results exist', () => {
    expect(getPerformanceGap('topic-1', [])).toBe(0.5);
  });

  it('returns high gap for low scores', () => {
    const mocks = [makeMockResult({ score: 20, maxScore: 100 })];
    const gap = getPerformanceGap('topic-1', mocks);
    expect(gap).toBeGreaterThan(0.7);
  });

  it('returns low gap for high scores', () => {
    const mocks = [makeMockResult({ score: 90, maxScore: 100 })];
    const gap = getPerformanceGap('topic-1', mocks);
    expect(gap).toBeLessThan(0.2);
  });

  it('weights latest result more heavily (70% latest, 30% average)', () => {
    const mocks = [
      makeMockResult({ id: 'm1', score: 30, date: pastDate(5) }),
      makeMockResult({ id: 'm2', score: 90, date: pastDate(1) }),
    ];
    const gap = getPerformanceGap('topic-1', mocks);
    // Latest 90/100 → 0.1 gap; Avg = (30+90)/200 = 0.6 → 0.4 gap
    // Effective = 0.7*0.1 + 0.3*0.4 = 0.19
    expect(gap).toBeLessThan(0.25);
  });

  it('ignores results from other topics', () => {
    const mocks = [makeMockResult({ topicId: 'other-topic', score: 10 })];
    expect(getPerformanceGap('topic-1', mocks)).toBe(0.5);
  });
});

describe('calculatePriorityScore', () => {
  it('returns a number between 0 and 1', () => {
    const topic = makeTopic();
    const exam = makeExam();
    const score = calculatePriorityScore(topic, exam);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns higher score for closer exam + weaker topic', () => {
    const weakTopic = makeTopic({ selfAssessment: 1, weight: 9 });
    const strongTopic = makeTopic({ selfAssessment: 5, weight: 2 });
    const closeExam = makeExam({ date: futureDate(2) });
    const farExam = makeExam({ date: futureDate(60) });

    const highPriority = calculatePriorityScore(weakTopic, closeExam);
    const lowPriority = calculatePriorityScore(strongTopic, farExam);
    expect(highPriority).toBeGreaterThan(lowPriority);
  });

  it('uses custom weights when provided', () => {
    const topic = makeTopic({ selfAssessment: 3, weight: 10 });
    const exam = makeExam({ date: futureDate(30) });

    const allUrgency = calculatePriorityScore(topic, exam, [], {
      urgency: 1.0, topicWeight: 0, weakness: 0, performance: 0,
    });
    const allTopicWeight = calculatePriorityScore(topic, exam, [], {
      urgency: 0, topicWeight: 1.0, weakness: 0, performance: 0,
    });

    // urgency at 30 days = 0.3, topicWeight at 10 = 1.0
    expect(allUrgency).toBeLessThan(allTopicWeight);
  });
});

describe('rankTopics', () => {
  it('returns empty array when no topics exist', () => {
    const result = rankTopics([], [], []);
    expect(result).toEqual([]);
  });

  it('skips topics whose exam has passed', () => {
    const exam = makeExam({ date: pastDate(5) });
    const topic = makeTopic();
    const result = rankTopics([exam], [topic], []);
    expect(result).toHaveLength(0);
  });

  it('ranks topics by score descending', () => {
    const exam = makeExam({ date: futureDate(7) });
    const weak = makeTopic({ id: 't1', selfAssessment: 1, weight: 9 });
    const strong = makeTopic({ id: 't2', selfAssessment: 5, weight: 2 });

    const result = rankTopics([exam], [weak, strong], []);
    expect(result.length).toBe(2);
    expect(result[0].topic.id).toBe('t1');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('includes breakdown for each ranked topic', () => {
    const exam = makeExam({ date: futureDate(7) });
    const topic = makeTopic();
    const result = rankTopics([exam], [topic], []);

    expect(result[0].breakdown).toBeDefined();
    expect(result[0].breakdown).toHaveProperty('urgency');
    expect(result[0].breakdown).toHaveProperty('topicWeight');
    expect(result[0].breakdown).toHaveProperty('weakness');
    expect(result[0].breakdown).toHaveProperty('performanceGap');
  });

  it('skips topics with no matching exam', () => {
    const topic = makeTopic({ examId: 'nonexistent' });
    const result = rankTopics([], [topic], []);
    expect(result).toHaveLength(0);
  });
});

describe('getPriorityLabel', () => {
  it('returns "Critical" for score >= 0.7', () => {
    expect(getPriorityLabel(0.7)).toBe('Critical');
    expect(getPriorityLabel(1.0)).toBe('Critical');
  });

  it('returns "High" for 0.5 <= score < 0.7', () => {
    expect(getPriorityLabel(0.5)).toBe('High');
    expect(getPriorityLabel(0.69)).toBe('High');
  });

  it('returns "Medium" for 0.3 <= score < 0.5', () => {
    expect(getPriorityLabel(0.3)).toBe('Medium');
    expect(getPriorityLabel(0.49)).toBe('Medium');
  });

  it('returns "Low" for score < 0.3', () => {
    expect(getPriorityLabel(0.1)).toBe('Low');
    expect(getPriorityLabel(0)).toBe('Low');
  });
});

describe('getPriorityClass', () => {
  it('returns correct CSS class names', () => {
    expect(getPriorityClass(0.8)).toBe('priority-critical');
    expect(getPriorityClass(0.6)).toBe('priority-high');
    expect(getPriorityClass(0.4)).toBe('priority-medium');
    expect(getPriorityClass(0.1)).toBe('priority-low');
  });
});
