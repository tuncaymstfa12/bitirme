/**
 * Tests for Topic Analyzer (question-based) module
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeTopicsFromQuestions,
  identifyWeakTopics,
  identifyStrongTopics,
  identifyUntestedTopics,
  identifyUncoveredTopics,
  buildWeakRows,
  mapAnalysisToTopics,
} from '../../src/engine/topicAnalyzer.js';

function makeQuestion(overrides = {}) {
  return {
    id: 'q-' + Math.random().toString(36).slice(2, 8),
    examType: 'TYT',
    track: 'sayisal',
    lesson: 'Matematik',
    topicName: 'Turev',
    difficulty: 3,
    ...overrides,
  };
}

function makeAnswer(questionId, isCorrect) {
  return {
    id: 'a-' + questionId,
    questionId,
    selectedOption: isCorrect ? 'A' : 'B',
    isCorrect,
    answeredAt: new Date().toISOString(),
  };
}

// --- analyzeTopicsFromQuestions ---

describe('analyzeTopicsFromQuestions', () => {
  it('returns empty array for no questions', () => {
    expect(analyzeTopicsFromQuestions([], [])).toHaveLength(0);
  });

  it('marks topics with no answers as untested', () => {
    const q = makeQuestion();
    const result = analyzeTopicsFromQuestions([q], []);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('untested');
    expect(result[0].totalQuestions).toBe(1);
    expect(result[0].answeredQuestions).toBe(0);
  });

  it('marks topics with all correct answers as strong', () => {
    const qs = [
      makeQuestion({ topicName: 'Turev', difficulty: 3 }),
      makeQuestion({ topicName: 'Turev', difficulty: 3 }),
      makeQuestion({ topicName: 'Turev', difficulty: 4 }),
      makeQuestion({ topicName: 'Turev', difficulty: 3 }),
      makeQuestion({ topicName: 'Turev', difficulty: 5 }),
    ];
    const answers = qs.map(q => makeAnswer(q.id, true));
    const result = analyzeTopicsFromQuestions(qs, answers);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('strong');
    expect(result[0].correct).toBe(5);
    expect(result[0].wrong).toBe(0);
  });

  it('marks topics with all wrong as critical', () => {
    const qs = [
      makeQuestion({ topicName: 'Turev' }),
      makeQuestion({ topicName: 'Turev' }),
      makeQuestion({ topicName: 'Turev' }),
    ];
    const answers = qs.map(q => makeAnswer(q.id, false));
    const result = analyzeTopicsFromQuestions(qs, answers);
    expect(result[0].status).toBe('critical');
  });

  it('applies confidence blending for small sample sizes', () => {
    // Only 1 question answered correctly => low confidence
    const q = makeQuestion();
    const answers = [makeAnswer(q.id, true)];
    const result = analyzeTopicsFromQuestions([q], answers);
    expect(result[0].confidence).toBeLessThan(1);
    // adjustedScore should be less than raw accuracy (1.0) due to confidence blending
    expect(result[0].adjustedScore).toBeLessThan(0.8);
    expect(result[0].adjustedScore).toBeGreaterThan(0.4);
  });

  it('applies difficulty weighting', () => {
    const qEasy = makeQuestion({ topicName: 'Turev', difficulty: 1 });
    const qHard = makeQuestion({ topicName: 'Turev', difficulty: 5 });
    const answers = [
      makeAnswer(qEasy.id, true),
      makeAnswer(qHard.id, false),
    ];

    const result = analyzeTopicsFromQuestions([qEasy, qHard], answers);
    // Missing a harder question penalizes more => weightedScore < raw accuracy
    expect(result[0].weightedScore).toBeLessThan(result[0].accuracy);
  });

  it('groups by lesson and topicName independently', () => {
    const qMath = makeQuestion({ lesson: 'Matematik', topicName: 'Turev' });
    const qPhys = makeQuestion({ lesson: 'Fizik', topicName: 'Turev' });
    const answers = [
      makeAnswer(qMath.id, true),
      makeAnswer(qPhys.id, false),
    ];
    const result = analyzeTopicsFromQuestions([qMath, qPhys], answers);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.lesson === 'Matematik').status).toBeDefined();
    expect(result.find(r => r.lesson === 'Fizik').status).toBeDefined();
  });

  it('filters by examType', () => {
    const qTyt = makeQuestion({ examType: 'TYT', lesson: 'Matematik', topicName: 'Kumeler' });
    const qAyt = makeQuestion({ examType: 'AYT', lesson: 'Matematik', topicName: 'Turev' });
    const result = analyzeTopicsFromQuestions([qTyt, qAyt], [], { examType: 'TYT' });
    expect(result).toHaveLength(1);
    expect(result[0].topicName).toBe('Kumeler');
  });

  it('filters by lesson', () => {
    const qMath = makeQuestion({ lesson: 'Matematik' });
    const qPhys = makeQuestion({ lesson: 'Fizik' });
    const result = analyzeTopicsFromQuestions([qMath, qPhys], [], { lesson: 'Matematik' });
    expect(result).toHaveLength(1);
    expect(result[0].lesson).toBe('Matematik');
  });

  it('sorts by severity: critical before weak before untested', () => {
    const qs = [
      makeQuestion({ lesson: 'Matematik', topicName: 'Critical' }),
      makeQuestion({ lesson: 'Matematik', topicName: 'Critical' }),
      makeQuestion({ lesson: 'Matematik', topicName: 'Critical' }),
      makeQuestion({ lesson: 'Fizik', topicName: 'Weak1' }),
      makeQuestion({ lesson: 'Fizik', topicName: 'Weak1' }),
      makeQuestion({ lesson: 'Fizik', topicName: 'Weak1' }),
      makeQuestion({ lesson: 'Kimya', topicName: 'Untested' }),
    ];
    const answers = [
      makeAnswer(qs[0].id, false),
      makeAnswer(qs[1].id, false),
      makeAnswer(qs[2].id, false),
      makeAnswer(qs[3].id, true),
      makeAnswer(qs[4].id, false),
      makeAnswer(qs[5].id, false),
    ];
    const result = analyzeTopicsFromQuestions(qs, answers);
    expect(result[0].status).toBe('critical');
    expect(result[1].status).toBe('weak');
    expect(result[2].status).toBe('untested');
  });
});

// --- identifyWeakTopics ---

describe('identifyWeakTopics', () => {
  it('returns only critical and weak topics', () => {
    const analyses = [
      { status: 'critical', topicName: 'A' },
      { status: 'weak', topicName: 'B' },
      { status: 'moderate', topicName: 'C' },
      { status: 'strong', topicName: 'D' },
      { status: 'untested', topicName: 'E' },
    ];
    const result = identifyWeakTopics(analyses);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.status).sort()).toEqual(['critical', 'weak']);
  });
});

// --- identifyStrongTopics ---

describe('identifyStrongTopics', () => {
  it('returns only strong topics', () => {
    const analyses = [
      { status: 'critical', topicName: 'A' },
      { status: 'strong', topicName: 'B' },
      { status: 'strong', topicName: 'C' },
      { status: 'untested', topicName: 'D' },
    ];
    const result = identifyStrongTopics(analyses);
    expect(result).toHaveLength(2);
  });
});

// --- identifyUntestedTopics ---

describe('identifyUntestedTopics', () => {
  it('returns only untested topics', () => {
    const analyses = [
      { status: 'untested', topicName: 'A' },
      { status: 'critical', topicName: 'B' },
      { status: 'untested', topicName: 'C' },
    ];
    const result = identifyUntestedTopics(analyses);
    expect(result).toHaveLength(2);
  });
});

// --- identifyUncoveredTopics ---

describe('identifyUncoveredTopics', () => {
  it('returns curriculum topics not present in questions', () => {
    const curriculum = {
      TYT: { 'Matematik': ['Turev', 'Kumeler', 'Fonksiyonlar', 'Olasilik'] },
    };
    const questions = [
      makeQuestion({ examType: 'TYT', lesson: 'Matematik', topicName: 'Turev' }),
    ];
    const result = identifyUncoveredTopics(questions, curriculum, 'TYT', 'Matematik');
    expect(result).toEqual(['Kumeler', 'Fonksiyonlar', 'Olasilik']);
  });

  it('returns empty array when all topics covered', () => {
    const curriculum = {
      TYT: { 'Matematik': ['Turev', 'Kumeler'] },
    };
    const questions = [
      makeQuestion({ examType: 'TYT', lesson: 'Matematik', topicName: 'Turev' }),
      makeQuestion({ examType: 'TYT', lesson: 'Matematik', topicName: 'Kumeler' }),
    ];
    const result = identifyUncoveredTopics(questions, curriculum, 'TYT', 'Matematik');
    expect(result).toEqual([]);
  });

  it('handles missing examType or lesson gracefully', () => {
    expect(identifyUncoveredTopics([], {}, 'TYT', 'Matematik')).toEqual([]);
    expect(identifyUncoveredTopics([], { TYT: {} }, 'TYT', 'Matematik')).toEqual([]);
  });
});

// --- buildWeakRows ---

describe('buildWeakRows', () => {
  it('returns empty array when no answers', () => {
    expect(buildWeakRows([makeQuestion()], [])).toHaveLength(0);
  });

  it('returns groups with wrongRate descending', () => {
    const qs = [
      makeQuestion({ lesson: 'Matematik', topicName: 'Turev' }),
      makeQuestion({ lesson: 'Matematik', topicName: 'Turev' }),
      makeQuestion({ lesson: 'Fizik', topicName: 'Kuvvet' }),
      makeQuestion({ lesson: 'Fizik', topicName: 'Kuvvet' }),
    ];
    const answers = [
      makeAnswer(qs[0].id, false),
      makeAnswer(qs[1].id, true),
      makeAnswer(qs[2].id, false),
      makeAnswer(qs[3].id, false),
    ];
    const result = buildWeakRows(qs, answers);
    expect(result).toHaveLength(2);
    expect(result[0].wrongRate).toBeGreaterThanOrEqual(result[1].wrongRate);
    // Fizik/Kuvvet has 100% wrong, should be first
    expect(result[0].topicName).toBe('Kuvvet');
  });

  it('filters out groups with zero wrong answers', () => {
    const q = makeQuestion();
    const answers = [makeAnswer(q.id, true)];
    expect(buildWeakRows([q], answers)).toHaveLength(0);
  });
});

// --- mapAnalysisToTopics ---

describe('mapAnalysisToTopics', () => {
  it('matches analyses to topics by lesson + name', () => {
    const analyses = [
      { lesson: 'Matematik', topicName: 'Turev', status: 'strong', adjustedScore: 0.9 },
      { lesson: 'Fizik', topicName: 'Kuvvet', status: 'weak', adjustedScore: 0.4 },
    ];
    const topics = [
      { id: 't1', name: 'Turev', lesson: 'Matematik' },
      { id: 't2', name: 'Kuvvet', lesson: 'Fizik' },
      { id: 't3', name: 'Other', lesson: 'Kimya' },
    ];
    const result = mapAnalysisToTopics(analyses, topics);
    expect(result[0].topicId).toBe('t1');
    expect(result[0].topic).toEqual(topics[0]);
    expect(result[1].topicId).toBe('t2');
  });

  it('returns null topic for unmatched analyses', () => {
    const analyses = [
      { lesson: 'Matematik', topicName: 'Bilinmeyen', status: 'strong', adjustedScore: 0.9 },
    ];
    const result = mapAnalysisToTopics(analyses, []);
    expect(result[0].topicId).toBeNull();
    expect(result[0].topic).toBeNull();
  });
});
