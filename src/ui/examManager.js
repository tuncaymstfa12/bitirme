import { store } from '../data/store.js';
import { t } from '../data/i18n.js';
import { createExam, createTopic, createMockResult } from '../data/models.js';
import { showModal, closeModal, showToast, formatDate, daysUntil, renderStars } from './components.js';
import { getTopicsForLesson, getLessonsForTrack, CURRICULUM, EXAM_STRUCTURE, calcNet } from '../data/curriculum.js';

export function renderExamManager(container) {
  var exams = store.getExams();
  var topics = store.getTopics();

  container.innerHTML = [
    '<div class="page-header"><h2>🎓 '+t('exams.title')+'</h2><p>'+t('exams.subtitle')+'</p></div>',
    '<div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-xl);">',
    '<button class="btn btn-primary btn-lg" id="add-exam-btn">'+t('exams.addExam')+'</button>',
    '<button class="btn btn-secondary btn-lg" id="add-mock-btn">📝 '+t('exams.addMock')+'</button>',
    '</div>',
    exams.length===0
      ? '<div class="card"><div class="empty-state"><div class="empty-icon">🎓</div><h3>'+t('exams.noExams')+'</h3><p>'+t('exams.noExamsDesc')+'</p><button class="btn btn-primary" id="add-exam-btn-empty">'+t('exams.addFirstExam')+'</button></div></div>'
      : exams.map(function(ex,i){
          var ext = topics.filter(function(t){return t.examId===ex.id;});
          var d = daysUntil(ex.date);
          return '<div class="exam-card animate-fade-in-up" style="margin-bottom:var(--space-lg);animation-delay:'+(0.1*i)+'s">'+
            '<div class="exam-card-header"><div class="exam-info"><span class="exam-color-lg" style="background:'+ex.color+'"></span><div><div class="exam-name">'+ex.name+'</div><div class="exam-date">'+formatDate(ex.date)+' · '+(d>=0?d+' '+t('dashboard.daysLeft'):t('exams.past'))+'</div></div></div>'+
            '<div style="display:flex;gap:var(--space-xs);"><button class="btn btn-sm btn-secondary add-topic-btn" data-exam-id="'+ex.id+'">'+t('exams.addTopic')+'</button><button class="btn btn-sm btn-secondary edit-exam-btn" data-exam-id="'+ex.id+'">✎</button><button class="btn btn-sm btn-danger delete-exam-btn" data-exam-id="'+ex.id+'">🗑</button></div></div>'+
            '<div class="exam-card-body">'+
            (ext.length===0
              ?'<p style="color:var(--text-tertiary);font-size:var(--font-sm);padding:var(--space-sm);">'+t('exams.noTopics')+'</p>'
              :ext.map(function(tp){
                  var mr=store.getMockResults(tp.id);
                  return '<div class="topic-item"><span class="exam-color" style="background:'+ex.color+'"></span>'+
                    '<div class="topic-main"><div class="topic-name">'+tp.name+(tp.examType?' <small style="color:var(--text-tertiary);">('+tp.examType+(tp.lesson?' — '+tp.lesson:'')+')</small>':'')+'</div>'+
                    '<div class="topic-meta"><span>'+t('exams.weight')+': '+tp.weight+'/10</span><span>'+t('exams.self')+': '+renderStars(tp.selfAssessment)+'</span><span>'+t('exams.est')+': '+tp.estimatedMinutes+t('exams.min')+'</span>'+(mr.length?'<span>'+t('exams.tests')+': '+mr.length+'</span>':'')+'</div></div>'+
                    '<div class="topic-actions"><button class="btn btn-sm btn-secondary edit-topic-btn" data-topic-id="'+tp.id+'" data-exam-id="'+ex.id+'">✎</button><button class="btn btn-sm btn-danger delete-topic-btn" data-topic-id="'+tp.id+'">🗑</button></div></div>';
                }).join(''))+
            '</div></div>';
        }).join('')
  ].join('');

  bindEvents(container);
}

