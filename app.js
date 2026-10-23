const $ = id => document.getElementById(id);
let currentUser = null;
let teacherSubjects = [];
let students = [];
let timetable = [];
let roster = [];
let selectedStatus = new Map();

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function showNotice(text, isError = false) {
  const box = $("notice"); box.textContent = text; box.classList.remove("hidden","error-notice");
  if (isError) box.classList.add("error-notice");
  window.scrollTo({top:0,behavior:"smooth"});
  setTimeout(() => box.classList.add("hidden"), 5000);
}
function setView(view) {
  document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
  const target = $(`view-${view}`); if (target) target.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active",el.dataset.view===view));
  const titles = {home:"Overview",admin:"Admin management",subjects:"Subjects",students:"Students & enrolment",timetable:"Timetable",mark:"Mark attendance"};
  $("pageTitle").textContent = titles[view] || "Overview";
  if (view==="subjects") loadTeacherSubjects();
  if (view==="students") loadStudents();
  if (view==="timetable") loadTimetable();
  if (view==="mark") refreshMarkSubjects();
  if (view==="home") loadHome();
  if (view==="admin") loadAdminManagement();
}
function showLoggedIn(user) {
  currentUser = user;
  $("loginScreen").classList.add("hidden"); $("appScreen").classList.remove("hidden");
  $("userName").textContent = user.name; $("userRole").textContent = user.role;
  $("userAvatar").textContent = (user.name || "U").trim().charAt(0).toUpperCase();
  const teacher = user.role === "teacher";
  const admin = user.role === "admin";
  $("roleKicker").textContent = admin ? "ADMIN WORKSPACE" : teacher ? "TEACHER WORKSPACE" : "STUDENT SPACE";
  document.querySelectorAll(".teacher-only").forEach(el => el.classList.toggle("hidden",!teacher));
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden",!admin));
  $("welcomeTitle").textContent = `Welcome, ${user.name.split(" ")[0]}`;
  $("welcomeCopy").textContent = admin ? "Manage teacher accounts and subject assignments across Attendly." : teacher ? "Manage your assigned subjects, class timetable, and student attendance." : "Here is your personal subject-wise attendance overview.";
  setView("home");
}
async function login(event) {
  event.preventDefault(); $("loginError").textContent = "";
  try {
    const result = await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("loginEmail").value.trim(),password:$("loginPassword").value})});
    showLoggedIn(result.user);
  } catch (err) { $("loginError").textContent = err.message; }
}
async function logout() {
  try { await api("/api/auth/logout",{method:"POST",body:"{}"}); } catch {}
  currentUser=null; $("appScreen").classList.add("hidden"); $("loginScreen").classList.remove("hidden");
  $("loginPassword").value=""; $("loginError").textContent="";
}
function statCard(label,value,foot) { return `<article class="stat-card"><span class="stat-label">${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(foot)}</small></article>`; }
async function loadHome() {
  if (!currentUser) return;
  if (currentUser.role === "student") {
    $("studentOverview").classList.remove("hidden"); $("teacherOverview").classList.add("hidden"); $("adminOverview").classList.add("hidden");
    try {
      const [overview,history] = await Promise.all([api("/api/student/overview"),api("/api/student/history")]);
      const subjects = overview.subjects;
      const classes = subjects.reduce((n,s)=>n+Number(s.total_classes),0);
      const attended = subjects.reduce((n,s)=>n+Number(s.attended),0);
      const overall = classes ? (attended/classes*100).toFixed(1)+"%" : "—";
      $("studentStats").innerHTML = statCard("My subjects",subjects.length,"Enrolled subjects") + statCard("Classes attended",attended,`${classes} recorded classes`) + statCard("Overall attendance",overall,"Across recorded classes");
      $("studentSubjects").innerHTML = subjects.length ? subjects.map(s=>{
        const pct=Number(s.percentage),total=Number(s.total_classes),needed=classesNeeded(Number(s.attended),total,75);
        const target=Number(s.required_attendance||75); const targetNeeded=classesNeeded(Number(s.attended),total,target); const targetText=total===0?`No attendance recorded · Target ${target}%`:pct>=target?`At or above ${target}% target`:`Below ${target}% target · Attend ${targetNeeded} consecutive classes`;
        return `<article class="subject-card"><div class="subject-card-top"><div><h4>${escapeHTML(s.name)}</h4><div class="subject-code">${escapeHTML(s.code||"Subject")} · Target ${Number(s.required_attendance||75)}%</div></div><div class="percent">${total?pct.toFixed(1)+"%":"—"}</div></div><div class="track"><span class="${pct<75?"low":""}" style="width:${Math.min(100,pct)}%"></span></div><div class="subject-stats"><div><small>Classes held</small><strong>${total}</strong></div><div><small>Present</small><strong>${s.attended}</strong></div><div><small>Absent</small><strong>${s.absent}</strong></div></div><p><span class="pill ${pct>=Number(s.required_attendance||75)&&total?"good":"low"}">${escapeHTML(targetText)}</span></p></article>`;
      }).join("") : '<div class="empty">You are not enrolled in any subjects yet. Ask your teacher to enrol your account.</div>';
      $("studentHistory").innerHTML = history.records.length ? history.records.map(r=>`<tr><td>${formatDate(r.class_date)}</td><td>${escapeHTML(r.subject_name)}</td><td><span class="pill ${r.status}">${r.status==="present"?"Present":"Absent"}</span></td></tr>`).join("") : '<tr><td colspan="3" class="empty">Your attendance history will appear here after your teacher records a class.</td></tr>';
    } catch(err) { showNotice(err.message,true); }
  } else if (currentUser.role === "admin") {
    $("adminOverview").classList.remove("hidden"); $("teacherOverview").classList.add("hidden"); $("studentOverview").classList.add("hidden");
    try {
      const data = await api("/api/admin/overview"); const o = data.overview;
      $("adminStats").innerHTML = statCard("Teachers",o.teachers,"Teacher accounts") + statCard("Students",o.students,"Student accounts") + statCard("Subjects",o.subjects,"Subjects across Attendly") + statCard("Attendance records",o.attendance_records,"Saved class records");
    } catch(err) { showNotice(err.message,true); }
  } else {
    $("teacherOverview").classList.remove("hidden"); $("studentOverview").classList.add("hidden"); $("adminOverview").classList.add("hidden");
    try {
      const [subs,stu,slots] = await Promise.all([api("/api/teacher/subjects"),api("/api/teacher/students"),api("/api/teacher/timetable")]);
      teacherSubjects=subs.subjects; students=stu.students; timetable=slots.timetable;
      $("teacherStats").innerHTML=statCard("My subjects",teacherSubjects.length,"Subjects created by you")+statCard("Student accounts",students.length,"Accounts in the system")+statCard("Timetable slots",timetable.length,"Recurring weekly classes");
    } catch(err) { showNotice(err.message,true); }
  }
}

