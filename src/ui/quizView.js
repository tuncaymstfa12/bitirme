import {
  answerQuizBookletQuestion,
  getQuizBookletBranches,
  getQuizBookletQuestions,
  getQuizBookletTopics,
  resetQuizBookletAnswers,
} from '../api/dataApi.js';
import { showToast } from './components.js';

const EXAM_TYPES = ['TYT', 'AYT', 'YDT'];
const QUIZ_MODES = [
  { key: 'branch', label: 'Branş' },
  { key: 'topic', label: 'Konu' },
];

export function renderQuizView(container) {
  const state = {
    examType: 'TYT',
    mode: 'branch',
    searchTerm: '',
    items: [],
    selectedKey: '',
    loadingItems: false,
    loadingQuestions: false,
    resettingAnswers: false,
    submitting: false,
    questions: [],
    answers: [],
    currentIndex: 0,
    showResults: false,
  };

  const draw = () => {
    const filteredItems = filterItems(state.items, state.searchTerm);
    const selectedItem = state.items.find(item => item.key === state.selectedKey) || null;
    const currentQuestion = state.questions[state.currentIndex] || null;
    const correctCount = state.answers.filter(answer => answer.isCorrect).length;
    const wrongCount = state.answers.length - correctCount;
    const quizLimit = Math.min(10, Number(selectedItem?.availableCount || 10));
    const resetButtonLabel = selectedItem
      ? 'Çözülenleri Sıfırla'
      : state.examType + ' Çözülenleri Sıfırla';

    container.innerHTML = [
      '<div class="page-header"><h2>Quiz Modu</h2><p>TYT/AYT sorularını branş veya konu bazlı çözün.</p></div>',
      '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-md);align-items:end;">',
      renderExamTypeField(state.examType),
      renderModeField(state.mode),
      renderSearchField(state.searchTerm),
      '<div style="display:grid;gap:var(--space-xs);">',
      '<button class="btn btn-primary" id="quiz-start-btn"' + ((state.loadingItems || state.loadingQuestions || state.resettingAnswers || !state.selectedKey || quizLimit < 1) ? ' disabled' : '') + '>' + quizLimit + ' Soruluk Quiz Başlat</button>',
      '<button class="btn btn-danger" id="quiz-reset-answers-btn"' + ((state.loadingItems || state.loadingQuestions || state.resettingAnswers) ? ' disabled' : '') + '>' + (state.resettingAnswers ? 'Sıfırlanıyor...' : resetButtonLabel) + '</button>',
      '</div>',
      '</div>',
      '<div style="margin-top:var(--space-md);">' + renderItemField(filteredItems, selectedItem, state) + '</div>',
      '<div style="margin-top:var(--space-sm);font-size:var(--font-sm);color:var(--text-tertiary);">' + renderSelectionHint(state, selectedItem, filteredItems.length) + '</div>',
      '</div>',
      state.loadingQuestions ? '<div class="card" style="padding:var(--space-xl);text-align:center;">Sorular hazırlanıyor...</div>' : '',
      (!state.loadingQuestions && !state.questions.length && !state.showResults) ? renderEmptyQuizState() : '',
      currentQuestion && !state.showResults ? renderActiveQuestion(currentQuestion, state, selectedItem) : '',
      state.showResults ? renderResults(state, selectedItem, correctCount, wrongCount) : '',
    ].join('');

    bindEvents();
  };

  const safeDraw = () => {
    try {
      draw();
    } catch {
      container.innerHTML = [
        '<div class="page-header"><h2>Quiz Modu</h2><p>Render hatası oluştu.</p></div>',
        '<div class="card" style="padding:var(--space-lg);border:2px solid #ff3b30;">',
        '<div style="font-weight:800;color:#ffb4ae;margin-bottom:var(--space-sm);">Quiz ekranı render edilemedi</div>',
        '<div style="color:var(--text-secondary);">Sayfayı yenileyip tekrar deneyin.</div>',
        '</div>',
      ].join('');
    }
  };

  const bindEvents = () => {
    container.querySelector('#quiz-exam-type')?.addEventListener('change', async event => {
      state.examType = event.target.value;
      resetQuizProgress();
      await loadItems();
    });

    container.querySelector('#quiz-mode')?.addEventListener('change', async event => {
      state.mode = event.target.value;
      state.searchTerm = '';
      resetQuizProgress();
      await loadItems();
    });

    container.querySelector('#quiz-search')?.addEventListener('input', event => {
      const position = event.target.selectionStart || 0;
      state.searchTerm = event.target.value;
      draw();
      const input = container.querySelector('#quiz-search');
      input?.focus();
      input?.setSelectionRange(position, position);
    });

    container.querySelectorAll('.quiz-select-item-btn').forEach(button => {
      button.addEventListener('click', event => {
        state.selectedKey = event.currentTarget.dataset.key || '';
        resetQuizProgress();
        draw();
      });
    });

    container.querySelector('#quiz-refresh-items-btn')?.addEventListener('click', async () => {
      resetQuizProgress();
      await loadItems(Boolean(selectedItem), true);
    });

    container.querySelector('#quiz-start-btn')?.addEventListener('click', async () => {
      await startQuiz();
    });

    container.querySelector('#quiz-reset-answers-btn')?.addEventListener('click', async () => {
      await resetSolvedAnswers();
    });

    container.querySelector('#quiz-reset-btn')?.addEventListener('click', async () => {
      resetQuizProgress();
      await loadItems(true);
    });

    container.querySelectorAll('.quiz-option-btn').forEach(button => {
      button.addEventListener('click', async () => {
        await submitAnswer(button.dataset.option);
      });
    });
  };

  const resetQuizProgress = () => {
    state.loadingQuestions = false;
    state.submitting = false;
    state.questions = [];
    state.answers = [];
    state.currentIndex = 0;
    state.showResults = false;
  };

  const loadItemsForExamType = async examType => {
    if (state.mode === 'branch') {
      const branches = await getQuizBookletBranches(examType);
      return branches.map(branch => ({
        key: branch.branchKey,
        title: branch.lesson,
        subtitle: examType + ' · Branş',
        availableCount: branch.availableCount,
        totalCount: branch.totalCount,
      }));
    }

    const topics = await getQuizBookletTopics(examType);
    return topics.map(topic => ({
      key: topic.topicKey,
      title: topic.topicName,
      subtitle: topic.lesson,
      lesson: topic.lesson,
      topicName: topic.topicName,
      availableCount: topic.availableCount,
      totalCount: topic.totalCount,
    }));
  };

  const loadItems = async (preserveSelection = false, allowAutoSwitch = false) => {
    state.loadingItems = true;
    if (!preserveSelection) {
      state.items = [];
      state.selectedKey = '';
    }
    safeDraw();

    try {
      let targetExamType = state.examType;
      let items = await loadItemsForExamType(targetExamType);

      if (allowAutoSwitch && !items.length) {
        for (const examType of EXAM_TYPES) {
          if (examType === targetExamType) continue;
          const fallbackItems = await loadItemsForExamType(examType);
          if (fallbackItems.length) {
            targetExamType = examType;
            items = fallbackItems;
            break;
          }
        }
      }

      state.examType = targetExamType;
      state.items = items;
      if (!state.items.some(item => item.key === state.selectedKey)) {
        state.selectedKey = state.items[0]?.key || '';
      }
    } catch (error) {
      state.items = [];
      state.selectedKey = '';
      showToast({ title: 'Quiz verisi alınamadı', message: error.message, type: 'error' });
    } finally {
      state.loadingItems = false;
      safeDraw();
    }
  };

  const startQuiz = async () => {
    const selectedItem = state.items.find(item => item.key === state.selectedKey);
    if (!selectedItem) {
      showToast({ title: 'Seçim eksik', message: 'Önce bir branş veya konu seçin.', type: 'warning' });
      return;
    }

    state.loadingQuestions = true;
    resetQuizProgress();
    state.loadingQuestions = true;
    safeDraw();

    try {
      const request = {
        examType: state.examType,
        limit: Math.min(10, Number(selectedItem.availableCount || 10)),
      };
      if (state.mode === 'branch') request.branchKey = selectedItem.key;
      if (state.mode === 'topic') request.topicKey = selectedItem.key;

      state.questions = await getQuizBookletQuestions(request);
      state.currentIndex = 0;
      state.showResults = false;
    } catch (error) {
      showToast({ title: 'Quiz başlatılamadı', message: error.message, type: 'warning' });
    } finally {
      state.loadingQuestions = false;
      safeDraw();
    }
  };

  const submitAnswer = async selectedOption => {
    const question = state.questions[state.currentIndex];
    if (!question || state.submitting || state.showResults) return;

    state.submitting = true;
    safeDraw();

    try {
      const answer = await answerQuizBookletQuestion(question.id, selectedOption);
      state.answers.push({
        questionId: question.id,
        selectedOption: answer.selectedOption,
        isCorrect: answer.isCorrect,
        answeredAt: answer.answeredAt,
      });

      if (state.currentIndex >= state.questions.length - 1) {
        state.showResults = true;
      } else {
        state.currentIndex += 1;
      }
    } catch (error) {
      showToast({ title: 'Cevap kaydedilemedi', message: error.message, type: 'error' });
    } finally {
      state.submitting = false;
      safeDraw();
    }
  };

  const resetSolvedAnswers = async () => {
    const selectedItem = state.items.find(item => item.key === state.selectedKey) || null;
    const scopeLabel = selectedItem
      ? (state.mode === 'branch' ? selectedItem.title + ' branşı' : selectedItem.title + ' konusu')
      : state.examType;
    const confirmed = window.confirm(scopeLabel + ' için çözülen sorular sıfırlansın mı?');
    if (!confirmed) return;

    state.resettingAnswers = true;
    resetQuizProgress();
    safeDraw();

    try {
      const payload = { examType: state.examType };
      if (state.mode === 'branch' && selectedItem) payload.branchKey = selectedItem.key;
      if (state.mode === 'topic' && selectedItem) payload.topicKey = selectedItem.key;
      const result = await resetQuizBookletAnswers(payload);
      await loadItems(false, true);
      showToast({
        title: 'Quiz ilerlemesi sıfırlandı',
        message: (selectedItem ? scopeLabel : state.examType) + ' için ' + Number(result.deletedCount || 0) + ' cevap silindi.',
        type: 'success',
      });
    } catch (error) {
      showToast({ title: 'Sıfırlama başarısız', message: error.message, type: 'error' });
    } finally {
      state.resettingAnswers = false;
      safeDraw();
    }
  };

  loadItems(false, true);
  safeDraw();
}

