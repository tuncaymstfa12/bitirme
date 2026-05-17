import { store } from '../data/store.js';
import { t } from '../data/i18n.js';
import { fullReschedule, handleMissedSessions } from '../engine/rescheduler.js';
import { showToast, formatTime, formatDate, showModal, closeModal, formatLocalDate } from './components.js';

let currentWeekStart = getMonday(new Date());

function getMonday(d) {
  d = new Date(d); var day = d.getDay();
  d.setDate(d.getDate()-day+(day===0?-6:1)); d.setHours(0,0,0,0); return d;
}
function isTimePassed(dateStr, hour, minute) {
  var p=dateStr.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]),hour,minute) < new Date();
}

export function renderScheduleView(container) {
  var sessions=store.getSessions(), exams=store.getExams(), topics=store.getTopics();
  var todayStr=formatLocalDate(new Date()), autoMissed=0;

  sessions.forEach(function(s){
    if(s.status==='scheduled'&&s.startHour!=null){
      var p=s.date.split('-');
      var sessionDate=new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
      var now=new Date();
      now.setHours(0,0,0,0);
      if(sessionDate<now&&isTimePassed(s.date,s.startHour,s.startMinute)){
        s.status='missed'; s.autoMissed=true; autoMissed++;
      }
    }
  });

  var missedCount=sessions.filter(function(s){return s.status==='missed';}).length;
  var scheduledCount=sessions.filter(function(s){return s.status==='scheduled';}).length;
  var dayNames=t('schedule.dayNames'), days=[];
  for(var i=0;i<7;i++){var d=new Date(currentWeekStart);d.setDate(d.getDate()+i);days.push(d);}

  container.innerHTML=[
    '<div class="page-header"><h2>📅 '+t('schedule.title')+'</h2><p>'+t('schedule.subtitle')+'</p></div>',
    '<div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-lg);flex-wrap:wrap;align-items:center;">',
    '<button class="btn btn-primary btn-lg" id="generate-plan-btn">'+t('schedule.generatePlan')+'</button>',
    missedCount>0?'<button class="btn btn-secondary btn-lg" id="reschedule-btn">'+t('schedule.reschedule')+'</button>':'',
    scheduledCount>0?'<button class="btn btn-danger btn-lg" id="clear-plan-btn">'+t('schedule.clear')+'</button>':'',
    autoMissed>0?'<span style="color:var(--color-warning);font-size:var(--font-sm);">⚠ '+autoMissed+' oturum zamanı geçtiği için kaçırıldı</span>':'',
    '</div>',
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);">',
    '<button class="btn btn-secondary" id="prev-week-btn">'+t('schedule.prev')+'</button>',
    '<h3 style="font-size:var(--font-md);font-weight:600;">'+formatDate(days[0].toISOString())+' — '+formatDate(days[6].toISOString())+'</h3>',
    '<button class="btn btn-secondary" id="next-week-btn">'+t('schedule.next')+'</button>',
    '</div>',
    '<div class="week-view animate-fade-in-up">'+days.map(function(day){return renderDayColumn(day,sessions,exams,topics,todayStr,dayNames);}).join('')+'</div>',
    '<div style="display:flex;gap:var(--space-lg);margin-top:var(--space-lg);padding:var(--space-md);justify-content:center;flex-wrap:wrap;">',
    '<span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--accent-primary);"></span> '+t('schedule.scheduled')+'</span>',
    '<span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-success);"></span> '+t('schedule.completedLabel')+'</span>',
    '<span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-danger);"></span> '+t('schedule.missedLabel')+'</span>',
    '<span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-warning);"></span> Otomatik Kaçırıldı</span>',
    '<span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--text-tertiary);"></span> '+t('schedule.breakLabel')+'</span>',
    '</div>'
  ].join('');

  bindScheduleEvents(container);
}

function renderDayColumn(day,sessions,exams,topics,todayStr,dayNames){
  var dateStr=formatLocalDate(day),isToday=dateStr===todayStr;
  var ds=sessions.filter(function(s){return s.date===dateStr;}).sort(function(a,b){return(a.startHour*60+a.startMinute)-(b.startHour*60+b.startMinute);});
  var de=exams.filter(function(e){return e.date===dateStr;});
  return '<div class="day-column"><div class="day-header '+(isToday?'today':'')+'"><div class="day-name">'+dayNames[day.getDay()]+'</div><div class="day-date">'+day.getDate()+'</div>'+de.map(function(e){return'<div style="margin-top:4px;"><span class="tag" style="border-color:'+e.color+';color:'+e.color+';">🎯 '+e.name+'</span></div>';}).join('')+'</div><div class="day-slots">'+(ds.length===0?'<div style="text-align:center;color:var(--text-tertiary);font-size:var(--font-xs);padding:var(--space-lg);">'+t('schedule.noSessions')+'</div>':ds.map(function(s){return renderSession(s,topics,exams);}).join(''))+'</div></div>';
}

