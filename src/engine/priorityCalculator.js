/**
 * Priority Calculator
 * Calculates weighted priority scores for topics based on
 * exam urgency, topic weight, student weakness, and performance gaps.
 */

/**
 * Calculate priority score for a single topic
 * @returns {number} Priority score between 0 and 1
 */
export function calculatePriorityScore(topic, exam, mockResults = [], weights = null) {
  const w = weights || {
    urgency: 0.35,
    topicWeight: 0.25,
    weakness: 0.25,
    performance: 0.15,
  };

  const urgency = getUrgencyScore(exam.date);
  const topicW = normalizeWeight(topic.weight);
  const weakness = getWeaknessScore(topic.selfAssessment);
  const perfGap = getPerformanceGap(topic.id, mockResults);

  const score = 
    w.urgency * urgency +
    w.topicWeight * topicW +
    w.weakness * weakness +
    w.performance * perfGap;

  return Math.round(score * 1000) / 1000;
}

/**
 * Rank all topics by priority score
 * @returns {Array} Sorted array of { topic, exam, score, breakdown }
 */
export function rankTopics(exams, topics, mockResults = [], weights = null) {
  const ranked = [];

  for (const topic of topics) {
    const exam = exams.find(e => e.id === topic.examId);
    if (!exam) continue;

    // Skip if exam has already passed
    const examDate = new Date(exam.date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (examDate < now) continue;

    const w = weights || {
      urgency: 0.35,
      topicWeight: 0.25,
      weakness: 0.25,
      performance: 0.15,
    };

    const urgency = getUrgencyScore(exam.date);
    const topicW = normalizeWeight(topic.weight);
    const weakness = getWeaknessScore(topic.selfAssessment);
    const perfGap = getPerformanceGap(topic.id, mockResults);

    const score = 
      w.urgency * urgency +
      w.topicWeight * topicW +
      w.weakness * weakness +
      w.performance * perfGap;

    ranked.push({
      topic,
      exam,
      score: Math.round(score * 1000) / 1000,
      breakdown: {
        urgency: Math.round(urgency * 1000) / 1000,
        topicWeight: Math.round(topicW * 1000) / 1000,
        weakness: Math.round(weakness * 1000) / 1000,
        performanceGap: Math.round(perfGap * 1000) / 1000,
      },
    });
  }

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * Urgency score based on exam proximity
 * Closer exams → higher urgency (non-linear decay)
 */
export function getUrgencyScore(examDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exam = new Date(examDate);
  exam.setHours(0, 0, 0, 0);
  
  const daysUntil = Math.max(0, (exam - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntil <= 0) return 1.0; // Exam today or passed
  if (daysUntil <= 1) return 0.95;
  if (daysUntil <= 3) return 0.85;
  if (daysUntil <= 7) return 0.7;
  if (daysUntil <= 14) return 0.5;
  if (daysUntil <= 30) return 0.3;
  return 0.1;
}

/**
 * Weakness score: inverted self-assessment
 * Lower self-assessment → higher weakness score
 */
export function getWeaknessScore(selfAssessment) {
  return (6 - Math.max(1, Math.min(5, selfAssessment))) / 5;
}

/**
 * Performance gap from mock test results
 * Lower scores → higher gap (more study needed)
 */
export function getPerformanceGap(topicId, mockResults) {
  const topicResults = mockResults.filter(r => r.topicId === topicId);
  
  if (topicResults.length === 0) return 0.5; // No data → assume moderate gap
  
  // Use the latest result primarily, with some weight to average
  const sorted = [...topicResults].sort((a, b) => new Date(b.date) - new Date(a.date));
  const latestNormalized = sorted[0].score / sorted[0].maxScore;
  
  const avgNormalized = topicResults.reduce((sum, r) => sum + r.score / r.maxScore, 0) / topicResults.length;
  
  // Weighted: 70% latest, 30% average
  const effectiveScore = 0.7 * latestNormalized + 0.3 * avgNormalized;
  
  return Math.round((1 - effectiveScore) * 1000) / 1000;
}

/**
 * Normalize topic weight from 1-10 scale to 0-1
 */
function normalizeWeight(weight) {
  return (Math.max(1, Math.min(10, weight)) - 1) / 9;
}

/**
 * Get priority label from score
 */
export function getPriorityLabel(score) {
  if (score >= 0.7) return 'Critical';
  if (score >= 0.5) return 'High';
  if (score >= 0.3) return 'Medium';
  return 'Low';
}

/**
 * Get priority CSS class from score
 */
export function getPriorityClass(score) {
  if (score >= 0.7) return 'priority-critical';
  if (score >= 0.5) return 'priority-high';
  if (score >= 0.3) return 'priority-medium';
  return 'priority-low';
}
