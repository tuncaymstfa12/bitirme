/**
 * Constraint-Based Scheduler
 * Allocates study topics into time slots using greedy priority-based scheduling
 * with constraint enforcement (breaks, variety, fatigue limits).
 */

import { createStudySession, generateId } from '../data/models.js';
import { validateSchedule } from './rules.js';

/**
 * Generate a complete study schedule
 * @param {Array} rankedTopics - Output from rankTopics()
 * @param {Object} availability - Daily availability from settings
 * @param {Object} constraints - Scheduling constraints
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD (typically latest exam date)
 * @returns {Array} Array of StudySession objects
 */
export function generateSchedule(rankedTopics, availability, constraints, startDate, endDate) {
  const slots = generateAvailableSlots(availability, constraints, startDate, endDate);
  const sessions = allocateSlots(rankedTopics, slots, constraints);
  const withBreaks = insertBreaks(sessions, constraints);
  return withBreaks;
}

/**
 * Generate all available time slots for the planning window
 */
export function generateAvailableSlots(availability, constraints, startDate, endDate) {
  const slots = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const slotDuration = constraints.slotDurationMinutes || 30;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    const dayAvailability = availability[dayOfWeek] || [];
    const dateStr = d.toISOString().split('T')[0];

    for (const block of dayAvailability) {
      let hour = block.start;
      let minute = 0;
      const endMinutes = block.end * 60;

      while (hour * 60 + minute + slotDuration <= endMinutes) {
        slots.push({
          id: generateId(),
          date: dateStr,
          startHour: hour,
          startMinute: minute,
          durationMinutes: slotDuration,
          allocated: false,
        });
        minute += slotDuration;
        if (minute >= 60) {
          hour += Math.floor(minute / 60);
          minute = minute % 60;
        }
      }
    }
  }

  return slots;
}

/**
 * Allocate topics to slots using greedy priority-based scheduling
 */
function allocateSlots(rankedTopics, slots, constraints) {
  const sessions = [];
  const slotsByDate = groupSlotsByDate(slots);
  const dailyCounts = {}; // date → { total, byExamId, topicIds }
  const lastTopicDate = {}; // topicId → last assigned date
  const minSubjects = constraints.minDailySubjects || 2;

  // Calculate how many slots each topic needs
  const topicSlotNeeds = rankedTopics.map(rt => {
    const weaknessFactor = (6 - rt.topic.selfAssessment) / 5;
    const baseSlots = Math.ceil(rt.topic.estimatedMinutes / (constraints.slotDurationMinutes || 30));
    const adjustedSlots = Math.ceil(baseSlots * (1 + weaknessFactor * 0.5));
    const remaining = adjustedSlots - Math.floor((rt.topic.completedMinutes || 0) / (constraints.slotDurationMinutes || 30));
    return {
      ...rt,
      slotsNeeded: Math.max(1, remaining),
      slotsAllocated: 0,
    };
  });

  // Sort dates chronologically
  const dates = Object.keys(slotsByDate).sort();

  // Round-robin allocation: iterate through dates, assign highest priority first
  let allocationComplete = false;
  let passCount = 0;
  const maxPasses = 10;

  while (!allocationComplete && passCount < maxPasses) {
    allocationComplete = true;
    passCount++;

    for (const need of topicSlotNeeds) {
      if (need.slotsAllocated >= need.slotsNeeded) continue;
      allocationComplete = false;

      for (const date of dates) {
        if (need.slotsAllocated >= need.slotsNeeded) break;

        // Initialize daily tracking
        if (!dailyCounts[date]) dailyCounts[date] = { total: 0, byExamId: {}, topicIds: new Set() };

        // Check daily max
        if (dailyCounts[date].total >= constraints.maxDailySlotsCount) continue;

        // Check consecutive same-subject limit
        const dateSlots = slotsByDate[date];
        const consecutiveCount = countConsecutiveForTopic(sessions, date, need.topic.id);
        if (consecutiveCount >= constraints.maxConsecutiveSameSubject) continue;

        // Spaced repetition: avoid same topic on consecutive days if gap required
        if (lastTopicDate[need.topic.id]) {
          const lastDate = new Date(lastTopicDate[need.topic.id]);
          const currentDate = new Date(date);
          const dayDiff = (currentDate - lastDate) / (1000 * 60 * 60 * 24);
          if (dayDiff > 0 && dayDiff < constraints.spacedRepetitionGapDays) continue;
        }

        // Enforce minDailySubjects: if the day has 4+ slots but too few unique subjects,
        // skip topics already covered today to force variety
        if (dailyCounts[date].total >= 4 && dailyCounts[date].topicIds.size < minSubjects) {
          if (dailyCounts[date].topicIds.has(need.topic.id)) continue;
        }

        // Find an available slot
        const availableSlot = dateSlots.find(s => !s.allocated);
        if (!availableSlot) continue;

        // Allocate
        availableSlot.allocated = true;
        const session = createStudySession({
          topicId: need.topic.id,
          slotId: availableSlot.id,
          date: availableSlot.date,
          startHour: availableSlot.startHour,
          startMinute: availableSlot.startMinute,
          durationMinutes: availableSlot.durationMinutes,
          status: 'scheduled',
        });
        sessions.push(session);

        need.slotsAllocated++;
        dailyCounts[date].total++;
        dailyCounts[date].byExamId[need.exam.id] = (dailyCounts[date].byExamId[need.exam.id] || 0) + 1;
        dailyCounts[date].topicIds.add(need.topic.id);
        lastTopicDate[need.topic.id] = date;
      }
    }
  }

  // Sort sessions by date and time
  sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.startHour * 60 + a.startMinute) - (b.startHour * 60 + b.startMinute);
  });

  return sessions;
}

