// learning-resources.js
// Handles the Learning Resources page — a fixed set of categories
// (Academic Materials, Study Support, DepEd Issuances, Downloadable Forms),
// each broken into a fixed set of subcategories (see CATEGORIES below). The
// categories/subcategories themselves are plain JS data, same as clubs.js's
// CLUB_LIST — adding, renaming, or removing one means editing CATEGORIES in
// this file, not something done from the page itself.
//
// Only the CONTENT inside each subcategory — a list of resource links — is
// Firestore-backed and admin/staff-editable, all living in a single
// document: siteContent/learningResources. That doc ID is covered by the
// SAME firestore.rules block already used for siteContent/about (public
// read, admin/staff write), so no rules changes were needed to add this
// page.
//
// A "resource" is just { title, url, description }. There's no file upload
// anywhere on this page — the whole point, per the brief, is that
// admin/staff paste a link (typically a Google Drive file or folder they
// already control) instead of uploading anything through the site. That
// also makes this the one content-editing page in the app that doesn't
// touch ImgBB at all.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ═══════════════════════════════════════════════════════════════════════
// FIXED CATEGORY / SUBCATEGORY STRUCTURE
// Source of truth for which categories/subcategories exist. Matches the
// four groups from the brief: Academic Materials, Study Support, DepEd
// Issuances, Downloadable Forms. The screenshot this page is based on was
// cut off before showing any bullet points under "Downloadable Forms", so
// that one category gets a single unlabeled bucket (label: null) instead of
// guessed-at subcategory names — admin/staff just add resources straight
// into it. If real subcategories for that one are wanted later (e.g.
// "Excuse Letters", "Clearance Forms"), split it the same way the other
// three are split: turn that one { id: "forms", label: null } entry into
// several { id, label } entries.
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  {
    id: "academic-materials",
    label: "Academic Materials",
    subcategories: [
      { id: "learning-links", label: "DepEd-Approved Learning Links" },
      { id: "modules", label: "Modules" },
      { id: "reviewers", label: "Reviewers" },
      { id: "video-lessons", label: "Video Lessons" },
      { id: "classlist-sections", label: "Classlist & Sections" },
      { id: "class-schedules", label: "Class Schedules" },
    ],
  },
  {
    id: "study-support",
    label: "Study Support",
    subcategories: [
      { id: "habits-techniques", label: "Recommended Habits & Techniques" },
      { id: "productivity-tools", label: "Productivity Tools" },
      { id: "practice-quizzes", label: "Practice Quizzes" },
      { id: "batch-reviewers", label: "Batch Reviewers" },
    ],
  },
  {
    id: "deped-issuances",
    label: "DepEd Issuances",
    subcategories: [
      { id: "term-timeline", label: "Term Timeline" },
      { id: "deped-calendar", label: "New DepEd Calendar" },
      { id: "circulars-memoranda", label: "Other DepEd Circulars & Memoranda" },
      { id: "school-handbook", label: "School Handbook" },
    ],
  },
  {
    id: "downloadable-forms",
    label: "Downloadable Forms",
    subcategories: [
      { id: "forms", label: null },
    ],
  },
];

// Builds { "academic-materials": { "learning-links": [], "modules": [], ... }, ... }
// straight from CATEGORIES, so the default shape can never drift out of
// sync with the actual category/subcategory list above.
function buildDefaults() {
  const defaults = {};
  CATEGORIES.forEach((cat) => {
    defaults[cat.id] = {};
    cat.subcategories.forEach((sub) => { defaults[cat.id][sub.id] = []; });
  });
  return defaults;
}
const DEFAULTS = buildDefaults();

// ─── RESOURCE-TYPE ICONS ────────────────────────────────────────────────
// Purely cosmetic — guessed from the URL so a Drive folder, a YouTube
// video, and a plain PDF don't all look identical in the list. Falls back
// to a generic link icon for anything else. No brand logos here on
// purpose — a real Google/YouTube logo is trademarked; these are plain
// generic shapes in the same stroke-icon style as the rest of the site.
const ICON_LINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a3.5 3.5 0 0 0 5 0l3.5-3.5a3.5 3.5 0 0 0-5-5L12 7"/><path d="M14 10a3.5 3.5 0 0 0-5 0L5.5 13.5a3.5 3.5 0 0 0 5 5L12 17"/></svg>`;
const ICON_DRIVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5a2 2 0 0 1 2-2h3.5l1.8 2H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>`;
const ICON_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10.2 8.7l5.6 3.3-5.6 3.3z" fill="currentColor" stroke="none"/></svg>`;
const ICON_DOC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h6.5L18 8v12.5H7z"/><path d="M13.5 3.5V8H18"/><line x1="9.5" y1="13" x2="15.5" y2="13"/><line x1="9.5" y1="16.5" x2="15.5" y2="16.5"/></svg>`;

