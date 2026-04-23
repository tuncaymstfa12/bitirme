import { registerUserApi, loginUserApi } from '../api/authApi.js';
import { getAllLessonsForGrade } from '../data/auth.js';
import { t } from '../data/i18n.js';

export function renderAuthView(container, { onAuthenticated, initialError = '' } = {}) {
  const state = {
    mode: 'login',
    grade: '11',
    error: initialError,
    busy: false,
    login: {
      email: '',
      password: '',
    },
    register: {
      name: '',
      email: '',
      password: '',
      uniqueId: '',
      strongLectures: [],
      weakLectures: [],
    },
  };

  function render() {
    const lessons = getAllLessonsForGrade(state.grade);

    container.innerHTML = `
      <div class="auth-layout animate-fade-in">
        <section class="auth-hero">
          <span class="auth-kicker">${t('auth.kicker')}</span>
          <h1>${t('auth.heroTitle')}</h1>
          <p>${t('auth.heroDesc')}</p>
          <div class="auth-feature-list">
            <div class="auth-feature-item">${t('auth.feature1')}</div>
            <div class="auth-feature-item">${t('auth.feature2')}</div>
            <div class="auth-feature-item">${t('auth.feature3')}</div>
          </div>
        </section>

        <section class="auth-panel card">
          <div class="tabs auth-tabs">
            <button class="tab ${state.mode === 'login' ? 'active' : ''}" data-mode="login">${t('auth.login')}</button>
            <button class="tab ${state.mode === 'register' ? 'active' : ''}" data-mode="register">${t('auth.register')}</button>
          </div>

          <div class="auth-panel-head">
            <h2>${state.mode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount')}</h2>
            <p>${state.mode === 'login' ? t('auth.loginDesc') : t('auth.registerDesc')}</p>
          </div>

          ${state.error ? `<div class="auth-feedback error">${escapeHtml(state.error)}</div>` : ''}

          ${state.mode === 'login' ? renderLoginForm(state) : renderRegisterForm(state, lessons)}
        </section>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    container.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        state.mode = button.dataset.mode;
        state.error = '';
        render();
      });
    });

    container.querySelector('#login-form')?.addEventListener('submit', handleLogin);
    container.querySelector('#register-form')?.addEventListener('submit', handleRegister);
    container.querySelector('#register-grade')?.addEventListener('change', event => {
      state.grade = event.target.value;
      state.error = '';
      render();
    });
  }

  async function handleLogin(event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');

    state.login.email = email;
    state.login.password = password;

    state.busy = true;
    state.error = '';
    render();

    try {
      const result = await loginUserApi(email, password);
      onAuthenticated?.(result.user);
    } catch (error) {
      state.busy = false;
      state.error = `${error.message} ${t('auth.apiError')}`;
      render();
    }
  }

  async function handleRegister(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const strongLectures = getCheckedValues(form, 'strongLectures');
    const weakLectures = getCheckedValues(form, 'weakLectures');
    const overlap = strongLectures.filter(lesson => weakLectures.includes(lesson));

    state.register.name = String(formData.get('name') || '').trim();
    state.register.email = String(formData.get('email') || '').trim();
    state.register.password = String(formData.get('password') || '');
    state.register.uniqueId = String(formData.get('uniqueId') || '').trim();
    state.register.strongLectures = strongLectures;
    state.register.weakLectures = weakLectures;

    if (overlap.length > 0) {
      state.error = `A lesson cannot be both strong and weak: ${overlap.join(', ')}`;
      render();
      return;
    }

    state.busy = true;
    state.error = '';
    render();

    try {
      const result = await registerUserApi({
        email: state.register.email,
        name: state.register.name,
        password: state.register.password,
        uniqueId: state.register.uniqueId,
        grade: Number(formData.get('grade')),
        strongLectures,
        weakLectures,
      });

      onAuthenticated?.(result.user);
    } catch (error) {
      state.busy = false;
      state.error = `${error.message} ${t('auth.apiError')}`;
      render();
    }
  }

  render();
}

function renderLoginForm(state) {
  return `
    <form id="login-form" class="auth-form">
      <div class="form-group">
        <label class="form-label">${t('auth.email')}</label>
        <input class="form-input" type="email" name="email" placeholder="${t('auth.emailPlaceholder')}" value="${escapeHtml(state.login.email)}" required>
      </div>
      <div class="form-group">
        <label class="form-label">${t('auth.password')}</label>
        <input class="form-input" type="password" name="password" placeholder="${t('auth.passwordPlaceholder')}" value="${escapeHtml(state.login.password)}" required>
      </div>
      <button class="btn btn-primary btn-lg" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? t('auth.signingIn') : t('auth.loginBtn')}
      </button>
    </form>
  `;
}

function renderRegisterForm(state, lessons) {
  return `
    <form id="register-form" class="auth-form">
      <div class="grid-2 auth-grid">
        <div class="form-group">
          <label class="form-label">${t('auth.fullName')}</label>
          <input class="form-input" type="text" name="name" placeholder="${t('auth.namePlaceholder')}" value="${escapeHtml(state.register.name)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">${t('auth.email')}</label>
          <input class="form-input" type="email" name="email" placeholder="${t('auth.emailPlaceholder')}" value="${escapeHtml(state.register.email)}" required>
        </div>
      </div>

      <div class="grid-2 auth-grid">
        <div class="form-group">
          <label class="form-label">${t('auth.password')}</label>
          <input class="form-input" type="password" name="password" placeholder="${t('auth.passwordPlaceholder')}" value="${escapeHtml(state.register.password)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">${t('auth.uniqueId')}</label>
          <input class="form-input" type="text" name="uniqueId" placeholder="${t('auth.uniqueIdPlaceholder')}" value="${escapeHtml(state.register.uniqueId)}" required>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('auth.grade')}</label>
        <select class="form-select" id="register-grade" name="grade">
          <option value="11" ${state.grade === '11' ? 'selected' : ''}>${t('auth.grade11')}</option>
          <option value="12" ${state.grade === '12' ? 'selected' : ''}>${t('auth.grade12')}</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">${t('auth.strongLessons')}</label>
        <div class="auth-chip-grid">
          ${lessons.map(lesson => renderLessonCheckbox(lesson, 'strongLectures', state.register.strongLectures)).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('auth.weakLessons')}</label>
        <div class="auth-chip-grid">
          ${lessons.map(lesson => renderLessonCheckbox(lesson, 'weakLectures', state.register.weakLectures)).join('')}
        </div>
      </div>

      <button class="btn btn-primary btn-lg" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? t('auth.creatingAccount') : t('auth.createBtn')}
      </button>
    </form>
  `;
}

function renderLessonCheckbox(lesson, field, selectedValues) {
  const escaped = escapeHtml(lesson);
  const checked = selectedValues.includes(lesson) ? 'checked' : '';

  return `
    <label class="auth-chip">
      <input type="checkbox" name="${field}" value="${escaped}" ${checked}>
      <span>${escaped}</span>
    </label>
  `;
}

function getCheckedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
