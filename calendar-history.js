// calendar-history.js
// School Calendar + Historical Timeline for PCSHS
// Admin/staff can add/edit/delete calendar events

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy,
  doc, getDoc, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let isAdminOrStaff = false;
let allEvents = [];
let historyItems = [];
let viewYear, viewMonth; // 0-indexed month
let editingEventId = null;

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const adminTools = document.getElementById("admin-tools");
const addEventBtn = document.getElementById("add-event-btn");

const calendarGrid = document.getElementById("calendar-grid");
const calendarMonthLabel = document.getElementById("calendar-month-label");
const prevMonthBtn = document.getElementById("prev-month-btn");
const nextMonthBtn = document.getElementById("next-month-btn");
const todayBtn = document.getElementById("today-btn");
const calendarEventsList = document.getElementById("calendar-events-list");

const timeline = document.getElementById("timeline");

const eventModal = document.getElementById("event-modal");
const eventModalTitle = document.getElementById("event-modal-title");
const eventForm = document.getElementById("event-form");
const eventStatus = document.getElementById("event-status");
const eventCancelBtn = document.getElementById("event-cancel-btn");
const eventSaveBtn = document.getElementById("event-save-btn");

const confirmModal = document.getElementById("confirm-modal");
const confirmTitleEl = document.getElementById("confirm-title");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmOkBtn = document.getElementById("confirm-ok-btn");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");

const eventDetailModal = document.getElementById("event-detail-modal");
const eventDetailTitle = document.getElementById("event-detail-title");
const eventDetailBody = document.getElementById("event-detail-body");
const eventDetailClose = document.getElementById("event-detail-close");
const eventDetailEdit = document.getElementById("event-detail-edit");

// ─── INIT ─────────────────────────────────────────────────────────────────────
const today = new Date();
viewYear = today.getFullYear();
viewMonth = today.getMonth();

// ─── AUTH ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdminOrStaff = false;
    adminTools.hidden = true;
  } else {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const role = snap.exists() ? snap.data().role : null;
      isAdminOrStaff = role === "admin" || role === "staff";
      adminTools.hidden = !isAdminOrStaff;
    } catch {
      isAdminOrStaff = false;
      adminTools.hidden = true;
    }
  }
  await Promise.all([loadEvents(), loadHistory()]);
  renderCalendar();
  renderTimeline();
});

// ─── LOAD EVENTS ──────────────────────────────────────────────────────────────
async function loadEvents() {
  try {
    const q = query(collection(db, "calendarEvents"), orderBy("startDate"));
    const snap = await getDocs(q);
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("loadEvents failed:", err);
    allEvents = [];
  }
}

// ─── LOAD HISTORY ─────────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const q = query(collection(db, "schoolHistory"), orderBy("year", "desc"));
    const snap = await getDocs(q);
    historyItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("loadHistory failed:", err);
    historyItems = [];
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function formatFullDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function getEventTypeClass(type) {
  const map = {
    academic: "event-academic",
    activity: "event-activity",
    holiday: "event-holiday",
    meeting: "event-meeting",
    other: "event-other"
  };
  return map[type] || "event-other";
}