function bindEvents(container) {
  var ah = function(){showExamForm();};
  var b = container.querySelector('#add-exam-btn'); if(b)b.addEventListener('click',ah);
  var be = container.querySelector('#add-exam-btn-empty'); if(be)be.addEventListener('click',ah);
  var mb = container.querySelector('#add-mock-btn'); if(mb)mb.addEventListener('click',function(){showMockResultForm();});

  container.querySelectorAll('.add-topic-btn').forEach(function(btn){
    btn.addEventListener('click',function(){showTopicForm(btn.dataset.examId);});
  });
  container.querySelectorAll('.edit-exam-btn').forEach(function(btn){
    btn.addEventListener('click',function(){var ex=store.getExam(btn.dataset.examId);if(ex)showExamForm(ex);});
  });
  container.querySelectorAll('.delete-exam-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var ex=store.getExam(btn.dataset.examId);
      if(ex&&confirm(t('exams.confirmDelete',{name:ex.name}))){store.deleteExam(ex.id);showToast({title:t('exams.examDeleted'),message:t('exams.examDeletedMsg',{name:ex.name}),type:'info'});renderExamManager(container);}
    });
  });
  container.querySelectorAll('.edit-topic-btn').forEach(function(btn){
    btn.addEventListener('click',function(){var tp=store.getTopic(btn.dataset.topicId);if(tp)showTopicForm(btn.dataset.examId,tp);});
  });
  container.querySelectorAll('.delete-topic-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var tp=store.getTopic(btn.dataset.topicId);
      if(tp&&confirm(t('exams.confirmDeleteTopic',{name:tp.name}))){store.deleteTopic(tp.id);showToast({title:t('exams.topicDeleted'),message:t('exams.topicDeletedMsg',{name:tp.name}),type:'info'});renderExamManager(container);}
    });
  });
}

function showExamForm(existing){
  var isEdit=!!existing;
  var dd=new Date();dd.setDate(dd.getDate()+14);var ds=dd.toISOString().split('T')[0];
  var ov=showModal({
    title:isEdit?t('exams.editExam'):t('exams.addNewExam'),
    content:'<div class="form-group"><label class="form-label">'+t('exams.examName')+'</label><input type="text" class="form-input" id="exam-name" value="'+(isEdit?existing.name:'')+'" placeholder="'+t('exams.examNamePlaceholder')+'"></div><div class="form-group"><label class="form-label">'+t('exams.examDate')+'</label><input type="date" class="form-input" id="exam-date" value="'+(isEdit?existing.date:ds)+'"></div>',
    footer:'<button class="btn btn-secondary" id="modal-cancel">'+t('exams.cancel')+'</button><button class="btn btn-primary" id="modal-save">'+(isEdit?t('exams.update'):t('exams.add'))+'</button>'
  });
  ov.querySelector('#modal-cancel').addEventListener('click',closeModal);
  ov.querySelector('#modal-save').addEventListener('click',function(){
    var n=ov.querySelector('#exam-name').value.trim();
    var d=ov.querySelector('#exam-date').value;
    if(!n){showToast({title:t('exams.validationName'),message:t('exams.enterExamName'),type:'error'});return;}
    if(!d){showToast({title:t('exams.validationName'),message:t('exams.selectDate'),type:'error'});return;}
    if(isEdit){store.updateExam(existing.id,{name:n,date:d});showToast({title:t('exams.examUpdated'),message:t('exams.examUpdatedMsg',{name:n}),type:'success'});}
    else{var e=createExam({name:n,date:d});store.addExam(e);showToast({title:t('exams.examAdded'),message:t('exams.examAddedMsg',{name:n}),type:'success'});}
    closeModal();var c=document.getElementById('main-content');if(c)renderExamManager(c);
  });
}

