import { store } from '../data/store.js';
import { createQuestion } from '../data/models.js';
import { extractQuestionsWithOcr } from '../api/dataApi.js';
import { getLessonsForTrack, getTopicsForLesson } from '../data/curriculum.js';
import { showModal, closeModal, showToast } from './components.js';
import { buildWeakRows } from '../engine/topicAnalyzer.js';

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'];

export function renderQuestionBank(container) {
  const questions = store.getQuestions();
  const answers = store.getQuestionAnswers();
  const answeredIds = new Set(answers.map(answer => answer.questionId));
  const correctCount = answers.filter(answer => answer.isCorrect).length;
  const wrongCount = answers.filter(answer => !answer.isCorrect).length;
  const weakRows = buildWeakRows(questions, answers);

  container.innerHTML = [
    '<div class="page-header"><h2>Soru Bankası</h2><p>TYT/AYT sorularını konu, şık ve doğru cevap bilgisiyle kaydedin; çözümleri konu eksiklerine dönüştürün.</p></div>',
    '<div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-xl);flex-wrap:wrap;">',
    '<button class="btn btn-primary btn-lg" id="add-question-btn">+ Soru Ekle</button>',
    questions.length ? '<button class="btn btn-secondary btn-lg" id="auto-tag-questions-btn">Gemini ile Etiketle</button>' : '',
    '</div>',
    '<div class="stats-grid" style="margin-bottom:var(--space-xl);">',
    statCard('Toplam Soru', questions.length),
    statCard('Çözülen', answeredIds.size),
    statCard('Doğru', correctCount),
    statCard('Yanlış', wrongCount),
    '</div>',
    weakRows.length ? renderWeaknessTable(weakRows) : '',
    questions.length ? renderQuestionList(questions, answers) : renderEmptyState(),
  ].join('');

  bindQuestionEvents(container);
}

