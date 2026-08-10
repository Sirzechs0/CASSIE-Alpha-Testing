// about.js
// Public: reads the About page content from Firestore (siteContent/about)
// and renders it.
// Admin/staff: a small "✎ Edit" button appears at the top of each section.
// Clicking it swaps just THAT section into an editable form; Save writes
// only that section's field back to Firestore, Cancel throws the draft
// away and re-shows whatever was last saved. Sections never interfere with
// each other — editing History can't accidentally touch Admission.
//
// Until an admin saves real content, every field falls back to a Lorem
// Ipsum paragraph (or a bracketed placeholder like "[Fast Fact]" for short
// factual fields — a phone number or a person's name isn't something Lorem
// Ipsum makes sense for) so the page always looks complete, never broken.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Same ImgBB key used by announcements.js and lost-and-found.js.
// Rotate in all three files if it's ever regenerated.
const IMGBB_API_KEY = "d40920dd92b750f2a83459dcff350957";

// ─── PLACEHOLDER TEXT ─────────────────────────────────────────────────────
const LOREM_S = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const LOREM_M = LOREM_S + " Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
const LOREM_L = LOREM_M + " Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";

// ─── DEFAULT CONTENT (shown until an admin saves real content over it) ────
// Each top-level key here is exactly one Firestore field on siteContent/about,
// and exactly one editable section on the page.
const DEFAULTS = {
  hero: {
    backgroundImage: "",
    tagline: "We Excel, We Serve, We Lead",
    contactNumber: "[Contact Number]",
    landline: "[Landline]",
    email: "[email@pcshs.edu.ph]",
    address: "[School Address]",
  },
  purpose: {
    vision: LOREM_M,
    mission: LOREM_M,
  },
  about: {
    description: LOREM_L,
    motto: LOREM_S,
  },
  history: {
    intro: LOREM_M,
    milestones: [
      { year: "[20XX]", tag: "[Tag]", title: "[Milestone Title]", description: LOREM_S },
      { year: "[20XX]", tag: "[Tag]", title: "[Milestone Title]", description: LOREM_S },
      { year: "[20XX]", tag: "[Tag]", title: "[Milestone Title]", description: LOREM_S },
    ],
    fastFacts: ["[Fast Fact]", "[Fast Fact]", "[Fast Fact]"],
    principals: [
      { name: "[Principal Name]", years: "[20XX–20XX]" },
      { name: "[Principal Name]", years: "[20XX–20XX]" },
    ],
  },
  symbols: [
    { title: "[Symbol Name]", description: LOREM_S, image: "" },
    { title: "[Symbol Name]", description: LOREM_S, image: "" },
    { title: "[Symbol Name]", description: LOREM_S, image: "" },
  ],
  awards: [
    { title: "[Award Title]", year: "[20XX]", description: LOREM_S },
    { title: "[Award Title]", year: "[20XX]", description: LOREM_S },
    { title: "[Award Title]", year: "[20XX]", description: LOREM_S },
  ],
  orgChart: [
    { name: "[Name]", position: "[Position]", image: "" },
    { name: "[Name]", position: "[Position]", image: "" },
    { name: "[Name]", position: "[Position]", image: "" },
    { name: "[Name]", position: "[Position]", image: "" },
  ],
  courses: {
    jhs: LOREM_M,
    shsStrand: LOREM_M,
    electives: ["[Elective Subject]", "[Elective Subject]", "[Elective Subject]"],
  },
  admission: {
    qualifications: LOREM_M,
    requirements: ["[Document Requirement]", "[Document Requirement]", "[Document Requirement]", "[Document Requirement]"],
    steps: [
      { title: "USHAT", description: LOREM_S },
      { title: "Interview", description: LOREM_S },
      { title: "Uniform Requirements", description: LOREM_S },
    ],
  },
};

// ─── STATE ────────────────────────────────────────────────────────────────
let isAdminOrStaff = false;
let pageData = null; // last-saved content merged with defaults — what's currently on screen

// ─── DOM REFS ─────────────────────────────────────────────────────────────
const heroBg = document.getElementById("hero-bg");
const heroTagline = document.getElementById("hero-tagline");
const heroContactBar = document.getElementById("hero-contact-bar");
const purposeBody = document.getElementById("purpose-body");
const aboutBody = document.getElementById("about-body");
const historyBody = document.getElementById("history-body");
const symbolsBody = document.getElementById("symbols-body");
const awardsBody = document.getElementById("awards-body");
const orgChartBody = document.getElementById("orgchart-body");
const coursesBody = document.getElementById("courses-body");
const admissionBody = document.getElementById("admission-body");