async function loadAdminManagement() {
  try {
    const [teacherData,subjectData] = await Promise.all([api("/api/admin/teachers"),api("/api/admin/subjects")]);
    const teachers=teacherData.teachers, subjects=subjectData.subjects;
    $("adminTeachersList").innerHTML = teachers.length ? teachers.map(t=>`<div class="list-row"><div><strong>${escapeHTML(t.full_name)}</strong><small>${escapeHTML(t.email)}</small></div><span class="meta">${t.subject_count} assigned subject(s) · ID ${t.id}</span></div>`).join("") : '<div class="empty">No teachers yet. Create the first teacher account above.</div>';
    $("adminTeacherSelect").innerHTML=optionList(teachers,t=>`${t.full_name} (${t.email})`);
    $("adminSubjectSelect").innerHTML=optionList(subjects,s=>`${s.name}${s.code?` (${s.code})`:""} · ${s.teacher_name}`);
    $("adminSubjectsList").innerHTML=subjects.length ? subjects.map(s=>`<div class="list-row"><div><strong>${escapeHTML(s.name)} ${s.code?`· ${escapeHTML(s.code)}`:""}</strong><small>${s.student_count} student(s) · Target ${Number(s.required_attendance||75)}% · Teacher: ${escapeHTML(s.teacher_name)} (${escapeHTML(s.teacher_email)})</small></div><span class="meta">Subject ID: ${s.id}</span></div>`).join("") : '<div class="empty">No subjects have been created yet. A teacher can create a subject first.</div>';
  } catch(err) { showNotice(err.message,true); }
}

