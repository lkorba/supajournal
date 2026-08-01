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
import { journalState } from "../journal-state.js";
import { pickPromptOfTheDay } from "../prompts-state.js";

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
  userId: userIdProp,
  onOpenEntry,
  onEditEntry,
  onDeleteEntry,
  onNewEntry,
  onSignOut,
  onManageJournals,
  onOpenCalendar,
  userEmail,
}) {
  let allEntries = [];
  let journals = [];
  let allTags = [];
  let promptOfTheDay = null;
  let searchTerm = "";
  let activeJournalId = journalState.getActiveJournalId();
  let activeTagId = null;
  let onlyBookmarked = false;
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
  let loadEpoch = 0;

  // ----- Header -----
  const headerEmail = el("span", {
    class: "header-email",
    text: userEmail || "",
  });
  headerEmail.id = "header-email";

  // Journal switcher: a <select> is the simplest accessible dropdown
  // that works on every platform. It also fits the warm, minimal look
  // of the app when styled correctly.
  const journalSelect = el("select", {
    class: "journal-switcher",
    attrs: { id: "journal-switcher", "aria-label": "Filter by journal" },
  });
  // The "All" option is added after we know the user's journal list.
  journalSelect.appendChild(
    el("option", { attrs: { value: "" }, text: "All journals" })
  );
  journalSelect.addEventListener("change", () => {
    const v = journalSelect.value || null;
    activeJournalId = v;
    journalState.setActiveJournalId(v);
    load();
  });

  const tagSelect = el("select", {
    class: "journal-switcher",
    attrs: { id: "tag-switcher", "aria-label": "Filter by tag" },
  });
  tagSelect.appendChild(
    el("option", { attrs: { value: "" }, text: "All tags" })
  );
  tagSelect.addEventListener("change", () => {
    activeTagId = tagSelect.value || null;
    load();
  });

  // Bookmarks-only toggle. Simple pressed/unpressed button — no
  // separate view required, just a filter applied to listEntries.
  const bookmarkToggle = el(
    "button",
    {
      class: "btn btn-ghost btn-small bookmark-toggle",
      attrs: {
        id: "bookmark-toggle",
        type: "button",
        title: "Show bookmarked entries only",
        "aria-pressed": "false",
      },
      on: { click: () => {
        onlyBookmarked = !onlyBookmarked;
        bookmarkToggle.classList.toggle("is-active", onlyBookmarked);
        bookmarkToggle.setAttribute("aria-pressed", onlyBookmarked ? "true" : "false");
        load();
      } },
    },
    "★ Bookmarks"
  );

  const manageJournalsBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "manage-journals-btn", title: "Manage journals" },
      on: { click: () => onManageJournals?.() },
    },
    "⚙ Journals"
  );

  const calendarBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "open-calendar-btn", title: "Open calendar" },
      on: { click: () => onOpenCalendar?.() },
    },
    "📅 Calendar"
  );

  const header = el("header", { class: "app-header" }, [
    el("div", { class: "app-header-inner" }, [
      el("div", { class: "brand brand-small" }, [
        el("div", { class: "brand-mark", text: "✦" }),
        el("div", { class: "brand-name", text: "Quiet" }),
      ]),
      el("div", { class: "header-journal-bar" }, [
        journalSelect,
        tagSelect,
        bookmarkToggle,
        calendarBtn,
        manageJournalsBtn,
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
    const myEpoch = ++loadEpoch;
    Promise.all([
      db.listJournals(userId()),
      db.listTags(userId()),
      db.listEntries({
        journalId: journalState.getActiveJournalId() || null,
        tagId: activeTagId,
        onlyBookmarked: onlyBookmarked,
      }),
      db.listPrompts(),
    ])
      .then(([jRes, tRes, eRes, pRes]) => {
        if (myEpoch !== loadEpoch) return; // a newer load started; drop
        loading = false;
        if (jRes.error) {
          errorMsg = jRes.error.message || "Could not load journals.";
          return paint();
        }
        journals = jRes.data || [];
        journalState.setCachedJournals(journals);
        rebuildJournalSelect();
        if (!tRes.error) {
          allTags = tRes.data || [];
          rebuildTagSelect();
        }
        if (eRes.error) {
          errorMsg = eRes.error.message || "Could not load entries.";
        } else {
          allEntries = eRes.data || [];
        }
        if (!pRes.error) {
          promptOfTheDay = pickPromptOfTheDay(pRes.data || []);
        }
        paint();
      })
      .catch((e) => {
        if (myEpoch !== loadEpoch) return;
        loading = false;
        errorMsg = e?.message || "Could not load entries.";
        paint();
      });
  }

  function userId() {
    return userIdProp || null;
  }

  function rebuildJournalSelect() {
    // Remember current value before rebuilding.
    const current = journalSelect.value || "";
    journalSelect.replaceChildren();
    journalSelect.appendChild(
      el("option", { attrs: { value: "" }, text: "All journals" })
    );
    for (const j of journals) {
      const opt = el("option", { attrs: { value: j.id } }, [
        el("span", { text: (j.icon || "📓") + " " }),
        el("span", { text: j.name }),
      ]);
      // The select can only render text content, so we set the option
      // text directly with the icon as a prefix.
      opt.textContent = `${j.icon || "📓"}  ${j.name}`;
      journalSelect.appendChild(opt);
    }
    // Restore the active selection (or default to active journal id).
    const wanted = journalState.getActiveJournalId() || "";
    if (wanted && journals.some((j) => j.id === wanted)) {
      journalSelect.value = wanted;
    } else {
      journalSelect.value = "";
      if (wanted) journalState.setActiveJournalId(null);
    }
  }

  function rebuildTagSelect() {
    tagSelect.replaceChildren();
    tagSelect.appendChild(
      el("option", { attrs: { value: "" }, text: "All tags" })
    );
    for (const t of allTags) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = "#" + t.name;
      tagSelect.appendChild(opt);
    }
    // Keep the active selection if the tag still exists.
    if (activeTagId && allTags.some((t) => t.id === activeTagId)) {
      tagSelect.value = activeTagId;
    } else {
      tagSelect.value = "";
      activeTagId = null;
    }
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
      const empty = el("div", { class: "state state-empty" }, [
        el("p", { class: "state-title", text: term ? "No matches" : "No entries yet" }),
        el("p", {
          class: "state-sub",
          text: term
            ? "Try a different search term, or clear the search to see everything."
            : "Tap the + button to write your first one.",
        }),
      ]);
      // If the user has no entries at all (regardless of search),
      // show the prompt of the day as inspiration.
      if (!term && allEntries.length === 0 && promptOfTheDay) {
        empty.appendChild(
          el("div", { class: "prompt-of-the-day" }, [
            el("p", { class: "prompt-label", text: "Today's prompt" }),
            el("p", { class: "prompt-text", text: promptOfTheDay.text }),
            el("button", {
              class: "btn btn-primary btn-small",
              type: "button",
              attrs: { id: "prompt-write-btn" },
              on: { click: () => onNewEntry?.() },
              text: "Start writing",
            }),
          ])
        );
      }
      content.replaceChildren(empty);
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

    // Stats card at the top: total entries, total words, days with
    // entries, current writing streak. Cheap to compute from the
    // already-loaded list; no extra round-trip.
    if (!term && allEntries.length > 0) {
      frag.appendChild(renderStatsCard(allEntries));
    }

    // "On This Day" section: entries from past years whose month+day
    // matches today. Only shown when there are any (and only on the
    // main timeline — i.e. when no search is active and the date
    // group for today is visible). We deliberately exclude today's
    // entries; the user is already looking at those.
    if (!term && !onlyBookmarked) {
      const onThisDay = collectOnThisDay(allEntries);
      if (onThisDay.length > 0) {
        frag.appendChild(renderOnThisDaySection(onThisDay, signedUrlByPath));
      }
    }

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

  // Collect entries from past years with the same MM-DD as today.
  // Returns them sorted oldest -> newest so the "time jump" feels
  // like scrolling through a memory reel.
  function collectOnThisDay(entries) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayIso = now.toISOString().slice(0, 10);
    const yyyy = now.getFullYear();
    const out = [];
    for (const e of entries) {
      if (!e.entry_date || typeof e.entry_date !== "string") continue;
      if (e.entry_date === todayIso) continue; // today — already shown above
      // entry_date is YYYY-MM-DD
      const parts = e.entry_date.split("-");
      if (parts.length !== 3) continue;
      const [ey, emm, edd] = parts;
      if (emm !== mm || edd !== dd) continue;
      if (Number(ey) >= yyyy) continue;
      out.push(e);
    }
    out.sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    return out;
  }

  function renderOnThisDaySection(items, signedByPath) {
    const section = el("section", {
      class: "on-this-day",
      attrs: { "data-on-this-day": "1" },
    });
    section.appendChild(
      el("h2", {
        class: "on-this-day-title",
        text: "🕰 On This Day",
      })
    );
    section.appendChild(
      el("p", {
        class: "on-this-day-sub",
        text: `Entries you wrote on this day in past years.`,
      })
    );
    const list = el("ul", { class: "entry-list on-this-day-list" });
    for (const entry of items) {
      list.appendChild(renderOnThisDayCard(entry, signedByPath));
    }
    section.appendChild(list);
    return section;
  }

  function renderStatsCard(entries) {
    // Compute a few simple stats client-side. No server round-trip.
    const totalEntries = entries.length;
    let totalWords = 0;
    const daySet = new Set();
    for (const e of entries) {
      const wc = Number.isFinite(e.word_count) ? e.word_count : countWords(e.body || "");
      totalWords += wc;
      if (e.entry_date) daySet.add(e.entry_date);
    }
    const totalDays = daySet.size;
    const streak = computeStreak(daySet);
    const card = el("section", { class: "stats-card", attrs: { id: "stats-card" } });
    card.appendChild(
      el("h2", { class: "stats-title", text: "Your writing" })
    );
    const grid = el("div", { class: "stats-grid" });
    grid.appendChild(
      statBlock("Entries", String(totalEntries))
    );
    grid.appendChild(
      statBlock("Words", formatBigNumber(totalWords))
    );
    grid.appendChild(
      statBlock("Days written", String(totalDays))
    );
    grid.appendChild(
      statBlock("Streak", streak > 0 ? `${streak} day${streak === 1 ? "" : "s"}` : "—")
    );
    card.appendChild(grid);
    return card;
  }

  function statBlock(label, value) {
    return el("div", { class: "stat-block" }, [
      el("div", { class: "stat-value", text: value }),
      el("div", { class: "stat-label", text: label }),
    ]);
  }

  function countWords(s) {
    const t = String(s || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function formatBigNumber(n) {
    if (n < 1000) return String(n);
    if (n < 10000) return (n / 1000).toFixed(1) + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1) + "M";
  }

  function computeStreak(daySet) {
    // Walk back from today; count consecutive days that have an entry.
    // Breaks on the first missing day. Today not being in the set
    // doesn't break the streak — it just makes the current value
    // 0 (we don't count today as "still going" if nothing was
    // written yet today).
    if (daySet.size === 0) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ymd = (d) => d.toISOString().slice(0, 10);
    // If today is missing, the streak is "broken" for today but
    // yesterday may still count. We treat that as 0 (no active
    // streak) — DayOne does the same.
    if (!daySet.has(ymd(today))) return 0;
    let count = 0;
    let cursor = new Date(today);
    while (daySet.has(ymd(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function renderOnThisDayCard(entry, signedByPath) {
    // Compact card: year tag + title + a body preview. Click anywhere
    // to open the reader. We deliberately do NOT use the full
    // renderEntryCard so the visual is quieter and the section
    // stays scannable.
    const year = (entry.entry_date || "").slice(0, 4) || "—";
    const title = entry.title?.trim() || "Untitled";
    const preview = truncate(entry.body || "", 220);

    const titleEl = el("h3", { class: "on-this-day-card-title" }, [
      el("span", { class: "on-this-day-year", text: year }),
      el("span", { class: "on-this-day-title-text", text: title }),
    ]);
    const bodyEl = el("div", { class: "on-this-day-card-body", text: preview });

    return el(
      "li",
      {
        class: "on-this-day-card",
        attrs: {
          "data-entry-id": entry.id,
          tabindex: "0",
          role: "button",
          "aria-label": `Read entry from ${year}: ${title}`,
        },
        on: {
          click: () => onOpenEntry?.(entry.id),
          keydown: (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onOpenEntry?.(entry.id);
            }
          },
        },
      },
      [titleEl, bodyEl]
    );
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
    // Bookmark star — small icon button on the card. Toggle updates
    // the entry in place, then mutates the local list + repaints
    // (without re-fetching from the server, which would re-sign every
    // image and feel slow).
    const isBookmarked = !!entry.is_bookmarked;
    const starBtn = el(
      "button",
      {
        class: "btn btn-ghost btn-small star-btn" + (isBookmarked ? " is-on" : ""),
        attrs: {
          type: "button",
          "aria-label": (isBookmarked ? "Unbookmark" : "Bookmark") + ` ${title}`,
          "aria-pressed": isBookmarked ? "true" : "false",
          title: isBookmarked ? "Remove bookmark" : "Bookmark this entry",
        },
        on: {
          click: async (ev) => {
            ev.stopPropagation();
            const before = !!entry.is_bookmarked;
            // Optimistic flip: update the local entry + button so the
            // user gets instant feedback, then sync with the server.
            entry.is_bookmarked = !before;
            starBtn.classList.toggle("is-on", !before);
            starBtn.setAttribute("aria-pressed", !before ? "true" : "false");
            starBtn.setAttribute("aria-label",
              (!before ? "Unbookmark" : "Bookmark") + ` ${title}`);
            starBtn.setAttribute("title",
              !before ? "Remove bookmark" : "Bookmark this entry");
            const { data, error } = await db.toggleBookmark(entry.id);
            if (error) {
              // Roll back the optimistic update on error.
              entry.is_bookmarked = before;
              starBtn.classList.toggle("is-on", before);
              starBtn.setAttribute("aria-pressed", before ? "true" : "false");
              window.alert(error.message || "Couldn't update bookmark.");
              return;
            }
            if (data) entry.is_bookmarked = data.is_bookmarked;
            // If we're filtering to bookmarks and we just unbookmarked
            // an entry, refresh so it disappears.
            if (onlyBookmarked && before) load();
          },
        },
      },
      isBookmarked ? "★" : "☆"
    );
    const actions = el("div", { class: "entry-actions" }, [starBtn, editBtn, deleteBtn]);

    // Build the card. The whole card is a click target for the reader;
    // the action buttons inside stop propagation so they don't.
    const cardChildren = [titleEl];
    if (thumbs && thumbs.childNodes.length > 0) cardChildren.push(thumbs);
    // Tag chips row (if any). Click a chip to filter the timeline by
    // that tag — small but useful affordance.
    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
      const tagRow = el("div", { class: "tag-chip-row tag-chip-row-card" });
      for (const t of entry.tags) {
        const chip = el(
          "button",
          {
            type: "button",
            class: "tag-chip tag-chip-clickable",
            attrs: { "data-tag-id": t.id, title: `Filter by #${t.name}` },
            on: {
              click: (ev) => {
                ev.stopPropagation();
                activeTagId = t.id;
                tagSelect.value = t.id;
                load();
              },
            },
          },
          "#" + t.name
        );
        tagRow.appendChild(chip);
      }
      cardChildren.push(tagRow);
    }
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
