/**
 * Theme Manager
 * Handles dark/light theme switching with localStorage persistence
 * and system preference detection.
 */

const THEME_STORAGE_KEY = 'studyPlanner_theme';

let currentTheme = loadTheme();

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }

  // Detect system preference
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function getTheme() {
  return currentTheme;
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  currentTheme = theme;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch { /* ignore */ }

  applyTheme();
}

export function toggleTheme() {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

export function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// Apply on load
if (typeof document !== 'undefined') {
  applyTheme();
}
