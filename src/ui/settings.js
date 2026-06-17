/**
 * Settings View
 * Student-facing preferences, availability editor,
 * theme toggle, language selector, data reset
 */

import { store } from '../data/store.js';
import { t, getLang, setLang, getAvailableLanguages } from '../data/i18n.js';
import { getTheme, setTheme } from '../data/theme.js';
import { areNotificationsEnabled, toggleNotifications } from '../engine/notifications.js';
import { showToast } from './components.js';

export function renderSettings(container) {
  const settings = store.getSettings();
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
        <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
          <label class="form-label">${t('settings.notifications')}</label>
          <div style="display: flex; gap: var(--space-sm); align-items: center;">
            <button class="btn ${areNotificationsEnabled() ? 'btn-primary' : 'btn-secondary'}" id="toggle-notifications-btn">${t('settings.desktopNotifications')} (${areNotificationsEnabled() ? 'Açık' : 'Kapalı'})</button>
            <span style="font-size: var(--font-xs); color: var(--text-tertiary); max-width: 250px;">${t('settings.notifyDesc')}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Daily Availability -->
    <div class="card animate-fade-in-up" style="margin-top:var(--space-lg); animation-delay: 0.2s">
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

    <!-- Data Reset -->
    <div class="card animate-fade-in-up" style="margin-top:var(--space-lg); animation-delay: 0.3s">
      <div class="card-header"><h3 class="card-title">💾 ${t('settings.dataManagement')}</h3></div>
      <p style="color:var(--text-secondary);font-size:var(--font-sm);margin-bottom:var(--space-md);">
        ${t('settings.resetDesc')}
      </p>
      <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">
        <button class="btn btn-danger" id="reset-btn">${t('settings.reset')}</button>
      </div>
    </div>
  `;

  bindSettingsEvents(container);
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

  container.querySelector('#reset-btn')?.addEventListener('click', () => {
    if (confirm(t('settings.confirmReset'))) {
      store.resetAll();
      showToast({ title: t('settings.resetComplete'), message: t('settings.resetCompleteMsg'), type: 'info' });
      renderSettings(container);
    }
  });
}
