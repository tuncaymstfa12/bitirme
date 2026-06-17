/**
 * Analytics View
 * Topic mastery radar chart, performance trends, weakness analysis
 */

import { store } from '../data/store.js';
import { t } from '../data/i18n.js';
import { getBookletTopicStats } from '../api/dataApi.js';
import { calculateTopicMastery, getConsistencyData } from '../engine/performanceAnalyzer.js';
import { analyzeTopicsFromQuestions, identifyWeakTopics, identifyStrongTopics, identifyUntestedTopics } from '../engine/topicAnalyzer.js';
import { rankTopics, getPriorityLabel, getPriorityClass } from '../engine/priorityCalculator.js';
import { drawRadarChart, drawLineChart, renderStars } from './components.js';

const analyticsState = {
  selectedLesson: '',
  bookletTopicStats: [],
  bookletTopicStatsLoading: false,
  bookletTopicStatsError: '',
  requestId: 0,
};

export function renderAnalytics(container, options = {}) {
  const preserveSelection = Boolean(options.preserveSelection);
  const skipStatsReload = Boolean(options.skipStatsReload);
  if (!preserveSelection) {
    analyticsState.selectedLesson = '';
  }
  if (!preserveSelection && !skipStatsReload) {
    loadBookletTopicStats(container);
  }

  const exams = store.getExams();
  const topics = store.getTopics();
  const mockResults = store.getMockResults();
  const sessions = store.getSessions();
  const settings = store.getSettings();

  const questions = store.getQuestions();
  const questionAnswers = store.getQuestionAnswers();
  const bookletStatMaps = buildBookletTopicStatMaps(analyticsState.bookletTopicStats);
  const radarTopicRecords = buildRadarTopicRecords(topics, analyticsState.bookletTopicStats, bookletStatMaps);
  const lessonOptions = getRadarLessonOptions(radarTopicRecords);
  if (analyticsState.selectedLesson && !lessonOptions.includes(analyticsState.selectedLesson)) {
    analyticsState.selectedLesson = '';
  }
  const radarSelection = getRadarSelection(radarTopicRecords, mockResults, analyticsState.selectedLesson);
  const radarData = radarSelection.data;
  const consistencyData = getConsistencyData(sessions);
  const ranked = rankTopics(exams, topics, mockResults, settings.weights);
  const questionAnalysis = questions.length > 0
    ? analyzeTopicsFromQuestions(questions, questionAnswers)
    : [];
  const focusItems = buildFocusTopicItems(ranked, radarTopicRecords, mockResults);
  const weakTopics = identifyWeakTopics(questionAnalysis);
  const strongTopics = identifyStrongTopics(questionAnalysis);
  const untestedTopics = identifyUntestedTopics(questionAnalysis);
  const radarInfoMessage = analyticsState.bookletTopicStatsLoading
    ? t('analytics.hybridLoading')
    : analyticsState.bookletTopicStatsError
      ? t('analytics.hybridFallback')
      : t('analytics.hybridReady');
  const hasAnalyticsData = topics.length > 0 || analyticsState.bookletTopicStats.length > 0;

  container.innerHTML = `
    <div class="page-header">
      <h2>📈 ${t('analytics.title')}</h2>
      <p>${t('analytics.subtitle')}</p>
    </div>

    ${!hasAnalyticsData ? `
      <div class="card"><div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>${t('analytics.noData')}</h3>
        <p>${t('analytics.noDataDesc')}</p>
      </div></div>
    ` : `
      <div class="grid-2">
        <!-- Radar Chart -->
        <div class="card animate-fade-in-up" style="animation-delay: 0.1s">
          <div class="card-header"><h3 class="card-title">🎯 ${t('analytics.masteryRadar')}</h3></div>
          <div style="padding:0 var(--space-md) var(--space-sm);display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm);flex-wrap:wrap;">
            <div>
              <div style="font-size:var(--font-xs);color:var(--text-tertiary);">${analyticsState.selectedLesson || t('analytics.radarModeGeneral')}</div>
              <div style="font-size:var(--font-xs);color:var(--text-tertiary);margin-top:4px;">${radarInfoMessage}</div>
            </div>
            <div style="display:flex;gap:var(--space-xs);flex-wrap:wrap;">
              <select class="form-select" id="radar-lesson-select" style="min-width:180px;">
                <option value="">${t('analytics.radarModeGeneral')}</option>
                ${lessonOptions.map(lesson => '<option value="' + lesson + '"' + (lesson === analyticsState.selectedLesson ? ' selected' : '') + '>' + lesson + '</option>').join('')}
              </select>
            </div>
          </div>
          ${radarData.length >= 3 ? `
            <div class="chart-container"><canvas id="mastery-radar" width="400" height="400"></canvas></div>
          ` : `
            <div class="empty-state"><p>${radarSelection.emptyMessage}</p></div>
          `}
          <div style="padding:0 var(--space-md) var(--space-md);">
            ${renderRadarExplanation(radarSelection, analyticsState.selectedLesson)}
          </div>
        </div>

        <!-- Focus Topics -->
        <div class="card animate-fade-in-up" style="animation-delay: 0.2s">
          <div class="card-header"><h3 class="card-title">⚠️ ${t('analytics.focusTopics')}</h3></div>
          <div style="padding:0 var(--space-md) var(--space-md);">
            ${renderFocusTopicsCard(focusItems)}
          </div>
        </div>
      </div>

      ${questionAnalysis.length > 0 ? `
      <div class="section animate-fade-in-up" style="margin-top:var(--space-xl); animation-delay: 0.22s">
        <div class="card">
          <div class="card-header"><h3 class="card-title">📝 Soru Bazlı Konu Analizi</h3></div>
          <div style="overflow-x:auto;"><table class="data-table" style="width:100%;">
            <thead><tr>
              <th>Konu</th><th>Ders</th><th>Doğru</th><th>Yanlış</th><th>Toplam</th><th>Skor</th><th>Durum</th>
            </tr></thead>
            <tbody>
              ${[...weakTopics, ...untestedTopics, ...strongTopics].map(a => `
                <tr>
                  <td><strong>${a.topicName}</strong></td>
                  <td>${a.lesson}</td>
                  <td>${a.correct}</td>
                  <td>${a.wrong}</td>
                  <td>${a.totalQuestions}</td>
                  <td>
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span style="min-width:36px;font-size:var(--font-sm);">${a.answeredQuestions ? (a.adjustedScore*100).toFixed(0) + '%' : '—'}</span>
                      ${a.answeredQuestions > 0 ? `
                        <div class="progress-bar" style="width:80px; height:6px;">
                          <div class="progress-fill" style="width:${(a.adjustedScore*100)}%; background:${
                            a.status === 'strong' ? 'var(--color-success)' :
                            a.status === 'weak' ? 'var(--color-warning)' : 'var(--color-danger)'
                          }"></div>
                        </div>
                      ` : ''}
                    </div>
                  </td>
                  <td><span class="mastery-dot ${a.status}"></span> ${
                    a.status === 'critical' ? 'Kritik' :
                    a.status === 'weak' ? 'Zayıf' :
                    a.status === 'untested' ? 'Çözülmedi' :
                    a.status === 'strong' ? 'İyi' : 'Orta'
                  }</td>
                </tr>
              `).join('')}
              ${weakTopics.length === 0 && strongTopics.length === 0 && untestedTopics.length === 0 ? `
                <tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);">Henüz yeterli soru verisi yok.</td></tr>
              ` : ''}
            </tbody>
          </table></div>
        </div>
      </div>
      ` : ''}

      <!-- Consistency Heatmap -->
      <div class="section animate-fade-in-up" style="margin-top:var(--space-xl); animation-delay: 0.25s">
        <div class="card">
          <div class="card-header"><h3 class="card-title">🔥 ${t('analytics.consistency')}</h3></div>
          ${consistencyData.length > 0 && sessions.length > 0 ? `
            <div class="heatmap">
              ${consistencyData.map(d => `
                <div class="heatmap-cell level-${d.level}" title="${d.date}: ${d.count} oturum"></div>
              `).join('')}
            </div>
            <div style="display:flex; gap:4px; align-items:center; margin-top:var(--space-md); justify-content:flex-end; font-size:var(--font-xs); color:var(--text-secondary);">
              Az <div class="heatmap-cell level-0"></div><div class="heatmap-cell level-1"></div><div class="heatmap-cell level-2"></div><div class="heatmap-cell level-3"></div><div class="heatmap-cell level-4"></div> Çok
            </div>
          ` : `
            <div class="empty-state"><p>${t('analytics.noHeatmapData')}</p></div>
          `}
        </div>
      </div>

      <!-- Performance Trend Chart -->
      ${mockResults.length > 0 ? `
        <div class="section animate-fade-in-up" style="margin-top:var(--space-xl); animation-delay: 0.3s">
          <div class="card">
            <div class="card-header"><h3 class="card-title">📊 ${t('analytics.performanceTrends')}</h3></div>
            <div class="chart-container"><canvas id="trend-chart" width="800" height="300"></canvas></div>
          </div>
        </div>
      ` : ''}

      <!-- Priority Score Breakdown -->
      <div class="section animate-fade-in-up" style="margin-top:var(--space-xl); animation-delay: 0.4s">
        <h3 class="section-title">🔬 ${t('analytics.priorityBreakdown')}</h3>
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
            <div class="breakdown-item"><div class="breakdown-label">${t('analytics.urgency')}</div><div class="breakdown-value">${(r.breakdown.urgency*100).toFixed(0)}%</div></div>
            <div class="breakdown-item"><div class="breakdown-label">${t('analytics.weight')}</div><div class="breakdown-value">${(r.breakdown.topicWeight*100).toFixed(0)}%</div></div>
            <div class="breakdown-item"><div class="breakdown-label">${t('analytics.weakness')}</div><div class="breakdown-value">${(r.breakdown.weakness*100).toFixed(0)}%</div></div>
            <div class="breakdown-item"><div class="breakdown-label">${t('analytics.perfGap')}</div><div class="breakdown-value">${(r.breakdown.performanceGap*100).toFixed(0)}%</div></div>
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

  const radarLessonSelect = container.querySelector('#radar-lesson-select');
  if (radarLessonSelect) {
    radarLessonSelect.addEventListener('change', function() {
      if (analyticsState.selectedLesson !== this.value) {
        analyticsState.selectedLesson = this.value;
        renderAnalytics(container, { preserveSelection: true });
      }
    });
  }

  if (mockResults.length > 0) {
    const trendCanvas = document.getElementById('trend-chart');
    if (trendCanvas) drawTrendChart(trendCanvas, topics, mockResults, exams);
  }
}