function classesNeeded(attended,total,target) {
  if (!total || attended/total*100>=target) return 0;
  if (target>=100) return total-attended;
  return Math.max(0,Math.ceil((target*total-100*attended)/(100-target)));
}
function formatDate(value) {
  const d = new Date(`${String(value).slice(0,10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
}
function optionList(items, labelFn, selected="") {
  return `<option value="">Choose...</option>`+items.map(item=>`<option value="${item.id}" ${String(item.id)===String(selected)?"selected":""}>${escapeHTML(labelFn(item))}</option>`).join("");
}
async function loadTeacherSubjects() {
  try {
    const data=await api("/api/teacher/subjects"); teacherSubjects=data.subjects;
    $("teacherSubjects").innerHTML=teacherSubjects.length?teacherSubjects.map(s=>`<div class="list-row"><div><strong>${escapeHTML(s.name)} ${s.code?`· ${escapeHTML(s.code)}`:""}</strong><small>${s.student_count} enrolled student(s) · Target ${Number(s.required_attendance||75)}%</small></div><span class="meta">Subject ID: ${s.id}</span></div>`).join(""):'<div class="empty">No subjects yet. Create your first subject above.</div>';
    fillSubjectSelects();
  } catch(err){showNotice(err.message,true);}
}
async function loadStudents() {
  try {
    const data=await api("/api/teacher/students"); students=data.students;
    $("studentsList").innerHTML=students.length?students.map(s=>`<div class="list-row"><div><strong>${escapeHTML(s.full_name)}</strong><small>${escapeHTML(s.email)}</small></div><span class="meta">${escapeHTML(s.subjects||"Not enrolled yet")}</span></div>`).join(""):'<div class="empty">No student accounts yet. Create a student account above.</div>';
    $("enrollStudent").innerHTML=optionList(students,s=>`${s.full_name} (${s.email})`);
    await loadTeacherSubjects();
  } catch(err){showNotice(err.message,true);}
}
function fillSubjectSelects() {
  const selects=["enrollSubject","timetableSubject","rosterSubject"];
  selects.forEach(id=>{if($(id)) {const old=$(id).value;$(id).innerHTML=optionList(teacherSubjects,s=>s.code?`${s.name} (${s.code})`:s.name,old);}});
  updateRosterSlots();
}
async function loadTimetable() {
  try {
    const [subs,slots]=await Promise.all([api("/api/teacher/subjects"),api("/api/teacher/timetable")]);
    teacherSubjects=subs.subjects;timetable=slots.timetable;fillSubjectSelects();
    $("timetableList").innerHTML=timetable.length?timetable.map(t=>`<div class="list-row"><div><strong>${escapeHTML(t.subject_name)}</strong><small>${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][t.day_of_week]} · ${String(t.start_time).slice(0,5)}–${String(t.end_time).slice(0,5)}${t.room?" · "+escapeHTML(t.room):""}</small></div><button class="btn secondary delete-slot" data-id="${t.id}" type="button">Remove</button></div>`).join(""):'<div class="empty">No timetable slots yet. Add a weekly class above.</div>';
    document.querySelectorAll(".delete-slot").forEach(btn=>btn.addEventListener("click",async()=>{if(!confirm("Remove this timetable slot?"))return;try{await api(`/api/teacher/timetable/${btn.dataset.id}`,{method:"DELETE"});showNotice("Timetable slot removed.");loadTimetable();}catch(err){showNotice(err.message,true);}}));
  }catch(err){showNotice(err.message,true);}
}
function updateRosterSlots() {
  if (!$("rosterSlot")) return;
  const subjectId=$("rosterSubject").value;
  const old=$("rosterSlot").value;
  const slots=timetable.filter(t=>String(t.subject_id)===String(subjectId));
  $("rosterSlot").innerHTML='<option value="">No specific slot</option>'+slots.map(t=>`<option value="${t.id}" ${String(t.id)===old?"selected":""}>${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][t.day_of_week]} ${String(t.start_time).slice(0,5)}–${String(t.end_time).slice(0,5)}${t.room?" · "+escapeHTML(t.room):""}</option>`).join("");
}
async function refreshMarkSubjects() {
  try {const [subs,slots]=await Promise.all([api("/api/teacher/subjects"),api("/api/teacher/timetable")]);teacherSubjects=subs.subjects;timetable=slots.timetable;fillSubjectSelects();updateRosterSlots();}catch(err){showNotice(err.message,true);}
}
async function loadRoster(event) {
  event.preventDefault();
  const subjectId=$("rosterSubject").value,date=$("rosterDate").value,timetableId=$("rosterSlot").value;
  if(!subjectId||!date){showNotice("Choose a subject and class date.",true);return;}
  try {
    const data=await api(`/api/teacher/roster?subjectId=${encodeURIComponent(subjectId)}&date=${encodeURIComponent(date)}&timetableId=${encodeURIComponent(timetableId)}`);
    roster=data.students;selectedStatus=new Map(roster.map(s=>[String(s.student_id),s.status||"present"]));
    renderRoster(subjectId,date,timetableId);
  }catch(err){showNotice(err.message,true);}
}
function renderRoster(subjectId,date,timetableId) {
  const subject=teacherSubjects.find(s=>String(s.id)===String(subjectId));
  if(!roster.length){$("rosterArea").innerHTML='<div class="empty">No students are enrolled in this subject. Enrol students first.</div>';return;}
  $("rosterArea").innerHTML=`<div class="roster-toolbar"><div><strong>${escapeHTML(subject?.name||"Class roster")}</strong><div class="muted">${formatDate(date)} · ${roster.length} students</div></div><button id="saveAttendance" class="btn primary" type="button">Save attendance ✓</button></div><div class="table-scroll"><table><thead><tr><th>Student</th><th>Email</th><th style="text-align:right">Mark status</th></tr></thead><tbody>${roster.map(s=>`<tr><td><div class="row-person"><span class="person-dot">${escapeHTML(s.full_name.charAt(0).toUpperCase())}</span><strong>${escapeHTML(s.full_name)}</strong></div></td><td>${escapeHTML(s.email)}</td><td><div class="attendance-controls"><button class="attendance-choice ${selectedStatus.get(String(s.student_id))==="present"?"selected present":""}" data-student="${s.student_id}" data-status="present" type="button">✓ Present</button><button class="attendance-choice ${selectedStatus.get(String(s.student_id))==="absent"?"selected absent":""}" data-student="${s.student_id}" data-status="absent" type="button">✕ Absent</button></div></td></tr>`).join("")}</tbody></table></div>`;
  document.querySelectorAll(".attendance-choice").forEach(btn=>btn.addEventListener("click",()=>{selectedStatus.set(String(btn.dataset.student),btn.dataset.status);document.querySelectorAll(`.attendance-choice[data-student="${btn.dataset.student}"]`).forEach(b=>{b.classList.remove("selected","present","absent");if(b.dataset.status===btn.dataset.status)b.classList.add("selected",btn.dataset.status);});}));
  $("saveAttendance").addEventListener("click",async()=>{
    const entries=roster.map(s=>({studentId:s.student_id,status:selectedStatus.get(String(s.student_id))||"present"}));
    try{const result=await api("/api/teacher/attendance/bulk",{method:"POST",body:JSON.stringify({subjectId:Number(subjectId),date,timetableId:timetableId||null,entries})});showNotice(`Saved attendance for ${result.saved} student(s).`);await loadRosterFromCurrent();}
    catch(err){showNotice(err.message,true);}
  });
}
async function loadRosterFromCurrent() {
  const subjectId=$("rosterSubject").value,date=$("rosterDate").value,timetableId=$("rosterSlot").value;
  const data=await api(`/api/teacher/roster?subjectId=${encodeURIComponent(subjectId)}&date=${encodeURIComponent(date)}&timetableId=${encodeURIComponent(timetableId)}`);
  roster=data.students;selectedStatus=new Map(roster.map(s=>[String(s.student_id),s.status||"present"]));renderRoster(subjectId,date,timetableId);
}
$("loginForm").addEventListener("submit",login);
$("logoutButton").addEventListener("click",logout);
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.go)));
$("subjectCreateForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/teacher/subjects",{method:"POST",body:JSON.stringify({name:$("newSubjectName").value.trim(),code:$("newSubjectCode").value.trim(),requiredAttendance:Number($("newSubjectCriteria").value)})});e.target.reset();showNotice("Subject created.");loadTeacherSubjects();}catch(err){showNotice(err.message,true);}});
$("teacherCreateForm").addEventListener("submit",async e=>{e.preventDefault();try{const r=await api("/api/admin/teachers",{method:"POST",body:JSON.stringify({name:$("newTeacherName").value.trim(),email:$("newTeacherEmail").value.trim(),password:$("newTeacherPassword").value})});e.target.reset();showNotice(`Teacher account created for ${r.teacher.full_name}. Share the temporary password securely.`);loadAdminManagement();loadHome();}catch(err){showNotice(err.message,true);}});
$("assignSubjectForm").addEventListener("submit",async e=>{e.preventDefault();try{const subjectId=$("adminSubjectSelect").value,teacherId=$("adminTeacherSelect").value;if(!subjectId||!teacherId){showNotice("Choose a subject and teacher.",true);return;}await api(`/api/admin/subjects/${subjectId}/teacher`,{method:"PATCH",body:JSON.stringify({teacherId})});showNotice("Subject assigned to teacher. The previous teacher can no longer manage it.");loadAdminManagement();loadHome();}catch(err){showNotice(err.message,true);}});
$("studentCreateForm").addEventListener("submit",async e=>{e.preventDefault();try{const r=await api("/api/teacher/students",{method:"POST",body:JSON.stringify({name:$("newStudentName").value.trim(),email:$("newStudentEmail").value.trim(),password:$("newStudentPassword").value})});e.target.reset();showNotice(`Student account created for ${r.student.full_name}. Enrol them in subjects next.`);loadStudents();}catch(err){showNotice(err.message,true);}});
$("enrollForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/teacher/enrollments",{method:"POST",body:JSON.stringify({studentId:$("enrollStudent").value,subjectId:$("enrollSubject").value})});showNotice("Student enrolled in subject.");loadStudents();}catch(err){showNotice(err.message,true);}});
$("timetableForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/teacher/timetable",{method:"POST",body:JSON.stringify({subjectId:$("timetableSubject").value,day:$("timetableDay").value,start:$("timetableStart").value,end:$("timetableEnd").value,room:$("timetableRoom").value})});e.target.reset();showNotice("Timetable slot added.");loadTimetable();}catch(err){showNotice(err.message,true);}});
$("rosterForm").addEventListener("submit",loadRoster);
$("rosterSubject").addEventListener("change",updateRosterSlots);
async function init() {
  const now=new Date();$("rosterDate").value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  try{const data=await api("/api/me");if(data.user)showLoggedIn(data.user);}catch{}
}
init();
