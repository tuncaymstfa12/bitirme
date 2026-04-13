/**
 * App Bootstrap & Router
 * SPA routing, navigation, and layout initialization
 */

import './styles/main.css';
import { createExam, createTopic, createMockResult } from './data/models.js';
import { store } from './data/store.js';
import { fetchCurrentUserApi, logoutUserApi } from './api/authApi.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderExamManager } from './ui/examManager.js';
import { renderScheduleView } from './ui/scheduleView.js';
import { renderAnalytics } from './ui/analytics.js';
import { renderSettings } from './ui/settings.js';
import { showToast } from './ui/components.js';
import { renderAuthView } from './ui/authView.js';

window.__models = { createExam, createTopic, createMockResult };

const routes = {
  dashboard: { label: 'Dashboard', icon: '📊', render: renderDashboard },
  exams: { label: 'Exam Manager', icon: '🎓', render: renderExamManager },
  schedule: { label: 'Schedule', icon: '🗓', render: renderScheduleView },
  analytics: { label: 'Analytics', icon: '📈', render: renderAnalytics },
  settings: { label: 'Settings', icon: '⚙️', render: renderSettings },
};

let currentRoute = 'dashboard';
let currentUser = null;
let authBootError = '';

async function init() {
  window.addEventListener('hashchange', handleHashChange);

  store.on('change', () => {
    if (!currentUser) return;
    if (document.querySelector('.modal-overlay.active')) return;
  });

  await bootstrapSession();
}

async function bootstrapSession() {
  renderLoadingState();

  try {
    currentUser = await fetchCurrentUserApi();
    authBootError = '';
  } catch (error) {
    currentUser = null;
    authBootError = 'Auth API is not reachable. Start it with `npm run api`.';
  }

  renderCurrentShell();
}

function renderCurrentShell() {
  if (currentUser) {
    renderAppShell();
    navigateTo(window.location.hash.replace('#', '') || currentRoute || 'dashboard');
    return;
  }

  renderAuthShell();
}

function renderLoadingState() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-loading">
        <div class="auth-loading-spinner"></div>
        <p>Checking session…</p>
      </div>
    </div>
  `;
}

function renderAuthShell() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="auth-shell" id="auth-shell"></div>';

  renderAuthView(document.getElementById('auth-shell'), {
    initialError: authBootError,
    onAuthenticated(user) {
      currentUser = user;
      authBootError = '';
      showToast({
        title: 'Signed in',
        message: `Welcome, ${user.name}.`,
        type: 'success',
      });
      renderCurrentShell();
    },
  });
}

function renderAppShell() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <button class="mobile-menu-btn" id="mobile-menu-btn">☰</button>
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <h1>StudyEngine</h1>
        <p>Adaptive Planner</p>
      </div>
      <nav class="sidebar-nav" id="sidebar-nav"></nav>
      <div class="sidebar-footer">
        <div class="sidebar-engine-card">
          <div class="sidebar-engine-label">Rule-Based Engine</div>
          <div class="sidebar-engine-text">Heuristic scoring · Weighted priorities · Dynamic scheduling</div>
        </div>
        <div class="sidebar-user-card">
          <div class="sidebar-user-name">${escapeHtml(currentUser?.name || 'User')}</div>
          <div class="sidebar-user-email">${escapeHtml(currentUser?.email || '')}</div>
          <button class="btn btn-secondary btn-sm" id="logout-btn" style="width: 100%; margin-top: var(--space-sm);">Log Out</button>
        </div>
      </div>
    </aside>
    <main class="main-content" id="main-content"></main>
  `;

  renderNav();

  document.getElementById('mobile-menu-btn').addEventListener('click', toggleMobileMenu);
  document.getElementById('sidebar-overlay').addEventListener('click', toggleMobileMenu);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

function renderNav() {
  if (!currentUser) return;

  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  const exams = store.getExams();
  const missedCount = store.getSessions({ status: 'missed' }).length;

  nav.innerHTML = Object.entries(routes).map(([key, route]) => {
    let badge = '';

    if (key === 'exams' && exams.length > 0) {
      badge = `<span class="nav-badge">${exams.length}</span>`;
    }

    if (key === 'schedule' && missedCount > 0) {
      badge = `<span class="nav-badge" style="background: var(--color-danger);">${missedCount}</span>`;
    }

    return `
      <a class="nav-item ${currentRoute === key ? 'active' : ''}" data-route="${key}" href="#${key}">
        <span class="nav-icon">${route.icon}</span>
        <span>${route.label}</span>
        ${badge}
      </a>
    `;
  }).join('');

  nav.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', event => {
      event.preventDefault();
      navigateTo(item.dataset.route);

      const sidebar = document.getElementById('sidebar');
      if (sidebar?.classList.contains('open')) toggleMobileMenu();
    });
  });
}

function navigateTo(route) {
  if (!currentUser) return;

  if (!routes[route]) route = 'dashboard';
  currentRoute = route;

  if (window.location.hash !== `#${route}`) {
    window.location.hash = route;
  }

  const content = document.getElementById('main-content');
  if (!content) return;

  content.innerHTML = '';
  content.className = 'main-content animate-fade-in';

  routes[route].render(content);
  renderNav();
}

function handleHashChange() {
  if (!currentUser) return;
  navigateTo(window.location.hash.replace('#', '') || 'dashboard');
}

async function handleLogout() {
  try {
    await logoutUserApi();
  } catch (error) {
    showToast({
      title: 'Logout failed',
      message: error.message,
      type: 'error',
    });
    return;
  }

  currentUser = null;
  authBootError = '';
  renderCurrentShell();
}

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar?.classList.toggle('open');
  overlay?.classList.toggle('active');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
