// attendance.js — Full rewrite with:
// • Y-coordinate PDF extraction (proper line grouping)
// • PCSHS-format parser (MALE/FEMALE headers, no M/F column per row)
// • Multi-section import from a single PDF
// • Grade/section tab navigation
// • Click-to-mark attendance: manual Present → Absent → Late cycle

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let isAdminOrStaff   = false;
let userRole         = null;  // "admin" | "staff" | "secretary" | null
let secretarySections = [];   // section IDs this secretary is allowed to touch (only used if userRole === "secretary")
let allSections     = [];
let currentSection  = null;
let currentStudents = [];
let attendanceRecs  = {};
let importedSections = []; // [{ grade, sectionName, adviser, room, maleCount, femaleCount, students }]

// ─── TODAY ────────────────────────────────────────────────────────────────────
const today   = new Date();
const dateStr = today.toISOString().split("T")[0];
document.getElementById("attendance-date").textContent =
  today.toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const gradeTabs           = document.getElementById("grade-tabs");
const sectionTabs         = document.getElementById("section-tabs");
const classHeader         = document.getElementById("class-header");
const classTitle          = document.getElementById("class-title");
const classAdviser        = document.getElementById("class-adviser");
const attendanceTableWrap = document.getElementById("attendance-table-wrap");
const attendanceTbody     = document.getElementById("attendance-tbody");
const attendanceMsg       = document.getElementById("attendance-msg");
const adminTools          = document.getElementById("admin-tools");
const statPresent         = document.getElementById("stat-present");
const statLate            = document.getElementById("stat-late");
const statAbsent          = document.getElementById("stat-absent");
const statTotal           = document.getElementById("stat-total");

// ─── AUTH ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdminOrStaff     = false;
    userRole           = null;
    secretarySections  = [];
    adminTools.hidden  = true;
  } else {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      userRole          = data.role || null;
      secretarySections = Array.isArray(data.assignedSections) ? data.assignedSections : [];
      isAdminOrStaff    = userRole === "admin" || userRole === "staff";
      adminTools.hidden = !isAdminOrStaff;
    } catch {
      isAdminOrStaff    = false;
      userRole          = null;
      secretarySections = [];
      adminTools.hidden = true;
    }
  }
  loadSections();
});

// A secretary only ever sees the section(s) listed on their own account.
// Admin/staff see everything, exactly as before.
function getVisibleSections() {
  if (userRole === "secretary") {
    return allSections.filter((s) => secretarySections.includes(s.id));
  }
  return allSections;
}

// ─── LOAD SECTIONS ────────────────────────────────────────────────────────────
async function loadSections() {
  try {
    // No orderBy here — composite indexes aren't auto-created on new projects.
    // We sort the result in JavaScript instead, which works without any index.
    const snap = await getDocs(collection(db, "sections"));
    allSections = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.grade - b.grade) || a.name.localeCompare(b.name));
    renderGradeTabs();
  } catch (err) {
    console.error("loadSections failed:", err);
    attendanceMsg.textContent = `Couldn't load sections: ${err.message}`;
    attendanceMsg.hidden = false;
  }
}

// ─── GRADE TABS ───────────────────────────────────────────────────────────────
function renderGradeTabs() {
  const visible = getVisibleSections();
  const grades  = [...new Set(visible.map((s) => s.grade))].sort((a, b) => a - b);
  if (grades.length === 0) {
    if (isAdminOrStaff) {
      attendanceMsg.textContent = "No class lists yet. Click \"Import Class List from PDF\" to get started.";
    } else if (userRole === "secretary") {
      attendanceMsg.textContent = "No section has been assigned to your account yet. Contact your admin.";
    } else {
      attendanceMsg.textContent = "No attendance data available yet.";
    }
    attendanceMsg.hidden = false;
    return;
  }
  attendanceMsg.hidden = true;
  gradeTabs.innerHTML  = "";
  grades.forEach((grade, i) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tab-btn";
    btn.textContent = `Grade ${grade}`;
    btn.addEventListener("click", () => selectGrade(grade));
    gradeTabs.appendChild(btn);
    if (i === 0) selectGrade(grade);
  });
}

// ─── SELECT GRADE ─────────────────────────────────────────────────────────────
function selectGrade(grade) {
  gradeTabs.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.textContent === `Grade ${grade}`)
  );
  const sections = getVisibleSections().filter((s) => s.grade === grade);
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
  let title = `Grade ${section.grade} – ${section.name}`;
  if (section.room) title += ` | Room ${section.room}`;
  if (section.maleCount != null)
    title += ` (${section.maleCount} Male • ${section.femaleCount} Female)`;
  classTitle.textContent   = title;
  classAdviser.textContent = section.adviser ? `Class Adviser: ${section.adviser}` : "";
  classHeader.hidden         = false;
  attendanceTableWrap.hidden = false;
  attendanceMsg.hidden       = true;

  // Show delete section button only to admin/staff
  const deleteSectionBtn = document.getElementById("delete-section-btn");
  if (deleteSectionBtn) {
    deleteSectionBtn.hidden = !isAdminOrStaff;
    deleteSectionBtn.onclick = deleteSection;
  }
  attendanceTbody.innerHTML  =
    `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--muted)">Loading...</td></tr>`;
  await Promise.all([loadStudents(section.id), loadAttendance(section.id)]);
  renderTable();
}

