// reports.js — Attendance Reports page (Part 2: data logic)
// • Grade/section tab navigation (mirrors attendance.js)
// • Month navigator, fetches one attendance doc per day of the selected month
// • Overview stat cards, monthly calendar grid, day detail panel
// • Monthly per-student summary table + Print

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let allSections     = [];
let currentSection  = null;
let currentStudents = [];
let monthRecords    = {};  // { "2026-07-15": { studentId: {status, timeIn} }, ... } — weekdays only,
                           // auto-filled with {} for past school days nobody had to touch
let viewYear, viewMonth;   // viewMonth is 0-indexed (Date convention)

const today = new Date();
viewYear  = today.getFullYear();
viewMonth = today.getMonth();

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const gradeTabs      = document.getElementById("grade-tabs");
const sectionTabs     = document.getElementById("section-tabs");
const monthPicker     = document.getElementById("month-picker");
const monthLabel      = document.getElementById("month-label");
const prevMonthBtn    = document.getElementById("prev-month-btn");
const nextMonthBtn    = document.getElementById("next-month-btn");
const reportMsg       = document.getElementById("report-msg");
const reportContent   = document.getElementById("report-content");

const ovDays    = document.getElementById("ov-days");
const ovAvg     = document.getElementById("ov-avg");
const ovLate    = document.getElementById("ov-late");
const ovPerfect = document.getElementById("ov-perfect");

const reportCalendar = document.getElementById("report-calendar");

const dayDetail      = document.getElementById("day-detail");
const dayDetailTitle = document.getElementById("day-detail-title");
const ddPresent       = document.getElementById("dd-present");
const ddLate          = document.getElementById("dd-late");
const ddAbsent        = document.getElementById("dd-absent");
const ddRate           = document.getElementById("dd-rate");
const dayDetailTbody   = document.getElementById("day-detail-tbody");

const summaryNote  = document.getElementById("summary-note");
const summaryTbody = document.getElementById("summary-tbody");
const printBtn      = document.getElementById("print-btn");

const viewSwitcher          = document.getElementById("view-switcher");
const sectionReportView     = document.getElementById("section-report-view");
const leaderboardView       = document.getElementById("leaderboard-view");
const leaderboardPeriodTabs = document.getElementById("leaderboard-period-tabs");
const leaderboardMsg        = document.getElementById("leaderboard-msg");
const lbAbsentList          = document.getElementById("lb-absent-list");
const lbLateList            = document.getElementById("lb-late-list");
const lbPresentList         = document.getElementById("lb-present-list");

const reportsAuthGate = document.getElementById("reports-auth-gate");
const reportsContent  = document.getElementById("reports-content");

// ─── AUTH GATE ────────────────────────────────────────────────────────────────
// Attendance reports show student-level records, so the whole page is
// gated behind login — logged out, all that's visible is reportsAuthGate.
// This is a client-side gate only: Firestore's read rules for attendance/
// sections/students still allow public reads, since attendance.js's
// today-only view and the dashboard's stat counts both depend on that same
// public read. Turning this into a real server-side restriction would need
// a firestore.rules change that touches those two pages too.
onAuthStateChanged(auth, (user) => {
  if (!user) {
    reportsAuthGate.hidden = false;
    reportsContent.hidden  = true;
    return;
  }
  reportsAuthGate.hidden = true;
  reportsContent.hidden  = false;
  loadSections();
});

// ─── LOAD SECTIONS ────────────────────────────────────────────────────────────
async function loadSections() {
  try {
    const snap = await getDocs(collection(db, "sections"));
    allSections = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.grade - b.grade) || a.name.localeCompare(b.name));
    renderGradeTabs();
  } catch (err) {
    console.error("loadSections failed:", err);
    reportMsg.textContent = `Couldn't load sections: ${err.message}`;
    reportMsg.hidden = false;
  }
}

// ─── GRADE TABS ───────────────────────────────────────────────────────────────
function renderGradeTabs() {
  const grades = [...new Set(allSections.map((s) => s.grade))].sort((a, b) => a - b);
  if (grades.length === 0) {
    reportMsg.textContent = "No attendance data available yet.";
    reportMsg.hidden = false;
    if (!leaderboardView.hidden) loadLeaderboard();
    return;
  }
  gradeTabs.innerHTML = "";
  grades.forEach((grade, i) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tab-btn";
    btn.textContent = `Grade ${grade}`;
    btn.addEventListener("click", () => selectGrade(grade));
    gradeTabs.appendChild(btn);
    if (i === 0) selectGrade(grade);
  });
  if (!leaderboardView.hidden) loadLeaderboard();
}

