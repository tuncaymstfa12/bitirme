/**
 * Rules & Constraint Definitions
 * Configurable rules for the scheduling engine
 */

export const DEFAULT_RULES = {
  // Scheduling constraints
  maxConsecutiveSameSubject: 3,   // max 30-min slots in a row for same subject
  breakFrequency: 3,              // insert break every N study slots
  minDailySubjects: 2,            // minimum variety per day
  maxDailySlotsCount: 12,         // max 6 hours per day
  spacedRepetitionGapDays: 1,     // min days between same-topic reviews
  slotDurationMinutes: 30,        // slot size

  // Priority weights
  weights: {
    urgency: 0.35,
    topicWeight: 0.25,
    weakness: 0.25,
    performance: 0.15,
  },

  // Rescheduling rules
  rescheduling: {
    highPriorityThreshold: 0.7,    // score >= this → HIGH priority for recovery
    mediumPriorityThreshold: 0.4,  // score >= this → MEDIUM priority
    compressionFactor: 0.75,       // compress low-priority by 25%
    maxDailyExtension: 2,          // can extend daily max by up to 2 slots
    mergeRelatedThreshold: 0.3,    // merge topics from same exam if priority < this
  },

  // Study session rules
  session: {
    minSessionMinutes: 30,
    maxSessionMinutes: 90,
    breakDurationMinutes: 15,
    preferredStudyOrder: 'hardFirst', // hardFirst | easyFirst | mixed
  },
};

/**
 * Validate a schedule against constraints
 * Returns an array of violations
 */
export function validateSchedule(sessions, rules = DEFAULT_RULES) {
  const violations = [];
  
  // Group sessions by date
  const byDate = groupByDate(sessions);
  
  for (const [date, daySessions] of Object.entries(byDate)) {
    // Sort by time
    const sorted = daySessions.sort((a, b) => 
      a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute)
    );

    // Check max daily slots
    const studySlots = sorted.filter(s => s.status !== 'break');
    if (studySlots.length > rules.maxDailySlotsCount) {
      violations.push({
        type: 'maxDailySlots',
        date,
        message: `Day ${date} has ${studySlots.length} slots (max: ${rules.maxDailySlotsCount})`,
        severity: 'warning',
      });
    }

    // Check consecutive same-subject
    let consecutiveCount = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].topicId === sorted[i - 1].topicId && sorted[i].topicId) {
        consecutiveCount++;
        if (consecutiveCount > rules.maxConsecutiveSameSubject) {
          violations.push({
            type: 'consecutiveSameSubject',
            date,
            message: `${consecutiveCount} consecutive slots for same topic on ${date}`,
            severity: 'warning',
          });
        }
      } else {
        consecutiveCount = 1;
      }
    }

    // Check min daily subjects
    const uniqueTopics = new Set(studySlots.map(s => s.topicId).filter(Boolean));
    if (studySlots.length >= 4 && uniqueTopics.size < rules.minDailySubjects) {
      violations.push({
        type: 'minDailySubjects',
        date,
        message: `Day ${date} only has ${uniqueTopics.size} subject(s) (min: ${rules.minDailySubjects})`,
        severity: 'info',
      });
    }

    // Check break frequency
    let slotsWithoutBreak = 0;
    for (const session of sorted) {
      if (session.status === 'break') {
        slotsWithoutBreak = 0;
      } else {
        slotsWithoutBreak++;
        if (slotsWithoutBreak > rules.breakFrequency) {
          violations.push({
            type: 'breakFrequency',
            date,
            message: `${slotsWithoutBreak} consecutive slots without break on ${date}`,
            severity: 'info',
          });
          break;
        }
      }
    }
  }

  return violations;
}

/**
 * Check if adding a session would violate spaced repetition rules
 */
export function checkSpacedRepetition(topicId, date, allSessions, rules = DEFAULT_RULES) {
  const topicSessions = allSessions.filter(s => s.topicId === topicId && s.status !== 'missed');
  const targetDate = new Date(date);
  
  for (const session of topicSessions) {
    const sessionDate = new Date(session.date);
    const dayDiff = Math.abs((targetDate - sessionDate) / (1000 * 60 * 60 * 24));
    if (dayDiff > 0 && dayDiff < rules.spacedRepetitionGapDays) {
      return false; // Too close
    }
  }
  return true;
}

function groupByDate(sessions) {
  const groups = {};
  for (const session of sessions) {
    if (!groups[session.date]) groups[session.date] = [];
    groups[session.date].push(session);
  }
  return groups;
}
