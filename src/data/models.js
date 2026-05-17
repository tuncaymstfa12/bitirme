/**
 * Data Models for the Study Planning System
 * Defines entities: Exam, Topic, TimeSlot, StudySession, MockResult, Question
 */

export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function createExam({ name, date, color = null, id = null }) {
  return {
    id: id || generateId(),
    name: name.trim(),
    date: String(date || '').split('T')[0] || new Date().toISOString().split('T')[0],
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
  examType = 'TYT',
  track = 'sayisal',
  lesson = '',
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
    examType,
    track,
    lesson,
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
    date: date || String(new Date().toISOString().split('T')[0]),
    createdAt: new Date().toISOString(),
  };
}

export function createQuestion({
  examType = 'TYT',
  track = 'sayisal',
  lesson,
  topicName,
  questionNo = null,
  questionText,
  questionImageUrl = '',
  options = [],
  correctOption,
  explanation = '',
  sourceName = '',
  sourceYear = null,
  difficulty = 3,
  id = null,
}) {
  return {
    id: id || generateId(),
    examType,
    track,
    lesson: String(lesson || '').trim(),
    topicName: String(topicName || '').trim(),
    questionNo: questionNo ? Number(questionNo) : null,
    questionText: String(questionText || '').trim(),
    questionImageUrl: String(questionImageUrl || '').trim(),
    options: normalizeOptions(options),
    correctOption: String(correctOption || '').toUpperCase(),
    explanation: String(explanation || '').trim(),
    sourceName: String(sourceName || '').trim(),
    sourceYear: sourceYear ? Number(sourceYear) : null,
    difficulty: clamp(Number(difficulty) || 3, 1, 5),
    createdAt: new Date().toISOString(),
  };
}

export function createStudentAnswer({
  questionId,
  selectedOption,
  isCorrect = false,
  answeredAt = null,
  id = null,
}) {
  return {
    id: id || generateId(),
    questionId,
    selectedOption: String(selectedOption || '').toUpperCase(),
    isCorrect: Boolean(isCorrect),
    answeredAt: answeredAt || new Date().toISOString(),
  };
}

// --- Helpers ---

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeOptions(options) {
  const byKey = new Map();
  options.forEach(option => {
    const key = String(option.optionKey || option.key || '').toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(key)) return;
    byKey.set(key, {
      optionKey: key,
      optionText: String(option.optionText || option.text || '').trim(),
      optionImageUrl: String(option.optionImageUrl || '').trim(),
    });
  });
  return ['A', 'B', 'C', 'D', 'E'].map(key => byKey.get(key) || {
    optionKey: key,
    optionText: '',
    optionImageUrl: '',
  });
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