// ─── LOAD STUDENTS ────────────────────────────────────────────────────────────
async function loadStudents(sectionId) {
  try {
    const snap = await getDocs(
      query(collection(db, "sections", sectionId, "students"), orderBy("no"))
    );
    currentStudents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch { currentStudents = []; }
}

// ─── LOAD ATTENDANCE ──────────────────────────────────────────────────────────
async function loadAttendance(sectionId) {
  try {
    const snap = await getDoc(doc(db, "attendance", `${sectionId}_${dateStr}`));
    attendanceRecs = snap.exists() ? snap.data().records || {} : {};
  } catch { attendanceRecs = {}; }
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  let present = 0, late = 0, absent = 0;
  attendanceTbody.innerHTML = "";

  // Admin/staff can mark ANY section. A secretary can only mark the section
  // they're actually assigned to — checked against their own account, not
  // just assumed from being logged in.
  const canMark = isAdminOrStaff ||
    (userRole === "secretary" && currentSection && secretarySections.includes(currentSection.id));

  // Show/hide the Actions column header based on role — roster management
  // (deleting a student) stays admin/staff only, even for secretaries who can mark attendance.
  const actionTh = document.getElementById("action-th");
  if (actionTh) actionTh.hidden = !isAdminOrStaff;

  currentStudents.forEach((student) => {
    const rec    = attendanceRecs[student.id];
    const status = rec ? rec.status : "present";
    const timeIn = rec && rec.timeIn ? rec.timeIn : "—";
    if (status === "present") present++;
    else if (status === "late") late++;
    else absent++;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.no}</td>
      <td>${student.name}</td>
      <td>${student.gender}</td>
      <td><span class="status-badge ${status}${canMark ? " clickable" : ""}"
               data-id="${student.id}">${status.toUpperCase()}</span></td>
      <td>${timeIn}</td>
      ${isAdminOrStaff ? `<td><button class="delete-student-btn" data-id="${student.id}" data-name="${student.name}" title="Remove this student">✕ Remove</button></td>` : ""}`;
    attendanceTbody.appendChild(tr);
  });

  statPresent.textContent = present;
  statLate.textContent    = late;
  statAbsent.textContent  = absent;
  statTotal.textContent   = currentStudents.length;

  if (canMark) {
    attendanceTbody.querySelectorAll(".status-badge.clickable").forEach((badge) =>
      badge.addEventListener("click", () => markAttendance(badge.dataset.id))
    );
  }
  if (isAdminOrStaff) {
    attendanceTbody.querySelectorAll(".delete-student-btn").forEach((btn) =>
      btn.addEventListener("click", () => deleteStudent(btn.dataset.id, btn.dataset.name))
    );
  }
}

// ─── MARK ATTENDANCE ──────────────────────────────────────────────────────────
// Manual 3-state cycle: Absent → Present → Late → Absent. It's the secretary's
// call, not the clock's — the old version checked the current time at the
// moment of the click, so clicking any time after the cutoff sent every
// student straight to "late" and "present" became unreachable. Only "Late"
// records a time (worth knowing how late); Present/Absent don't need one.
async function markAttendance(studentId) {
  const rec    = attendanceRecs[studentId];
  const status = rec ? rec.status : "present";
  let newStatus, newTimeIn;

  if (status === "present") {
    newStatus = "late";
    newTimeIn = new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
  } else if (status === "late") {
    newStatus = "absent";
    newTimeIn = null;
  } else {
    newStatus = "present";
    newTimeIn = null;
  }

  if (newStatus === "present") delete attendanceRecs[studentId];
  else attendanceRecs[studentId] = { status: newStatus, timeIn: newTimeIn };
  
  renderTable();
  try {
    await setDoc(doc(db, "attendance", `${currentSection.id}_${dateStr}`), {
      sectionId: currentSection.id, date: dateStr,
      records: attendanceRecs, updatedAt: serverTimestamp(),
    });
  } catch (e) { console.error("Save failed:", e); }
}

// ─── CONFIRM MODAL (themed replacement for window.confirm) ────────────────────
const confirmModal     = document.getElementById("confirm-modal");
const confirmTitleEl   = document.getElementById("confirm-title");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmOkBtn     = document.getElementById("confirm-ok-btn");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");

// Shows the shared confirm modal and resolves true/false depending on the
// button clicked — same calling convention as window.confirm(), just async.
function askConfirm({ title = "Are you sure?", message = "", confirmLabel = "Delete" } = {}) {
  return new Promise((resolve) => {
    confirmTitleEl.textContent   = title;
    confirmMessageEl.textContent = message;
    confirmOkBtn.textContent     = confirmLabel;
    confirmModal.hidden = false;

    function settle(result) {
      confirmModal.hidden = true;
      confirmOkBtn.removeEventListener("click", onOk);
      confirmCancelBtn.removeEventListener("click", onCancel);
      confirmModal.removeEventListener("click", onOverlay);
      resolve(result);
    }
    function onOk()       { settle(true); }
    function onCancel()   { settle(false); }
    function onOverlay(e) { if (e.target === confirmModal) settle(false); }

    confirmOkBtn.addEventListener("click", onOk);
    confirmCancelBtn.addEventListener("click", onCancel);
    confirmModal.addEventListener("click", onOverlay);
  });
}

// ─── DELETE ONE STUDENT ───────────────────────────────────────────────────────
async function deleteStudent(studentId, studentName) {
  const confirmed = await askConfirm({
    title: "Remove student?",
    message: `Remove "${studentName}" from this section? This can't be undone.`,
    confirmLabel: "Remove",
  });
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "sections", currentSection.id, "students", studentId));
    currentStudents = currentStudents.filter(s => s.id !== studentId);
    if (attendanceRecs[studentId]) {
      delete attendanceRecs[studentId];
      await setDoc(doc(db, "attendance", `${currentSection.id}_${dateStr}`), {
        sectionId: currentSection.id, date: dateStr,
        records: attendanceRecs, updatedAt: serverTimestamp(),
      });
    }
    renderTable();
  } catch (err) {
    console.error("Delete student failed:", err);
    window.alert("Delete failed: " + err.message);
  }
}

