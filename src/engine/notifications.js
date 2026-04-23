/**
 * Notification System
 * Uses Browser Notification API to alert users about upcoming study sessions.
 */

import { store } from '../data/store.js';
import { t } from '../data/i18n.js';

const NOTIFY_PREF_KEY = 'studyPlanner_notificationsEnabled';
let timer = null;
const CHECK_INTERVAL = 60 * 1000; // 1 minute
const ALERT_WINDOW_MINUTES = 15;

export function isNotificationsSupported() {
  return 'Notification' in window;
}

export function areNotificationsEnabled() {
  if (!isNotificationsSupported()) return false;
  return localStorage.getItem(NOTIFY_PREF_KEY) === 'true' && Notification.permission === 'granted';
}

export async function toggleNotifications() {
  if (!isNotificationsSupported()) return false;

  const current = areNotificationsEnabled();
  
  if (!current) {
    if (Notification.permission === 'default' || Notification.permission === 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem(NOTIFY_PREF_KEY, 'true');
        startNotificationEngine();
        return true;
      }
      return false; // User denied
    } else if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIFY_PREF_KEY, 'true');
      startNotificationEngine();
      return true;
    }
  } else {
    // Disable
    localStorage.setItem(NOTIFY_PREF_KEY, 'false');
    stopNotificationEngine();
    return false;
  }
}

function checkUpcomingSessions() {
  if (!areNotificationsEnabled()) return;

  const now = new Date();
  const sessions = store.getSessions();
  const topics = store.getTopics();
  const exams = store.getExams();

  const upcomingSessions = sessions.filter(s => s.status === 'scheduled');

  for (const session of upcomingSessions) {
    // Check if session has already been notified
    if (session.notified) continue;

    const [year, month, day] = session.date.split('-');
    const sessionTime = new Date(year, month - 1, day, session.startHour, session.startMinute);
    
    const diffMinutes = (sessionTime - now) / (1000 * 60);

    // If session is precisely within the window (e.g., between 14.0 and 15.0 minutes from now)
    // Actually, we'll check if diff is between 0 and 15, and flag it as notified
    if (diffMinutes > 0 && diffMinutes <= ALERT_WINDOW_MINUTES) {
      session.notified = true; // Temporary in-memory flag to avoid repeated notifications
      
      const topic = topics.find(t => t.id === session.topicId);
      const exam = topic ? exams.find(e => e.id === topic.examId) : null;
      
      const title = 'StudyEngine: Başlıyoruz! 📚';
      const body = topic 
        ? `"${topic.name}" çalışman ${Math.ceil(diffMinutes)} dakika sonra başlıyor! ${exam ? '(' + exam.name + ')' : ''}`
        : `Çalışma oturumun ${Math.ceil(diffMinutes)} dakika sonra başlıyor!`;

      new Notification(title, {
        body,
        icon: '/favicon.ico', // assuming there's an icon or it falls back
      });
    }
  }
}

export function startNotificationEngine() {
  if (!areNotificationsEnabled()) return;
  if (timer) clearInterval(timer);
  
  // Checking immediately then every minute
  checkUpcomingSessions();
  timer = setInterval(checkUpcomingSessions, CHECK_INTERVAL);
}

export function stopNotificationEngine() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