// ─── SELECT GRADE ─────────────────────────────────────────────────────────────
function selectGrade(grade) {
  gradeTabs.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.textContent === `Grade ${grade}`)
  );
  const sections = allSections.filter((s) => s.grade === grade);
  sectionTabs.innerHTML = "";
  sections.forEach((section, i) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tab-btn";
    btn.textContent = section.name;
    btn.addEventListener("click", () => selectSection(section));
    sectionTabs.appendChild(btn);
    if (i === 0) selectSection(section);
  });
}

// ─── SELECT SECTION ───────────────────────────────────────────────────────────
async function selectSection(section) {
  currentSection = section;
  sectionTabs.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.textContent === section.name)
  );

  reportMsg.hidden    = true;
  monthPicker.hidden  = false;
  reportContent.hidden = false;
  dayDetail.hidden      = true;

  await loadStudents(section.id);
  await loadMonth();
}

// ─── LOAD STUDENTS ────────────────────────────────────────────────────────────
async function loadStudents(sectionId) {
  try {
    const snap = await getDocs(
      query(collection(db, "sections", sectionId, "students"), orderBy("no"))
    );
    currentStudents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    currentStudents = [];
  }
}

// ─── LOAD MONTH ATTENDANCE ────────────────────────────────────────────────────
// Attendance docs are keyed "{sectionId}_{YYYY-MM-DD}" — one per day. There's no
// query field to filter by month, so we fetch every weekday of the visible month
// in parallel and keep only the ones that actually exist.
// PCSHS holds no Saturday/Sunday classes, so weekends are skipped entirely here —
// never fetched, never counted in any stat, never shown as a rate on the calendar.
// A weekday that's already happened (or is today) but has no saved document is
// treated as a full-attendance day — same default the Attendance page itself uses
// when nobody needs marking (see tallyDay() above). This only applies from the
// go-live date onward (ATTENDANCE_START_DATE below), so the dev/testing period
// before real attendance-taking began doesn't get counted as if it happened.

// The secretaries' first real day using the system. Update this single line
// if the actual rollout date ever changes.
const ATTENDANCE_START_DATE = new Date(2026, 6, 27); // July 27, 2026 (month is 0-indexed)

async function loadMonth() {
  monthLabel.textContent = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("en-PH", { month: "long", year: "numeric" });

  reportCalendar.innerHTML =
    `<p class="muted" style="grid-column:1/-1;text-align:center;padding:20px;">Loading...</p>`;
  dayDetail.hidden = true;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStart  = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const weekdays = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(viewYear, viewMonth, day);
    const dow  = date.getDay(); // 0 = Sun, 6 = Sat
    if (dow === 0 || dow === 6) continue; // no Saturday/Sunday classes — skip entirely
    weekdays.push({ dateStr: toDateStr(viewYear, viewMonth, day), date });
  }

  monthRecords = {};
  await Promise.all(weekdays.map(async ({ dateStr, date }) => {
    try {
      const snap = await getDoc(doc(db, "attendance", `${currentSection.id}_${dateStr}`));
      if (snap.exists()) {
        monthRecords[dateStr] = snap.data().records || {};
      } else if (date >= ATTENDANCE_START_DATE && date <= todayStart) {
        // Live school day already happened, nobody needed marking — full attendance.
        monthRecords[dateStr] = {};
      }
      // else: either before go-live (no real tracking yet) or a weekday still
      // in the future — leave it out either way.
    } catch {
      // skip days that fail to load
    }
  }));

  renderOverview();
  renderCalendar();
  renderSummary();
}