function detectResourceIcon(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("drive.google.com") || u.includes("docs.google.com") || u.includes("forms.gle") || u.includes("sheets.google.com") || u.includes("slides.google.com")) return ICON_DRIVE;
  if (u.includes("youtube.com") || u.includes("youtu.be") || u.includes("vimeo.com")) return ICON_VIDEO;
  if (/\.pdf(\?|#|$)/.test(u)) return ICON_DOC;
  return ICON_LINK;
}

// Admin/staff often paste "drive.google.com/..." without a protocol — this
// keeps the saved link clickable either way instead of it becoming a
// broken relative link on this same site.
function normalizeUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// ─── STATE ──────────────────────────────────────────────────────────────
let isAdminOrStaff = false;
let pageData = null;   // merged Firestore data: pageData[categoryId][subcategoryId] -> resource[]
let dataReady = false; // true once the one-time siteContent/learningResources fetch resolves

// ─── DOM REFS ───────────────────────────────────────────────────────────
const lrCategories = document.getElementById("lr-categories");
const lrQuicknav = document.getElementById("lr-quicknav");
const lrModal = document.getElementById("lr-modal");
const lrModalBody = document.getElementById("lr-modal-body");

// ═══════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// No shared-utils module in this project (see CLAUDE.md) — same tradeoff
// as every other page-specific helper copy (clubs.js, about.js).
// ═══════════════════════════════════════════════════════════════════════

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Fills in whatever's missing from the saved Firestore data with the
// matching default (an empty array) — only fields truly undefined (never
// saved). A subcategory an admin genuinely emptied out on purpose (removed
// every resource) is left exactly as they left it, not silently restored.
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

// List editor for an array of objects (the resources inside one
// subcategory). `fields` describes each column: { key, label, type }.
// Renders straight into `container` and mutates `arr` in place as rows are
// added, edited, or removed — same helper as about.js's/clubs.js's own copy.
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
  addBtn.textContent = "+ Add Resource";
  addBtn.addEventListener("click", () => {
    arr.push({ ...blankEntry });
    renderObjectListEditor(container, arr, fields, blankEntry);
  });
  container.appendChild(addBtn);
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH — same admin/staff role check as every other page (users/{uid}.role)
// ═══════════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdminOrStaff = false;
    renderAll();
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : null;
    isAdminOrStaff = role === "admin" || role === "staff";
  } catch {
    isAdminOrStaff = false;
  }
  renderAll();
});

// ═══════════════════════════════════════════════════════════════════════
// LOAD CONTENT — one-time fetch of the whole siteContent/learningResources
// doc. If this fails (offline, permissions, etc.) the page still works:
// every subcategory just falls back to its empty default instead of
// breaking, same "never let one failed fetch break the whole page" rule
// the rest of the site follows.
// ═══════════════════════════════════════════════════════════════════════

async function loadData() {
  try {
    const snap = await getDoc(doc(db, "siteContent", "learningResources"));
    pageData = mergeDefaults(DEFAULTS, snap.exists() ? snap.data() : null);
  } catch (err) {
    console.error("learning-resources.js: loading siteContent/learningResources failed:", err);
    pageData = mergeDefaults(DEFAULTS, null);
  }
  dataReady = true;
  renderAll();
}

// ═══════════════════════════════════════════════════════════════════════
// QUICK-NAV PILLS — static, so this renders once, immediately. Plain
// anchor links (not JS tab-switching) reusing .tab-bar/.tab-btn purely for
// the pill styling — the site-wide smooth-scroll (see style.css) handles
// the rest.
// ═══════════════════════════════════════════════════════════════════════

