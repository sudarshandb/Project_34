CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(12) NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(30),
  required_attendance SMALLINT NOT NULL DEFAULT 75 CHECK (required_attendance BETWEEN 1 AND 100),
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, name)
);

CREATE TABLE IF NOT EXISTS enrollments (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS timetable (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room VARCHAR(60),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  timetable_id INTEGER REFERENCES timetable(id) ON DELETE SET NULL,
  class_date DATE NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('present', 'absent')),
  marked_by INTEGER NOT NULL REFERENCES users(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULL timetable slots represent an unscheduled class; treat NULL as a single slot for uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_class
  ON attendance(student_id, subject_id, class_date, (COALESCE(timetable_id, 0)));

CREATE INDEX IF NOT EXISTS idx_attendance_student_subject ON attendance(student_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(class_date);
CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable(day_of_week);
