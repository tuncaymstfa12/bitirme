/**
 * Exam Manager View
 * Add/edit/delete exams and their topics with weights and self-assessments
 */

import { store } from '../data/store.js';
import { createExam, createTopic, createMockResult } from '../data/models.js';
import { showModal, closeModal, showToast, formatDate, daysUntil, renderStars } from './components.js';

export function renderExamManager(container) {
  const exams = store.getExams();
  const topics = store.getTopics();

  container.innerHTML = `
    <div class="page-header">
      <h2>🎓 Exam Manager</h2>
      <p>Manage your exams, topics, weights, and self-assessments</p>
    </div>

    <div style="display: flex; gap: var(--space-sm); margin-bottom: var(--space-xl);">
      <button class="btn btn-primary btn-lg" id="add-exam-btn">+ Add Exam</button>
      <button class="btn btn-secondary btn-lg" id="add-mock-btn">📝 Add Mock Result</button>
    </div>

    ${exams.length === 0 
      ? `<div class="card">
          <div class="empty-state">
            <div class="empty-icon">🎓</div>
            <h3>No Exams Yet</h3>
            <p>Start by adding your upcoming exams and their topics. The system will calculate priorities and create your study plan.</p>
            <button class="btn btn-primary" id="add-exam-btn-empty">+ Add Your First Exam</button>
          </div>
        </div>`
      : exams.map(exam => {
          const examTopics = topics.filter(t => t.examId === exam.id);
          const days = daysUntil(exam.date);
          return `
            <div class="exam-card animate-fade-in" style="margin-bottom: var(--space-lg);">
              <div class="exam-card-header">
                <div class="exam-info">
                  <span class="exam-color-lg" style="background: ${exam.color}"></span>
                  <div>
                    <div class="exam-name">${exam.name}</div>
                    <div class="exam-date">${formatDate(exam.date)} · ${days >= 0 ? days + ' days left' : 'Past'}</div>
                  </div>
                </div>
                <div style="display: flex; gap: var(--space-xs);">
                  <button class="btn btn-sm btn-secondary add-topic-btn" data-exam-id="${exam.id}">+ Topic</button>
                  <button class="btn btn-sm btn-secondary edit-exam-btn" data-exam-id="${exam.id}">✎</button>
                  <button class="btn btn-sm btn-danger delete-exam-btn" data-exam-id="${exam.id}">🗑</button>
                </div>
              </div>
              <div class="exam-card-body">
                ${examTopics.length === 0 
                  ? '<p style="color: var(--text-tertiary); font-size: var(--font-sm); padding: var(--space-sm);">No topics added yet. Click "+ Topic" to add study topics.</p>'
                  : examTopics.map(topic => {
                      const mockResults = store.getMockResults(topic.id);
                      return `
                        <div class="topic-item">
                          <span class="exam-color" style="background: ${exam.color}"></span>
                          <div class="topic-main">
                            <div class="topic-name">${topic.name}</div>
                            <div class="topic-meta">
                              <span>Weight: ${topic.weight}/10</span>
                              <span>Self: ${renderStars(topic.selfAssessment)}</span>
                              <span>Est: ${topic.estimatedMinutes}min</span>
                              ${mockResults.length > 0 ? `<span>Tests: ${mockResults.length}</span>` : ''}
                            </div>
                          </div>
                          <div class="topic-actions">
                            <button class="btn btn-sm btn-secondary edit-topic-btn" 
                              data-topic-id="${topic.id}" data-exam-id="${exam.id}">✎</button>
                            <button class="btn btn-sm btn-danger delete-topic-btn" 
                              data-topic-id="${topic.id}">🗑</button>
                          </div>
                        </div>
                      `;
                    }).join('')
                }
              </div>
            </div>
          `;
        }).join('')
    }
  `;

  bindExamManagerEvents(container);
}

