require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const teacherHash = await bcrypt.hash("Teacher123!", 12);
    const studentHash = await bcrypt.hash("Student123!", 12);

    const adminHash = await bcrypt.hash("Admin123!", 12);
    const admin = await client.query(
      `INSERT INTO users(full_name,email,password_hash,role)
       VALUES ($1,$2,$3,'admin')
       ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name
       RETURNING id`,
      ["Attendly Admin", "admin@demo.com", adminHash]
    );

    const teacher = await client.query(
      `INSERT INTO users(full_name,email,password_hash,role)
       VALUES ($1,$2,$3,'teacher')
       ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name
       RETURNING id`,
      ["Demo Teacher", "teacher@demo.com", teacherHash]
    );
    const student = await client.query(
      `INSERT INTO users(full_name,email,password_hash,role)
       VALUES ($1,$2,$3,'student')
       ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name
       RETURNING id`,
      ["Demo Student", "student@demo.com", studentHash]
    );

    const subject = await client.query(
      `INSERT INTO subjects(name,code,required_attendance,teacher_id)
       VALUES ('Introduction to Programming','CS101',75,$1)
       ON CONFLICT(teacher_id,name) DO UPDATE SET code=EXCLUDED.code
       RETURNING id`,
      [teacher.rows[0].id]
    );
    await client.query(
      `INSERT INTO enrollments(student_id,subject_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [student.rows[0].id, subject.rows[0].id]
    );

    // Add one example timetable slot (Monday); do not duplicate it on repeated seeding.
    await client.query(
      `INSERT INTO timetable(subject_id,day_of_week,start_time,end_time,room)
       SELECT $1,1,'09:00','10:00','Lab 1'
       WHERE NOT EXISTS (
         SELECT 1 FROM timetable WHERE subject_id=$1 AND day_of_week=1
           AND start_time='09:00' AND end_time='10:00'
       )`,
      [subject.rows[0].id]
    );
    await client.query("COMMIT");
    console.log("Demo data ready.");
    console.log("Admin: admin@demo.com / Admin123!");
    console.log("Teacher: teacher@demo.com / Teacher123!");
    console.log("Student: student@demo.com / Student123!");
    console.log("Change these demo passwords before using real student data.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
