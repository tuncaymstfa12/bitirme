/**
 * MEB YKS 2025-2026 Curriculum Topics
 * Organized by grade, exam type (TYT/AYT), and lesson
 */

export const CURRICULUM = {
  TYT: {
    'Türkçe': [
      'Sözcükte Anlam', 'Cümlede Anlam', 'Paragraf', 'Ses Bilgisi',
      'Yazım Kuralları', 'Noktalama İşaretleri', 'Sözcük Türleri',
      'Cümle Ögeleri', 'Fiilimsi (Eylemsi)', 'Cümle Türleri',
      'Anlatım Bozuklukları'
    ],
    'Matematik': [
      'Temel Kavramlar', 'Sayı Basamakları', 'Bölme-Bölünebilme', 'EBOB-EKOK',
      'Rasyonel Sayılar', 'Basit Eşitsizlikler', 'Mutlak Değer', 'Üslü Sayılar',
      'Köklü Sayılar', 'Çarpanlara Ayırma', 'Oran-Orantı',
      'Denklem Çözme (1. Derece)', 'Problemler', 'Kümeler',
      'Fonksiyonlar', 'Permütasyon-Kombinasyon', 'Olasılık', 'Veri-İstatistik'
    ],
    'Fizik': [
      'Fizik Bilimine Giriş', 'Madde ve Özellikleri', 'Kuvvet ve Hareket',
      'İş-Güç-Enerji', 'Isı ve Sıcaklık', 'Elektrostatik',
      'Elektrik Akımı', 'Manyetizma', 'Basınç', 'Kaldırma Kuvveti',
      'Dalgalar', 'Optik'
    ],
    'Kimya': [
      'Kimya Bilimi', 'Atom ve Periyodik Sistem', 'Kimyasal Türler Arası Etkileşim',
      'Maddenin Halleri', 'Kimyasal Hesaplamalar', 'Asitler-Bazlar-Tuzlar',
      'Karışımlar', 'Endüstride ve Canlılarda Enerji', 'Kimya Her Yerde'
    ],
    'Biyoloji': [
      'Canlıların Ortak Özellikleri', 'Hücre ve Organelleri', 'Canlıların Sınıflandırılması',
      'Hücre Bölünmeleri', 'Kalıtım', 'Ekosistem Ekolojisi',
      'Madde Döngüleri', 'Güncel Çevre Sorunları'
    ],
    'Tarih': [
      'Tarih Bilimi', 'İlk Çağ Medeniyetleri', 'İslamiyet Öncesi Türk Tarihi',
      'İslam Tarihi ve Medeniyeti', 'Türk-İslam Devletleri', 'Osmanlı Devleti (Kuruluş-Yükselme)',
      'Osmanlı Devleti (Duraklama-Gerileme)', 'Osmanlı Devleti (Dağılma)',
      'Kurtuluş Savaşı', 'Atatürk İlkeleri ve İnkılapları',
      'Çağdaş Türk ve Dünya Tarihi'
    ],
    'Coğrafya': [
      'Doğa ve İnsan', 'Harita Bilgisi', 'İklim Bilgisi',
      'İç Kuvvetler', 'Dış Kuvvetler', 'Türkiyenin Yer Şekilleri',
      'Nüfus', 'Göç', 'Ekonomik Faaliyetler',
      'Bölgeler ve Ülkeler', 'Çevre ve İnsan'
    ],
    'Felsefe': [
      'Felsefeye Giriş', 'Bilgi Felsefesi', 'Bilim Felsefesi',
      'Varlık Felsefesi', 'Ahlak Felsefesi', 'Siyaset Felsefesi',
      'Din Felsefesi', 'Sanat Felsefesi'
    ],
    'Din Kültürü': [
      'İnanç', 'İbadet', 'Ahlak', 'Hz. Muhammed ve Hadis',
      'Kur\'an ve Tefsir', 'İslam ve Bilim', 'Din ve Çevre'
    ]
  },
  AYT: {
    sayisal: {
      'Matematik': [
        'Trigonometri', 'Logaritma', 'Diziler', 'Limit ve Süreklilik',
        'Türev', 'İntegral', 'Parabol', 'İkinci Derece Denklemler',
        'Karmaşık Sayılar', 'Matris-Determinant', 'Olasılık (İleri)'
      ],
      'Fizik': [
        'Vektörler', 'Kuvvet ve Denge', 'Tork', 'Basit Makineler',
        'İş-Enerji (İleri)', 'İtme-Momentum', 'Çembersel Hareket',
        'Basit Harmonik Hareket', 'Dalga Mekaniği', 'Elektrik Alan ve Potansiyel',
        'Manyetik Alan', 'Elektromanyetik İndüksiyon', 'Modern Fizik'
      ],
      'Kimya': [
        'Modern Atom Teorisi', 'Gazlar', 'Sıvı Çözeltiler',
        'Kimyasal Tepkimelerde Enerji', 'Kimyasal Tepkimelerde Hız',
        'Kimyasal Denge', 'Asit-Baz Dengeleri', 'Elektrokimya',
        'Organik Kimyaya Giriş', 'Karbon Kimyası'
      ],
      'Biyoloji': [
        'Sinir Sistemi', 'Endokrin Sistem', 'Duyu Organları',
        'Destek ve Hareket Sistemi', 'Sindirim Sistemi', 'Dolaşım Sistemi',
        'Solunum Sistemi', 'Boşaltım Sistemi', 'Üreme Sistemi',
        'Nükleik Asitler', 'Protein Sentezi', 'Biyoteknoloji',
        'Fotosentez', 'Solunum (Hücresel)', 'Bitki Biyolojisi',
        'Komünite ve Popülasyon Ekolojisi'
      ]
    },
    esit_agirlik: {
      'Matematik': [
        'Trigonometri', 'Logaritma', 'Diziler', 'Limit ve Süreklilik',
        'Türev', 'İntegral', 'Parabol', 'İkinci Derece Denklemler',
        'Karmaşık Sayılar', 'Olasılık (İleri)'
      ],
      'Türk Dili ve Edebiyatı': [
        'İslamiyet Öncesi Türk Edebiyatı', 'İslami Dönem Türk Edebiyatı',
        'Divan Edebiyatı', 'Halk Edebiyatı', 'Tanzimat Edebiyatı',
        'Servet-i Fünun', 'Fecr-i Ati', 'Milli Edebiyat',
        'Cumhuriyet Dönemi Edebiyatı', 'Edebi Türler', 'Edebi Sanatlar',
        'Şiir Bilgisi'
      ],
      'Tarih-1': [
        'Tarih Bilimine Giriş', 'İlk Türk Devletleri', 'İslamiyetin Doğuşu',
        'Türk-İslam Devletleri', 'Osmanlı Kültür ve Medeniyeti',
        'Osmanlı Siyasi Tarihi (18-19. yy)', '20. yy Osmanlı',
        'Milli Mücadele', 'Atatürk Dönemi İç ve Dış Politika',
        'Atatürk İlke ve İnkılapları', 'İkinci Dünya Savaşı ve Sonrası'
      ],
      'Coğrafya-1': [
        'Ekosistem ve Madde Döngüleri', 'Nüfus Politikaları',
        'Şehirleşme', 'Göç ve Kültür', 'Ekonomik Coğrafya',
        'Tarım ve Hayvancılık', 'Sanayi ve Enerji',
        'Ulaşım ve Ticaret', 'Turizm', 'Çevre Sorunları ve Sürdürülebilirlik'
      ]
    },
    sozel: {
      'Türk Dili ve Edebiyatı': [
        'İslamiyet Öncesi Türk Edebiyatı', 'İslami Dönem Türk Edebiyatı',
        'Divan Edebiyatı', 'Halk Edebiyatı', 'Tanzimat Edebiyatı',
        'Servet-i Fünun', 'Fecr-i Ati', 'Milli Edebiyat',
        'Cumhuriyet Dönemi Edebiyatı', 'Edebi Türler', 'Edebi Sanatlar',
        'Şiir Bilgisi'
      ],
      'Tarih-1': [
        'Tarih Bilimine Giriş', 'İlk Türk Devletleri', 'İslamiyetin Doğuşu',
        'Türk-İslam Devletleri', 'Osmanlı Kültür ve Medeniyeti',
        'Osmanlı Siyasi Tarihi (18-19. yy)', '20. yy Osmanlı',
        'Milli Mücadele', 'Atatürk Dönemi İç ve Dış Politika',
        'Atatürk İlke ve İnkılapları', 'İkinci Dünya Savaşı ve Sonrası'
      ],
      'Tarih-2': [
        'İlk Çağ Uygarlıkları', 'Orta Çağ Avrupa', 'İslam Medeniyeti',
        'Türk Devletleri', 'Osmanlı Devleti', 'Yeni Çağ Avrupası',
        'Yakın Çağ Avrupası', 'Soğuk Savaş Dönemi',
        'Küreselleşme', 'Türk Dış Politikası'
      ],
      'Coğrafya-1': [
        'Doğal Sistemler', 'Beşeri Sistemler', 'Mekansal Sentez',
        'Küresel Ortam', 'Çevre ve Toplum', 'Türkiye Coğrafyası'
      ],
      'Coğrafya-2': [
        'Biyoçeşitlilik', 'Enerji Akışı', 'Madde Döngüleri',
        'Doğal Afetler', 'Arazi Kullanımı', 'Bölgesel Kalkınma',
        'Sürdürülebilir Çevre'
      ],
      'Felsefe Grubu': [
        'Felsefenin Konusu', 'Bilgi Felsefesi', 'Varlık Felsefesi',
        'Ahlak Felsefesi', 'Sanat Felsefesi', 'Din Felsefesi',
        'Siyaset Felsefesi', 'Bilim Felsefesi', 'Psikoloji Temel Kavramları',
        'Sosyoloji Temel Kavramları', 'Mantık', 'Toplumsal Yapı',
        'Toplumsal Değişme'
      ]
    },
    dil: {
      'İngilizce': [
        'Grammar: Tenses', 'Grammar: Modals', 'Grammar: Conditionals',
        'Grammar: Passive Voice', 'Grammar: Relative Clauses',
        'Grammar: Noun Clauses', 'Grammar: Participles',
        'Vocabulary: Academic Words', 'Vocabulary: Phrasal Verbs',
        'Vocabulary: Collocations', 'Reading Comprehension',
        'Cloze Tests', 'Paragraph Completion', 'Translation (TR-EN)',
        'Translation (EN-TR)', 'Dialogue Completion'
      ],
      'Almanca': [
        'Grammatik: Zeiten', 'Grammatik: Modalverben', 'Grammatik: Passiv',
        'Grammatik: Relativsätze', 'Wortschatz: Grundwörter',
        'Wortschatz: Akademische Wörter', 'Leseverstehen',
        'Lückentexte', 'Übersetzung', 'Dialogvervollständigung'
      ],
      'Fransızca': [
        'Grammaire: Temps', 'Grammaire: Subjonctif', 'Grammaire: Conditionnel',
        'Grammaire: Pronoms', 'Vocabulaire: Mots de Base',
        'Vocabulaire: Mots Académiques', 'Compréhension Écrite',
        'Textes à Trous', 'Traduction', 'Complétion de Dialogue'
      ],
      'Arapça': [
        'Nahiv: Fiil Çeşitleri', 'Nahiv: İsim Cümlesi', 'Nahiv: Harf-i Cerler',
        'Sarf: Fiil Kalıpları', 'Sarf: İsm-i Fail/Meful',
        'Kelime Bilgisi: Temel Kelimeler', 'Okuma-Anlama',
        'Boşluk Doldurma', 'Çeviri (TR-AR)', 'Çeviri (AR-TR)', 'Diyalog Tamamlama'
      ]
    }
  }
};