function bindExamManagerEvents(container) {
  // Add Exam
  const addExamHandler = () => showExamForm();
  container.querySelector('#add-exam-btn')?.addEventListener('click', addExamHandler);
  container.querySelector('#add-exam-btn-empty')?.addEventListener('click', addExamHandler);

  // Add Mock Result
  container.querySelector('#add-mock-btn')?.addEventListener('click', () => showMockResultForm());

  // Add Topic
  container.querySelectorAll('.add-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => showTopicForm(btn.dataset.examId));
  });

  // Edit Exam
  container.querySelectorAll('.edit-exam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const exam = store.getExam(btn.dataset.examId);
      if (exam) showExamForm(exam);
    });
  });

  // Delete Exam
  container.querySelectorAll('.delete-exam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const exam = store.getExam(btn.dataset.examId);
      if (exam && confirm(`Delete "${exam.name}" and all its topics?`)) {
        store.deleteExam(exam.id);
        showToast({ title: 'Exam Deleted', message: `${exam.name} has been removed.`, type: 'info' });
        renderExamManager(container);
      }
    });
  });

  // Edit Topic
  container.querySelectorAll('.edit-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = store.getTopic(btn.dataset.topicId);
      if (topic) showTopicForm(btn.dataset.examId, topic);
    });
  });

  // Delete Topic
  container.querySelectorAll('.delete-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = store.getTopic(btn.dataset.topicId);
      if (topic && confirm(`Delete topic "${topic.name}"?`)) {
        store.deleteTopic(topic.id);
        showToast({ title: 'Topic Deleted', message: `${topic.name} has been removed.`, type: 'info' });
        renderExamManager(container);
      }
    });
  });
}

function showExamForm(existingExam = null) {
  const isEdit = !!existingExam;
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 14);

  const overlay = showModal({
    title: isEdit ? 'Edit Exam' : 'Add New Exam',
    content: `
      <div class="form-group">
        <label class="form-label">Exam Name</label>
        <input type="text" class="form-input" id="exam-name" 
          value="${isEdit ? existingExam.name : ''}" 
          placeholder="e.g., Calculus II Final">
      </div>
      <div class="form-group">
        <label class="form-label">Exam Date</label>
        <input type="date" class="form-input" id="exam-date" 
          value="${isEdit ? existingExam.date : defaultDate.toISOString().split('T')[0]}">
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add Exam'}</button>
    `,
  });

  overlay.querySelector('#modal-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#modal-save').addEventListener('click', () => {
    const name = overlay.querySelector('#exam-name').value.trim();
    const date = overlay.querySelector('#exam-date').value;

    if (!name) {
      showToast({ title: 'Validation Error', message: 'Please enter an exam name.', type: 'error' });
      return;
    }
    if (!date) {
      showToast({ title: 'Validation Error', message: 'Please select an exam date.', type: 'error' });
      return;
    }

    if (isEdit) {
      store.updateExam(existingExam.id, { name, date });
      showToast({ title: 'Exam Updated', message: `${name} has been updated.`, type: 'success' });
    } else {
      const exam = createExam({ name, date });
      store.addExam(exam);
      showToast({ title: 'Exam Added!', message: `${name} added. Now add topics.`, type: 'success' });
    }

    closeModal();
    const c = document.getElementById('main-content');
    if (c) renderExamManager(c);
  });
}