// ─── DELETE ENTIRE SECTION ────────────────────────────────────────────────────
async function deleteSection() {
  if (!currentSection) return;
  const label = `Grade ${currentSection.grade} – ${currentSection.name}`;
  const confirmed = await askConfirm({
    title: "Delete this section?",
    message: `Delete the entire "${label}" section? This permanently removes all ${currentStudents.length} students and can't be undone.`,
    confirmLabel: "Delete Section",
  });
  if (!confirmed) return;

  const sectionId = currentSection.id;
  try {
    const studentSnap = await getDocs(collection(db, "sections", sectionId, "students"));
    if (!studentSnap.empty) {
      const BATCH_LIMIT = 499;
      for (let i = 0; i < studentSnap.docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        studentSnap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(db, "sections", sectionId));
    allSections           = allSections.filter(s => s.id !== sectionId);
    currentSection        = null;
    currentStudents       = [];
    attendanceRecs        = {};
    classHeader.hidden         = true;
    attendanceTableWrap.hidden = true;
    renderGradeTabs();
  } catch (err) {
    console.error("Delete section failed:", err);
    window.alert("Delete failed: " + err.message);
  }
}

// ─── IMPORT MODAL REFS ────────────────────────────────────────────────────────
const importModal     = document.getElementById("import-modal");
const importStep1     = document.getElementById("import-step-1");
const importStep2     = document.getElementById("import-step-2");
const pdfDropzone     = document.getElementById("pdf-dropzone");
const pdfFileInput    = document.getElementById("pdf-file-input");
const pdfDropzoneText = document.getElementById("pdf-dropzone-text");
const pdfParseStatus  = document.getElementById("pdf-parse-status");
const importSaveBtn   = document.getElementById("import-save-btn");
const importCancelBtn = document.getElementById("import-cancel-btn");
const importSaveStatus = document.getElementById("import-save-status");
const importSectionsList = document.getElementById("import-sections-list");
const importSectionsSummary = document.getElementById("import-sections-summary");

function closeImportModal() {
  importModal.hidden = true;
  importedSections   = [];
}

document.getElementById("import-btn").addEventListener("click", () => {
  importModal.hidden       = false;
  importStep1.hidden       = false;
  importStep2.hidden       = true;
  importSaveBtn.hidden     = true;
  pdfParseStatus.textContent  = "";
  importSaveStatus.textContent = "";
  pdfDropzoneText.textContent = "📄 Click to choose a PDF, or drag it here";
  pdfFileInput.value = "";
  importedSections   = [];
  importSectionsList.innerHTML = "";
});
importCancelBtn.addEventListener("click", closeImportModal);
importModal.addEventListener("click", (e) => { if (e.target === importModal) closeImportModal(); });

pdfDropzone.addEventListener("click", () => pdfFileInput.click());
pdfDropzone.addEventListener("dragover", (e) => { e.preventDefault(); pdfDropzone.classList.add("dragover"); });
pdfDropzone.addEventListener("dragleave", () => pdfDropzone.classList.remove("dragover"));
pdfDropzone.addEventListener("drop", (e) => {
  e.preventDefault(); pdfDropzone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
});
pdfFileInput.addEventListener("change", () => {
  if (pdfFileInput.files[0]) handlePdfFile(pdfFileInput.files[0]);
});

// ─── HANDLE PDF UPLOAD ────────────────────────────────────────────────────────
async function handlePdfFile(file) {
  if (file.type !== "application/pdf") {
    pdfParseStatus.textContent = "Please upload a PDF file."; return;
  }
  pdfDropzoneText.textContent = `📄 ${file.name}`;
  pdfParseStatus.textContent  = "Reading PDF...";
  try {
    const pages    = await extractTextFromPdf(file);
    const sections = parsePcshsPages(pages);

    if (sections.length === 0) {
      pdfParseStatus.textContent =
        "No sections detected. Make sure this is a text-based (not scanned) PDF.";
      return;
    }

    importedSections = sections;
    renderSectionsInModal(sections);

    importStep2.hidden   = false;
    importSaveBtn.hidden = false;
    pdfParseStatus.textContent =
      `✓ Detected ${sections.length} section(s). Review below then click Save All Sections.`;
  } catch (err) {
    pdfParseStatus.textContent = "Couldn't read PDF: " + err.message;
  }
}

// ─── SHARED HELPER: group raw PDF text items into reading-order lines ────────
// Sorts top-to-bottom (Y descending), breaks a new line whenever the Y-gap
// between consecutive items exceeds 4px, and sorts left-to-right within each
// line. Used both for whole-page text (grade/adviser/room extraction below)
// and, inside extractStudentsFromItems, to reconstruct a single row's own
// text once its items have already been correctly grouped by row number.
function toLines(items) {
  const filtered = items.filter(i => i.str.trim());
  if (!filtered.length) return "";

  const sorted = [...filtered].sort((a, b) => b.transform[5] - a.transform[5]);

  const rows = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i - 1].transform[5] - sorted[i].transform[5];
    if (gap > 4) rows.push([]);          // new row
    rows[rows.length - 1].push(sorted[i]);
  }

  return rows.map(joinRowItems).join("\n");
}