function getEventTypeLabel(type) {
  const map = {
    academic: "Academic",
    activity: "Activity",
    holiday: "Holiday",
    meeting: "Meeting",
    other: "Other"
  };
  return map[type] || "Other";
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function firstWeekday(year, month) {
  return new Date(year, month, 1).getDay(); // 0 = Sun
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function dateStrFromParts(year, month, day) {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// ─── CALENDAR RENDER ──────────────────────────────────────────────────────────
function renderCalendar() {
  calendarMonthLabel.textContent = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("en-PH", { month: "long", year: "numeric" });

  const days = daysInMonth(viewYear, viewMonth);
  const firstDay = firstWeekday(viewYear, viewMonth);

  let html = "";

  // Weekday headers
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  weekdays.forEach(d => {
    html += `<div class="cal-header-day">${d}</div>`;
  });

  // Leading blanks
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day empty"></div>`;
  }

  // Days
  for (let day = 1; day <= days; day++) {
    const dateStr = dateStrFromParts(viewYear, viewMonth, day);
    const dateObj = new Date(viewYear, viewMonth, day);
    const isToday = isSameDay(dateObj, today);
    const dayEvents = allEvents.filter(ev => {
      const start = new Date(ev.startDate + "T00:00:00");
      const end = ev.endDate ? new Date(ev.endDate + "T00:00:00") : start;
      return dateObj >= start && dateObj <= end;
    });

    let classes = "cal-day";
    if (isToday) classes += " today";
    if (dayEvents.length > 0) classes += " has-events";

    html += `<div class="${classes}" data-date="${dateStr}">
      <span class="cal-day-num">${day}</span>
      <div class="cal-events">`;

    dayEvents.slice(0, 3).forEach(ev => {
      html += `<span class="cal-event-chip ${getEventTypeClass(ev.type)}" data-id="${ev.id}">${ev.title}</span>`;
    });
    if (dayEvents.length > 3) {
      html += `<span class="cal-event-more">+${dayEvents.length - 3} more</span>`;
    }

    html += `</div></div>`;
  }

  calendarGrid.innerHTML = html;

  // Click handlers for event chips
  calendarGrid.querySelectorAll(".cal-event-chip").forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      openEventDetail(chip.dataset.id);
    });
  });

  // Click on day to show events list
  calendarGrid.querySelectorAll(".cal-day:not(.empty)").forEach(dayEl => {
    dayEl.addEventListener("click", () => showDayEvents(dayEl.dataset.date));
  });

  renderEventsList();
}

function renderEventsList() {
  const monthStart = new Date(viewYear, viewMonth, 1);
  const monthEnd = new Date(viewYear, viewMonth + 1, 0);

  const monthEvents = allEvents.filter(ev => {
    const start = new Date(ev.startDate + "T00:00:00");
    const end = ev.endDate ? new Date(ev.endDate + "T00:00:00") : start;
    return !(end < monthStart || start > monthEnd);
  }).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  if (monthEvents.length === 0) {
    calendarEventsList.innerHTML = `<p class="muted" style="text-align:center;padding:20px;">No events this month.</p>`;
    return;
  }

  calendarEventsList.innerHTML = monthEvents.map(ev => `
    <div class="event-list-item ${getEventTypeClass(ev.type)}" data-id="${ev.id}">
      <div class="event-list-date">
        <span class="event-day">${new Date(ev.startDate + "T00:00:00").getDate()}</span>
        <span class="event-month">${new Date(ev.startDate + "T00:00:00").toLocaleDateString("en-PH", { month: "short" })}</span>
      </div>
      <div class="event-list-info">
        <h4>${ev.title}</h4>
        <p class="event-meta">
          <span class="event-type">${getEventTypeLabel(ev.type)}</span>
          ${ev.location ? ` · ${ev.location}` : ""}
          ${ev.endDate && ev.endDate !== ev.startDate ? ` · ${formatDate(ev.startDate)} – ${formatDate(ev.endDate)}` : ` · ${formatFullDate(ev.startDate)}`}
        </p>
        ${ev.description ? `<p class="event-desc">${ev.description}</p>` : ""}
      </div>
    </div>
  `).join("");

  calendarEventsList.querySelectorAll(".event-list-item").forEach(item => {
    item.addEventListener("click", () => openEventDetail(item.dataset.id));
  });
}

function showDayEvents(dateStr) {
  const dayEvents = allEvents.filter(ev => {
    const start = new Date(ev.startDate + "T00:00:00");
    const end = ev.endDate ? new Date(ev.endDate + "T00:00:00") : start;
    const target = new Date(dateStr + "T00:00:00");
    return target >= start && target <= end;
  });

  const dateObj = new Date(dateStr + "T00:00:00");
  const header = formatFullDate(dateStr);

  if (dayEvents.length === 0) {
    calendarEventsList.innerHTML = `
      <div class="day-events-header">
        <h3>${header}</h3>
        <span class="event-count">No events</span>
      </div>
      <p class="muted" style="text-align:center;padding:20px;">No events on this day.</p>
    `;
    return;
  }

  calendarEventsList.innerHTML = `
    <div class="day-events-header">
      <h3>${header}</h3>
      <span class="event-count">${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}</span>
    </div>
    ${dayEvents.map(ev => `
      <div class="event-list-item ${getEventTypeClass(ev.type)}" data-id="${ev.id}">
        <div class="event-list-info">
          <h4>${ev.title}</h4>
          <p class="event-meta">
            <span class="event-type">${getEventTypeLabel(ev.type)}</span>
            ${ev.location ? ` · ${ev.location}` : ""}
          </p>
          ${ev.description ? `<p class="event-desc">${ev.description}</p>` : ""}
        </div>
      </div>
    `).join("")}
  `;

  calendarEventsList.querySelectorAll(".event-list-item").forEach(item => {
    item.addEventListener("click", () => openEventDetail(item.dataset.id));
  });
}

