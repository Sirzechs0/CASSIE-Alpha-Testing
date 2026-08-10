// announcements.js
// Handles the Announcements page — a searchable timeline of school events
// and notices, each with an optional date/time/location/audience/tags on
// top of the original pubmat-image + caption format.
//  1. Showing the upload form only if the logged-in user is admin/staff.
//  2. Loading and displaying all announcements as a timeline, newest first.
//  3. A page-local search bar that filters by title/description/tags/
//     location/audience — works against any post, past or upcoming.
//  4. Posting a new announcement with the fields above (images optional).
//  5. Letting admin/staff edit or delete an existing announcement.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy,
  doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ⬇️ Paste your ImgBB API key between the quotes below.
const IMGBB_API_KEY = "d40920dd92b750f2a83459dcff350957";

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const uploadSection = document.getElementById("upload-section");
const uploadForm    = document.getElementById("upload-form");
const uploadStatus  = document.getElementById("upload-status");
const uploadButton  = document.getElementById("upload-button");
const feedContainer = document.getElementById("announcements-feed");
const feedCount     = document.getElementById("feed-count");
const searchInput   = document.getElementById("announcement-search");

const dropzone     = document.getElementById("upload-dropzone");
const dropzoneText = document.getElementById("upload-dropzone-text");
const fileInput    = document.getElementById("event-photos");
const previewGrid  = document.getElementById("upload-preview-grid");

const eventTitleInput       = document.getElementById("event-title");
const eventDateInput        = document.getElementById("event-date");
const eventTimeInput        = document.getElementById("event-time");
const eventLocationInput    = document.getElementById("event-location");
const eventAudienceInput    = document.getElementById("event-audience");
const eventTagsInput        = document.getElementById("event-tags");
const eventDescriptionInput = document.getElementById("event-description");

const editModal             = document.getElementById("edit-modal");
const editTitleInput        = document.getElementById("edit-title");
const editEventDateInput    = document.getElementById("edit-event-date");
const editEventTimeInput    = document.getElementById("edit-event-time");
const editLocationInput     = document.getElementById("edit-location");
const editAudienceInput     = document.getElementById("edit-audience");
const editTagsInput         = document.getElementById("edit-tags");
const editDescriptionInput  = document.getElementById("edit-description");
const editPreviewGrid       = document.getElementById("edit-preview-grid");
const editDropzone          = document.getElementById("edit-dropzone");
const editFileInput         = document.getElementById("edit-file-input");
const editStatus            = document.getElementById("edit-status");
const editSaveBtn           = document.getElementById("edit-save-btn");
const editCancelBtn         = document.getElementById("edit-cancel-btn");

const confirmModal     = document.getElementById("confirm-modal");
const confirmTitleEl   = document.getElementById("confirm-title");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmOkBtn     = document.getElementById("confirm-ok-btn");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");

const lightbox         = document.getElementById("lightbox");
const lightboxImg      = document.getElementById("lightbox-img");
const lightboxCounter  = document.getElementById("lightbox-counter");
const lightboxCloseBtn = document.getElementById("lightbox-close");
const lightboxPrevBtn  = document.getElementById("lightbox-prev");
const lightboxNextBtn  = document.getElementById("lightbox-next");

// A card's "Learn More" only appears when there's actually something extra
// to reveal — either the description is long enough that it's likely
// clipped at 3 lines, or there's more than one photo to show. This number
// is a rough estimate (real overflow depends on screen width), so it's
// intentionally set a bit low: showing the button when it isn't strictly
// needed is a much smaller problem than hiding one that would have done
// something.
const EXPAND_LENGTH_THRESHOLD = 200;

// ─── STATE ────────────────────────────────────────────────────────────────────
let isAdminOrStaff   = false;
let allAnnouncements = null;   // null = not loaded yet
let selectedFiles    = [];     // File[] queued on the create form
let editMediaEntries = [];     // { type: "existing", url } | { type: "new", file }
let editingId        = null;
let lightboxImages   = [];
let lightboxIndex    = 0;

// ---------- helpers ----------

// Older posts saved a single `imageUrl` string; new posts save an
// `imageUrls` array. This normalizes either shape into an array so the
// rest of the file only has to deal with one format. Either way, images
// are OPTIONAL now — an empty array is a normal, expected result.
function getImageUrls(data) {
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (data.imageUrl) return [data.imageUrl];
  return [];
}

function formatPostedDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "";
  const date    = timestamp.toDate();
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1)  return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// The prominent date badge above each card's title: the event's own date
// if one was set, otherwise the date this was posted — so every card
// always shows SOME date, even a plain text notice with no event details.
function formatEventDateBadge(data) {
  let dateObj = null;
  if (data.eventDate) {
    const [y, m, d] = data.eventDate.split("-").map(Number);
    if (y && m && d) dateObj = new Date(y, m - 1, d);
  }
  if (!dateObj && data.timestamp && typeof data.timestamp.toDate === "function") {
    dateObj = data.timestamp.toDate();
  }
  if (!dateObj) return "";
  return dateObj.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

// True only when a real eventDate was set AND it's before today — a plain
// notice with no event date is never treated as "past."
function isPastEvent(data) {
  if (!data.eventDate) return false;
  const [y, m, d] = data.eventDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  const eventDay = new Date(y, m - 1, d);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return eventDay < todayStart;
}

function parseTags(raw) {
  return (raw || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// Builds one removable thumbnail. `source` is a File (read via FileReader)
// or a string URL (an image already hosted on ImgBB). Used by both the
// create form's preview grid and the edit modal's preview grid.
function buildThumb(source, onRemove) {
  const thumb = document.createElement("div");
  thumb.className = "upload-thumb";

  const img = document.createElement("img");
  img.alt = "";
  thumb.appendChild(img);

  if (typeof source === "string") {
    img.src = source;
  } else {
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.readAsDataURL(source);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "upload-thumb-remove";
  removeBtn.setAttribute("aria-label", "Remove photo");
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
  thumb.appendChild(removeBtn);

  return thumb;
}

function metaDot() {
  const dot = document.createElement("span");
  dot.className = "meta-dot";
  dot.textContent = "·";
  return dot;
}

// ---------- Facebook-style upload zone: click, drag-drop, multi-preview ----------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) addSelectedFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) addSelectedFiles(fileInput.files);
  fileInput.value = ""; // so picking the same file again still fires "change"
});

function addSelectedFiles(fileList) {
  const images = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  selectedFiles.push(...images);
  renderSelectedPreviews();
}

function renderSelectedPreviews() {
  if (selectedFiles.length === 0) {
    dropzoneText.textContent = "📷 Click to choose photos, or drag them here — skip this if it's a text-only notice";
    previewGrid.hidden = true;
    previewGrid.innerHTML = "";
    return;
  }
  dropzoneText.textContent =
    `${selectedFiles.length} photo${selectedFiles.length > 1 ? "s" : ""} selected — click to add more`;
  previewGrid.hidden = false;
  previewGrid.innerHTML = "";
  selectedFiles.forEach((file, i) => {
    previewGrid.appendChild(buildThumb(file, () => {
      selectedFiles.splice(i, 1);
      renderSelectedPreviews();
    }));
  });
}

// ---------- Part 1: show/hide the upload form + admin controls based on login + role ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    uploadSection.hidden = true;
    isAdminOrStaff = false;
    renderFeed();
    return;
  }
  try {
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    const role = userDocSnap.exists() ? userDocSnap.data().role : null;
    isAdminOrStaff = role === "admin" || role === "staff";
  } catch {
    isAdminOrStaff = false;
  }
  uploadSection.hidden = !isAdminOrStaff;
  renderFeed();
});

// ---------- Part 2: load + render the timeline ----------
async function loadAnnouncements() {
  try {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"));
    const snapshot = await getDocs(q);
    allAnnouncements = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFeed();
  } catch (error) {
    feedContainer.innerHTML = "<p class='muted'>Couldn't load announcements right now.</p>";
  }
}