// Joins items on one already-grouped line using their real horizontal
// positions rather than always inserting a space. Confirmed against an
// actual PDF: a multi-digit row number can come out of PDF.js as separate
// single-character items with ZERO gap between them — e.g. "10" arriving
// as "1" then "0", one ending exactly where the next begins — while every
// genuine word/column boundary in that same file had a real gap (smallest
// one measured was still about a third of the text's own height). The
// threshold below sits comfortably beneath that, so it only ever treats a
// near-zero gap as "no space" and leaves every real gap — even a narrow
// one between two short words — untouched.
function joinRowItems(row) {
  const sortedRow = [...row].sort((a, b) => a.transform[4] - b.transform[4]);
  let result = "";
  let prevEndX = null;
  for (const item of sortedRow) {
    const str = item.str.trim();
    if (!str) continue;
    const startX = item.transform[4];
    const height = item.height || 10;
    if (prevEndX !== null && (startX - prevEndX) > height * 0.15) {
      result += " ";
    }
    result += str;
    prevEndX = startX + (item.width || 0);
  }
  return result;
}

// ─── EXTRACT TEXT FROM PDF (Y-coordinate line grouping) ───────────────────────
async function extractTextFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf    = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pages  = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page     = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content  = await page.getTextContent();
    const allItems = content.items.filter(item => item.str.trim());

    // ── Find the actual MALE and FEMALE header positions on this page ──
    // This is far more accurate than guessing the midpoint from page width,
    // because it uses the real column positions the PDF itself defines.
    let maleX = null, femaleX = null;
    for (const item of allItems) {
      const s = item.str.trim().toUpperCase();
      if (s === "MALE"   && maleX   === null) maleX   = item.transform[4];
      if (s === "FEMALE" && femaleX === null) femaleX = item.transform[4];
    }

    // Column split = midpoint between the two table headers.
    // Fall back to page midpoint if headers aren't found on this page.
    const splitX = (maleX !== null && femaleX !== null)
      ? (maleX + femaleX) / 2
      : viewport.width / 2;

    // Raw items per column (with coordinates intact) — student rows are
    // reconstructed straight from these below, rather than from flattened
    // text, so row numbers that don't align neatly with a single text line
    // can still be matched up correctly.
    pages.push({
      fullText:   toLines(allItems),
      leftItems:  allItems.filter(item => item.transform[4] <  splitX),
      rightItems: allItems.filter(item => item.transform[4] >= splitX),
    });
  }
  return pages;
}

// ─── PARSE ALL PAGES (one section per page for PCSHS format) ─────────────────
function parsePcshsPages(pages) {
  return pages
    .map(parseSingleSection)
    .filter((s) => s && s.students.length > 0);
}

// ─── PARSE ONE SECTION PAGE ───────────────────────────────────────────────────
// Now receives { fullText, leftItems, rightItems } from extractTextFromPdf
function parseSingleSection({ fullText, leftItems, rightItems }) {
  const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);

  let grade = null, sectionName = null, adviser = null, room = null;

  for (const line of lines) {
    if (/Republic|Department|Division|Legaspi|CLASS LIST|School Year|PASIG CITY SCIENCE/i.test(line)) continue;

    // "Grade 12 – BERNOULLI" — digits may come as "1 2" from PDF, strip spaces
    if (!grade) {
      const m = line.match(/Grade\s+([\d\s]{1,4})\s*[–\-\u2013\u2014]\s*([A-Z][A-Z]+)/i);
      if (m) {
        grade = parseInt(m[1].replace(/\s/g, ""));
        sectionName = m[2].trim();
      }
    }

    // "Class Adviser: Ms. Elizabeth P. Regencia" — trim ROOM if on same line
    if (!adviser) {
      const m = line.match(/Class\s*Adviser\s*:\s*(.+)/i);
      if (m) adviser = m[1].replace(/\s*ROOM\s*:.*$/i, "").trim();
    }

    // "ROOM: 201"
    if (!room) {
      const m = line.match(/ROOM\s*:\s*(\d+)/i);
      if (m) room = m[1];
    }
  }

  // Extract students from each column separately — this is what fixes the F:0 bug
  const males   = extractStudentsFromItems(leftItems);
  const females = extractStudentsFromItems(rightItems);

  const students = [
    ...males.sort((a, b)   => a.no - b.no).map((s, i) => ({ ...s, no: i + 1,                gender: "M" })),
    ...females.sort((a, b) => a.no - b.no).map((s, i) => ({ ...s, no: males.length + i + 1, gender: "F" })),
  ];

  return { grade, sectionName, adviser, room, maleCount: males.length, femaleCount: females.length, students };
}

