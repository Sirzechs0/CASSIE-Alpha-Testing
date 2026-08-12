# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**C.A.S.S.I.E.** (Centralized Academic and School Services Information Engine) — a Firebase-backed web application for **Pasig City Science High School (PCSHS)**. It's a multi-page school management system with modules for attendance, announcements, lost & found, reports/analytics, calendar & history, FAQs, clubs, staff directory and many more others.

## Architecture

**Tech Stack:**
- Pure vanilla JavaScript (ES modules), HTML, CSS — no build step, no bundler
- Firebase Auth + Firestore (via CDN: `firebasejs/12.15.0`)
- ImgBB API for image hosting (API key in `announcements.js`, `lost-and-found.js`, `about.js`, and `clubs.js`)
- pdf.js (CDN) for PDF text extraction in attendance import

**Project Structure:**
```
├── index.html                 # Dashboard (landing page)
├── attendance.html/js         # Attendance marking + PDF class list import
├── reports.html/js            # Attendance analytics, calendars, leaderboards
├── announcements.html/js      # Searchable event timeline with CRUD (images optional)
├── lost-and-found.html/js     # Lost/Found reports with CRUD
├── about.html/js              # About page: hero, history, symbols, admissions — per-section admin edit
├── faqs.html/js               # FAQ accordion
├── clubs.html/js              # Student organizations — fixed roster of ~28 clubs across 3 categories, admin-editable content (logo/description/events/achievements/socials) per club
├── staff-directory.html       # Personnel listing
├── support.html/js            # "Let's Connect" support page — contact info (pulled from siteContent/about's hero fields) + a contact form that writes to supportMessages
├── login.html/js              # Firebase Auth login page
├── firebase-config.js         # Single Firebase init (exports auth, db)
├── auth-ui.js                 # Shared login/logout header state
├── nav.js                     # Mobile hamburger menu toggle + Explore dropdown
├── theme.js                   # Dark/light toggle (localStorage)
├── style.css                  # Complete design system (~108KB)
├── firestore.rules            # Security rules for all collections
└── logo.png                   # School logo
```

## Key Concepts

### Firestore Collections
| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `sections` | Class sections (grade, name, adviser, room, maleCount, femaleCount) | `grade`, `name`, `adviser`, `room`, `maleCount`, `femaleCount` |
| `sections/{sectionId}/students` | Student roster per section | `no`, `name`, `gender` (M/F) |
| `attendance` | Daily attendance records, keyed `{sectionId}_{YYYY-MM-DD}` | `sectionId`, `date`, `records` (map of studentId → {status, timeIn}), `submitted` (bool), `submittedAt`, `submittedBy` |
| `announcements` | Event-style timeline posts — title, optional schedule/location/audience, tags, optional images | `title`, `caption`, `tags[]`, `eventDate`, `eventTime`, `location`, `audience`, `imageUrls[]`, `postedBy`, `timestamp` |
| `lostAndFound` | Lost/found item reports | `type` (lost/found), `title`, `description`, `location`, `date`, `contact`, `imageUrls[]` |
| `users` | Staff accounts with roles | `role` (admin/staff/secretary), `assignedSections[]` (for secretaries) |
| `siteContent` | Admin-editable content pages, one doc per page (e.g. `siteContent/about`) | one top-level field per page section — see about.js `DEFAULTS` for the full shape |
| `clubs` | Editable content per student org, one doc per club, doc ID is a fixed slug from `CLUB_LIST` in clubs.js (e.g. `alchemist`, `yes-o`) | `logo`, `description`, `events[]` ({title, date, description}), `achievements[]` ({title, year, description}), `socials` ({facebook, instagram, tiktok, youtube}) |
| `supportMessages` | Contact-form submissions from the Support page | `firstName`, `lastName`, `email`, `subject`, `yearSection`, `message`, `timestamp` |

### Roles & Permissions
- **Admin/Staff**: Full CRUD on all modules, can import PDFs, delete sections, edit the About page
- **Secretary**: Can mark attendance only for assigned sections (set in user doc)
- **Public**: Read-only access to announcements, lost & found, About, FAQs, clubs, staff directory