function matchesSearch(data, term) {
  const haystack = [
    data.title, data.caption, data.location, data.audience,
    ...(Array.isArray(data.tags) ? data.tags : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(term);
}

function updateFeedCount(filteredCount, totalCount) {
  if (totalCount === 0) { feedCount.textContent = ""; return; }
  feedCount.textContent = filteredCount === totalCount
    ? `${totalCount} announcement${totalCount > 1 ? "s" : ""}`
    : `${filteredCount} of ${totalCount} announcement${totalCount > 1 ? "s" : ""}`;
}

function renderFeed() {
  if (allAnnouncements === null) return; // still loading
  feedContainer.removeAttribute("aria-busy");

  if (allAnnouncements.length === 0) {
    feedCount.textContent = "";
    feedContainer.innerHTML = "<p class='muted'>No announcements yet.</p>";
    return;
  }

  const term = searchInput.value.trim().toLowerCase();
  const filtered = term ? allAnnouncements.filter((a) => matchesSearch(a, term)) : allAnnouncements;
  updateFeedCount(filtered.length, allAnnouncements.length);

  if (filtered.length === 0) {
    feedContainer.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "muted";
    msg.textContent = `No announcements match "${searchInput.value.trim()}". Try a different word, or clear the search to see everything.`;
    feedContainer.appendChild(msg);
    return;
  }

  feedContainer.innerHTML = "";
  filtered.forEach((data) => feedContainer.appendChild(buildEventCard(data)));
}

searchInput.addEventListener("input", renderFeed);

// ---------- Building one timeline entry ----------
function buildEventCard(data) {
  const images = getImageUrls(data);
  const hasRealTitle = !!(data.title && data.title.trim());
  // A post with no real title (only possible on data saved before this
  // update) falls back to using its caption AS the title, so the timeline
  // never shows a blank heading — but then the description below is left
  // empty rather than repeating that same text a second time.
  const displayTitle = hasRealTitle ? data.title.trim() : ((data.caption || "").trim() || "Announcement");
  const displayDescription = hasRealTitle ? (data.caption || "").trim() : "";

  const item = document.createElement("div");
  item.className = "event-item";

  const marker = document.createElement("div");
  marker.className = "event-marker";
  const dot = document.createElement("span");
  dot.className = "event-dot";
  marker.appendChild(dot);
  item.appendChild(marker);

  const content = document.createElement("div");
  content.className = "event-content";

  const dateText = formatEventDateBadge(data);
  const past = isPastEvent(data);
  if (dateText || past) {
    const badge = document.createElement("div");
    badge.className = "event-date-badge";
    if (dateText) {
      const span = document.createElement("span");
      span.textContent = `📅 ${dateText}`;
      badge.appendChild(span);
    }
    if (past) {
      const pastTag = document.createElement("span");
      pastTag.className = "event-past-tag";
      pastTag.textContent = "Past";
      badge.appendChild(pastTag);
    }
    content.appendChild(badge);
  }

  const titleEl = document.createElement("h2");
  titleEl.className = "event-title";
  titleEl.textContent = displayTitle;
  content.appendChild(titleEl);

  const card = document.createElement("div");
  card.className = "event-card";

  const mediaBox = document.createElement("div");
  mediaBox.className = "event-card-media";
  renderEventMedia(mediaBox, images, data, false);
  card.appendChild(mediaBox);

  const body = document.createElement("div");
  body.className = "event-card-body";

  if (Array.isArray(data.tags) && data.tags.length) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "event-tags";
    data.tags.forEach((t) => {
      const tag = document.createElement("span");
      tag.className = "event-tag";
      tag.textContent = t;
      tag.title = `Search "${t}"`;
      tag.addEventListener("click", () => {
        searchInput.value = t;
        renderFeed();
        searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      tagsEl.appendChild(tag);
    });
    body.appendChild(tagsEl);
  }

  if (displayDescription) {
    const descEl = document.createElement("p");
    descEl.className = "event-description";
    descEl.textContent = displayDescription;
    body.appendChild(descEl);
  }

  const metaEl = buildMetaRows(data);
  if (metaEl) body.appendChild(metaEl);

  const actions = document.createElement("div");
  actions.className = "event-actions";

  const canExpand = displayDescription.length > EXPAND_LENGTH_THRESHOLD || images.length > 1;
  let expandBtn = null;
  if (canExpand) {
    expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "btn-secondary event-expand-btn";
    expandBtn.textContent = "Learn More ↓";
    expandBtn.setAttribute("aria-expanded", "false");
    actions.appendChild(expandBtn);
  }

  if (isAdminOrStaff) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "announcement-action-btn";
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("click", () => openEditModal(data));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "announcement-action-btn danger";
    deleteBtn.textContent = "🗑 Delete";
    deleteBtn.addEventListener("click", () => confirmDeleteAnnouncement(data));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }

  if (actions.children.length) body.appendChild(actions);

  // Small byline at the bottom — who posted it, when, and whether it's
  // been edited since. Kept separate from the event's OWN date/time/
  // location meta above so the two don't get visually confused.
  const postedMeta = document.createElement("div");
  postedMeta.className = "event-posted-meta";
  const author = document.createElement("span");
  author.textContent = data.postedBy || "PCSHS SMS";
  postedMeta.appendChild(author);
  const postedText = formatPostedDate(data.timestamp);
  if (postedText) {
    postedMeta.appendChild(metaDot());
    const s = document.createElement("span");
    s.textContent = `Posted ${postedText}`;
    postedMeta.appendChild(s);
  }
  if (data.updatedAt) {
    postedMeta.appendChild(metaDot());
    const s = document.createElement("span");
    s.className = "announcement-edited";
    s.textContent = "edited";
    postedMeta.appendChild(s);
  }
  body.appendChild(postedMeta);

  card.appendChild(body);
  content.appendChild(card);
  item.appendChild(content);

  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      const isExpanded = card.classList.toggle("expanded");
      expandBtn.setAttribute("aria-expanded", String(isExpanded));
      expandBtn.textContent = isExpanded ? "Show Less ↑" : "Learn More ↓";
      renderEventMedia(mediaBox, images, data, isExpanded);
    });
  }

  return item;
}

