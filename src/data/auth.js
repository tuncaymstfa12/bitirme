/**
 * Curriculum Data
 * Turkish High School Lessons for 11th and 12th grade (YKS preparation)
 */

// Turkish High School Lessons for 11th and 12th grade (YKS preparation)
export const LESSONS = {
  11: {
    tyt: [
      'Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji',
      'Tarih', 'Coğrafya', 'Felsefe', 'Din Kültürü',
    ],
    ayt: {
      sayisal: ['Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
      esit_agirlik: ['Matematik', 'Türk Dili ve Edebiyatı', 'Tarih', 'Coğrafya'],
      sozel: ['Türk Dili ve Edebiyatı', 'Tarih', 'Coğrafya', 'Felsefe Grubu'],
      dil: ['İngilizce', 'Almanca', 'Fransızca', 'Arapça'],
    },
  },
  12: {
    tyt: [
      'Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji',
      'Tarih', 'Coğrafya', 'Felsefe', 'Din Kültürü',
    ],
    ayt: {
      sayisal: ['Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
      esit_agirlik: ['Matematik', 'Türk Dili ve Edebiyatı', 'Tarih-1', 'Coğrafya-1'],
      sozel: ['Türk Dili ve Edebiyatı', 'Tarih-1', 'Tarih-2', 'Coğrafya-1', 'Coğrafya-2', 'Felsefe Grubu'],
      dil: ['İngilizce', 'Almanca', 'Fransızca', 'Arapça'],
    },
  },
};

// Get all unique lessons for a given grade
export function getAllLessonsForGrade(grade) {
  const gradeData = LESSONS[grade];
  if (!gradeData) return [];

  const lessonSet = new Set();

  gradeData.tyt.forEach(l => lessonSet.add(l));

  Object.values(gradeData.ayt).forEach(track => {
    track.forEach(l => lessonSet.add(l));
  });

  return [...lessonSet].sort((a, b) => a.localeCompare(b, 'tr'));
}