function renderSession(s,topics,exams){
  if(s.status==='break')return'<div class="schedule-slot break-slot"><span class="schedule-time">'+formatTime(s.startHour,s.startMinute)+'</span><span class="schedule-topic">'+t('schedule.break')+'</span></div>';
  var topic=s.topicId?topics.find(function(t){return t.id===s.topicId;}):null;
  var exam=topic?exams.find(function(e){return e.id===topic.examId;}):null;
  var isAuto=s.autoMissed,cls=s.status;if(isAuto)cls+=' auto-missed';
  return'<div class="schedule-slot '+cls+'" data-session-id="'+s.id+'" style="'+(isAuto?'border-left:3px solid var(--color-warning);':'')+'"><span class="schedule-time">'+formatTime(s.startHour,s.startMinute)+'</span>'+(exam?'<span class="schedule-exam-dot" style="background:'+exam.color+'"></span>':'')+'<div style="flex:1;"><span class="schedule-topic">'+(topic?topic.name:'?')+'</span>'+(topic&&topic.examType?'<small style="color:var(--text-tertiary);display:block;font-size:10px;">'+topic.examType+(topic.lesson?' — '+topic.lesson:'')+'</small>':'')+'</div><div class="schedule-actions">'+(s.status==='scheduled'?'<button class="btn btn-sm btn-success session-done-btn" data-id="'+s.id+'">✓</button><button class="btn btn-sm btn-danger session-miss-btn" data-id="'+s.id+'">✕</button>':s.status==='completed'?'<span class="tag" style="background:var(--color-success);color:#fff;">✓ Tamamlandı</span><button class="btn btn-sm btn-secondary session-undo-btn" data-id="'+s.id+'" data-to="scheduled">↩</button>':'<span class="tag" style="background:var(--color-danger);color:#fff;">✕'+(isAuto?' Otomatik':'')+' Kaçırıldı</span><button class="btn btn-sm btn-secondary session-undo-btn" data-id="'+s.id+'" data-to="scheduled">↩ Planla</button>')+'</div></div>';
}

function bindScheduleEvents(container){
  var g=container.querySelector('#generate-plan-btn');if(g)g.addEventListener('click',function(){showGenerateModal(container);});
  var r=container.querySelector('#reschedule-btn');if(r)r.addEventListener('click',function(){
    var sess=store.getSessions(),s=store.getSettings();
    var missedIds=sess.filter(function(x){return x.status==='missed';}).map(function(x){return x.id;});
    if(!missedIds.length){showToast({title:t('schedule.notice'),message:'Kaçırılan oturum yok.',type:'info'});return;}
    var completed=sess.filter(function(x){return x.status==='completed';});
    var exams=store.getExams(),topics=store.getTopics(),mocks=store.getMockResults();
    var futureExams=exams.filter(function(e){return new Date(e.date)>=new Date();});
    if(!futureExams.length){showToast({title:'Uyarı',message:'Gelecek sınav yok.',type:'warning'});return;}
    var res=fullReschedule(futureExams,topics,mocks,s.dailyAvailability,s.constraints,s.weights);
    var plannedCount=res.sessions.filter(function(x){return x.status==='scheduled';}).length;
    store.setSessions(completed.concat(res.sessions));
    if(plannedCount>0){
      showToast({title:t('schedule.rescheduled'),message:plannedCount+' oturum yeniden planlandı.',type:'success'});
    } else {
      showToast({title:'Planlanamadı',message:'Kullanılabilir zaman slotu bulunamadı. Ayarlardaki günlük müsaitliği kontrol edin.',type:'warning'});
    }
    if(res.warnings&&res.warnings.length){res.warnings.forEach(function(w){showToast({title:t('schedule.notice'),message:w,type:'warning'});});}
    currentWeekStart=getMonday(new Date());renderScheduleView(container);
  });
  var c=container.querySelector('#clear-plan-btn');if(c)c.addEventListener('click',function(){if(confirm(t('schedule.confirmClear'))){store.clearSessions();renderScheduleView(container);}});
  container.querySelector('#prev-week-btn')?.addEventListener('click',function(){currentWeekStart.setDate(currentWeekStart.getDate()-7);renderScheduleView(container);});
  container.querySelector('#next-week-btn')?.addEventListener('click',function(){currentWeekStart.setDate(currentWeekStart.getDate()+7);renderScheduleView(container);});
  container.querySelectorAll('.session-done-btn').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();store.updateSession(b.dataset.id,{status:'completed',completedAt:new Date().toISOString()});var se=store.getSession(b.dataset.id);if(se){var tp=store.getTopic(se.topicId);if(tp)store.updateTopic(tp.id,{completedMinutes:(tp.completedMinutes||0)+se.durationMinutes});}showToast({title:t('schedule.completed'),message:t('schedule.completedMsg'),type:'success'});renderScheduleView(container);});});
  container.querySelectorAll('.session-miss-btn').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();store.updateSession(b.dataset.id,{status:'missed'});showToast({title:t('dashboard.sessionMissed'),message:t('schedule.missedMsg'),type:'warning'});renderScheduleView(container);});});
  container.querySelectorAll('.session-undo-btn').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();store.updateSession(b.dataset.id,{status:b.dataset.to,autoMissed:false});showToast({title:'Durum güncellendi',message:'Oturum '+(b.dataset.to==='scheduled'?'planlandı':'güncellendi'),type:'info'});renderScheduleView(container);});});
}

