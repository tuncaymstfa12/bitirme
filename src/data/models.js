/**
 * Data Models for the Study Planning System
 * Defines entities: Exam, Topic, TimeSlot, StudySession, MockResult
 */

export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function createExam({ name, date, color = null, id = null }) {
  return {
    id: id || generateId(),
    name: name.trim(),
    date: new Date(date).toISOString().split('T')[0], // YYYY-MM-DD
    color: color || generateExamColor(),
    createdAt: new Date().toISOString(),
  };
}

export function createTopic({
  examId,
  name,
  weight = 5,
  selfAssessment = 3,
  estimatedMinutes = 60,
  id = null,
}) {
  return {
    id: id || generateId(),
    examId,
    name: name.trim(),
    weight: clamp(weight, 1, 10),
    selfAssessment: clamp(selfAssessment, 1, 5),
    estimatedMinutes: Math.max(30, estimatedMinutes),
    completedMinutes: 0,
    createdAt: new Date().toISOString(),
  };
}

export function createTimeSlot({
  date,
  startHour,
  startMinute = 0,
  durationMinutes = 30,
  available = true,
  id = null,
}) {
  return {
    id: id || generateId(),
    date, // YYYY-MM-DD
    startHour: clamp(startHour, 0, 23),
    startMinute: clamp(startMinute, 0, 59),
    durationMinutes,
    available,
  };
}

export function createStudySession({
  topicId,
  slotId,
  date,
  startHour,
  startMinute,
  durationMinutes = 30,
  status = 'scheduled', // scheduled | completed | missed
  id = null,
}) {
  return {
    id: id || generateId(),
    topicId,
    slotId,
    date,
    startHour,
    startMinute,
    durationMinutes,
    status,
    completedAt: null,
    notes: '',
  };
}

export function createMockResult({
  topicId,
  score,
  maxScore = 100,
  date = null,
  id = null,
}) {
  return {
    id: id || generateId(),
    topicId,
    score: clamp(score, 0, maxScore),
    maxScore,
    date: date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
  };
}

// --- Helpers ---

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const EXAM_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
];

let colorIndex = 0;
function generateExamColor() {
  const color = EXAM_COLORS[colorIndex % EXAM_COLORS.length];
  colorIndex++;
  return color;
}