function renderQuicknav() {
  if (!lrQuicknav) return;
  lrQuicknav.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const a = document.createElement("a");
    a.className = "tab-btn";
    a.href = `#cat-${cat.id}`;
    a.textContent = cat.label;
    lrQuicknav.appendChild(a);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// RENDER — full rebuild every call (auth change or data load), same as
// clubs.js's renderGrid(). Cheap at this scale (4 categories, ~15
// subcategory cards total) and avoids any partial-update bugs.
// ═══════════════════════════════════════════════════════════════════════

function renderAll() {
  if (!lrCategories) return;
  if (dataReady) lrCategories.removeAttribute("aria-busy");
  lrCategories.innerHTML = "";
  CATEGORIES.forEach((cat) => lrCategories.appendChild(buildCategorySection(cat)));
}

function buildCategorySection(cat) {
  const section = document.createElement("section");
  section.className = "about-section lr-category";
  section.id = `cat-${cat.id}`;

  const header = document.createElement("div");
  header.className = "about-section-header";
  const headingWrap = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = cat.label;
  headingWrap.appendChild(h2);
  header.appendChild(headingWrap);

  const singleSub = cat.subcategories.length === 1 ? cat.subcategories[0] : null;

  // A category with just one unlabeled bucket — currently only
  // Downloadable Forms — skips the subcategory-card grid entirely and
  // renders as one flat card instead, with its own "✎ Edit" button up in
  // the section header (reusing About page's own section-edit-btn/-slot)
  // rather than a lone card floating alone in an otherwise-empty grid.
  if (singleSub && !singleSub.label) {
    if (isAdminOrStaff) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "section-edit-btn";
      editBtn.textContent = "✎ Edit";
      editBtn.addEventListener("click", () => openEditModal(cat, singleSub));
      const slot = document.createElement("div");
      slot.className = "section-edit-slot";
      slot.appendChild(editBtn);
      header.appendChild(slot);
    }
    section.appendChild(header);

    const card = document.createElement("div");
    card.className = "lr-subcat-card";
    card.appendChild(
      dataReady
        ? buildResourceList((pageData[cat.id] && pageData[cat.id][singleSub.id]) || [])
        : buildResourceListSkeleton()
    );
    section.appendChild(card);
    return section;
  }

  section.appendChild(header);
  const grid = document.createElement("div");
  grid.className = "lr-subcat-grid";
  cat.subcategories.forEach((sub) => grid.appendChild(buildSubcatCard(cat, sub)));
  section.appendChild(grid);
  return section;
}

// Only ever called for subcategories that DO have a label — the one
// labelless bucket (Downloadable Forms) is special-cased above.
function buildSubcatCard(cat, sub) {
  const card = document.createElement("div");
  card.className = "lr-subcat-card";

  const header = document.createElement("div");
  header.className = "lr-subcat-header";
  const h3 = document.createElement("h3");
  h3.textContent = sub.label;
  header.appendChild(h3);

  if (isAdminOrStaff) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "lr-subcat-edit-btn";
    editBtn.setAttribute("aria-label", `Edit ${sub.label}`);
    editBtn.textContent = "✎";
    editBtn.addEventListener("click", () => openEditModal(cat, sub));
    header.appendChild(editBtn);
  }
  card.appendChild(header);

  card.appendChild(
    dataReady
      ? buildResourceList((pageData[cat.id] && pageData[cat.id][sub.id]) || [])
      : buildResourceListSkeleton()
  );

  return card;
}

function buildResourceList(resources) {
  if (resources.length === 0) {
    const empty = document.createElement("p");
    empty.className = "lr-resource-empty";
    empty.textContent = "No resources yet.";
    return empty;
  }

  const wrap = document.createElement("div");
  wrap.className = "lr-resource-list";
  resources.forEach((r) => {
    const item = document.createElement("a");
    item.className = "lr-resource-link";
    item.href = r.url;
    item.target = "_blank";
    item.rel = "noopener";

    const icon = document.createElement("span");
    icon.className = "lr-resource-icon";
    icon.innerHTML = detectResourceIcon(r.url);
    item.appendChild(icon);

    const text = document.createElement("span");
    text.className = "lr-resource-text";
    const title = document.createElement("span");
    title.className = "lr-resource-title";
    title.textContent = r.title;
    text.appendChild(title);
    if (r.description) {
      const desc = document.createElement("span");
      desc.className = "lr-resource-desc";
      desc.textContent = r.description;
      text.appendChild(desc);
    }
    item.appendChild(text);

    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    item.appendChild(arrow);

    wrap.appendChild(item);
  });
  return wrap;
}