/**
 * Get topics for a given exam type and lesson
 */
export function getTopicsForLesson(examType, track, lessonName) {
  if (examType === 'TYT') {
    return CURRICULUM.TYT[lessonName] || [];
  }
  if (examType === 'AYT' && CURRICULUM.AYT[track]) {
    return CURRICULUM.AYT[track][lessonName] || [];
  }
  return [];
}

/**
 * Get all available lessons for a given exam type and track
 */
export function getLessonsForTrack(examType, track) {
  if (examType === 'TYT') {
    return Object.keys(CURRICULUM.TYT);
  }
  if (examType === 'AYT' && CURRICULUM.AYT[track]) {
    return Object.keys(CURRICULUM.AYT[track]);
  }
  return [];
}

// YKS Exam Question Distribution (2025-2026)
export const EXAM_STRUCTURE = {
  TYT: { total: 120, timeMin: 165,
    lessons: [
      { name: "Türkçe", questions: 40 },
      { name: "Matematik", questions: 40 },
      { name: "Fizik", questions: 7 },
      { name: "Kimya", questions: 7 },
      { name: "Biyoloji", questions: 6 },
      { name: "Tarih", questions: 5 },
      { name: "Coğrafya", questions: 5 },
      { name: "Felsefe", questions: 5 },
      { name: "Din Kültürü", questions: 5 }
    ]
  },
  AYT: {
    sayisal: { total: 80, timeMin: 180,
      lessons: [
        { name: "Matematik", questions: 40 },
        { name: "Fizik", questions: 14 },
        { name: "Kimya", questions: 13 },
        { name: "Biyoloji", questions: 13 }
      ]
    },
    esit_agirlik: { total: 80, timeMin: 180,
      lessons: [
        { name: "Matematik", questions: 40 },
        { name: "Türk Dili ve Edebiyatı", questions: 24 },
        { name: "Tarih-1", questions: 10 },
        { name: "Coğrafya-1", questions: 6 }
      ]
    },
    sozel: { total: 80, timeMin: 180,
      lessons: [
        { name: "Türk Dili ve Edebiyatı", questions: 24 },
        { name: "Tarih-1", questions: 10 },
        { name: "Tarih-2", questions: 11 },
        { name: "Coğrafya-1", questions: 6 },
        { name: "Coğrafya-2", questions: 5 },
        { name: "Felsefe Grubu", questions: 12 },
        { name: "Din Kültürü", questions: 12 }
      ]
    },
    dil: { total: 80, timeMin: 120, languages: ["İngilizce","Almanca","Fransızca","Arapça"], languages: ["İngilizce","Almanca","Fransızca","Arapça"],
      lessons: [
        { name: "İngilizce", questions: 80 }
      ]
    }
  }
};

// Calculate net score: correct - (wrong / 4)
export function calcNet(correct, wrong) {
  return Math.max(0, correct - (wrong / 4));
}
