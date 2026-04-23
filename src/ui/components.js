/**
 * Reusable UI Components
 * Modal, Toast, Charts (Canvas), and helper renderers
 */

import { formatDateLocale, formatDateFullLocale } from '../data/i18n.js';

// ===== Modal =====
let activeModal = null;

export function showModal({ title, content, footer = '', onClose = null }) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body">${content}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('active'));

  overlay.querySelector('#modal-close-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  activeModal = { overlay, onClose };
  return overlay;
}

export function closeModal() {
  if (activeModal) {
    activeModal.overlay.classList.remove('active');
    setTimeout(() => {
      activeModal.overlay.remove();
      if (activeModal.onClose) activeModal.onClose();
      activeModal = null;
    }, 250);
  }
}

// ===== Toast Notifications =====
let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

export function showToast({ title, message, type = 'info', duration = 4000 }) {
  ensureToastContainer();

  const icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== Canvas Charts =====

/**
 * Draw a radar chart on a canvas element
 */
export function drawRadarChart(canvas, data, options = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(centerX, centerY) - 50;
  const levels = options.levels || 5;
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);
  const n = labels.length;

  if (n < 3) return;

  ctx.clearRect(0, 0, width, height);

  // Draw grid
  for (let level = 1; level <= levels; level++) {
    const r = (maxRadius / levels) * level;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
      const x = centerX + r * Math.cos(angle);
      const y = centerY + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw axes
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    const x = centerX + maxRadius * Math.cos(angle);
    const y = centerY + maxRadius * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Labels
    const labelX = centerX + (maxRadius + 25) * Math.cos(angle);
    const labelY = centerY + (maxRadius + 25) * Math.sin(angle);
    ctx.fillStyle = '#a0a0c0';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Truncate long labels
    const displayLabel = labels[i].length > 12 ? labels[i].substring(0, 10) + '…' : labels[i];
    ctx.fillText(displayLabel, labelX, labelY);
  }

  // Draw data polygon
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const angle = (Math.PI * 2 / n) * idx - Math.PI / 2;
    const r = maxRadius * values[idx];
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  // Fill
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
  gradient.addColorStop(1, 'rgba(139, 92, 246, 0.1)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Stroke
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw data points
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    const r = maxRadius * values[i];
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#818cf8';
    ctx.fill();
    ctx.strokeStyle = '#0a0a1a';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * Draw a line chart on a canvas element
 */
export function drawLineChart(canvas, datasets, labels, options = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);

  if (labels.length === 0) return;

  const maxValue = options.maxValue || Math.max(1, ...datasets.flatMap(ds => ds.values));

  // Draw grid lines
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartHeight / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Y-axis labels
    const val = Math.round(maxValue - (maxValue / gridLines) * i);
    ctx.fillStyle = '#6b6b8f';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val, padding.left - 8, y + 3);
  }

  // Draw X-axis labels
  const step = Math.max(1, Math.floor(labels.length / 8));
  for (let i = 0; i < labels.length; i += step) {
    const x = padding.left + (chartWidth / (labels.length - 1 || 1)) * i;
    ctx.fillStyle = '#6b6b8f';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x, height - padding.bottom + 20);
  }

  // Draw datasets
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4'];

  datasets.forEach((dataset, dsIdx) => {
    const color = dataset.color || colors[dsIdx % colors.length];
    const values = dataset.values;

    // Line
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = padding.left + (chartWidth / (labels.length - 1 || 1)) * i;
      const y = padding.top + chartHeight - (values[i] / maxValue) * chartHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill under the line
    ctx.lineTo(padding.left + (chartWidth / (labels.length - 1 || 1)) * (values.length - 1), padding.top + chartHeight);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.closePath();
    ctx.fillStyle = color.replace(')', ', 0.08)').replace('rgb', 'rgba');
    ctx.fill();

    // Points
    for (let i = 0; i < values.length; i++) {
      const x = padding.left + (chartWidth / (labels.length - 1 || 1)) * i;
      const y = padding.top + chartHeight - (values[i] / maxValue) * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#0a0a1a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  // Legend
  if (datasets.length > 1) {
    let legendX = padding.left;
    datasets.forEach((ds, i) => {
      const color = ds.color || colors[i % colors.length];
      ctx.fillStyle = color;
      ctx.fillRect(legendX, 6, 12, 3);
      ctx.fillStyle = '#a0a0c0';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(ds.label, legendX + 16, 10);
      legendX += ctx.measureText(ds.label).width + 36;
    });
  }
}

/**
 * Draw a donut chart
 */
export function drawDonutChart(canvas, segments, options = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(centerX, centerY) - 20;
  const innerRadius = outerRadius * 0.65;

  ctx.clearRect(0, 0, width, height);

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return;

  let startAngle = -Math.PI / 2;

  segments.forEach(segment => {
    const sliceAngle = (segment.value / total) * Math.PI * 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, startAngle, startAngle + sliceAngle);
    ctx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = segment.color;
    ctx.fill();

    startAngle += sliceAngle;
  });

  // Center text
  if (options.centerText) {
    ctx.fillStyle = '#f0f0ff';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(options.centerText, centerX, centerY - 8);
  }
  if (options.centerSubtext) {
    ctx.fillStyle = '#a0a0c0';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(options.centerSubtext, centerX, centerY + 14);
  }
}

// ===== Helper Renderers =====

export function formatDate(dateString) {
  return formatDateLocale(dateString);
}

export function formatDateFull(dateString) {
  return formatDateFullLocale(dateString);
}

export function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}`;
}

export function daysUntil(dateString) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function renderStars(rating, max = 5) {
  let html = '';
  for (let i = 1; i <= max; i++) {
    html += `<span style="color: ${i <= rating ? '#fbbf24' : '#3a3a5c'}; font-size: 14px;">★</span>`;
  }
  return html;
}
