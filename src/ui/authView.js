import { registerUserApi, loginUserApi } from '../api/authApi.js';
import { getAllLessonsForGrade } from '../data/auth.js';

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
          <span class="auth-kicker">StudyEngine</span>
          <h1>Adaptive planning for exam preparation.</h1>
          <p>
            Sign in to manage exams, generate schedules, and track weak topics with the rule-based planner.
          </p>
          <div class="auth-feature-list">
            <div class="auth-feature-item">Priority scoring based on urgency, weight, weakness, and performance</div>
            <div class="auth-feature-item">Weekly schedule generation and missed-session recovery</div>
            <div class="auth-feature-item">Analytics for mastery, trend, and study consistency</div>
          </div>
        </section>

        <section class="auth-panel card">
          <div class="tabs auth-tabs">
            <button class="tab ${state.mode === 'login' ? 'active' : ''}" data-mode="login">Login</button>
            <button class="tab ${state.mode === 'register' ? 'active' : ''}" data-mode="register">Register</button>
          </div>

          <div class="auth-panel-head">
            <h2>${state.mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>${state.mode === 'login'
              ? 'Use your email and password to continue.'
              : 'Fill in your exam profile to start generating plans.'}</p>
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
      state.error = `${error.message} If the API is not running, start it with npm run api.`;
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
      state.error = `${error.message} If the API is not running, start it with npm run api.`;
      render();
    }
  }

  render();
}

function renderLoginForm(state) {
  return `
    <form id="login-form" class="auth-form">
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" name="email" placeholder="student@example.com" value="${escapeHtml(state.login.email)}" required>
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" type="password" name="password" placeholder="Minimum 6 characters" value="${escapeHtml(state.login.password)}" required>
      </div>
      <button class="btn btn-primary btn-lg" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Signing in…' : 'Log In'}
      </button>
    </form>
  `;
}

function renderRegisterForm(state, lessons) {
  return `
    <form id="register-form" class="auth-form">
      <div class="grid-2 auth-grid">
        <div class="form-group">
          <label class="form-label">Full name</label>
          <input class="form-input" type="text" name="name" placeholder="Student Name" value="${escapeHtml(state.register.name)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" type="email" name="email" placeholder="student@example.com" value="${escapeHtml(state.register.email)}" required>
        </div>
      </div>

      <div class="grid-2 auth-grid">
        <div class="form-group">
          <label class="form-label">Password</label>
          <input class="form-input" type="password" name="password" placeholder="Minimum 6 characters" value="${escapeHtml(state.register.password)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Unique ID</label>
          <input class="form-input" type="text" name="uniqueId" placeholder="e.g. mtunc11" value="${escapeHtml(state.register.uniqueId)}" required>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Grade</label>
        <select class="form-select" id="register-grade" name="grade">
          <option value="11" ${state.grade === '11' ? 'selected' : ''}>11th Grade</option>
          <option value="12" ${state.grade === '12' ? 'selected' : ''}>12th Grade</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Strong lessons</label>
        <div class="auth-chip-grid">
          ${lessons.map(lesson => renderLessonCheckbox(lesson, 'strongLectures', state.register.strongLectures)).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Weak lessons</label>
        <div class="auth-chip-grid">
          ${lessons.map(lesson => renderLessonCheckbox(lesson, 'weakLectures', state.register.weakLectures)).join('')}
        </div>
      </div>

      <button class="btn btn-primary btn-lg" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Creating account…' : 'Create Account'}
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