// Location / time / audience rows with a small icon each — only the rows
// that actually have data are shown, so a plain-text notice with none of
// this doesn't leave empty space.
function buildMetaRows(data) {
  const rows = [];
  if (data.location)  rows.push({ icon: "📍", text: data.location });
  if (data.eventTime) rows.push({ icon: "🕐", text: data.eventTime });
  if (data.audience)  rows.push({ icon: "👥", text: data.audience });
  if (!rows.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "event-meta";
  rows.forEach(({ icon, text }) => {
    const row = document.createElement("span");
    row.className = "event-meta-row";
    row.textContent = `${icon}  ${text}`;
    wrap.appendChild(row);
  });
  return wrap;
}

// Fills in the card's image area: a placeholder box when there are no
// images, a single cover photo (click → lightbox with the full set) while
// collapsed or when there's only one photo, or the full collage grid once
// expanded with more than one photo.
function renderEventMedia(mediaBox, images, data, expanded) {
  mediaBox.innerHTML = "";
  mediaBox.classList.toggle("has-multi", images.length > 1);

  if (images.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "event-media-placeholder";
    const icon = document.createElement("span");
    icon.className = "event-media-placeholder-icon";
    icon.textContent = "📌";
    const label = document.createElement("span");
    label.className = "event-media-placeholder-label";
    label.textContent = (Array.isArray(data.tags) && data.tags[0]) || "Announcement";
    placeholder.appendChild(icon);
    placeholder.appendChild(label);
    mediaBox.appendChild(placeholder);
    return;
  }

  if (expanded && images.length > 1) {
    mediaBox.appendChild(buildMediaGrid(images, data.title));
    return;
  }

  const img = document.createElement("img");
  img.src = images[0];
  img.loading = "lazy";
  img.alt = data.title ? `${data.title} — cover photo` : "Announcement photo";
  img.className = "event-cover-img";
  img.addEventListener("click", () => openLightbox(images, 0));
  mediaBox.appendChild(img);

  if (images.length > 1) {
    const overlay = document.createElement("span");
    overlay.className = "event-cover-count";
    overlay.textContent = `+${images.length - 1}`;
    overlay.addEventListener("click", () => openLightbox(images, 0));
    mediaBox.appendChild(overlay);
  }
}

// Renders up to 4 image tiles in a collage layout; a "+N" overlay appears
// on the last tile if the post has more than 4 images. Clicking any tile
// opens the lightbox with the FULL image list (not just the 4 shown), so
// nothing is ever hidden — just previewed more compactly. Only reached
// once a card is expanded with more than one photo (see renderEventMedia).
function buildMediaGrid(images, title) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;

  const grid = document.createElement("div");
  grid.className = "announcement-media";
  grid.dataset.count = String(shown.length);

  shown.forEach((url, i) => {
    const item = document.createElement("div");
    item.className = "media-item";

    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.alt = title ? `${title} — photo ${i + 1}` : `Announcement photo ${i + 1}`;
    item.appendChild(img);

    if (extra > 0 && i === shown.length - 1) {
      const overlay = document.createElement("div");
      overlay.className = "media-overlay-count";
      overlay.textContent = `+${extra}`;
      item.appendChild(overlay);
    }

    item.addEventListener("click", () => openLightbox(images, i));
    grid.appendChild(item);
  });

  return grid;
}

