// nav.js
// Toggles the mobile navigation menu open/closed when the hamburger
// button is tapped. On desktop this button is hidden entirely (see
// style.css), so this only matters on narrow screens.

(function () {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.querySelector(".site-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  // Tapping a nav link closes the menu too, instead of leaving it open
  // when the new page loads. This covers the top-level links AND the
  // ones inside the Explore dropdown below.
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => nav.classList.remove("open"));
  });
})();

// ─── "Explore" dropdown ─────────────────────────────────────────────────
// Same markup renders two different ways (see the .nav-dropdown rules in
// style.css): a floating popup on desktop, an in-place expanding section
// on mobile. Below 861px there's no real "hover" on a touchscreen, so it
// stays click/tap-to-open there, driven entirely by the .open class below.
// At 861px and up, style.css opens the popup on :hover/:focus-within all
// by itself — no JS involved — so a mouse user gets a hover menu and a
// keyboard user gets the same menu just by tabbing onto the toggle, no
// click required. Everything below still runs at every width, though:
// click-to-toggle still works as a fallback/pin on desktop, closing on
// Escape/outside-click/tabbing-away has to happen in JS regardless of how
// the menu opened, and aria-expanded needs a line of its own since CSS
// can't touch it (see the focusin listener at the bottom).
(function () {
  const dropdown = document.querySelector(".nav-dropdown");
  if (!dropdown) return;
  const dropdownToggle = dropdown.querySelector(".nav-dropdown-toggle");
  if (!dropdownToggle) return;

  function closeDropdown() {
    dropdown.classList.remove("open");
    dropdownToggle.setAttribute("aria-expanded", "false");
  }

  dropdownToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open", willOpen);
    dropdownToggle.setAttribute("aria-expanded", String(willOpen));
  });

  // Outside click, Escape, or tabbing away all close it — matters most on
  // desktop, where the menu floats over the page instead of pushing
  // content down like it does on mobile.
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) closeDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });
  dropdown.addEventListener("focusout", (e) => {
    if (!dropdown.contains(e.relatedTarget)) closeDropdown();
  });

  // Tabbing onto the toggle (or into a link already inside the menu) is
  // exactly the case style.css's :focus-within rule opens the popup for
  // on its own, above 860px — this just keeps aria-expanded in sync with
  // that so a screen reader hears the same "expanded" state a sighted
  // keyboard user sees. focusin bubbles, so one listener on the container
  // covers the toggle and every link inside the menu; focusout above
  // already resets it back to "false" the moment focus leaves for good.
  dropdown.addEventListener("focusin", () => {
    dropdownToggle.setAttribute("aria-expanded", "true");
  });
})();