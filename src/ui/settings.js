/**
 * Settings View
 * Priority weight adjustment, constraint config, availability editor,
 * theme toggle, language selector, data export/import
 */

import { store } from '../data/store.js';
import { t, getLang, setLang, getAvailableLanguages } from '../data/i18n.js';
import { getTheme, setTheme } from '../data/theme.js';
import { areNotificationsEnabled, toggleNotifications } from '../engine/notifications.js';
import { showToast } from './components.js';

export function renderSettings(container) {
  const settings = store.getSettings();
  const w = settings.weights;
  const c = settings.constraints;
  const currentTheme = getTheme();
  const currentLang = getLang();

  container.innerHTML = `
    <div class="page-header">
      <h2>⚙️ ${t('settings.title')}</h2>
      <p>${t('settings.subtitle')}</p>
    </div>

    <!-- Theme & Language -->
    <div class="card animate-fade-in-up" style="margin-bottom: var(--space-lg); animation-delay: 0.1s">
      <div style="display: flex; gap: var(--space-xl); flex-wrap: wrap; align-items: center;">
        <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
          <label class="form-label">${t('settings.theme')}</label>
          <div style="display: flex; gap: var(--space-sm);">
            <button class="btn ${currentTheme === 'dark' ? 'btn-primary' : 'btn-secondary'}" id="theme-dark-btn">${t('settings.darkTheme')}</button>
            <button class="btn ${currentTheme === 'light' ? 'btn-primary' : 'btn-secondary'}" id="theme-light-btn">${t('settings.lightTheme')}</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
          <label class="form-label">${t('settings.language')}</label>
          <select class="form-select" id="lang-select">
            ${getAvailableLanguages().map(l =>
              `<option value="${l.code}" ${l.code === currentLang ? 'selected' : ''}>${l.label}</option>`
            ).join('')}
          </select>
        </div>
        </div>
        <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
          <label class="form-label">${t('settings.notifications')}</label>
          <div style="display: flex; gap: var(--space-sm); align-items: center;">
            <button class="btn ${areNotificationsEnabled() ? 'btn-primary' : 'btn-secondary'}" id="toggle-notifications-btn">${t('settings.desktopNotifications')} (${areNotificationsEnabled() ? 'Açık' : 'Kapalı'})</button>
            <span style="font-size: var(--font-xs); color: var(--text-tertiary); max-width: 250px;">${t('settings.notifyDesc')}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <!-- Priority Weights -->
      <div class="card animate-fade-in-up" style="animation-delay: 0.2s">
        <div class="card-header"><h3 class="card-title">🎚️ ${t('settings.priorityWeights')}</h3></div>
        <p style="color:var(--text-secondary);font-size:var(--font-sm);margin-bottom:var(--space-md);">
          ${t('settings.priorityWeightsDesc')}
        </p>
        ${renderWeightSlider(t('settings.urgency'), 'w-urgency', w.urgency)}
        ${renderWeightSlider(t('settings.topicWeight'), 'w-topicWeight', w.topicWeight)}
        ${renderWeightSlider(t('settings.weakness'), 'w-weakness', w.weakness)}
        ${renderWeightSlider(t('settings.performance'), 'w-performance', w.performance)}
        <div style="text-align:right;margin-top:var(--space-sm);">
          <span id="weight-sum" style="font-size:var(--font-sm);color:var(--text-tertiary);">${t('settings.sum')}: ${(w.urgency+w.topicWeight+w.weakness+w.performance).toFixed(2)}</span>
        </div>
        <button class="btn btn-primary" id="save-weights-btn" style="margin-top:var(--space-md);width:100%;">${t('settings.saveWeights')}</button>
      </div>

      <!-- Scheduling Constraints -->
      <div class="card animate-fade-in-up" style="animation-delay: 0.3s">
        <div class="card-header"><h3 class="card-title">📐 ${t('settings.constraints')}</h3></div>
        <div class="form-group">
          <label class="form-label">${t('settings.maxConsecutive')}</label>
          <input type="number" class="form-input" id="c-maxConsecutive" value="${c.maxConsecutiveSameSubject}" min="1" max="10">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.breakFreq')}</label>
          <input type="number" class="form-input" id="c-breakFreq" value="${c.breakFrequency}" min="1" max="10">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.minSubjects')}</label>
          <input type="number" class="form-input" id="c-minSubjects" value="${c.minDailySubjects}" min="1" max="5">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.maxDaily')}</label>
          <input type="number" class="form-input" id="c-maxDaily" value="${c.maxDailySlotsCount}" min="2" max="24">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.slotDuration')}</label>
          <input type="number" class="form-input" id="c-slotDuration" value="${c.slotDurationMinutes}" min="15" max="60" step="15">
        </div>
        <button class="btn btn-primary" id="save-constraints-btn" style="width:100%;">${t('settings.saveConstraints')}</button>
      </div>
    </div>

    <!-- Daily Availability -->
    <div class="card animate-fade-in-up" style="margin-top:var(--space-lg); animation-delay: 0.4s">
      <div class="card-header"><h3 class="card-title">🕐 ${t('settings.availability')}</h3></div>
      <p style="color:var(--text-secondary);font-size:var(--font-sm);margin-bottom:var(--space-md);">
        ${t('settings.availabilityDesc')}
      </p>
      <div id="availability-editor">
        ${t('settings.dayNames').map((day, i) => {
          const blocks = settings.dailyAvailability[i] || [];
          return `<div style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);">
            <span style="min-width:100px;font-weight:600;font-size:var(--font-sm);">${day}</span>
            <div style="flex:1;display:flex;gap:var(--space-sm);flex-wrap:wrap;" id="avail-blocks-${i}">
              ${blocks.map((b, bi) => `
                <span class="tag">${b.start}:00 - ${b.end}:00
                  <button class="remove-block-btn" data-day="${i}" data-idx="${bi}" style="background:none;border:none;color:var(--color-danger);cursor:pointer;margin-left:4px;">✕</button>
                </span>
              `).join('') || `<span style="color:var(--text-tertiary);font-size:var(--font-xs);">${t('settings.noBlocks')}</span>`}
            </div>
            <button class="btn btn-sm btn-secondary add-block-btn" data-day="${i}">${t('settings.addBlock')}</button>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Data Management -->
    <div class="card animate-fade-in-up" style="margin-top:var(--space-lg); animation-delay: 0.5s">
      <div class="card-header"><h3 class="card-title">💾 ${t('settings.dataManagement')}</h3></div>
      <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">
        <button class="btn btn-secondary" id="export-btn">${t('settings.export')}</button>
        <button class="btn btn-secondary" id="import-btn">${t('settings.import')}</button>
        <button class="btn btn-secondary" id="load-demo-btn">${t('settings.loadDemo')}</button>
        <button class="btn btn-danger" id="reset-btn">${t('settings.reset')}</button>
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
  // Theme toggle
  container.querySelector('#theme-dark-btn')?.addEventListener('click', () => {
    setTheme('dark');
    renderSettings(container);
  });
  container.querySelector('#theme-light-btn')?.addEventListener('click', () => {
    setTheme('light');
    renderSettings(container);
  });

  // Language selector
  container.querySelector('#lang-select')?.addEventListener('change', (e) => {
    setLang(e.target.value);
    // Re-render the entire app shell
    window.location.reload();
  });

  // Notifications
  container.querySelector('#toggle-notifications-btn')?.addEventListener('click', async (e) => {
    if (!('Notification' in window)) {
      showToast({ title: 'Desteklenmiyor', message: 'Tarayıcınız bildirimleri desteklemiyor.', type: 'error' });
      return;
    }
    const isEnabled = await toggleNotifications();
    const btn = e.target;
    btn.className = `btn ${isEnabled ? 'btn-primary' : 'btn-secondary'}`;
    btn.innerText = `${t('settings.desktopNotifications')} (${isEnabled ? 'Açık' : 'Kapalı'})`;
    
    if (!isEnabled && Notification.permission === 'denied') {
      showToast({ title: t('settings.notificationsBlocked'), message: 'Tarayıcı ayarlarından izin vermelisiniz.', type: 'warning' });
    }
  });

  // Weight sliders
  container.querySelectorAll('.weight-slider').forEach(s => {
    s.addEventListener('input', () => {
      document.getElementById(s.id + '-val').textContent = (s.value / 100).toFixed(2);
      const sum = ['w-urgency','w-topicWeight','w-weakness','w-performance']
        .reduce((a, id) => a + parseInt(document.getElementById(id).value), 0) / 100;
      document.getElementById('weight-sum').textContent = `${t('settings.sum')}: ${sum.toFixed(2)}`;
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
      showToast({ title: t('settings.invalidWeights'), message: t('settings.invalidWeightsMsg', { sum: sum.toFixed(2) }), type: 'error' });
      return;
    }
    store.updateSettings({ weights: w });
    showToast({ title: t('settings.weightsSaved'), message: t('settings.weightsSavedMsg'), type: 'success' });
  });

  container.querySelector('#save-constraints-btn')?.addEventListener('click', () => {
    store.updateSettings({ constraints: {
      maxConsecutiveSameSubject: parseInt(document.getElementById('c-maxConsecutive').value),
      breakFrequency: parseInt(document.getElementById('c-breakFreq').value),
      minDailySubjects: parseInt(document.getElementById('c-minSubjects').value),
      maxDailySlotsCount: parseInt(document.getElementById('c-maxDaily').value),
      slotDurationMinutes: parseInt(document.getElementById('c-slotDuration').value),
    }});
    showToast({ title: t('settings.constraintsSaved'), message: t('settings.constraintsSavedMsg'), type: 'success' });
  });

  // Availability
  container.querySelectorAll('.add-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = parseInt(btn.dataset.day);
      const start = prompt(t('settings.startHour'), '9');
      const end = prompt(t('settings.endHour'), '12');
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
    showToast({ title: t('settings.exported'), message: t('settings.exportedMsg'), type: 'success' });
  });

  container.querySelector('#import-btn')?.addEventListener('click', () => document.getElementById('import-file').click());
  container.querySelector('#import-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (store.importData(ev.target.result)) {
        showToast({ title: t('settings.imported'), message: t('settings.importedMsg'), type: 'success' });
        renderSettings(container);
      } else {
        showToast({ title: t('settings.importFailed'), message: t('settings.importFailedMsg'), type: 'error' });
      }
    };
    reader.readAsText(file);
  });

  container.querySelector('#load-demo-btn')?.addEventListener('click', () => { loadDemoData(); renderSettings(container); });
  container.querySelector('#reset-btn')?.addEventListener('click', () => {
    if (confirm(t('settings.confirmReset'))) {
      store.resetAll();
      showToast({ title: t('settings.resetComplete'), message: t('settings.resetCompleteMsg'), type: 'info' });
      renderSettings(container);
    }
  });
}