// ════════════════════════════════════════════════════════════════════════════════
// SKELETON LOADING STATE
// Painted immediately, synchronously, before the auth check or the
// Firestore fetch below have resolved — every section container in
// about.html starts out as an empty <div>, so without this the page would
// show a blank gap where each section's real content will eventually
// land. renderAll() (only called once BOTH authReady and dataReady are
// true) overwrites every one of these with real content exactly the way
// it always has — nothing here needs to be manually cleared.
// ════════════════════════════════════════════════════════════════════════════════

function skelBar(width = "100%", extra = "") {
  return `<span class="skel skel-line" style="width:${width};${extra}"></span>`;
}
function repeat(n, fn) {
  return Array.from({ length: n }, fn).join("");
}

function renderSkeletons() {
  heroContactBar.innerHTML = repeat(4, () => `
    <div class="about-contact-item">
      <span class="about-contact-label">&nbsp;</span>
      ${skelBar("70%")}
    </div>`);

  purposeBody.innerHTML = repeat(2, () => `
    <div class="purpose-card">
      ${skelBar("18%", "height:1rem;margin-bottom:14px;")}
      ${skelBar("45%", "height:1.3rem;margin-bottom:12px;")}
      ${skelBar("100%")}
      ${skelBar("85%")}
    </div>`);

  aboutBody.innerHTML = `
    <div class="about-desc">${skelBar("100%")}${skelBar("100%")}${skelBar("60%")}</div>
    <div class="motto-callout">
      ${skelBar("30%", "height:0.7rem;margin-bottom:10px;")}
      ${skelBar("90%", "height:1.1rem;")}
    </div>`;

  historyBody.innerHTML = `
    ${skelBar("100%")}${skelBar("95%")}${skelBar("50%")}
    <div class="chip-list" style="margin-top:16px;">
      ${repeat(3, () => skelBar("110px", "height:1.8rem;border-radius:999px;display:inline-block;"))}
    </div>
    <div class="history-timeline">
      ${repeat(2, () => `
        <div class="timeline-row">
          <div class="timeline-marker">${skelBar("54px", "height:1.6rem;border-radius:999px;")}</div>
          <div class="timeline-card">
            ${skelBar("30%", "height:0.7rem;margin-bottom:8px;")}
            ${skelBar("50%", "height:1rem;margin-bottom:8px;")}
            ${skelBar("90%")}
          </div>
        </div>`)}
    </div>`;

  symbolsBody.innerHTML = repeat(3, () => `
    <div class="symbol-card">
      <div class="symbol-card-image skel"></div>
      ${skelBar("60%", "height:1.05rem;margin-bottom:8px;")}
      ${skelBar("100%")}
    </div>`);

  awardsBody.innerHTML = repeat(3, () => `
    <div class="award-item">
      ${skelBar("70px", "height:1.6rem;border-radius:999px;flex-shrink:0;")}
      <div class="award-item-body" style="flex:1;">
        ${skelBar("55%", "height:1rem;margin-bottom:8px;")}
        ${skelBar("90%")}
      </div>
    </div>`);

  orgChartBody.innerHTML = repeat(4, () => `
    <div class="org-card">
      <div class="org-card-photo skel"></div>
      ${skelBar("70%", "height:0.96rem;margin:0 auto 6px;")}
      ${skelBar("50%", "height:0.8rem;margin:0 auto;")}
    </div>`);

  coursesBody.innerHTML = `
    <div class="course-blocks">
      ${repeat(2, () => `
        <div class="course-block">
          ${skelBar("40%", "height:0.68rem;margin-bottom:12px;")}
          ${skelBar("100%")}${skelBar("80%")}
        </div>`)}
    </div>
    <div class="chip-list" style="margin-top:20px;">
      ${repeat(4, () => skelBar("90px", "height:1.8rem;border-radius:999px;display:inline-block;"))}
    </div>`;

  admissionBody.innerHTML = `
    ${skelBar("100%")}${skelBar("70%")}
    <ul class="checklist" style="margin-top:20px;">
      ${repeat(4, () => `<li>${skelBar("60%")}</li>`)}
    </ul>
    <div class="process-steps">
      ${repeat(3, () => `
        <div class="process-step">
          ${skelBar("32px", "height:32px;border-radius:50%;margin-bottom:14px;")}
          ${skelBar("60%", "height:1.05rem;margin-bottom:8px;")}
          ${skelBar("90%")}
        </div>`)}
    </div>`;
}
renderSkeletons();

