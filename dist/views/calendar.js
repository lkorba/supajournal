// views/calendar.js
// ------------------------------------------------------------------
// Month-grid calendar view. Shows the current month (or whichever
// month the user is viewing) with a dot for each day that has at
// least one entry. Click a day to expand the entries inline.
// ------------------------------------------------------------------

import { db } from "../db.js";
import { makeThemeToggle } from "../theme.js";
import { journalState } from "../journal-state.js";
import { renderMarkdownToHtml } from "../markdown.js";
import { signImagePaths } from "../images.js";
import { isMockMode } from "../config.js";

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
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoFor(y, m, d) {
  // m is 0-indexed; d is 1-indexed. Build a local YYYY-MM-DD.
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthLabel(d) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function renderCalendarView(root, {
  userId,
  userEmail,
  onBack,
  onOpenEntry,
  onNewEntry,
  onSignOut,
}) {
  let entries = [];
  let loading = true;
  let errorMsg = "";
  // The day currently expanded inline (YYYY-MM-DD), or null.
  let expandedDay = null;
  // The month being viewed. Default: today.
  let viewMonth = startOfMonth(new Date());

  // Signed URL cache (same pattern as the timeline).
  const signedUrlByPath = new Map();
  const signingInFlight = new Set();
  let paintEpoch = 0;
  let loadEpoch = 0;

  // ----- Header -----
  const header = el("header", { class: "app-header" }, [
    el("div", { class: "app-header-inner" }, [
      el(
        "button",
        {
          class: "btn btn-ghost btn-small",
          attrs: { id: "cal-back", "aria-label": "Back to timeline" },
          on: { click: () => onBack?.() },
        },
        "← Back"
      ),
      el("div", { class: "brand brand-small" }, [
        el("div", { class: "brand-mark", text: "✦" }),
        el("div", { class: "brand-name", text: "Quiet" }),
      ]),
      el("div", { class: "header-actions" }, [
        makeThemeToggle(),
        el("span", { class: "header-email", text: userEmail || "" }),
        el(
          "button",
          {
            class: "btn btn-ghost btn-small",
            attrs: { id: "cal-signout", title: "Sign out" },
            on: { click: () => onSignOut?.() },
          },
          "Sign out"
        ),
      ]),
    ]),
  ]);

  // ----- Month nav -----
  const monthLabelEl = el("h1", { class: "cal-month-label" });
  const prevBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "cal-prev", "aria-label": "Previous month", title: "Previous month" },
      on: { click: () => {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
        paint();
      } },
    },
    "←"
  );
  const nextBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "cal-next", "aria-label": "Next month", title: "Next month" },
      on: { click: () => {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
        paint();
      } },
    },
    "→"
  );
  const todayBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "cal-today", title: "Jump to today" },
      on: { click: () => {
        viewMonth = startOfMonth(new Date());
        paint();
      } },
    },
    "Today"
  );
  const newBtn = el(
    "button",
    {
      class: "btn btn-primary btn-small",
      attrs: { id: "cal-new", title: "New entry" },
      on: { click: () => onNewEntry?.() },
    },
    "+ New"
  );

  const monthNav = el("div", { class: "cal-month-nav" }, [
    prevBtn,
    monthLabelEl,
    nextBtn,
    todayBtn,
    newBtn,
  ]);

  // ----- Weekday header -----
  const weekdayHeader = el("div", { class: "cal-weekdays" },
    WEEKDAY_LABELS.map((d) =>
      el("div", { class: "cal-weekday", text: d })
    )
  );

  // ----- Grid container (filled by paint) -----
  const grid = el("div", { class: "cal-grid" });
  const detailPanel = el("div", { class: "cal-day-detail" });
  const errorEl = el("div", { class: "auth-error", attrs: { id: "cal-error" } });
  const loadingEl = el("div", { class: "state state-loading", text: "Loading calendar…" });

  // ----- Compose -----
  root.replaceChildren(
    el("div", { class: "app-shell" }, [
      header,
      el("main", { class: "app-main" }, [
        monthNav,
        weekdayHeader,
        grid,
        detailPanel,
        errorEl,
      ]),
    ])
  );

  load();
  paint();

  function setError(msg) {
    errorMsg = msg || "";
    errorEl.textContent = errorMsg;
    errorEl.classList.toggle("visible", Boolean(errorMsg));
  }

  function load() {
    loading = true;
    setError("");
    const myEpoch = ++loadEpoch;
    // Fetch all entries (filtered by current active journal, if any).
    // We use a wide range to cover everything for the visible month +
    // the surrounding few weeks so the dots reflect actual entries.
    db.listEntries({ journalId: journalState.getActiveJournalId() || null })
      .then(({ data, error }) => {
        if (myEpoch !== loadEpoch) return;
        loading = false;
        if (error) {
          setError(error.message || "Could not load entries.");
          return paint();
        }
        entries = data || [];
        paint();
      })
      .catch((e) => {
        if (myEpoch !== loadEpoch) return;
        loading = false;
        setError(e?.message || "Could not load entries.");
        paint();
      });
  }

  function paint() {
    if (loading) {
      grid.replaceChildren(loadingEl);
      detailPanel.replaceChildren();
      return;
    }
    monthLabelEl.textContent = monthLabel(viewMonth);

    // Group entries by entry_date.
    const byDate = new Map();
    for (const e of entries) {
      const key = e.entry_date;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(e);
    }

    // Sign image paths for the currently expanded day, if any.
    const expandedEntries = expandedDay ? (byDate.get(expandedDay) || []) : [];
    const allPaths = expandedEntries
      .flatMap((e) => (Array.isArray(e.image_paths) ? e.image_paths : []))
      .filter(Boolean);
    const myEpoch = ++paintEpoch;
    if (allPaths.length > 0 && !isMockMode) {
      const need = allPaths.filter(
        (p) => !signedUrlByPath.has(p) && !signingInFlight.has(p)
      );
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

    // Build the month grid. Week starts on Sunday (US-style); the
    // first row may be padded with cells from the prior month, which
    // are dimmed and not clickable.
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const cells = [];
    // Leading blanks from previous month.
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ key: null, day: null, blank: true });
    }
    // Days in this month.
    const todayIso = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoFor(y, m, d);
      const dayEntries = byDate.get(iso) || [];
      cells.push({
        key: iso,
        day: d,
        iso,
        isToday: iso === todayIso,
        isExpanded: iso === expandedDay,
        entries: dayEntries,
        blank: false,
      });
    }
    // Pad to a multiple of 7.
    while (cells.length % 7 !== 0) {
      cells.push({ key: null, day: null, blank: true });
    }

    grid.replaceChildren(
      el(
        "div",
        { class: "cal-cells" },
        cells.map(renderCell)
      )
    );

    if (expandedDay) {
      detailPanel.replaceChildren(renderDayDetail(byDate.get(expandedDay) || [], expandedDay));
    } else {
      detailPanel.replaceChildren();
    }
  }

  function renderCell(cell) {
    if (cell.blank) {
      return el("div", { class: "cal-cell cal-cell-blank" });
    }
    const node = el(
      "div",
      {
        class:
          "cal-cell" +
          (cell.isToday ? " is-today" : "") +
          (cell.isExpanded ? " is-expanded" : "") +
          (cell.entries.length > 0 ? " has-entries" : ""),
        attrs: { "data-iso": cell.iso },
      },
      [
        el("div", { class: "cal-cell-day", text: String(cell.day) }),
        cell.entries.length > 0
          ? el("div", { class: "cal-cell-dots" }, [
              el("span", {
                class: "cal-cell-count",
                text: cell.entries.length > 9 ? "9+" : String(cell.entries.length),
              }),
            ])
          : null,
      ]
    );
    node.addEventListener("click", () => {
      expandedDay = expandedDay === cell.iso ? null : cell.iso;
      paint();
    });
    return node;
  }

  function renderDayDetail(items, iso) {
    const [yy, mm, dd] = iso.split("-").map(Number);
    const date = new Date(yy, mm - 1, dd);
    const niceDate = date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });

    const wrap = el("section", { class: "cal-day-detail-inner" }, [
      el("div", { class: "cal-day-detail-head" }, [
        el("h2", { class: "cal-day-detail-title", text: niceDate }),
        el("button", {
          class: "btn btn-ghost btn-small",
          attrs: { id: "cal-day-close", type: "button" },
          on: { click: () => { expandedDay = null; paint(); } },
          text: "Close",
        }),
      ]),
    ]);

    if (items.length === 0) {
      wrap.appendChild(
        el("p", {
          class: "cal-day-detail-empty",
          text: "No entries on this day.",
        })
      );
      return wrap;
    }

    const list = el("ul", { class: "entry-list entry-list-cal" });
    for (const entry of items) list.appendChild(renderEntryRow(entry));
    wrap.appendChild(list);
    return wrap;
  }

  function renderEntryRow(entry) {
    const mood =
      Number.isFinite(entry.mood) && entry.mood >= 1 && entry.mood <= 5
        ? MOOD_EMOJI[entry.mood]
        : "";
    const title = entry.title?.trim() || "Untitled";

    const titleEl = el("h3", { class: "entry-title", text: title });
    const bodyEl = el("div", { class: "entry-body markdown-body" });
    renderMarkdownToHtml(entry.body || "").then((html) => {
      bodyEl.innerHTML = html;
    });

    const meta = el("div", { class: "entry-meta" }, [
      mood
        ? el("span", {
            class: "entry-mood",
            text: mood,
            attrs: { "aria-label": `Mood ${entry.mood}/5` },
          })
        : null,
    ]);

    const openBtn = el(
      "button",
      {
        class: "btn btn-ghost btn-small",
        type: "button",
        on: { click: () => onOpenEntry?.(entry.id) },
        text: "Open"
    });

    return el(
      "li",
      {
        class: "entry-card entry-card-compact",
        attrs: { "data-entry-id": entry.id },
      },
      [titleEl, bodyEl, el("div", { class: "entry-meta-row" }, [meta, openBtn])]
    );
  }
}