function toDateStr(year, monthIdx, day) {
  const mm = String(monthIdx + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// For a given recorded day, a student with no entry in `records` was never
// flagged as an exception — same default the Attendance page itself uses:
// no entry = present. (This used to default to "absent", which is why a day
// where everyone was present — so nobody needed marking — read as 0%.)
function tallyDay(records) {
  let present = 0, late = 0, absent = 0;
  currentStudents.forEach((student) => {
    const rec = records[student.id];
    const status = rec ? rec.status : "present";
    if (status === "present") present++;
    else if (status === "late") late++;
    else absent++;
  });
  return { present, late, absent };
}

// CSS can't read a percentage out of text content, so this is how a rate value
// gets turned into a color tier — matches the .rate-great/.rate-good/.rate-poor
// (and .cal-dot equivalents) thresholds defined in style.css: ≥90 / 70–89 / <70.
function rateClass(rate) {
  if (rate >= 90) return "rate-great";
  if (rate >= 70) return "rate-good";
  return "rate-poor";
}

// ─── OVERVIEW CARDS ───────────────────────────────────────────────────────────
function renderOverview() {
  const recordedDates = Object.keys(monthRecords);
  const total = currentStudents.length;

  ovDays.textContent = recordedDates.length;

  if (recordedDates.length === 0 || total === 0) {
    ovAvg.textContent = "—";
    ovLate.textContent = "0";
    ovPerfect.textContent = "0";
    return;
  }

  let rateSum = 0, lateTotal = 0;
  recordedDates.forEach((dateStr) => {
    const { present, late } = tallyDay(monthRecords[dateStr]);
    rateSum += ((present + late) / total) * 100;
    lateTotal += late;
  });

  ovAvg.textContent = `${Math.round(rateSum / recordedDates.length)}%`;
  ovLate.textContent = lateTotal;

  const perfectCount = currentStudents.filter((student) =>
    recordedDates.every((dateStr) => {
      const rec = monthRecords[dateStr][student.id];
      const status = rec ? rec.status : "present"; // no entry = present, same as Attendance page
      return status !== "absent";
    })
  ).length;
  ovPerfect.textContent = perfectCount;
}

// ─── CALENDAR GRID ────────────────────────────────────────────────────────────
// Cell/label/dot class names below (cal-cell / cal-day-num / cal-dot) are the
// ones style.css actually styles — using different names left this calendar
// rendering completely unstyled. Saturday/Sunday cells get a third "weekend"
// state — no dot, not clickable — since PCSHS holds no weekend classes.
function renderCalendar() {
  reportCalendar.innerHTML = "";
  const daysInMonth   = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday  = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  // Leading blanks so day 1 lands under the correct weekday column
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-cell empty";
    reportCalendar.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(viewYear, viewMonth, day);
    const dow     = new Date(viewYear, viewMonth, day).getDay(); // 0 = Sun, 6 = Sat
    const records = monthRecords[dateStr];

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (isCurrentMonth && day === today.getDate()) cell.classList.add("today");

    const num = document.createElement("span");
    num.className = "cal-day-num";
    num.textContent = day;
    cell.appendChild(num);

    if (dow === 0 || dow === 6) {
      // No Saturday/Sunday classes at PCSHS — no dot, not clickable, nothing to tally.
      cell.classList.add("weekend");
    } else {
      // Every school-day cell gets a dot — colored by rate when there's data,
      // muted "rate-none" when there isn't — so the grid reads consistently.
      const dot = document.createElement("span");
      dot.className = "cal-dot";

      if (records) {
        const { present, late, absent } = tallyDay(records);
        const total = present + late + absent;
        const rate = total ? Math.round(((present + late) / total) * 100) : 0;

        cell.classList.add("has-data");
        dot.classList.add(rateClass(rate));
        dot.textContent = `${rate}%`;

        cell.addEventListener("click", () => showDayDetail(dateStr, records));
      } else {
        cell.classList.add("no-data");
        dot.classList.add("rate-none");
        dot.textContent = "–";
      }

      cell.appendChild(dot);
    }

    reportCalendar.appendChild(cell);
  }
}

// ─── DAY DETAIL PANEL ─────────────────────────────────────────────────────────
function showDayDetail(dateStr, records) {
  dayDetail.hidden = false;

  const [y, m, d] = dateStr.split("-").map(Number);
  dayDetailTitle.textContent = new Date(y, m - 1, d)
    .toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const { present, late, absent } = tallyDay(records);
  const total = present + late + absent;
  ddPresent.textContent = present;
  ddLate.textContent    = late;
  ddAbsent.textContent  = absent;
  ddRate.textContent    = total ? `${Math.round(((present + late) / total) * 100)}% Attendance` : "";

  dayDetailTbody.innerHTML = "";
  currentStudents.forEach((student) => {
    const rec    = records[student.id];
    const status = rec ? rec.status : "present"; // no entry = present, same as Attendance page
    const timeIn = rec && rec.timeIn ? rec.timeIn : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.no}</td>
      <td>${student.name}</td>
      <td>${student.gender}</td>
      <td><span class="status-badge ${status}">${status}</span></td>
      <td>${timeIn}</td>`;
    dayDetailTbody.appendChild(tr);
  });

  dayDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ─── MONTHLY PER-STUDENT SUMMARY ──────────────────────────────────────────────
function renderSummary() {
  const recordedDates = Object.keys(monthRecords);
  summaryNote.textContent = recordedDates.length
    ? `Based on ${recordedDates.length} recorded day(s) this month.`
    : "No attendance has been recorded yet for this month.";

  summaryTbody.innerHTML = "";
  currentStudents.forEach((student) => {
    let present = 0, late = 0, absent = 0;
    recordedDates.forEach((dateStr) => {
      const rec = monthRecords[dateStr][student.id];
      const status = rec ? rec.status : "present"; // no entry = present, same as Attendance page
      if (status === "present") present++;
      else if (status === "late") late++;
      else absent++;
    });
    const total = recordedDates.length;
    const rate  = total ? Math.round(((present + late) / total) * 100) : 0;
    const rateCell = total
      ? `<td class="${rateClass(rate)}">${rate}%</td>`
      : `<td>—</td>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.no}</td>
      <td>${student.name}</td>
      <td>${student.gender}</td>
      <td>${present}</td>
      <td>${late}</td>
      <td>${absent}</td>
      ${rateCell}`;
    summaryTbody.appendChild(tr);
  });
}

// ─── MONTH NAVIGATION ─────────────────────────────────────────────────────────
prevMonthBtn.addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (currentSection) loadMonth();
});

nextMonthBtn.addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  if (currentSection) loadMonth();
});

// ─── LEADERBOARDS ─────────────────────────────────────────────────────────────
// School-wide, across every section — separate from the per-section report
// above. Ranked by percentage of the section (not raw count), so a big
// section can't out-rank a small one on headcount alone; the raw count is
// shown alongside. "Most Present" only counts days that have an actual
// attendance document — the auto-100%-present fallback used in loadMonth()
// above is correct for the single-section report ("no document" and "took
// attendance, everyone present" should look the same there), but crediting
// a section for days nobody logged in and marked anything would make this
// leaderboard reward missing data instead of real attendance. Note: like
// the rest of Reports, this tallies against the CURRENT roster, so a section
// formed partway through the range is credited as if every current student
// was enrolled the whole time — same known limitation as the existing
// monthly summary above, not something new introduced here.
let leaderboardPeriod        = "day"; // "day" | "week" | "month"
let leaderboardDaysBySection = {};    // sectionId -> [{ dateStr, records }] from the latest load
let rosterCache               = {};   // sectionId -> students[], lazy-loaded per section on first expand

function getLeaderboardRange(period) {
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === "day") return { startDateStr: todayStr, endDateStr: todayStr };

  if (period === "week") {
    const dow = today.getDay(); // 0 = Sun ... 6 = Sat
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
    return {
      startDateStr: toDateStr(monday.getFullYear(), monday.getMonth(), monday.getDate()),
      endDateStr: todayStr,
    };
  }

  return { startDateStr: toDateStr(today.getFullYear(), today.getMonth(), 1), endDateStr: todayStr };
}

async function loadLeaderboard() {
  const { startDateStr, endDateStr } = getLeaderboardRange(leaderboardPeriod);
  const lists = [lbAbsentList, lbLateList, lbPresentList];

  leaderboardMsg.hidden = true;
  lists.forEach((el) => { el.innerHTML = `<li class="leaderboard-empty">Loading...</li>`; });

  if (allSections.length === 0) return; // renderGradeTabs() re-calls this once sections arrive

  let snap;
  try {
    // Single range query across every section at once — much cheaper than a
    // per-section, per-day getDoc loop, and the only field it filters on
    // (date) is a single-field range, so it doesn't need a composite index.
    const q = query(
      collection(db, "attendance"),
      where("date", ">=", startDateStr),
      where("date", "<=", endDateStr)
    );
    snap = await getDocs(q);
  } catch (err) {
    console.error("loadLeaderboard failed:", err);
    leaderboardMsg.textContent = `Couldn't load leaderboard data: ${err.message}`;
    leaderboardMsg.hidden = false;
    lists.forEach((el) => (el.innerHTML = ""));
    return;
  }

  leaderboardDaysBySection = {};
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (!data.sectionId) return;
    (leaderboardDaysBySection[data.sectionId] ||= []).push({ dateStr: data.date, records: data.records || {} });
  });

  const stats = allSections
    .map((section) => {
      const days  = leaderboardDaysBySection[section.id] || [];
      const total = (section.maleCount || 0) + (section.femaleCount || 0);
      let absent = 0, late = 0;
      days.forEach(({ records }) => {
        Object.values(records).forEach((rec) => {
          if (rec.status === "absent") absent++;
          else if (rec.status === "late") late++;
        });
      });
      const slots   = total * days.length;
      const present = Math.max(slots - absent - late, 0);
      return {
        section, total, daysWithDoc: days.length,
        absent, late, present,
        absentPct:  slots ? Math.round((absent  / slots) * 100) : 0,
        latePct:    slots ? Math.round((late    / slots) * 100) : 0,
        presentPct: slots ? Math.round((present / slots) * 100) : 0,
      };
    })
    .filter((s) => s.daysWithDoc > 0 && s.total > 0);

  if (stats.length === 0) {
    leaderboardMsg.textContent = "No attendance has been recorded yet for this period.";
    leaderboardMsg.hidden = false;
    lists.forEach((el) => (el.innerHTML = ""));
    return;
  }

  renderLeaderboardList(lbAbsentList,  [...stats].sort((a, b) => b.absentPct  - a.absentPct  || b.absent  - a.absent),  "absent",  "absences");
  renderLeaderboardList(lbLateList,    [...stats].sort((a, b) => b.latePct    - a.latePct    || b.late    - a.late),    "late",    "late marks");
  renderLeaderboardList(lbPresentList, [...stats].sort((a, b) => b.presentPct - a.presentPct || b.present - a.present), "present", "present marks");
}