// Shown while the one-time Firestore fetch is in flight. Reuses the real
// .lr-resource-link/.lr-resource-icon/.lr-resource-text shapes with .skel
// on the parts that would hold real content, per the site-wide skeleton
// convention (see CLAUDE.md) — so nothing visibly shifts once real
// resources swap in.
function buildResourceListSkeleton() {
  const wrap = document.createElement("div");
  wrap.className = "lr-resource-list";
  ["70%", "48%"].forEach((w) => {
    const item = document.createElement("div");
    item.className = "lr-resource-link is-skel";
    const icon = document.createElement("span");
    icon.className = "lr-resource-icon skel";
    item.appendChild(icon);
    const text = document.createElement("span");
    text.className = "lr-resource-text";
    text.innerHTML = `<span class="skel skel-line" style="width:${w};"></span>`;
    item.appendChild(text);
    wrap.appendChild(item);
  });
  return wrap;
}

renderQuicknav();  // static structure — renders immediately
renderAll();       // paints the skeleton right away, before auth/data resolve
loadData();

// ═══════════════════════════════════════════════════════════════════════
// EDIT MODAL — admin/staff only, reached via a subcategory card's own "✎"
// button (or the section-level "✎ Edit" for Downloadable Forms). Scoped to
// ONE subcategory at a time, same modal-per-small-unit pattern clubs.js
// uses for each club rather than about.js's inline swap — there are ~15
// of these small editable units on this page, so a modal keeps the page
// itself from turning into one giant always-open form.
// ═══════════════════════════════════════════════════════════════════════

function openEditModal(cat, sub) {
  lrModal.hidden = false;
  renderResourceEditor(cat, sub);
}

function closeEditModal() {
  lrModal.hidden = true;
  lrModalBody.innerHTML = "";
}

lrModal.addEventListener("click", (e) => { if (e.target === lrModal) closeEditModal(); });

function renderResourceEditor(cat, sub) {
  const existing = (pageData[cat.id] && pageData[cat.id][sub.id]) || [];
  const draft = deepClone(existing);

  lrModalBody.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = `Edit: ${sub.label || cat.label}`;
  lrModalBody.appendChild(heading);

  const hint = document.createElement("p");
  hint.className = "muted";
  hint.style.marginTop = "-8px";
  hint.style.marginBottom = "18px";
  hint.textContent = "💡 Paste a link for each resource — usually a Google Drive file or folder. Set that file/folder's sharing to \"Anyone with the link\" first, or students won't be able to open it.";
  lrModalBody.appendChild(hint);

  const container = document.createElement("div");
  renderObjectListEditor(
    container, draft,
    [
      { key: "title", label: "Title", type: "text" },
      { key: "url", label: "Link (Google Drive or any URL)", type: "text" },
      { key: "description", label: "Description (optional)", type: "textarea" },
    ],
    { title: "", url: "", description: "" }
  );
  lrModalBody.appendChild(container);

  const actions = document.createElement("div");
  actions.className = "modal-edit-actions";
  const status = document.createElement("span");
  status.className = "status-text";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closeEditModal);
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "Save Changes";
  saveBtn.addEventListener("click", () => saveSubcategory(cat, sub, draft, saveBtn, status));
  actions.appendChild(status);
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  lrModalBody.appendChild(actions);
}

async function saveSubcategory(cat, sub, draft, saveBtn, statusEl) {
  saveBtn.disabled = true;
  statusEl.textContent = "Saving...";
  try {
    const cleaned = draft
      .filter((r) => r.title && r.title.trim() && r.url && r.url.trim())
      .map((r) => ({
        title: r.title.trim(),
        url: normalizeUrl(r.url),
        description: (r.description || "").trim(),
      }));

    // Writes the WHOLE category object (every subcategory under it), not
    // just this one field. setDoc(..., {merge:true}) is only guaranteed to
    // merge at the document's TOP level — sending just
    // { [cat.id]: { [sub.id]: cleaned } } risks silently dropping this
    // category's OTHER subcategories if they aren't included in the same
    // write, so this always sends the complete category alongside the one
    // subcategory that actually changed.
    const fullCategory = { ...(pageData[cat.id] || {}), [sub.id]: cleaned };
    await setDoc(doc(db, "siteContent", "learningResources"), { [cat.id]: fullCategory }, { merge: true });

    pageData[cat.id] = fullCategory;
    closeEditModal();
    renderAll();
  } catch (err) {
    statusEl.textContent = "Something went wrong: " + err.message;
    saveBtn.disabled = false;
  }
}