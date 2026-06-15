-- ============================================================
-- StudyEngine — PostgreSQL Schema
-- Derived from src/data/models.js, auth.js, store.js and
-- server/authServer.js runtime behaviour.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. PARTS LOOKUP (say / ea / dil / sözel)
-- ============================================================
CREATE TABLE parts (
  id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(10)  NOT NULL UNIQUE,
  name VARCHAR(50)  NOT NULL
);

INSERT INTO parts (code, name) VALUES
  ('say',   'Sayısal'),
  ('ea',    'Eşit Ağırlık'),
  ('dil',   'Dil'),
  ('sozel', 'Sözel');

-- ============================================================
-- 2. STUDENTS (primary)
-- ============================================================
CREATE TYPE grade_t           AS ENUM ('11', '12');
CREATE TYPE lesson_strength_t AS ENUM ('strong', 'weak');

CREATE TABLE students (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  unique_id     VARCHAR(50)  NOT NULL UNIQUE,
  grade         grade_t      NOT NULL,
  age           SMALLINT     NOT NULL CHECK (age BETWEEN 14 AND 20),
  part_id       SMALLINT     NOT NULL REFERENCES parts(id),
  phone_number  VARCHAR(20),
  birthdate     DATE         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT chk_age_birth CHECK (
    EXTRACT(YEAR FROM age(birthdate)) BETWEEN age - 1 AND age
  )
);

CREATE INDEX idx_students_email     ON students (lower(email));
CREATE INDEX idx_students_unique_id ON students (lower(unique_id));

-- ============================================================
-- 3. LESSONS (from auth.js LESSONS)
-- ============================================================
CREATE TABLE lessons (
  id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  grade   grade_t      NOT NULL,
  name    VARCHAR(100) NOT NULL,
  type    VARCHAR(3)   NOT NULL CHECK (type IN ('TYT', 'AYT')),
  part_id SMALLINT     REFERENCES parts(id),
  UNIQUE (grade, name, type, part_id)
);

