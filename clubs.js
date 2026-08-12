// clubs.js
// Handles the Clubs page — a fixed roster of ~28 student organizations
// (see CLUB_LIST below), grouped into three categories and shown as a
// tabbed grid of cards. The roster itself (name/tagline/category) is
// static, defined right here in this file — only the per-club CONTENT
// (logo, description, events, achievements, social links) is editable
// and Firestore-backed, one document per club in the `clubs` collection,
// keyed by each club's fixed `id` below. Adding, renaming, or removing a
// club later means editing CLUB_LIST in this file, not something done
// from the page itself.
//
// Anyone can browse: click a card to open a read-only detail view.
// Admin/staff additionally get a small "✎" edit button on every card
// (and inside the detail view) that swaps the same modal into an
// editable form — a Facebook-style logo picker, a description box, two
// add/remove list editors (events, achievements), and four social-link
// fields — mirroring the view/edit-in-place pattern about.js already
// uses for the About page's sections.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Same ImgBB key used by announcements.js, lost-and-found.js, and about.js.
// Rotate in all four files if it's ever regenerated.
const IMGBB_API_KEY = "d40920dd92b750f2a83459dcff350957";

// ═══════════════════════════════════════════════════════════════════════
// FIXED ROSTER
// Source of truth for which clubs exist and what category each belongs
// to. `shortName`/`tagline` are written out in normal capitalization on
// purpose (not ALL CAPS, even though the official names are often given
// in caps) — the card/modal headings render them uppercase via CSS
// (.club-card-name / .club-modal-header h2), which keeps the branded
// all-caps look WITHOUT putting literal shouty text in the DOM, since
// screen readers can read long runs of literal capital letters as if
// they were an acronym, letter by letter.
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  { id: "academic",     label: "Academic / Co-Curricular",        fullLabel: "Academic / Co-Curricular Organizations" },
  { id: "non-academic", label: "Non-Academic / Extra-Curricular",  fullLabel: "Non-Academic / Extra-Curricular Organizations" },
  { id: "creatives",    label: "Creatives / SSLG-Affiliate",       fullLabel: "Creatives / SSLG-Affiliate Organizations" },
];

const CLUB_LIST = [
  // ── Academic / Co-Curricular ────────────────────────────────────────
  { id: "alchemist",           shortName: "Alchemist",                     tagline: "PCSHS Chemistry Club",                           category: "academic" },
  { id: "civitas",              shortName: "Civitas",                       tagline: "AP Club",                                        category: "academic" },
  { id: "constellate",          shortName: "Constellate",                   tagline: "Biology and Astrobiology Club",                  category: "academic" },
  { id: "dne",                  shortName: "DNE",                           tagline: "PCSHS Mathematics Club",                         category: "academic" },
  { id: "elite-debate-society", shortName: "Elite Debate Society",          tagline: "",                                               category: "academic" },
  { id: "gamma",                shortName: "Gamma",                         tagline: "",                                               category: "academic" },
  { id: "pluma",                shortName: "Pluma",                         tagline: "PCSHS Filipino Club",                            category: "academic" },
  { id: "scire-ang-pascian",    shortName: "Scire & Ang Pascian",           tagline: "",                                               category: "academic" },
  { id: "synctax",              shortName: "Synctax",                       tagline: "",                                               category: "academic" },
  { id: "tekmekanismo",         shortName: "Tekmekanismo",                  tagline: "PCSHS Robotics Club",                            category: "academic" },
  { id: "yes-o",                shortName: "YES-O",                         tagline: "Youth for Environment in Schools Organization",  category: "academic" },

  // ── Non-Academic / Extra-Curricular ─────────────────────────────────
  { id: "bert",                 shortName: "BERT",                          tagline: "Student Watching Team",                          category: "non-academic" },
  { id: "boy-scouts",           shortName: "Boy Scouts of the Philippines", tagline: "Pasig City Science High School",                 category: "non-academic" },
  { id: "coalition",            shortName: "Coalition",                     tagline: "",                                               category: "non-academic" },
  { id: "cat",                  shortName: "C.A.T.",                        tagline: "Citizenship Advancement Training",               category: "non-academic" },
  { id: "elevate",              shortName: "Elevate",                       tagline: "",                                               category: "non-academic" },
  { id: "fermata-pascians",     shortName: "Fermata Pascians",               tagline: "",                                              category: "non-academic" },
  { id: "gsp",                  shortName: "GSP",                           tagline: "Girl Scouts of the Philippines",                 category: "non-academic" },
  { id: "halikatha",            shortName: "Halikatha",                     tagline: "Ang Teatrong Pascian",                           category: "non-academic" },
  { id: "athlitikos",           shortName: "PCSHS Athlitikós",              tagline: "",                                               category: "non-academic" },
  { id: "gad",                  shortName: "PCSHS Gender and Development",  tagline: "",                                               category: "non-academic" },
  { id: "resonate",             shortName: "Resonate",                      tagline: "",                                               category: "non-academic" },
  { id: "sprcy",                shortName: "SPRCY",                         tagline: "Senior Plus Red Cross Youth",                    category: "non-academic" },

  // ── Creatives / SSLG-Affiliate ───────────────────────────────────────
  { id: "createam",             shortName: "Createam",                      tagline: "",                                               category: "creatives" },
  { id: "fps",                  shortName: "FPS",                           tagline: "Filming Pascian Stories",                        category: "creatives" },
  { id: "magnus-opus",          shortName: "Magnus Opus",                   tagline: "",                                               category: "creatives" },
  { id: "telecast",             shortName: "Telecast",                      tagline: "",                                               category: "creatives" },
  { id: "virtuoso",             shortName: "Virtuoso",                      tagline: "",                                               category: "creatives" },
];

