// support.js
// Handles the Support ("Let's Connect") page — two independent things:
//  1. Contact info cards (Email / Facebook / Phone / Visit Us). Rather than
//     maintaining a second copy of the school's phone/email/address, the
//     three dynamic ones are read straight from siteContent/about's hero
//     fields — the exact same data an admin already edits from the About
//     page's Hero "✎ Edit" panel (about.js). Editing it there updates both
//     pages at once. Facebook has no such field anywhere yet, so it stays a
//     plain href="#" for Luck to paste the real URL into, same as the
//     footer's social icons on every page.
//  2. The "Send a Message" form. No login required to view OR submit —
//     writes straight to supportMessages or the specific fields matching
//     firestore.rules' validation on that collection. Nothing in this app
//     reads that collection back yet; check submissions via the Firebase
//     Console (or build an admin inbox later) until something does.

import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ─── DOM REFS ─────────────────────────────────────────────────────────────
const contactEmail   = document.getElementById("contact-email");
const contactPhone   = document.getElementById("contact-phone");
const contactAddress = document.getElementById("contact-address");

const supportForm      = document.getElementById("support-form");
const supportStatus    = document.getElementById("support-status");
const supportSubmitBtn = document.getElementById("support-submit-btn");

// ─── CONTACT INFO (from siteContent/about's hero fields) ──────────────────
// Same bracketed-placeholder convention as about.js's own DEFAULTS, so an
// admin who hasn't filled in real contact info yet sees the exact same
// "[Contact Number]" style placeholder here as they would on the About page
// itself, instead of two different empty states for the same missing data.
function clearContactSkeleton(el) {
  if (!el) return;
  el.classList.remove("skel", "skel-text");
}

function setContactText(el, value, fallback) {
  if (!el) return;
  clearContactSkeleton(el);
  el.textContent = (value && value.trim()) ? value.trim() : fallback;
}

function setContactEmail(value) {
  if (!contactEmail) return;
  clearContactSkeleton(contactEmail);
  const trimmed = (value || "").trim();
  if (trimmed && trimmed.includes("@")) {
    contactEmail.innerHTML = "";
    const link = document.createElement("a");
    link.href = `mailto:${trimmed}`;
    link.textContent = trimmed;
    contactEmail.appendChild(link);
  } else {
    contactEmail.textContent = "[email@pcshs.edu.ph]";
  }
}

async function loadContactInfo() {
  try {
    const snap = await getDoc(doc(db, "siteContent", "about"));
    const hero = snap.exists() ? (snap.data().hero || {}) : {};
    setContactEmail(hero.email);
    // Prefer a mobile/contact number; fall back to the landline if that's
    // the only one an admin has filled in.
    setContactText(contactPhone, hero.contactNumber || hero.landline, "[Contact Number]");
    setContactText(contactAddress, hero.address, "[School Address]");
  } catch (err) {
    console.error("support.js: couldn't load contact info:", err);
    setContactEmail(null);
    setContactText(contactPhone, null, "[Contact Number]");
    setContactText(contactAddress, null, "[School Address]");
  }
}

loadContactInfo();

// ─── SEND A MESSAGE FORM ───────────────────────────────────────────────────
supportForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  supportSubmitBtn.disabled = true;
  supportStatus.textContent = "Sending...";

  try {
    await addDoc(collection(db, "supportMessages"), {
      firstName:   document.getElementById("support-first-name").value.trim(),
      lastName:    document.getElementById("support-last-name").value.trim(),
      email:       document.getElementById("support-email").value.trim(),
      subject:     document.getElementById("support-subject").value,
      yearSection: document.getElementById("support-section").value.trim(),
      message:     document.getElementById("support-message").value.trim(),
      timestamp:   serverTimestamp(),
    });

    supportStatus.textContent = "Message sent! We'll get back to you soon.";
    supportForm.reset();
  } catch (err) {
    supportStatus.textContent = "Something went wrong: " + err.message;
  } finally {
    supportSubmitBtn.disabled = false;
  }
});