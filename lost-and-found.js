// lost-and-found.js
// Handles four things on the Lost & Found page:
//  1. Showing the upload form only if the logged-in user is admin/staff.
//  2. Loading and displaying all reports for everyone to see.
//  3. Posting a new report with optional images.
//  4. Letting admin/staff edit or delete an existing report.

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
const feedContainer = document.getElementById("lost-found-feed");
const feedCount     = document.getElementById("feed-count");

const dropzone     = document.getElementById("upload-dropzone");
const dropzoneText = document.getElementById("upload-dropzone-text");
const fileInput    = document.getElementById("item-photos");
const previewGrid  = document.getElementById("upload-preview-grid");

const editModal        = document.getElementById("edit-modal");
const editTypeInput    = document.getElementById("edit-type");
const editTitleInput   = document.getElementById("edit-title");
const editDescInput    = document.getElementById("edit-description");
const editLocationInput= document.getElementById("edit-location");
const editDateInput    = document.getElementById("edit-date");
const editContactInput = document.getElementById("edit-contact");
const editPreviewGrid  = document.getElementById("edit-preview-grid");
const editDropzone     = document.getElementById("edit-dropzone");
const editFileInput    = document.getElementById("edit-file-input");
const editStatus       = document.getElementById("edit-status");
const editSaveBtn      = document.getElementById("edit-save-btn");
const editCancelBtn    = document.getElementById("edit-cancel-btn");

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

// ─── STATE ────────────────────────────────────────────────────────────────────
let isAdminOrStaff   = false;
let allReports       = null;   // null = not loaded yet
let selectedFiles    = [];     // File[] queued on the create form
let editMediaEntries = [];     // { type: "existing", url } | { type: "new", file }
let editingId        = null;
let lightboxImages   = [];
let lightboxIndex    = 0;

// ---------- helpers ----------

// Normalize either legacy single `imageUrl` or new `imageUrls` array into an array
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

function formatItemDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Builds one removable thumbnail. `source` is a File (read via FileReader)
// or a string URL (an image already hosted on ImgBB).
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