function statCard(label, value) {
  return '<div class="stat-card"><div class="stat-value">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}

function renderEmptyState() {
  return '<div class="card"><div class="empty-state"><div class="empty-icon">?</div><h3>Henüz soru yok</h3><p>İlk soruyu ekleyerek soru bazlı performans takibine başlayın.</p><button class="btn btn-primary" id="add-question-empty-btn">+ İlk Soruyu Ekle</button></div></div>';
}

function renderWeaknessTable(rows) {
  return [
    '<div class="card" style="margin-bottom:var(--space-xl);padding:var(--space-md);">',
    '<div style="font-weight:700;margin-bottom:var(--space-sm);">Konu Eksikleri</div>',
    '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Konu</th><th>Ders</th><th>Yanlış</th><th>Doğru</th><th>Oran</th></tr></thead><tbody>',
    rows.map(row => '<tr><td>' + escapeHtml(row.topicName) + '</td><td>' + escapeHtml(row.lesson) + '</td><td>' + row.wrong + '</td><td>' + row.correct + '</td><td>%' + row.wrongRate + '</td></tr>').join(''),
    '</tbody></table></div></div>',
  ].join('');
}

function renderQuestionList(questions, answers) {
  const answerMap = new Map(answers.map(answer => [answer.questionId, answer]));
  return [
    '<div style="display:flex;flex-direction:column;gap:var(--space-md);">',
    questions.map(question => renderQuestionCard(question, answerMap.get(question.id))).join(''),
    '</div>',
  ].join('');
}

function renderQuestionCard(question, answer) {
  const options = OPTION_KEYS.map(key => {
    const option = (question.options || []).find(item => item.optionKey === key) || {};
    const selected = answer && answer.selectedOption === key;
    const correct = answer && question.correctOption === key;
    const classes = ['btn', 'btn-secondary', 'answer-option-btn'];
    if (selected) classes.push(answer.isCorrect ? 'answer-correct' : 'answer-wrong');
    if (correct) classes.push('answer-key');
    return [
      '<button class="' + classes.join(' ') + '" data-question-id="' + question.id + '" data-option="' + key + '">',
      '<strong>' + key + '</strong> ' + escapeHtml(option.optionText || ''),
      '</button>',
    ].join('');
  }).join('');

  const result = answer
    ? '<span style="color:' + (answer.isCorrect ? 'var(--color-success)' : 'var(--color-danger)') + ';font-weight:700;">' + (answer.isCorrect ? 'Doğru' : 'Yanlış') + '</span>'
    : '<span style="color:var(--text-tertiary);">Çözülmedi</span>';

  return [
    '<div class="card question-card" style="padding:var(--space-md);">',
    '<div style="display:flex;gap:var(--space-md);align-items:flex-start;">',
    '<div style="flex:1;min-width:0;">',
    '<div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;margin-bottom:var(--space-sm);font-size:var(--font-xs);color:var(--text-tertiary);">',
    '<span>' + escapeHtml(question.examType) + '</span>',
    '<span>' + escapeHtml(question.lesson) + '</span>',
    '<span>' + escapeHtml(question.topicName) + '</span>',
    question.questionNo ? '<span>Soru ' + question.questionNo + '</span>' : '',
    '</div>',
    '<div style="font-weight:650;margin-bottom:var(--space-md);white-space:pre-wrap;">' + escapeHtml(question.questionText) + '</div>',
    '<div style="display:grid;gap:var(--space-xs);">' + options + '</div>',
    answer ? '<div style="margin-top:var(--space-sm);font-size:var(--font-sm);">Doğru cevap: <strong>' + question.correctOption + '</strong>' + (question.explanation ? ' · ' + escapeHtml(question.explanation) : '') + '</div>' : '',
    '</div>',
    '<div style="display:flex;flex-direction:column;gap:var(--space-xs);align-items:flex-end;">',
    result,
    '<button class="btn btn-sm btn-secondary edit-question-btn" data-question-id="' + question.id + '">Düzenle</button>',
    '<button class="btn btn-sm btn-danger delete-question-btn" data-question-id="' + question.id + '">Sil</button>',
    '</div></div></div>',
  ].join('');
}

function bindQuestionEvents(container) {
  const add = () => showQuestionForm();
  const addBtn = container.querySelector('#add-question-btn');
  if (addBtn) addBtn.addEventListener('click', add);
  const emptyBtn = container.querySelector('#add-question-empty-btn');
  if (emptyBtn) emptyBtn.addEventListener('click', add);
  const autoTagBtn = container.querySelector('#auto-tag-questions-btn');
  if (autoTagBtn) {
    autoTagBtn.addEventListener('click', async () => {
      if (!confirm('Veritabanındaki sorular Gemini Flash ile analiz edilip MEB lise konularına göre yeniden etiketlenecek. Devam edilsin mi?')) return;
      autoTagBtn.disabled = true;
      const oldText = autoTagBtn.textContent;
      autoTagBtn.textContent = 'Etiketleniyor...';
      try {
        const result = await store.autoTagQuestions({ overwrite: true, limit: 200 });
        showToast({
          title: 'Etiketleme tamamlandı',
          message: result.updated + ' soru güncellendi, ' + result.skipped + ' soru atlandı.',
          type: result.updated ? 'success' : 'warning',
        });
        renderQuestionBank(container);
      } catch (error) {
        showToast({ title: 'Etiketleme hatası', message: error.message, type: 'error' });
        autoTagBtn.disabled = false;
        autoTagBtn.textContent = oldText;
      }
    });
  }

  container.querySelectorAll('.answer-option-btn').forEach(button => {
    button.addEventListener('click', () => {
      const answer = store.answerQuestion(button.dataset.questionId, button.dataset.option);
      if (!answer) return;
      showToast({
        title: answer.isCorrect ? 'Doğru cevap' : 'Yanlış cevap',
        message: answer.isCorrect ? 'Soru doğru işaretlendi.' : 'Konu eksiklerine işlendi.',
        type: answer.isCorrect ? 'success' : 'warning',
      });
      renderQuestionBank(container);
    });
  });

  container.querySelectorAll('.edit-question-btn').forEach(button => {
    button.addEventListener('click', () => {
      const question = store.getQuestion(button.dataset.questionId);
      if (question) showQuestionForm(question);
    });
  });

  container.querySelectorAll('.delete-question-btn').forEach(button => {
    button.addEventListener('click', () => {
      const question = store.getQuestion(button.dataset.questionId);
      if (question && confirm('Bu soruyu silmek istiyor musunuz?')) {
        store.deleteQuestion(question.id);
        renderQuestionBank(container);
      }
    });
  });
}

function showQuestionForm(existing = null) {
  const isEdit = Boolean(existing);
  let examType = existing?.examType || 'TYT';
  let track = existing?.track || 'sayisal';
  let lessons = getLessonsForTrack(examType, track);
  let lesson = existing?.lesson || lessons[0] || '';
  let topics = getTopicsForLesson(examType, track, lesson);
  let topicName = existing?.topicName || topics[0] || '';

  const overlay = showModal({
    title: isEdit ? 'Soruyu Düzenle' : 'Soru Ekle',
    content: '<div id="question-form-inner">' + buildQuestionForm(existing, examType, track, lessons, lesson, topics, topicName) + '</div>',
    footer: '<button class="btn btn-secondary" id="modal-cancel">İptal</button><button class="btn btn-primary" id="modal-save">' + (isEdit ? 'Güncelle' : 'Kaydet') + '</button>',
  });

  function rebuild() {
    lessons = getLessonsForTrack(examType, track);
    if (!lessons.includes(lesson)) lesson = lessons[0] || '';
    topics = getTopicsForLesson(examType, track, lesson);
    if (!topics.includes(topicName)) topicName = topics[0] || '';
    overlay.querySelector('#question-form-inner').innerHTML = buildQuestionForm(existing, examType, track, lessons, lesson, topics, topicName);
    bindFormChanges();
  }

  function bindFormChanges() {
    overlay.querySelector('#q-exam-type').addEventListener('change', event => {
      examType = event.target.value;
      rebuild();
    });
    overlay.querySelector('#q-track').addEventListener('change', event => {
      track = event.target.value;
      rebuild();
    });
    overlay.querySelector('#q-lesson').addEventListener('change', event => {
      lesson = event.target.value;
      topicName = '';
      rebuild();
    });
    overlay.querySelector('#q-topic').addEventListener('input', event => {
      topicName = event.target.value;
    });
  }

  bindFormChanges();
  overlay.querySelector('#modal-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#modal-save').addEventListener('click', () => saveQuestionForm(overlay, existing));
  overlay.querySelector('#q-ocr-run').addEventListener('click', () => runOcrImport(overlay));
}

function buildQuestionForm(existing, examType, track, lessons, lesson, topics, topicName) {
  const optionInputs = OPTION_KEYS.map(key => {
    const option = (existing?.options || []).find(item => item.optionKey === key) || {};
    return '<div class="form-group"><label class="form-label">' + key + ' Şıkkı</label><textarea class="form-input q-option" data-key="' + key + '" rows="2">' + escapeHtml(option.optionText || '') + '</textarea></div>';
  }).join('');

  return [
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-md);">',
    '<div style="font-weight:700;margin-bottom:var(--space-sm);">OCR ile Aktar</div>',
    '<div style="display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap;">',
    '<input class="form-input" id="q-ocr-file" type="file" accept="image/*,.pdf" style="max-width:360px;">',
    '<button class="btn btn-secondary" id="q-ocr-run" type="button">OCR Çalıştır</button>',
    '<span id="q-ocr-status" style="font-size:var(--font-xs);color:var(--text-tertiary);"></span>',
    '</div>',
    '<textarea class="form-input" id="q-ocr-raw" rows="3" placeholder="OCR ham metni burada görünür." style="margin-top:var(--space-sm);"></textarea>',
    '</div>',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-md);">',
    selectField('Sınav Türü', 'q-exam-type', [['TYT', 'TYT'], ['AYT', 'AYT']], examType),
    selectField('Alan', 'q-track', [['sayisal', 'Sayısal'], ['esit_agirlik', 'EA'], ['sozel', 'Sözel'], ['dil', 'Dil']], track),
    selectField('Ders', 'q-lesson', lessons.map(item => [item, item]), lesson),
    '<div class="form-group"><label class="form-label">Soru No</label><input class="form-input" id="q-no" type="number" min="1" value="' + escapeHtml(existing?.questionNo || '') + '"></div>',
    '</div>',
    '<div class="form-group"><label class="form-label">Konu</label><input class="form-input" id="q-topic" list="q-topic-list" value="' + escapeHtml(topicName) + '"><datalist id="q-topic-list">' + topics.map(topic => '<option value="' + escapeHtml(topic) + '"></option>').join('') + '</datalist></div>',
    '<div class="form-group"><label class="form-label">Soru Metni</label><textarea class="form-input" id="q-text" rows="5">' + escapeHtml(existing?.questionText || '') + '</textarea></div>',
    optionInputs,
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-md);">',
    selectField('Doğru Cevap', 'q-correct', OPTION_KEYS.map(key => [key, key]), existing?.correctOption || 'A'),
    '<div class="form-group"><label class="form-label">Zorluk</label><input class="form-input" id="q-difficulty" type="number" min="1" max="5" value="' + escapeHtml(existing?.difficulty || 3) + '"></div>',
    '<div class="form-group"><label class="form-label">Kaynak</label><input class="form-input" id="q-source" value="' + escapeHtml(existing?.sourceName || '') + '"></div>',
    '<div class="form-group"><label class="form-label">Yıl</label><input class="form-input" id="q-year" type="number" min="2000" max="2100" value="' + escapeHtml(existing?.sourceYear || '') + '"></div>',
    '</div>',
    '<div class="form-group"><label class="form-label">Çözüm / Not</label><textarea class="form-input" id="q-explanation" rows="3">' + escapeHtml(existing?.explanation || '') + '</textarea></div>',
  ].join('');
}

