// app.js
// ------------------------------------------------------------------
// Main entry. Wires:
//   - auth state → view switching
//   - hash router: #/, #/new, #/entry/:id
//   - timeline ↔ editor transitions
//
// The app is deliberately tiny — no framework, no build step. The
// render functions in views/* own their own DOM.
// ------------------------------------------------------------------

import { auth } from "./auth.js";
import { config, describeConfig } from "./config.js";
import { initTheme } from "./theme.js";
import { renderLoginView } from "./views/login.js";
import { renderTimelineView } from "./views/timeline.js";
import { renderEditorView } from "./views/editor.js";
import { renderReaderView } from "./views/reader.js";
import { renderJournalsView } from "./views/journals.js";

const root = () => document.getElementById("app");

// ----- State -----
let session = null; // Supabase session object (or mock session)
let route = parseRoute(window.location.hash);

// ----- Helpers -----
function parseRoute(hash) {
  // Forms:
  //   "" or "/"            -> timeline
  //   "/new"               -> editor (new entry)
  //   "/entry/<id>"        -> reader
  //   "/entry/<id>/edit"   -> editor (edit existing)
  //   "/journals"          -> journal management
  const clean = (hash || "").replace(/^#/, "");
  if (clean === "" || clean === "/") return { name: "timeline", entryId: null };
  if (clean === "/new") return { name: "editor", entryId: null };
  if (clean === "/journals") return { name: "journals", entryId: null };
  const m = clean.match(/^\/entry\/([\w-]+)(?:\/(edit))?$/);
  if (m) {
    return m[2] === "edit"
      ? { name: "editor", entryId: m[1] }
      : { name: "reader", entryId: m[1] };
  }
  // Unknown — fall through to timeline.
  return { name: "timeline", entryId: null };
}

function setRoute(next, { replace = false } = {}) {
  route = next;
  let hash = "#/";
  if (next.name === "editor" && next.entryId) hash = `#/entry/${next.entryId}/edit`;
  else if (next.name === "editor" && !next.entryId) hash = "#/new";
  else if (next.name === "reader" && next.entryId) hash = `#/entry/${next.entryId}`;
  else if (next.name === "journals") hash = "#/journals";
  if (replace) {
    history.replaceState(null, "", hash);
  } else {
    window.location.hash = hash;
  }
  render();
}

window.addEventListener("hashchange", () => {
  route = parseRoute(window.location.hash);
  render();
});

// ----- Render dispatcher -----
function render() {
  if (!session) {
    // Always go to login when signed out, regardless of hash.
    if (route.name !== "timeline") {
      history.replaceState(null, "", "#/");
      route = { name: "timeline", entryId: null };
    }
    renderLoginView(root());
    return;
  }
  const userId = session.user?.id || null;
  const userEmail = session.user?.email || "";
  if (route.name === "timeline") {
    renderTimelineView(root(), {
      userId,
      userEmail,
      onNewEntry: () => setRoute({ name: "editor", entryId: null }),
      onOpenEntry: (id) => setRoute({ name: "reader", entryId: id }),
      onEditEntry: (id) => setRoute({ name: "editor", entryId: id }),
      onDeleteEntry: (id) => deleteEntryAndGoHome(id),
      onSignOut: () => signOut(),
      onManageJournals: () => setRoute({ name: "journals", entryId: null }),
    });
  } else if (route.name === "journals") {
    renderJournalsView(root(), {
      userId,
      userEmail,
      onBack: () => setRoute({ name: "timeline", entryId: null }, { replace: true }),
    });
  } else if (route.name === "reader") {
    renderReaderView(root(), {
      entryId: route.entryId,
      onBack: () => setRoute({ name: "timeline", entryId: null }, { replace: true }),
      onEdit: (id) => setRoute({ name: "editor", entryId: id }),
      onDeleted: () => setRoute({ name: "timeline", entryId: null }, { replace: true }),
    });
  } else if (route.name === "editor") {
    renderEditorView(root(), {
      entryId: route.entryId,
      userId,
      onBack: () => {
        // From the editor, "back" should go to the reader (for existing
        // entries) or the timeline (for new entries).
        if (route.entryId) {
          setRoute({ name: "reader", entryId: route.entryId }, { replace: true });
        } else {
          setRoute({ name: "timeline", entryId: null }, { replace: true });
        }
      },
      onSaved: (_entry, meta) => {
        // After saving a brand new entry we go back to the timeline;
        // for existing entries we go to the reader so the user can
        // see the updated content.
        if (meta?.isNew) {
          setRoute({ name: "timeline", entryId: null }, { replace: true });
        } else if (route.entryId) {
          setRoute({ name: "reader", entryId: route.entryId }, { replace: true });
        }
      },
      onDeleted: () => {
        setRoute({ name: "timeline", entryId: null }, { replace: true });
      },
    });
  } else {
    setRoute({ name: "timeline", entryId: null }, { replace: true });
  }
}

async function deleteEntryAndGoHome(id) {
  // Used by the timeline's delete button. We import dynamically so the
  // timeline view doesn't have to know about db / images.
  const { db } = await import("./db.js");
  const { deleteImage } = await import("./images.js");
  const ok = window.confirm("Delete this entry? This cannot be undone.");
  if (!ok) return;
  try {
    const { data, error } = await db.getEntry(id);
    const paths = data && Array.isArray(data.image_paths) ? data.image_paths : [];
    const del = await db.deleteEntry(id);
    if (del.error) throw del.error;
    for (const p of paths) deleteImage(p).catch(() => {});
    // The timeline view keeps its own state; simplest is to navigate
    // away and back to force a refresh.
    setRoute({ name: "timeline", entryId: null }, { replace: true });
    // Trigger a hard reload so the timeline refetches.
    window.location.reload();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Delete failed:", e);
    window.alert(e?.message || "Couldn't delete that entry.");
  }
}

// ----- Sign out -----
async function signOut() {
  await auth.signOut();
  // The auth listener will set session = null and re-render.
}

// ----- Boot -----
async function boot() {
  // Resolve and apply the theme (light/dark) before the first paint so
  // we don't get a flash of the wrong palette.
  initTheme();

  // Surface the build mode in the document so the integration task can
  // confirm via DevTools that config wired up correctly. Not a security
  // concern (this is just "mock" vs "live @ host").
  document.documentElement.dataset.mode = auth.isMock ? "mock" : "live";
  // eslint-disable-next-line no-console
  console.info("[Quiet] journal starting in " + describeConfig() + " mode");

  // Bind Supabase's own auth listener so refreshes don't kick us back
  // to the login screen when we already have a stored session.
  await auth.bindSupabaseAuth();

  auth.onAuthStateChange((event, nextSession) => {
    session = nextSession;
    // Force a clean route on sign-out.
    if (event === "SIGNED_OUT" || !session) {
      history.replaceState(null, "", "#/");
      route = { name: "timeline", entryId: null };
    }
    render();
  });

  const { data } = await auth.getSession();
  session = data?.session || null;
  render();
}

boot().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Boot failed:", e);
  root().replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "state state-error",
      textContent: "The app failed to start. Please reload the page.",
    })
  );
});

// Expose a tiny debug surface for the integration task. Not used by
// the app itself.
if (typeof window !== "undefined") {
  window.__quiet = {
    config,
    auth,
    reload: () => {
      session = null;
      return boot();
    },
  };
}
