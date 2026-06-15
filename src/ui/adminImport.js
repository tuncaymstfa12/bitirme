import {
  applyBookletAnswerKey,
  autoTagBookletTest,
  createBookletReviewQuestion,
  createBookletTest,
  deleteBookletTest,
  deleteBookletReviewQuestion,
  deleteFinalBookletQuestion,
  finalizeBookletTest,
  getBookletReview,
  getBookletTests,
  getFinalBookletQuestions,
  updateBookletReviewQuestion,
  uploadBookletTestPdf,
} from '../api/dataApi.js';
import { showToast } from './components.js';

export async function renderAdminImport(container) {
  container.innerHTML = [
    '<div class="page-header"><h2>Booklet Import MVP</h2><p>PDF kitapcigini test bazinda ayirir, soru crop review yapar ve sadece onaydan sonra kaydeder.</p></div>',
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-md);">',
    '<div class="form-group"><label class="form-label">Test Basligi</label><input class="form-input" id="booklet-title" placeholder="TYT Deneme 1"></div>',
    '<div class="form-group"><label class="form-label">Sinav Turu</label><select class="form-select" id="booklet-exam-type"><option value="TYT">TYT</option><option value="AYT">AYT</option><option value="YDT">YDT</option></select></div>',
    '<div class="form-group"><label class="form-label">Kitapcik Turu</label><input class="form-input" id="booklet-booklet-type" placeholder="A"></div>',
    '<div class="form-group"><label class="form-label">PDF</label><input class="form-input" id="booklet-file" type="file" accept=".pdf"></div>',
    '</div>',
    '<div style="display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap;margin-top:var(--space-md);">',
    '<button class="btn btn-primary" id="booklet-create-btn">Test Olustur ve Yukle</button>',
    '<span id="booklet-status" style="font-size:var(--font-sm);color:var(--text-tertiary);"></span>',
    '</div>',
    '</div>',
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="font-weight:700;margin-bottom:var(--space-sm);">Yuklenen Testler</div>',
    '<div id="booklet-test-list">Yukleniyor...</div>',
    '</div>',
    '<div id="booklet-review-root"></div>',
  ].join('');

  container.querySelector('#booklet-create-btn').addEventListener('click', () => handleCreateAndUpload(container));
  await loadTests(container);
}

async function handleCreateAndUpload(container) {
  const status = container.querySelector('#booklet-status');
  const title = container.querySelector('#booklet-title').value.trim();
  const examType = container.querySelector('#booklet-exam-type').value;
  const bookletType = container.querySelector('#booklet-booklet-type').value.trim();
  const file = container.querySelector('#booklet-file').files[0];

  if (!title) {
    showToast({ title: 'Eksik bilgi', message: 'Test basligi girin.', type: 'error' });
    return;
  }
  if (!file) {
    showToast({ title: 'PDF eksik', message: 'Bir PDF secin.', type: 'error' });
    return;
  }

  status.textContent = 'Test olusturuluyor...';
  try {
    const test = await createBookletTest({ title, examType, bookletType });
    status.textContent = 'PDF isleniyor...';
    await uploadBookletTestPdf(test.id, {
      pdfFileName: file.name,
      pdfFileBase64: await readFileAsBase64(file),
    });
    status.textContent = '';
    showToast({ title: 'Import hazir', message: 'Review ekrani acildi.', type: 'success' });
    await loadTests(container, test.id);
  } catch (error) {
    status.textContent = '';
    showToast({ title: 'Import hatasi', message: error.message, type: 'error' });
  }
}