export function loadDemoData() {
  const { createExam, createTopic, createMockResult } = require_models();
  store.resetAll();

  const today = new Date();
  const d = (offset) => { const x = new Date(today); x.setDate(x.getDate() + offset); return x.toISOString().split('T')[0]; };

  const e1 = createExam({ name: 'Kalkülüs II', date: d(7), color: '#6366f1' });
  const e2 = createExam({ name: 'Veri Yapıları', date: d(12), color: '#ec4899' });
  const e3 = createExam({ name: 'Fizik I', date: d(5), color: '#f59e0b' });

  store.addExam(e1); store.addExam(e2); store.addExam(e3);

  const topics = [
    createTopic({ examId: e1.id, name: 'Kısmi İntegrasyon', weight: 8, selfAssessment: 2, estimatedMinutes: 90 }),
    createTopic({ examId: e1.id, name: 'Taylor Serileri', weight: 7, selfAssessment: 3, estimatedMinutes: 60 }),
    createTopic({ examId: e1.id, name: 'Kısmi Kesirler', weight: 5, selfAssessment: 4, estimatedMinutes: 45 }),
    createTopic({ examId: e2.id, name: 'İkili Ağaçlar', weight: 9, selfAssessment: 2, estimatedMinutes: 90 }),
    createTopic({ examId: e2.id, name: 'Hash Tabloları', weight: 7, selfAssessment: 3, estimatedMinutes: 60 }),
    createTopic({ examId: e2.id, name: 'Graf Algoritmaları', weight: 8, selfAssessment: 1, estimatedMinutes: 120 }),
    createTopic({ examId: e3.id, name: 'Newton Kanunları', weight: 9, selfAssessment: 3, estimatedMinutes: 60 }),
    createTopic({ examId: e3.id, name: 'Termodinamik', weight: 7, selfAssessment: 2, estimatedMinutes: 90 }),
    createTopic({ examId: e3.id, name: 'Dalga Hareketi', weight: 6, selfAssessment: 4, estimatedMinutes: 45 }),
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

  showToast({ title: t('settings.demoLoaded'), message: t('settings.demoLoadedMsg'), type: 'success' });
}

function require_models() {
  // Dynamic import workaround for sync usage
  return { createExam: window.__models.createExam, createTopic: window.__models.createTopic, createMockResult: window.__models.createMockResult };
}
