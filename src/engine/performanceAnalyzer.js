/**
 * Performance Analyzer
 * Tracks topic-level performance, detects trends, and generates insights.
 */

/**
 * Calculate topic mastery score
 * Combines latest mock score, trend, and consistency
 * @returns {number} Mastery score between 0 and 1
 */
export function calculateTopicMastery(topicId, mockResults) {
  const results = mockResults
    .filter(r => r.topicId === topicId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (results.length === 0) return null;

  const scores = results.map(r => r.score / r.maxScore);

  const latestScore = scores[scores.length - 1];
  const trend = detectTrend(scores);
  const consistency = calculateConsistency(scores);

  const mastery = 
    0.4 * latestScore +
    0.3 * trend +
    0.3 * consistency;

  return Math.round(mastery * 1000) / 1000;
}

/**
 * Detect performance trend using simple linear regression
 * @returns {number} Trend score 0-1 (0.5 = flat, >0.5 = improving, <0.5 = declining)
 */
export function detectTrend(scores) {
  if (scores.length < 2) return 0.5; // Insufficient data

  const n = scores.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  // Normalize slope to 0-1 range
  // Typical slope range: -0.3 to +0.3
  const normalizedSlope = Math.max(0, Math.min(1, (slope + 0.3) / 0.6));
  return Math.round(normalizedSlope * 1000) / 1000;
}

/**
 * Calculate consistency score based on variance
 * @returns {number} 0-1 (1 = very consistent, 0 = very inconsistent)
 */
export function calculateConsistency(scores) {
  if (scores.length < 2) return 0.5;

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (mean === 0) return 0;
  
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean; // coefficient of variation

  // Lower CV = more consistent
  const consistency = Math.max(0, Math.min(1, 1 - cv));
  return Math.round(consistency * 1000) / 1000;
}

/**
 * Identify weak areas across all topics
 * @returns {Array} Sorted weak areas with details
 */
export function identifyWeakAreas(topics, mockResults) {
  const weakAreas = [];

  for (const topic of topics) {
    const results = mockResults.filter(r => r.topicId === topic.id);
    const mastery = calculateTopicMastery(topic.id, mockResults);
    const scores = results.map(r => r.score / r.maxScore);
    const trend = detectTrend(scores);

    let status = 'unknown';
    if (mastery === null) {
      status = 'untested';
    } else if (mastery < 0.3) {
      status = 'critical';
    } else if (mastery < 0.5) {
      status = 'weak';
    } else if (mastery < 0.7) {
      status = 'moderate';
    } else {
      status = 'strong';
    }

    weakAreas.push({
      topic,
      mastery,
      trend,
      status,
      testCount: results.length,
      latestScore: results.length > 0 
        ? results.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        : null,
    });
  }

  // Sort: critical first, then weak, etc.
  const statusOrder = { critical: 0, weak: 1, untested: 2, moderate: 3, strong: 4, unknown: 5 };
  weakAreas.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return weakAreas;
}

/**
 * Generate text-based insights and recommendations
 */
export function generateInsights(exams, topics, mockResults, sessions) {
  const insights = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Exam proximity warnings
  for (const exam of exams) {
    const examDate = new Date(exam.date);
    const daysUntil = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) continue;

    const examTopics = topics.filter(t => t.examId === exam.id);
    const weakTopics = examTopics.filter(t => {
      const mastery = calculateTopicMastery(t.id, mockResults);
      return mastery !== null && mastery < 0.4;
    });
    const untestedTopics = examTopics.filter(t => {
      return mockResults.filter(r => r.topicId === t.id).length === 0;
    });

    if (daysUntil <= 3 && weakTopics.length > 0) {
      insights.push({
        type: 'critical',
        icon: '🚨',
        title: `${exam.name} in ${daysUntil} day(s)`,
        message: `${weakTopics.length} topic(s) still weak: ${weakTopics.map(t => t.name).join(', ')}. Focus all effort here.`,
        examId: exam.id,
      });
    } else if (daysUntil <= 7) {
      insights.push({
        type: 'warning',
        icon: '⚠️',
        title: `${exam.name} in ${daysUntil} day(s)`,
        message: `${untestedTopics.length} untested topic(s). Consider taking practice tests.`,
        examId: exam.id,
      });
    }
  }

  // Study consistency
  const completedSessions = sessions.filter(s => s.status === 'completed');
  const missedSessions = sessions.filter(s => s.status === 'missed');
  const totalAttempted = completedSessions.length + missedSessions.length;

  if (totalAttempted > 0) {
    const completionRate = completedSessions.length / totalAttempted;
    if (completionRate < 0.5) {
      insights.push({
        type: 'warning',
        icon: '📉',
        title: 'Low Study Consistency',
        message: `Completion rate is ${(completionRate * 100).toFixed(0)}%. Missing sessions reduces the effectiveness of the study plan.`,
      });
    } else if (completionRate >= 0.8) {
      insights.push({
        type: 'success',
        icon: '🌟',
        title: 'Great Consistency!',
        message: `${(completionRate * 100).toFixed(0)}% completion rate. Keep up the excellent work!`,
      });
    }
  }

  // Improvement trends
  for (const topic of topics) {
    const results = mockResults.filter(r => r.topicId === topic.id);
    if (results.length >= 3) {
      const scores = results
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(r => r.score / r.maxScore);
      const trend = detectTrend(scores);

      if (trend > 0.7) {
        insights.push({
          type: 'success',
          icon: '📈',
          title: `${topic.name} Improving`,
          message: `Performance is trending upward. Great progress!`,
        });
      } else if (trend < 0.3) {
        insights.push({
          type: 'warning',
          icon: '📉',
          title: `${topic.name} Declining`,
          message: `Performance is dropping. Consider more focused review sessions.`,
        });
      }
    }
  }

  return insights;
}

/**
 * Get mastery data formatted for radar chart
 */
export function getMasteryRadarData(topics, mockResults) {
  return topics.map(topic => {
    const mastery = calculateTopicMastery(topic.id, mockResults);
    return {
      label: topic.name,
      value: mastery !== null ? mastery : 0,
      status: mastery === null ? 'untested' : 
              mastery < 0.3 ? 'critical' :
              mastery < 0.5 ? 'weak' :
              mastery < 0.7 ? 'moderate' : 'strong',
    };
  });
}

/**
 * Get daily consistency data for Heatmap (last 90 days)
 */
export function getConsistencyData(sessions, days = 90) {
  const data = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Initialize days
  const dayMap = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    dayMap[dateStr] = 0;
  }

  // Count completed sessions
  const completed = sessions.filter(s => s.status === 'completed' && s.date);
  completed.forEach(s => {
    if (dayMap[s.date] !== undefined) {
      dayMap[s.date]++;
    }
  });

  // Calculate levels (0 to 4)
  for (const date in dayMap) {
    const count = dayMap[date];
    let level = 0;
    if (count === 1) level = 1;
    else if (count === 2) level = 2;
    else if (count >= 3 && count <= 4) level = 3;
    else if (count > 4) level = 4;
    
    data.push({ date, count, level });
  }

  return data;
}
