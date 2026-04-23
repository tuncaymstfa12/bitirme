/**
 * Tests for Performance Analyzer module
 * Verifies mastery calculation, trend detection, consistency scoring,
 * weak area identification, and insight generation.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTopicMastery,
  detectTrend,
  calculateConsistency,
  identifyWeakAreas,
  generateInsights,
  getMasteryRadarData,
} from '../../src/engine/performanceAnalyzer.js';

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

function makeMockResult(overrides = {}) {
  return {
    id: 'mock-1',
    topicId: 'topic-1',
    score: 50,
    maxScore: 100,
    date: pastDate(1),
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
    ...overrides,
  };
}

function makeExam(overrides = {}) {
  return {
    id: 'exam-1',
    name: 'Test Exam',
    date: futureDate(7),
    color: '#6366f1',
    ...overrides,
  };
}

// --- Tests ---

describe('detectTrend', () => {
  it('returns 0.5 for insufficient data (< 2 scores)', () => {
    expect(detectTrend([])).toBe(0.5);
    expect(detectTrend([0.5])).toBe(0.5);
  });

  it('returns > 0.5 for improving scores', () => {
    const trend = detectTrend([0.2, 0.4, 0.6, 0.8]);
    expect(trend).toBeGreaterThan(0.5);
  });

  it('returns < 0.5 for declining scores', () => {
    const trend = detectTrend([0.8, 0.6, 0.4, 0.2]);
    expect(trend).toBeLessThan(0.5);
  });

  it('returns approximately 0.5 for flat scores', () => {
    const trend = detectTrend([0.5, 0.5, 0.5, 0.5]);
    expect(trend).toBeCloseTo(0.5, 1);
  });

  it('returns value between 0 and 1', () => {
    const trend = detectTrend([0.1, 0.9, 0.2, 0.8, 0.3]);
    expect(trend).toBeGreaterThanOrEqual(0);
    expect(trend).toBeLessThanOrEqual(1);
  });
});

describe('calculateConsistency', () => {
  it('returns 0.5 for insufficient data', () => {
    expect(calculateConsistency([])).toBe(0.5);
    expect(calculateConsistency([0.5])).toBe(0.5);
  });

  it('returns high consistency for identical scores', () => {
    const consistency = calculateConsistency([0.7, 0.7, 0.7, 0.7]);
    expect(consistency).toBeCloseTo(1.0, 1);
  });

  it('returns lower consistency for varying scores', () => {
    const stable = calculateConsistency([0.5, 0.5, 0.5]);
    const unstable = calculateConsistency([0.1, 0.9, 0.1, 0.9]);
    expect(stable).toBeGreaterThan(unstable);
  });

  it('returns value between 0 and 1', () => {
    const consistency = calculateConsistency([0.1, 0.5, 0.9]);
    expect(consistency).toBeGreaterThanOrEqual(0);
    expect(consistency).toBeLessThanOrEqual(1);
  });
});

describe('calculateTopicMastery', () => {
  it('returns null when no mock results exist', () => {
    expect(calculateTopicMastery('topic-1', [])).toBeNull();
  });

  it('returns value between 0 and 1 for valid data', () => {
    const mocks = [
      makeMockResult({ id: 'm1', score: 60, date: pastDate(3) }),
      makeMockResult({ id: 'm2', score: 70, date: pastDate(1) }),
    ];
    const mastery = calculateTopicMastery('topic-1', mocks);
    expect(mastery).toBeGreaterThanOrEqual(0);
    expect(mastery).toBeLessThanOrEqual(1);
  });

  it('returns higher mastery for high scores', () => {
    const highMocks = [
      makeMockResult({ id: 'm1', score: 90, date: pastDate(2) }),
      makeMockResult({ id: 'm2', score: 95, date: pastDate(1) }),
    ];
    const lowMocks = [
      makeMockResult({ id: 'm3', topicId: 'topic-2', score: 20, date: pastDate(2) }),
      makeMockResult({ id: 'm4', topicId: 'topic-2', score: 25, date: pastDate(1) }),
    ];

    const highMastery = calculateTopicMastery('topic-1', highMocks);
    const lowMastery = calculateTopicMastery('topic-2', lowMocks);
    expect(highMastery).toBeGreaterThan(lowMastery);
  });

  it('ignores results from other topics', () => {
    const mocks = [
      makeMockResult({ id: 'm1', topicId: 'other', score: 95 }),
    ];
    expect(calculateTopicMastery('topic-1', mocks)).toBeNull();
  });
});

describe('identifyWeakAreas', () => {
  it('returns empty array for no topics', () => {
    expect(identifyWeakAreas([], [])).toHaveLength(0);
  });

  it('marks untested topics as "untested"', () => {
    const topics = [makeTopic()];
    const result = identifyWeakAreas(topics, []);
    expect(result[0].status).toBe('untested');
    expect(result[0].testCount).toBe(0);
  });

  it('marks low-mastery topics as "critical"', () => {
    const topics = [makeTopic()];
    // Need 3+ declining low scores to get mastery < 0.3
    // (trend and consistency inflate composite score with only 2 flat scores)
    const mocks = [
      makeMockResult({ id: 'm1', score: 25, date: pastDate(5) }),
      makeMockResult({ id: 'm2', score: 15, date: pastDate(3) }),
      makeMockResult({ id: 'm3', score: 5, date: pastDate(1) }),
    ];

    const result = identifyWeakAreas(topics, mocks);
    expect(result[0].status).toBe('critical');
  });

  it('marks high-mastery topics as "strong"', () => {
    const topics = [makeTopic()];
    const mocks = [
      makeMockResult({ id: 'm1', score: 90, date: pastDate(3) }),
      makeMockResult({ id: 'm2', score: 95, date: pastDate(1) }),
    ];

    const result = identifyWeakAreas(topics, mocks);
    expect(result[0].status).toBe('strong');
  });

  it('sorts results by severity (critical first)', () => {
    const topics = [
      makeTopic({ id: 't1', name: 'Strong' }),
      makeTopic({ id: 't2', name: 'Weak' }),
    ];
    const mocks = [
      makeMockResult({ id: 'm1', topicId: 't1', score: 90, date: pastDate(2) }),
      makeMockResult({ id: 'm2', topicId: 't1', score: 95, date: pastDate(1) }),
      makeMockResult({ id: 'm3', topicId: 't2', score: 10, date: pastDate(2) }),
      makeMockResult({ id: 'm4', topicId: 't2', score: 15, date: pastDate(1) }),
    ];

    const result = identifyWeakAreas(topics, mocks);
    const statusOrder = { critical: 0, weak: 1, untested: 2, moderate: 3, strong: 4 };
    for (let i = 1; i < result.length; i++) {
      expect(statusOrder[result[i].status]).toBeGreaterThanOrEqual(statusOrder[result[i - 1].status]);
    }
  });
});

describe('generateInsights', () => {
  it('returns empty array when no data', () => {
    expect(generateInsights([], [], [], [])).toHaveLength(0);
  });

  it('generates warning for exam within 7 days', () => {
    const exams = [makeExam({ date: futureDate(5) })];
    const topics = [makeTopic()];

    const insights = generateInsights(exams, topics, [], []);
    const warnings = insights.filter(i => i.type === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('generates critical insight for exam within 3 days with weak topics', () => {
    const exams = [makeExam({ date: futureDate(2) })];
    const topics = [makeTopic()];
    // Need 3 declining low scores to produce mastery < 0.4
    const mocks = [
      makeMockResult({ id: 'm1', score: 25, date: pastDate(5) }),
      makeMockResult({ id: 'm2', score: 15, date: pastDate(3) }),
      makeMockResult({ id: 'm3', score: 5, date: pastDate(1) }),
    ];

    const insights = generateInsights(exams, topics, mocks, []);
    const critical = insights.filter(i => i.type === 'critical');
    expect(critical.length).toBeGreaterThan(0);
  });

  it('generates success insight for high completion rate', () => {
    const sessions = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'missed' },
    ];

    const insights = generateInsights([], [], [], sessions);
    const success = insights.filter(i => i.type === 'success');
    expect(success.length).toBeGreaterThan(0);
  });

  it('generates warning for low completion rate', () => {
    const sessions = [
      { status: 'completed' },
      { status: 'missed' },
      { status: 'missed' },
      { status: 'missed' },
    ];

    const insights = generateInsights([], [], [], sessions);
    const warnings = insights.filter(i => i.type === 'warning' && i.title.includes('Consistency'));
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('skips past exams', () => {
    const exams = [makeExam({ date: pastDate(5) })];
    const insights = generateInsights(exams, [], [], []);
    const examInsights = insights.filter(i => i.examId);
    expect(examInsights).toHaveLength(0);
  });
});

describe('getMasteryRadarData', () => {
  it('returns data for all topics', () => {
    const topics = [
      makeTopic({ id: 't1', name: 'A' }),
      makeTopic({ id: 't2', name: 'B' }),
    ];
    const result = getMasteryRadarData(topics, []);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('A');
    expect(result[1].label).toBe('B');
  });

  it('marks untested topics with value 0 and status "untested"', () => {
    const topics = [makeTopic()];
    const result = getMasteryRadarData(topics, []);
    expect(result[0].value).toBe(0);
    expect(result[0].status).toBe('untested');
  });

  it('assigns correct status based on mastery level', () => {
    const topics = [makeTopic()];
    const highMocks = [
      makeMockResult({ id: 'm1', score: 90, date: pastDate(2) }),
      makeMockResult({ id: 'm2', score: 95, date: pastDate(1) }),
    ];

    const result = getMasteryRadarData(topics, highMocks);
    expect(result[0].status).toBe('strong');
    expect(result[0].value).toBeGreaterThan(0.7);
  });
});
