import { registerUserApi, loginUserApi } from '../api/authApi.js';
import { getAllLessonsForGrade } from '../data/auth.js';
import { t } from '../data/i18n.js';

export function renderAuthView(container, { onAuthenticated, initialError = '' } = {}) {
  const state = {
    mode: 'login',
    grade: '11',
    error: initialError,
    busy: false,
    login: { email: '', password: '' },
    register: {
      name: '', email: '', password: '',
      grade: '11', part: 'say', age: 17,
      birthdate: '', phoneNumber: '',
      strongLectures: [], weakLectures: [],
    },
  };

  function render() {
    const lessons = getAllLessonsForGrade(state.grade);
    container.innerHTML = [
      '<div class="auth-layout animate-fade-in">',
      '<section class="auth-hero">',
      '<span class="auth-kicker">' + t('auth.kicker') + '</span>',
      '<h1>' + t('auth.heroTitle') + '</h1>',
      '<p>' + t('auth.heroDesc') + '</p>',
      '<div class="auth-feature-list">',
      '<div class="auth-feature-item">' + t('auth.feature1') + '</div>',
      '<div class="auth-feature-item">' + t('auth.feature2') + '</div>',
      '<div class="auth-feature-item">' + t('auth.feature3') + '</div>',
      '</div></section>',
      '<section class="auth-panel card">',
      '<div class="tabs auth-tabs">',
      '<button class="tab ' + (state.mode === 'login' ? 'active' : '') + '" data-mode="login">' + t('auth.login') + '</button>',
      '<button class="tab ' + (state.mode === 'register' ? 'active' : '') + '" data-mode="register">' + t('auth.register') + '</button>',
      '</div>',
      '<div class="auth-panel-head"><h2>' + (state.mode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount')) + '</h2><p>' + (state.mode === 'login' ? t('auth.loginDesc') : t('auth.registerDesc')) + '</p></div>',
      state.error ? '<div class="auth-feedback error">' + h(state.error) + '</div>' : '',
      state.mode === 'login' ? renderLoginForm(state) : renderRegisterForm(state, lessons),
      '</section></div>'
    ].join('');
    bindEvents();
  }

  function bindEvents() {
    container.querySelectorAll('[data-mode]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.mode = btn.dataset.mode;
        state.error = '';
        render();
      });
    });
    var lf = container.querySelector('#login-form');
    if (lf) lf.addEventListener('submit', handleLogin);
    var rf = container.querySelector('#register-form');
    if (rf) rf.addEventListener('submit', handleRegister);
    var rg = container.querySelector('#register-grade');
    if (rg) rg.addEventListener('change', function(e) { state.grade = e.target.value; state.error = ''; render(); });
  }

  async function handleLogin(e) {
    e.preventDefault();
    var f = new FormData(e.currentTarget);
    var email = String(f.get('email') || '').trim();
    var password = String(f.get('password') || '');
    state.login.email = email; state.login.password = password;
    state.busy = true; state.error = ''; render();
    try {
      var r = await loginUserApi(email, password);
      if (onAuthenticated) onAuthenticated(r.user);
    } catch (err) {
      state.busy = false;
      state.error = err.message;
      render();
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var fd = new FormData(form);
    var strong = getChecked(form, 'strongLectures');
    var weak = getChecked(form, 'weakLectures');
    var overlap = strong.filter(function(l) { return weak.includes(l); });

    state.register.name = String(fd.get('name') || '').trim();
    state.register.email = String(fd.get('email') || '').trim();
    state.register.password = String(fd.get('password') || '');
    state.register.grade = String(fd.get('grade') || '11');
    state.register.part = String(fd.get('part') || 'say');
    state.register.age = parseInt(fd.get('age') || '17');
    state.register.birthdate = String(fd.get('birthdate') || '');
    state.register.phoneNumber = String(fd.get('phoneNumber') || '').trim();
    state.register.strongLectures = strong;
    state.register.weakLectures = weak;

    if (overlap.length > 0) { state.error = 'Bir ders hem güçlü hem zayıf olamaz: ' + overlap.join(', '); render(); return; }
    if (!state.register.birthdate) { state.error = 'Doğum tarihi zorunludur.'; render(); return; }

    state.busy = true; state.error = ''; render();
    try {
      var r = await registerUserApi({
        email: state.register.email, name: state.register.name,
        password: state.register.password,
        grade: state.register.grade, part: state.register.part,
        age: state.register.age, birthdate: state.register.birthdate,
        phoneNumber: state.register.phoneNumber || null,
        strongLectures: strong, weakLectures: weak,
      });
      if (onAuthenticated) onAuthenticated(r.user);
    } catch (err) {
      state.busy = false;
      state.error = err.message;
      render();
    }
  }

  render();
}