async function loadTests(container, selectedTestId = null) {
  const testList = container.querySelector('#booklet-test-list');
  try {
    const tests = await getBookletTests();
    if (!tests.length) {
      testList.innerHTML = '<div style="color:var(--text-tertiary);">Henuz test yok.</div>';
      container.querySelector('#booklet-review-root').innerHTML = '';
      return;
    }

    const activeId = selectedTestId || tests[0].id;
    testList.innerHTML = [
      '<div style="display:flex;flex-direction:column;gap:var(--space-sm);">',
      tests.map(test => renderTestRow(test, test.id === activeId)).join(''),
      '</div>',
    ].join('');

    testList.querySelectorAll('.booklet-open-btn').forEach(button => {
      button.addEventListener('click', () => loadTests(container, button.dataset.testId));
    });
    testList.querySelectorAll('.booklet-delete-test-btn').forEach(button => {
      button.addEventListener('click', async () => {
        if (!confirm('Bu testi ve kayitli sorularini silmek istiyor musunuz?')) return;
        try {
          await deleteBookletTest(button.dataset.testId);
          showToast({ title: 'Test silindi', message: 'Import testi kaldirildi.', type: 'info' });
          await loadTests(container);
        } catch (error) {
          showToast({ title: 'Silme hatasi', message: error.message, type: 'error' });
        }
      });
    });

    await loadReview(container, activeId);
  } catch (error) {
    testList.innerHTML = '<div style="color:var(--color-danger);">' + escapeHtml(error.message) + '</div>';
  }
}

function renderTestRow(test, isActive) {
  return [
    '<div style="display:flex;gap:var(--space-sm);align-items:center;justify-content:space-between;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:var(--space-sm);',
    isActive ? 'background:var(--bg-secondary);' : '',
    '">',
    '<div>',
    '<div style="font-weight:650;">' + escapeHtml(test.title) + '</div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);">' + escapeHtml(test.examType || '-') + ' · ' + escapeHtml(test.bookletType || '-') + ' · ' + escapeHtml(test.status || '-') + '</div>',
    '</div>',
    '<div style="display:flex;gap:var(--space-xs);flex-wrap:wrap;justify-content:flex-end;">',
    '<button class="btn btn-secondary btn-sm booklet-open-btn" data-test-id="' + test.id + '">Ac</button>',
    '<button class="btn btn-danger btn-sm booklet-delete-test-btn" data-test-id="' + test.id + '">Sil</button>',
    '</div>',
    '</div>',
  ].join('');
}

async function loadReview(container, testId) {
  const root = container.querySelector('#booklet-review-root');
  root.innerHTML = '<div class="card" style="padding:var(--space-md);">Review yukleniyor...</div>';

  try {
    const review = await getBookletReview(testId);
    root.innerHTML = renderReview(review);
    bindReviewEvents(container, review);
    if (review.status === 'finalized') {
      await refreshFinalQuestions(root, review.testId);
    }
  } catch (error) {
    root.innerHTML = '<div class="card" style="padding:var(--space-md);color:var(--color-danger);">' + escapeHtml(error.message) + '</div>';
  }
}