### Site-wide Header & Navigation
Every page repeats the same header/footer markup — there's no templating (see "No build step" below), so a nav or footer change means editing it in **every** HTML file. The header nav has five top-level items — Dashboard, Announcements, About, Support, and an "Explore" dropdown — so it stays on one line instead of wrapping on medium-width screens. Explore holds the rest: Attendance, Attendance Reports, Lost & Found, FAQs, Clubs, Staff Directory. The dropdown is plain markup (`.nav-dropdown` / `.nav-dropdown-toggle` / `.nav-dropdown-menu` in `style.css`) driven by `nav.js` — click to open/close (not hover, so it behaves the same on touch), and it closes on outside click, Escape, or tabbing away. The same markup renders as a floating popup on desktop and an in-place expanding section on mobile, switching at the existing 860px breakpoint.

### Skeleton Loading States
`style.css` defines a small reusable shimmer system — `.skel` (background + sweep animation, for an empty placeholder element) and `.skel-text` (hides an element's own fallback text without removing it, for something like a stat number that already holds placeholder content) — used anywhere a page fetches data on load, instead of a plain "Loading..." string or a blank gap. The pattern: build placeholder markup that reuses the REAL component's own classes (a fake `.dash-announce-card`, `.cal-cell`, `.tab-btn`, `.event-card`, etc.) with `.skel`/`.skel-text` on the parts that would hold real content, so the skeleton is already the right shape and size and nothing visibly shifts once real content swaps in. Currently applied on: Dashboard (stats bar + latest announcements), Announcements and Lost & Found (feed), Attendance Reports (calendar + overview stats + leaderboards), Attendance (table rows + grade/section tabs), About (every section, painted synchronously before the auth+data fetch resolves — see `renderSkeletons()` in `about.js`), FAQs (accordion), and Support (contact info cards). Reuse this same pattern — real component classes plus `.skel`/`.skel-text` — for any new page that loads data asynchronously, rather than inventing a new loading convention.

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

### Attendance (`attendance.js` — 1400+ lines)
**Complexity**: High. Handles PDF class list import with custom Y-coordinate text extraction to handle PCSHS's two-column (Male/Female) format. Key functions:
- `extractTextFromPdf()` / `parsePcshsPages()` / `parseSingleSection()` — PDF → structured sections
- `extractStudentsFromItems()` — Geometry-based row reconstruction (handles wrapped names)
- `markAttendance()` — 3-state cycle (Present → Late → Absent) with time-in for Late
- `import` modal — Two-step: upload PDF → review/edit detected sections → save all
- **Date navigator** (`prevDayBtn`/`nextDayBtn`/`dateInput`, `#date-picker`) — steps to any past school day back to `ATTENDANCE_START_DATE`, skipping weekends, so a secretary can go back and fix a day they forgot or got wrong instead of only ever marking today. Builds its "today" from local `Date` getters (`toDateStr()`), not `toISOString()`, which would silently report the wrong calendar day for part of every morning in Philippine time (UTC+8).
- **Submit workflow** (`docMeta`, `renderSubmissionBar()`, `#submit-attendance-btn`) — marking a student's status always saves immediately, but a day only counts as "official" once Submit is pressed, which stamps `submitted: true` on that day's doc. A brand-new doc gets `submitted: false` on its first save (see the `docMeta.exists` check in `markAttendance()`); docs saved before this feature existed have no `submitted` field at all and are grandfathered in as submitted (`data.submitted !== false`). This same rule is duplicated in `reports.js` — keep both in sync if it ever changes.

### Reports (`reports.js` — 700+ lines)
- Nav-facing name is "Attendance Reports" (header/footer link text, `<h1>`) — "Reports" alone read too generic next to the site's other modules.
- The whole page is gated behind login: logged out, `reports.html` shows a "log in to continue" placeholder instead of any report data (see the `onAuthStateChanged` handler at the top of `reports.js`). This is a client-side gate only — Firestore's read rules for `attendance`/`sections`/`students` are still public, since `attendance.js`'s date-navigable view and the dashboard's stat counts depend on that same public read. Making this a real server-side restriction would mean touching those two pages as well.
- Month navigator fetching one attendance doc per weekday
- Calendar grid with color-coded attendance rate dots (≥90% / 70–89% / <70%)
- Per-student monthly summary table
- School-wide leaderboards (day/week/month) by absence/late/present rates
- **"Not Submitted" detection** (`monthNotSubmitted`, `showNotSubmittedDetail()`) — a school day with no submitted attendance doc (never opened, or opened but never confirmed with Submit on the Attendance page) shows as a distinct red "!" state on the calendar instead of being silently counted as full attendance the way it used to be. The monthly overview gets a matching "Not Submitted" stat card, and the Leaderboards' "Today" tab lists any section that hasn't submitted yet (`not-submitted-banner`).

### Announcements (`announcements.js`)
Rendered as a vertical timeline (`.event-item`/`.event-card` in `style.css`), not the masonry grid Lost & Found still uses below. Each post has a title (required), optional event date/time/location/audience, optional tags, and OPTIONAL images — a placeholder box (`.event-media-placeholder`) shows when there are none. Long descriptions (`-webkit-line-clamp`) and multi-image galleries collapse behind a "Learn More" toggle — see `buildEventCard()` / `renderEventMedia()`. A page-local search box (`#announcement-search`) filters the already-loaded posts client-side by title/description/tags/location/audience (same pattern as the FAQ search); clicking a tag chip re-runs that same search for the tag. A small "Past" badge appears once `eventDate` is before today. Image upload still goes through ImgBB (base64 → POST), same as Lost & Found.

### Lost & Found (`lost-and-found.js`)
Unchanged CRUD pattern, still separate from Announcements' timeline:
- Image upload via ImgBB (base64 → POST)
- Multi-image support with collage preview (4 shown, +N overlay) via the original `.feed-grid`/`.announcement-card`/`.announcement-media` classes in `style.css`
- Lightbox for full-size viewing
- Edit modal preserves existing images, allows adding new ones
- Themed confirm modal (replaces `window.confirm`)

### About (`about.js`)
Public content page (hero, vision/mission, history timeline, symbols, awards, org chart, courses, admission process) backed by a single Firestore document, `siteContent/about`. Different pattern from Announcements/Lost & Found — no modal:
- Every field starts out as Lorem Ipsum / bracketed `[Placeholder]` text (see `DEFAULTS` at the top of the file) until an admin overwrites it — the page never looks empty on a fresh project.
- Each of the 9 sections (hero, purpose, about, history, symbols, awards, orgChart, courses, admission) edits and saves **independently**: admin/staff see a small "✎ Edit" button per section; clicking it swaps just that section into an inline form, and Save writes only that one top-level field via `setDoc(..., {merge:true})` — editing History can't touch Admission's saved data.
- Two shared list-editor helpers (`renderStringListEditor`, `renderObjectListEditor`) back every add/remove list in the file (fast facts, electives, symbols, awards, principals, org chart, admission steps) — extend those rather than writing a new one-off editor if another list field gets added later.
- Images (hero background, a symbol's photo, an org chart member's photo) go through the same ImgBB pattern as Announcements/Lost & Found, via `buildImagePicker()` / `resolveImage()`.

### Clubs (`clubs.js`)
Fixed roster of ~28 student organizations across 3 categories (Academic / Co-Curricular, Non-Academic / Extra-Curricular, Creatives / SSLG-Affiliate), shown as a tabbed grid of cards. The roster itself — `CATEGORIES` and `CLUB_LIST` (id/shortName/tagline/category per club) — is a plain array at the top of `clubs.js`, not stored in Firestore; adding, renaming, or removing a club means editing that array. Only the per-club CONTENT is Firestore-backed, one doc per club in the `clubs` collection keyed by each club's fixed `id`:
- Anyone can click a card to open a read-only detail modal (logo, description, events, achievements, social icons). Admin/staff get an extra "✎" button on every card (and inside the detail view) that swaps the same modal into an edit form — reusing about.js's own `buildImagePicker()`/`resolveImage()` (Facebook-style single-logo upload via ImgBB) and `renderObjectListEditor()` (add/remove rows) patterns, duplicated into `clubs.js` rather than imported, same as every other page-specific helper in this codebase.
- A club with nothing saved yet just shows honest empty states ("No description yet.", "No events posted yet.") instead of Lorem Ipsum — with ~28 cards on one page, repeating placeholder paragraph text across all of them would look broken rather than "not empty," unlike the About page's single-instance Lorem Ipsum fields.
- The grid renders immediately using the static roster (so names/taglines never wait on a network round trip) with only each card's logo/description shimmering as `.skel` placeholders until the one-time `clubs` collection fetch resolves — different from most other pages' skeleton states, where the whole list itself is unknown until the fetch completes.
- Club names/taglines are stored in normal capitalization in `CLUB_LIST` and rendered uppercase via CSS (`.club-card-name`, `.club-modal-header h2`) rather than typed in literal ALL CAPS, so a screen reader doesn't read a long club name letter-by-letter as if it were an acronym.

### Support (`support.js`)
"Let's Connect"-style contact page: a left column of contact info cards (Email, Facebook, Phone, Visit Us) plus a "Before You Reach Out" callout pointing at the FAQs, and a right-column contact form. Deliberately reuses `siteContent/about`'s hero fields (`email`, `contactNumber`/`landline`, `address`) for the three dynamic contact cards instead of maintaining a second copy of the same school contact info — editing them via the About page's Hero "✎ Edit" panel updates both pages at once, and falls back to the same bracketed-placeholder text (`[Contact Number]`, etc.) as `about.js`'s own `DEFAULTS` when nothing's been filled in yet. The Facebook card is a static `href="#"` (same convention as the footer social icons) for Luck to paste the real URL into directly. The form has no auth gate — anyone can submit — and writes to `supportMessages` (`firstName`, `lastName`, `email`, `subject`, `yearSection`, `message`, `timestamp`); nothing in the UI reads that collection back yet, so check submissions via the Firebase Console (or build an admin inbox later) until something does.

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
2. Add a nav link in all HTML files' `<nav class="site-nav">` — a new top-level link, or inside `.nav-dropdown-menu` if it's secondary (see "Site-wide Header & Navigation" above)
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
- **Shared DOM IDs**: `login-link`, `logout-button`, `theme-toggle`, `nav-toggle`, `suspension-banner` — present on every page. `confirm-modal` is present on every page EXCEPT `about.html` and `clubs.html`, neither of which needs one — both only ever edit an existing fixed entity (a page section, a club) and edits aren't committed until Save, so Cancel can just discard the draft without a confirmation dialog. Neither page has a delete action.
- **CSS**: Single `style.css` with design tokens (colors, spacing, typography) as CSS custom properties
- **Comments**: Heavy inline documentation explaining *why*, not just *what*

## Gotchas

- **No build step** = no transpilation. Use only widely-supported JS features (ES2020+ is fine in modern browsers).
- **Firebase SDK from CDN** — version pinned to 12.15.0 in all imports. Update all files together if upgrading.
- **Attendance date key format**: `{sectionId}_${YYYY-MM-DD}` (e.g., `grade12_bernoulli_2026-07-27`)
- **`submitted` field on attendance docs** — added for the Submit workflow. Three states: missing entirely (doc predates this feature — treated as submitted), explicitly `false` (a draft someone started marking but never confirmed), or `true` (submitted). `attendance.js` and `reports.js` both check this with the same `!== false` pattern — change one, change both.
- **`ATTENDANCE_START_DATE` is duplicated** in `attendance.js` (bounds the date navigator) and `reports.js` (bounds which missing days get flagged "not submitted"). Same tradeoff as the ImgBB key below — update both if the real rollout date changes.
- **Secretary role** only exists in `attendance.js` — other pages treat secretaries as regular users (no admin tools).
- **ImgBB API key** is hardcoded in four files (`announcements.js`, `lost-and-found.js`, `about.js`, `clubs.js`). Rotate in all four if needed.
- **PDF.js worker** configured in `attendance.js:16-18` — must match pdf.js version.
- **Announcements images are optional** — `getImageUrls(data)` can return an empty array; always check `.length` before assuming a cover photo exists (see the placeholder fallback in `renderEventMedia()`).
- **Dashboard hero** (`dashboard.js`) scans the 5 most recent announcements for the first one WITH a photo, since images are now optional — it won't necessarily feature the literal latest post if that one happens to be text-only.
- **Most files use CRLF line endings, not just `style.css`** — `style.css`, every `.html` file, and every `.js` file EXCEPT `lost-and-found.html`/`lost-and-found.js` (which are plain LF, an existing inconsistency, not a bug to "fix" by converting them) are CRLF throughout. If editing any of the CRLF files by hand (not through Claude), keep new additions consistent or the file will end up with mixed line endings within itself — check with `cat -A` or a hex viewer if unsure, since most editors show CRLF and LF identically on screen.