function renderExamTypeField(selectedExamType) {
  return [
    '<div class="form-group">',
    '<label class="form-label">Sınav Türü</label>',
    '<select class="form-select" id="quiz-exam-type">',
    EXAM_TYPES.map(examType => '<option value="' + examType + '"' + (examType === selectedExamType ? ' selected' : '') + '>' + examType + '</option>').join(''),
    '</select>',
    '</div>',
  ].join('');
}

function renderModeField(selectedMode) {
  return [
    '<div class="form-group">',
    '<label class="form-label">Çözüm Türü</label>',
    '<select class="form-select" id="quiz-mode">',
    QUIZ_MODES.map(mode => '<option value="' + mode.key + '"' + (mode.key === selectedMode ? ' selected' : '') + '>' + mode.label + '</option>').join(''),
    '</select>',
    '</div>',
  ].join('');
}

function renderSearchField(value) {
  return [
    '<div class="form-group">',
    '<label class="form-label">Ara</label>',
    '<input class="form-input" id="quiz-search" type="search" placeholder="Branş veya konu ara..." value="' + escapeHtml(value) + '">',
    '</div>',
  ].join('');
}

function renderItemField(items, selectedItem, state) {
  const label = state.mode === 'branch' ? 'Branş' : 'Konu';
  return [
    '<div style="display:grid;gap:var(--space-sm);">',
    '<div style="font-size:var(--font-sm);color:var(--text-tertiary);">' + (
      state.loadingItems
        ? label + ' listesi yükleniyor.'
        : items.length
          ? items.length + ' ' + label.toLowerCase() + ' bulundu.'
          : label + ' bulunamadı.'
    ) + '</div>',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-sm);max-height:320px;overflow:auto;padding-right:4px;">',
    items.length
      ? items.map(item => renderItemButton(item, selectedItem?.key === item.key, state.loadingItems)).join('')
      : '<button class="btn btn-secondary" type="button" id="quiz-refresh-items-btn"' + (state.loadingItems ? ' disabled' : '') + '>Listeyi Yenile</button>',
    '</div>',
    selectedItem ? '<div style="font-size:var(--font-sm);color:var(--text-secondary);">Seçili ' + label.toLowerCase() + ': ' + escapeHtml(selectedItem.title) + ' (' + selectedItem.availableCount + ' / ' + Number(selectedItem.totalCount || selectedItem.availableCount || 0) + ')</div>' : '',
    '</div>',
  ].join('');
}

