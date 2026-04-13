/**
 * Dynamic Rescheduler
 * Handles missed sessions and re-optimizes the study plan
 * by redistributing load based on updated priorities.
 */

import { rankTopics } from './priorityCalculator.js';
import { generateSchedule, generateAvailableSlots } from './scheduler.js';
import { createStudySession, generateId } from '../data/models.js';

/**
 * Handle missed sessions and regenerate the schedule
 * @param {Array} missedSessionIds - IDs of sessions marked as missed
 * @param {Array} allSessions - Current full session list
 * @param {Array} exams - All exams
 * @param {Array} topics - All topics
 * @param {Array} mockResults - All mock results
 * @param {Object} availability - Daily availability
 * @param {Object} constraints - Scheduling constraints
 * @param {Object} weights - Priority weights
 * @returns {Object} { newSessions, changes, warnings }
 */
export function handleMissedSessions(
  missedSessionIds,
  allSessions,
  exams,
  topics,
  mockResults,
  availability,
  constraints,
  weights
) {
  // 1. Identify what was missed
  const missedSessions = allSessions.filter(s => missedSessionIds.includes(s.id));
  const missedTopicIds = [...new Set(missedSessions.map(s => s.topicId).filter(Boolean))];
  const missedMinutesByTopic = {};
  
  for (const session of missedSessions) {
    if (!session.topicId) continue;
    missedMinutesByTopic[session.topicId] = 
      (missedMinutesByTopic[session.topicId] || 0) + session.durationMinutes;
  }

  // 2. Get today's date as the new start
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // 3. Find the latest exam date
  const futureExams = exams.filter(e => new Date(e.date) >= today);
  if (futureExams.length === 0) {
    return { newSessions: allSessions, changes: [], warnings: ['No future exams found.'] };
  }
  const latestExamDate = futureExams.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date;

  // 4. Keep completed sessions, remove future scheduled ones
  const completedSessions = allSessions.filter(s => s.status === 'completed');
  const markedMissedSessions = allSessions.filter(s => s.status === 'missed');

  // 5. Update topic completed minutes from completed sessions
  const updatedTopics = topics.map(t => {
    const completedForTopic = completedSessions.filter(s => s.topicId === t.id);
    const completedMinutes = completedForTopic.reduce((sum, s) => sum + s.durationMinutes, 0);
    return { ...t, completedMinutes };
  });

  // 6. Recalculate priorities (urgency will naturally increase for closer exams)
  const ranked = rankTopics(futureExams, updatedTopics, mockResults, weights);

  // 7. Boost priority for missed topics
  const boostedRanked = ranked.map(r => {
    if (missedTopicIds.includes(r.topic.id)) {
      const missedBoost = Math.min(0.2, (missedMinutesByTopic[r.topic.id] || 0) / 300);
      return {
        ...r,
        score: Math.min(1.0, r.score + missedBoost),
        wasMissed: true,
      };
    }
    return r;
  });

  // Re-sort after boosting
  boostedRanked.sort((a, b) => b.score - a.score);

  // 8. Check if we need to compress or extend
  const availableSlots = generateAvailableSlots(availability, constraints, todayStr, latestExamDate);
  const totalAvailable = availableSlots.length;
  const totalNeeded = boostedRanked.reduce((sum, r) => {
    const weaknessFactor = (6 - r.topic.selfAssessment) / 5;
    const baseSlots = Math.ceil(r.topic.estimatedMinutes / (constraints.slotDurationMinutes || 30));
    const remaining = baseSlots - Math.floor((r.topic.completedMinutes || 0) / (constraints.slotDurationMinutes || 30));
    return sum + Math.max(0, remaining);
  }, 0);

  const warnings = [];
  let effectiveConstraints = { ...constraints };

  if (totalNeeded > totalAvailable) {
    // Apply compression to low-priority topics
    const compressionFactor = constraints.rescheduling?.compressionFactor || 0.75;
    const threshold = constraints.rescheduling?.mediumPriorityThreshold || 0.4;

    for (const r of boostedRanked) {
      if (r.score < threshold) {
        r.topic = {
          ...r.topic,
          estimatedMinutes: Math.ceil(r.topic.estimatedMinutes * compressionFactor),
        };
      }
    }

    // Extend daily max slightly
    const extension = Math.min(
      constraints.rescheduling?.maxDailyExtension || 2,
      Math.ceil((totalNeeded - totalAvailable) / 7)
    );
    effectiveConstraints.maxDailySlotsCount = constraints.maxDailySlotsCount + extension;
    
    if (extension > 0) {
      warnings.push(`Daily study time extended by ${extension * 30} minutes to accommodate missed sessions.`);
    }
    warnings.push(`Study load is heavy. Low-priority topics have been compressed.`);
  }

  // 9. Generate new schedule
  const newScheduledSessions = generateSchedule(
    boostedRanked,
    availability,
    effectiveConstraints,
    todayStr,
    latestExamDate
  );

  // 10. Generate change log
  const changes = generateChanges(missedSessions, boostedRanked.filter(r => r.wasMissed));

  // 11. Combine: completed + missed (as history) + new schedule
  const finalSessions = [
    ...completedSessions,
    ...markedMissedSessions,
    ...newScheduledSessions,
  ];

  return { newSessions: finalSessions, changes, warnings };
}

