/**
 * Schedule View
 * Weekly calendar with time slots, session status, and rescheduling controls
 */

import { store } from '../data/store.js';
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

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  container.innerHTML = `
    <div class="page-header">
      <h2>📅 Study Schedule</h2>
      <p>Your weekly study plan with dynamic slot allocation</p>
    </div>
    <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-lg);flex-wrap:wrap;">
      <button class="btn btn-primary btn-lg" id="generate-plan-btn">🔄 Generate Plan</button>
      ${missedCount > 0 ? `<button class="btn btn-secondary btn-lg" id="reschedule-btn">⚡ Reschedule (${missedCount} missed)</button>` : ''}
      ${scheduledCount > 0 ? `<button class="btn btn-danger btn-lg" id="clear-plan-btn">🗑 Clear</button>` : ''}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);">
      <button class="btn btn-secondary" id="prev-week-btn">← Prev</button>
      <h3 style="font-size:var(--font-md);font-weight:600;">${formatDate(days[0].toISOString())} — ${formatDate(days[6].toISOString())}</h3>
      <button class="btn btn-secondary" id="next-week-btn">Next →</button>
    </div>
    <div class="week-view">${days.map(day => renderDayColumn(day, sessions, exams, todayStr)).join('')}</div>
    <div style="display:flex;gap:var(--space-lg);margin-top:var(--space-lg);padding:var(--space-md);justify-content:center;">
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--accent-primary);"></span> Scheduled</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-success);"></span> Completed</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-danger);"></span> Missed</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--text-secondary);"><span style="width:12px;height:12px;border-radius:3px;background:var(--text-tertiary);"></span> Break</span>
    </div>
  `;
  bindScheduleEvents(container);
}

function renderDayColumn(day, sessions, exams, todayStr) {
  const dateStr = day.toISOString().split('T')[0];
  const isToday = dateStr === todayStr;
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
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
      ${daySessions.length === 0 ? `<div style="text-align:center;color:var(--text-tertiary);font-size:var(--font-xs);padding:var(--space-lg);">No sessions</div>` :
        daySessions.map(s => {
          const topic = s.topicId ? store.getTopic(s.topicId) : null;
          const exam = topic ? store.getExam(topic.examId) : null;
          const isBreak = s.status === 'break';
          return `<div class="schedule-slot ${isBreak?'break-slot':s.status}" data-session-id="${s.id}">
            <span class="schedule-time">${formatTime(s.startHour, s.startMinute)}</span>
            ${!isBreak && exam ? `<span class="schedule-exam-dot" style="background:${exam.color}"></span>` : ''}
            <span class="schedule-topic">${isBreak ? '☕ Break' : (topic?topic.name:'?')}</span>
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
    if (!exams.length || !topics.length) { showToast({title:'No Data',message:'Add exams and topics first!',type:'warning'}); return; }
    const s = store.getSettings();
    const hist = store.getSessions().filter(x => x.status==='completed'||x.status==='missed');
    const r = fullReschedule(exams, topics, store.getMockResults(), s.dailyAvailability, s.constraints, s.weights);
    store.setSessions([...hist, ...r.sessions]);
    showToast({title:'Plan Generated! 🎉',message:`${r.sessions.filter(x=>x.status==='scheduled').length} sessions scheduled.`,type:'success'});
    renderScheduleView(container);
  });

  container.querySelector('#reschedule-btn')?.addEventListener('click', () => {
    const sess = store.getSessions(), s = store.getSettings();
    const missedIds = sess.filter(x=>x.status==='missed').map(x=>x.id);
    const r = handleMissedSessions(missedIds, sess, store.getExams(), store.getTopics(), store.getMockResults(), s.dailyAvailability, s.constraints, s.weights);
    store.setSessions(r.newSessions);
    showToast({title:'Rescheduled! ⚡',message:`${missedIds.length} missed session(s) redistributed.`,type:'success'});
    r.warnings.forEach(w => showToast({title:'Notice',message:w,type:'warning'}));
    renderScheduleView(container);
  });

  container.querySelector('#clear-plan-btn')?.addEventListener('click', () => {
    if (confirm('Clear the entire schedule?')) { store.clearSessions(); renderScheduleView(container); }
  });

  container.querySelector('#prev-week-btn')?.addEventListener('click', () => { currentWeekStart.setDate(currentWeekStart.getDate()-7); renderScheduleView(container); });
  container.querySelector('#next-week-btn')?.addEventListener('click', () => { currentWeekStart.setDate(currentWeekStart.getDate()+7); renderScheduleView(container); });

  container.querySelectorAll('.session-complete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.updateSession(btn.dataset.id, {status:'completed', completedAt: new Date().toISOString()});
      const ses = store.getSession(btn.dataset.id);
      if(ses){ const t=store.getTopic(ses.topicId); if(t) store.updateTopic(t.id,{completedMinutes:(t.completedMinutes||0)+ses.durationMinutes}); }
      showToast({title:'Completed! ✓',message:'Well done!',type:'success'});
      renderScheduleView(container);
    });
  });

  container.querySelectorAll('.session-miss-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.updateSession(btn.dataset.id, {status:'missed'});
      showToast({title:'Missed',message:'Click Reschedule to reallocate.',type:'warning'});
      renderScheduleView(container);
    });
  });
}