function renderReview(review) {
  const activeQuestions = (review.detections || []).filter(item => !item.deleted);
  const answeredCount = activeQuestions.filter(item => item.correctAnswer).length;
  const pageOptions = (review.pages || []).map(page => '<option value="' + page.pageNumber + '">' + page.pageNumber + '</option>').join('');
  const sections = (review.sections && review.sections.length)
    ? review.sections
    : [{ sectionCode: 'main', sectionName: 'Main', sectionOrder: 1 }];
  const sectionOptions = sections.map(section => '<option value="' + escapeHtml(section.sectionCode) + '">' + escapeHtml(section.sectionName) + '</option>').join('');
  const answerKeyText = formatAnswerKey(review.answerKey, sections);

  return [
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="display:flex;justify-content:space-between;gap:var(--space-md);flex-wrap:wrap;">',
    '<div><div style="font-weight:700;font-size:var(--font-lg);">' + escapeHtml(review.title || 'Test') + '</div><div style="font-size:var(--font-sm);color:var(--text-tertiary);">' + escapeHtml(review.examType || '-') + ' · ' + escapeHtml(review.bookletType || '-') + ' · ' + escapeHtml(review.status || '-') + '</div></div>',
    '<div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">',
    stat('Sayfa', review.pages.length),
    stat('Bolum', (review.sections || []).length),
    stat('Crop', activeQuestions.length),
    stat('Cevap', answeredCount),
    '</div>',
    '</div>',
    (review.sections || []).length ? '<div style="margin-top:var(--space-md);font-size:var(--font-sm);color:var(--text-tertiary);">' + review.sections.map(section => escapeHtml(section.sectionName + ' (' + section.startPage + '-' + section.endPage + ')')).join(' · ') + '</div>' : '',
    review.warnings && review.warnings.length ? '<div style="margin-top:var(--space-md);color:var(--color-warning);font-size:var(--font-sm);">' + review.warnings.map(escapeHtml).join(' · ') + '</div>' : '',
    '</div>',
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="font-weight:700;margin-bottom:var(--space-sm);">Cevap Anahtari</div>',
    '<textarea class="form-input" id="booklet-answer-key" rows="6" placeholder="turkce 1: A&#10;turkce 2: C&#10;sosyal 1: D">' + escapeHtml(answerKeyText) + '</textarea>',
    '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-sm);flex-wrap:wrap;">',
    '<button class="btn btn-secondary" id="booklet-apply-answer-key">Cevaplari Esle</button>',
    '<button class="btn btn-primary" id="booklet-finalize-btn">Onayla ve Kaydet</button>',
    '<button class="btn btn-secondary" id="booklet-auto-tag-btn">Tumunu MEB Konularıyla Tagle</button>',
    '</div>',
    '</div>',
    '<div class="card" style="padding:var(--space-md);margin-bottom:var(--space-xl);">',
    '<div style="font-weight:700;margin-bottom:var(--space-sm);">Manuel Soru Ekle</div>',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-sm);">',
    '<select class="form-select" id="manual-section-code">' + sectionOptions + '</select>',
    '<input class="form-input" id="manual-question-number" type="number" min="1" placeholder="Bolum soru no">',
    '<select class="form-select" id="manual-page-number">' + pageOptions + '</select>',
    '<input class="form-input" id="manual-crop-x" type="number" min="0" placeholder="x">',
    '<input class="form-input" id="manual-crop-y" type="number" min="0" placeholder="y">',
    '<input class="form-input" id="manual-crop-width" type="number" min="1" placeholder="width">',
    '<input class="form-input" id="manual-crop-height" type="number" min="1" placeholder="height">',
    '</div>',
    '<button class="btn btn-secondary" id="manual-add-btn" style="margin-top:var(--space-sm);">Manuel Crop Ekle</button>',
    '</div>',
    '<div style="display:flex;flex-direction:column;gap:var(--space-md);">',
    activeQuestions.length ? activeQuestions.map(item => renderQuestionCard(item, review.pages, sections)).join('') : '<div class="card" style="padding:var(--space-md);">Henuz aktif crop yok.</div>',
    '</div>',
    '<div id="booklet-final-root" style="margin-top:var(--space-xl);"></div>',
  ].join('');
}

function renderQuestionCard(question, pages, sections) {
  const page = pages.find(item => item.pageNumber === question.pageNumber);
  return [
    '<div class="card" style="padding:var(--space-md);">',
    '<div style="display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:var(--space-md);align-items:start;">',
    '<div>',
    question.assetUrl ? '<img src="' + question.assetUrl + '" alt="Question crop" style="width:100%;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);background:#fff;">' : '<div style="height:180px;border:1px dashed var(--border-subtle);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);">No crop</div>',
    page && page.assetUrl ? '<div style="margin-top:var(--space-sm);font-size:var(--font-xs);color:var(--text-tertiary);">Sayfa ' + page.pageNumber + '</div><img src="' + page.assetUrl + '" alt="Page preview" style="width:100%;margin-top:6px;border-radius:var(--radius-sm);opacity:.92;">' : '',
    '</div>',
    '<div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);margin-bottom:var(--space-sm);">' + escapeHtml(question.sectionName || question.sectionCode || 'Main') + ' · ' + escapeHtml(question.detectedText || '') + ' · guven: ' + escapeHtml(String(question.confidenceScore || '')) + '</div>',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-sm);">',
    '<div class="form-group"><label class="form-label">Bolum</label><select class="form-select review-section-code" data-temp-id="' + question.tempId + '">' + renderSectionOptions(question.sectionCode, sections) + '</select></div>',
    '<div class="form-group"><label class="form-label">Bolum Soru No</label><input class="form-input review-question-number" data-temp-id="' + question.tempId + '" type="number" min="1" value="' + escapeHtml(question.sectionQuestionNumber || question.questionNumber || '') + '"></div>',
    '<div class="form-group"><label class="form-label">Global Sira</label><input class="form-input review-global-order" data-temp-id="' + question.tempId + '" type="number" min="1" value="' + escapeHtml(question.globalQuestionOrder || '') + '"></div>',
    '<div class="form-group"><label class="form-label">Cevap</label><select class="form-select review-correct-answer" data-temp-id="' + question.tempId + '">' + renderAnswerOptions(question.correctAnswer) + '</select></div>',
    '<div class="form-group"><label class="form-label">X</label><input class="form-input review-crop-x" data-temp-id="' + question.tempId + '" type="number" min="0" value="' + escapeHtml(question.crop.x) + '"></div>',
    '<div class="form-group"><label class="form-label">Y</label><input class="form-input review-crop-y" data-temp-id="' + question.tempId + '" type="number" min="0" value="' + escapeHtml(question.crop.y) + '"></div>',
    '<div class="form-group"><label class="form-label">W</label><input class="form-input review-crop-width" data-temp-id="' + question.tempId + '" type="number" min="1" value="' + escapeHtml(question.crop.width) + '"></div>',
    '<div class="form-group"><label class="form-label">H</label><input class="form-input review-crop-height" data-temp-id="' + question.tempId + '" type="number" min="1" value="' + escapeHtml(question.crop.height) + '"></div>',
    '</div>',
    '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-sm);flex-wrap:wrap;">',
    '<button class="btn btn-secondary review-save-btn" data-temp-id="' + question.tempId + '">Kaydet</button>',
    '<button class="btn btn-danger review-delete-btn" data-temp-id="' + question.tempId + '">Sil</button>',
    '</div>',
    '</div>',
    '</div>',
    '</div>',
  ].join('');
}

