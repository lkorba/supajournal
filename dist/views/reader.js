// views/reader.js
// ------------------------------------------------------------------
// Reader view: read-only display of a single journal entry.
// Shows the title, full markdown body, all images, mood, date.
// Header has a "Back" link and an "Edit" button. Delete lives in the
// footer for destructive actions to require a deliberate scroll.
// ------------------------------------------------------------------

import { db } from "../db.js";
import { renderMarkdownToHtml } from "../markdown.js";
import { signImagePaths, deleteImage } from "../images.js";
import { isMockMode } from "../config.js";
import { makeThemeToggle } from "../theme.js";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "on") {
      for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    } else if (k === "attrs") {
      for (const [ak, av] of Object.entries(v)) node.setAttribute(ak, av);
    } else if (k === "checked") {
      node.checked = !!v;
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

function formatDateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function renderReaderView(root, { entryId, onBack, onEdit, onDeleted }) {
  let entry = null;
  let loading = true;
  let errorMsg = "";
  let busy = false;
  // Signed URLs for attached images, keyed by storage path.
  const signedUrlByPath = new Map();

  // ----- Header -----
  const backBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "reader-back", "aria-label": "Back to timeline" },
      on: { click: () => onBack?.() },
    },
    "← Back"
  );

  const editBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "reader-edit", title: "Edit this entry" },
      on: { click: () => onEdit?.(entryId) },
    },
    "Edit"
  );

  const header = el("header", { class: "app-header" }, [
    el("div", { class: "app-header-inner" }, [
      backBtn,
      el("div", { class: "brand brand-small" }, [
        el("div", { class: "brand-mark", text: "✦" }),
        el("div", { class: "brand-name", text: "Quiet" }),
      ]),
      el("div", { class: "header-actions" }, [makeThemeToggle(), editBtn]),
    ]),
  ]);

  const content = el("main", {
    class: "app-main reader-main",
    attrs: { id: "reader-content" },
  });

  root.replaceChildren(
    el("div", { class: "app-shell" }, [header, content])
  );

  paintLoading();
  load();

  function load() {
    db.getEntry(entryId)
      .then(async ({ data, error }) => {
        loading = false;
        if (error || !data) {
          errorMsg = "Couldn't load that entry.";
          paintError();
          return;
        }
        entry = data;
        if (Array.isArray(entry.image_paths) && entry.image_paths.length > 0 && !isMockMode) {
          try {
            const signed = await signImagePaths(entry.image_paths);
            for (const { path, url } of signed) signedUrlByPath.set(path, url);
          } catch (_) { /* ok, images will show as broken placeholders */ }
        }
        paint();
      })
      .catch((e) => {
        loading = false;
        errorMsg = e?.message || "Couldn't load that entry.";
        paintError();
      });
  }

  function paintLoading() {
    content.replaceChildren(
      el("div", { class: "state state-loading", text: "Loading entry…" })
    );
  }

  function paintError() {
    content.replaceChildren(
      el("div", { class: "state state-error" }, [
        el("p", { class: "state-title", text: errorMsg || "Something went wrong." }),
        el("button", {
          class: "btn btn-ghost btn-small",
          attrs: { type: "button" },
          on: { click: () => onBack?.() },
          text: "Back to timeline",
        }),
      ])
    );
  }

  function paint() {
    if (!entry) return;
    const mood =
      Number.isFinite(entry.mood) && entry.mood >= 1 && entry.mood <= 5
        ? MOOD_EMOJI[entry.mood]
        : "";
    const title = entry.title?.trim() || "Untitled";

    // Title block: title, then date + mood on a meta line.
    const titleEl = el("h1", { class: "reader-title", text: title });

    // Star button — bookmark/unbookmark the entry from the reader.
    const isBookmarked = !!entry.is_bookmarked;
    const starBtn = el(
      "button",
      {
        class: "btn btn-ghost btn-small star-btn" + (isBookmarked ? " is-on" : ""),
        attrs: {
          type: "button",
          id: "reader-star",
          "aria-label": isBookmarked ? "Unbookmark" : "Bookmark",
          "aria-pressed": isBookmarked ? "true" : "false",
          title: isBookmarked ? "Remove bookmark" : "Bookmark this entry",
        },
        on: {
          click: async () => {
            const before = !!entry.is_bookmarked;
            entry.is_bookmarked = !before;
            starBtn.classList.toggle("is-on", !before);
            starBtn.setAttribute("aria-pressed", !before ? "true" : "false");
            const { data, error } = await db.toggleBookmark(entry.id);
            if (error) {
              entry.is_bookmarked = before;
              starBtn.classList.toggle("is-on", before);
              window.alert(error.message || "Couldn't update bookmark.");
              return;
            }
            if (data) entry.is_bookmarked = data.is_bookmarked;
          },
        },
      },
      isBookmarked ? "★ Bookmarked" : "☆ Bookmark"
    );

    const meta = el("div", { class: "reader-meta" }, [
      el("span", { class: "reader-date", text: formatDateLong(entry.entry_date) }),
      mood
        ? el("span", {
            class: "reader-mood",
            text: mood,
            attrs: { "aria-label": `Mood ${entry.mood}/5` },
          })
        : null,
      starBtn,
    ]);

    // Full markdown body — no line clamp here, render the whole thing.
    const bodyEl = el("div", { class: "reader-body markdown-body", attrs: { id: "reader-body" } });
    renderMarkdownToHtml(entry.body || "").then((html) => {
      bodyEl.innerHTML = html;
    });

    // Image gallery — large thumbnails, click to open full size in a new tab.
    const paths = Array.isArray(entry.image_paths) ? entry.image_paths : [];
    let gallery = null;
    if (paths.length > 0) {
      gallery = el("div", { class: "reader-gallery" });
      for (const p of paths) {
        const url = signedUrlByPath.get(p);
        if (!url) continue;
        const a = el("a", {
          class: "reader-gallery-item",
          attrs: { href: url, target: "_blank", rel: "noopener noreferrer" },
        });
        a.appendChild(
          el("img", {
            attrs: {
              src: url,
              alt: "",
              loading: "lazy",
              referrerpolicy: "no-referrer",
            },
          })
        );
        gallery.appendChild(a);
      }
    }

    // Tag chips — shown above the body if any tags are set.
    let tagRow = null;
    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
      tagRow = el("div", { class: "tag-chip-row tag-chip-row-read" },
        entry.tags.map((t) =>
          el("span", { class: "tag-chip tag-chip-static" }, [
            el("span", { class: "tag-chip-name", text: "#" + t.name }),
          ])
        )
      );
    }

    // Footer actions: Edit, Delete.
    const footer = el("div", { class: "reader-footer" }, [
      el("button", {
        class: "btn btn-ghost",
        attrs: { type: "button" },
        on: { click: () => onEdit?.(entryId) },
        text: "Edit",
      }),
      el("button", {
        class: "btn btn-danger",
        attrs: { type: "button", id: "reader-delete" },
        on: { click: remove },
        text: "Delete",
      }),
    ]);

    const frag = document.createDocumentFragment();
    frag.appendChild(titleEl);
    if (meta.childNodes.length > 0) frag.appendChild(meta);
    if (tagRow) frag.appendChild(tagRow);
    if (gallery && gallery.childNodes.length > 0) frag.appendChild(gallery);
    frag.appendChild(bodyEl);
    frag.appendChild(footer);

    content.replaceChildren(frag);
  }

  async function remove() {
    if (busy || !entry) return;
    const ok = window.confirm("Delete this entry? This cannot be undone.");
    if (!ok) return;
    busy = true;
    const deleteBtn = document.getElementById("reader-delete");
    if (deleteBtn) deleteBtn.disabled = true;
    try {
      const { error } = await db.deleteEntry(entryId);
      if (error) throw error;
      // Best-effort cleanup of any attached images.
      const paths = Array.isArray(entry.image_paths) ? entry.image_paths : [];
      for (const p of paths) deleteImage(p).catch(() => {});
      onDeleted?.(entryId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Delete failed:", e);
      busy = false;
      if (deleteBtn) deleteBtn.disabled = false;
      window.alert(e?.message || "Couldn't delete that entry.");
    }
  }
}