function showGenerateModal(container){
  var exams=store.getExams(),topics=store.getTopics(),s=store.getSettings();
  if(!exams.length||!topics.length){showToast({title:t('schedule.noData'),message:t('schedule.noDataMsg'),type:'warning'});return;}
  var today=formatLocalDate(new Date());
  var future=exams.filter(function(e){return new Date(e.date)>=new Date(today);}).sort(function(a,b){return new Date(a.date)-new Date(b.date);});
  if(!future.length){showToast({title:'Uyarı',message:'Gelecek sınav yok.',type:'warning'});return;}
  var latestExam=future[future.length-1].date,c=s.constraints;

  function buildF(){
    return'<div class="form-group"><label class="form-label">Başlangıç</label><input type="date" class="form-input" id="gp-start" value="'+today+'"></div>'+
    '<div class="form-group"><label class="form-label">Bitiş</label><input type="date" class="form-input" id="gp-end" value="'+latestExam+'"></div>'+
    '<div class="grid-2" style="gap:var(--space-md);">'+
    '<div class="form-group"><label class="form-label">Günlük Başlangıç Saati</label><select class="form-select" id="gp-hour-start">'+
    Array.from({length:24},function(_,i){return'<option value="'+i+'"'+(i===8?' selected':'')+'>'+String(i).padStart(2,'0')+':00</option>';}).join('')+
    '</select></div>'+
    '<div class="form-group"><label class="form-label">Günlük Bitiş Saati</label><select class="form-select" id="gp-hour-end">'+
    Array.from({length:24},function(_,i){return'<option value="'+i+'"'+(i===22?' selected':'')+'>'+String(i).padStart(2,'0')+':00</option>';}).join('')+
    '</select></div></div>'+
    '<div class="form-group"><label class="form-label">Günlük Maks. Slot <span id="gp-maxslots-val">'+c.maxDailySlotsCount+'</span> (<span id="gp-hours">'+(c.maxDailySlotsCount*0.5).toFixed(1)+'</span> saat)</label><input type="range" class="form-slider" id="gp-maxslots" min="2" max="24" value="'+c.maxDailySlotsCount+'"></div>'+
    '<div class="form-group"><label class="form-label">Mola Süresi (dakika)</label><input type="number" class="form-input" id="gp-break" min="5" max="60" step="5" value="15"></div>'+
    '<div class="form-group"><label class="form-label">Öncelik Modu</label><select class="form-select" id="gp-mode"><option value="balanced">Dengeli</option><option value="urgent">Acil önce</option><option value="weak">Zayıf konular önce</option></select></div>'+
    '<div class="form-group"><label class="form-label">Sınavlar</label><div style="max-height:150px;overflow-y:auto;">'+future.map(function(e){var et=topics.filter(function(t){return t.examId===e.id;});return'<label class="auth-chip" style="margin:4px;"><input type="checkbox" class="gp-exam" value="'+e.id+'" checked><span style="background:'+e.color+';width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:4px;"></span>'+e.name+' ('+formatDate(e.date)+' · '+et.length+' konu)</label>';}).join('')+'</div></div>'+
    '<div style="background:var(--bg-card);padding:var(--space-md);border-radius:8px;margin-top:var(--space-md);"><strong>Önbilgi:</strong><br><span style="font-size:var(--font-sm);color:var(--text-secondary);">'+topics.length+' konu, '+future.length+' sınav</span><br><span style="font-size:var(--font-sm);color:var(--text-secondary);" id="gp-preview-range">Tarih: '+today+' → '+latestExam+'</span></div>';
  }

  var ov=showModal({title:'📅 Özel Plan Oluştur',content:buildF(),footer:'<button class="btn btn-secondary" id="modal-cancel">İptal</button><button class="btn btn-primary btn-lg" id="gp-start-btn">Planı Oluştur</button>'});
  var ms=ov.querySelector('#gp-maxslots');if(ms)ms.addEventListener('input',function(){ov.querySelector('#gp-maxslots-val').textContent=this.value;ov.querySelector('#gp-hours').textContent=(this.value*0.5).toFixed(1);});
  function up(){var st=ov.querySelector('#gp-start').value,en=ov.querySelector('#gp-end').value,pe=ov.querySelector('#gp-preview-range');if(pe)pe.textContent='Tarih: '+st+' → '+en;}
  var si=ov.querySelector('#gp-start');if(si)si.addEventListener('change',up);
  var ei=ov.querySelector('#gp-end');if(ei)ei.addEventListener('change',up);
  ov.querySelector('#modal-cancel').addEventListener('click',closeModal);
  ov.querySelector('#gp-start-btn').addEventListener('click',function(){
    var startDate=ov.querySelector('#gp-start').value,endDate=ov.querySelector('#gp-end').value;
    var maxDaily=parseInt(ov.querySelector('#gp-maxslots').value),breakDuration=parseInt(ov.querySelector('#gp-break').value),mode=ov.querySelector('#gp-mode').value;
    var hourStart=parseInt(ov.querySelector('#gp-hour-start').value),hourEnd=parseInt(ov.querySelector('#gp-hour-end').value);
    if(hourEnd<=hourStart){showToast({title:'Uyarı',message:'Bitiş saati başlangıç saatinden sonra olmalı.',type:'warning'});return;}
    var sel=[];ov.querySelectorAll('.gp-exam:checked').forEach(function(cb){sel.push(cb.value);});
    if(!sel.length){showToast({title:'Uyarı',message:'En az bir sınav seçin.',type:'warning'});return;}
    var selExams=exams.filter(function(e){return sel.indexOf(e.id)>=0;});
    var selTopics=topics.filter(function(t){return sel.indexOf(t.examId)>=0;});
    var cc=JSON.parse(JSON.stringify(c));cc.maxDailySlotsCount=maxDaily;cc.breakDurationMinutes=breakDuration;
    var customAvail={};
    for(var d=0;d<7;d++){customAvail[d]=[{start:hourStart,end:hourEnd}];}
    var cw=JSON.parse(JSON.stringify(s.weights));
    if(mode==='urgent'){cw.urgency=0.5;cw.topicWeight=0.2;cw.weakness=0.15;cw.performance=0.15;}
    if(mode==='weak'){cw.urgency=0.25;cw.topicWeight=0.15;cw.weakness=0.45;cw.performance=0.15;}
    var mocks=store.getMockResults(),hist=store.getSessions().filter(function(x){return x.status==='completed'||x.status==='missed';});
    var res=fullReschedule(selExams,selTopics,mocks,customAvail,cc,cw);
    res.sessions=res.sessions.filter(function(x){return x.date>=startDate&&x.date<=endDate;});
    store.setSessions(hist.concat(res.sessions));
    var plannedCnt=res.sessions.filter(function(x){return x.status==='scheduled';}).length;
    if(plannedCnt>0){
      showToast({title:t('schedule.planGenerated'),message:plannedCnt+' oturum planlandı ('+(mode==='urgent'?'Acil':mode==='weak'?'Zayıf':'Dengeli')+').',type:'success'});
    } else {
      showToast({title:'Planlanamadı',message:'Seçilen saat aralığında oturum oluşturulamadı. Saat aralığını veya slot sayısını değiştirin.',type:'warning'});
    }
    closeModal();currentWeekStart=getMonday(new Date(startDate));renderScheduleView(container);
  });
}