function bindReviewEvents(container, review) {
  const root = container.querySelector('#booklet-review-root');

  root.querySelector('#booklet-apply-answer-key').addEventListener('click', async () => {
    try {
      const data = await applyBookletAnswerKey(review.testId, root.querySelector('#booklet-answer-key').value);
      showToast({ title: 'Cevaplar eslesti', message: data.matchedCount + ' soru guncellendi.', type: 'success' });
      root.innerHTML = renderReview(data.review);
      bindReviewEvents(container, data.review);
    } catch (error) {
      showToast({ title: 'Esleme hatasi', message: error.message, type: 'error' });
    }
  });

  root.querySelector('#booklet-finalize-btn').addEventListener('click', async () => {
    try {
      const data = await finalizeBookletTest(review.testId);
      showToast({ title: 'Kaydedildi', message: data.savedCount + ' soru kalici olarak kaydedildi.', type: 'success' });
      await loadReview(container, review.testId);
    } catch (error) {
      showToast({ title: 'Finalize hatasi', message: error.message, type: 'error' });
    }
  });

  root.querySelector('#booklet-auto-tag-btn').addEventListener('click', async () => {
    if (!confirm('Finalize edilen tum etiketsiz booklet sorulari secilen sinav turune gore (TYT/AYT/YDT) MEB/YKS konu listesinden taglenecek. Devam edilsin mi?')) return;
    const button = root.querySelector('#booklet-auto-tag-btn');
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Tagleniyor...';

    try {
      if (review.status !== 'finalized') {
        await finalizeBookletTest(review.testId);
      }
      let totalUpdated = 0;
      let totalSkipped = 0;
      let analyzed = 0;
      let hasMore = true;
      const maxRounds = 40;
      let stalledRounds = 0;

      for (let round = 1; round <= maxRounds && hasMore; round++) {
        button.textContent = 'Tagleniyor... ' + totalUpdated + ' kayit';
        const result = await autoTagBookletTest(review.testId, {
          limit: 10,
          batchSize: 1,
          overwrite: false,
        });
        analyzed += result.analyzed || 0;
        totalUpdated += result.updated || 0;
        totalSkipped += result.skipped || 0;
        hasMore = Boolean(result.hasMore);
        if (!result.updated && !result.analyzed) break;
        stalledRounds = result.updated ? 0 : stalledRounds + 1;
        if (stalledRounds >= 3) break;
        if (hasMore) await wait(1200);
      }

      const finalQuestions = await getFinalBookletQuestions(review.testId);
      const remaining = finalQuestions.filter(question => !question.lesson && !question.topicName).length;
      showToast({
        title: remaining ? 'Gemini tagleme kismi tamamlandi' : 'Gemini tagleme tamamlandi',
        message: totalUpdated + ' soru taglendi, ' + totalSkipped + ' sonuc atlandi, ' + remaining + ' soru bos kaldi.',
        type: totalUpdated && !remaining ? 'success' : 'warning',
      });
      await loadReview(container, review.testId);
      button.disabled = false;
      button.textContent = oldText;
    } catch (error) {
      showToast({ title: 'Gemini tagleme hatasi', message: error.message, type: 'error' });
      button.disabled = false;
      button.textContent = oldText;
    }
  });

  root.querySelector('#manual-add-btn').addEventListener('click', async () => {
    try {
      const updated = await createBookletReviewQuestion(review.testId, {
        sectionCode: root.querySelector('#manual-section-code').value,
        sectionQuestionNumber: Number(root.querySelector('#manual-question-number').value || 0) || null,
        pageNumber: Number(root.querySelector('#manual-page-number').value),
        crop: {
          x: Number(root.querySelector('#manual-crop-x').value || 0),
          y: Number(root.querySelector('#manual-crop-y').value || 0),
          width: Number(root.querySelector('#manual-crop-width').value || 1),
          height: Number(root.querySelector('#manual-crop-height').value || 1),
        },
      });
      showToast({ title: 'Manuel soru eklendi', message: 'Review listesi guncellendi.', type: 'success' });
      root.innerHTML = renderReview(updated);
      bindReviewEvents(container, updated);
    } catch (error) {
      showToast({ title: 'Ekleme hatasi', message: error.message, type: 'error' });
    }
  });

  root.querySelectorAll('.review-save-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const tempId = button.dataset.tempId;
      try {
        const updated = await updateBookletReviewQuestion(review.testId, tempId, {
          sectionCode: root.querySelector('.review-section-code[data-temp-id="' + tempId + '"]').value,
          sectionQuestionNumber: Number(root.querySelector('.review-question-number[data-temp-id="' + tempId + '"]').value || 0) || null,
          globalQuestionOrder: Number(root.querySelector('.review-global-order[data-temp-id="' + tempId + '"]').value || 0) || null,
          correctAnswer: root.querySelector('.review-correct-answer[data-temp-id="' + tempId + '"]').value,
          crop: {
            x: Number(root.querySelector('.review-crop-x[data-temp-id="' + tempId + '"]').value || 0),
            y: Number(root.querySelector('.review-crop-y[data-temp-id="' + tempId + '"]').value || 0),
            width: Number(root.querySelector('.review-crop-width[data-temp-id="' + tempId + '"]').value || 1),
            height: Number(root.querySelector('.review-crop-height[data-temp-id="' + tempId + '"]').value || 1),
          },
        });
        showToast({ title: 'Guncellendi', message: 'Crop ve numara kaydedildi.', type: 'success' });
        root.innerHTML = renderReview(updated);
        bindReviewEvents(container, updated);
      } catch (error) {
        showToast({ title: 'Kaydetme hatasi', message: error.message, type: 'error' });
      }
    });
  });

  root.querySelectorAll('.review-delete-btn').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        const updated = await deleteBookletReviewQuestion(review.testId, button.dataset.tempId);
        showToast({ title: 'Silindi', message: 'Crop review listesinden kaldirildi.', type: 'info' });
        root.innerHTML = renderReview(updated);
        bindReviewEvents(container, updated);
      } catch (error) {
        showToast({ title: 'Silme hatasi', message: error.message, type: 'error' });
      }
    });
  });
}

