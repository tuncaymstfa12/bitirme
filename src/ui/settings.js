/**
 * Settings View
 * Priority weight adjustment, constraint config, availability editor, data export/import
 */

import { store } from '../data/store.js';
import { showToast } from './components.js';

export function renderSettings(container) {
  const settings = store.getSettings();
  const w = settings.weights;
  const c = settings.constraints;

  container.innerHTML = `
    <div class="page-header">
      <h2>⚙️ Settings</h2>
      <p>Configure priority weights, scheduling constraints, and data management</p>
    </div>

    <div class="grid-2">
      <!-- Priority Weights -->
      <div class="card">
        <div class="card-header"><h3 class="card-title">🎚️ Priority Weights</h3></div>
        <p style="color:var(--text-secondary);font-size:var(--font-sm);margin-bottom:var(--space-md);">
          Adjust how each factor contributes to the priority score. Weights should sum to 1.0.
        </p>
        ${renderWeightSlider('Urgency (Exam Proximity)', 'w-urgency', w.urgency)}
        ${renderWeightSlider('Topic Weight', 'w-topicWeight', w.topicWeight)}
        ${renderWeightSlider('Weakness (Self Assessment)', 'w-weakness', w.weakness)}
        ${renderWeightSlider('Performance Gap (Mock Tests)', 'w-performance', w.performance)}
        <div style="text-align:right;margin-top:var(--space-sm);">
          <span id="weight-sum" style="font-size:var(--font-sm);color:var(--text-tertiary);">Sum: ${(w.urgency+w.topicWeight+w.weakness+w.performance).toFixed(2)}</span>
        </div>
        <button class="btn btn-primary" id="save-weights-btn" style="margin-top:var(--space-md);width:100%;">Save Weights</button>
      </div>

      <!-- Scheduling Constraints -->
      <div class="card">
        <div class="card-header"><h3 class="card-title">📐 Scheduling Constraints</h3></div>
        <div class="form-group">
          <label class="form-label">Max consecutive same-subject slots</label>
          <input type="number" class="form-input" id="c-maxConsecutive" value="${c.maxConsecutiveSameSubject}" min="1" max="10">
        </div>
        <div class="form-group">
          <label class="form-label">Break frequency (every N slots)</label>
          <input type="number" class="form-input" id="c-breakFreq" value="${c.breakFrequency}" min="1" max="10">
        </div>
        <div class="form-group">
          <label class="form-label">Min daily subjects</label>
          <input type="number" class="form-input" id="c-minSubjects" value="${c.minDailySubjects}" min="1" max="5">
        </div>
        <div class="form-group">
          <label class="form-label">Max daily slots (30min each)</label>
          <input type="number" class="form-input" id="c-maxDaily" value="${c.maxDailySlotsCount}" min="2" max="24">
        </div>
        <div class="form-group">
          <label class="form-label">Slot duration (minutes)</label>
          <input type="number" class="form-input" id="c-slotDuration" value="${c.slotDurationMinutes}" min="15" max="60" step="15">
        </div>
        <button class="btn btn-primary" id="save-constraints-btn" style="width:100%;">Save Constraints</button>
      </div>
    </div>

    <!-- Daily Availability -->
    <div class="card" style="margin-top:var(--space-lg);">
      <div class="card-header"><h3 class="card-title">🕐 Daily Availability</h3></div>
      <p style="color:var(--text-secondary);font-size:var(--font-sm);margin-bottom:var(--space-md);">
        Set your available study hours for each day of the week.
      </p>
      <div id="availability-editor">
        ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day, i) => {
          const blocks = settings.dailyAvailability[i] || [];
          return `<div style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);">
            <span style="min-width:100px;font-weight:600;font-size:var(--font-sm);">${day}</span>
            <div style="flex:1;display:flex;gap:var(--space-sm);flex-wrap:wrap;" id="avail-blocks-${i}">
              ${blocks.map((b, bi) => `
                <span class="tag">${b.start}:00 - ${b.end}:00
                  <button class="remove-block-btn" data-day="${i}" data-idx="${bi}" style="background:none;border:none;color:var(--color-danger);cursor:pointer;margin-left:4px;">✕</button>
                </span>
              `).join('') || '<span style="color:var(--text-tertiary);font-size:var(--font-xs);">No blocks</span>'}
            </div>
            <button class="btn btn-sm btn-secondary add-block-btn" data-day="${i}">+ Add</button>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Data Management -->
    <div class="card" style="margin-top:var(--space-lg);">
      <div class="card-header"><h3 class="card-title">💾 Data Management</h3></div>
      <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">
        <button class="btn btn-secondary" id="export-btn">📤 Export Data</button>
        <button class="btn btn-secondary" id="import-btn">📥 Import Data</button>
        <button class="btn btn-secondary" id="load-demo-btn">🎲 Load Demo Data</button>
        <button class="btn btn-danger" id="reset-btn">🗑 Reset All</button>
      </div>
      <input type="file" id="import-file" accept=".json" style="display:none;">
    </div>
  `;

  bindSettingsEvents(container);
}

function renderWeightSlider(label, id, value) {
  return `<div class="form-group">
    <label class="form-label">${label}: <span id="${id}-val">${value.toFixed(2)}</span></label>
    <input type="range" class="form-slider weight-slider" id="${id}" min="0" max="100" value="${Math.round(value*100)}" data-field="${id}">
  </div>`;
}

function bindSettingsEvents(container) {
  // Weight sliders
  container.querySelectorAll('.weight-slider').forEach(s => {
    s.addEventListener('input', () => {
      document.getElementById(s.id + '-val').textContent = (s.value / 100).toFixed(2);
      const sum = ['w-urgency','w-topicWeight','w-weakness','w-performance']
        .reduce((a, id) => a + parseInt(document.getElementById(id).value), 0) / 100;
      document.getElementById('weight-sum').textContent = `Sum: ${sum.toFixed(2)}`;
      document.getElementById('weight-sum').style.color = Math.abs(sum - 1) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)';
    });
  });

  container.querySelector('#save-weights-btn')?.addEventListener('click', () => {
    const w = {
      urgency: parseInt(document.getElementById('w-urgency').value) / 100,
      topicWeight: parseInt(document.getElementById('w-topicWeight').value) / 100,
      weakness: parseInt(document.getElementById('w-weakness').value) / 100,
      performance: parseInt(document.getElementById('w-performance').value) / 100,
    };
    const sum = Object.values(w).reduce((a,b) => a+b, 0);
    if (Math.abs(sum - 1) > 0.05) {
      showToast({ title: 'Invalid Weights', message: `Weights sum to ${sum.toFixed(2)}, should be ~1.0`, type: 'error' });
      return;
    }
    store.updateSettings({ weights: w });
    showToast({ title: 'Weights Saved!', message: 'Priority weights updated.', type: 'success' });
  });

  container.querySelector('#save-constraints-btn')?.addEventListener('click', () => {
    store.updateSettings({ constraints: {
      maxConsecutiveSameSubject: parseInt(document.getElementById('c-maxConsecutive').value),
      breakFrequency: parseInt(document.getElementById('c-breakFreq').value),
      minDailySubjects: parseInt(document.getElementById('c-minSubjects').value),
      maxDailySlotsCount: parseInt(document.getElementById('c-maxDaily').value),
      slotDurationMinutes: parseInt(document.getElementById('c-slotDuration').value),
    }});
    showToast({ title: 'Constraints Saved!', message: 'Scheduling rules updated.', type: 'success' });
  });

  // Availability
  container.querySelectorAll('.add-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = parseInt(btn.dataset.day);
      const start = prompt('Start hour (0-23):', '9');
      const end = prompt('End hour (0-23):', '12');
      if (start !== null && end !== null) {
        const s = store.getSettings();
        if (!s.dailyAvailability[day]) s.dailyAvailability[day] = [];
        s.dailyAvailability[day].push({ start: parseInt(start), end: parseInt(end) });
        store.updateSettings({ dailyAvailability: s.dailyAvailability });
        renderSettings(container);
      }
    });
  });

  container.querySelectorAll('.remove-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = parseInt(btn.dataset.day);
      const idx = parseInt(btn.dataset.idx);
      const s = store.getSettings();
      s.dailyAvailability[day].splice(idx, 1);
      store.updateSettings({ dailyAvailability: s.dailyAvailability });
      renderSettings(container);
    });
  });

  // Data management
  container.querySelector('#export-btn')?.addEventListener('click', () => {
    const data = store.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'study-planner-data.json'; a.click();
    URL.revokeObjectURL(url);
    showToast({ title: 'Exported!', message: 'Data downloaded as JSON.', type: 'success' });
  });

  container.querySelector('#import-btn')?.addEventListener('click', () => document.getElementById('import-file').click());
  container.querySelector('#import-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (store.importData(ev.target.result)) {
        showToast({ title: 'Imported!', message: 'Data loaded successfully.', type: 'success' });
        renderSettings(container);
      } else {
        showToast({ title: 'Import Failed', message: 'Invalid JSON file.', type: 'error' });
      }
    };
    reader.readAsText(file);
  });

  container.querySelector('#load-demo-btn')?.addEventListener('click', () => { loadDemoData(); renderSettings(container); });
  container.querySelector('#reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset ALL data? This cannot be undone.')) {
      store.resetAll();
      showToast({ title: 'Reset Complete', message: 'All data has been cleared.', type: 'info' });
      renderSettings(container);
    }
  });
}

export function loadDemoData() {
  const { createExam, createTopic, createMockResult } = require_models();
  store.resetAll();

  const today = new Date();
  const d = (offset) => { const x = new Date(today); x.setDate(x.getDate() + offset); return x.toISOString().split('T')[0]; };

  const e1 = createExam({ name: 'Calculus II', date: d(7), color: '#6366f1' });
  const e2 = createExam({ name: 'Data Structures', date: d(12), color: '#ec4899' });
  const e3 = createExam({ name: 'Physics I', date: d(5), color: '#f59e0b' });

  store.addExam(e1); store.addExam(e2); store.addExam(e3);

  const topics = [
    createTopic({ examId: e1.id, name: 'Integration by Parts', weight: 8, selfAssessment: 2, estimatedMinutes: 90 }),
    createTopic({ examId: e1.id, name: 'Taylor Series', weight: 7, selfAssessment: 3, estimatedMinutes: 60 }),
    createTopic({ examId: e1.id, name: 'Partial Fractions', weight: 5, selfAssessment: 4, estimatedMinutes: 45 }),
    createTopic({ examId: e2.id, name: 'Binary Trees', weight: 9, selfAssessment: 2, estimatedMinutes: 90 }),
    createTopic({ examId: e2.id, name: 'Hash Tables', weight: 7, selfAssessment: 3, estimatedMinutes: 60 }),
    createTopic({ examId: e2.id, name: 'Graph Algorithms', weight: 8, selfAssessment: 1, estimatedMinutes: 120 }),
    createTopic({ examId: e3.id, name: 'Newton\'s Laws', weight: 9, selfAssessment: 3, estimatedMinutes: 60 }),
    createTopic({ examId: e3.id, name: 'Thermodynamics', weight: 7, selfAssessment: 2, estimatedMinutes: 90 }),
    createTopic({ examId: e3.id, name: 'Wave Motion', weight: 6, selfAssessment: 4, estimatedMinutes: 45 }),
  ];
  topics.forEach(t => store.addTopic(t));

  // Mock results
  const mocks = [
    createMockResult({ topicId: topics[0].id, score: 35, maxScore: 100, date: d(-5) }),
    createMockResult({ topicId: topics[0].id, score: 45, maxScore: 100, date: d(-2) }),
    createMockResult({ topicId: topics[1].id, score: 60, maxScore: 100, date: d(-3) }),
    createMockResult({ topicId: topics[3].id, score: 30, maxScore: 100, date: d(-4) }),
    createMockResult({ topicId: topics[3].id, score: 40, maxScore: 100, date: d(-1) }),
    createMockResult({ topicId: topics[5].id, score: 20, maxScore: 100, date: d(-3) }),
    createMockResult({ topicId: topics[6].id, score: 55, maxScore: 100, date: d(-2) }),
    createMockResult({ topicId: topics[7].id, score: 40, maxScore: 100, date: d(-4) }),
  ];
  mocks.forEach(m => store.addMockResult(m));

  showToast({ title: 'Demo Data Loaded! 🎲', message: '3 exams, 9 topics, and 8 mock results added.', type: 'success' });
}

function require_models() {
  // Dynamic import workaround for sync usage
  return { createExam: window.__models.createExam, createTopic: window.__models.createTopic, createMockResult: window.__models.createMockResult };
}
