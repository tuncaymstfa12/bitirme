/**
 * Topic Analyzer (Question-based)
 * Analyzes topic performance from question answers (StudentAnswer + Question data).
 * Complements the mock-result-based performanceAnalyzer.js with question-level granularity.
 */

/**
 * @typedef {Object} TopicAnalysis
 * @property {string} lesson
 * @property {string} topicName
 * @property {string} examType
 * @property {number} totalQuestions    - Questions in bank for this (lesson, topicName)
 * @property {number} answeredQuestions - Questions with an answer
 * @property {number} correct
 * @property {number} wrong
 * @property {number} accuracy          - Raw accuracy (correct / answered), 0 if none
 * @property {number} weightedScore     - Difficulty-weighted accuracy (0-1)
 * @property {number} confidence        - Confidence based on sample size (0-1)
 * @property {number} adjustedScore     - Final score blending weightedScore with confidence
 * @property {'critical'|'weak'|'moderate'|'strong'|'untested'|'uncovered'} status
 */

const MIN_SAMPLE_SIZE = 5;
const STATUS_THRESHOLDS = { critical: 0.3, weak: 0.5, moderate: 0.7 };

/**
 * Calculate topic performance from questions and answers.
 * Groups by (lesson, topicName) and computes per-group metrics.
 *
 * @param {Array} questions   - Question objects (must have lesson, topicName, difficulty, id)
 * @param {Array} answers     - StudentAnswer objects (must have questionId, isCorrect)
 * @param {Object} [filters]  - Optional { examType, track, lesson }
 * @returns {TopicAnalysis[]} Sorted by severity (worst first)
 */
export function analyzeTopicsFromQuestions(questions, answers, filters = {}) {
  const answerMap = new Map(answers.map(a => [a.questionId, a]));

  let filtered = questions;
  if (filters.examType) filtered = filtered.filter(q => q.examType === filters.examType);
  if (filters.track) filtered = filtered.filter(q => q.track === filters.track);
  if (filters.lesson) filtered = filtered.filter(q => q.lesson === filters.lesson);

  const buckets = new Map();

  for (const q of filtered) {
    const key = q.lesson + '|' + q.topicName;
    if (!buckets.has(key)) {
      buckets.set(key, {
        lesson: q.lesson,
        topicName: q.topicName,
        examType: q.examType,
        questions: [],
      });
    }
    buckets.get(key).questions.push(q);
  }

  const results = [];
  for (const [, bucket] of buckets) {
    const analysis = computeTopicAnalysis(bucket, answerMap);
    results.push(analysis);
  }

  const severity = { critical: 0, weak: 1, untested: 2, moderate: 3, strong: 4, uncovered: 5 };
  results.sort((a, b) => severity[a.status] - severity[b.status]
    || a.adjustedScore - b.adjustedScore);

  return results;
}

function computeTopicAnalysis(bucket, answerMap) {
  const { lesson, topicName, examType, questions } = bucket;
  const totalQuestions = questions.length;
  let correct = 0;
  let wrong = 0;
  let weightedCorrect = 0;
  let weightedTotal = 0;

  for (const q of questions) {
    const answer = answerMap.get(q.id);
    if (!answer) continue;

    const difficulty = clampDifficulty(q.difficulty);
    weightedTotal += difficulty;

    if (answer.isCorrect) {
      correct++;
      weightedCorrect += difficulty;
    } else {
      wrong++;
    }
  }

  const answeredQuestions = correct + wrong;

  if (totalQuestions === 0) {
    return createEmptyAnalysis(lesson, topicName, examType, 'uncovered');
  }

  if (answeredQuestions === 0) {
    return {
      lesson,
      topicName,
      examType,
      totalQuestions,
      answeredQuestions: 0,
      correct: 0,
      wrong: 0,
      accuracy: 0,
      weightedScore: 0,
      confidence: 0,
      adjustedScore: 0,
      status: 'untested',
    };
  }

  const accuracy = correct / answeredQuestions;
  const weightedScore = weightedTotal > 0 ? weightedCorrect / weightedTotal : 0;
  const confidence = Math.min(1, answeredQuestions / MIN_SAMPLE_SIZE);
  const adjustedScore = confidence * weightedScore + (1 - confidence) * 0.5;

  let status = 'strong';
  if (adjustedScore < STATUS_THRESHOLDS.critical) status = 'critical';
  else if (adjustedScore < STATUS_THRESHOLDS.weak) status = 'weak';
  else if (adjustedScore < STATUS_THRESHOLDS.moderate) status = 'moderate';

  return {
    lesson,
    topicName,
    examType,
    totalQuestions,
    answeredQuestions,
    correct,
    wrong,
    accuracy: round(accuracy),
    weightedScore: round(weightedScore),
    confidence: round(confidence),
    adjustedScore: round(adjustedScore),
    status,
  };
}