// Get type badge HTML
function getTypeBadge(type) {
  const badge = document.createElement("span");
  badge.className = `status-badge ${type === "lost" ? "late" : "present"}`;
  badge.textContent = type === "lost" ? "Lost" : "Found";
  return badge;
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
    dropzoneText.textContent = "📷 Click to choose photos, or drag them here — you can add more than one";
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

// ---------- Part 2: load + render the public feed ----------
async function loadReports() {
  try {
    const q = query(collection(db, "lostAndFound"), orderBy("timestamp", "desc"));
    const snapshot = await getDocs(q);
    allReports = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFeed();
  } catch (error) {
    feedContainer.innerHTML = "<p class='muted'>Couldn't load reports right now.</p>";
  }
}

function renderFeed() {
  if (allReports === null) return; // still loading
  feedContainer.removeAttribute("aria-busy");

  feedCount.textContent = allReports.length
    ? `${allReports.length} report${allReports.length > 1 ? "s" : ""}`
    : "";

  if (allReports.length === 0) {
    feedContainer.innerHTML = "<p class='muted'>No reports yet. Be the first to post one!</p>";
    return;
  }

  feedContainer.innerHTML = "";
  allReports.forEach((data) => feedContainer.appendChild(buildReportCard(data)));
}

function buildReportCard(data) {
  const images = getImageUrls(data);

  const card = document.createElement("div");
  card.className = "announcement-card";

  // Type badge at top
  const badge = getTypeBadge(data.type);
  badge.style.margin = "12px 16px 0";
  badge.style.alignSelf = "flex-start";
  card.appendChild(badge);

  if (images.length > 0) card.appendChild(buildMediaGrid(images, data.title));

  const body = document.createElement("div");
  body.className = "announcement-body";

  // Title
  if (data.title) {
    const title = document.createElement("p");
    title.className = "announcement-caption";
    title.style.fontWeight = "600";
    title.style.fontSize = "0.95rem";
    title.textContent = data.title;
    body.appendChild(title);
  }

  // Description
  if (data.description) {
    const desc = document.createElement("p");
    desc.className = "announcement-caption";
    desc.textContent = data.description;
    body.appendChild(desc);
  }

  // Meta info: location, date, contact
  const meta = document.createElement("div");
  meta.className = "announcement-meta";
  meta.style.marginTop = "10px";

  if (data.location) {
    const loc = document.createElement("span");
    loc.textContent = `📍 ${data.location}`;
    meta.appendChild(loc);
    meta.appendChild(metaDot());
  }

  if (data.date) {
    const dateSpan = document.createElement("span");
    dateSpan.textContent = `📅 ${formatItemDate(data.date)}`;
    meta.appendChild(dateSpan);
    meta.appendChild(metaDot());
  }

  if (data.contact) {
    const contactSpan = document.createElement("span");
    contactSpan.textContent = `📞 ${data.contact}`;
    meta.appendChild(contactSpan);
    meta.appendChild(metaDot());
  }

  const author = document.createElement("span");
  author.textContent = data.postedBy || "PCSHS SMS";
  meta.appendChild(author);

  const dateText = formatPostedDate(data.timestamp);
  if (dateText) {
    meta.appendChild(metaDot());
    const dateSpan = document.createElement("span");
    dateSpan.textContent = dateText;
    meta.appendChild(dateSpan);
  }

  if (data.updatedAt) {
    meta.appendChild(metaDot());
    const editedSpan = document.createElement("span");
    editedSpan.className = "announcement-edited";
    editedSpan.textContent = "edited";
    meta.appendChild(editedSpan);
  }

  body.appendChild(meta);

  if (isAdminOrStaff) {
    const actions = document.createElement("div");
    actions.className = "announcement-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "announcement-action-btn";
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("click", () => openEditModal(data));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "announcement-action-btn danger";
    deleteBtn.textContent = "🗑 Delete";
    deleteBtn.addEventListener("click", () => confirmDeleteReport(data));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    body.appendChild(actions);
  }

  card.appendChild(body);
  return card;
}

// Renders up to 4 image tiles in a collage layout
function buildMediaGrid(images, caption) {
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
    img.alt = caption ? `${caption} — photo ${i + 1}` : `Report photo ${i + 1}`;
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

loadReports();

// ---------- Part 3: handle posting a new report ----------
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const typeInput       = document.getElementById("item-type");
  const titleInput      = document.getElementById("item-title");
  const descInput       = document.getElementById("item-description");
  const locationInput   = document.getElementById("item-location");
  const dateInput       = document.getElementById("item-date");
  const contactInput    = document.getElementById("item-contact");

  if (selectedFiles.length === 0) {
    uploadStatus.textContent = "Please choose at least one image first.";
    return;
  }

  uploadButton.disabled = true;

  try {
    const imageUrls = await uploadFilesWithProgress(selectedFiles);

    uploadStatus.textContent = "Saving report...";

    await addDoc(collection(db, "lostAndFound"), {
      type: typeInput.value,
      title: titleInput.value.trim(),
      description: descInput.value.trim(),
      location: locationInput.value.trim(),
      date: dateInput.value,
      contact: contactInput.value.trim(),
      imageUrls,
      postedBy: auth.currentUser.email,
      timestamp: serverTimestamp()
    });

    uploadStatus.textContent = "Report posted successfully.";
    uploadForm.reset();
    selectedFiles = [];
    renderSelectedPreviews();
    loadReports();
  } catch (error) {
    uploadStatus.textContent = "Something went wrong: " + error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

// Uploads every queued file in parallel and keeps the status line updated
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

// ---------- Part 4: edit a report ----------
function openEditModal(data) {
  editingId = data.id;
  editTypeInput.value = data.type || "lost";
  editTitleInput.value = data.title || "";
  editDescInput.value = data.description || "";
  editLocationInput.value = data.location || "";
  editDateInput.value = data.date || "";
  editContactInput.value = data.contact || "";
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
  if (editMediaEntries.length === 0) {
    editStatus.textContent = "A report needs at least one image.";
    return;
  }

  editSaveBtn.disabled = true;
  try {
    const finalUrls  = [];
    const newEntries = editMediaEntries.filter((e) => e.type === "new");
    let uploaded = 0;

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
    await updateDoc(doc(db, "lostAndFound", editingId), {
      type: editTypeInput.value,
      title: editTitleInput.value.trim(),
      description: editDescInput.value.trim(),
      location: editLocationInput.value.trim(),
      date: editDateInput.value,
      contact: editContactInput.value.trim(),
      imageUrls: finalUrls,
      updatedAt: serverTimestamp()
    });

    closeEditModal();
    loadReports();
  } catch (err) {
    editStatus.textContent = "Something went wrong: " + err.message;
  } finally {
    editSaveBtn.disabled = false;
  }
});

// ---------- Part 5: delete a report ----------
function confirmDeleteReport(data) {
  askConfirm({
    title: "Delete this report?",
    message: data.title
      ? `Delete "${data.title}"? This can't be undone.`
      : "Delete this report? This can't be undone.",
    confirmLabel: "Delete",
  }).then((confirmed) => {
    if (confirmed) deleteReport(data.id);
  });
}

async function deleteReport(id) {
  try {
    await deleteDoc(doc(db, "lostAndFound", id));
    loadReports();
  } catch (err) {
    window.alert("Delete failed: " + err.message);
  }
}

// Themed replacement for window.confirm
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
  lightboxImg.alt = `Report photo ${lightboxIndex + 1}`;

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