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
-- 9. STUDENT_SETTINGS
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
-- 10. AUTH_SESSIONS
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
