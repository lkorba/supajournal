// journal-state.js
// ------------------------------------------------------------------
// Tiny per-tab store for journal metadata + active journal filter.
// All views read this so the timeline, editor, and journals page all
// agree on "which journal is the user currently focused on?".
//
// The active journal ID is persisted in localStorage so the choice
// survives reloads. The journal list itself is re-fetched on each
// view load (cheap with RLS + the user_id index).
// ------------------------------------------------------------------

const KEY_ACTIVE = "sj_active_journal_id";
const KEY_CACHE  = "sj_journals_cache_v1";

const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* ignore */ }
  }
}

export const journalState = {
  // Active journal ID (or null for "all").
  getActiveJournalId() {
    try {
      return localStorage.getItem(KEY_ACTIVE) || null;
    } catch (_) {
      return null;
    }
  },
  setActiveJournalId(id) {
    try {
      if (id) localStorage.setItem(KEY_ACTIVE, id);
      else localStorage.removeItem(KEY_ACTIVE);
    } catch (_) { /* ignore */ }
    notify();
  },
  // Cached journal list (latest fetch).
  getCachedJournals() {
    try {
      const raw = localStorage.getItem(KEY_CACHE);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  },
  setCachedJournals(list) {
    try {
      localStorage.setItem(KEY_CACHE, JSON.stringify(list || []));
    } catch (_) { /* ignore */ }
    notify();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Preset icons and colors offered in the journal create/edit UI.
// Keeping this small + curated so the picker is one tap, not a search.
export const JOURNAL_ICONS = [
  "📔", "📓", "📕", "📗", "📘", "📙",
  "🌍", "✈️", "🏠", "💼", "🎨", "🎵",
  "❤️", "🌱", "☕", "🌙", "☀️", "🧘",
];

export const JOURNAL_COLORS = [
  "#6b8a5a", // sage
  "#8b5a3c", // warm brown
  "#a05c8b", // dusty rose
  "#3a6b8a", // ocean
  "#b8862b", // honey
  "#6b4a8a", // lavender
  "#8a3a3a", // brick
  "#3a8a8a", // teal
];
