/**
 * App Bootstrap & Router
 * SPA routing, navigation, and layout initialization
 */

import './styles/main.css';
import { createExam, createTopic, createMockResult } from './data/models.js';
import { store } from './data/store.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderExamManager } from './ui/examManager.js';
import { renderScheduleView } from './ui/scheduleView.js';
import { renderAnalytics } from './ui/analytics.js';
import { renderSettings, loadDemoData } from './ui/settings.js';

// Expose models globally for settings demo data loader
window.__models = { createExam, createTopic, createMockResult };

const routes = {
  dashboard: { label: 'Dashboard', icon: '📊', render: renderDashboard },
  exams: { label: 'Exam Manager', icon: '🎓', render: renderExamManager },
  schedule: { label: 'Schedule', icon: '📅', render: renderScheduleView },
  analytics: { label: 'Analytics', icon: '📈', render: renderAnalytics },
  settings: { label: 'Settings', icon: '⚙️', render: renderSettings },
};

let currentRoute = 'dashboard';

function init() {
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
      <div style="padding: 0 var(--space-lg); margin-top: auto;">
        <div style="padding: var(--space-md); background: var(--bg-glass); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <div style="font-size: var(--font-xs); color: var(--text-tertiary); margin-bottom: var(--space-xs);">Rule-Based Engine</div>
          <div style="font-size: var(--font-xs); color: var(--text-secondary);">Heuristic scoring · Weighted priorities · Dynamic scheduling</div>
        </div>
      </div>
    </aside>
    <main class="main-content" id="main-content"></main>
  `;

  renderNav();
  
  // Handle hash routing
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);
  });

  // Mobile menu
  document.getElementById('mobile-menu-btn').addEventListener('click', toggleMobileMenu);
  document.getElementById('sidebar-overlay').addEventListener('click', toggleMobileMenu);

  // Initial route
  const initialHash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(initialHash);

  // Listen for store changes to refresh current view
  store.on('change', () => {
    // Don't auto-refresh if user is interacting with a modal
    if (document.querySelector('.modal-overlay.active')) return;
  });
}

function renderNav() {
  const nav = document.getElementById('sidebar-nav');
  const exams = store.getExams();
  const missedCount = store.getSessions({ status: 'missed' }).length;

  nav.innerHTML = Object.entries(routes).map(([key, route]) => {
    let badge = '';
    if (key === 'exams' && exams.length > 0) badge = `<span class="nav-badge">${exams.length}</span>`;
    if (key === 'schedule' && missedCount > 0) badge = `<span class="nav-badge" style="background: var(--color-danger);">${missedCount}</span>`;

    return `
      <a class="nav-item ${currentRoute === key ? 'active' : ''}" data-route="${key}" href="#${key}">
        <span class="nav-icon">${route.icon}</span>
        <span>${route.label}</span>
        ${badge}
      </a>
    `;
  }).join('');

  // Bind nav clicks
  nav.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.route);
      // Close mobile menu
      const sidebar = document.getElementById('sidebar');
      if (sidebar.classList.contains('open')) toggleMobileMenu();
    });
  });
}

function navigateTo(route) {
  if (!routes[route]) route = 'dashboard';
  currentRoute = route;
  window.location.hash = route;

  const content = document.getElementById('main-content');
  content.innerHTML = '';
  content.className = 'main-content animate-fade-in';

  routes[route].render(content);
  renderNav();
}

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
