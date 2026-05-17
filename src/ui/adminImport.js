import { getLessonsForTrack, getTopicsForLesson } from '../data/curriculum.js';
import { getAdminQuestionImports, importAdminQuestionPdf } from '../api/dataApi.js';
import { showToast } from './components.js';

export async function renderAdminImport(container) {
  container.innerHTML = [
    '<div class="page-header"><h2>Admin Soru Import</h2><p>PDF soru kitapçığı ve cevap anahtarını global soru bankasına aktarır. Bu ekran menüde görünmez.</p></div>',
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-md);">',
    selectField('Sınav Türü', 'admin-exam-type', [['TYT', 'TYT'], ['AYT', 'AYT']], 'TYT'),
    selectField('Alan', 'admin-track', [['sayisal', 'Sayısal'], ['esit_agirlik', 'EA'], ['sozel', 'Sözel'], ['dil', 'Dil']], 'sayisal'),
    '<div class="form-group"><label class="form-label">Kaynak Adı</label><input class="form-input" id="admin-source-name" value="TYT 2021"></div>',
    '<div class="form-group"><label class="form-label">Yıl</label><input class="form-input" id="admin-source-year" type="number" value="2021"></div>',
    '</div>',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--space-md);margin-top:var(--space-md);">',
    '<div class="form-group"><label class="form-label">Soru PDF</label><input class="form-input" id="admin-question-file" type="file" accept=".pdf,image/*"></div>',
    '<div class="form-group"><label class="form-label">Cevap Anahtarı PDF / Görsel</label><input class="form-input" id="admin-answer-file" type="file" accept=".pdf,image/*"><small style="color:var(--text-tertiary);">Boş bırakılırsa cevap anahtarı soru PDF içinde aranır.</small></div>',
    '</div>',
    '<div style="display:flex;gap:var(--space-sm);align-items:center;margin-top:var(--space-md);flex-wrap:wrap;">',
    '<button class="btn btn-primary" id="admin-import-btn">PDF Import Et</button>',
    '<span id="admin-import-status" style="color:var(--text-tertiary);font-size:var(--font-sm);"></span>',
    '</div>',
    '</div>',
    '<div id="admin-import-result"></div>',
    '<div class="card" style="padding:var(--space-md);"><div style="font-weight:700;margin-bottom:var(--space-sm);">Son Importlar</div><div id="admin-import-history">Yükleniyor...</div></div>',
  ].join('');

  container.querySelector('#admin-import-btn').addEventListener('click', () => runAdminImport(container));
  await loadHistory(container);
}

async function runAdminImport(container) {
  const status = container.querySelector('#admin-import-status');
  const result = container.querySelector('#admin-import-result');
  const questionFile = container.querySelector('#admin-question-file').files[0];
  const answerFile = container.querySelector('#admin-answer-file').files[0];
  if (!questionFile) {
    showToast({ title: 'PDF eksik', message: 'Soru PDF dosyasını seçin.', type: 'error' });
    return;
  }

  status.textContent = 'PDF okunuyor ve import ediliyor...';
  result.innerHTML = '';
  try {
    const examType = container.querySelector('#admin-exam-type').value;
    const track = container.querySelector('#admin-track').value;
    const payload = {
      examType,
      track,
      sourceName: container.querySelector('#admin-source-name').value.trim(),
      sourceYear: Number(container.querySelector('#admin-source-year').value) || null,
      questionFileName: questionFile.name,
      questionFileBase64: await readFileAsBase64(questionFile),
      curriculumTopics: buildCurriculumPayload(examType, track),
    };
    if (answerFile) {
      payload.answerFileName = answerFile.name;
      payload.answerFileBase64 = await readFileAsBase64(answerFile);
    }

    const data = await importAdminQuestionPdf(payload);
    status.textContent = '';
    result.innerHTML = renderResult(data);
    showToast({
      title: 'Import tamamlandı',
      message: data.importedCount + ' soru kaydedildi, ' + data.reviewCount + ' soru kontrol istiyor.',
      type: 'success',
    });
    await loadHistory(container);
  } catch (error) {
    status.textContent = '';
    showToast({ title: 'Import hatası', message: error.message, type: 'error' });
  }
}

async function loadHistory(container) {
  const history = container.querySelector('#admin-import-history');
  try {
    const rows = await getAdminQuestionImports();
    if (!rows.length) {
      history.innerHTML = '<div style="color:var(--text-tertiary);">Henüz import yok.</div>';
      return;
    }
    history.innerHTML = [
      '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Kaynak</th><th>Sınav</th><th>Kaydedilen</th><th>Kontrol</th><th>Tarih</th></tr></thead><tbody>',
      rows.map(row => '<tr><td>' + escapeHtml(row.sourceName) + ' ' + escapeHtml(row.sourceYear || '') + '</td><td>' + escapeHtml(row.examType) + '</td><td>' + row.importedCount + '</td><td>' + row.reviewCount + '</td><td>' + new Date(row.createdAt).toLocaleString('tr-TR') + '</td></tr>').join(''),
      '</tbody></table></div>',
    ].join('');
  } catch (error) {
    history.innerHTML = '<div style="color:var(--color-danger);">' + escapeHtml(error.message) + '</div>';
  }
}

function renderResult(data) {
  return [
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-md);margin-bottom:var(--space-md);">',
    stat('Bulunan Soru', data.detectedQuestions),
    stat('Bulunan Cevap', data.detectedAnswers),
    stat('Kaydedilen', data.importedCount),
    stat('Kontrol Gerekli', data.reviewCount),
    '</div>',
    '<div style="font-weight:700;margin-bottom:var(--space-sm);">Önizleme</div>',
    '<div style="display:flex;flex-direction:column;gap:var(--space-sm);">',
    (data.preview || []).map(renderPreviewQuestion).join(''),
    '</div></div>',
  ].join('');
}

function renderPreviewQuestion(question) {
  return [
    '<div style="padding:var(--space-sm);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);">',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);">Soru ' + question.questionNo + ' · ' + escapeHtml(question.lesson || 'Ders?') + ' · ' + escapeHtml(question.topicName || 'Konu?') + ' · Cevap: ' + escapeHtml(question.correctOption || '?') + (question.needsReview ? ' · Kontrol gerekli' : '') + '</div>',
    '<div style="font-weight:650;margin-top:var(--space-xs);">' + escapeHtml(String(question.questionText || '').slice(0, 240)) + '</div>',
    '</div>',
  ].join('');
}

function stat(label, value) {
  return '<div class="stat-card"><div class="stat-value">' + (value || 0) + '</div><div class="stat-label">' + label + '</div></div>';
}

function buildCurriculumPayload(examType, track) {
  const lessons = getLessonsForTrack(examType, track);
  const payload = [];
  lessons.forEach(lesson => {
    getTopicsForLesson(examType, track, lesson).forEach(topicName => {
      payload.push({ lesson, topicName });
    });
  });
  return payload;
}

function selectField(label, id, options, selected) {
  return '<div class="form-group"><label class="form-label">' + label + '</label><select class="form-select" id="' + id + '">' + options.map(option => '<option value="' + escapeHtml(option[0]) + '"' + (option[0] === selected ? ' selected' : '') + '>' + escapeHtml(option[1]) + '</option>').join('') + '</select></div>';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