// ─── AUTH ─────────────────────────────────────────────────────────────────
// The role check (needs Firestore) and the page content load (also needs
// Firestore) run at the same time, independently. Both set a "ready" flag
// and only call renderAll() once BOTH are ready — so the very first render
// always has the correct isAdminOrStaff value, instead of possibly
// rendering once early (with isAdminOrStaff still at its default false)
// if the content finishes loading before the role check comes back.
let authReady = false;
let dataReady = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdminOrStaff = false;
  } else {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const role = snap.exists() ? snap.data().role : null;
      isAdminOrStaff = role === "admin" || role === "staff";
    } catch (err) {
      console.error("about.js: role check failed:", err);
      isAdminOrStaff = false;
    }
  }
  authReady = true;
  if (dataReady) renderAll();
});

async function loadData() {
  try {
    const snap = await getDoc(doc(db, "siteContent", "about"));
    pageData = mergeWithDefaults(DEFAULTS, snap.exists() ? snap.data() : null);
  } catch (err) {
    console.error("about.js: loading siteContent/about failed:", err);
    pageData = mergeWithDefaults(DEFAULTS, null);
  }
  dataReady = true;
  if (authReady) renderAll();
}

// Renders every section. Each one runs in its own try/catch so a problem
// in one section (bad data shape, missing element, etc.) can't stop the
// rest of the page — or their edit buttons — from rendering too.
function renderAll() {
  if (!pageData) return;
  const sections = [
    renderHeroView, renderPurposeView, renderAboutView, renderHistoryView,
    renderSymbolsView, renderAwardsView, renderOrgChartView, renderCoursesView,
    renderAdmissionView,
  ];
  for (const renderSection of sections) {
    try {
      renderSection();
    } catch (err) {
      console.error(`about.js: ${renderSection.name} failed:`, err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED HELPERS
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
// saved). A field the admin genuinely emptied out on purpose (blank string,
// empty array) is left exactly as they left it, not silently restored.
function mergeWithDefaults(defaults, data) {
  const src = data || {};
  const result = {};
  for (const key of Object.keys(defaults)) {
    const defVal = defaults[key];
    const dataVal = src[key];
    if (isPlainObject(defVal)) {
      result[key] = mergeWithDefaults(defVal, isPlainObject(dataVal) ? dataVal : undefined);
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

// Small "✎ Edit" pill — only rendered for admin/staff. Everyone else gets
// an empty fragment, so the section header layout stays identical either way.
function buildEditButton(onClick) {
  if (!isAdminOrStaff) return document.createDocumentFragment();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "section-edit-btn";
  btn.textContent = "✎ Edit";
  btn.addEventListener("click", onClick);
  return btn;
}

function setEditSlot(id, node) {
  const slot = document.getElementById(id);
  if (!slot) return;
  slot.innerHTML = "";
  slot.appendChild(node);
}

// Save / Cancel row at the bottom of every section's edit form.
function buildEditActions({ onSave, onCancel }) {
  const wrap = document.createElement("div");
  wrap.className = "about-edit-actions";

  const status = document.createElement("span");
  status.className = "status-text";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", onCancel);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "Save Changes";
  saveBtn.addEventListener("click", () => onSave(saveBtn, status));

  wrap.appendChild(status);
  wrap.appendChild(cancelBtn);
  wrap.appendChild(saveBtn);
  return { wrap, status, saveBtn };
}

// Writes just ONE top-level field of siteContent/about (merge:true means
// every other section's already-saved data is left completely untouched).
async function saveSection(fieldName, value) {
  await setDoc(doc(db, "siteContent", "about"), { [fieldName]: value }, { merge: true });
}

function textField(label, obj, key, isTextarea = false) {
  const field = document.createElement("div");
  field.className = "form-field";
  const lab = document.createElement("label");
  lab.textContent = label;
  field.appendChild(lab);
  const input = document.createElement(isTextarea ? "textarea" : "input");
  if (!isTextarea) input.type = "text";
  else input.rows = 4;
  input.value = obj[key] || "";
  input.addEventListener("input", () => { obj[key] = input.value; });
  field.appendChild(input);
  return field;
}

function labeledField(label, node) {
  const field = document.createElement("div");
  field.className = "form-field";
  const lab = document.createElement("label");
  lab.textContent = label;
  field.appendChild(lab);
  field.appendChild(node);
  return field;
}

function sectionLabel(text) {
  const h = document.createElement("h4");
  h.className = "edit-panel-subheading";
  h.textContent = text;
  return h;
}

// ---------- Single-image picker (hero background, a symbol's image, an org
// chart member's photo). Shows the current image (or a placeholder square),
// clicking opens a file picker. The chosen File sits in memory on
// entry[key] until the section is actually saved — nothing uploads early.
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

// ---------- List editor for a plain array of short strings (fast facts,
// electives, document requirements). Renders straight into `container` and
// mutates `arr` in place as rows are added, edited, or removed.
function renderStringListEditor(container, arr, placeholder) {
  container.innerHTML = "";
  arr.forEach((val, i) => {
    const row = document.createElement("div");
    row.className = "list-editor-row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = val;
    input.placeholder = placeholder;
    input.addEventListener("input", () => { arr[i] = input.value; });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "list-editor-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      arr.splice(i, 1);
      renderStringListEditor(container, arr, placeholder);
    });

    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "list-editor-add";
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", () => {
    arr.push("");
    renderStringListEditor(container, arr, placeholder);
  });
  container.appendChild(addBtn);
}

// ---------- List editor for an array of objects (symbols, awards,
// principals, org chart members, admission steps). `fields` describes each
// column: { key, label, type: "text" | "textarea" | "image" }.
function renderObjectListEditor(container, arr, fields, blankEntry) {
  container.innerHTML = "";
  arr.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "list-editor-object-row";

    fields.forEach((f) => {
      if (f.type === "image") {
        row.appendChild(buildImagePicker(entry, { className: "image-picker image-picker-sm" }));
        return;
      }
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

// ═══════════════════════════════════════════════════════════════════════
// HERO
// ═══════════════════════════════════════════════════════════════════════

function renderHeroView() {
  const h = pageData.hero;

  if (h.backgroundImage) {
    heroBg.style.backgroundImage = `url('${h.backgroundImage}')`;
    heroBg.classList.remove("about-hero-bg-fallback");
  } else {
    heroBg.style.backgroundImage = "";
    heroBg.classList.add("about-hero-bg-fallback");
  }
  heroTagline.textContent = h.tagline;

  heroContactBar.innerHTML = `
    <div class="about-contact-item"><span class="about-contact-label">Phone</span>${escapeHtml(h.contactNumber)}</div>
    <div class="about-contact-item"><span class="about-contact-label">Landline</span>${escapeHtml(h.landline)}</div>
    <div class="about-contact-item"><span class="about-contact-label">Email</span>${escapeHtml(h.email)}</div>
    <div class="about-contact-item"><span class="about-contact-label">Address</span>${escapeHtml(h.address)}</div>`;

  setEditSlot("hero-edit-slot", buildEditButton(renderHeroEdit));
}

function renderHeroEdit() {
  const draft = deepClone(pageData.hero);

  const picker = buildImagePicker(draft, {
    className: "image-picker image-picker-hero",
    placeholderText: "📷 Click to set the hero background photo",
    key: "backgroundImage",
  });

  const form = document.createElement("div");
  form.className = "about-edit-panel";
  form.appendChild(labeledField("Background Photo", picker));
  form.appendChild(textField("Tagline", draft, "tagline"));

  const grid = document.createElement("div");
  grid.className = "import-meta-grid";
  grid.appendChild(textField("Contact Number", draft, "contactNumber"));
  grid.appendChild(textField("Landline", draft, "landline"));
  grid.appendChild(textField("Email Address", draft, "email"));
  grid.appendChild(textField("School Address", draft, "address"));
  form.appendChild(grid);

  const { wrap } = buildEditActions({
    onCancel: renderHeroView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await resolveImage(draft, "backgroundImage");
        await saveSection("hero", draft);
        pageData.hero = draft;
        renderHeroView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  setEditSlot("hero-edit-slot", document.createDocumentFragment());
  heroContactBar.innerHTML = "";
  heroContactBar.appendChild(form);
}

// ═══════════════════════════════════════════════════════════════════════
// PURPOSE (Vision / Mission)
// ═══════════════════════════════════════════════════════════════════════

function renderPurposeView() {
  const p = pageData.purpose;
  purposeBody.innerHTML = `
    <div class="purpose-card">
      <span class="purpose-number">01</span>
      <h3>Vision</h3>
      <p>${escapeHtml(p.vision)}</p>
    </div>
    <div class="purpose-card">
      <span class="purpose-number">02</span>
      <h3>Mission</h3>
      <p>${escapeHtml(p.mission)}</p>
    </div>`;
  setEditSlot("purpose-edit-slot", buildEditButton(renderPurposeEdit));
}

function renderPurposeEdit() {
  const draft = deepClone(pageData.purpose);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  form.appendChild(textField("Vision", draft, "vision", true));
  form.appendChild(textField("Mission", draft, "mission", true));

  const { wrap } = buildEditActions({
    onCancel: renderPurposeView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await saveSection("purpose", draft);
        pageData.purpose = draft;
        renderPurposeView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  purposeBody.innerHTML = "";
  purposeBody.appendChild(form);
  setEditSlot("purpose-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// ABOUT
// ═══════════════════════════════════════════════════════════════════════

function renderAboutView() {
  const a = pageData.about;
  aboutBody.innerHTML = `
    <div class="about-desc"><p>${escapeHtml(a.description)}</p></div>
    <div class="motto-callout">
      <span class="motto-callout-label">Our Motto</span>
      <p>${escapeHtml(a.motto)}</p>
    </div>`;
  setEditSlot("about-edit-slot", buildEditButton(renderAboutEdit));
}

function renderAboutEdit() {
  const draft = deepClone(pageData.about);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  form.appendChild(textField("School Description", draft, "description", true));
  form.appendChild(textField("Motto Explanation", draft, "motto", true));

  const { wrap } = buildEditActions({
    onCancel: renderAboutView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await saveSection("about", draft);
        pageData.about = draft;
        renderAboutView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  aboutBody.innerHTML = "";
  aboutBody.appendChild(form);
  setEditSlot("about-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// HISTORY (intro + "through the years" timeline + fast facts + principals)
// ═══════════════════════════════════════════════════════════════════════

function renderHistoryView() {
  const h = pageData.history;

  const factsHtml = h.fastFacts.map((f) => `<span class="chip">${escapeHtml(f)}</span>`).join("");
  const timelineHtml = h.milestones.map((m) => `
    <div class="timeline-row">
      <div class="timeline-marker"><span class="timeline-year">${escapeHtml(m.year)}</span></div>
      <div class="timeline-card">
        <span class="timeline-tag">${escapeHtml(m.tag)}</span>
        <h4>${escapeHtml(m.title)}</h4>
        <p>${escapeHtml(m.description)}</p>
      </div>
    </div>`).join("");
  const principalsHtml = h.principals.map((p) => `
    <div class="principal-card">
      <span class="principal-name">${escapeHtml(p.name)}</span>
      <span class="principal-years">${escapeHtml(p.years)}</span>
    </div>`).join("");

  historyBody.innerHTML = `
    <p class="about-intro-text">${escapeHtml(h.intro)}</p>
    <div class="chip-list">${factsHtml}</div>
    <div class="history-timeline">${timelineHtml}</div>
    <h3 class="history-subheading">Former Principals</h3>
    <div class="principal-grid">${principalsHtml}</div>`;

  setEditSlot("history-edit-slot", buildEditButton(renderHistoryEdit));
}

function renderHistoryEdit() {
  const draft = deepClone(pageData.history);
  const form = document.createElement("div");
  form.className = "about-edit-panel";

  form.appendChild(textField("Intro Paragraph", draft, "intro", true));

  form.appendChild(sectionLabel('Milestones — "PCSHS through the years"'));
  const milestonesContainer = document.createElement("div");
  renderObjectListEditor(
    milestonesContainer, draft.milestones,
    [
      { key: "year", label: "Year", type: "text" },
      { key: "tag", label: "Tag (e.g. Founded, Growth)", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    { year: "", tag: "", title: "", description: "" }
  );
  form.appendChild(milestonesContainer);

  form.appendChild(sectionLabel("Fast Facts"));
  const factsContainer = document.createElement("div");
  renderStringListEditor(factsContainer, draft.fastFacts, "e.g. Founded in 19XX");
  form.appendChild(factsContainer);

  form.appendChild(sectionLabel("Former Principals"));
  const principalsContainer = document.createElement("div");
  renderObjectListEditor(
    principalsContainer, draft.principals,
    [
      { key: "name", label: "Name", type: "text" },
      { key: "years", label: "Years Served", type: "text" },
    ],
    { name: "", years: "" }
  );
  form.appendChild(principalsContainer);

  const { wrap } = buildEditActions({
    onCancel: renderHistoryView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await saveSection("history", draft);
        pageData.history = draft;
        renderHistoryView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  historyBody.innerHTML = "";
  historyBody.appendChild(form);
  setEditSlot("history-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// SYMBOLS
// ═══════════════════════════════════════════════════════════════════════

function renderSymbolsView() {
  symbolsBody.innerHTML = pageData.symbols.map((s) => `
    <div class="symbol-card">
      <div class="symbol-card-image${s.image ? "" : " symbol-card-image-empty"}">
        ${s.image ? `<img src="${s.image}" alt="${escapeHtml(s.title)}">` : `<span>${escapeHtml((s.title || "?").charAt(0))}</span>`}
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <p>${escapeHtml(s.description)}</p>
    </div>`).join("");
  setEditSlot("symbols-edit-slot", buildEditButton(renderSymbolsEdit));
}

function renderSymbolsEdit() {
  const draft = deepClone(pageData.symbols);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  const container = document.createElement("div");
  renderObjectListEditor(
    container, draft,
    [
      { key: "image", label: "Photo", type: "image" },
      { key: "title", label: "Symbol Name", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    { title: "", description: "", image: "" }
  );
  form.appendChild(container);

  const { wrap } = buildEditActions({
    onCancel: renderSymbolsView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        for (const entry of draft) await resolveImage(entry);
        await saveSection("symbols", draft);
        pageData.symbols = draft;
        renderSymbolsView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  symbolsBody.innerHTML = "";
  symbolsBody.appendChild(form);
  setEditSlot("symbols-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// AWARDS & RECOGNITIONS
// ═══════════════════════════════════════════════════════════════════════

function renderAwardsView() {
  awardsBody.innerHTML = pageData.awards.map((a) => `
    <div class="award-item">
      <span class="award-year-badge">${escapeHtml(a.year)}</span>
      <div class="award-item-body">
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(a.description)}</p>
      </div>
    </div>`).join("");
  setEditSlot("awards-edit-slot", buildEditButton(renderAwardsEdit));
}

function renderAwardsEdit() {
  const draft = deepClone(pageData.awards);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  const container = document.createElement("div");
  renderObjectListEditor(
    container, draft,
    [
      { key: "year", label: "Year", type: "text" },
      { key: "title", label: "Award Title", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    { title: "", year: "", description: "" }
  );
  form.appendChild(container);

  const { wrap } = buildEditActions({
    onCancel: renderAwardsView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await saveSection("awards", draft);
        pageData.awards = draft;
        renderAwardsView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  awardsBody.innerHTML = "";
  awardsBody.appendChild(form);
  setEditSlot("awards-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// ORGANIZATIONAL CHART
// ═══════════════════════════════════════════════════════════════════════

function renderOrgChartView() {
  orgChartBody.innerHTML = pageData.orgChart.map((m) => `
    <div class="org-card">
      <div class="org-card-photo${m.image ? "" : " org-card-photo-empty"}">
        ${m.image ? `<img src="${m.image}" alt="${escapeHtml(m.name)}">` : `<span>${escapeHtml((m.name || "?").charAt(0))}</span>`}
      </div>
      <h3>${escapeHtml(m.name)}</h3>
      <p>${escapeHtml(m.position)}</p>
    </div>`).join("");
  setEditSlot("orgchart-edit-slot", buildEditButton(renderOrgChartEdit));
}

function renderOrgChartEdit() {
  const draft = deepClone(pageData.orgChart);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  const container = document.createElement("div");
  renderObjectListEditor(
    container, draft,
    [
      { key: "image", label: "Photo", type: "image" },
      { key: "name", label: "Name", type: "text" },
      { key: "position", label: "Position", type: "text" },
    ],
    { name: "", position: "", image: "" }
  );
  form.appendChild(container);

  const { wrap } = buildEditActions({
    onCancel: renderOrgChartView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        for (const entry of draft) await resolveImage(entry);
        await saveSection("orgChart", draft);
        pageData.orgChart = draft;
        renderOrgChartView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  orgChartBody.innerHTML = "";
  orgChartBody.appendChild(form);
  setEditSlot("orgchart-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// COURSES & STRANDS
// ═══════════════════════════════════════════════════════════════════════

function renderCoursesView() {
  const c = pageData.courses;
  const electivesHtml = c.electives.map((e) => `<span class="chip">${escapeHtml(e)}</span>`).join("");
  coursesBody.innerHTML = `
    <div class="course-blocks">
      <div class="course-block">
        <span class="course-block-label">Junior High School</span>
        <p>${escapeHtml(c.jhs)}</p>
      </div>
      <div class="course-block">
        <span class="course-block-label">Senior High School — STEM</span>
        <p>${escapeHtml(c.shsStrand)}</p>
      </div>
    </div>
    <h3 class="history-subheading">Elective Subjects</h3>
    <div class="chip-list">${electivesHtml}</div>`;
  setEditSlot("courses-edit-slot", buildEditButton(renderCoursesEdit));
}

function renderCoursesEdit() {
  const draft = deepClone(pageData.courses);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  form.appendChild(textField("Junior High School Description", draft, "jhs", true));
  form.appendChild(textField("Senior High School — STEM Description", draft, "shsStrand", true));
  form.appendChild(sectionLabel("Elective Subjects"));
  const electivesContainer = document.createElement("div");
  renderStringListEditor(electivesContainer, draft.electives, "e.g. Robotics");
  form.appendChild(electivesContainer);

  const { wrap } = buildEditActions({
    onCancel: renderCoursesView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await saveSection("courses", draft);
        pageData.courses = draft;
        renderCoursesView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  coursesBody.innerHTML = "";
  coursesBody.appendChild(form);
  setEditSlot("courses-edit-slot", document.createDocumentFragment());
}

// ═══════════════════════════════════════════════════════════════════════
// ADMISSION PROCESS
// ═══════════════════════════════════════════════════════════════════════

function renderAdmissionView() {
  const a = pageData.admission;
  const reqHtml = a.requirements.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  const stepsHtml = a.steps.map((s, i) => `
    <div class="process-step">
      <span class="process-step-number">${i + 1}</span>
      <h4>${escapeHtml(s.title)}</h4>
      <p>${escapeHtml(s.description)}</p>
    </div>`).join("");

  admissionBody.innerHTML = `
    <p class="about-intro-text">${escapeHtml(a.qualifications)}</p>
    <h3 class="history-subheading">Document Requirements</h3>
    <ul class="checklist">${reqHtml}</ul>
    <h3 class="history-subheading">Process</h3>
    <div class="process-steps">${stepsHtml}</div>`;

  setEditSlot("admission-edit-slot", buildEditButton(renderAdmissionEdit));
}

function renderAdmissionEdit() {
  const draft = deepClone(pageData.admission);
  const form = document.createElement("div");
  form.className = "about-edit-panel";
  form.appendChild(textField("Student Qualifications", draft, "qualifications", true));

  form.appendChild(sectionLabel("Document Requirements"));
  const reqContainer = document.createElement("div");
  renderStringListEditor(reqContainer, draft.requirements, "e.g. PSA Birth Certificate");
  form.appendChild(reqContainer);

  form.appendChild(sectionLabel("Process Steps (in order)"));
  const stepsContainer = document.createElement("div");
  renderObjectListEditor(
    stepsContainer, draft.steps,
    [
      { key: "title", label: "Step Title", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    { title: "", description: "" }
  );
  form.appendChild(stepsContainer);

  const { wrap } = buildEditActions({
    onCancel: renderAdmissionView,
    onSave: async (btn, statusEl) => {
      btn.disabled = true;
      statusEl.textContent = "Saving...";
      try {
        await saveSection("admission", draft);
        pageData.admission = draft;
        renderAdmissionView();
      } catch (err) {
        statusEl.textContent = "Something went wrong: " + err.message;
        btn.disabled = false;
      }
    },
  });
  form.appendChild(wrap);

  admissionBody.innerHTML = "";
  admissionBody.appendChild(form);
  setEditSlot("admission-edit-slot", document.createDocumentFragment());
}

loadData();