function renderLoginForm(st) {
  return '<form id="login-form" class="auth-form">' +
    '<div class="form-group"><label class="form-label">' + t('auth.email') + '</label><input class="form-input" type="email" name="email" placeholder="' + t('auth.emailPlaceholder') + '" value="' + h(st.login.email) + '" required></div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.password') + '</label><input class="form-input" type="password" name="password" placeholder="' + t('auth.passwordPlaceholder') + '" value="' + h(st.login.password) + '" required></div>' +
    '<button class="btn btn-primary btn-lg" type="submit" ' + (st.busy ? 'disabled' : '') + '>' + (st.busy ? t('auth.signingIn') : t('auth.loginBtn')) + '</button></form>';
}

function renderRegisterForm(st, lessons) {
  return '<form id="register-form" class="auth-form">' +
    '<div class="grid-2 auth-grid">' +
    '<div class="form-group"><label class="form-label">' + t('auth.fullName') + '</label><input class="form-input" type="text" name="name" placeholder="' + t('auth.namePlaceholder') + '" value="' + h(st.register.name) + '" required></div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.email') + '</label><input class="form-input" type="email" name="email" placeholder="' + t('auth.emailPlaceholder') + '" value="' + h(st.register.email) + '" required></div>' +
    '</div>' +
    '<div class="grid-2 auth-grid">' +
    '<div class="form-group"><label class="form-label">' + t('auth.password') + '</label><input class="form-input" type="password" name="password" placeholder="' + t('auth.passwordPlaceholder') + '" value="' + h(st.register.password) + '" required></div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.grade') + '</label><select class="form-select" id="register-grade" name="grade"><option value="11" ' + (st.register.grade === '11' ? 'selected' : '') + '>' + t('auth.grade11') + '</option><option value="12" ' + (st.register.grade === '12' ? 'selected' : '') + '>' + t('auth.grade12') + '</option></select></div>' +
    '</div>' +
    '<div class="grid-2 auth-grid">' +
    '<div class="form-group"><label class="form-label">' + t('auth.part') + '</label><select class="form-select" name="part"><option value="say" ' + (st.register.part === 'say' ? 'selected' : '') + '>' + t('auth.partSay') + '</option><option value="ea" ' + (st.register.part === 'ea' ? 'selected' : '') + '>' + t('auth.partEa') + '</option><option value="dil" ' + (st.register.part === 'dil' ? 'selected' : '') + '>' + t('auth.partDil') + '</option><option value="sozel" ' + (st.register.part === 'sozel' ? 'selected' : '') + '>' + t('auth.partSozel') + '</option></select></div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.age') + '</label><input class="form-input" type="number" name="age" min="14" max="20" value="' + st.register.age + '" required></div>' +
    '</div>' +
    '<div class="grid-2 auth-grid">' +
    '<div class="form-group"><label class="form-label">' + t('auth.birthdate') + '</label><input class="form-input" type="date" name="birthdate" value="' + h(st.register.birthdate) + '" required></div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.phoneNumber') + '</label><input class="form-input" type="tel" name="phoneNumber" placeholder="' + t('auth.phonePlaceholder') + '" value="' + h(st.register.phoneNumber) + '"></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.strongLessons') + '</label><div class="auth-chip-grid">' + lessons.map(function(l) { return lessonChip(l, 'strongLectures', st.register.strongLectures); }).join('') + '</div></div>' +
    '<div class="form-group"><label class="form-label">' + t('auth.weakLessons') + '</label><div class="auth-chip-grid">' + lessons.map(function(l) { return lessonChip(l, 'weakLectures', st.register.weakLectures); }).join('') + '</div></div>' +
    '<button class="btn btn-primary btn-lg" type="submit" ' + (st.busy ? 'disabled' : '') + '>' + (st.busy ? t('auth.creatingAccount') : t('auth.createBtn')) + '</button></form>';
}

function lessonChip(lesson, field, selected) {
  var esc = h(lesson);
  return '<label class="auth-chip"><input type="checkbox" name="' + field + '" value="' + esc + '" ' + (selected.includes(lesson) ? 'checked' : '') + '><span>' + esc + '</span></label>';
}

function getChecked(form, name) {
  return [].slice.call(form.querySelectorAll('input[name="' + name + '"]:checked')).map(function(i) { return i.value; });
}

function h(v) {
  return String(v || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