function renderFinalQuestions(questions) {
  const taggedCount = questions.filter(question => question.lesson || question.topicName).length;
  return [
    '<div class="card" style="padding:var(--space-md);">',
    '<div style="display:flex;justify-content:space-between;gap:var(--space-sm);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-sm);">',
    '<div style="font-weight:700;">Kalici Kayit / Tagler</div>',
    '<div style="font-size:var(--font-xs);color:var(--text-tertiary);">' + taggedCount + ' / ' + questions.length + ' tagli</div>',
    '</div>',
    questions.length ? [
      '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Soru</th><th>Cevap</th><th>Ders</th><th>Konu</th><th>Guven</th><th>Zorluk</th><th>Dosya</th><th></th></tr></thead><tbody>',
      questions.map(question => [
        '<tr>',
        '<td><strong>' + escapeHtml(question.sectionName || question.sectionCode || 'Main') + ' ' + escapeHtml(question.sectionQuestionNumber || '') + '</strong><div style="font-size:var(--font-xs);color:var(--text-tertiary);">global ' + escapeHtml(question.globalQuestionOrder || '') + '</div></td>',
        '<td>' + (question.correctAnswer ? '<strong>' + escapeHtml(question.correctAnswer) + '</strong>' : '<span style="color:var(--color-warning);font-weight:650;">Cevap yok</span>') + '</td>',
        '<td>' + escapeHtml(question.lesson || '-') + '</td>',
        '<td>' + escapeHtml(question.topicName || '-') + '</td>',
        '<td>' + escapeHtml(question.topicConfidence ? Math.round(question.topicConfidence * 100) + '%' : '-') + '</td>',
        '<td>' + escapeHtml(question.difficulty || '-') + '</td>',
        '<td><code style="font-size:11px;">' + escapeHtml(question.imagePath) + '</code></td>',
        '<td><button class="btn btn-danger btn-sm final-question-delete-btn" data-question-id="' + question.id + '">Sil</button></td>',
        '</tr>',
      ].join('')).join(''),
      '</tbody></table></div>',
    ].join('') : '<div style="color:var(--text-tertiary);">Kalici soru yok.</div>',
    '</div>',
  ].join('');
}

