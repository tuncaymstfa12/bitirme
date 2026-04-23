/**
 * Dashboard View
 * Overview: upcoming exams, today's schedule, priority rankings, insights
 */

import { store } from '../data/store.js';
import { t } from '../data/i18n.js';
import { rankTopics, getPriorityLabel, getPriorityClass } from '../engine/priorityCalculator.js';
import { generateInsights } from '../engine/performanceAnalyzer.js';
import { getScheduleStats } from '../engine/scheduler.js';
import { formatDate, formatTime, daysUntil, showToast, drawDonutChart } from './components.js';

export function renderDashboard(container) {
  const exams = store.getExams();
  const topics = store.getTopics();
  const sessions = store.getSessions();
  const mockResults = store.getMockResults();
  const settings = store.getSettings();

  const ranked = rankTopics(exams, topics, mockResults, settings.weights);
  const stats = getScheduleStats(sessions, topics, exams);
  const insights = generateInsights(exams, topics, mockResults, sessions);

  const todayStr = new Date().toISOString().split('T')[0];
  const todaySessions = sessions.filter(s => s.date === todayStr && s.status !== 'break');

  // Upcoming exams (next 30 days)
  const upcomingExams = exams
    .filter(e => {
      const d = daysUntil(e.date);
      return d >= 0 && d <= 30;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  container.innerHTML = `
    <div class="page-header">
      <h2>📊 ${t('dashboard.title')}</h2>
      <p>${t('dashboard.subtitle')}</p>
    </div>

    <!-- Stats -->
    <div class="stats-grid animate-fade-in-up">
      <div class="stat-card accent" style="animation-delay: 0.1s">
        <div class="stat-icon">📚</div>
        <div class="stat-value">${exams.length}</div>
        <div class="stat-label">${t('dashboard.activeExams')}</div>
      </div>
      <div class="stat-card info" style="animation-delay: 0.2s">
        <div class="stat-icon">📖</div>
        <div class="stat-value">${topics.length}</div>
        <div class="stat-label">${t('dashboard.topicsToStudy')}</div>
      </div>
      <div class="stat-card success" style="animation-delay: 0.3s">
        <div class="stat-icon">✓</div>
        <div class="stat-value">${stats.completedSessions}</div>
        <div class="stat-label">${t('dashboard.completedSessions')}</div>
      </div>
      <div class="stat-card ${stats.missedSessions > 0 ? 'danger' : 'warning'}" style="animation-delay: 0.4s">
        <div class="stat-icon">${stats.missedSessions > 0 ? '⚠' : '📅'}</div>
        <div class="stat-value">${stats.missedSessions > 0 ? stats.missedSessions : stats.scheduledSessions}</div>
        <div class="stat-label">${stats.missedSessions > 0 ? t('dashboard.missedSessions') : t('dashboard.scheduledSessions')}</div>
      </div>
    </div>

    <div class="grid-2">
      <!-- Left Column -->
      <div class="animate-fade-in-up" style="animation-delay: 0.2s">
        <!-- Today's Schedule -->
        <div class="section">
          <h3 class="section-title">📅 ${t('dashboard.todaySchedule')}</h3>
          <div class="card">
            ${todaySessions.length === 0 
              ? `<div class="empty-state">
                  <div class="empty-icon">📭</div>
                  <p>${t('dashboard.noSessionsToday')}</p>
                </div>`
              : todaySessions.map(session => {
                  const topic = store.getTopic(session.topicId);
                  const exam = topic ? store.getExam(topic.examId) : null;
                  return `
                    <div class="schedule-slot ${session.status}" data-session-id="${session.id}">
                      <span class="schedule-time">${formatTime(session.startHour, session.startMinute)}</span>
                      ${exam ? `<span class="schedule-exam-dot" style="background: ${exam.color}"></span>` : ''}
                      <span class="schedule-topic">${topic ? topic.name : t('generic.unknown')}</span>
                      <div class="schedule-actions">
                        ${session.status === 'scheduled' ? `
                          <button class="btn btn-sm btn-success session-complete-btn" data-id="${session.id}" title="${t('dashboard.complete')}">✓</button>
                          <button class="btn btn-sm btn-danger session-miss-btn" data-id="${session.id}" title="${t('dashboard.sessionMissed')}">✕</button>
                        ` : `<span class="tag">${session.status}</span>`}
                      </div>
                    </div>
                  `;
                }).join('')
            }
          </div>
        </div>

        <!-- Insights -->
        ${insights.length > 0 ? `
        <div class="section">
          <h3 class="section-title">💡 ${t('dashboard.insights')}</h3>
          ${insights.map(insight => `
            <div class="insight-card ${insight.type}">
              <span class="insight-icon">${insight.icon}</span>
              <div>
                <div class="insight-title">${insight.title}</div>
                <div class="insight-message">${insight.message}</div>
              </div>
            </div>
          `).join('')}
        </div>
        ` : ''}
      </div>

      <!-- Right Column -->
      <div class="animate-fade-in-up" style="animation-delay: 0.3s">
        <!-- Upcoming Exams -->
        <div class="section">
          <h3 class="section-title">🎯 ${t('dashboard.upcomingExams')}</h3>
          ${upcomingExams.length === 0 
            ? `<div class="card"><div class="empty-state"><p>${t('dashboard.noUpcomingExams')}</p></div></div>`
            : upcomingExams.map(exam => {
                const days = daysUntil(exam.date);
                const examTopics = topics.filter(t => t.examId === exam.id);
                return `
                  <div class="card" style="margin-bottom: var(--space-sm);">
                    <div style="display: flex; align-items: center; gap: var(--space-md);">
                      <span class="exam-color-lg" style="background: ${exam.color}"></span>
                      <div style="flex: 1;">
                        <div style="font-weight: 700;">${exam.name}</div>
                        <div style="font-size: var(--font-xs); color: var(--text-tertiary);">
                          ${formatDate(exam.date)} · ${examTopics.length} ${t('dashboard.topics')}
                        </div>
                      </div>
                      <div style="text-align: right;">
                        <div style="font-size: var(--font-xl); font-weight: 800; color: ${days <= 3 ? 'var(--color-danger)' : days <= 7 ? 'var(--color-warning)' : 'var(--text-accent)'};">
                          ${days}
                        </div>
                        <div style="font-size: var(--font-xs); color: var(--text-tertiary);">${t('dashboard.daysLeft')}</div>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')
          }
        </div>

        <!-- Priority Rankings -->
        <div class="section">
          <h3 class="section-title">🔥 ${t('dashboard.priorityRankings')}</h3>
          ${ranked.length === 0 
            ? `<div class="card"><div class="empty-state"><p>${t('dashboard.noPriorityData')}</p></div></div>`
            : ranked.slice(0, 8).map((r, i) => `
                <div class="priority-bar">
                  <div style="min-width: 24px; font-size: var(--font-xs); color: var(--text-tertiary); font-weight: 700;">#${i + 1}</div>
                  <span class="exam-color" style="background: ${r.exam.color}"></span>
                  <div class="topic-info">
                    <div class="topic-name">${r.topic.name}</div>
                    <div class="exam-name">${r.exam.name}</div>
                  </div>
                  <div class="score-bar">
                    <div class="score-fill ${getPriorityClass(r.score)}" style="width: ${r.score * 100}%"></div>
                  </div>
                  <span class="priority-badge ${getPriorityClass(r.score)}">${getPriorityLabel(r.score)}</span>
                  <div class="score-value">${(r.score * 100).toFixed(0)}%</div>
                </div>
              `).join('')
          }
        </div>

        <!-- Completion Donut -->
        ${stats.totalSessions > 0 ? `
        <div class="section">
          <h3 class="section-title">📈 ${t('dashboard.completionRate')}</h3>
          <div class="card">
            <div class="chart-container" style="max-width: 220px; margin: 0 auto;">
              <canvas id="completionDonut" width="220" height="220"></canvas>
            </div>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  // Bind events
  bindDashboardEvents(container);

  // Draw donut chart
  if (stats.totalSessions > 0) {
    const donutCanvas = document.getElementById('completionDonut');
    if (donutCanvas) {
      const completionPct = stats.totalSessions > 0 
        ? Math.round((stats.completedSessions / stats.totalSessions) * 100) : 0;
      drawDonutChart(donutCanvas, [
        { value: stats.completedSessions, color: '#22c55e' },
        { value: stats.missedSessions, color: '#ef4444' },
        { value: stats.scheduledSessions, color: '#6366f1' },
      ], { centerText: `${completionPct}%`, centerSubtext: t('dashboard.complete') });
    }
  }
}

function bindDashboardEvents(container) {
  // Mark session complete
  container.querySelectorAll('.session-complete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      store.updateSession(id, { status: 'completed', completedAt: new Date().toISOString() });
      
      // Update topic completed minutes
      const session = store.getSession(id);
      if (session) {
        const topic = store.getTopic(session.topicId);
        if (topic) {
          store.updateTopic(topic.id, { 
            completedMinutes: (topic.completedMinutes || 0) + session.durationMinutes 
          });
        }
      }
      
      showToast({ title: t('dashboard.sessionCompleted'), message: t('dashboard.sessionCompletedMsg'), type: 'success' });
      // Re-render
      renderDashboard(container);
    });
  });

  // Mark session missed
  container.querySelectorAll('.session-miss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      store.updateSession(id, { status: 'missed' });
      showToast({ title: t('dashboard.sessionMissed'), message: t('dashboard.sessionMissedMsg'), type: 'warning' });
      renderDashboard(container);
    });
  });
}