/**
 * Filter analysis results to only weak/critical topics (eksik konular).
 */
export function identifyWeakTopics(analyses) {
  return analyses.filter(a => a.status === 'critical' || a.status === 'weak');
}

/**
 * Filter analysis results to only strong topics (iyi konular).
 */
export function identifyStrongTopics(analyses) {
  return analyses.filter(a => a.status === 'strong');
}

/**
 * Filter analysis to topics with zero answers despite having questions (untested).
 */
export function identifyUntestedTopics(analyses) {
  return analyses.filter(a => a.status === 'untested');
}

/**
 * Identify topics from the curriculum that have ZERO questions in the bank.
 *
 * @param {Array} questions     - All questions in the bank
 * @param {Object} curriculum   - { TYT: { lesson: [topicName, ...] }, AYT: { lesson: [...] } }
 * @param {string} examType     - 'TYT' | 'AYT'
 * @param {string} lesson       - e.g. 'Matematik'
 * @returns {string[]} Topic names not covered by any question
 */
export function identifyUncoveredTopics(questions, curriculum, examType, lesson) {
  const curriculumTopics = (curriculum[examType] && curriculum[examType][lesson]) || [];
  const coveredMap = new Set();
  for (const q of questions) {
    if (q.examType === examType && q.lesson === lesson && q.topicName) {
      coveredMap.add(q.topicName);
    }
  }
  return curriculumTopics.filter(t => !coveredMap.has(t));
}

/**
 * Build a simple weakness table (wrong-rate focused) for question analysis display.
 */
export function buildWeakRows(questions, answers) {
  const questionMap = new Map(questions.map(q => [q.id, q]));
  const rows = new Map();

  for (const a of answers) {
    const q = questionMap.get(a.questionId);
    if (!q) continue;
    const key = q.lesson + '|' + q.topicName;
    if (!rows.has(key)) {
      rows.set(key, { lesson: q.lesson, topicName: q.topicName, correct: 0, wrong: 0 });
    }
    const row = rows.get(key);
    if (a.isCorrect) row.correct++;
    else row.wrong++;
  }

  return [...rows.values()]
    .filter(row => row.wrong > 0)
    .map(row => ({
      ...row,
      wrongRate: Math.round((row.wrong / Math.max(1, row.correct + row.wrong)) * 100),
    }))
    .sort((a, b) => b.wrongRate - a.wrongRate || b.wrong - a.wrong);
}

/**
 * Map question-based analysis to match Topic entities by name + lesson.
 */
export function mapAnalysisToTopics(analyses, topics) {
  const topicMap = new Map();
  for (const t of topics) {
    const key = (t.lesson || '') + '|' + t.name;
    if (!topicMap.has(key)) topicMap.set(key, t);
  }

  return analyses.map(a => {
    const key = a.lesson + '|' + a.topicName;
    const matched = topicMap.get(key) || null;
    return { ...a, topic: matched, topicId: matched ? matched.id : null };
  });
}

function clampDifficulty(d) {
  const v = Number(d);
  if (!v || v < 1) return 1;
  if (v > 5) return 5;
  return v;
}

function createEmptyAnalysis(lesson, topicName, examType, status) {
  return {
    lesson,
    topicName,
    examType,
    totalQuestions: 0,
    answeredQuestions: 0,
    correct: 0,
    wrong: 0,
    accuracy: 0,
    weightedScore: 0,
    confidence: 0,
    adjustedScore: 0,
    status,
  };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