INSERT INTO lessons (grade, name, type, part_id) VALUES
  -- TYT (all tracks, all grades)
  ('11','Türkçe','TYT',NULL),('11','Matematik','TYT',NULL),('11','Fizik','TYT',NULL),
  ('11','Kimya','TYT',NULL),('11','Biyoloji','TYT',NULL),('11','Tarih','TYT',NULL),
  ('11','Coğrafya','TYT',NULL),('11','Felsefe','TYT',NULL),('11','Din Kültürü','TYT',NULL),
  ('12','Türkçe','TYT',NULL),('12','Matematik','TYT',NULL),('12','Fizik','TYT',NULL),
  ('12','Kimya','TYT',NULL),('12','Biyoloji','TYT',NULL),('12','Tarih','TYT',NULL),
  ('12','Coğrafya','TYT',NULL),('12','Felsefe','TYT',NULL),('12','Din Kültürü','TYT',NULL),
  -- AYT – Sayısal 11
  ('11','Matematik','AYT',(SELECT id FROM parts WHERE code='say')),
  ('11','Fizik','AYT',(SELECT id FROM parts WHERE code='say')),
  ('11','Kimya','AYT',(SELECT id FROM parts WHERE code='say')),
  ('11','Biyoloji','AYT',(SELECT id FROM parts WHERE code='say')),
  -- AYT – EA 11
  ('11','Matematik','AYT',(SELECT id FROM parts WHERE code='ea')),
  ('11','Türk Dili ve Edebiyatı','AYT',(SELECT id FROM parts WHERE code='ea')),
  ('11','Tarih','AYT',(SELECT id FROM parts WHERE code='ea')),
  ('11','Coğrafya','AYT',(SELECT id FROM parts WHERE code='ea')),
  -- AYT – Sözel 11
  ('11','Türk Dili ve Edebiyatı','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('11','Tarih','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('11','Coğrafya','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('11','Felsefe Grubu','AYT',(SELECT id FROM parts WHERE code='sozel')),
  -- AYT – Dil 11
  ('11','İngilizce','AYT',(SELECT id FROM parts WHERE code='dil')),
  -- AYT – Sayısal 12
  ('12','Matematik','AYT',(SELECT id FROM parts WHERE code='say')),
  ('12','Fizik','AYT',(SELECT id FROM parts WHERE code='say')),
  ('12','Kimya','AYT',(SELECT id FROM parts WHERE code='say')),
  ('12','Biyoloji','AYT',(SELECT id FROM parts WHERE code='say')),
  -- AYT – EA 12
  ('12','Matematik','AYT',(SELECT id FROM parts WHERE code='ea')),
  ('12','Türk Dili ve Edebiyatı','AYT',(SELECT id FROM parts WHERE code='ea')),
  ('12','Tarih-1','AYT',(SELECT id FROM parts WHERE code='ea')),
  ('12','Coğrafya-1','AYT',(SELECT id FROM parts WHERE code='ea')),
  -- AYT – Sözel 12
  ('12','Türk Dili ve Edebiyatı','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('12','Tarih-1','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('12','Tarih-2','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('12','Coğrafya-1','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('12','Coğrafya-2','AYT',(SELECT id FROM parts WHERE code='sozel')),
  ('12','Felsefe Grubu','AYT',(SELECT id FROM parts WHERE code='sozel')),
  -- AYT – Dil 12
  ('12','İngilizce','AYT',(SELECT id FROM parts WHERE code='dil'));

-- ============================================================
-- 4. STUDENT_LESSONS (strong / weak)
-- ============================================================
CREATE TABLE student_lessons (
  id         UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID              NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id  UUID              NOT NULL REFERENCES lessons(id)  ON DELETE CASCADE,
  strength   lesson_strength_t NOT NULL,
  UNIQUE (student_id, lesson_id)
);

CREATE INDEX idx_sl_student ON student_lessons (student_id);

-- ============================================================
-- 5. EXAMS
-- ============================================================
CREATE TABLE exams (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  date       DATE         NOT NULL,
  color      VARCHAR(7)   NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_exams_student ON exams (student_id);
CREATE INDEX idx_exams_date    ON exams (student_id, date);

-- ============================================================
-- 6. TOPICS
-- ============================================================
CREATE TABLE topics (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id           UUID        NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id        UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  exam_type         VARCHAR(10) NOT NULL DEFAULT 'TYT',
  track             VARCHAR(20) NOT NULL DEFAULT 'sayisal',
  lesson            VARCHAR(100) NOT NULL DEFAULT '',
  weight            SMALLINT    NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
  self_assessment   SMALLINT    NOT NULL DEFAULT 3 CHECK (self_assessment BETWEEN 1 AND 5),
  estimated_minutes INT         NOT NULL DEFAULT 60 CHECK (estimated_minutes >= 30),
  completed_minutes INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_topics_exam    ON topics (exam_id);
CREATE INDEX idx_topics_student ON topics (student_id);

-- ============================================================
-- 7. STUDY_SESSIONS
-- ============================================================
CREATE TYPE session_status_t AS ENUM ('scheduled','completed','missed','break');

CREATE TABLE study_sessions (
  id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id         UUID             REFERENCES topics(id) ON DELETE CASCADE,
  student_id       UUID             NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date             DATE             NOT NULL,
  start_hour       SMALLINT         NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  start_minute     SMALLINT         NOT NULL DEFAULT 0 CHECK (start_minute BETWEEN 0 AND 59),
  duration_minutes SMALLINT         NOT NULL DEFAULT 30,
  status           session_status_t NOT NULL DEFAULT 'scheduled',
  completed_at     TIMESTAMPTZ,
  notes            TEXT             NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_student ON study_sessions (student_id);
CREATE INDEX idx_sessions_date    ON study_sessions (student_id, date);
CREATE INDEX idx_sessions_topic   ON study_sessions (topic_id);

-- ============================================================
-- 8. MOCK_RESULTS
-- ============================================================
CREATE TABLE mock_results (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id   UUID        NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  student_id UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score      SMALLINT    NOT NULL CHECK (score >= 0),
  max_score  SMALLINT    NOT NULL DEFAULT 100 CHECK (max_score > 0),
  date       DATE        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_score_leq_max CHECK (score <= max_score)
);

CREATE INDEX idx_mock_results_topic   ON mock_results (topic_id);
CREATE INDEX idx_mock_results_student ON mock_results (student_id);

-- ============================================================
-- 9. QUESTION BANK
-- ============================================================
CREATE TABLE questions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_type      VARCHAR(3)  NOT NULL CHECK (exam_type IN ('TYT', 'AYT')),
  track          VARCHAR(20) NOT NULL DEFAULT 'sayisal',
  lesson         VARCHAR(100) NOT NULL,
  topic_name     VARCHAR(255) NOT NULL,
  question_no    INT,
  question_text  TEXT        NOT NULL,
  question_image_url TEXT,
  correct_option CHAR(1)     NOT NULL CHECK (correct_option IN ('A','B','C','D','E')),
  explanation    TEXT        NOT NULL DEFAULT '',
  source_name    VARCHAR(255) NOT NULL DEFAULT '',
  source_year    INT,
  difficulty     SMALLINT    NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_student ON questions (student_id);
CREATE INDEX idx_questions_topic   ON questions (student_id, exam_type, lesson, topic_name);

CREATE TABLE question_options (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID    NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_key       CHAR(1) NOT NULL CHECK (option_key IN ('A','B','C','D','E')),
  option_text      TEXT    NOT NULL DEFAULT '',
  option_image_url TEXT,
  UNIQUE (question_id, option_key)
);

CREATE INDEX idx_question_options_question ON question_options (question_id);

CREATE TABLE student_answers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id     UUID        NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option CHAR(1)     NOT NULL CHECK (selected_option IN ('A','B','C','D','E')),
  is_correct      BOOLEAN     NOT NULL,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, question_id)
);

CREATE INDEX idx_student_answers_student ON student_answers (student_id);
CREATE INDEX idx_student_answers_question ON student_answers (question_id);

-- ============================================================
-- 10. GLOBAL ADMIN QUESTION IMPORTS
-- ============================================================
CREATE TABLE admin_question_imports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by    UUID        REFERENCES students(id) ON DELETE SET NULL,
  exam_type      VARCHAR(3)  NOT NULL CHECK (exam_type IN ('TYT', 'AYT')),
  track          VARCHAR(20) NOT NULL DEFAULT 'sayisal',
  source_name    VARCHAR(255) NOT NULL,
  source_year    INT,
  status         VARCHAR(20) NOT NULL DEFAULT 'completed',
  raw_text       TEXT        NOT NULL DEFAULT '',
  answer_key     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  imported_count INT         NOT NULL DEFAULT 0,
  review_count   INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_imports_created ON admin_question_imports (created_at DESC);

CREATE TABLE global_questions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id        UUID        NOT NULL REFERENCES admin_question_imports(id) ON DELETE CASCADE,
  exam_type        VARCHAR(3)  NOT NULL CHECK (exam_type IN ('TYT', 'AYT')),
  track            VARCHAR(20) NOT NULL DEFAULT 'sayisal',
  lesson           VARCHAR(100) NOT NULL DEFAULT '',
  topic_name       VARCHAR(255) NOT NULL DEFAULT '',
  question_no      INT         NOT NULL,
  question_text    TEXT        NOT NULL,
  correct_option   CHAR(1)     CHECK (correct_option IN ('A','B','C','D','E')),
  topic_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  source_name      VARCHAR(255) NOT NULL DEFAULT '',
  source_year      INT,
  needs_review     BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_type, source_name, source_year, question_no)
);

CREATE INDEX idx_global_questions_import ON global_questions (import_id);
CREATE INDEX idx_global_questions_topic ON global_questions (exam_type, lesson, topic_name);

CREATE TABLE global_question_options (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID    NOT NULL REFERENCES global_questions(id) ON DELETE CASCADE,
  option_key  CHAR(1) NOT NULL CHECK (option_key IN ('A','B','C','D','E')),
  option_text TEXT    NOT NULL DEFAULT '',
  UNIQUE (question_id, option_key)
);

CREATE INDEX idx_global_question_options_question ON global_question_options (question_id);

-- ============================================================
-- 11. BOOKLET IMPORT MVP
-- ============================================================
CREATE TABLE booklet_tests (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(255) NOT NULL,
  exam_type    VARCHAR(20)  NOT NULL DEFAULT '',
  booklet_type VARCHAR(50)  NOT NULL DEFAULT '',
  pdf_path     TEXT         NOT NULL DEFAULT '',
  review_path  TEXT         NOT NULL DEFAULT '',
  status       VARCHAR(20)  NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_booklet_tests_created ON booklet_tests (created_at DESC);

CREATE TABLE booklet_sections (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       UUID         NOT NULL REFERENCES booklet_tests(id) ON DELETE CASCADE,
  section_code  VARCHAR(80)  NOT NULL,
  section_name  VARCHAR(255) NOT NULL,
  section_order INT          NOT NULL DEFAULT 1,
  start_page    INT,
  end_page      INT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (test_id, section_code)
);

CREATE INDEX idx_booklet_sections_test ON booklet_sections (test_id, section_order);

CREATE TABLE booklet_questions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id                 UUID        NOT NULL REFERENCES booklet_tests(id) ON DELETE CASCADE,
  section_id              UUID        NOT NULL REFERENCES booklet_sections(id) ON DELETE CASCADE,
  section_question_number INT         NOT NULL,
  global_question_order   INT         NOT NULL,
  image_path              TEXT        NOT NULL,
  correct_answer          CHAR(1)     CHECK (correct_answer IN ('A','B','C','D','E')),
  choices                 JSONB       NOT NULL DEFAULT '["A","B","C","D","E"]'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, section_id, section_question_number),
  UNIQUE (test_id, global_question_order)
);

CREATE INDEX idx_booklet_questions_test ON booklet_questions (test_id, global_question_order);

-- ============================================================
-- 12. STUDENT_SETTINGS
-- ============================================================
CREATE TABLE student_settings (
  student_id         UUID  PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  weights            JSONB NOT NULL DEFAULT '{
    "urgency":0.35,"topicWeight":0.25,"weakness":0.25,"performance":0.15
  }',
  constraints        JSONB NOT NULL DEFAULT '{
    "maxConsecutiveSameSubject":3,"breakFrequency":3,"minDailySubjects":2,
    "maxDailySlotsCount":12,"spacedRepetitionGapDays":1,"slotDurationMinutes":30
  }',
  daily_availability JSONB NOT NULL DEFAULT '{
    "0":[{"start":10,"end":14}],
    "1":[{"start":8,"end":12},{"start":14,"end":18}],
    "2":[{"start":8,"end":12},{"start":14,"end":18}],
    "3":[{"start":8,"end":12},{"start":14,"end":18}],
    "4":[{"start":8,"end":12},{"start":14,"end":18}],
    "5":[{"start":8,"end":12},{"start":14,"end":18}],
    "6":[{"start":10,"end":14}]
  }',
  rescheduling       JSONB NOT NULL DEFAULT '{
    "compressionFactor":0.75,"mediumPriorityThreshold":0.4,"maxDailyExtension":2
  }'
);

-- ============================================================
-- 13. AUTH_SESSIONS
-- ============================================================
CREATE TABLE auth_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token      VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_auth_token    ON auth_sessions (token);
CREATE INDEX idx_auth_expires  ON auth_sessions (expires_at);

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM auth_sessions WHERE expires_at <= now();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VIEW: v_student_profile (safe projection)
-- ============================================================
CREATE VIEW v_student_profile AS
SELECT s.id, s.email, s.name, s.unique_id, s.grade, s.age,
       p.code AS part_code, p.name AS part_name,
       s.phone_number, s.birthdate, s.created_at
FROM students s
JOIN parts p ON p.id = s.part_id;
