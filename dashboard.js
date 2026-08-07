// dashboard.js
// Shows the most recent real announcement as the dashboard's hero banner.
// If there are no announcements yet, the generic welcome message
// (already in the HTML) just stays visible instead.

import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, limit, getDocs, getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const hero = document.getElementById("hero");
const heroFallback = document.getElementById("hero-fallback");
const heroImage = document.getElementById("hero-image");
const heroTitle = document.getElementById("hero-title");

const statStudents      = document.getElementById("stat-students");
const statSections      = document.getElementById("stat-sections");
const statAnnouncements = document.getElementById("stat-announcements");
const statModules       = document.getElementById("stat-modules");

const prefersReducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Counts a stat number up from 0 to its real value instead of just
// snapping to it — a small "the page is coming alive" touch for the same
// numbers-as-hero idea the stats bar already borrows its layout from.
// Skipped entirely (value just set directly) if the visitor has asked
// their system for reduced motion.
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

// The 4th card ("Modules Online") is a fixed number already in the HTML —
// animate it in too, on load, for the same "counting up" moment as the
// other three once their real data arrives.
if (statModules) animateStat(statModules, statModules.textContent);

async function loadLatestAnnouncement() {
  try {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return; // keep showing the generic welcome message

    const data = snapshot.docs[0].data();

    // New posts store an array (imageUrls); older posts may still have a
    // single imageUrl string — fall back so old announcements still render.
    const firstImage = Array.isArray(data.imageUrls) && data.imageUrls.length > 0
      ? data.imageUrls[0]
      : data.imageUrl;
    if (!firstImage) return; // nothing to show — keep the fallback welcome message

    heroImage.src = firstImage;
    heroImage.alt = data.caption || "Latest announcement";
    heroTitle.textContent = data.caption || "New Announcement";

    hero.hidden = false;
    heroFallback.hidden = true;
  } catch (error) {
    // If anything goes wrong, the fallback welcome message is already showing — do nothing.
  }
}

// ---------- Stats bar: sections + students (denormalized on each section
// doc already, so this is one cheap read — no per-student subcollection
// queries needed) plus a server-side count of announcements. ----------
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
    // Leave the placeholder dash showing — this bar is a nice-to-have,
    // not worth surfacing an error banner over.
  }

  try {
    const countSnap = await getCountFromServer(collection(db, "announcements"));
    if (statAnnouncements) animateStat(statAnnouncements, countSnap.data().count);
  } catch (error) {
    // Older SDKs/rules without count support fall back to a full read.
    try {
      const snap = await getDocs(collection(db, "announcements"));
      if (statAnnouncements) animateStat(statAnnouncements, snap.size);
    } catch {
      // Give up quietly — the dash stays as "–".
    }
  }
}

loadLatestAnnouncement();
loadDashboardStats();