// Merges runs of touching, purely-numeric items on the same line into one
// combined number — e.g. a "1" item immediately followed by a "0" item
// with zero gap between them becomes one "10" item. This has to happen
// before anything decides which items are row-number markers, because
// each fragment alone still looks like a (much too small) row number on
// its own. Only items that are ALL digits and physically touching (no
// real gap, using the item's own height so this scales with font size
// rather than a fixed pixel guess) get merged; name text sitting nearby is
// left completely untouched either way.
function mergeAdjacentDigits(items) {
  if (!items.length) return [];

  const sorted = [...items].sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    return dy !== 0 ? dy : a.transform[4] - b.transform[4];
  });

  const result = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    if (!/^\d+$/.test(start.str.trim())) {
      result.push(start);
      i++;
      continue;
    }

    let combinedStr = start.str.trim();
    let endX = start.transform[4] + (start.width || 0);
    let j = i + 1;
    while (j < sorted.length) {
      const next = sorted[j];
      const sameLine = Math.abs(next.transform[5] - start.transform[5]) <= 4;
      const isDigit = /^\d+$/.test(next.str.trim());
      const height = next.height || start.height || 10;
      const touching = sameLine && isDigit && (next.transform[4] - endX) <= height * 0.15;
      if (!touching) break;
      combinedStr += next.str.trim();
      endX = next.transform[4] + (next.width || 0);
      j++;
    }

    result.push(
      j > i + 1
        ? { str: combinedStr, transform: start.transform, width: endX - start.transform[4], height: start.height }
        : start
    );
    i = j;
  }
  return result;
}

// ─── EXTRACT STUDENTS FROM ONE COLUMN, BY GEOMETRY (left=male, right=female) ──
// A name that wraps onto a second line breaks any approach based on flattened
// text/line-breaks in a way that can't be patched with better regexes: the
// row's own "NO." digit is vertically CENTERED across however many lines
// that row's name takes up in the PDF — so in plain top-to-bottom reading
// order, it can land AFTER the first line of its own row's name and BEFORE
// the second. There's no way to tell that apart from "this number starts a
// brand new row" without looking at actual coordinates.
//
// So this works from the raw PDF items directly, never from joined text:
// every lone 1–2 digit item is a row-number marker, and its Y is that row's
// vertical center. The midpoint between two consecutive markers' Y values is
// the true boundary between their rows — every other item is assigned to
// whichever row it falls on the correct side of that boundary for, not to
// whichever row number happens to sit nearest it in reading order.
function extractStudentsFromItems(items) {
  if (!items || !items.length) return [];

  const sorted = [...items]
    .filter((item) => item.str.trim())
    .sort((a, b) => {
      const dy = b.transform[5] - a.transform[5];
      return dy !== 0 ? dy : a.transform[4] - b.transform[4];
    });

  // Student rows start right below the MALE/FEMALE header for this column.
  let headerY = null;
  for (const item of sorted) {
    const s = item.str.trim().toUpperCase();
    if (s === "MALE" || s === "FEMALE") { headerY = item.transform[5]; break; }
  }
  if (headerY === null) return [];

  const belowHeader = sorted.filter((item) => item.transform[5] < headerY);

  // Drop the table's own column captions ("NO.", "LAST NAME, FIRST NAME
  // MIDDLE NAME") and any purely structural filler (table borders/divider
  // rules extract as runs of repeated characters like "_", "-", "—" with no
  // real letters in them — a single stray punctuation mark that's actually
  // part of a name, like the dash in "DAHIL - DAHIL", is only one character
  // and never matches this, so it's left untouched here).
  const cleaned = belowHeader.filter((item) => {
    const s = item.str.trim();
    if (/^NO\.?$/i.test(s)) return false;
    if (/LAST\s*NAME|FIRST\s*NAME|MIDDLE\s*NAME/i.test(s)) return false;
    if (/^[-_=.\u2013\u2014\u2500-\u257F\s]{3,}$/.test(s)) return false;
    return true;
  });

  // Some PDF exporters emit a multi-digit row number as separate
  // single-character items rather than one string — confirmed directly
  // against a real file, where row "10" arrived as a "1" item and a "0"
  // item with the second starting exactly where the first ends (zero
  // gap). Each fragment alone still matches the marker pattern below, so
  // without this step "1" and "0" would each be checked as their OWN row
  // number — both far too small to be next in sequence, so both get
  // rejected and silently dropped, and the row they actually belong to
  // never gets a marker at all. Only touching, purely-numeric fragments on
  // the same line get merged; anything else (including any name text that
  // happens to sit close by) is left completely alone.
  const digitsMerged = mergeAdjacentDigits(cleaned);

  // A row number usually arrives as its own clean item ("23"), but not every
  // PDF exporter separates cells the same way — some emit the number fused
  // to the start of the name as one fragment ("23   JARDIN, ARIANNIE...").
  // Recognizing only the clean case makes the parser brittle to export-tool
  // differences that don't show up visually at all, so both shapes are
  // treated as valid row markers here. A fused fragment is split into its
  // number (a normal marker candidate) and its remainder (name text placed
  // back at that same position, so it lands in the same row).
  const numberItems = [];
  const nameItems = [];
  for (const item of digitsMerged) {
    const s = item.str.trim();
    if (/^\d{1,2}$/.test(s)) {
      numberItems.push(item);
      continue;
    }
    const fused = s.match(/^(\d{1,2})\s+(.+)$/);
    if (fused) {
      numberItems.push({ str: fused[1], transform: item.transform });
      nameItems.push({ str: fused[2], transform: item.transform });
      continue;
    }
    nameItems.push(item);
  }
  if (!numberItems.length) return [];

  // Keep only a strictly ascending 1, 2, 3, ... sequence, so a stray digit
  // can never be mistaken for a real row marker.
  const markers = [];
  let expectedNo = 1;
  for (const item of numberItems) {
    const no = parseInt(item.str.trim(), 10);
    if (no >= expectedNo) {
      markers.push({ no, y: item.transform[5] });
      expectedNo = no + 1;
    }
  }
  if (!markers.length) return [];

  // Assign every remaining item to a row by geometry: advance to the next
  // marker once an item's Y crosses the midpoint between the current row's
  // marker and the next one — this is what correctly keeps a wrapped name's
  // second line with its own row instead of the row after it.
  const rows = markers.map((m) => ({ no: m.no, parts: [] }));
  let markerIdx = 0;
  for (const item of nameItems) {
    while (
      markerIdx + 1 < markers.length &&
      item.transform[5] <= (markers[markerIdx].y + markers[markerIdx + 1].y) / 2
    ) {
      markerIdx++;
    }
    rows[markerIdx].parts.push(item);
  }

  return rows
    .map((row) => {
      // Re-run the same line-grouping used for the whole page, but scoped to
      // just this row's own items, so a multi-line name comes back in the
      // right reading order. Any resulting line with no real letters at all
      // (a divider that landed in this row's territory with no number of
      // its own to start a new row) is dropped before the lines are joined.
      const goodLines = toLines(row.parts)
        .split("\n")
        .filter((line) => {
          const s = line.trim();
          return s && /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/.test(s);
        });
      return { no: row.no, name: goodLines.join(" ").replace(/\s+/g, " ").trim() };
    })
    .filter((row) => row.name.length >= 3 && !/LAST NAME|FIRST NAME/i.test(row.name));
}

