// config.js
// ------------------------------------------------------------------
// Journal app config. The integration task will populate
// `window.__JOURNAL_CONFIG__` with the real anon key + URL.
//
// SECURITY:
//   - The `anonKey` here is a PUBLIC anon key. It is safe to ship in JS
//     (RLS on the server enforces authorization, not the key).
//   - NEVER read or ship a `service_role` key in this bundle.
//   - We do not persist tokens to localStorage. Supabase JS stores
//     session tokens in localStorage by default; for a journal app this
//     is acceptable because RLS prevents cross-user reads, but be aware
//     that any XSS would expose the user's session. See auth.js for
//     how we mitigate this by never using `innerHTML` for user content.
// ------------------------------------------------------------------

// Default config (mock mode by default so the UI is demoable without backend).
const DEFAULT_CONFIG = Object.freeze({
  url: "",
  anonKey: "",
  useMock: true,
});

// Merge window.__JOURNAL_CONFIG__ over defaults so missing keys still work.
const userConfig =
  typeof window !== "undefined" && window.__JOURNAL_CONFIG__
    ? window.__JOURNAL_CONFIG__
    : {};

export const config = Object.freeze({
  ...DEFAULT_CONFIG,
  ...userConfig,
});

export const isMockMode = config.useMock || !config.url || !config.anonKey;

// Tiny helper for diagnostic logging. Never log the anon key value.
export function describeConfig() {
  if (isMockMode) return "mock";
  // Show only the project host part of the URL; keep the rest private.
  let host = "(unknown)";
  try {
    host = new URL(config.url).host;
  } catch (_) {
    host = "(invalid url)";
  }
  return `live @ ${host}`;
}