function showTopicForm(examId,existing){
  var isEdit=!!existing;
  var et=(existing&&existing.examType)||'TYT';
  var tr=(existing&&existing.track)||'sayisal';
  var ls=getLessonsForTrack(et,tr);
  var ln=(existing&&existing.lesson)||ls[0];
  var tn=(existing&&existing.name)||'';
  var allTopics=[];
  ls.forEach(function(l){getTopicsForLesson(et,tr,l).forEach(function(t){allTopics.push(t);});});

  function build(){
    return [
      '<div class="form-group"><label class="form-label">Sınav Türü</label><select class="form-select" id="t-et"><option value="TYT"'+(et==='TYT'?' selected':'')+'>TYT</option><option value="AYT"'+(et==='AYT'?' selected':'')+'>AYT</option></select></div>',
      '<div class="form-group"><label class="form-label">Alan</label><select class="form-select" id="t-tr"><option value="sayisal"'+(tr==='sayisal'?' selected':'')+'>Sayısal</option><option value="esit_agirlik"'+(tr==='esit_agirlik'?' selected':'')+'>EA</option><option value="sozel"'+(tr==='sozel'?' selected':'')+'>Sözel</option><option value="dil"'+(tr==='dil'?' selected':'')+'>Dil</option></select></div>',
      '<div class="form-group"><label class="form-label">Ders</label><select class="form-select" id="t-ln">'+ls.map(function(l){return '<option value="'+l+'"'+(l===ln?' selected':'')+'>'+l+'</option>';}).join('')+'</select></div>',
      '<div class="form-group"><label class="form-label">Konu (yazarak ara)</label><input type="text" class="form-input" id="t-srch" placeholder="Konu ara..." value="'+tn+'" autocomplete="off"><select class="form-select" id="t-sel" size="6" style="margin-top:4px;">'+allTopics.map(function(t){return '<option value="'+t+'"'+(t===tn?' selected':'')+'>'+t+'</option>';}).join('')+'</select></div>',
      '<div class="form-group"><label class="form-label">'+t('exams.topicWeight')+' — <span id="t-wl">'+(existing?existing.weight:5)+'/10</span></label><input type="range" class="form-slider" id="t-wt" min="1" max="10" value="'+(existing?existing.weight:5)+'"></div>',
      '<div class="form-group"><label class="form-label">'+t('exams.selfAssessment')+'</label><div style="display:flex;gap:var(--space-sm);margin-top:var(--space-xs);">'+[1,2,3,4,5].map(function(i){return '<label style="cursor:pointer;font-size:28px;color:'+(i<=(existing?existing.selfAssessment:3)?'#fbbf24':'#3a3a5c')+'" class="star-btn" data-value="'+i+'">★</label>';}).join('')+'</div><input type="hidden" id="t-sa" value="'+(existing?existing.selfAssessment:3)+'"></div>',
      '<div class="form-group"><label class="form-label">'+t('exams.estimatedTime')+'</label><input type="number" class="form-input" id="t-etm" value="'+(existing?existing.estimatedMinutes:60)+'" min="30" step="15"></div>'
    ].join('');
  }

  var ov=showModal({
    title:isEdit?t('exams.editTopic'):t('exams.addTopicTitle'),
    content:'<div id="tf-inner">'+build()+'</div>',
    footer:'<button class="btn btn-secondary" id="modal-cancel">'+t('exams.cancel')+'</button><button class="btn btn-primary" id="modal-save">'+(isEdit?t('exams.updateTopic'):t('exams.addTopicBtn'))+'</button>'
  });

  function refresh(){
    et=ov.querySelector('#t-et').value;tr=ov.querySelector('#t-tr').value;
    ls=getLessonsForTrack(et,tr);ln=ls[0];
    ov.querySelector('#t-ln').innerHTML=ls.map(function(l){return '<option value="'+l+'">'+l+'</option>';}).join('');
    allTopics=[];ls.forEach(function(l){getTopicsForLesson(et,tr,l).forEach(function(t){allTopics.push(t);});});
    var tp=getTopicsForLesson(et,tr,ln);
    ov.querySelector('#t-sel').innerHTML=tp.map(function(t){return '<option value="'+t+'">'+t+'</option>';}).join('');
  }

  ov.querySelector('#t-srch').addEventListener('input',function(){
    var q=this.value.toLowerCase();
    ov.querySelector('#t-sel').innerHTML=allTopics.filter(function(t){return t.toLowerCase().includes(q);}).map(function(t){return '<option value="'+t+'">'+t+'</option>';}).join('');
  });
  ov.querySelector('#t-sel').addEventListener('change',function(){ov.querySelector('#t-srch').value=this.value;});
  ov.querySelector('#t-et').addEventListener('change',refresh);
  ov.querySelector('#t-tr').addEventListener('change',refresh);
  ov.querySelector('#t-ln').addEventListener('change',function(){ln=this.value;var tp=getTopicsForLesson(et,tr,ln);ov.querySelector('#t-sel').innerHTML=tp.map(function(t){return '<option value="'+t+'">'+t+'</option>';}).join('');});
  ov.querySelector('#t-wt').addEventListener('input',function(){ov.querySelector('#t-wl').textContent=this.value+'/10';});
  ov.querySelectorAll('.star-btn').forEach(function(s){s.addEventListener('click',function(){var v=parseInt(s.dataset.value);ov.querySelector('#t-sa').value=v;ov.querySelectorAll('.star-btn').forEach(function(x){x.style.color=parseInt(x.dataset.value)<=v?'#fbbf24':'#3a3a5c';});});});

  ov.querySelector('#modal-cancel').addEventListener('click',closeModal);
  ov.querySelector('#modal-save').addEventListener('click',function(){
    var n=ov.querySelector('#t-srch').value.trim();
    if(!n){showToast({title:t('exams.validationName'),message:t('exams.enterTopicName'),type:'error'});return;}
    var w=parseInt(ov.querySelector('#t-wt').value),sa=parseInt(ov.querySelector('#t-sa').value),em=parseInt(ov.querySelector('#t-etm').value);
    var xt=ov.querySelector('#t-et').value,xr=ov.querySelector('#t-tr').value,xl=ov.querySelector('#t-ln').value;
    if(isEdit){store.updateTopic(existing.id,{name:n,weight:w,selfAssessment:sa,estimatedMinutes:em,examType:xt,track:xr,lesson:xl});showToast({title:t('exams.topicUpdated'),message:t('exams.topicUpdatedMsg',{name:n}),type:'success'});}
    else{var tp=createTopic({examId:examId,name:n,weight:w,selfAssessment:sa,estimatedMinutes:em});tp.examType=xt;tp.track=xr;tp.lesson=xl;store.addTopic(tp);showToast({title:t('exams.topicAdded'),message:t('exams.topicAddedMsg',{name:n}),type:'success'});}
    closeModal();var c=document.getElementById('main-content');if(c)renderExamManager(c);
  });
}

function showMockResultForm(){
  var exType='TYT', lang='İngilizce';

  function buildTable(){
    var str = exType==='TYT' ? EXAM_STRUCTURE.TYT : (EXAM_STRUCTURE.AYT[exType] || EXAM_STRUCTURE.AYT.sayisal);
    var rows='', langSel='';
    if(exType==='dil'){
      langSel = '<div class="form-group"><label class="form-label">Dil</label><select class="form-select" id="mock-lang">' +
        (EXAM_STRUCTURE.AYT.dil.languages||['İngilizce']).map(function(l){
          return '<option value="'+l+'"'+(l===lang?' selected':'')+'>'+l+'</option>';
        }).join('') + '</select></div>';
    }
    str.lessons.forEach(function(l,i){
      var name = exType==='dil' ? lang : l.name;
      rows += '<tr><td style="font-weight:600;">'+name+'</td>'+
        '<td style="text-align:center;color:var(--text-secondary);">'+l.questions+' soru</td>'+
        '<td><input type="number" class="form-input mock-correct" data-idx="'+i+'" min="0" max="'+l.questions+'" value="0" style="width:70px;text-align:center;"></td>'+
        '<td><input type="number" class="form-input mock-wrong" data-idx="'+i+'" min="0" max="'+l.questions+'" value="0" style="width:70px;text-align:center;"></td>'+
        '<td style="text-align:center;font-weight:700;" class="mock-net" data-idx="'+i+'">0.00</td>'+
        '<td style="text-align:center;font-size:var(--font-xs);" class="mock-pct" data-idx="'+i+'">%0</td></tr>';
    });
    return langSel +
      '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Ders</th><th>Soru</th><th>Doğru</th><th>Yanlış</th><th>Net</th><th>%</th></tr></thead><tbody id="mock-rows">'+rows+'</tbody></table></div>'+
      '<div style="margin-top:var(--space-md);text-align:right;font-weight:700;">Toplam Net: <span id="mock-total-net">0.00</span></div>'+
      '<small style="color:var(--text-tertiary);">* 4 yanlış 1 doğruyu götürür</small>';
  }

  var ov=showModal({
    title:'📝 Deneme Sınav Sonucu Ekle',
    content:
      '<div class="form-group"><label class="form-label">Deneme Türü</label><select class="form-select" id="mock-type">'+
      '<option value="TYT"'+(exType==='TYT'?' selected':'')+'>TYT (120 soru)</option>'+
      '<option value="sayisal"'+(exType==='sayisal'?' selected':'')+'>AYT Sayısal (80 soru)</option>'+
      '<option value="esit_agirlik"'+(exType==='esit_agirlik'?' selected':'')+'>AYT EA (80 soru)</option>'+
      '<option value="sozel"'+(exType==='sozel'?' selected':'')+'>AYT Sözel (80 soru)</option>'+
      '<option value="dil"'+(exType==='dil'?' selected':'')+'>YDT Dil (80 soru)</option>'+
      '</select></div>'+
      '<div class="form-group"><label class="form-label">Tarih</label><input type="date" class="form-input" id="mock-date" value="'+new Date().toISOString().split('T')[0]+'"></div>'+
      '<div id="mock-table">'+buildTable()+'</div>',
    footer:'<button class="btn btn-secondary" id="modal-cancel">'+t('exams.cancel')+'</button><button class="btn btn-primary" id="modal-save">Sonucu Kaydet</button>'
  });

  function rebindCalc(){
    ov.querySelectorAll('.mock-correct,.mock-wrong').forEach(function(inp){
      inp.addEventListener('input',function(){
        var idx=this.dataset.idx;
        var c=parseInt((ov.querySelector('.mock-correct[data-idx="'+idx+'"]')||{}).value)||0;
        var w=parseInt((ov.querySelector('.mock-wrong[data-idx="'+idx+'"]')||{}).value)||0;
        var net=calcNet(c,w);
        var str=exType==='TYT'?EXAM_STRUCTURE.TYT:(EXAM_STRUCTURE.AYT[exType]||EXAM_STRUCTURE.AYT.sayisal);
        var qs=str.lessons[idx].questions;
        var pct=qs>0?Math.round((net/qs)*100):0;
        var nc=ov.querySelector('.mock-net[data-idx="'+idx+'"]');
        if(nc)nc.textContent=net.toFixed(2);
        var pc=ov.querySelector('.mock-pct[data-idx="'+idx+'"]');
        if(pc)pc.textContent='%'+pct;
        var totalNet=0; str.lessons.forEach(function(_,i){
          var ci=parseInt((ov.querySelector('.mock-correct[data-idx="'+i+'"]')||{}).value)||0;
          var wi=parseInt((ov.querySelector('.mock-wrong[data-idx="'+i+'"]')||{}).value)||0;
          totalNet+=calcNet(ci,wi);
        });
        var tn=ov.querySelector('#mock-total-net'); if(tn)tn.textContent=totalNet.toFixed(2);
      });
    });
  }
  rebindCalc();

  // Event delegation — survives rebuilds
  ov.addEventListener('change',function(e){
    if(e.target.id==='mock-type'){ exType=e.target.value; ov.querySelector('#mock-table').innerHTML=buildTable(); rebindCalc(); }
    if(e.target.id==='mock-lang'){ lang=e.target.value; ov.querySelector('#mock-table').innerHTML=buildTable(); rebindCalc(); }
  });

  ov.querySelector('#modal-cancel').addEventListener('click',closeModal);
  ov.querySelector('#modal-save').addEventListener('click',function(){
    var date=ov.querySelector('#mock-date').value;
    var str=exType==='TYT'?EXAM_STRUCTURE.TYT:(EXAM_STRUCTURE.AYT[exType]||EXAM_STRUCTURE.AYT.sayisal);
    var saved=0, totalNet=0, totalQ=0;
    var rows=[];
    str.lessons.forEach(function(l,i){
      var c=parseInt((ov.querySelector('.mock-correct[data-idx="'+i+'"]')||{}).value)||0;
      var w=parseInt((ov.querySelector('.mock-wrong[data-idx="'+i+'"]')||{}).value)||0;
      if(c===0&&w===0)return;
      var net=calcNet(c,w);
      var pct=l.questions>0?Math.round((net/l.questions)*100):0;
      totalNet+=net; totalQ+=l.questions;
      rows.push({lesson:exType==='dil'?lang:l.name,correct:c,wrong:w,net:net,total:l.questions,pct:pct});
      saved++;
    });
    var overallNet = calcNet(rows.reduce(function(s,r){return s+r.correct;},0),rows.reduce(function(s,r){return s+r.wrong;},0));
    var overallPct = totalQ>0 ? Math.round((overallNet/totalQ)*100) : 0;
    showToast({title:'Deneme Kaydedildi',message:saved+' ders · Net: '+totalNet.toFixed(2)+'/'+totalQ+' (%'+overallPct+') — '+getNetLabel(overallPct),type:'success'});
    closeModal(); var c=document.getElementById('main-content'); if(c)renderExamManager(c);
  });
}

function getNetLabel(pct){if(pct>=90)return'Çok İyi';if(pct>=80)return'İyi';if(pct>=60)return'Orta';if(pct>=40)return'Zayıf';return'Çok Zayıf';}