// ─── FLAGGING LIKELY PARSE ERRORS FOR HUMAN REVIEW ────────────────────────────
// No PDF parser can promise zero mistakes against a class-list format it's
// never seen before — school PDFs get regenerated every year, sometimes with
// a different export tool, and small export differences invisible on the
// page can still change how the text comes out. Rather than pretend this
// step can be made perfect, the review screen actively flags anything that
// looks like it went wrong, so a human catches it in seconds instead of
// having to proofread every row by eye on every import, every year.
//
// A properly parsed "LAST NAME, First Middle" always has exactly one comma.
// Two or more usually means two names got run together; zero usually means
// a name lost its comma or a row is still blank. Length is a backstop for
// anything that slips past the comma check.
function isSuspiciousName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return true;
  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount !== 1) return true;
  if (trimmed.length > 55) return true;
  return false;
}

function sectionFlagInfo(section) {
  const total = section.students.length;
  const flagged = section.students.filter((s) => isSuspiciousName(s.name)).length;
  const ratio = total > 0 ? flagged / total : 0;

  // A single catastrophically merged row (several names run together) can
  // hide behind a low overall percentage if it swallowed enough students
  // to keep the section's total row count looking roughly normal. Checking
  // for that directly — a very long row, or one with several commas —
  // catches it regardless of what share of the section's rows that
  // represents.
  const hasCatastrophicRow = section.students.some((s) => {
    const name = (s.name || "").trim();
    const commaCount = (name.match(/,/g) || []).length;
    return commaCount >= 3 || name.length > 150;
  });

  return { flagged, total, isStructural: (total > 0 && ratio >= 0.25) || hasCatastrophicRow };
}

function sectionMetaHTML(section) {
  const maleCount   = section.students.filter((s) => s.gender === "M").length;
  const femaleCount = section.students.filter((s) => s.gender === "F").length;
  const { flagged, isStructural } = sectionFlagInfo(section);
  let html = `M: ${maleCount} &nbsp;|&nbsp; F: ${femaleCount} &nbsp;|&nbsp; Total: ${section.students.length}`;
  if (isStructural) {
    html += ` &nbsp;|&nbsp; <span class="flag-badge flag-badge-critical">⚠ ${flagged} of ${section.students.length} look wrong — layout may not match</span>`;
  } else if (flagged > 0) {
    html += ` &nbsp;|&nbsp; <span class="flag-badge">⚠ ${flagged} to review</span>`;
  }
  return html;
}

function refreshSectionMeta(idx) {
  const span = importSectionsList.querySelector(`.import-section-meta[data-idx="${idx}"]`);
  if (span) span.innerHTML = sectionMetaHTML(importedSections[idx]);

  const banner = importSectionsList.querySelector(`.structural-warning-banner[data-idx="${idx}"]`);
  if (banner) banner.hidden = !sectionFlagInfo(importedSections[idx]).isStructural;
}

function refreshImportSummary() {
  const totalStudents = importedSections.reduce((sum, s) => sum + s.students.length, 0);
  const totalFlagged  = importedSections.reduce(
    (sum, s) => sum + s.students.filter((st) => isSuspiciousName(st.name)).length, 0
  );
  importSectionsSummary.textContent =
    `Found ${importedSections.length} section(s) — ${totalStudents} students total. ` +
    (totalFlagged > 0
      ? `⚠ ${totalFlagged} row(s) may need a second look (merged names, or unusually long) — look for the ⚠ marks below before saving. `
      : "") +
    `Click a section to expand and review. Correct anything wrong, then click Save All Sections.`;
}