async function refreshFinalQuestions(root, testId) {
  const target = root.querySelector('#booklet-final-root');
  if (!target) return;
  try {
    const finalQuestions = await getFinalBookletQuestions(testId);
    target.innerHTML = renderFinalQuestions(finalQuestions);
    bindFinalQuestionEvents(root, testId);
  } catch (error) {
    target.innerHTML = '<div class="card" style="padding:var(--space-md);color:var(--color-danger);">' + escapeHtml(error.message) + '</div>';
  }
}

function bindFinalQuestionEvents(root, testId) {
  root.querySelectorAll('.final-question-delete-btn').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm('Bu kalici soruyu silmek istiyor musunuz?')) return;
      try {
        await deleteFinalBookletQuestion(testId, button.dataset.questionId);
        showToast({ title: 'Soru silindi', message: 'Kalici soru kaydi kaldirildi.', type: 'info' });
        await refreshFinalQuestions(root, testId);
      } catch (error) {
        showToast({ title: 'Silme hatasi', message: error.message, type: 'error' });
      }
    });
  });
}

function renderSectionOptions(selectedCode, sections) {
  return (sections || []).map(section => (
    '<option value="' + escapeHtml(section.sectionCode) + '"' + (section.sectionCode === selectedCode ? ' selected' : '') + '>' + escapeHtml(section.sectionName) + '</option>'
  )).join('');
}

function formatAnswerKey(answerKey, sections) {
  if (!answerKey || typeof answerKey !== 'object') return '';

  const orderedSections = new Map((sections || []).map(section => [section.sectionCode, section]));
  const lines = [];

  for (const [sectionCode, values] of Object.entries(answerKey)) {
    if (!values || typeof values !== 'object') continue;
    const entries = Object.entries(values)
      .map(([number, answer]) => [Number(number), String(answer || '').toUpperCase()])
      .filter(([number, answer]) => number > 0 && ['A', 'B', 'C', 'D', 'E'].includes(answer))
      .sort((left, right) => left[0] - right[0]);

    if (sectionCode === '__global__') {
      for (const [number, answer] of entries) {
        lines.push(number + ': ' + answer);
      }
      continue;
    }

    const prefix = orderedSections.get(sectionCode)?.sectionCode || sectionCode;
    for (const [number, answer] of entries) {
      lines.push(prefix + ' ' + number + ': ' + answer);
    }
  }

  return lines.join('\n');
}

function renderAnswerOptions(selected) {
  return [''].concat(['A', 'B', 'C', 'D', 'E']).map(option => {
    const label = option || '-';
    return '<option value="' + option + '"' + (option === selected ? ' selected' : '') + '>' + label + '</option>';
  }).join('');
}

function stat(label, value) {
  return '<div class="stat-card"><div class="stat-value">' + escapeHtml(value || 0) + '</div><div class="stat-label">' + label + '</div></div>';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Dosya okunamadi.'));
    reader.readAsDataURL(file);
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