loadAnnouncements();

// ---------- Part 3: handle posting a new announcement ----------
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  uploadButton.disabled = true;
  uploadStatus.textContent = "";

  try {
    let imageUrls = [];
    if (selectedFiles.length > 0) {
      imageUrls = await uploadFilesWithProgress(selectedFiles);
    }

    uploadStatus.textContent = "Saving announcement...";

    await addDoc(collection(db, "announcements"), {
      title: eventTitleInput.value.trim(),
      caption: eventDescriptionInput.value.trim(),
      tags: parseTags(eventTagsInput.value),
      eventDate: eventDateInput.value || "",
      eventTime: eventTimeInput.value.trim(),
      location: eventLocationInput.value.trim(),
      audience: eventAudienceInput.value.trim(),
      imageUrls,
      postedBy: auth.currentUser.email,
      timestamp: serverTimestamp()
    });

    uploadStatus.textContent = "Announcement posted successfully.";
    uploadForm.reset();
    selectedFiles = [];
    renderSelectedPreviews();
    // Clear any active search so the freshly-posted announcement is
    // actually visible right away, instead of possibly being filtered out
    // by leftover search text from browsing.
    searchInput.value = "";
    loadAnnouncements();
  } catch (error) {
    uploadStatus.textContent = "Something went wrong: " + error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

// Uploads every queued file in parallel and keeps the status line updated
// with a live "x of y" count as each one finishes.
async function uploadFilesWithProgress(files) {
  let done = 0;
  uploadStatus.textContent = `Uploading images (0/${files.length})...`;
  const uploads = files.map((file) =>
    uploadToImgBB(file).then((url) => {
      done++;
      uploadStatus.textContent = `Uploading images (${done}/${files.length})...`;
      return url;
    })
  );
  return Promise.all(uploads);
}

// ---------- Helper: upload a file to ImgBB and get back a public URL ----------
async function uploadToImgBB(file) {
  const base64 = await fileToBase64(file);

  const formData = new FormData();
  formData.append("image", base64);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error("Image upload failed. Check your ImgBB API key.");
  }

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

// ---------- Part 4: edit an announcement (buttons only render for admin/staff, see buildEventCard) ----------
function openEditModal(data) {
  editingId = data.id;
  editTitleInput.value       = data.title || "";
  editEventDateInput.value   = data.eventDate || "";
  editEventTimeInput.value   = data.eventTime || "";
  editLocationInput.value    = data.location || "";
  editAudienceInput.value    = data.audience || "";
  editTagsInput.value        = Array.isArray(data.tags) ? data.tags.join(", ") : "";
  editDescriptionInput.value = data.caption || "";
  editMediaEntries = getImageUrls(data).map((url) => ({ type: "existing", url }));
  renderEditPreviews();
  editStatus.textContent = "";
  editSaveBtn.disabled = false;
  editModal.hidden = false;
}

function closeEditModal() {
  editModal.hidden = true;
  editingId = null;
  editMediaEntries = [];
  editFileInput.value = "";
}

editDropzone.addEventListener("click", () => editFileInput.click());
editDropzone.addEventListener("dragover", (e) => { e.preventDefault(); editDropzone.classList.add("dragover"); });
editDropzone.addEventListener("dragleave", () => editDropzone.classList.remove("dragover"));
editDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  editDropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) addEditFiles(e.dataTransfer.files);
});
editFileInput.addEventListener("change", () => {
  if (editFileInput.files.length) addEditFiles(editFileInput.files);
  editFileInput.value = "";
});

function addEditFiles(fileList) {
  const images = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  images.forEach((file) => editMediaEntries.push({ type: "new", file }));
  renderEditPreviews();
}

