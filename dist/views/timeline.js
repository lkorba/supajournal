// views/timeline.js
// ------------------------------------------------------------------
// Timeline: list of entries grouped by entry_date, newest first.
// Includes client-side search and a "+ New entry" FAB.
// ------------------------------------------------------------------

import { db } from "../db.js";
import { renderMarkdownToHtml } from "../markdown.js";
import { signImagePaths } from "../images.js";
import { isMockMode } from "../config.js";
import { makeThemeToggle } from "../theme.js";

// ----- DOM helper -----
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "on") {
      for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    } else if (k === "attrs") {
      for (const [ak, av] of Object.entries(v)) node.setAttribute(ak, av);
    } else {
      node[k] = v;
    }
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

const MOOD_EMOJI = ["", "😔", "😐", "🙂", "😄", "🤩"];

function formatDateHeader(iso) {
  // iso is YYYY-MM-DD
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yIso = yesterday.toISOString().slice(0, 10);
  if (iso === todayIso) return "Today";
  if (iso === yIso) return "Yesterday";
  // Parse as local-date to avoid timezone shift.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: dt.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

export function renderTimelineView(root, {
  onOpenEntry,
  onEditEntry,
  onDeleteEntry,
  onNewEntry,
  onSignOut,
  userEmail,
}) {
  let allEntries = [];
  let searchTerm = "";
  let loading = true;
  let errorMsg = "";
  // Signed URLs persist across paint() calls. We also keep a set of
  // paths we have already requested, so a re-paint (e.g. after a search
  // filter changes) does not re-sign the same paths. This also stops
  // the previous infinite-repaint bug where each paint() fired another
  // signImagePaths() call whose .then() called paint() again, forever.
  const signedUrlByPath = new Map();
  const signingInFlight = new Set();
  // Bumped every time we want a re-paint; we only honor the *latest*
  // request, so an in-flight signImagePaths from an earlier paint
  // doesn't re-render the timeline after the user has navigated away.
  let paintEpoch = 0;

  // ----- Header -----
  const headerEmail = el("span", {
    class: "header-email",
    text: userEmail || "",
  });
  headerEmail.id = "header-email";

  const header = el("header", { class: "app-header" }, [
    el("div", { class: "app-header-inner" }, [
      el("div", { class: "brand brand-small" }, [
        el("div", { class: "brand-mark", text: "✦" }),
        el("div", { class: "brand-name", text: "Quiet" }),
      ]),
      el("div", { class: "header-actions" }, [
        makeThemeToggle(),
        headerEmail,
        el(
          "button",
          {
            class: "btn btn-ghost btn-small",
            attrs: { id: "logout-btn", title: "Sign out" },
            on: { click: () => onSignOut?.() },
          },
          "Sign out"
        ),
      ]),
    ]),
  ]);

  // ----- Search -----
  const searchInput = el("input", {
    type: "search",
    placeholder: "Search entries…",
    class: "search-input",
    autocomplete: "off",
  });
  searchInput.id = "timeline-search";
  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    paint();
  });

  const search = el("div", { class: "search-row" }, searchInput);

  // ----- Content area -----
  const content = el("div", { class: "timeline-content", attrs: { id: "timeline-content" } });

  // ----- FAB -----
  const fab = el(
    "button",
    {
      class: "fab",
      attrs: { id: "new-entry-fab", "aria-label": "New entry", title: "New entry" },
      on: { click: () => onNewEntry?.() },
    },
    [
      el("span", { class: "fab-plus", text: "+" }),
      el("span", { class: "fab-label", text: "New entry" }),
    ]
  );

  // ----- Compose root -----
  root.replaceChildren(
    el("div", { class: "app-shell" }, [
      header,
      el("main", { class: "app-main" }, [search, content]),
      fab,
    ])
  );

  paint();
  load();

  function load() {
    loading = true;
    errorMsg = "";
    paint();
    db.listEntries()
      .then(({ data, error }) => {
        loading = false;
        if (error) {
          errorMsg = error.message || "Could not load entries.";
        } else {
          allEntries = data || [];
        }
        paint();
      })
      .catch((e) => {
        loading = false;
        errorMsg = e?.message || "Could not load entries.";
        paint();
      });
  }

  function paint() {
    if (loading) {
      content.replaceChildren(
        el("div", { class: "state state-loading", text: "Loading your journal…" })
      );
      return;
    }
    if (errorMsg) {
      content.replaceChildren(
        el("div", { class: "state state-error", text: errorMsg })
      );
      return;
    }

    const term = searchTerm;
    const filtered = term
      ? allEntries.filter((e) => {
          const t = (e.title || "").toLowerCase();
          const b = (e.body || "").toLowerCase();
          return t.includes(term) || b.includes(term);
        })
      : allEntries;

    if (filtered.length === 0) {
      content.replaceChildren(
        el("div", { class: "state state-empty" }, [
          el("p", { class: "state-title", text: term ? "No matches" : "No entries yet" }),
          el(
            "p",
            {
              class: "state-sub",
              text: term
                ? "Try a different search term, or clear the search to see everything."
                : "Tap the + button to write your first one.",
            }
          ),
        ])
      );
      return;
    }

    // Resolve all image paths to signed URLs in one batch so cards
    // render images without each one triggering its own network call.
    // We only request paths we don't already have, and we guard with an
    // epoch so an older in-flight signing doesn't repaint after the
    // user has moved on (e.g. clicked an entry).
    const allPaths = filtered
      .flatMap((e) => (Array.isArray(e.image_paths) ? e.image_paths : []))
      .filter(Boolean);
    const myEpoch = ++paintEpoch;
    if (allPaths.length > 0 && !isMockMode) {
      const need = allPaths.filter((p) => !signedUrlByPath.has(p) && !signingInFlight.has(p));
      if (need.length > 0) {
        for (const p of need) signingInFlight.add(p);
        signImagePaths(need)
          .then((signed) => {
            for (const p of need) signingInFlight.delete(p);
            for (const { path, url } of signed) signedUrlByPath.set(path, url);
            if (myEpoch === paintEpoch) paint();
          })
          .catch(() => {
            for (const p of need) signingInFlight.delete(p);
            if (myEpoch === paintEpoch) paint();
          });
      }
    }

    // Group by entry_date
    const groups = new Map();
    for (const entry of filtered) {
      const key = entry.entry_date || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }

    const frag = document.createDocumentFragment();
    for (const [dateKey, items] of groups) {
      frag.appendChild(
        el("section", { class: "day-group", attrs: { "data-date": dateKey } }, [
          el("h2", { class: "day-header", text: formatDateHeader(dateKey) }),
          el(
            "ul",
            { class: "entry-list" },
            items.map((entry) => renderEntryCard(entry, signedUrlByPath))
          ),
        ])
      );
    }
    content.replaceChildren(frag);
  }

  function renderEntryCard(entry, signedByPath) {
    const mood =
      Number.isFinite(entry.mood) && entry.mood >= 1 && entry.mood <= 5
        ? MOOD_EMOJI[entry.mood]
        : "";
    const title = entry.title?.trim() || "Untitled";

    const titleEl = el("h3", { class: "entry-title", text: title });

    // Full markdown body — the user asked for the full entry on the
    // timeline, so no line-clamp here. Cards can get long, that's fine.
    const bodyEl = el("div", {
      class: "entry-body markdown-body",
    });
    renderMarkdownToHtml(entry.body || "").then((html) => {
      bodyEl.innerHTML = html;
    });

    // Image strip — show all images, up to 6 inline, with a "+N" if more.
    const paths = Array.isArray(entry.image_paths) ? entry.image_paths : [];
    let thumbs = null;
    if (paths.length > 0) {
      thumbs = el("div", { class: "entry-thumbs" });
      for (const p of paths.slice(0, 6)) {
        const url = signedByPath.get(p);
        if (!url) continue;
        thumbs.appendChild(
          el("img", {
            class: "entry-thumb",
            attrs: {
              src: url,
              alt: "",
              loading: "lazy",
              referrerpolicy: "no-referrer",
            },
          })
        );
      }
      if (paths.length > 6) {
        thumbs.appendChild(
          el("span", {
            class: "entry-thumb-more",
            text: `+${paths.length - 6}`,
          })
        );
      }
    }

    const meta = el("div", { class: "entry-meta" }, [
      mood
        ? el("span", {
            class: "entry-mood",
            text: mood,
            attrs: { "aria-label": `Mood ${entry.mood}/5` },
          })
        : null,
      el("span", { class: "entry-date-text", text: entry.entry_date || "" }),
    ]);

    // Card actions: Edit and Delete. Each stops propagation so the
    // body-click that opens the reader doesn't fire too.
    const editBtn = el(
      "button",
      {
        class: "btn btn-ghost btn-small",
        attrs: { type: "button", "aria-label": `Edit entry: ${title}`, title: "Edit" },
        on: {
          click: (ev) => {
            ev.stopPropagation();
            onEditEntry?.(entry.id);
          },
        },
      },
      "Edit"
    );
    const deleteBtn = el(
      "button",
      {
        class: "btn btn-danger btn-small",
        attrs: { type: "button", "aria-label": `Delete entry: ${title}`, title: "Delete" },
        on: {
          click: (ev) => {
            ev.stopPropagation();
            onDeleteEntry?.(entry.id);
          },
        },
      },
      "Delete"
    );
    const actions = el("div", { class: "entry-actions" }, [editBtn, deleteBtn]);

    // Build the card. The whole card is a click target for the reader;
    // the action buttons inside stop propagation so they don't.
    const cardChildren = [titleEl];
    if (thumbs && thumbs.childNodes.length > 0) cardChildren.push(thumbs);
    cardChildren.push(bodyEl);
    const metaAndActions = el("div", { class: "entry-meta-row" }, [meta, actions]);
    cardChildren.push(metaAndActions);

    const card = el(
      "li",
      {
        class: "entry-card",
        attrs: {
          "data-entry-id": entry.id,
          tabindex: "0",
          role: "button",
          "aria-label": `Read entry: ${title}`,
        },
        on: {
          click: () => onOpenEntry?.(entry.id),
          keydown: (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              // Don't hijack Enter inside form fields (e.g. the search box).
              const tag = (ev.target && ev.target.tagName) || "";
              if (tag === "INPUT" || tag === "TEXTAREA") return;
              ev.preventDefault();
              onOpenEntry?.(entry.id);
            }
          },
        },
      },
      cardChildren
    );
    return card;
  }

  // Re-paint whenever the route returns here (the caller can do that
  // by calling renderTimelineView again, but for now the initial load
  // is sufficient).
}