async function loadBookletTopicStats(container) {
  analyticsState.bookletTopicStatsLoading = true;
  analyticsState.bookletTopicStatsError = '';
  const requestId = ++analyticsState.requestId;

  try {
    const rows = await getBookletTopicStats();
    if (requestId !== analyticsState.requestId) return;
    analyticsState.bookletTopicStats = Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (requestId !== analyticsState.requestId) return;
    analyticsState.bookletTopicStats = [];
    analyticsState.bookletTopicStatsError = error.message || t('analytics.hybridFallback');
  } finally {
    if (requestId !== analyticsState.requestId) return;
    analyticsState.bookletTopicStatsLoading = false;
    renderAnalytics(container, { preserveSelection: true, skipStatsReload: true });
  }
}

function getRadarSelection(radarTopicRecords, mockResults, selectedLesson) {
  if (selectedLesson) {
    const topicData = radarTopicRecords
      .filter(record => record.lesson === selectedLesson)
      .map(record => buildRadarPointFromRecord(record, mockResults))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
    return {
      data: topicData,
      details: topicData,
      emptyMessage: t('analytics.needMoreLessonTopics'),
    };
  }

  const lessonData = getRadarLessonData(radarTopicRecords, mockResults);
  return {
    data: lessonData,
    details: lessonData,
    emptyMessage: t('analytics.needMoreLessons'),
  };
}

function getRadarLessonOptions(radarTopicRecords) {
  return uniqueSorted(radarTopicRecords.map(record => record.lesson));
}

function getRadarLessonData(radarTopicRecords, mockResults) {
  const lessonMap = new Map();
  radarTopicRecords.forEach(record => {
    const point = buildRadarPointFromRecord(record, mockResults);
    const mastery = point.value !== null ? point.value : null;
    const lessonName = record.lesson;
    const entry = lessonMap.get(lessonName) || {
      label: lessonName,
      sum: 0,
      totalCount: 0,
      testedCount: 0,
      mockSum: 0,
      mockCount: 0,
      quizSum: 0,
      quizCount: 0,
    };
    entry.totalCount += 1;
    if (mastery !== null) {
      entry.sum += mastery;
      entry.testedCount += 1;
    }
    if (point.mockValue !== null) {
      entry.mockSum += point.mockValue;
      entry.mockCount += 1;
    }
    if (point.quizValue !== null) {
      entry.quizSum += point.quizValue;
      entry.quizCount += 1;
    }
    lessonMap.set(lessonName, entry);
  });

  return Array.from(lessonMap.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    .map(entry => {
      const value = roundScore(entry.sum / Math.max(entry.totalCount, 1));
      const mockValue = entry.mockCount > 0 ? roundScore(entry.mockSum / entry.mockCount) : null;
      const quizValue = entry.quizCount > 0 ? roundScore(entry.quizSum / entry.quizCount) : null;
      const breakdown = calculateHybridBreakdown(mockValue, quizValue);
      return {
        label: entry.label,
        value: breakdown.value !== null ? breakdown.value : 0,
        overallValue: breakdown.value,
        mockValue,
        quizValue,
        sourceType: breakdown.sourceType,
        status: breakdown.status,
        topicCount: entry.totalCount,
      };
    });
}

function buildRadarPointFromRecord(record, mockResults) {
  const mockValue = calculateRecordMockMastery(record, mockResults);
  const quizValue = calculateQuizTopicMastery(record.quizStat);
  const breakdown = calculateHybridBreakdown(mockValue, quizValue);
  return {
    label: record.label,
    value: breakdown.value !== null ? breakdown.value : 0,
    overallValue: breakdown.value,
    mockValue,
    quizValue,
    sourceType: breakdown.sourceType,
    status: breakdown.status,
    topicCount: Math.max(record.topicIds.length, record.quizStat ? 1 : 0),
    answeredCount: Number(record.quizStat?.answeredCount || 0),
  };
}

function calculateHybridRecordMastery(record, mockResults) {
  const mockMastery = calculateRecordMockMastery(record, mockResults);
  const quizMastery = calculateQuizTopicMastery(record.quizStat);

  if (mockMastery !== null && quizMastery !== null) {
    return roundScore((mockMastery * 0.45) + (quizMastery * 0.55));
  }
  if (quizMastery !== null) return quizMastery;
  if (mockMastery !== null) return mockMastery;
  return null;
}

function calculateRecordMockMastery(record, mockResults) {
  const masteries = record.topicIds
    .map(topicId => calculateTopicMastery(topicId, mockResults))
    .filter(mastery => mastery !== null);

  if (masteries.length === 0) return null;
  const sum = masteries.reduce((total, mastery) => total + mastery, 0);
  return roundScore(sum / masteries.length);
}

function calculateHybridBreakdown(mockValue, quizValue) {
  if (mockValue !== null && quizValue !== null) {
    const value = roundScore((mockValue * 0.45) + (quizValue * 0.55));
    return { value, sourceType: 'hybrid', status: getRadarStatus(value) };
  }
  if (quizValue !== null) {
    return { value: quizValue, sourceType: 'quiz', status: getRadarStatus(quizValue) };
  }
  if (mockValue !== null) {
    return { value: mockValue, sourceType: 'mock', status: getRadarStatus(mockValue) };
  }
  return { value: null, sourceType: 'none', status: 'untested' };
}

function calculateQuizTopicMastery(stat) {
  if (!stat) return null;

  const answeredCount = Number(stat.answeredCount || 0);
  const totalCount = Number(stat.totalCount || 0);
  if (answeredCount <= 0 || totalCount <= 0) return null;

  const successRate = clampScore((Number(stat.successRate || 0) / 100));
  const evidenceWeight = Math.min(answeredCount / 8, 1);
  const coverage = clampScore(answeredCount / totalCount);
  const stabilizedSuccess = (0.5 * (1 - evidenceWeight)) + (successRate * evidenceWeight);

  return roundScore((stabilizedSuccess * 0.85) + (coverage * 0.15));
}

function buildBookletTopicStatMaps(rows) {
  const exact = new Map();
  const fallback = new Map();

  rows.forEach(row => {
    const mergedRow = normalizeMergedBookletStat(row);
    const exactKey = buildExactStatKey(row.examType, row.lesson, row.topicName);
    const fallbackKey = buildFallbackStatKey(row.lesson, row.topicName);

    exact.set(exactKey, mergeBookletStats(exact.get(exactKey), mergedRow));
    fallback.set(fallbackKey, mergeBookletStats(fallback.get(fallbackKey), mergedRow));
  });

  return { exact, fallback };
}

function buildRadarTopicRecords(topics, bookletRows, bookletStatMaps) {
  const records = new Map();

  topics.forEach(topic => {
    const lesson = String(topic.lesson || '').trim() || t('analytics.unknownLesson');
    const label = String(topic.name || '').trim();
    if (!label) return;

    const key = buildFallbackStatKey(lesson, label);
    const entry = records.get(key) || {
      key,
      label,
      lesson,
      topicIds: [],
      quizStat: bookletStatMaps.fallback.get(key) || null,
    };
    entry.topicIds.push(topic.id);
    if (!entry.quizStat) {
      entry.quizStat = bookletStatMaps.fallback.get(key) || null;
    }
    records.set(key, entry);
  });

  bookletRows.forEach(row => {
    const lesson = String(row.lesson || '').trim() || t('analytics.unknownLesson');
    const label = String(row.topicName || '').trim();
    if (!label) return;

    const key = buildFallbackStatKey(lesson, label);
    const entry = records.get(key) || {
      key,
      label,
      lesson,
      topicIds: [],
      quizStat: bookletStatMaps.fallback.get(key) || null,
    };
    if (!entry.quizStat) {
      entry.quizStat = bookletStatMaps.fallback.get(key) || null;
    }
    records.set(key, entry);
  });

  return Array.from(records.values())
    .sort((left, right) => {
      const lessonCompare = left.lesson.localeCompare(right.lesson, 'tr');
      if (lessonCompare !== 0) return lessonCompare;
      return left.label.localeCompare(right.label, 'tr');
    });
}

function mergeBookletStats(base, row) {
  const current = base || {
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    totalCount: 0,
  };

  const answeredCount = current.answeredCount + Number(row.answeredCount || 0);
  const correctCount = current.correctCount + Number(row.correctCount || 0);
  const wrongCount = current.wrongCount + Number(row.wrongCount || 0);
  const totalCount = current.totalCount + Number(row.totalCount || 0);

  return {
    answeredCount,
    correctCount,
    wrongCount,
    totalCount,
    successRate: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null,
  };
}

function normalizeMergedBookletStat(row) {
  return {
    answeredCount: Number(row?.answeredCount || 0),
    correctCount: Number(row?.correctCount || 0),
    wrongCount: Number(row?.wrongCount || 0),
    totalCount: Number(row?.totalCount || 0),
    successRate: typeof row?.successRate === 'number' ? row.successRate : Number(row?.successRate || 0),
  };
}

function buildExactStatKey(examType, lesson, topicName) {
  return [
    normalizeKeyPart(examType),
    normalizeKeyPart(lesson),
    normalizeKeyPart(topicName),
  ].join('|');
}

function buildFallbackStatKey(lesson, topicName) {
  return [
    normalizeKeyPart(lesson),
    normalizeKeyPart(topicName),
  ].join('|');
}

function normalizeKeyPart(value) {
  return String(value || '').trim().toLocaleLowerCase('tr');
}

function clampScore(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function roundScore(value) {
  return Math.round(clampScore(value) * 1000) / 1000;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), 'tr'));
}

function getRadarStatus(value) {
  if (value === null) return 'untested';
  if (value < 0.3) return 'critical';
  if (value < 0.5) return 'weak';
  if (value < 0.7) return 'moderate';
  return 'strong';
}

function renderRadarExplanation(radarSelection, selectedLesson) {
  return [
    '<div style="border-top:1px solid var(--border-color);padding-top:var(--space-md);display:grid;gap:var(--space-md);">',
    renderRadarLegend(),
    renderRadarBreakdown(radarSelection.details || [], selectedLesson),
    '</div>',
  ].join('');
}

function buildFocusTopicItems(ranked, radarTopicRecords, mockResults) {
  const recordMap = new Map(radarTopicRecords.map(record => [buildFallbackStatKey(record.lesson, record.label), record]));
  const seen = new Set();

  return ranked
    .filter(item => {
      const key = buildFallbackStatKey(item.topic.lesson, item.topic.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map(item => {
      const lesson = String(item.topic.lesson || '').trim() || t('analytics.unknownLesson');
      const key = buildFallbackStatKey(lesson, item.topic.name);
      const record = recordMap.get(key) || {
        key,
        label: item.topic.name,
        lesson,
        topicIds: [item.topic.id],
        quizStat: null,
      };
      const point = buildRadarPointFromRecord(record, mockResults);
      const daysUntilExam = getDaysUntilDate(item.exam.date);
      return {
        topicName: item.topic.name,
        lesson,
        examName: item.exam.name,
        priorityScore: item.score,
        status: point.status,
        overallValue: point.overallValue,
        quizValue: point.quizValue,
        mockValue: point.mockValue,
        action: getFocusAction(daysUntilExam, point),
        reasonText: buildFocusReasonText(daysUntilExam, point),
      };
    });
}

function renderFocusTopicsCard(items) {
  if (!items.length) {
    return '<div class="empty-state"><p>' + t('analytics.focusTopicsEmpty') + '</p></div>';
  }

  return items.map(item => [
    '<div style="border:1px solid var(--border-color);border-radius:8px;padding:var(--space-md);margin-bottom:var(--space-sm);">',
    '<div style="display:flex;justify-content:space-between;gap:var(--space-md);align-items:flex-start;flex-wrap:wrap;">',
    '<div>',
    '<div style="font-weight:700;">' + escapeHtml(item.topicName) + '</div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);margin-top:4px;">' + escapeHtml(item.lesson) + ' • ' + escapeHtml(item.examName) + '</div>',
    '</div>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">',
    '<span class="tag">' + t('analytics.radarSource.' + getFocusSourceType(item)) + '</span>',
    '<span class="tag" style="font-weight:700;">' + t('analytics.focusAction.' + item.action) + '</span>',
    '</div>',
    '</div>',
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-sm);margin-top:var(--space-md);">',
    renderFocusMetric(t('analytics.radarOverallCol'), item.overallValue, item.status),
    renderFocusMetric(t('analytics.radarQuizCol'), item.quizValue, item.status),
    renderFocusMetric(t('analytics.radarMockCol'), item.mockValue, item.status),
    '</div>',
    '<div style="margin-top:var(--space-md);font-size:var(--font-sm);color:var(--text-secondary);">' + escapeHtml(item.reasonText) + '</div>',
    '</div>',
  ].join('')).join('');
}

function renderFocusMetric(label, value, status) {
  return [
    '<div style="padding:10px;border:1px solid var(--border-subtle);border-radius:8px;">',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);margin-bottom:4px;">' + escapeHtml(label) + '</div>',
    '<div style="display:flex;align-items:center;gap:6px;font-weight:700;">',
    '<span class="mastery-dot ' + status + '"></span>',
    '<span>' + formatRadarScore(value) + '</span>',
    '</div>',
    '</div>',
  ].join('');
}

function buildFocusReasonText(daysUntilExam, point) {
  const reasons = [];
  if (daysUntilExam === 0) {
    reasons.push(t('analytics.focusReason.today'));
  } else if (daysUntilExam === 1) {
    reasons.push(t('analytics.focusReason.tomorrow'));
  } else if (daysUntilExam > 1 && daysUntilExam <= 3) {
    reasons.push(t('analytics.focusReason.soon', { days: String(daysUntilExam) }));
  }

  if (point.quizValue !== null && point.quizValue < 0.5) {
    reasons.push(t('analytics.focusReason.quizLow', { score: String(Math.round(point.quizValue * 100)) }));
  }
  if (point.mockValue !== null && point.mockValue < 0.55) {
    reasons.push(t('analytics.focusReason.mockLow', { score: String(Math.round(point.mockValue * 100)) }));
  }
  if (point.quizValue === null && point.mockValue === null) {
    reasons.push(t('analytics.focusReason.noData'));
  }

  return reasons.length > 0 ? reasons.join(' • ') : t('analytics.focusReason.priority');
}

function getFocusAction(daysUntilExam, point) {
  if (daysUntilExam >= 0 && daysUntilExam <= 1) return 'review';
  if (point.quizValue !== null && point.quizValue < 0.5) return 'practice';
  if (point.mockValue !== null && point.mockValue < 0.55) return 'mock';
  if (point.overallValue === null) return 'start';
  return 'review';
}

function getFocusSourceType(item) {
  if (item.quizValue !== null && item.mockValue !== null) return 'hybrid';
  if (item.quizValue !== null) return 'quiz';
  if (item.mockValue !== null) return 'mock';
  return 'none';
}

function renderRadarLegend() {
  return [
    '<div>',
    '<div style="font-weight:700;font-size:var(--font-sm);margin-bottom:var(--space-xs);">' + t('analytics.radarLegendTitle') + '</div>',
    '<div style="display:flex;flex-wrap:wrap;gap:var(--space-xs);margin-bottom:var(--space-xs);">',
    renderRadarLegendChip('critical', t('analytics.radarStatusCritical') + ' < %30'),
    renderRadarLegendChip('weak', t('analytics.radarStatusWeak') + ' %30-%49'),
    renderRadarLegendChip('moderate', t('analytics.radarStatusModerate') + ' %50-%69'),
    renderRadarLegendChip('strong', t('analytics.radarStatusStrong') + ' %70+'),
    '</div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);">' + t('analytics.radarScoreFormula') + '</div>',
    '</div>',
  ].join('');
}

function renderRadarLegendChip(status, label) {
  return '<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border-color);border-radius:999px;font-size:var(--font-xs);"><span class="mastery-dot ' + status + '"></span><span>' + label + '</span></div>';
}

function renderRadarBreakdown(details, selectedLesson) {
  if (!details.length) {
    return '<div style="font-size:var(--font-xs);color:var(--text-tertiary);">' + t('analytics.radarBreakdownEmpty') + '</div>';
  }

  const labelTitle = selectedLesson ? t('analytics.topic') : t('analytics.radarLessonCol');
  const sorted = [...details].sort((left, right) => {
    const leftValue = left.overallValue === null ? -1 : left.overallValue;
    const rightValue = right.overallValue === null ? -1 : right.overallValue;
    return rightValue - leftValue;
  });

  return [
    '<div>',
    '<div style="font-weight:700;font-size:var(--font-sm);margin-bottom:var(--space-xs);">' + t('analytics.radarBreakdownTitle') + '</div>',
    '<div style="overflow-x:auto;">',
    '<table class="data-table" style="width:100%;">',
    '<thead><tr><th>' + labelTitle + '</th><th>' + t('analytics.radarOverallCol') + '</th><th>' + t('analytics.radarQuizCol') + '</th><th>' + t('analytics.radarMockCol') + '</th><th>' + t('analytics.radarSourceCol') + '</th><th>' + t('analytics.status') + '</th></tr></thead>',
    '<tbody>',
    sorted.map(item => renderRadarBreakdownRow(item)).join(''),
    '</tbody>',
    '</table>',
    '</div>',
    '</div>',
  ].join('');
}

function renderRadarBreakdownRow(item) {
  return [
    '<tr>',
    '<td><strong>' + escapeHtml(item.label) + '</strong></td>',
    '<td>' + formatRadarScore(item.overallValue) + '</td>',
    '<td>' + formatRadarScore(item.quizValue) + '</td>',
    '<td>' + formatRadarScore(item.mockValue) + '</td>',
    '<td>' + t('analytics.radarSource.' + item.sourceType) + '</td>',
    '<td><span class="mastery-dot ' + item.status + '"></span> ' + t('analytics.radarStatus.' + item.status) + '</td>',
    '</tr>',
  ].join('');
}

function formatRadarScore(value) {
  return value === null ? '—' : '%' + Math.round(value * 100);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getDaysUntilDate(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
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