/**
 * Full reschedule from scratch (e.g., when exams change)
 */
export function fullReschedule(exams, topics, mockResults, availability, constraints, weights) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const futureExams = exams.filter(e => new Date(e.date) >= today);
  if (futureExams.length === 0) {
    return { sessions: [], warnings: ['No future exams to schedule.'] };
  }

  const latestExamDate = futureExams.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date;
  const ranked = rankTopics(futureExams, topics, mockResults, weights);

  const sessions = generateSchedule(ranked, availability, constraints, todayStr, latestExamDate);
  return { sessions, warnings: [] };
}

/**
 * Generate a change diff between missed and rescheduled sessions
 */
function generateChanges(missedSessions, rescheduledTopics) {
  const changes = [];

  for (const missed of missedSessions) {
    changes.push({
      type: 'missed',
      topicId: missed.topicId,
      originalDate: missed.date,
      originalTime: `${String(missed.startHour).padStart(2, '0')}:${String(missed.startMinute).padStart(2, '0')}`,
      message: `Missed session rescheduled with priority boost`,
    });
  }

  for (const rt of rescheduledTopics) {
    changes.push({
      type: 'boosted',
      topicId: rt.topic.id,
      score: rt.score,
      message: `Priority boosted to ${(rt.score * 100).toFixed(0)}% due to missed session`,
    });
  }

  return changes;
}

/**
 * Suggest recovery actions when too many sessions are missed
 */
export function suggestRecoveryActions(missedCount, totalRemaining, daysUntilNextExam) {
  const suggestions = [];

  if (missedCount > totalRemaining * 0.3) {
    suggestions.push({
      severity: 'critical',
      message: 'More than 30% of sessions have been missed. Consider extending daily study time.',
      action: 'extend_daily',
    });
  }

  if (daysUntilNextExam <= 3 && missedCount > 2) {
    suggestions.push({
      severity: 'critical',
      message: 'Exam is very close. Focus only on high-weight, weak topics.',
      action: 'focus_critical',
    });
  }

  if (missedCount >= 5) {
    suggestions.push({
      severity: 'warning',
      message: 'Consider merging related topics into combined review sessions.',
      action: 'merge_topics',
    });
  }

  if (daysUntilNextExam > 7 && missedCount <= 3) {
    suggestions.push({
      severity: 'info',
      message: 'Missed sessions have been redistributed across remaining days.',
      action: 'redistributed',
    });
  }

  return suggestions;
}