// ─── RENDER ALL SECTIONS AS EXPANDABLE CARDS ─────────────────────────────────
function renderSectionsInModal(sections) {
  refreshImportSummary();

  importSectionsList.innerHTML = "";

  sections.forEach((section, idx) => {
    const card = document.createElement("div");
    card.className = "import-section-card";
    card.innerHTML = `
      <div class="import-section-header">
        <span class="import-section-title">
          Grade ${section.grade || "?"} – ${section.sectionName || "Unknown"}
        </span>
        <span class="import-section-meta" data-idx="${idx}">${sectionMetaHTML(section)}</span>
        <span class="import-section-toggle">+</span>
      </div>
      <div class="import-section-body">
        <div class="structural-warning-banner" data-idx="${idx}" ${sectionFlagInfo(section).isStructural ? "" : "hidden"}>
          ⚠ A large share of this section's rows look wrong (merged names, or blank). This usually
          means the source PDF is laid out differently than the importer expects — a new export
          tool, a different table structure, or similar. Check each flagged row carefully, or
          verify against the original PDF, before saving this section.
        </div>
        <div class="import-meta-grid">
          <div class="form-field">
            <label>Grade Level</label>
            <input type="number" class="sec-grade" min="7" max="12"
                   value="${section.grade || ""}" placeholder="e.g. 12">
          </div>
          <div class="form-field">
            <label>Section Name</label>
            <input type="text" class="sec-name"
                   value="${section.sectionName || ""}" placeholder="e.g. BERNOULLI">
          </div>
          <div class="form-field">
            <label>Room Number</label>
            <input type="text" class="sec-room"
                   value="${section.room || ""}" placeholder="e.g. 201">
          </div>
          <div class="form-field">
            <label>Class Adviser</label>
            <input type="text" class="sec-adviser"
                   value="${section.adviser || ""}" placeholder="e.g. Ms. Elizabeth P. Regencia">
          </div>
        </div>

        <p style="font-size:0.82rem;color:var(--muted);margin-bottom:8px;">
          <strong>${section.students.length}</strong> students —
          click a name or gender to correct it, ✕ to remove.
        </p>

        <div class="import-preview-wrap">
          <table class="import-preview-table">
            <thead>
              <tr><th>No.</th><th>Name</th><th>M/F</th><th></th></tr>
            </thead>
            <tbody class="sec-tbody" data-idx="${idx}"></tbody>
          </table>
        </div>
        <button type="button" class="btn-secondary add-sec-student-btn"
                data-idx="${idx}" style="margin-top:10px;width:100%;">
          + Add a student manually
        </button>
      </div>`;

    // Toggle expand/collapse
    card.querySelector(".import-section-header").addEventListener("click", () =>
      card.classList.toggle("open")
    );

    // Sync meta field changes back to importedSections state
    card.querySelector(".sec-grade").addEventListener("change", (e) => {
      importedSections[idx].grade = parseInt(e.target.value) || null;
    });
    card.querySelector(".sec-name").addEventListener("change", (e) => {
      importedSections[idx].sectionName = e.target.value.trim().toUpperCase();
    });
    card.querySelector(".sec-room").addEventListener("change", (e) => {
      importedSections[idx].room = e.target.value.trim();
    });
    card.querySelector(".sec-adviser").addEventListener("change", (e) => {
      importedSections[idx].adviser = e.target.value.trim();
    });

    // Render student rows
    renderSectionStudents(card.querySelector(".sec-tbody"), idx);

    // Add student manually
    card.querySelector(".add-sec-student-btn").addEventListener("click", () => {
      importedSections[idx].students.push({
        no: importedSections[idx].students.length + 1,
        name: "", gender: "M",
      });
      renderSectionStudents(card.querySelector(".sec-tbody"), idx);
      refreshImportSummary();
    });

    importSectionsList.appendChild(card);
  });
}