function renderEditPreviews() {
  editPreviewGrid.innerHTML = "";
  editMediaEntries.forEach((entry, i) => {
    const source = entry.type === "existing" ? entry.url : entry.file;
    editPreviewGrid.appendChild(buildThumb(source, () => {
      editMediaEntries.splice(i, 1);
      renderEditPreviews();
    }));
  });
}

editCancelBtn.addEventListener("click", closeEditModal);
editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });

editSaveBtn.addEventListener("click", async () => {
  // The edit modal isn't wrapped in a <form>, so there's no native
  // "required" validation the way the create form gets it — checked here
  // instead, same effect: title can't be saved blank.
  if (!editTitleInput.value.trim()) {
    editStatus.textContent = "Title can't be empty.";
    return;
  }

  editSaveBtn.disabled = true;
  try {
    const finalUrls  = [];
    const newEntries = editMediaEntries.filter((e) => e.type === "new");
    let uploaded = 0;

    // Sequential on purpose: existing URLs pass straight through in order,
    // new files upload one at a time so the status line can name a count.
    for (const entry of editMediaEntries) {
      if (entry.type === "existing") {
        finalUrls.push(entry.url);
      } else {
        editStatus.textContent = `Uploading new photo (${uploaded + 1}/${newEntries.length})...`;
        finalUrls.push(await uploadToImgBB(entry.file));
        uploaded++;
      }
    }

    editStatus.textContent = "Saving changes...";
    await updateDoc(doc(db, "announcements", editingId), {
      title: editTitleInput.value.trim(),
      caption: editDescriptionInput.value.trim(),
      tags: parseTags(editTagsInput.value),
      eventDate: editEventDateInput.value || "",
      eventTime: editEventTimeInput.value.trim(),
      location: editLocationInput.value.trim(),
      audience: editAudienceInput.value.trim(),
      imageUrls: finalUrls,
      updatedAt: serverTimestamp()
    });

    closeEditModal();
    loadAnnouncements();
  } catch (err) {
    editStatus.textContent = "Something went wrong: " + err.message;
  } finally {
    editSaveBtn.disabled = false;
  }
});

// ---------- Part 5: delete an announcement ----------
function confirmDeleteAnnouncement(data) {
  askConfirm({
    title: "Delete this announcement?",
    message: data.title
      ? `Delete "${data.title}"? This can't be undone.`
      : "Delete this announcement? This can't be undone.",
    confirmLabel: "Delete",
  }).then((confirmed) => {
    if (confirmed) deleteAnnouncement(data.id);
  });
}

async function deleteAnnouncement(id) {
  try {
    await deleteDoc(doc(db, "announcements", id));
    loadAnnouncements();
  } catch (err) {
    window.alert("Delete failed: " + err.message);
  }
}

// Themed replacement for window.confirm — resolves true/false depending on
// the button clicked, same calling convention as the one on the Attendance page.
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

// ---------- Part 6: lightbox for viewing full-size images ----------
function openLightbox(images, startIndex) {
  lightboxImages = images;
  lightboxIndex  = startIndex;
  renderLightbox();
  lightbox.hidden = false;
  document.addEventListener("keydown", onLightboxKeydown);
}

function closeLightbox() {
  lightbox.hidden = true;
  document.removeEventListener("keydown", onLightboxKeydown);
}

function renderLightbox() {
  lightboxImg.src = lightboxImages[lightboxIndex];
  lightboxImg.alt = `Announcement photo ${lightboxIndex + 1}`;

  const showNav = lightboxImages.length > 1;
  lightboxCounter.hidden = !showNav;
  lightboxPrevBtn.hidden = !showNav;
  lightboxNextBtn.hidden = !showNav;
  if (showNav) lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
}

function showNextImage() { lightboxIndex = (lightboxIndex + 1) % lightboxImages.length; renderLightbox(); }
function showPrevImage() { lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; renderLightbox(); }

function onLightboxKeydown(e) {
  if (e.key === "Escape")          closeLightbox();
  else if (e.key === "ArrowRight") showNextImage();
  else if (e.key === "ArrowLeft")  showPrevImage();
}

lightboxCloseBtn.addEventListener("click", closeLightbox);
lightboxNextBtn.addEventListener("click", showNextImage);
lightboxPrevBtn.addEventListener("click", showPrevImage);
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });