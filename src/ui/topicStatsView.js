import { getBookletTopicStats } from '../api/dataApi.js';
import { showToast } from './components.js';

const EXAM_TYPES = ['Tümü', 'TYT', 'AYT', 'YDT'];

export function renderTopicStatsView(container) {
  const state = {
    examType: 'Tümü',
    lesson: 'Tümü',
    topicName: 'Tümü',
    rows: [],
    loading: false,
    error: '',
  };

  const draw = () => {
    const filterOptions = buildFilterOptions(state.rows, state);
    const rows = filterRows(state.rows, state);
    const totals = buildTotals(rows);
    container.innerHTML = [
      '<div class="page-header"><h2>Konu İstatistikleri</h2><p>Quiz cevaplarından konu konu doğru, yanlış ve başarı oranlarını takip edin.</p></div>',
      '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-md);align-items:end;margin-bottom:var(--space-md);">',
      renderExamTypeField(state.examType),
      renderSelectField('Ders', 'topic-stats-lesson', state.lesson, filterOptions.lessons),
      renderSelectField('Konu', 'topic-stats-topic', state.topicName, filterOptions.topics),
      '<button class="btn btn-secondary" type="button" id="topic-stats-clear">Temizle</button>',
      '</div>',
      '<div class="stats-grid">',
      statCard('Cevaplanan', totals.answered),
      statCard('Doğru', totals.correct),
      statCard('Yanlış', totals.wrong),
      statCard('Başarı', totals.answered ? '%' + Math.round((totals.correct / totals.answered) * 100) : '-'),
      '</div>',
      '</div>',
      state.loading ? '<div class="card" style="padding:var(--space-xl);text-align:center;">İstatistikler yükleniyor...</div>' : '',
      !state.loading && state.error ? renderError(state.error) : '',
      !state.loading && !state.error ? renderStatsTable(rows) : '',
    ].join('');

    bindEvents();
  };

  const bindEvents = () => {
    container.querySelector('#topic-stats-exam-type')?.addEventListener('change', event => {
      state.examType = event.target.value;
      state.lesson = 'Tümü';
      state.topicName = 'Tümü';
      draw();
    });

    container.querySelector('#topic-stats-lesson')?.addEventListener('change', event => {
      state.lesson = event.target.value;
      state.topicName = 'Tümü';
      draw();
    });

    container.querySelector('#topic-stats-topic')?.addEventListener('change', event => {
      state.topicName = event.target.value;
      draw();
    });

    container.querySelector('#topic-stats-clear')?.addEventListener('click', () => {
      state.examType = 'Tümü';
      state.lesson = 'Tümü';
      state.topicName = 'Tümü';
      draw();
    });

    container.querySelector('#topic-stats-refresh')?.addEventListener('click', async () => {
      await loadStats();
    });
  };

  const loadStats = async () => {
    state.loading = true;
    state.error = '';
    draw();

    try {
      state.rows = await getBookletTopicStats();
    } catch (error) {
      state.rows = [];
      state.error = error.message;
      showToast({ title: 'İstatistikler alınamadı', message: error.message, type: 'error' });
    } finally {
      state.loading = false;
      draw();
    }
  };

  loadStats();
  draw();
}

function renderExamTypeField(selectedExamType) {
  return renderSelectField('Sınav Türü', 'topic-stats-exam-type', selectedExamType, EXAM_TYPES);
}

function renderSelectField(label, id, selectedValue, options) {
  return [
    '<div class="form-group" style="margin-bottom:0;">',
    '<label class="form-label">' + escapeHtml(label) + '</label>',
    '<select class="form-select" id="' + escapeHtml(id) + '">',
    options.map(option => '<option value="' + escapeHtml(option) + '"' + (option === selectedValue ? ' selected' : '') + '>' + escapeHtml(option) + '</option>').join(''),
    '</select>',
    '</div>',
  ].join('');
}

function renderStatsTable(rows) {
  if (!rows.length) {
    return [
      '<div class="card" style="padding:var(--space-xl);text-align:center;">',
      '<div style="font-weight:700;font-size:var(--font-lg);margin-bottom:var(--space-xs);">Henüz konu istatistiği yok</div>',
      '<div style="color:var(--text-tertiary);margin-bottom:var(--space-md);">Admin Import ile soruları tagleyin, sonra quiz çözerek istatistik oluşturun.</div>',
      '<button class="btn btn-secondary" id="topic-stats-refresh">Yenile</button>',
      '</div>',
    ].join('');
  }

  const sorted = [...rows].sort((a, b) => {
    const aRate = typeof a.successRate === 'number' ? a.successRate : 101;
    const bRate = typeof b.successRate === 'number' ? b.successRate : 101;
    if (a.answeredCount === 0 && b.answeredCount > 0) return 1;
    if (b.answeredCount === 0 && a.answeredCount > 0) return -1;
    if (aRate !== bRate) return aRate - bRate;
    return String(a.lesson + a.topicName).localeCompare(String(b.lesson + b.topicName), 'tr');
  });

  return [
    '<div class="card" style="padding:var(--space-md);">',
    '<div style="display:flex;justify-content:space-between;gap:var(--space-md);align-items:center;margin-bottom:var(--space-md);">',
    '<div style="font-weight:700;">Konu Performansı</div>',
    '<button class="btn btn-secondary btn-sm" id="topic-stats-refresh">Yenile</button>',
    '</div>',
    '<div style="overflow-x:auto;">',
    '<table class="data-table" style="width:100%;">',
    '<thead><tr><th>Sınav</th><th>Ders</th><th>Konu</th><th>Toplam</th><th>Cevaplanan</th><th>Doğru</th><th>Yanlış</th><th>Başarı</th><th>Kalan</th></tr></thead>',
    '<tbody>',
    sorted.map(renderStatsRow).join(''),
    '</tbody>',
    '</table>',
    '</div>',
    '</div>',
  ].join('');
}

function renderStatsRow(row) {
  const rate = typeof row.successRate === 'number' ? row.successRate : null;
  const color = rate === null
    ? 'var(--text-tertiary)'
    : rate >= 70
      ? 'var(--color-success)'
      : rate >= 45
        ? 'var(--color-warning)'
        : 'var(--color-danger)';

  return [
    '<tr>',
    '<td>' + escapeHtml(row.examType) + '</td>',
    '<td>' + escapeHtml(row.lesson) + '</td>',
    '<td><strong>' + escapeHtml(row.topicName) + '</strong></td>',
    '<td>' + escapeHtml(row.totalCount) + '</td>',
    '<td>' + escapeHtml(row.answeredCount) + '</td>',
    '<td style="color:var(--color-success);font-weight:700;">' + escapeHtml(row.correctCount) + '</td>',
    '<td style="color:var(--color-danger);font-weight:700;">' + escapeHtml(row.wrongCount) + '</td>',
    '<td><span style="font-weight:800;color:' + color + ';">' + (rate === null ? '-' : '%' + rate) + '</span></td>',
    '<td>' + escapeHtml(row.availableCount) + '</td>',
    '</tr>',
  ].join('');
}

function renderError(message) {
  return [
    '<div class="card" style="padding:var(--space-lg);border:1px solid var(--color-danger);">',
    '<div style="font-weight:700;color:var(--color-danger);margin-bottom:var(--space-xs);">İstatistikler yüklenemedi</div>',
    '<div style="color:var(--text-secondary);margin-bottom:var(--space-md);">' + escapeHtml(message) + '</div>',
    '<button class="btn btn-secondary" id="topic-stats-refresh">Tekrar Dene</button>',
    '</div>',
  ].join('');
}

function buildFilterOptions(rows, state) {
  const examFilteredRows = rows.filter(row => state.examType === 'Tümü' || row.examType === state.examType);
  const lessonFilteredRows = examFilteredRows.filter(row => state.lesson === 'Tümü' || row.lesson === state.lesson);

  return {
    lessons: ['Tümü', ...uniqueSorted(examFilteredRows.map(row => row.lesson))],
    topics: ['Tümü', ...uniqueSorted(lessonFilteredRows.map(row => row.topicName))],
  };
}

function filterRows(rows, state) {
  return rows.filter(row => {
    if (state.examType !== 'Tümü' && row.examType !== state.examType) return false;
    if (state.lesson !== 'Tümü' && row.lesson !== state.lesson) return false;
    if (state.topicName !== 'Tümü' && row.topicName !== state.topicName) return false;
    return true;
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), 'tr'));
}

function buildTotals(rows) {
  return rows.reduce((totals, row) => ({
    answered: totals.answered + Number(row.answeredCount || 0),
    correct: totals.correct + Number(row.correctCount || 0),
    wrong: totals.wrong + Number(row.wrongCount || 0),
  }), { answered: 0, correct: 0, wrong: 0 });
}

function statCard(label, value) {
  return '<div class="stat-card"><div class="stat-value">' + escapeHtml(value) + '</div><div class="stat-label">' + escapeHtml(label) + '</div></div>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
