import { t } from '../data/i18n.js';
import { showToast } from './components.js';

const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('studyPlanner_authToken');
}

async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function renderProfile(container) {
  container.innerHTML = '<div class="page-header"><h2>' + t('profile.title') + '</h2><p>' + t('profile.subtitle') + '</p></div><div class="card" id="profile-content"><div class="loading-state">' + t('profile.loading') + '</div></div>';

  try {
    const profile = await api('GET', '/profile');
    renderProfileForm(container, profile);
    bindEvents(container, profile);
  } catch (err) {
    document.getElementById('profile-content').innerHTML = '<div class="error-state"><p>' + err.message + '</p></div>';
  }
}

function renderProfileForm(container, profile) {
  var pn = { 1: t('profile.partSay'), 2: t('profile.partEa'), 3: t('profile.partDil'), 4: t('profile.partSozel') };

  container.querySelector('#profile-content').innerHTML = [
    '<form id="profile-form">',
    '<div class="grid-2" style="margin-bottom: var(--space-lg);">',
    '<div class="form-group"><label class="form-label">' + t('auth.fullName') + '</label><input class="form-input" type="text" id="prof-name" value="' + h(profile.name) + '" required></div>',
    '<div class="form-group"><label class="form-label">' + t('auth.email') + '</label><input class="form-input" type="email" value="' + h(profile.email) + '" disabled><small style="color:var(--text-tertiary);">' + t('profile.emailLocked') + '</small></div>',
    '</div>',
    '<div class="grid-2" style="margin-bottom: var(--space-lg);">',
    '<div class="form-group"><label class="form-label">' + t('auth.uniqueId') + '</label><input class="form-input" type="text" value="' + h(profile.unique_id) + '" disabled><small style="color:var(--text-tertiary);">' + t('profile.uniqueIdLocked') + '</small></div>',
    '<div class="form-group"><label class="form-label">' + t('auth.grade') + ' / ' + t('auth.part') + '</label><input class="form-input" type="text" value="' + profile.grade + '. Sınıf — ' + (pn[profile.part_id] || '?') + '" disabled><small style="color:var(--text-tertiary);">' + t('profile.gradeLocked') + '</small></div>',
    '</div>',
    '<div class="grid-2" style="margin-bottom: var(--space-lg);">',
    '<div class="form-group"><label class="form-label">' + t('auth.age') + '</label><input class="form-input" type="number" id="prof-age" min="14" max="20" value="' + profile.age + '"></div>',
    '<div class="form-group"><label class="form-label">' + t('auth.phoneNumber') + '</label><input class="form-input" type="tel" id="prof-phone" placeholder="5XX XXX XX XX" value="' + h(profile.phone_number || '') + '"></div>',
    '</div>',
    '<div class="form-group" style="margin-bottom: var(--space-lg);"><label class="form-label">' + t('auth.birthdate') + '</label><input class="form-input" type="date" id="prof-birthdate" value="' + (profile.birthdate ? profile.birthdate.split('T')[0] : '') + '"></div>',
    '<small style="color:var(--text-tertiary);">' + t('profile.joined') + ': ' + new Date(profile.created_at).toLocaleDateString('tr-TR') + '</small>',
    '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-lg);">',
    '<button type="submit" class="btn btn-primary btn-lg">' + t('profile.save') + '</button>',
    '<button type="button" id="prof-cancel" class="btn btn-secondary btn-lg">' + t('generic.cancel') + '</button>',
    '</div>',
    '</form>',
    '<hr style="margin: var(--space-xl) 0; border-color: var(--border-subtle);">',
    '<h3>' + t('profile.passwordTitle') + '</h3>',
    '<div class="grid-2" style="margin-bottom: var(--space-lg);">',
    '<div class="form-group"><label class="form-label">' + t('profile.currentPassword') + '</label><input class="form-input" type="password" id="prof-curpass" placeholder="' + t('profile.currentPassword') + '"></div>',
    '<div class="form-group"><label class="form-label">' + t('profile.newPassword') + '</label><input class="form-input" type="password" id="prof-newpass" placeholder="' + t('profile.newPassword') + '" minlength="6"></div>',
    '</div>',
    '<button type="button" id="prof-changepass" class="btn btn-warning btn-lg">' + t('profile.changePassword') + '</button>'
  ].join('');
}

function bindEvents(container, profile) {
  container.querySelector('#profile-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var updates = {
      name: container.querySelector('#prof-name').value.trim(),
      age: parseInt(container.querySelector('#prof-age').value),
      phoneNumber: container.querySelector('#prof-phone').value.trim() || null,
      birthdate: container.querySelector('#prof-birthdate').value,
    };
    try {
      await api('PUT', '/profile', updates);
      showToast({ title: t('profile.saved'), message: t('profile.savedMsg'), type: 'success' });
    } catch (err) {
      showToast({ title: t('profile.error'), message: err.message, type: 'error' });
    }
  });

  container.querySelector('#prof-cancel').addEventListener('click', function() {
    renderProfileForm(container, profile);
    bindEvents(container, profile);
  });

  container.querySelector('#prof-changepass').addEventListener('click', async function() {
    var cur = container.querySelector('#prof-curpass').value;
    var nw = container.querySelector('#prof-newpass').value;
    if (!cur || !nw) { showToast({ title: 'Hata', message: 'Mevcut ve yeni şifre gereklidir.', type: 'warning' }); return; }
    if (nw.length < 6) { showToast({ title: 'Hata', message: 'Yeni şifre en az 6 karakter olmalıdır.', type: 'warning' }); return; }
    try {
      await api('POST', '/auth/change-password', { currentPassword: cur, newPassword: nw });
      showToast({ title: t('profile.passwordChanged'), message: t('profile.passwordChanged'), type: 'success' });
      container.querySelector('#prof-curpass').value = '';
      container.querySelector('#prof-newpass').value = '';
    } catch (err) {
      showToast({ title: t('profile.error'), message: err.message, type: 'error' });
    }
  });
}

function h(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