async function runOcrImport(overlay) {
  const fileInput = overlay.querySelector('#q-ocr-file');
  const status = overlay.querySelector('#q-ocr-status');
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    showToast({ title: 'Dosya seçilmedi', message: 'PDF veya görsel dosyası seçin.', type: 'error' });
    return;
  }

  status.textContent = 'OCR çalışıyor...';
  try {
    const fileBase64 = await readFileAsBase64(file);
    const result = await extractQuestionsWithOcr({ fileName: file.name, fileBase64 });
    overlay.querySelector('#q-ocr-raw').value = result.rawText || '';
    fillQuestionFromOcr(overlay, (result.questions || [])[0]);
    status.textContent = (result.questions || []).length + ' soru taslağı bulundu.';
  } catch (error) {
    status.textContent = '';
    showToast({ title: 'OCR hatası', message: error.message, type: 'error' });
  }
}

function fillQuestionFromOcr(overlay, question) {
  if (!question) return;
  if (question.questionNo) overlay.querySelector('#q-no').value = question.questionNo;
  if (question.questionText) overlay.querySelector('#q-text').value = question.questionText;
  (question.options || []).forEach(option => {
    const input = overlay.querySelector('.q-option[data-key="' + option.optionKey + '"]');
    if (input) input.value = option.optionText || '';
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function saveQuestionForm(overlay, existing) {
  const options = OPTION_KEYS.map(key => ({
    optionKey: key,
    optionText: overlay.querySelector('.q-option[data-key="' + key + '"]').value.trim(),
  }));
  const question = createQuestion({
    id: existing?.id || null,
    examType: overlay.querySelector('#q-exam-type').value,
    track: overlay.querySelector('#q-track').value,
    lesson: overlay.querySelector('#q-lesson').value,
    topicName: overlay.querySelector('#q-topic').value,
    questionNo: overlay.querySelector('#q-no').value,
    questionText: overlay.querySelector('#q-text').value,
    options,
    correctOption: overlay.querySelector('#q-correct').value,
    explanation: overlay.querySelector('#q-explanation').value,
    sourceName: overlay.querySelector('#q-source').value,
    sourceYear: overlay.querySelector('#q-year').value,
    difficulty: overlay.querySelector('#q-difficulty').value,
  });

  if (!question.lesson || !question.topicName || !question.questionText || options.some(option => !option.optionText)) {
    showToast({ title: 'Eksik bilgi', message: 'Ders, konu, soru metni ve tüm şıklar zorunludur.', type: 'error' });
    return;
  }

  if (existing) {
    store.updateQuestion(existing.id, question);
    showToast({ title: 'Soru güncellendi', message: 'Soru bankası kaydı güncellendi.', type: 'success' });
  } else {
    store.addQuestion(question);
    showToast({ title: 'Soru eklendi', message: 'Soru bankasına kaydedildi.', type: 'success' });
  }
  closeModal();
  const content = document.getElementById('main-content');
  if (content) renderQuestionBank(content);
}

function selectField(label, id, options, selected) {
  return '<div class="form-group"><label class="form-label">' + label + '</label><select class="form-select" id="' + id + '">' + options.map(option => '<option value="' + escapeHtml(option[0]) + '"' + (option[0] === selected ? ' selected' : '') + '>' + escapeHtml(option[1]) + '</option>').join('') + '</select></div>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
