require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "local-development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Please sign in first." });
    if (req.session.user.role !== role) return res.status(403).json({ error: "You do not have permission to do that." });
    next();
  };
}

// Existing installations may have been created before the admin role was added.
// Update the role constraint in place so existing attendance data is preserved.
async function migrateRoleConstraint() {
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
  await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','teacher','student'))");
}

function validEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}
function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime());
}
async function teacherOwnsSubject(subjectId, teacherId) {
  const result = await pool.query("SELECT id FROM subjects WHERE id=$1 AND teacher_id=$2", [subjectId, teacherId]);
  return result.rowCount > 0;
}

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validEmail(email) || typeof password !== "string") return res.status(400).json({ error: "Enter a valid email and password." });
    const result = await pool.query(
      "SELECT id,full_name,email,password_hash,role FROM users WHERE LOWER(email)=LOWER($1)",
      [email.trim()]
    );
    if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const row = result.rows[0];
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { id: row.id, name: row.full_name, email: row.email, role: row.role };
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ user: req.session.user });
      });
    });
  } catch (err) { next(err); }
});
app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// Student can only retrieve their own subjects and attendance. The student ID is taken from the session.
app.get("/api/student/overview", requireRole("student"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT s.id AS subject_id, s.name, s.code, s.required_attendance,
             COUNT(a.id)::int AS total_classes,
             COUNT(a.id) FILTER (WHERE a.status='present')::int AS attended,
             COUNT(a.id) FILTER (WHERE a.status='absent')::int AS absent,
             COALESCE(ROUND(100.0 * COUNT(a.id) FILTER (WHERE a.status='present') / NULLIF(COUNT(a.id),0),1),0) AS percentage
      FROM enrollments e
      JOIN subjects s ON s.id=e.subject_id
      LEFT JOIN attendance a ON a.subject_id=s.id AND a.student_id=e.student_id
      WHERE e.student_id=$1
      GROUP BY s.id,s.name,s.code
      ORDER BY s.name`, [req.session.user.id]);
    res.json({ subjects: result.rows });
  } catch (err) { next(err); }
});
app.get("/api/student/history", requireRole("student"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT a.id,a.class_date,a.status,s.name AS subject_name
      FROM attendance a JOIN subjects s ON s.id=a.subject_id
      WHERE a.student_id=$1
      ORDER BY a.class_date DESC,a.id DESC LIMIT 200`, [req.session.user.id]);
    res.json({ records: result.rows });
  } catch (err) { next(err); }
});

