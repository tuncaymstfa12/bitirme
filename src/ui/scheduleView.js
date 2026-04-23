/**
 * Schedule View
 * Weekly calendar with time slots, session status, and rescheduling controls
 */

import { store } from '../data/store.js';
import { t } from '../data/i18n.js';
import { fullReschedule, handleMissedSessions } from '../engine/rescheduler.js';
import { showToast, formatTime, formatDate, showModal, closeModal } from './components.js';

let currentWeekStart = getMonday(new Date());

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function renderScheduleView(container) {
  const sessions = store.getSessions();
  const exams = store.getExams();
  const todayStr = new Date().toISOString().split('T')[0];
  const missedCount = sessions.filter(s => s.status === 'missed').length;
  const scheduledCount = sessions.filter(s => s.status === 'scheduled').length;
  const dayNames = t('schedule.dayNames');

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  container.innerHTML = `
    <div class="page-header">
      <h2>📅 ${t('schedule.title')}</h2>
      <p>${t('schedule.subtitle')}</p>
    </div>
    <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-lg);flex-wrap:wrap;">
      <button class="btn btn-primary btn-lg" id="generate-plan-btn">${t('schedule.generatePlan')}</button>
      ${missedCount > 0 ? `<button class="btn btn-secondary btn-lg" id="reschedule-btn">${t('schedule.reschedule')} (${missedCount} ${t('schedule.missed')})</button>` : ''}
      ${scheduledCount > 0 ? `<button class="btn btn-danger btn-lg" id="clear-plan-btn">${t('schedule.clear')}</button>` : ''}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);" class="animate-fade-in-up" style="animation-delay: 0.1s">
      <button class="btn btn-secondary" id="prev-week-btn">${t('schedule.prev')}</button>
      <h3 style="font-size:var(--font-md);font-weight:600;">${formatDate(days[0].toISOString())} — ${formatDate(days[6].toISOString())}</h3>
      <button class="btn btn-secondary" id="next-week-btn">${t('schedule.next')}</button>
    </div>
    <div class="week-view animate-fade-in-up" style="animation-delay: 0.2s">${days.map(day => renderDayColumn(day, sessions, exams, todayStr, dayNames)).join('')}</div>
    <div style="display:flex;gap:var(--space-lg);margin-top:var(--space-lg);padding:var(--space-md);justify-content:center;" class="animate-fade-in-up" style="animation-delay: 0.3s">
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--accent-primary);"></span> ${t('schedule.scheduled')}</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-success);"></span> ${t('schedule.completedLabel')}</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-danger);"></span> ${t('schedule.missedLabel')}</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--text-tertiary);"></span> ${t('schedule.breakLabel')}</span>
    </div>
  `;
  bindScheduleEvents(container);
}

function renderDayColumn(day, sessions, exams, todayStr, dayNames) {
  const dateStr = day.toISOString().split('T')[0];
  const isToday = dateStr === todayStr;
  const daySessions = sessions.filter(s => s.date === dateStr)
    .sort((a,b) => (a.startHour*60+a.startMinute) - (b.startHour*60+b.startMinute));
  const dayExams = exams.filter(e => e.date === dateStr);

  return `<div class="day-column">
    <div class="day-header ${isToday?'today':''}">
      <div class="day-name">${dayNames[day.getDay()]}</div>
      <div class="day-date">${day.getDate()}</div>
      ${dayExams.map(e=>`<div style="margin-top:4px;"><span class="tag" style="border-color:${e.color};color:${e.color};">🎯 ${e.name}</span></div>`).join('')}
    </div>
    <div class="day-slots">
      ${daySessions.length === 0 ? `<div style="text-align:center;color:var(--text-tertiary);font-size:var(--font-xs);padding:var(--space-lg);">${t('schedule.noSessions')}</div>` :
        daySessions.map(s => {
          const topic = s.topicId ? store.getTopic(s.topicId) : null;
          const exam = topic ? store.getExam(topic.examId) : null;
          const isBreak = s.status === 'break';
          return `<div class="schedule-slot ${isBreak?'break-slot':s.status}" data-session-id="${s.id}">
            <span class="schedule-time">${formatTime(s.startHour, s.startMinute)}</span>
            ${!isBreak && exam ? `<span class="schedule-exam-dot" style="background:${exam.color}"></span>` : ''}
            <span class="schedule-topic">${isBreak ? t('schedule.break') : (topic?topic.name:'?')}</span>
            ${!isBreak && s.status==='scheduled' ? `<div class="schedule-actions">
              <button class="btn btn-sm btn-success session-complete-btn" data-id="${s.id}">✓</button>
              <button class="btn btn-sm btn-danger session-miss-btn" data-id="${s.id}">✕</button>
            </div>` : ''}
          </div>`;
        }).join('')}
    </div>
  </div>`;
}

function bindScheduleEvents(container) {
  container.querySelector('#generate-plan-btn')?.addEventListener('click', () => {
    const exams = store.getExams(), topics = store.getTopics();
    if (!exams.length || !topics.length) { showToast({title:t('schedule.noData'),message:t('schedule.noDataMsg'),type:'warning'}); return; }
    const s = store.getSettings();
    const hist = store.getSessions().filter(x => x.status==='completed'||x.status==='missed');
    const r = fullReschedule(exams, topics, store.getMockResults(), s.dailyAvailability, s.constraints, s.weights);
    store.setSessions([...hist, ...r.sessions]);
    showToast({title:t('schedule.planGenerated'),message:t('schedule.planGeneratedMsg', { count: r.sessions.filter(x=>x.status==='scheduled').length }),type:'success'});
    renderScheduleView(container);
  });

  container.querySelector('#reschedule-btn')?.addEventListener('click', () => {
    const sess = store.getSessions(), s = store.getSettings();
    const missedIds = sess.filter(x=>x.status==='missed').map(x=>x.id);
    const r = handleMissedSessions(missedIds, sess, store.getExams(), store.getTopics(), store.getMockResults(), s.dailyAvailability, s.constraints, s.weights);
    store.setSessions(r.newSessions);
    showToast({title:t('schedule.rescheduled'),message:t('schedule.rescheduledMsg', { count: missedIds.length }),type:'success'});
    r.warnings.forEach(w => showToast({title:t('schedule.notice'),message:w,type:'warning'}));
    renderScheduleView(container);
  });

  container.querySelector('#clear-plan-btn')?.addEventListener('click', () => {
    if (confirm(t('schedule.confirmClear'))) { store.clearSessions(); renderScheduleView(container); }
  });

  container.querySelector('#prev-week-btn')?.addEventListener('click', () => { currentWeekStart.setDate(currentWeekStart.getDate()-7); renderScheduleView(container); });
  container.querySelector('#next-week-btn')?.addEventListener('click', () => { currentWeekStart.setDate(currentWeekStart.getDate()+7); renderScheduleView(container); });

  container.querySelectorAll('.session-complete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.updateSession(btn.dataset.id, {status:'completed', completedAt: new Date().toISOString()});
      const ses = store.getSession(btn.dataset.id);
      if(ses){ const tp=store.getTopic(ses.topicId); if(tp) store.updateTopic(tp.id,{completedMinutes:(tp.completedMinutes||0)+ses.durationMinutes}); }
      showToast({title:t('schedule.completed'),message:t('schedule.completedMsg'),type:'success'});
      renderScheduleView(container);
    });
  });

  container.querySelectorAll('.session-miss-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.updateSession(btn.dataset.id, {status:'missed'});
      showToast({title:t('dashboard.sessionMissed'),message:t('schedule.missedMsg'),type:'warning'});
      renderScheduleView(container);
    });
  });
}