function renderItemButton(item, isSelected, loadingItems) {
  return (
    '<button class="btn ' + (isSelected ? 'btn-primary' : 'btn-secondary') + ' quiz-select-item-btn" type="button" data-key="' + escapeHtml(item.key) + '"' +
    (loadingItems ? ' disabled' : '') +
    ' style="justify-content:flex-start;text-align:left;white-space:normal;height:auto;min-height:48px;">' +
    '<span><strong>' + escapeHtml(item.title) + '</strong><br><span style="font-size:var(--font-xs);color:inherit;opacity:.82;">' + escapeHtml(item.subtitle) + ' · ' + item.availableCount + ' / ' + Number(item.totalCount || item.availableCount || 0) + ' soru</span></span>' +
    '</button>'
  );
}

function renderSelectionHint(state, selectedItem, visibleCount) {
  if (state.loadingItems) return 'Liste hazırlanıyor.';
  if (!state.items.length) return 'Bu sınav türü için kullanılabilir taglenmiş soru yok.';
  if (!visibleCount) return 'Arama filtresine uyan kayıt yok.';
  if (!selectedItem) return 'Quiz başlatmak için bir branş veya konu seçin.';
  if (selectedItem.availableCount < 10) {
    return escapeHtml(selectedItem.title) + ' için ' + selectedItem.availableCount + ' / ' + Number(selectedItem.totalCount || selectedItem.availableCount || 0) + ' soru çözülmemiş durumda.';
  }
  return escapeHtml(selectedItem.title) + ' için ' + selectedItem.availableCount + ' / ' + Number(selectedItem.totalCount || selectedItem.availableCount || 0) + ' soru şu an çözüme açık.';
}