// ═══════════════════════════════════════════════════════════════════════
// EDITABLE CONTENT — shape + defaults
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_CONTENT = {
  logo: "",
  description: "",
  events: [],
  achievements: [],
  socials: { facebook: "", instagram: "", tiktok: "", youtube: "" },
};

// Same four icons as the site-wide footer, reused here so a club's social
// row looks like a natural extension of the rest of the site rather than
// a different icon set.
const SOCIAL_ICONS = {
  facebook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h-2a5 5 0 0 0-5 5v3H6v4h2v6h4v-6h3l1-4h-4V8a1 1 0 0 1 1-1h3z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 4c.5 2.5 2.2 4.2 4.5 4.5"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="4"/><path d="M11 9.5l4 2.5-4 2.5z" fill="currentColor" stroke="none"/></svg>`,
};
const SOCIAL_LABELS = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

// ─── STATE ────────────────────────────────────────────────────────────────
let isAdminOrStaff = false;
let clubContent    = {};    // club id -> raw Firestore data (may be partial or missing)
let dataReady       = false; // true once the one-time `clubs` collection fetch resolves
let activeCategory  = CATEGORIES[0].id;

// ─── DOM REFS ─────────────────────────────────────────────────────────────
const categoryTabs  = document.getElementById("club-category-tabs");
const clubCountEl   = document.getElementById("club-count");
const clubGrid      = document.getElementById("club-grid");
const clubModal     = document.getElementById("club-modal");
const clubModalBody = document.getElementById("club-modal-body");

// ═══════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// This project has no build step or shared-utils module, so — same
// tradeoff as the ImgBB key above — these are each page's own copy
// rather than an import from about.js. Implementations match about.js's
// versions exactly.
// ═══════════════════════════════════════════════════════════════════════

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Fills in whatever's missing from the saved Firestore data with the
// matching default — but only fields that are truly undefined (never
// saved). A field an admin genuinely emptied out on purpose (blank
// string, empty array) is left exactly as they left it.
function mergeDefaults(defaults, data) {
  const src = data || {};
  const result = {};
  for (const key of Object.keys(defaults)) {
    const defVal = defaults[key];
    const dataVal = src[key];
    if (isPlainObject(defVal)) {
      result[key] = mergeDefaults(defVal, isPlainObject(dataVal) ? dataVal : undefined);
    } else if (Array.isArray(defVal)) {
      result[key] = Array.isArray(dataVal) ? dataVal : defVal;
    } else {
      result[key] = dataVal !== undefined ? dataVal : defVal;
    }
  }
  return result;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Always returns a complete, safe-to-read content object for a club, even
// if nothing has ever been saved for it (in which case every field is
// just DEFAULT_CONTENT's own empty value).
function getClubContent(id) {
  return mergeDefaults(DEFAULT_CONTENT, clubContent[id]);
}

async function uploadToImgBB(file) {
  const base64 = await fileToBase64(file);
  const formData = new FormData();
  formData.append("image", base64);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData,
  });
  const result = await response.json();
  if (!result.success) throw new Error("Image upload failed. Check the ImgBB API key.");
  return result.data.url;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Facebook-style single-image picker: click the box to open a file
