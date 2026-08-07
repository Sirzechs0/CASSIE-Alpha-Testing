# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**C.A.S.S.I.E.** (Centralized Academic and School Services Information Engine) — a Firebase-backed web application for **Pasig City Science High School (PCSHS)**. It's a multi-page school management system with modules for attendance, announcements, lost & found, reports/analytics, calendar & history, FAQs, clubs, and staff directory.

## Architecture

**Tech Stack:**
- Pure vanilla JavaScript (ES modules), HTML, CSS — no build step, no bundler
- Firebase Auth + Firestore (via CDN: `firebasejs/12.15.0`)
- ImgBB API for image hosting (API key in `announcements.js` and `lost-and-found.js`)
- pdf.js (CDN) for PDF text extraction in attendance import

**Project Structure:**
```
├── index.html                 # Dashboard (landing page)
├── attendance.html/js         # Attendance marking + PDF class list import
├── reports.html/js            # Attendance analytics, calendars, leaderboards
├── announcements.html/js      # Image-based announcements with CRUD
├── lost-and-found.html/js     # Lost/Found reports with CRUD
├── calendar-history.html      # School events + historical timeline
├── faqs.html/js               # FAQ accordion
├── clubs.html                 # Student organizations
├── staff-directory.html       # Personnel listing
├── login.html/js              # Firebase Auth login page
├── firebase-config.js         # Single Firebase init (exports auth, db)
├── auth-ui.js                 # Shared login/logout header state
├── nav.js                     # Mobile hamburger menu toggle
├── theme.js                   # Dark/light toggle (localStorage)
├── style.css                  # Complete design system (58KB)
├── firestore.rules            # Security rules for all collections
└── logo.png                   # School logo
```

## Key Concepts

### Firestore Collections
| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `sections` | Class sections (grade, name, adviser, room, maleCount, femaleCount) | `grade`, `name`, `adviser`, `room`, `maleCount`, `femaleCount` |
| `sections/{sectionId}/students` | Student roster per section | `no`, `name`, `gender` (M/F) |
| `attendance` | Daily attendance records, keyed `{sectionId}_{YYYY-MM-DD}` | `sectionId`, `date`, `records` (map of studentId → {status, timeIn}) |
| `announcements` | Image posts with captions | `imageUrls[]`, `caption`, `postedBy`, `timestamp` |
| `lostAndFound` | Lost/found item reports | `type` (lost/found), `title`, `description`, `location`, `date`, `contact`, `imageUrls[]` |
| `users` | Staff accounts with roles | `role` (admin/staff/secretary), `assignedSections[]` (for secretaries) |

### Roles & Permissions
- **Admin/Staff**: Full CRUD on all modules, can import PDFs, delete sections
- **Secretary**: Can mark attendance only for assigned sections (set in user doc)
- **Public**: Read-only access to announcements, lost & found, calendar, FAQs, clubs, staff directory

## Development

### Running Locally
This is a static site — serve the folder with any HTTP server:
```bash
npx serve .          # or: python -m http.server 8000
```
Then open `http://localhost:3000` (or whatever port).

**No build step, no package.json, no tests.** Changes to `.js`/`.html`/`.css` are immediate on refresh.

### Firebase Configuration
`firebase-config.js` contains the live project config. Do not commit changes to API keys. Firestore rules are in `firestore.rules` — deploy via Firebase Console or `firebase deploy --only firestore:rules`.

### External Dependencies (all CDN)
- Firebase JS SDK v12.15.0 (auth, firestore)
- pdf.js v3.11.174 (attendance PDF import)
- ImgBB API (image uploads for announcements/lost-and-found)
- Google Fonts: Fraunces, Inter, JetBrains Mono

## Module Details

### Attendance (`attendance.js` — 1100+ lines)
**Complexity**: High. Handles PDF class list import with custom Y-coordinate text extraction to handle PCSHS's two-column (Male/Female) format. Key functions:
- `extractTextFromPdf()` / `parsePcshsPages()` / `parseSingleSection()` — PDF → structured sections
- `extractStudentsFromItems()` — Geometry-based row reconstruction (handles wrapped names)
- `markAttendance()` — 3-state cycle (Present → Late → Absent) with time-in for Late
- `import` modal — Two-step: upload PDF → review/edit detected sections → save all

### Reports (`reports.js` — 600+ lines)
- Month navigator fetching one attendance doc per weekday
- Calendar grid with color-coded attendance rate dots (≥90% / 70–89% / <70%)
- Per-student monthly summary table
- School-wide leaderboards (day/week/month) by absence/late/present rates

### Announcements & Lost & Found
Nearly identical CRUD patterns:
- Image upload via ImgBB (base64 → POST)
- Multi-image support with collage preview (4 shown, +N overlay)
- Lightbox for full-size viewing
- Edit modal preserves existing images, allows adding new ones
- Themed confirm modal (replaces `window.confirm`)

### Auth Flow
`auth-ui.js` runs on every page: listens to `onAuthStateChanged`, swaps "Log In" ↔ "Log Out" in header. Role checks happen per-page (e.g., `attendance.js` reads `users/{uid}.role`).

### Theming
- Dark mode default (CSS custom properties)
- Light mode via `data-theme="light"` on `<html>`
- Persisted in `localStorage.cassieTheme`
- Inline script in `<head>` applies theme before paint (no flash)

## Common Tasks

### Add a New Module
1. Create `module.html` + `module.js` (follow existing patterns)
2. Add nav link in all HTML files' `<nav class="site-nav">`
3. Add footer links in all HTML files
4. Import `auth-ui.js`, `nav.js`, `theme.js`, `suspension-banner.js` in new HTML
5. Add Firestore rules for new collection in `firestore.rules`

### Modify Attendance PDF Parser
The parser in `attendance.js` is tailored to PCSHS's specific PDF format (grade/section/adviser/room headers, Male/Female columns). Changes to `extractStudentsFromItems()`, `mergeAdjacentDigits()`, or `toLines()` require testing against actual PDFs — the logic handles:
- Multi-digit row numbers split across PDF items
- Wrapped names spanning multiple lines
- Column split at midpoint between "MALE" and "FEMALE" header X positions

### Update Firestore Rules
Edit `firestore.rules`, then deploy. Current rules use `exists()` + `get()` on `users/{uid}` for role checks. Secretaries are restricted to `assignedSections`.

### Deploy Rules
```bash
firebase deploy --only firestore:rules
```
(Requires Firebase CLI and project access)

## File Conventions

- **ES Modules**: All `.js` files use `import`/`export` and are loaded with `<script type="module">`
- **Shared DOM IDs**: `login-link`, `logout-button`, `theme-toggle`, `nav-toggle`, `suspension-banner`, `confirm-modal` — present on every page
- **CSS**: Single `style.css` with design tokens (colors, spacing, typography) as CSS custom properties
- **Comments**: Heavy inline documentation explaining *why*, not just *what*

## Gotchas

- **No build step** = no transpilation. Use only widely-supported JS features (ES2020+ is fine in modern browsers).
- **Firebase SDK from CDN** — version pinned to 12.15.0 in all imports. Update all files together if upgrading.
- **Attendance date key format**: `{sectionId}_${YYYY-MM-DD}` (e.g., `grade12_bernoulli_2026-07-27`)
- **Secretary role** only exists in `attendance.js` — other pages treat secretaries as regular users (no admin tools).
- **ImgBB API key** is hardcoded in two files. Rotate in both places if needed.
- **PDF.js worker** configured in `attendance.js:16-18` — must match pdf.js version.