/**
 * Tests for Data Models module
 * Verifies entity creation, field validation, clamping, and ID generation.
 */

import { describe, it, expect } from 'vitest';
import {
  generateId,
  createExam,
  createTopic,
  createTimeSlot,
  createStudySession,
  createMockResult,
} from '../../src/data/models.js';

// --- Tests ---

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('returns non-empty string', () => {
    expect(generateId().length).toBeGreaterThan(0);
  });
});

describe('createExam', () => {
  it('creates exam with required fields', () => {
    const exam = createExam({ name: 'Calculus II', date: '2026-06-15' });
    expect(exam.name).toBe('Calculus II');
    expect(exam.date).toBe('2026-06-15');
    expect(exam.id).toBeDefined();
    expect(exam.color).toBeDefined();
    expect(exam.createdAt).toBeDefined();
  });

  it('trims exam name', () => {
    const exam = createExam({ name: '  Calculus  ', date: '2026-06-15' });
    expect(exam.name).toBe('Calculus');
  });

  it('normalizes date to YYYY-MM-DD format', () => {
    const exam = createExam({ name: 'Test', date: '2026-06-15T14:30:00Z' });
    expect(exam.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses provided ID when given', () => {
    const exam = createExam({ name: 'Test', date: '2026-06-15', id: 'custom-id' });
    expect(exam.id).toBe('custom-id');
  });

  it('uses provided color when given', () => {
    const exam = createExam({ name: 'Test', date: '2026-06-15', color: '#ff0000' });
    expect(exam.color).toBe('#ff0000');
  });

  it('generates color when none provided', () => {
    const exam = createExam({ name: 'Test', date: '2026-06-15' });
    expect(exam.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('createTopic', () => {
  it('creates topic with required fields', () => {
    const topic = createTopic({ examId: 'e1', name: 'Integration' });
    expect(topic.examId).toBe('e1');
    expect(topic.name).toBe('Integration');
    expect(topic.id).toBeDefined();
    expect(topic.createdAt).toBeDefined();
  });

  it('applies default values', () => {
    const topic = createTopic({ examId: 'e1', name: 'Test' });
    expect(topic.weight).toBe(5);
    expect(topic.selfAssessment).toBe(3);
    expect(topic.estimatedMinutes).toBe(60);
    expect(topic.completedMinutes).toBe(0);
  });

  it('clamps weight to 1-10 range', () => {
    const low = createTopic({ examId: 'e1', name: 'T', weight: -5 });
    const high = createTopic({ examId: 'e1', name: 'T', weight: 20 });
    expect(low.weight).toBe(1);
    expect(high.weight).toBe(10);
  });

  it('clamps selfAssessment to 1-5 range', () => {
    const low = createTopic({ examId: 'e1', name: 'T', selfAssessment: 0 });
    const high = createTopic({ examId: 'e1', name: 'T', selfAssessment: 10 });
    expect(low.selfAssessment).toBe(1);
    expect(high.selfAssessment).toBe(5);
  });

  it('enforces minimum estimated minutes of 30', () => {
    const topic = createTopic({ examId: 'e1', name: 'T', estimatedMinutes: 10 });
    expect(topic.estimatedMinutes).toBe(30);
  });

  it('trims topic name', () => {
    const topic = createTopic({ examId: 'e1', name: '  Integration  ' });
    expect(topic.name).toBe('Integration');
  });
});

describe('createTimeSlot', () => {
  it('creates time slot with required fields', () => {
    const slot = createTimeSlot({ date: '2026-05-01', startHour: 9 });
    expect(slot.date).toBe('2026-05-01');
    expect(slot.startHour).toBe(9);
    expect(slot.startMinute).toBe(0);
    expect(slot.durationMinutes).toBe(30);
    expect(slot.available).toBe(true);
    expect(slot.id).toBeDefined();
  });

  it('clamps startHour to 0-23', () => {
    const low = createTimeSlot({ date: '2026-05-01', startHour: -1 });
    const high = createTimeSlot({ date: '2026-05-01', startHour: 25 });
    expect(low.startHour).toBe(0);
    expect(high.startHour).toBe(23);
  });

  it('clamps startMinute to 0-59', () => {
    const low = createTimeSlot({ date: '2026-05-01', startHour: 9, startMinute: -5 });
    const high = createTimeSlot({ date: '2026-05-01', startHour: 9, startMinute: 70 });
    expect(low.startMinute).toBe(0);
    expect(high.startMinute).toBe(59);
  });
});

describe('createStudySession', () => {
  it('creates session with required fields', () => {
    const session = createStudySession({
      topicId: 't1',
      slotId: 's1',
      date: '2026-05-01',
      startHour: 9,
      startMinute: 0,
    });
    expect(session.topicId).toBe('t1');
    expect(session.slotId).toBe('s1');
    expect(session.date).toBe('2026-05-01');
    expect(session.startHour).toBe(9);
    expect(session.status).toBe('scheduled');
    expect(session.completedAt).toBeNull();
    expect(session.notes).toBe('');
  });

  it('applies default status of "scheduled"', () => {
    const session = createStudySession({
      topicId: 't1', slotId: 's1', date: '2026-05-01', startHour: 9, startMinute: 0,
    });
    expect(session.status).toBe('scheduled');
  });

  it('allows custom status', () => {
    const session = createStudySession({
      topicId: 't1', slotId: 's1', date: '2026-05-01', startHour: 9, startMinute: 0,
      status: 'completed',
    });
    expect(session.status).toBe('completed');
  });
});

describe('createMockResult', () => {
  it('creates mock result with required fields', () => {
    const result = createMockResult({ topicId: 't1', score: 75 });
    expect(result.topicId).toBe('t1');
    expect(result.score).toBe(75);
    expect(result.maxScore).toBe(100);
    expect(result.id).toBeDefined();
    expect(result.date).toBeDefined();
    expect(result.createdAt).toBeDefined();
  });

  it('clamps score to 0-maxScore', () => {
    const low = createMockResult({ topicId: 't1', score: -10 });
    const high = createMockResult({ topicId: 't1', score: 150 });
    expect(low.score).toBe(0);
    expect(high.score).toBe(100);
  });

  it('uses custom maxScore', () => {
    const result = createMockResult({ topicId: 't1', score: 40, maxScore: 50 });
    expect(result.maxScore).toBe(50);
    expect(result.score).toBe(40);
  });

  it('clamps score to custom maxScore', () => {
    const result = createMockResult({ topicId: 't1', score: 80, maxScore: 50 });
    expect(result.score).toBe(50);
  });

  it('uses current date when not provided', () => {
    const result = createMockResult({ topicId: 't1', score: 50 });
    const today = new Date().toISOString().split('T')[0];
    expect(result.date).toBe(today);
  });

  it('uses provided date', () => {
    const result = createMockResult({ topicId: 't1', score: 50, date: '2026-05-15' });
    expect(result.date).toBe('2026-05-15');
  });
});
