// theme.js
// ------------------------------------------------------------------
// Theme management: light / dark, with persistence.
//
// Resolution order when the page first loads:
//   1. localStorage("quiet-theme") if set to "light" or "dark"
//   2. Otherwise, the OS preference via prefers-color-scheme
//   3. Otherwise, "light"
//
// We write the resolved theme to <html data-theme="..."> so the CSS
// can switch on it. We also subscribe to OS-level changes so a user
// who hasn't picked an explicit theme follows their system.
// ------------------------------------------------------------------

const STORAGE_KEY = "quiet-theme";
const VALID = new Set(["light", "dark"]);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (VALID.has(v)) return v;
  } catch (_) { /* localStorage may be unavailable */ }
  return null;
}

function writeStored(v) {
  try {
    if (v === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, v);
  } catch (_) { /* ignore */ }
}

function systemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the given theme to the document. If `v` is null, fall back to
 * the stored / system preference. Returns the resolved theme.
 */
export function applyTheme(v) {
  let resolved;
  if (VALID.has(v)) {
    resolved = v;
  } else {
    resolved = readStored() || systemTheme();
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

/**
 * Toggle between light and dark, persist the choice, apply it.
 * Returns the new theme.
 */
export function toggleTheme() {
  const current =
    (typeof document !== "undefined" && document.documentElement.dataset.theme) ||
    systemTheme();
  const next = current === "dark" ? "light" : "dark";
  writeStored(next);
  return applyTheme(next);
}

/**
 * Initialize on app boot: resolve and apply, and listen for OS-level
 * changes (so users who haven't picked an explicit theme follow their
 * system). Safe to call multiple times.
 */
export function initTheme() {
  applyTheme();
  if (typeof window !== "undefined" && window.matchMedia) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      // Only follow the OS change if the user has NOT picked an explicit
      // theme. If they have, leave their choice alone.
      if (!readStored()) applyTheme();
    };
    // `addEventListener` is the modern API; `addListener` is the old
    // Safari path. Support both.
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }
}

/**
 * Build a small toggle button (☼ in dark mode, ☾ in light) that
 * flips the theme. Returns the element. Callers append it where they
 * want it in their header.
 */
export function makeThemeToggle() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-ghost btn-small theme-toggle";
  btn.setAttribute("aria-label", "Toggle dark / light");
  btn.title = "Toggle dark / light";
  const update = () => {
    const current =
      document.documentElement.dataset.theme ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    btn.textContent = current === "dark" ? "☼" : "☾";
    btn.setAttribute("aria-pressed", current === "dark" ? "true" : "false");
  };
  update();
  btn.addEventListener("click", () => {
    toggleTheme();
    update();
  });
  // Keep the icon in sync if the OS-level theme changes and there's
  // no stored preference.
  if (window.matchMedia) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!readStored()) update();
    };
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }
  return btn;
}
