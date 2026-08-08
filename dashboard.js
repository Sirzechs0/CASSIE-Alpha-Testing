// dashboard.js
// Shows up to 3 of the most recent announcements as small horizontal cards
// below the welcome block, plus a "See All" link to the Announcements page.
// The welcome block (title + View Attendance / See Announcements buttons)
// is always visible now — this section only appears IN ADDITION to it when
// there's actually at least one announcement to show.

import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, limit, getDocs, getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const dashAnnouncements     = document.getElementById("dash-announcements");
const dashAnnouncementsList = document.getElementById("dash-announcements-list");

const statStudents      = document.getElementById("stat-students");
const statSections      = document.getElementById("stat-sections");
const statAnnouncements = document.getElementById("stat-announcements");
const statModules       = document.getElementById("stat-modules");

const prefersReducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Counts a stat number up from 0 to its real value instead of just
// snapping to it. Skipped (value just set directly) under reduced motion.
function animateStat(el, target) {
  if (!el) return;
  const value = Number(target) || 0;
  if (prefersReducedMotion) {
    el.textContent = value;
    return;
  }
  const duration = 900;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(value * eased);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = value;
  }
  requestAnimationFrame(tick);
}

if (statModules) animateStat(statModules, statModules.textContent);

// Same shape-normalizing helper as announcements.js: older posts saved a
// single `imageUrl` string, new posts save an `imageUrls` array. Images are
// optional either way — an empty array is a normal, expected result.
function getImageUrls(data) {
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (data.imageUrl) return [data.imageUrl];
  return [];
}

// Small date line under the title: the event's own date if one was set,
// otherwise the date it was posted.
function formatCardDate(data) {
  let dateObj = null;
  if (data.eventDate) {
    const [y, m, d] = data.eventDate.split("-").map(Number);
    if (y && m && d) dateObj = new Date(y, m - 1, d);
  }
  if (!dateObj && data.timestamp && typeof data.timestamp.toDate === "function") {
    dateObj = data.timestamp.toDate();
  }
  return dateObj ? dateObj.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "";
}

// Every card links to the Announcements page itself — there's no
// per-announcement detail view in this app, so that's also where "See All"
// points to.
function buildDashAnnouncementCard(data) {
  const images = getImageUrls(data);
  const hasRealTitle = !!(data.title && data.title.trim());
  const displayTitle = hasRealTitle ? data.title.trim() : ((data.caption || "").trim() || "Announcement");

  const card = document.createElement("a");
  card.className = "dash-announce-card";
  card.href = "announcements.html";

  const media = document.createElement("div");
  media.className = "dash-announce-card-media";
  if (images.length > 0) {
    const img = document.createElement("img");
    img.src = images[0];
    img.alt = "";
    img.loading = "lazy";
    media.appendChild(img);
  } else {
    media.classList.add("dash-announce-card-media-empty");
    media.textContent = "📌";
  }
  card.appendChild(media);

  const body = document.createElement("div");
  body.className = "dash-announce-card-body";

  const title = document.createElement("span");
  title.className = "dash-announce-card-title";
  title.textContent = displayTitle;
  body.appendChild(title);

  const dateText = formatCardDate(data);
  if (dateText) {
    const date = document.createElement("span");
    date.className = "dash-announce-card-date";
    date.textContent = dateText;
    body.appendChild(date);
  }

  card.appendChild(body);
  return card;
}

async function loadLatestAnnouncements() {
  if (!dashAnnouncements || !dashAnnouncementsList) return;
  try {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(3));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return; // nothing posted yet — block stays hidden

    dashAnnouncementsList.innerHTML = "";
    snapshot.docs.forEach((docSnap) => {
      dashAnnouncementsList.appendChild(buildDashAnnouncementCard(docSnap.data()));
    });
    dashAnnouncements.hidden = false;
  } catch (error) {
    // Leave the block hidden — not worth surfacing an error banner over.
  }
}

// ---------- Stats bar ----------
async function loadDashboardStats() {
  try {
    const sectionsSnap = await getDocs(collection(db, "sections"));
    let totalStudents = 0;
    sectionsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      totalStudents += (data.maleCount || 0) + (data.femaleCount || 0);
    });
    if (statSections) animateStat(statSections, sectionsSnap.size);
    if (statStudents) animateStat(statStudents, totalStudents);
  } catch (error) {
    // Leave the placeholder dash showing.
  }

  try {
    const countSnap = await getCountFromServer(collection(db, "announcements"));
    if (statAnnouncements) animateStat(statAnnouncements, countSnap.data().count);
  } catch (error) {
    try {
      const snap = await getDocs(collection(db, "announcements"));
      if (statAnnouncements) animateStat(statAnnouncements, snap.size);
    } catch {
      // Give up quietly — the dash stays as "–".
    }
  }
}

loadLatestAnnouncements();
loadDashboardStats();