function renderEmptyQuizState() {
  return [
    '<div class="card" style="padding:var(--space-xl);text-align:center;">',
    '<div style="font-size:42px;margin-bottom:var(--space-sm);">🎯</div>',
    '<div style="font-weight:700;font-size:var(--font-lg);margin-bottom:var(--space-xs);">Quiz hazır</div>',
    '<div style="color:var(--text-tertiary);">Sınav türü, çözüm türü ve liste seçimiyle akışı başlatın.</div>',
    '</div>',
  ].join('');
}

function renderActiveQuestion(question, state, selectedItem) {
  const progress = state.currentIndex + 1;
  return [
    '<div class="card" style="padding:var(--space-md);">',
    '<div style="display:flex;justify-content:space-between;gap:var(--space-md);align-items:flex-start;flex-wrap:wrap;margin-bottom:var(--space-md);">',
    '<div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);margin-bottom:4px;">' + escapeHtml(question.examType) + ' · ' + escapeHtml(question.lesson || selectedItem?.title || '') + (question.topicName ? ' / ' + escapeHtml(question.topicName) : '') + '</div>',
    '<div style="font-weight:700;font-size:var(--font-lg);">Soru ' + progress + ' / ' + state.questions.length + '</div>',
    '</div>',
    '<div style="font-size:var(--font-sm);color:var(--text-tertiary);">Soru no: ' + escapeHtml(question.questionNo || '?') + '</div>',
    '</div>',
    '<div style="display:grid;grid-template-columns:minmax(260px,1fr) minmax(220px,300px);gap:var(--space-md);align-items:start;">',
    '<div style="border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:var(--space-sm);background:var(--bg-secondary);">',
    '<img src="' + escapeHtml(question.questionImageUrl) + '" alt="Quiz question" style="width:100%;display:block;border-radius:var(--radius-sm);background:#fff;">',
    '</div>',
    '<div style="display:grid;gap:var(--space-sm);">',
    question.choices.map(choice => (
      '<button class="btn btn-secondary quiz-option-btn" data-option="' + escapeHtml(choice) + '"' + (state.submitting ? ' disabled' : '') + ' style="justify-content:flex-start;padding:14px 16px;">' +
      '<strong style="min-width:24px;display:inline-block;">' + escapeHtml(choice) + '</strong><span>' + escapeHtml(choice) + '</span>' +
      '</button>'
    )).join(''),
    state.submitting ? '<div style="font-size:var(--font-sm);color:var(--text-tertiary);">Cevap kaydediliyor...</div>' : '<div style="font-size:var(--font-sm);color:var(--text-tertiary);">Doğru cevap quiz bitince gösterilecek.</div>',
    '</div>',
    '</div>',
    '</div>',
  ].join('');
}