// Teacher APIs
app.get("/api/teacher/subjects", requireRole("teacher"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT s.id,s.name,s.code,s.required_attendance,
        COUNT(DISTINCT e.student_id)::int AS student_count
      FROM subjects s LEFT JOIN enrollments e ON e.subject_id=s.id
      WHERE s.teacher_id=$1 GROUP BY s.id ORDER BY s.name`, [req.session.user.id]);
    res.json({ subjects: result.rows });
  } catch (err) { next(err); }
});
app.post("/api/teacher/subjects", requireRole("teacher"), async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const code = String(req.body.code || "").trim();
    const criteria = Number(req.body.requiredAttendance ?? 75);
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Subject name must be 2–100 characters." });
    if (!Number.isInteger(criteria) || criteria < 1 || criteria > 100) return res.status(400).json({ error: "Required attendance must be between 1 and 100." });
    const result = await pool.query(
      "INSERT INTO subjects(name,code,required_attendance,teacher_id) VALUES($1,$2,$3,$4) RETURNING id,name,code,required_attendance",
      [name, code.slice(0,30) || null, criteria, req.session.user.id]
    );
    res.status(201).json({ subject: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already created a subject with that name." });
    next(err);
  }
});
app.get("/api/teacher/students", requireRole("teacher"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id,u.full_name,u.email,
        COALESCE(STRING_AGG(s.name, ', ' ORDER BY s.name), '') AS subjects
      FROM users u
      LEFT JOIN enrollments e ON e.student_id=u.id
      LEFT JOIN subjects s ON s.id=e.subject_id AND s.teacher_id=$1
      WHERE u.role='student'
      GROUP BY u.id ORDER BY u.full_name`, [req.session.user.id]);
    res.json({ students: result.rows });
  } catch (err) { next(err); }
});
app.post("/api/teacher/students", requireRole("teacher"), async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter a student name (2–100 characters)." });
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (typeof password !== "string" || password.length < 8 || password.length > 100) return res.status(400).json({ error: "Temporary password must be at least 8 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id,full_name,email",
      [name,email,hash]
    );
    res.status(201).json({ student: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That email address already has an account." });
    next(err);
  }
});
app.post("/api/teacher/enrollments", requireRole("teacher"), async (req, res, next) => {
  try {
    const studentId = Number(req.body.studentId), subjectId = Number(req.body.subjectId);
    if (!Number.isInteger(studentId) || !Number.isInteger(subjectId)) return res.status(400).json({ error: "Choose a student and subject." });
    if (!(await teacherOwnsSubject(subjectId, req.session.user.id))) return res.status(403).json({ error: "You can only enroll students in your own subjects." });
    const student = await pool.query("SELECT id FROM users WHERE id=$1 AND role='student'", [studentId]);
    if (!student.rowCount) return res.status(404).json({ error: "Student not found." });
    await pool.query("INSERT INTO enrollments(student_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [studentId,subjectId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
app.get("/api/teacher/timetable", requireRole("teacher"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT t.id,t.day_of_week,t.start_time,t.end_time,t.room,s.id AS subject_id,s.name AS subject_name
      FROM timetable t JOIN subjects s ON s.id=t.subject_id
      WHERE s.teacher_id=$1 ORDER BY t.day_of_week,t.start_time`, [req.session.user.id]);
    res.json({ timetable: result.rows });
  } catch (err) { next(err); }
});
app.post("/api/teacher/timetable", requireRole("teacher"), async (req, res, next) => {
  try {
    const subjectId = Number(req.body.subjectId), day = Number(req.body.day), start = req.body.start, end = req.body.end;
    const room = String(req.body.room || "").trim().slice(0,60);
    if (!Number.isInteger(subjectId) || !Number.isInteger(day) || day < 0 || day > 6 ||
        typeof start !== "string" || typeof end !== "string" || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end) {
      return res.status(400).json({ error: "Check the subject, day, and class start/end times." });
    }
    if (!(await teacherOwnsSubject(subjectId, req.session.user.id))) return res.status(403).json({ error: "You can only schedule your own subjects." });
    const result = await pool.query(
      "INSERT INTO timetable(subject_id,day_of_week,start_time,end_time,room) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [subjectId,day,start,end,room || null]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) { next(err); }
});
app.delete("/api/teacher/timetable/:id", requireRole("teacher"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      DELETE FROM timetable t USING subjects s
      WHERE t.id=$1 AND t.subject_id=s.id AND s.teacher_id=$2 RETURNING t.id`,
      [Number(req.params.id),req.session.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Timetable entry not found." });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
app.get("/api/teacher/roster", requireRole("teacher"), async (req, res, next) => {
  try {
    const subjectId = Number(req.query.subjectId), date = req.query.date, timetableId = req.query.timetableId ? Number(req.query.timetableId) : null;
    if (!Number.isInteger(subjectId) || !validDate(date)) return res.status(400).json({ error: "Choose a subject and valid class date." });
    if (!(await teacherOwnsSubject(subjectId, req.session.user.id))) return res.status(403).json({ error: "You can only take attendance for your own subjects." });
    const result = await pool.query(`
      SELECT u.id AS student_id,u.full_name,u.email,a.status,a.id AS attendance_id
      FROM enrollments e JOIN users u ON u.id=e.student_id
      LEFT JOIN attendance a ON a.student_id=u.id AND a.subject_id=e.subject_id
        AND a.class_date=$2::date AND a.timetable_id IS NOT DISTINCT FROM $3::integer
      WHERE e.subject_id=$1 ORDER BY u.full_name`, [subjectId,date,timetableId]);
    res.json({ students: result.rows });
  } catch (err) { next(err); }
});
app.post("/api/teacher/attendance/bulk", requireRole("teacher"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const subjectId = Number(req.body.subjectId), date = req.body.date;
    const timetableId = req.body.timetableId ? Number(req.body.timetableId) : null;
    const entries = req.body.entries;
    if (!Number.isInteger(subjectId) || !validDate(date) || !Array.isArray(entries) || entries.length > 500) {
      return res.status(400).json({ error: "Invalid attendance submission." });
    }
    if (!(await teacherOwnsSubject(subjectId, req.session.user.id))) return res.status(403).json({ error: "You can only mark your own subjects." });
    if (timetableId) {
      const slot = await pool.query("SELECT id FROM timetable WHERE id=$1 AND subject_id=$2", [timetableId,subjectId]);
      if (!slot.rowCount) return res.status(400).json({ error: "That timetable slot does not belong to this subject." });
    }
    await client.query("BEGIN");
    for (const entry of entries) {
      const studentId = Number(entry.studentId), status = entry.status;
      if (!Number.isInteger(studentId) || !["present","absent"].includes(status)) throw new Error("Invalid student or status in attendance list.");
      const enrolled = await client.query("SELECT 1 FROM enrollments WHERE student_id=$1 AND subject_id=$2", [studentId,subjectId]);
      if (!enrolled.rowCount) throw new Error("A selected student is not enrolled in this subject.");
      await client.query(`
        INSERT INTO attendance(student_id,subject_id,timetable_id,class_date,status,marked_by)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (student_id,subject_id,class_date,(COALESCE(timetable_id,0)))
        DO UPDATE SET status=EXCLUDED.status,marked_by=EXCLUDED.marked_by,marked_at=NOW()`,
        [studentId,subjectId,timetableId,date,status,req.session.user.id]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, saved: entries.length });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.message && err.message.startsWith("Invalid")) return res.status(400).json({ error: err.message });
    if (err.message && err.message.startsWith("A selected")) return res.status(400).json({ error: err.message });
    next(err);
  } finally { client.release(); }
});


// Admin APIs: only administrators can create teachers and assign subjects.
app.get("/api/admin/overview", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE role='teacher')::int AS teachers,
        COUNT(*) FILTER (WHERE role='student')::int AS students,
        (SELECT COUNT(*)::int FROM subjects) AS subjects,
        (SELECT COUNT(*)::int FROM attendance) AS attendance_records
      FROM users`);
    res.json({ overview: result.rows[0] });
  } catch (err) { next(err); }
});
app.get("/api/admin/teachers", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id,u.full_name,u.email,COUNT(s.id)::int AS subject_count
      FROM users u LEFT JOIN subjects s ON s.teacher_id=u.id
      WHERE u.role='teacher' GROUP BY u.id ORDER BY u.full_name`);
    res.json({ teachers: result.rows });
  } catch (err) { next(err); }
});
app.post("/api/admin/teachers", requireRole("admin"), async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter a teacher name (2–100 characters)." });
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (typeof password !== "string" || password.length < 8 || password.length > 100) return res.status(400).json({ error: "Temporary password must be at least 8 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'teacher') RETURNING id,full_name,email,role",
      [name,email,hash]
    );
    res.status(201).json({ teacher: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That email address already has an account." });
    next(err);
  }
});
app.get("/api/admin/subjects", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT s.id,s.name,s.code,s.required_attendance,s.teacher_id,u.full_name AS teacher_name,u.email AS teacher_email,
        COUNT(DISTINCT e.student_id)::int AS student_count
      FROM subjects s JOIN users u ON u.id=s.teacher_id
      LEFT JOIN enrollments e ON e.subject_id=s.id
      GROUP BY s.id,u.id ORDER BY s.name`);
    res.json({ subjects: result.rows });
  } catch (err) { next(err); }
});
app.patch("/api/admin/subjects/:id/teacher", requireRole("admin"), async (req, res, next) => {
  try {
    const subjectId = Number(req.params.id), teacherId = Number(req.body.teacherId);
    if (!Number.isInteger(subjectId) || !Number.isInteger(teacherId)) return res.status(400).json({ error: "Choose a subject and teacher." });
    const teacher = await pool.query("SELECT id FROM users WHERE id=$1 AND role='teacher'", [teacherId]);
    if (!teacher.rowCount) return res.status(404).json({ error: "Teacher account not found." });
    const result = await pool.query("UPDATE subjects SET teacher_id=$2 WHERE id=$1 RETURNING id,name", [subjectId,teacherId]);
    if (!result.rowCount) return res.status(404).json({ error: "Subject not found." });
    res.json({ ok: true, subject: result.rows[0] });
  } catch (err) { next(err); }
});

app.use("/api", (err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "A server error occurred. Check the server logs for details." });
});
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

migrateRoleConstraint()
  .then(() => app.listen(PORT, () => console.log(`Attendly running on http://localhost:${PORT}`)))
  .catch(err => { console.error("Database migration failed:", err); process.exit(1); });