// ─── RENDER EDITABLE STUDENT ROWS FOR ONE SECTION ────────────────────────────
function renderSectionStudents(tbody, sectionIdx) {
  const students = importedSections[sectionIdx].students;
  tbody.innerHTML = "";
  students.forEach((student, stuIdx) => {
    const tr = document.createElement("tr");
    if (isSuspiciousName(student.name)) tr.classList.add("flagged-row");
    tr.innerHTML = `
      <td>${stuIdx + 1}</td>
      <td><input type="text" value="${student.name}"
           data-sec="${sectionIdx}" data-stu="${stuIdx}" data-field="name"></td>
      <td><input type="text" value="${student.gender}"
           data-sec="${sectionIdx}" data-stu="${stuIdx}" data-field="gender"
           style="width:44px"></td>
      <td><button type="button" class="remove-row-btn"
           data-sec="${sectionIdx}" data-stu="${stuIdx}" title="Remove">✕</button></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach((input) =>
    input.addEventListener("change", (e) => {
      const s = parseInt(e.target.dataset.sec);
      const i = parseInt(e.target.dataset.stu);
      importedSections[s].students[i][e.target.dataset.field] =
        e.target.value.trim().toUpperCase();

      // Re-check just this row live, so fixing a merged or blank name
      // clears its warning immediately instead of waiting for a re-render.
      e.target.closest("tr").classList.toggle(
        "flagged-row",
        isSuspiciousName(importedSections[s].students[i].name)
      );
      refreshSectionMeta(s);
      refreshImportSummary();
    })
  );

  tbody.querySelectorAll(".remove-row-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = parseInt(btn.dataset.sec);
      const i = parseInt(btn.dataset.stu);
      importedSections[s].students.splice(i, 1);
      renderSectionStudents(tbody, s);
      refreshImportSummary();
    })
  );

  refreshSectionMeta(sectionIdx);
}

// ─── SAVE ALL SECTIONS ────────────────────────────────────────────────────────
importSaveBtn.addEventListener("click", async () => {
  // Log immediately so we can confirm the button is actually firing
  console.log("Save All Sections clicked — sections in memory:", importedSections?.length);
  importSaveStatus.textContent = "";
  importSaveStatus.style.color = "var(--muted)";

  // ── Guard 1: sections must exist ──
  if (!importedSections || importedSections.length === 0) {
    window.alert("No sections to save. Please upload a PDF first.");
    return;
  }

  // ── Guard 2: check login directly — don't rely on cached variable ──
  const currentUser = auth.currentUser;
  console.log("Current user:", currentUser?.email, "| isAdminOrStaff:", isAdminOrStaff);
  if (!currentUser) {
    window.alert("You are not logged in.\n\nPlease log in as admin or staff first, then try again.");
    return;
  }
  if (!isAdminOrStaff) {
    window.alert("Your account does not have admin or staff permissions.\n\nMake sure your user document in Firestore has role: \"admin\" or role: \"staff\".");
    return;
  }

  // ── Guard 3: validate each section ──
  for (let i = 0; i < importedSections.length; i++) {
    const s = importedSections[i];
    const g = parseInt(s.grade);
    if (!g || g < 7 || g > 12) {
      window.alert(`Section ${i + 1}: Grade Level is missing or invalid (must be 7–12).\n\nOpen that card and correct it.`);
      return;
    }
    if (!s.sectionName?.trim()) {
      window.alert(`Section ${i + 1}: Section Name is missing.\n\nOpen the card and fill it in.`);
      return;
    }
  }

  // ── Guard 4: pause before saving if a section looks structurally wrong ──
  // A few flagged rows can be normal one-off edge cases, but a quarter or
  // more of a section flagged at once (or even a single catastrophically
  // merged row) usually means this PDF's layout doesn't match what the
  // importer expects at all — worth a deliberate stop instead of silently
  // saving names that are almost certainly garbled.
  const structuralIssues = importedSections
    .map((s, i) => ({ i, info: sectionFlagInfo(s) }))
    .filter((x) => x.info.isStructural);
  if (structuralIssues.length > 0) {
    const list = structuralIssues
      .map((x) => `Section ${x.i + 1}: ${x.info.flagged} of ${x.info.total} rows flagged`)
      .join("\n");
    const proceed = await askConfirm({
      title: "This PDF may not match the expected layout",
      message:
        `${list}\n\nThis usually means the PDF's format is different from what the importer ` +
        `expects. Saving now will likely save garbled names — it's safer to check those rows ` +
        `against the original PDF first.`,
      confirmLabel: "Save Anyway",
    });
    if (!proceed) return;
  }

  importSaveBtn.disabled       = true;
  importSaveStatus.textContent = `Saving ${importedSections.length} section(s) — please wait...`;
  let saved = 0;

  try {
    for (const section of importedSections) {
      const grade     = parseInt(section.grade);
      const name      = section.sectionName.trim().toUpperCase();
      const sectionId = `grade${grade}_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const maleCount   = section.students.filter(s => s.gender === "M").length;
      const femaleCount = section.students.filter(s => s.gender === "F").length;

      console.log(`→ Saving ${sectionId}: ${maleCount}M + ${femaleCount}F`);

      await setDoc(doc(db, "sections", sectionId), {
        grade, name,
        room:    section.room    || "",
        adviser: section.adviser || "",
        maleCount, femaleCount,
        updatedAt: serverTimestamp(),
      });

      // ── Delete any existing students first ──
      // Using addDoc creates new IDs every save, so repeated imports pile up.
      // Wiping first ensures each import is a clean replacement, not an addition.
      const existingStudents = await getDocs(collection(db, "sections", sectionId, "students"));
      if (!existingStudents.empty) {
        const delBatch = writeBatch(db);
        existingStudents.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
        console.log(`  cleared ${existingStudents.size} old student docs`);
      }

      const BATCH_LIMIT = 499;
      for (let i = 0; i < section.students.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        section.students.slice(i, i + BATCH_LIMIT).forEach((student, j) => {
          batch.set(doc(collection(db, "sections", sectionId, "students")), {
            no:     i + j + 1,
            name:   student.name   || "",
            gender: student.gender || "M",
          });
        });
        await batch.commit();
        console.log(`   batch ${Math.floor(i / BATCH_LIMIT) + 1} done`);
      }

      saved++;
      importSaveStatus.textContent = `Saved ${saved} of ${importedSections.length} sections...`;
    }

    importSaveStatus.style.color = "var(--ink)";
    importSaveStatus.textContent = `✓ All ${saved} section(s) saved! The tabs will appear now.`;
    await loadSections();
    setTimeout(closeImportModal, 2500);

  } catch (err) {
    console.error("Save error:", err);

    // Give the most useful message possible for the most common cause
    let msg;
    if (err.code === "permission-denied" || err.message?.toLowerCase().includes("permission")) {
      msg = "PERMISSION DENIED\n\n" +
        "Your Firestore security rules do not allow writes to the 'sections' collection.\n\n" +
        "Fix: Go to Firebase Console → Firestore Database → Rules tab, paste the full rules block from the README, then click Publish. Try saving again after that.";
    } else {
      msg = `Save failed: ${err.message}\n\nOpen browser DevTools (F12) → Console tab for details.`;
    }

    window.alert(msg);
    importSaveStatus.style.color = "var(--error)";
    importSaveStatus.textContent = err.code === "permission-denied"
      ? "❌ Permission denied — update Firestore rules (see README)."
      : `❌ ${err.message}`;
  } finally {
    importSaveBtn.disabled = false;
  }
});