/**
 * Insert break sessions according to break frequency rule
 */
function insertBreaks(sessions, constraints) {
  const byDate = {};
  for (const s of sessions) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  const result = [];
  for (const [date, daySessions] of Object.entries(byDate)) {
    daySessions.sort((a, b) => (a.startHour * 60 + a.startMinute) - (b.startHour * 60 + b.startMinute));
    
    let consecutiveStudy = 0;
    for (const session of daySessions) {
      consecutiveStudy++;
      result.push(session);

      if (consecutiveStudy >= constraints.breakFrequency) {
        // Insert a break after this session
        const breakStart = session.startHour * 60 + session.startMinute + session.durationMinutes;
        result.push({
          id: generateId(),
          topicId: null,
          slotId: null,
          date,
          startHour: Math.floor(breakStart / 60),
          startMinute: breakStart % 60,
          durationMinutes: 15,
          status: 'break',
          notes: 'Scheduled break',
        });
        consecutiveStudy = 0;
      }
    }
  }

  return result;
}

/**
 * Count consecutive slots for a topic at the end of a day's schedule
 */
function countConsecutiveForTopic(sessions, date, topicId) {
  const daySessions = sessions
    .filter(s => s.date === date)
    .sort((a, b) => (b.startHour * 60 + b.startMinute) - (a.startHour * 60 + a.startMinute));
  
  let count = 0;
  for (const s of daySessions) {
    if (s.topicId === topicId) count++;
    else break;
  }
  return count;
}

function groupSlotsByDate(slots) {
  const groups = {};
  for (const slot of slots) {
    if (!groups[slot.date]) groups[slot.date] = [];
    groups[slot.date].push(slot);
  }
  return groups;
}

/**
 * Get schedule statistics
 */
export function getScheduleStats(sessions, topics, exams) {
  const stats = {
    totalSessions: sessions.filter(s => s.status !== 'break').length,
    completedSessions: sessions.filter(s => s.status === 'completed').length,
    missedSessions: sessions.filter(s => s.status === 'missed').length,
    scheduledSessions: sessions.filter(s => s.status === 'scheduled').length,
    totalStudyMinutes: sessions.filter(s => s.status !== 'break').reduce((sum, s) => sum + s.durationMinutes, 0),
    completedMinutes: sessions.filter(s => s.status === 'completed').reduce((sum, s) => sum + s.durationMinutes, 0),
    topicCoverage: {},
    examCoverage: {},
  };

  // Topic coverage
  for (const topic of topics) {
    const topicSessions = sessions.filter(s => s.topicId === topic.id);
    stats.topicCoverage[topic.id] = {
      name: topic.name,
      scheduled: topicSessions.filter(s => s.status === 'scheduled').length,
      completed: topicSessions.filter(s => s.status === 'completed').length,
      missed: topicSessions.filter(s => s.status === 'missed').length,
    };
  }

  return stats;
}