function renderResults(state, selectedItem, correctCount, wrongCount) {
  const answerMap = new Map(state.answers.map(answer => [answer.questionId, answer]));
  return [
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="display:flex;justify-content:space-between;gap:var(--space-md);flex-wrap:wrap;align-items:center;">',
    '<div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);margin-bottom:4px;">' + escapeHtml(state.examType) + ' · ' + escapeHtml(selectedItem?.title || '') + '</div>',
    '<div style="font-weight:700;font-size:var(--font-xl);">Quiz Sonucu</div>',
    '</div>',
    '<button class="btn btn-primary" id="quiz-reset-btn">Yeni Quiz Başlat</button>',
    '</div>',
    '<div class="stats-grid" style="margin-top:var(--space-md);">',
    statCard('Toplam', state.questions.length),
    statCard('Doğru', correctCount),
    statCard('Yanlış', wrongCount),
    statCard('Başarı', '%' + Math.round((correctCount / Math.max(1, state.questions.length)) * 100)),
    '</div>',
    '</div>',
    '<div style="display:flex;flex-direction:column;gap:var(--space-md);">',
    state.questions.map((question, index) => {
      const answer = answerMap.get(question.id);
      const correct = Boolean(answer?.isCorrect);
      return [
        '<div class="card" style="padding:var(--space-md);border-left:4px solid ' + (correct ? 'var(--color-success)' : 'var(--color-danger)') + ';">',
        '<div style="display:flex;justify-content:space-between;gap:var(--space-md);flex-wrap:wrap;">',
        '<div>',
        '<div style="font-weight:700;">Soru ' + (index + 1) + ' · ' + escapeHtml(question.questionNo || '?') + '</div>',
        '<div style="font-size:var(--font-sm);color:var(--text-tertiary);">' + escapeHtml(question.lesson || question.lessonName) + (question.topicName ? ' / ' + escapeHtml(question.topicName) : '') + '</div>',
        '</div>',
        '<div style="font-size:var(--font-sm);font-weight:700;color:' + (correct ? 'var(--color-success)' : 'var(--color-danger)') + ';">' + (correct ? 'Doğru' : 'Yanlış') + '</div>',
        '</div>',
        '<div style="display:flex;gap:var(--space-md);align-items:center;flex-wrap:wrap;margin-top:var(--space-sm);">',
        '<img src="' + escapeHtml(question.questionImageUrl) + '" alt="Quiz result question" style="width:120px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);background:#fff;">',
        '<div style="display:grid;gap:6px;">',
        '<div>Seçilen şık: <strong>' + escapeHtml(answer?.selectedOption || '-') + '</strong></div>',
        '<div>Doğru şık: <strong>' + escapeHtml(question.correctAnswer || '-') + '</strong></div>',
        '</div>',
        '</div>',
        '</div>',
      ].join('');
    }).join(''),
    '</div>',
  ].join('');
}

function filterItems(items, searchTerm) {
  const normalized = normalizeSearch(searchTerm);
  if (!normalized) return items;
  return items.filter(item => normalizeSearch([item.title, item.subtitle].join(' ')).includes(normalized));
}

function normalizeSearch(value) {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
