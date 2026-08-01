// auth.js
// ------------------------------------------------------------------
// Auth wrapper around the Supabase JS client. Handles login / signup /
// logout and exposes a session event so the app can react.
//
// SECURITY NOTES:
//   - We never read or store the service_role key. Supabase JS handles
//     the anon key + JWT for us.
//   - The JWT session is persisted by Supabase JS in localStorage by
//     default. We do not duplicate it. The RLS policies in the backend
//     are what actually authorize access — not the token contents.
//   - User-controlled text never reaches innerHTML in the views; we use
//     textContent and DOM construction only. Even the email/display name
//     in the header is rendered with textContent.
// ------------------------------------------------------------------

import { isMockMode } from "./config.js";
import { getSupabaseClient } from "./supabase-client.js";

// In mock mode, simulate a session in memory.
const listeners = new Set();
let mockSession = null;
let mockUser = null;

function notify(event, session) {
  for (const l of listeners) {
    try {
      l(event, session);
    } catch (e) {
      // Don't let a buggy listener kill the broadcast.
      // eslint-disable-next-line no-console
      console.error("auth listener threw:", e);
    }
  }
}

// Supabase stores the session under a key like
// `sb-<project-ref>-auth-token`. We need the project ref to read it.
function supabaseStorageKey() {
  try {
    return window?.__quiet?.config?.supabaseUrlRef || "";
  } catch (_) {
    return "";
  }
}

export const auth = {
  isMock: isMockMode,

  /**
   * Returns the current user's id (synchronous), or null if signed out.
   * In mock mode this reads from the in-memory mock session.
   */
  userId() {
    if (isMockMode) {
      return mockUser?.id || null;
    }
    try {
      // Supabase JS stores the session in localStorage. Avoid an async
      // hop when callers just need the id for client-side writes.
      const raw = localStorage.getItem("sb-" + supabaseStorageKey() + "-auth-token");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.user?.id || null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Subscribe to auth state changes.
   * @param {(event: string, session: object | null) => void} listener
   * @returns {() => void} unsubscribe
   */
  onAuthStateChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Returns the current session (or null if signed out).
   * In mock mode, this resolves immediately.
   */
  async getSession() {
    if (isMockMode) {
      return { data: { session: mockSession }, error: null };
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    return { data, error };
  },

  /**
   * Subscribe to the Supabase client's own auth events in real mode.
   * Returns an unsubscribe function.
   */
  async bindSupabaseAuth() {
    if (isMockMode) return () => {};
    const supabase = await getSupabaseClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      notify(event, session);
    });
    return () => data.subscription.unsubscribe();
  },

  async signInWithPassword({ email, password }) {
    if (isMockMode) {
      // Pretend it always works in mock mode; the timeline is demoable.
      mockUser = { id: "00000000-0000-0000-0000-000000000001", email };
      mockSession = {
        access_token: "mock-token",
        user: mockUser,
      };
      notify("SIGNED_IN", mockSession);
      return { data: { user: mockUser, session: mockSession }, error: null };
    }
    const supabase = await getSupabaseClient();
    const { data, error } =
      await supabase.auth.signInWithPassword({ email, password });
    if (!error && data?.session) notify("SIGNED_IN", data.session);
    return { data, error };
  },

  async signUp({ email, password }) {
    if (isMockMode) {
      mockUser = { id: "00000000-0000-0000-0000-000000000001", email };
      mockSession = {
        access_token: "mock-token",
        user: mockUser,
      };
      notify("SIGNED_IN", mockSession);
      return { data: { user: mockUser, session: mockSession }, error: null };
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (!error && data?.session) notify("SIGNED_IN", data.session);
    return { data, error };
  },

  async signOut() {
    if (isMockMode) {
      mockSession = null;
      mockUser = null;
      notify("SIGNED_OUT", null);
      return { error: null };
    }
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    notify("SIGNED_OUT", null);
    return { error };
  },
};
