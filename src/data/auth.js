/**
 * Authentication Module
 * Handles user registration, login, and session management
 * Stores data in localStorage (will be migrated to PostgreSQL later)
 */

const AUTH_STORAGE_KEY = 'studyPlanner_users';
const SESSION_KEY = 'studyPlanner_currentUser';

// Turkish High School Lessons for 11th and 12th grade (YKS preparation)
export const LESSONS = {
  11: {
    tyt: [
      'Türkçe',
      'Matematik',
      'Fizik',
      'Kimya',
      'Biyoloji',
      'Tarih',
      'Coğrafya',
      'Felsefe',
      'Din Kültürü',
    ],
    ayt: {
      sayisal: ['Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
      esit_agirlik: ['Matematik', 'Türk Dili ve Edebiyatı', 'Tarih', 'Coğrafya'],
      sozel: ['Türk Dili ve Edebiyatı', 'Tarih', 'Coğrafya', 'Felsefe Grubu'],
    },
  },
  12: {
    tyt: [
      'Türkçe',
      'Matematik',
      'Fizik',
      'Kimya',
      'Biyoloji',
      'Tarih',
      'Coğrafya',
      'Felsefe',
      'Din Kültürü',
    ],
    ayt: {
      sayisal: ['Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
      esit_agirlik: ['Matematik', 'Türk Dili ve Edebiyatı', 'Tarih-1', 'Coğrafya-1'],
      sozel: ['Türk Dili ve Edebiyatı', 'Tarih-1', 'Tarih-2', 'Coğrafya-1', 'Coğrafya-2', 'Felsefe Grubu'],
    },
  },
};

// Get all unique lessons for a given grade
export function getAllLessonsForGrade(grade) {
  const gradeData = LESSONS[grade];
  if (!gradeData) return [];

  const lessonSet = new Set();

  // Add TYT lessons
  gradeData.tyt.forEach(l => lessonSet.add(l));

  // Add AYT lessons from all tracks
  Object.values(gradeData.ayt).forEach(track => {
    track.forEach(l => lessonSet.add(l));
  });

  return [...lessonSet].sort((a, b) => a.localeCompare(b, 'tr'));
}

function getUsers() {
  try {
    const data = localStorage.getItem(AUTH_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(users));
}

/**
 * Register a new user
 * @returns {{ success: boolean, error?: string, user?: object }}
 */
export function registerUser({
  email,
  name,
  password,
  uniqueId,
  grade,
  strongLectures,
  weakLectures,
}) {
  const users = getUsers();

  // Validation
  if (!email || !name || !password || !uniqueId || !grade) {
    return { success: false, error: 'Tüm alanları doldurunuz.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'Geçerli bir e-posta adresi giriniz.' };
  }

  if (password.length < 6) {
    return { success: false, error: 'Şifre en az 6 karakter olmalıdır.' };
  }

  if (uniqueId.length < 3) {
    return { success: false, error: 'Benzersiz ID en az 3 karakter olmalıdır.' };
  }

  if (users.find(u => u.email === email.toLowerCase())) {
    return { success: false, error: 'Bu e-posta adresi zaten kayıtlı.' };
  }

  if (users.find(u => u.uniqueId === uniqueId)) {
    return { success: false, error: 'Bu benzersiz ID zaten kullanılıyor.' };
  }

  if (!strongLectures || strongLectures.length === 0) {
    return { success: false, error: 'En az bir güçlü ders seçiniz.' };
  }

  if (!weakLectures || weakLectures.length === 0) {
    return { success: false, error: 'En az bir zayıf ders seçiniz.' };
  }

  // Check for overlap between strong and weak
  const overlap = strongLectures.filter(l => weakLectures.includes(l));
  if (overlap.length > 0) {
    return { success: false, error: `Bir ders hem güçlü hem zayıf olamaz: ${overlap.join(', ')}` };
  }

  const user = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
    email: email.toLowerCase().trim(),
    name: name.trim(),
    password, // In production, this should be hashed
    uniqueId: uniqueId.trim(),
    grade: parseInt(grade),
    strongLectures,
    weakLectures,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);

  // Auto-login after register
  const sessionUser = { ...user };
  delete sessionUser.password;
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));

  return { success: true, user: sessionUser };
}

/**
 * Login user
 * @returns {{ success: boolean, error?: string, user?: object }}
 */
export function loginUser(email, password) {
  if (!email || !password) {
    return { success: false, error: 'E-posta ve şifre gereklidir.' };
  }

  const users = getUsers();
  const user = users.find(
    u => u.email === email.toLowerCase().trim() && u.password === password
  );

  if (!user) {
    return { success: false, error: 'E-posta veya şifre hatalı.' };
  }

  const sessionUser = { ...user };
  delete sessionUser.password;
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));

  return { success: true, user: sessionUser };
}

/**
 * Get current logged-in user
 */
export function getCurrentUser() {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Logout current user
 */
export function logoutUser() {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Check if a user is logged in
 */
export function isLoggedIn() {
  return getCurrentUser() !== null;
}