function showTopicForm(examId, existingTopic = null) {
  const isEdit = !!existingTopic;

  const overlay = showModal({
    title: isEdit ? 'Edit Topic' : 'Add Topic',
    content: `
      <div class="form-group">
        <label class="form-label">Topic Name</label>
        <input type="text" class="form-input" id="topic-name" 
          value="${isEdit ? existingTopic.name : ''}"
          placeholder="e.g., Integration by Parts">
      </div>
      <div class="form-group">
        <label class="form-label">Weight (Importance in Exam) — ${isEdit ? existingTopic.weight : 5}/10</label>
        <input type="range" class="form-slider" id="topic-weight" 
          min="1" max="10" value="${isEdit ? existingTopic.weight : 5}">
      </div>
      <div class="form-group">
        <label class="form-label">Self Assessment — How well do you know this?</label>
        <div style="display: flex; gap: var(--space-sm); margin-top: var(--space-xs);">
          ${[1,2,3,4,5].map(i => `
            <label style="cursor: pointer; font-size: 28px; color: ${i <= (isEdit ? existingTopic.selfAssessment : 3) ? '#fbbf24' : '#3a3a5c'}; transition: color 0.15s;" 
              class="star-btn" data-value="${i}">★</label>
          `).join('')}
        </div>
        <input type="hidden" id="topic-self-assessment" value="${isEdit ? existingTopic.selfAssessment : 3}">
      </div>
      <div class="form-group">
        <label class="form-label">Estimated Study Time (minutes)</label>
        <input type="number" class="form-input" id="topic-time" 
          value="${isEdit ? existingTopic.estimatedMinutes : 60}" min="30" step="15">
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add Topic'}</button>
    `,
  });

  // Weight slider label update
  const weightSlider = overlay.querySelector('#topic-weight');
  weightSlider.addEventListener('input', () => {
    const label = weightSlider.parentElement.querySelector('.form-label');
    label.textContent = `Weight (Importance in Exam) — ${weightSlider.value}/10`;
  });

  // Star rating interactivity
  const stars = overlay.querySelectorAll('.star-btn');
  const selfInput = overlay.querySelector('#topic-self-assessment');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      const val = parseInt(star.dataset.value);
      selfInput.value = val;
      stars.forEach(s => {
        s.style.color = parseInt(s.dataset.value) <= val ? '#fbbf24' : '#3a3a5c';
      });
    });
  });

  overlay.querySelector('#modal-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#modal-save').addEventListener('click', () => {
    const name = overlay.querySelector('#topic-name').value.trim();
    const weight = parseInt(weightSlider.value);
    const selfAssessment = parseInt(selfInput.value);
    const estimatedMinutes = parseInt(overlay.querySelector('#topic-time').value);

    if (!name) {
      showToast({ title: 'Validation Error', message: 'Please enter a topic name.', type: 'error' });
      return;
    }

    if (isEdit) {
      store.updateTopic(existingTopic.id, { name, weight, selfAssessment, estimatedMinutes });
      showToast({ title: 'Topic Updated', message: `${name} has been updated.`, type: 'success' });
    } else {
      const topic = createTopic({ examId, name, weight, selfAssessment, estimatedMinutes });
      store.addTopic(topic);
      showToast({ title: 'Topic Added!', message: `${name} added to the exam.`, type: 'success' });
    }

    closeModal();
    const c = document.getElementById('main-content');
    if (c) renderExamManager(c);
  });
}

function showMockResultForm() {
  const topics = store.getTopics();
  const exams = store.getExams();

  if (topics.length === 0) {
    showToast({ title: 'No Topics', message: 'Add exams and topics first.', type: 'warning' });
    return;
  }

  const overlay = showModal({
    title: 'Add Mock Test Result',
    content: `
      <div class="form-group">
        <label class="form-label">Topic</label>
        <select class="form-select" id="mock-topic">
          ${topics.map(t => {
            const exam = exams.find(e => e.id === t.examId);
            return `<option value="${t.id}">${exam ? exam.name + ' — ' : ''}${t.name}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Score</label>
        <input type="number" class="form-input" id="mock-score" min="0" max="100" value="50">
      </div>
      <div class="form-group">
        <label class="form-label">Max Score</label>
        <input type="number" class="form-input" id="mock-max" min="1" max="100" value="100">
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input type="date" class="form-input" id="mock-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save Result</button>
    `,
  });

  overlay.querySelector('#modal-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#modal-save').addEventListener('click', () => {
    const topicId = overlay.querySelector('#mock-topic').value;
    const score = parseInt(overlay.querySelector('#mock-score').value);
    const maxScore = parseInt(overlay.querySelector('#mock-max').value);
    const date = overlay.querySelector('#mock-date').value;

    if (isNaN(score) || score < 0) {
      showToast({ title: 'Invalid Score', message: 'Please enter a valid score.', type: 'error' });
      return;
    }

    const result = createMockResult({ topicId, score, maxScore, date });
    store.addMockResult(result);
    showToast({ title: 'Result Saved!', message: 'Mock test result has been recorded.', type: 'success' });
    closeModal();
    const c = document.getElementById('main-content');
    if (c) renderExamManager(c);
  });
}