// ─── LEADERBOARD LIST + PER-STUDENT DRILL-DOWN ────────────────────────────────
function renderLeaderboardList(listEl, sortedStats, category, countLabel) {
  listEl.innerHTML = "";
  sortedStats.forEach((stat, i) => {
    const li = document.createElement("li");
    li.className = "leaderboard-row";
    li.innerHTML = `
      <div class="leaderboard-row-header">
        <span class="leaderboard-rank">${i + 1}</span>
        <span class="leaderboard-section-name">Grade ${stat.section.grade} – ${stat.section.name}</span>
        <span class="leaderboard-stats">
          <span class="leaderboard-pct">${stat[`${category}Pct`]}%</span>
          <span class="leaderboard-count">${stat[category]} ${countLabel}</span>
        </span>
        <span class="leaderboard-toggle">+</span>
      </div>
      <div class="leaderboard-students"></div>`;
    li.querySelector(".leaderboard-row-header")
      .addEventListener("click", () => toggleLeaderboardRow(li, stat, category));
    listEl.appendChild(li);
  });
}

async function toggleLeaderboardRow(li, stat, category) {
  const wasOpen = li.classList.contains("open");
  li.parentElement.querySelectorAll(".leaderboard-row.open").forEach((row) => row.classList.remove("open"));
  if (wasOpen) return;
  li.classList.add("open");

  const studentsEl = li.querySelector(".leaderboard-students");
  studentsEl.innerHTML = `<p class="leaderboard-empty">Loading students...</p>`;

  const sectionId = stat.section.id;
  if (!rosterCache[sectionId]) {
    try {
      const rosterSnap = await getDocs(
        query(collection(db, "sections", sectionId, "students"), orderBy("no"))
      );
      rosterCache[sectionId] = rosterSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      rosterCache[sectionId] = [];
    }
  }

  const roster = rosterCache[sectionId];
  const days   = leaderboardDaysBySection[sectionId] || [];
  const tally  = {};
  roster.forEach((s) => { tally[s.id] = 0; });
  days.forEach(({ records }) => {
    roster.forEach((s) => {
      const rec    = records[s.id];
      const status = rec ? rec.status : "present";
      if (status === category) tally[s.id]++;
    });
  });

  const rows = roster
    .map((s) => ({ name: s.name, count: tally[s.id] || 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  studentsEl.innerHTML = rows.length
    ? rows.map((r) => `
        <div class="leaderboard-student-row">
          <span class="leaderboard-student-name">${r.name}</span>
          <span class="leaderboard-student-count">${r.count}×</span>
        </div>`).join("")
    : `<p class="leaderboard-empty">No students to show.</p>`;
}

// ─── VIEW SWITCHER + PERIOD TABS ───────────────────────────────────────────────
viewSwitcher.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    viewSwitcher.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    const isLeaderboard = btn.dataset.view === "leaderboard";
    sectionReportView.hidden = isLeaderboard;
    leaderboardView.hidden   = !isLeaderboard;
    if (isLeaderboard) loadLeaderboard();
  });
});

leaderboardPeriodTabs.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    leaderboardPeriodTabs.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    leaderboardPeriod = btn.dataset.period;
    loadLeaderboard();
  });
});

// ─── PRINT ────────────────────────────────────────────────────────────────────
printBtn.addEventListener("click", () => {
  window.print();
});