// ─── EVENT DETAIL MODAL ───────────────────────────────────────────────────────
function openEventDetail(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;

  eventDetailTitle.textContent = ev.title;
  eventDetailBody.innerHTML = `
    <div class="event-detail-meta">
      <p><strong>Date:</strong> ${ev.endDate && ev.endDate !== ev.startDate
        ? `${formatFullDate(ev.startDate)} – ${formatFullDate(ev.endDate)}`
        : formatFullDate(ev.startDate)}</p>
      <p><strong>Type:</strong> <span class="event-type-badge ${getEventTypeClass(ev.type)}">${getEventTypeLabel(ev.type)}</span></p>
      ${ev.location ? `<p><strong>Location:</strong> ${ev.location}</p>` : ""}
    </div>
    ${ev.description ? `<div class="event-detail-desc"><strong>Description:</strong><p>${ev.description}</p></div>` : ""}
  `;

  eventDetailEdit.hidden = !isAdminOrStaff;
  eventDetailEdit.onclick = () => {
    closeEventDetailModal();
    openEventModal(ev);
  };
  eventDetailClose.onclick = closeEventDetailModal;
  eventDetailModal.hidden = false;
}

function closeEventDetailModal() {
  eventDetailModal.hidden = true;
}

// ─── EVENT MODAL (Add/Edit) ───────────────────────────────────────────────────
function openEventModal(ev = null) {
  editingEventId = ev?.id || null;
  eventModalTitle.textContent = ev ? "Edit Event" : "Add Event";
  eventForm.reset();
  eventStatus.textContent = "";

  if (ev) {
    document.getElementById("event-title").value = ev.title;
    document.getElementById("event-description").value = ev.description || "";
    document.getElementById("event-start").value = ev.startDate;
    document.getElementById("event-end").value = ev.endDate || "";
    document.getElementById("event-type").value = ev.type || "academic";
    document.getElementById("event-location").value = ev.location || "";
  } else {
    // Default start date to today
    document.getElementById("event-start").value = dateStrFromParts(today.getFullYear(), today.getMonth(), today.getDate());
  }

  eventModal.hidden = false;
}

function closeEventModal() {
  eventModal.hidden = true;
  editingEventId = null;
}

eventCancelBtn.addEventListener("click", closeEventModal);
eventModal.addEventListener("click", (e) => { if (e.target === eventModal) closeEventModal(); });

eventForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdminOrStaff) return;

  const title = document.getElementById("event-title").value.trim();
  const description = document.getElementById("event-description").value.trim();
  const startDate = document.getElementById("event-start").value;
  const endDate = document.getElementById("event-end").value || null;
  const type = document.getElementById("event-type").value;
  const location = document.getElementById("event-location").value.trim();

  if (!title || !startDate) {
    eventStatus.textContent = "Title and start date are required.";
    return;
  }

  eventSaveBtn.disabled = true;
  eventStatus.textContent = editingEventId ? "Saving changes..." : "Creating event...";

  try {
    const data = {
      title,
      description,
      startDate,
      endDate,
      type,
      location,
      updatedAt: serverTimestamp()
    };

    if (editingEventId) {
      await updateDoc(doc(db, "calendarEvents", editingEventId), data);
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = auth.currentUser.email;
      await addDoc(collection(db, "calendarEvents"), data);
    }

    closeEventModal();
    await loadEvents();
    renderCalendar();
  } catch (err) {
    console.error("Save event failed:", err);
    eventStatus.textContent = "Failed to save: " + err.message;
  } finally {
    eventSaveBtn.disabled = false;
  }
});

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function askConfirm({ title = "Are you sure?", message = "", confirmLabel = "Delete" } = {}) {
  return new Promise((resolve) => {
    confirmTitleEl.textContent = title;
    confirmMessageEl.textContent = message;
    confirmOkBtn.textContent = confirmLabel;
    confirmModal.hidden = false;

    function settle(result) {
      confirmModal.hidden = true;
      confirmOkBtn.removeEventListener("click", onOk);
      confirmCancelBtn.removeEventListener("click", onCancel);
      confirmModal.removeEventListener("click", onOverlay);
      resolve(result);
    }
    function onOk() { settle(true); }
    function onCancel() { settle(false); }
    function onOverlay(e) { if (e.target === confirmModal) settle(false); }

    confirmOkBtn.addEventListener("click", onOk);
    confirmCancelBtn.addEventListener("click", onCancel);
    confirmModal.addEventListener("click", onOverlay);
  });
}

// ─── CALENDAR NAVIGATION ──────────────────────────────────────────────────────
prevMonthBtn.addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
});

nextMonthBtn.addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
});

todayBtn.addEventListener("click", () => {
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  renderCalendar();
});

addEventBtn.addEventListener("click", () => openEventModal());

// ─── HISTORICAL TIMELINE ──────────────────────────────────────────────────────
function renderTimeline() {
  if (historyItems.length === 0) {
    timeline.innerHTML = `
      <div class="timeline-empty">
        <p>No historical milestones recorded yet.</p>
        ${isAdminOrStaff ? `<button class="btn-primary" id="add-history-btn">Add First Milestone</button>` : ""}
      </div>
    `;
    const btn = document.getElementById("add-history-btn");
    if (btn) btn.addEventListener("click", () => openHistoryModal());
    return;
  }

  timeline.innerHTML = historyItems.map((item, i) => `
    <div class="timeline-item ${i % 2 === 0 ? "left" : "right"}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-year">${item.year}</div>
        <h3 class="timeline-title">${item.title}</h3>
        <p class="timeline-desc">${item.description || ""}</p>
        ${isAdminOrStaff ? `
          <div class="timeline-actions">
            <button class="btn-icon btn-sm edit-history-btn" data-id="${item.id}" aria-label="Edit">✎</button>
            <button class="btn-icon btn-sm delete-history-btn" data-id="${item.id}" aria-label="Delete">🗑</button>
          </div>
        ` : ""}
      </div>
    </div>
  `).join("");

  timeline.querySelectorAll(".edit-history-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHistoryModal(historyItems.find(h => h.id === btn.dataset.id));
    });
  });
  timeline.querySelectorAll(".delete-history-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = historyItems.find(h => h.id === btn.dataset.id);
      const confirmed = await askConfirm({
        title: "Delete this milestone?",
        message: `Delete "${item.title}" (${item.year})? This can't be undone.`,
        confirmLabel: "Delete"
      });
      if (confirmed) {
        try {
          await deleteDoc(doc(db, "schoolHistory", item.id));
          await loadHistory();
          renderTimeline();
        } catch (err) {
          window.alert("Delete failed: " + err.message);
        }
      }
    });
  });
}

// ─── HISTORY MODAL (Add/Edit) ─────────────────────────────────────────────────
// Reusing the event modal structure but simpler - could make a dedicated one
function openHistoryModal(item = null) {
  // Simple prompt-based approach for history items
  const year = item?.year || prompt("Year (e.g. 2004):");
  if (!year) return;
  const title = item?.title || prompt("Title:");
  if (!title) return;
  const description = item?.description || prompt("Description (optional):") || "";

  const data = { year: parseInt(year), title, description, updatedAt: serverTimestamp() };

  (async () => {
    try {
      if (item) {
        await updateDoc(doc(db, "schoolHistory", item.id), data);
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "schoolHistory"), data);
      }
      await loadHistory();
      renderTimeline();
    } catch (err) {
      window.alert("Save failed: " + err.message);
    }
  })();
}