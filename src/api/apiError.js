/**
 * Global API error handler / retry helper
 * Attaches error toasts and provides a wrapper for API calls.
 */

import { showToast } from './components.js';

let onAuthExpired = null;

export function setAuthExpiredHandler(fn) {
  onAuthExpired = fn;
}

export async function safeApi(fn, { silent = false, context = '' } = {}) {
  try {
    return await fn();
  } catch (error) {
    if (!silent) {
      showToast({
        title: context || 'Bağlantı hatası',
        message: error.message || 'Sunucuya erişilemiyor.',
        type: 'warning',
      });
    }
    throw error;
  }
}

export function isApiError(error) {
  return error && error.message && (
    error.message.includes('fetch') ||
    error.message.includes('network') ||
    error.message.includes('API')
  );
}