// dialog, see an instant local preview, click again to replace it. Same
// widget as about.js's hero/symbol/org-chart pickers. The chosen File
// sits in memory on entry[key] until Save actually uploads it
// (resolveImage()) — nothing reaches ImgBB just from picking a file.
function buildImagePicker(entry, { className = "image-picker", placeholderText = "📷 Add photo", key = "image" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = className;

  const img = document.createElement("img");
  img.alt = "";
  const placeholder = document.createElement("span");
  placeholder.className = "image-picker-placeholder-text";
  placeholder.textContent = placeholderText;

  function refresh() {
    const val = entry[key];
    if (val instanceof File) {
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.readAsDataURL(val);
      img.hidden = false;
      placeholder.hidden = true;
    } else if (typeof val === "string" && val) {
      img.src = val;
      img.hidden = false;
      placeholder.hidden = true;
    } else {
      img.hidden = true;
      placeholder.hidden = false;
    }
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.addEventListener("change", () => {
    if (input.files[0]) {
      entry[key] = input.files[0];
      refresh();
    }
  });

  wrap.appendChild(img);
  wrap.appendChild(placeholder);
  wrap.appendChild(input);
  wrap.addEventListener("click", () => input.click());
  refresh();
  return wrap;
}

// Uploads entry[key] to ImgBB if it's a pending File; leaves an existing
// URL string (or an empty value) alone. Mutates entry[key] in place.
async function resolveImage(entry, key = "image") {
  if (entry[key] instanceof File) {
    entry[key] = await uploadToImgBB(entry[key]);
  }
}

function textField(label, obj, key, isTextarea = false) {
  const field = document.createElement("div");
  field.className = "form-field";
  const lab = document.createElement("label");
  lab.textContent = label;
  field.appendChild(lab);
  const input = document.createElement(isTextarea ? "textarea" : "input");
  if (!isTextarea) input.type = "text";
  else input.rows = 3;
  input.value = obj[key] || "";
  input.addEventListener("input", () => { obj[key] = input.value; });
  field.appendChild(input);
  return field;
}

function sectionLabel(text) {
  const h = document.createElement("h4");
  h.className = "edit-panel-subheading";
  h.textContent = text;
  return h;
}

// List editor for an array of objects (events, achievements). `fields`
// describes each column: { key, label, type: "text" | "textarea" }.
// Renders straight into `container` and mutates `arr` in place as rows
// are added, edited, or removed — same helper as about.js's own copy.
function renderObjectListEditor(container, arr, fields, blankEntry) {
  container.innerHTML = "";
  arr.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "list-editor-object-row";

    fields.forEach((f) => {
      const field = document.createElement("div");
      field.className = "form-field list-editor-field";
      const label = document.createElement("label");
      label.textContent = f.label;
      field.appendChild(label);

      const input = document.createElement(f.type === "textarea" ? "textarea" : "input");
      if (f.type !== "textarea") input.type = "text";
      else input.rows = 2;
      input.value = entry[f.key] || "";
      input.addEventListener("input", () => { entry[f.key] = input.value; });
      field.appendChild(input);
      row.appendChild(field);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "list-editor-remove";
    removeBtn.textContent = "✕ Remove";
    removeBtn.addEventListener("click", () => {
      arr.splice(i, 1);
      renderObjectListEditor(container, arr, fields, blankEntry);
    });
    row.appendChild(removeBtn);

    container.appendChild(row);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "list-editor-add";
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", () => {
    arr.push({ ...blankEntry });
    renderObjectListEditor(container, arr, fields, blankEntry);
  });
  container.appendChild(addBtn);
}

// Only renders icons for links that are actually filled in — a club with
// no social links yet just doesn't get this row at all, same "only show
// what has data" rule announcements.js's buildMetaRows() follows.
function buildSocialsHtml(socials) {
  const entries = Object.keys(SOCIAL_ICONS).filter((key) => socials && socials[key] && socials[key].trim());
  if (entries.length === 0) return "";
  const links = entries.map((key) => {
    const url = (socials[key] || "").trim();
    return `<a href="${escapeHtml(url)}" class="club-social-link" target="_blank" rel="noopener" aria-label="${SOCIAL_LABELS[key]}">${SOCIAL_ICONS[key]}</a>`;
  }).join("");
  return `<div class="club-modal-socials">${links}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH — same admin/staff role check as every other page (users/{uid}.role)
// ═══════════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdminOrStaff = false;
    renderGrid();
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : null;
    isAdminOrStaff = role === "admin" || role === "staff";
  } catch {
    isAdminOrStaff = false;
  }
  renderGrid();
});

// ═══════════════════════════════════════════════════════════════════════
// LOAD CLUB CONTENT
// One-time fetch of the whole `clubs` collection — at most ~28 small
// documents, well inside a single free-tier read budget, so there's no
// pagination or per-category fetching here. If this fails (offline,
// permissions, etc.) the page still works: every club just falls back to
// DEFAULT_CONTENT's empty state instead of breaking.
// ═══════════════════════════════════════════════════════════════════════

async function loadClubContent() {
  try {
    const snap = await getDocs(collection(db, "clubs"));
    const raw = {};
    snap.forEach((d) => { raw[d.id] = d.data(); });
    clubContent = raw;
  } catch (err) {
    console.error("clubs.js: loadClubContent failed:", err);
    clubContent = {};
  }
  dataReady = true;
  renderGrid();
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY TABS
// Static data, so these render immediately — no loading state needed for
// the tabs themselves, only for what's inside the grid below them.
// ═══════════════════════════════════════════════════════════════════════

function renderCategoryTabs() {
  categoryTabs.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-btn";
    btn.textContent = cat.label;
    btn.addEventListener("click", () => selectCategory(cat.id));
    categoryTabs.appendChild(btn);
  });
  selectCategory(activeCategory);
}

function selectCategory(catId) {
  activeCategory = catId;
  categoryTabs.querySelectorAll(".tab-btn").forEach((b, i) => {
    b.classList.toggle("active", CATEGORIES[i].id === catId);
  });
  renderGrid();
}

// ═══════════════════════════════════════════════════════════════════════
// GRID + CARDS
// The roster (CLUB_LIST) is known synchronously, so the grid paints
// immediately with real names/taglines every time — only each card's
// logo and description shimmer as loading placeholders until dataReady
// flips true, at which point renderGrid() runs again with real content.
// ═══════════════════════════════════════════════════════════════════════

function renderGrid() {
  const clubs = CLUB_LIST.filter((c) => c.category === activeCategory);
  if (clubCountEl) {
    clubCountEl.textContent = dataReady
      ? `${clubs.length} organization${clubs.length === 1 ? "" : "s"}`
      : "";
  }
  if (!clubGrid) return;
  clubGrid.innerHTML = "";
  clubs.forEach((club) => clubGrid.appendChild(buildClubCard(club)));
}

function buildClubCard(club) {
  const content = dataReady ? getClubContent(club.id) : null;

  const card = document.createElement("div");
  card.className = "club-card" + (dataReady ? "" : " is-skel");

  // Logo
  const logo = document.createElement("div");
  logo.className = "club-card-logo";
  if (!dataReady) {
    logo.classList.add("skel");
  } else if (content.logo) {
    const img = document.createElement("img");
    img.src = content.logo;
    img.alt = "";
    img.loading = "lazy";
    logo.appendChild(img);
  } else {
    logo.classList.add("club-card-logo-empty");
    const span = document.createElement("span");
    span.textContent = club.shortName.trim().charAt(0).toUpperCase();
    logo.appendChild(span);
  }
  card.appendChild(logo);

  // Name / tagline / description preview
  const body = document.createElement("div");
  body.className = "club-card-body";

  const name = document.createElement("h3");
  name.className = "club-card-name";
  name.textContent = club.shortName;
  body.appendChild(name);

  if (club.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "club-card-tagline";
    tagline.textContent = club.tagline;
    body.appendChild(tagline);
  }

  const desc = document.createElement("p");
  desc.className = "club-card-desc";
  if (!dataReady) {
    desc.innerHTML = `<span class="skel skel-line" style="width:100%;"></span><span class="skel skel-line" style="width:65%;"></span>`;
  } else if (content.description) {
    desc.textContent = content.description;
  } else {
    desc.textContent = "No description yet.";
    desc.classList.add("club-card-desc-empty");
  }
  body.appendChild(desc);
  card.appendChild(body);

  // Interactivity only attaches once real content exists — a skeleton
  // card isn't clickable, matching the non-interactive-skeleton pattern
  // used across the rest of the site.
  if (dataReady) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `View ${club.shortName}`);
    card.addEventListener("click", () => openClubModal(club, "view"));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openClubModal(club, "view");
      }
    });

    if (isAdminOrStaff) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "club-card-edit-btn";
      editBtn.setAttribute("aria-label", `Edit ${club.shortName}`);
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openClubModal(club, "edit");
      });
      card.appendChild(editBtn);
    }
  }

  return card;
}

renderCategoryTabs(); // static roster — renders (and picks the first tab) immediately
loadClubContent();

// ═══════════════════════════════════════════════════════════════════════
// MODAL — shared shell, swapped between a read-only VIEW and an
// admin/staff-only EDIT form, same in-place swap pattern about.js uses
// for each About-page section.
// ═══════════════════════════════════════════════════════════════════════

function openClubModal(club, mode) {
  clubModal.hidden = false;
  if (mode === "edit") renderClubEdit(club);
  else renderClubView(club);
}

function closeClubModal() {
  clubModal.hidden = true;
  clubModalBody.innerHTML = "";
}

clubModal.addEventListener("click", (e) => { if (e.target === clubModal) closeClubModal(); });

// ─── VIEW MODE ──────────────────────────────────────────────────────────
function renderClubView(club) {
  const content = getClubContent(club.id);
  const category = CATEGORIES.find((c) => c.id === club.category);

  const logoHtml = content.logo
    ? `<img src="${escapeHtml(content.logo)}" alt="">`
    : `<span>${escapeHtml(club.shortName.trim().charAt(0).toUpperCase())}</span>`;

  const eventsHtml = content.events.length
    ? content.events.map((e) => `
        <div class="club-event-item">
          ${e.date ? `<span class="club-event-date">${escapeHtml(e.date)}</span>` : ""}
          <div class="club-event-body">
            <strong>${escapeHtml(e.title || "Untitled event")}</strong>
            ${e.description ? `<p>${escapeHtml(e.description)}</p>` : ""}
          </div>
        </div>`).join("")
    : `<p class="club-modal-empty">No events posted yet.</p>`;

  const achHtml = content.achievements.length
    ? content.achievements.map((a) => `
        <div class="club-achievement-item">
          ${a.year ? `<span class="club-achievement-year">${escapeHtml(a.year)}</span>` : ""}
          <div class="club-achievement-body">
            <strong>${escapeHtml(a.title || "Untitled achievement")}</strong>
            ${a.description ? `<p>${escapeHtml(a.description)}</p>` : ""}
          </div>
        </div>`).join("")
    : `<p class="club-modal-empty">No achievements yet.</p>`;

  clubModalBody.innerHTML = `
    <div class="club-modal-header">
      <div class="club-modal-logo${content.logo ? "" : " club-modal-logo-empty"}">${logoHtml}</div>
      <div>
        <span class="eyebrow">${escapeHtml(category ? category.label : "")}</span>
        <h2>${escapeHtml(club.shortName)}</h2>
        ${club.tagline ? `<p class="club-modal-tagline">${escapeHtml(club.tagline)}</p>` : ""}
      </div>
    </div>
    <div class="club-modal-section">
      <h3>About</h3>
      ${content.description ? `<p>${escapeHtml(content.description)}</p>` : `<p class="club-modal-empty">No description yet.</p>`}
    </div>
    <div class="club-modal-section">
      <h3>Events</h3>
      ${eventsHtml}
    </div>
    <div class="club-modal-section">
      <h3>Achievements</h3>
      ${achHtml}
    </div>
    ${buildSocialsHtml(content.socials)}
    <div class="modal-footer" id="club-view-footer"></div>
  `;

  const footer = document.getElementById("club-view-footer");
  if (isAdminOrStaff) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-secondary";
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("click", () => renderClubEdit(club));
    footer.appendChild(editBtn);
  }
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn-primary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeClubModal);
  footer.appendChild(closeBtn);
}

// ─── EDIT MODE (admin/staff only — reached via a card's own edit button
// or the "✎ Edit" button inside view mode) ──────────────────────────────
function renderClubEdit(club) {
  const draft = deepClone(getClubContent(club.id));

  clubModalBody.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = `Edit ${club.shortName}`;
  clubModalBody.appendChild(heading);

  const logoField = document.createElement("div");
  logoField.className = "form-field";
  const logoLabel = document.createElement("label");
  logoLabel.textContent = "Club Logo";
  logoField.appendChild(logoLabel);
  logoField.appendChild(buildImagePicker(draft, {
    className: "image-picker image-picker-club",
    placeholderText: "📷 Click to upload a logo",
    key: "logo",
  }));
  clubModalBody.appendChild(logoField);

  clubModalBody.appendChild(textField("Description", draft, "description", true));

  clubModalBody.appendChild(sectionLabel("Events"));
  const eventsContainer = document.createElement("div");
  renderObjectListEditor(
    eventsContainer, draft.events,
    [
      { key: "title", label: "Event Title", type: "text" },
      { key: "date", label: "Date", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    { title: "", date: "", description: "" }
  );
  clubModalBody.appendChild(eventsContainer);

  clubModalBody.appendChild(sectionLabel("Achievements"));
  const achContainer = document.createElement("div");
  renderObjectListEditor(
    achContainer, draft.achievements,
    [
      { key: "title", label: "Achievement Title", type: "text" },
      { key: "year", label: "Year", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    { title: "", year: "", description: "" }
  );
  clubModalBody.appendChild(achContainer);

  clubModalBody.appendChild(sectionLabel("Social Media Links"));
  const socialsGrid = document.createElement("div");
  socialsGrid.className = "import-meta-grid";
  socialsGrid.appendChild(textField("Facebook URL", draft.socials, "facebook"));
  socialsGrid.appendChild(textField("Instagram URL", draft.socials, "instagram"));
  socialsGrid.appendChild(textField("TikTok URL", draft.socials, "tiktok"));
  socialsGrid.appendChild(textField("YouTube URL", draft.socials, "youtube"));
  clubModalBody.appendChild(socialsGrid);

  const actions = document.createElement("div");
  actions.className = "modal-edit-actions";
  const status = document.createElement("span");
  status.className = "status-text";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => renderClubView(club));
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "Save Changes";
  saveBtn.addEventListener("click", () => saveClub(club, draft, saveBtn, status));
  actions.appendChild(status);
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  clubModalBody.appendChild(actions);
}

async function saveClub(club, draft, saveBtn, statusEl) {
  saveBtn.disabled = true;
  statusEl.textContent = "Saving...";
  try {
    await resolveImage(draft, "logo");
    const payload = {
      logo: draft.logo || "",
      description: (draft.description || "").trim(),
      // Blank rows left over from clicking "+ Add" without filling
      // anything in are dropped on save rather than stored as empty
      // entries.
      events: (draft.events || [])
        .filter((e) => e.title && e.title.trim())
        .map((e) => ({
          title: e.title.trim(),
          date: (e.date || "").trim(),
          description: (e.description || "").trim(),
        })),
      achievements: (draft.achievements || [])
        .filter((a) => a.title && a.title.trim())
        .map((a) => ({
          title: a.title.trim(),
          year: (a.year || "").trim(),
          description: (a.description || "").trim(),
        })),
      socials: {
        facebook: (draft.socials.facebook || "").trim(),
        instagram: (draft.socials.instagram || "").trim(),
        tiktok: (draft.socials.tiktok || "").trim(),
        youtube: (draft.socials.youtube || "").trim(),
      },
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "clubs", club.id), payload, { merge: true });
    clubContent[club.id] = payload;
    renderGrid();
    renderClubView(club);
  } catch (err) {
    statusEl.textContent = "Something went wrong: " + err.message;
    saveBtn.disabled = false;
  }
}