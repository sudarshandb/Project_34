# Attendly — Attendance Portal with Admin Dashboard

A full-stack Skill Lab prototype with admin, teacher, and student accounts, subject assignment, timetable slots, attendance marking, and PostgreSQL persistence.

## Features

### Admin
- Create teacher accounts with temporary passwords.
- View teacher accounts and their assigned subject counts.
- Assign existing subjects to teachers; reassignment changes which teacher can manage that subject.
- View system totals for teachers, students, subjects, and attendance records.

### Teacher
- Secure sign-in using a server-side session.
- Create subjects with an individual required attendance target (default 75%).
- Create student accounts with email and temporary password.
- Enrol students in subjects.
- Add recurring weekly timetable slots.
- Load a class roster by subject/date/slot.
- Mark each enrolled student Present or Absent and save the class together.
- Edit attendance by reloading the same date/slot and saving corrected statuses.

### Student
- Sign in to a separate student interface.
- See only their own enrolled subjects.
- View present/absent counts and percentage per subject.
- View their own attendance history.
- Students cannot call teacher endpoints successfully; role checks are enforced on the server.

### Stack
- HTML, CSS, vanilla JavaScript
- Node.js + Express
- PostgreSQL
- bcrypt password hashing and PostgreSQL-backed session storage
- Docker Compose for local setup

## Run using Docker Desktop

1. Extract this folder.
2. Open the folder in VS Code or a terminal.
3. Start Docker Desktop.
4. Run:

   ```bash
   docker compose up --build -d
   ```

5. Create the demo accounts and sample subject:

   ```bash
   docker compose exec app npm run seed
   ```

6. Open http://localhost:3000

Demo logins:
- Admin: `admin@demo.com` / `Admin123!`
- Teacher: `teacher@demo.com` / `Teacher123!`
- Student: `student@demo.com` / `Student123!`

The seed command can be run more than once. It adds the admin demo account if it does not exist. Existing demo account passwords are not reset by repeated seeding. Demo passwords are for local demonstration only.

On startup, the app updates the existing users role constraint to allow `admin`, so an existing database can be upgraded without deleting its data.

## Suggested demonstration flow

1. Sign in as admin and create another teacher account.
2. Sign in as a teacher and create a subject.
3. Sign in as admin and assign that subject to the intended teacher.
4. Sign in as that teacher and manage students, timetable, and attendance for the assigned subject.
5. Sign in as a student to show their independent record.

For the basic teacher/student flow: sign in as a teacher and follow these steps:
1. Create a subject such as Data Structures.
2. Create two student accounts using different email addresses.
3. Enrol both students in the subject.
4. Add a timetable slot.
5. Open Mark attendance, choose the subject, date and slot, mark each student Present/Absent, and save.
6. Sign out and sign in as one student. They should see only their own percentage and history.

## Important notes / next steps before real deployment

- This is a classroom prototype, not production-ready for real student records.
- Change demo credentials and `SESSION_SECRET`; use environment secrets, HTTPS, backups, and a managed PostgreSQL database before deployment.
- Add CSRF protection, rate limiting, password reset/change flows, audit logs, and stronger validation before real-world use.
- For multiple classes of the same subject on one day, select the correct timetable slot. If no slot is selected, the prototype records a single non-slot class for that date.
- A timetable slot is a recurring weekly schedule. Attendance is recorded for a specific date when the teacher loads and saves that class; it is not automatically marked just because a timetable exists.
- The SQL in `db/schema.sql` is automatically applied only when PostgreSQL initializes a fresh data volume. The app has a small startup migration for the admin role.

## Reset local demo database

Warning: this permanently deletes the local database volume and all data stored in it:

```bash
docker compose down -v
docker compose up --build -d
docker compose exec app npm run seed
```
