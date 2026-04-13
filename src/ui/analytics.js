/**
 * Analytics View
 * Topic mastery radar chart, performance trends, weakness analysis
 */

import { store } from '../data/store.js';
import { identifyWeakAreas, getMasteryRadarData, generateInsights, calculateTopicMastery, detectTrend } from '../engine/performanceAnalyzer.js';
import { rankTopics, getPriorityLabel, getPriorityClass } from '../engine/priorityCalculator.js';
import { drawRadarChart, drawLineChart, renderStars } from './components.js';

export function renderAnalytics(container) {
  const exams = store.getExams();
  const topics = store.getTopics();
  const mockResults = store.getMockResults();
  const sessions = store.getSessions();
  const settings = store.getSettings();

  const weakAreas = identifyWeakAreas(topics, mockResults);
  const radarData = getMasteryRadarData(topics, mockResults);
  const ranked = rankTopics(exams, topics, mockResults, settings.weights);

  container.innerHTML = `
    <div class="page-header">
      <h2>📈 Performance Analytics</h2>
      <p>Topic mastery, trends, and weakness analysis</p>
    </div>

    ${topics.length === 0 ? `
      <div class="card"><div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>No Data Yet</h3>
        <p>Add exams, topics, and mock test results to see analytics.</p>
      </div></div>
    ` : `
      <div class="grid-2">
        <!-- Radar Chart -->
        <div class="card">
          <div class="card-header"><h3 class="card-title">🎯 Topic Mastery Radar</h3></div>
          ${radarData.length >= 3 ? `
            <div class="chart-container"><canvas id="mastery-radar" width="400" height="400"></canvas></div>
          ` : `
            <div class="empty-state"><p>Need at least 3 topics with mock results for radar chart.</p></div>
          `}
        </div>

        <!-- Weakness Table -->
        <div class="card">
          <div class="card-header"><h3 class="card-title">⚠️ Weakness Analysis</h3></div>
          <table class="data-table">
            <thead><tr>
              <th>Status</th><th>Topic</th><th>Mastery</th><th>Trend</th><th>Tests</th>
            </tr></thead>
            <tbody>
              ${weakAreas.map(w => `
                <tr>
                  <td><span class="mastery-dot ${w.status}"></span></td>
                  <td><strong>${w.topic.name}</strong><br><span style="font-size:var(--font-xs);color:var(--text-tertiary);">${renderStars(w.topic.selfAssessment)}</span></td>
                  <td>${w.mastery !== null ? `${(w.mastery*100).toFixed(0)}%` : '—'}</td>
                  <td>${w.trend > 0.6 ? '📈' : w.trend < 0.4 ? '📉' : '➡️'}</td>
                  <td>${w.testCount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Performance Trend Chart -->
      ${mockResults.length > 0 ? `
        <div class="section" style="margin-top:var(--space-xl);">
          <div class="card">
            <div class="card-header"><h3 class="card-title">📊 Performance Trends</h3></div>
            <div class="chart-container"><canvas id="trend-chart" width="800" height="300"></canvas></div>
          </div>
        </div>
      ` : ''}

      <!-- Priority Score Breakdown -->
      <div class="section" style="margin-top:var(--space-xl);">
        <h3 class="section-title">🔬 Priority Score Breakdown</h3>
        ${ranked.slice(0, 10).map(r => `
          <div class="priority-bar">
            <span class="exam-color" style="background:${r.exam.color}"></span>
            <div class="topic-info">
              <div class="topic-name">${r.topic.name}</div>
              <div class="exam-name">${r.exam.name}</div>
            </div>
            <div class="score-bar">
              <div class="score-fill ${getPriorityClass(r.score)}" style="width:${r.score*100}%"></div>
            </div>
            <span class="priority-badge ${getPriorityClass(r.score)}">${getPriorityLabel(r.score)}</span>
            <div class="score-value">${(r.score*100).toFixed(0)}%</div>
          </div>
          <div class="score-breakdown" style="margin-bottom:var(--space-md);padding:0 var(--space-md);">
            <div class="breakdown-item"><div class="breakdown-label">Urgency</div><div class="breakdown-value">${(r.breakdown.urgency*100).toFixed(0)}%</div></div>
            <div class="breakdown-item"><div class="breakdown-label">Weight</div><div class="breakdown-value">${(r.breakdown.topicWeight*100).toFixed(0)}%</div></div>
            <div class="breakdown-item"><div class="breakdown-label">Weakness</div><div class="breakdown-value">${(r.breakdown.weakness*100).toFixed(0)}%</div></div>
            <div class="breakdown-item"><div class="breakdown-label">Perf Gap</div><div class="breakdown-value">${(r.breakdown.performanceGap*100).toFixed(0)}%</div></div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  // Draw charts
  if (radarData.length >= 3) {
    const radarCanvas = document.getElementById('mastery-radar');
    if (radarCanvas) drawRadarChart(radarCanvas, radarData);
  }

  if (mockResults.length > 0) {
    const trendCanvas = document.getElementById('trend-chart');
    if (trendCanvas) drawTrendChart(trendCanvas, topics, mockResults, exams);
  }
}

function drawTrendChart(canvas, topics, mockResults, exams) {
  // Group results by topic, create line datasets
  const topicsWithResults = topics.filter(t => mockResults.some(r => r.topicId === t.id));
  const allDates = [...new Set(mockResults.map(r => r.date))].sort();
  const colors = ['#6366f1','#8b5cf6','#ec4899','#22c55e','#f59e0b','#06b6d4','#f43f5e','#a855f7'];

  const datasets = topicsWithResults.slice(0, 6).map((topic, i) => {
    const results = mockResults.filter(r => r.topicId === topic.id).sort((a,b) => a.date.localeCompare(b.date));
    const values = allDates.map(date => {
      const r = results.find(x => x.date === date);
      return r ? Math.round((r.score / r.maxScore) * 100) : null;
    });
    // Fill nulls with previous value
    for (let j = 1; j < values.length; j++) {
      if (values[j] === null) values[j] = values[j-1];
    }
    for (let j = values.length - 2; j >= 0; j--) {
      if (values[j] === null) values[j] = values[j+1] || 0;
    }
    return { label: topic.name, values: values.map(v => v || 0), color: colors[i % colors.length] };
  });

  const labels = allDates.map(d => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; });
  drawLineChart(canvas, datasets, labels, { maxValue: 100 });
}
