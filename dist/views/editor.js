// views/editor.js
// ------------------------------------------------------------------
// Editor view: create a new entry, or edit an existing one.
// Features:
//   - Title, body (markdown), mood, date
//   - Body has a "Preview" tab that renders sanitized HTML
//   - Image attachments: pick one or more files, upload to Storage,
//     attach the storage paths to the entry. Display as a removable
//     thumbnail grid above the body editor.
// ------------------------------------------------------------------

import { db } from "../db.js";
import { renderMarkdownToHtml } from "../markdown.js";
import { uploadImage, signImagePaths, deleteImage } from "../images.js";
import { isMockMode } from "../config.js";
import { makeThemeToggle } from "../theme.js";
import { journalState } from "../journal-state.js";

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

const MOOD_LABELS = ["", "Tough", "Meh", "Okay", "Good", "Great"];
const MOOD_EMOJI = ["", "😔", "😐", "🙂", "😄", "🤩"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function renderEditorView(root, { entryId, userId, onBack, onSaved, onDeleted }) {
  let entry = null;
  let journals = journalState.getCachedJournals() || [];
  let allTags = []; // [{id, name}, ...] for the current user
  let selectedTags = []; // [{id, name}, ...] on this entry
  let loading = true;
  let saving = false;
  let savingError = "";
  // image_paths is the source of truth for which images are attached to
  // the entry. On edit, we sign these for the thumbnail grid; on save
  // (new or update) we send them as-is to the DB.
  let imagePaths = [];
  // Signed URLs for displaying existing images. Keyed by path.
  let signedUrlByPath = new Map();
  // Currently-uploading files: shown as placeholder thumbnails with a
  // spinner until the upload finishes and we replace them with the
  // real thumbnail.
  const inflight = new Set();
  // Body editor mode: "write" or "preview".
  let bodyMode = "write";
  // The journal the new entry will be filed under. Initialised below
  // from the active journal (or default journal, if known).
  let stateJournalId = null;

  // ----- Header / back -----
  const backBtn = el(
    "button",
    {
      class: "btn btn-ghost btn-small",
      attrs: { id: "editor-back", "aria-label": "Back to timeline" },
      on: { click: () => onBack?.() },
    },
    "← Back"
  );

  const titleEl = el("h1", {
    class: "editor-title",
    text: entryId ? "Edit entry" : "New entry",
  });

  // ----- Form fields -----
  const titleInput = el("input", {
    type: "text",
    class: "editor-title-input",
    placeholder: "Title (optional)",
    maxlength: 200,
    autocomplete: "off",
  });
  titleInput.id = "editor-title";

  // Body — write mode
  const bodyTextarea = el("textarea", {
    class: "editor-body",
    rows: 12,
    placeholder: "What's on your mind? Markdown is supported.",
  });
  bodyTextarea.id = "editor-body";

  // Body — preview mode
  const bodyPreview = el("div", { class: "editor-preview markdown-body", attrs: { id: "editor-preview" } });

  const bodyTabs = el("div", { class: "editor-tabs", attrs: { role: "tablist" } }, [
    el("button", {
      type: "button",
      class: "editor-tab is-active",
      attrs: { id: "tab-write", "aria-selected": "true", role: "tab" },
      on: { click: () => setBodyMode("write") },
      text: "Write",
    }),
    el("button", {
      type: "button",
      class: "editor-tab",
      attrs: { id: "tab-preview", "aria-selected": "false", role: "tab" },
      on: { click: () => setBodyMode("preview") },
      text: "Preview",
    }),
  ]);

  function setBodyMode(mode) {
    bodyMode = mode === "preview" ? "preview" : "write";
    if (bodyMode === "preview") {
      bodyTextarea.style.display = "none";
      bodyPreview.style.display = "";
      renderPreview();
      bodyTabs.querySelector("#tab-write").classList.remove("is-active");
      bodyTabs.querySelector("#tab-write").setAttribute("aria-selected", "false");
      bodyTabs.querySelector("#tab-preview").classList.add("is-active");
      bodyTabs.querySelector("#tab-preview").setAttribute("aria-selected", "true");
    } else {
      bodyTextarea.style.display = "";
      bodyPreview.style.display = "none";
      bodyTabs.querySelector("#tab-preview").classList.remove("is-active");
      bodyTabs.querySelector("#tab-preview").setAttribute("aria-selected", "false");
      bodyTabs.querySelector("#tab-write").classList.add("is-active");
      bodyTabs.querySelector("#tab-write").setAttribute("aria-selected", "true");
    }
  }

  async function renderPreview() {
    const html = await renderMarkdownToHtml(bodyTextarea.value);
    bodyPreview.innerHTML = html;
  }

  // Image upload UI
  const imageGrid = el("div", { class: "image-grid", attrs: { id: "image-grid" } });
  const fileInput = el("input", {
    type: "file",
    class: "visually-hidden",
    attrs: {
      id: "image-file-input",
      accept: "image/jpeg,image/png,image/gif,image/webp",
      multiple: "multiple",
    },
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      handlePickedFile(f);
    }
    fileInput.value = ""; // reset so picking the same file again still fires
  });
  const pickBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn-ghost btn-small",
      attrs: { id: "image-pick-btn" },
      on: { click: () => fileInput.click() },
    },
    "📎 Add images"
  );

  async function handlePickedFile(file) {
    if (!/^image\//.test(file.type || "")) {
      showError(`Unsupported file: ${file.name}`);
      return;
    }
    // In mock mode, just stub a path so the UI still demos.
    if (isMockMode) {
      const fakePath = `mock://${Date.now()}-${file.name}`;
      imagePaths.push(fakePath);
      paintImageGrid();
      return;
    }
    const slot = el("div", { class: "image-slot is-loading", text: "Uploading…" });
    imageGrid.appendChild(slot);
    inflight.add(slot);
    try {
      const path = await uploadImage({ userId, file });
      imagePaths.push(path);
      // Get a signed URL for the new image so the thumbnail shows.
      try {
        const signed = await signImagePaths([path]);
        if (signed[0]) signedUrlByPath.set(signed[0].path, signed[0].url);
      } catch (_) { /* ok, will show placeholder */ }
    } catch (e) {
      showError(e?.message || "Upload failed.");
    } finally {
      inflight.delete(slot);
      paintImageGrid();
    }
  }

  async function removeImageAt(idx) {
    const path = imagePaths[idx];
    if (!path) return;
    imagePaths.splice(idx, 1);
    signedUrlByPath.delete(path);
    paintImageGrid();
    // Best-effort delete in Storage. We don't block the UI on this.
    if (!isMockMode) {
      deleteImage(path).catch(() => {});
    }
  }

  function paintImageGrid() {
    imageGrid.replaceChildren();
    imagePaths.forEach((path, idx) => {
      const url = signedUrlByPath.get(path);
      const slot = el("div", { class: "image-slot" });
      if (url) {
        slot.appendChild(
          el("img", {
            class: "image-slot-img",
            attrs: { src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
          })
        );
      } else {
        slot.appendChild(el("div", { class: "image-slot-placeholder", text: "…" }));
      }
      const removeBtn = el(
        "button",
        {
          type: "button",
          class: "image-slot-remove",
          attrs: { "aria-label": "Remove image", title: "Remove" },
          on: { click: () => removeImageAt(idx) },
          text: "×"
        }
      );
      slot.appendChild(removeBtn);
      imageGrid.appendChild(slot);
    });
  }

  const dateInput = el("input", {
    type: "date",
    class: "editor-date",
  });
  dateInput.id = "editor-date";

  // Mood segmented control.
  const moodGroup = el("div", {
    class: "mood-group",
    attrs: { role: "radiogroup", "aria-label": "Mood" },
  });
  const moodButtons = [];
  for (let i = 1; i <= 5; i++) {
    const btn = el(
      "button",
      {
        type: "button",
        class: "mood-btn",
        attrs: {
          role: "radio",
          "aria-label": MOOD_LABELS[i],
          "data-mood": String(i),
          "aria-checked": "false",
        },
        on: { click: () => setMood(i) },
      },
      [el("span", { class: "mood-emoji", text: MOOD_EMOJI[i] })]
    );
    moodButtons.push(btn);
    moodGroup.appendChild(btn);
  }

  function setMood(m) {
    if (!Number.isFinite(m) || m < 1 || m > 5) return;
    state.mood = m;
    for (const b of moodButtons) {
      const bm = Number(b.dataset.mood);
      const active = bm === m;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", active ? "true" : "false");
    }
  }

  // Journal selector — shown in the form so the user can file the
  // entry under any of their journals. New entries default to the
  // active journal (or, if there isn't one, the user's default
  // journal). For existing entries we use the entry's current
  // journal_id (resolved after we load it).
  const journalSelect = el("select", {
    class: "input editor-journal-select",
    attrs: { id: "editor-journal-select", "aria-label": "Journal" },
  });
  journalSelect.appendChild(
    el("option", { attrs: { value: "" }, text: "No journal" })
  );
  for (const j of journals) {
    const opt = document.createElement("option");
    opt.value = j.id;
    opt.textContent = `${j.icon || "📓"}  ${j.name}`;
    journalSelect.appendChild(opt);
  }
  journalSelect.addEventListener("change", () => {
    stateJournalId = journalSelect.value || null;
  });

  // Tag chip input. The user types a tag name; Enter or comma adds
  // it. The currently-selected tags are shown as chips with × to
  // remove. A list of suggestions (the user's existing tags, filtered
  // by what's been typed) is shown below the input.
  const tagInput = el("input", {
    type: "text",
    class: "input editor-tag-input",
    placeholder: "Add a tag…",
    maxlength: 40,
  });
  tagInput.id = "editor-tag-input";
  tagInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === ",") {
      ev.preventDefault();
      addTypedTag();
    } else if (ev.key === "Backspace" && tagInput.value === "" && selectedTags.length) {
      // Backspace on an empty input pops the last chip.
      selectedTags.pop();
      repaintTagArea();
    }
  });
  tagInput.addEventListener("input", () => {
    repaintSuggestions();
  });

  const tagChips = el("div", { class: "tag-chip-row" });
  const tagSuggest = el("div", { class: "tag-suggest" });
  const tagArea = el("div", { class: "tag-area" }, [tagChips, tagInput, tagSuggest]);

  function normalize(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .slice(0, 40);
  }

  function addTag(tag) {
    if (!tag || !tag.id) return;
    if (selectedTags.some((t) => t.id === tag.id)) return;
    selectedTags.push(tag);
    selectedTags.sort((a, b) => a.name.localeCompare(b.name));
    repaintTagArea();
  }

  async function addTypedTag() {
    const text = tagInput.value.trim();
    if (!text) return;
    const norm = normalize(text);
    if (!norm) {
      tagInput.value = "";
      return;
    }
    // Re-use an existing tag if its name matches.
    const existing = allTags.find((t) => t.name === norm);
    if (existing) {
      addTag(existing);
      tagInput.value = "";
      return;
    }
    // Otherwise create a new tag and add it.
    const { data, error } = await db.createTag({ user_id: userId, name: norm });
    if (error) {
      showError(error.message || "Couldn't add that tag.");
      return;
    }
    if (data) {
      allTags.push(data);
      allTags.sort((a, b) => a.name.localeCompare(b.name));
      addTag(data);
      tagInput.value = "";
    }
  }

  function removeTag(id) {
    selectedTags = selectedTags.filter((t) => t.id !== id);
    repaintTagArea();
  }

  function repaintTagArea() {
    tagChips.replaceChildren(
      ...selectedTags.map((t) =>
        el("span", { class: "tag-chip", attrs: { "data-tag-id": t.id } }, [
          el("span", { class: "tag-chip-name", text: "#" + t.name }),
          el(
            "button",
            {
              type: "button",
              class: "tag-chip-remove",
              attrs: { "aria-label": `Remove tag ${t.name}`, title: "Remove" },
              on: { click: () => removeTag(t.id) },
              text: "×"
            }
          ),
        ])
      )
    );
    repaintSuggestions();
  }

  function repaintSuggestions() {
    const q = normalize(tagInput.value);
    const selectedIds = new Set(selectedTags.map((t) => t.id));
    const matches = allTags
      .filter((t) => !selectedIds.has(t.id))
      .filter((t) => (q ? t.name.includes(q) : true))
      .slice(0, 8);
    if (matches.length === 0) {
      tagSuggest.replaceChildren();
      tagSuggest.classList.remove("is-open");
      return;
    }
    tagSuggest.classList.add("is-open");
    tagSuggest.replaceChildren(
      ...matches.map((t) =>
        el(
          "button",
          {
            type: "button",
            class: "tag-suggest-item",
            on: { click: () => { addTag(t); tagInput.value = ""; } },
          },
          "#" + t.name
        )
      )
    );
  }

  // Save / delete
  const status = el("div", { class: "editor-status", attrs: { id: "editor-status" } });
  const errorEl = el("div", { class: "auth-error", attrs: { id: "editor-error" } });

  const saveBtn = el(
    "button",
    {
      class: "btn btn-primary",
      attrs: { id: "editor-save", type: "button" },
      on: { click: save },
    },
    "Save"
  );

  const deleteBtn = el(
    "button",
    {
      class: "btn btn-danger",
      attrs: { id: "editor-delete", type: "button" },
      on: { click: remove },
    },
    "Delete"
  );

  const state = {
    title: "",
    body: "",
    mood: 3,
    entry_date: todayIso(),
  };

  // ----- Layout -----
  const form = el("form", {
    class: "editor-form",
    on: { submit: (e) => { e.preventDefault(); save(); } },
  }, [
    el("div", { class: "editor-row" }, [
      el("label", { class: "editor-label" }, [el("span", { text: "Title" }), titleInput]),
    ]),
    el("div", { class: "editor-row" }, [
      el("label", { class: "editor-label" }, [
        el("span", { text: "Body" }),
        bodyTabs,
        bodyTextarea,
        bodyPreview,
      ]),
    ]),
    el("div", { class: "editor-row" }, [
      el("label", { class: "editor-label" }, [
        el("span", { text: "Images" }),
        imageGrid,
        el("div", { class: "editor-image-actions" }, [fileInput, pickBtn]),
      ]),
    ]),
    el("div", { class: "editor-row editor-row-inline" }, [
      el("label", { class: "editor-label editor-label-inline" }, [
        el("span", { text: "Date" }),
        dateInput,
      ]),
      el("div", { class: "editor-label editor-label-inline" }, [
        el("span", { text: "Mood" }),
        moodGroup,
      ]),
    ]),
    el("div", { class: "editor-row" }, [
      el("label", { class: "editor-label" }, [
        el("span", { text: "Journal" }),
        journalSelect,
      ]),
    ]),
    el("div", { class: "editor-row" }, [
      el("label", { class: "editor-label" }, [
        el("span", { text: "Tags" }),
        tagArea,
      ]),
    ]),
    errorEl,
    el("div", { class: "editor-actions" }, [
      deleteBtn,
      status,
      saveBtn,
    ]),
  ]);
  errorEl.classList.remove("visible");
  bodyPreview.style.display = "none";

  root.replaceChildren(
    el("div", { class: "app-shell" }, [
      el("header", { class: "app-header" }, [
        el("div", { class: "app-header-inner" }, [
          backBtn,
          el("div", { class: "brand brand-small" }, [
            el("div", { class: "brand-mark", text: "✦" }),
            el("div", { class: "brand-name", text: "Quiet" }),
          ]),
          el("div", { class: "header-actions" }, [makeThemeToggle()]),
        ]),
      ]),
      el("main", { class: "app-main" }, [titleEl, form]),
    ])
  );

  // Wire change events to state (no full repaint on every keystroke
  // because that would clobber the caret in the textarea).
  titleInput.addEventListener("input", () => { state.title = titleInput.value; });
  bodyTextarea.addEventListener("input", () => { state.body = bodyTextarea.value; });
  dateInput.addEventListener("change", () => { state.entry_date = dateInput.value || todayIso(); });

  // Init: load existing or set defaults
  if (entryId) {
    Promise.all([
      db.listJournals(userId),
      db.listTags(userId),
      db.getEntry(entryId),
    ]).then(async ([jRes, tRes, eRes]) => {
      loading = false;
      if (jRes.error) {
        // Journals failing to load is non-fatal for editing an
        // existing entry; we just leave the selector empty.
        // eslint-disable-next-line no-console
        console.warn("Could not load journals:", jRes.error);
      } else {
        journals = jRes.data || [];
        journalState.setCachedJournals(journals);
      }
      if (!tRes.error) {
        allTags = tRes.data || [];
      }
      if (eRes.error || !eRes.data) {
        showError("Couldn't load that entry.");
        return;
      }
      const data = eRes.data;
      entry = data;
      rebuildJournalSelect(data.journal_id);
      titleInput.value = data.title || "";
      bodyTextarea.value = data.body || "";
      dateInput.value = data.entry_date || todayIso();
      setMood(Number.isFinite(data.mood) ? data.mood : 3);
      state.title = data.title || "";
      state.body = data.body || "";
      state.mood = Number.isFinite(data.mood) ? data.mood : 3;
      state.entry_date = data.entry_date || todayIso();
      stateJournalId = data.journal_id || null;
      selectedTags = Array.isArray(data.tags) ? [...data.tags] : [];
      imagePaths = Array.isArray(data.image_paths) ? [...data.image_paths] : [];
      if (imagePaths.length > 0 && !isMockMode) {
        try {
          const signed = await signImagePaths(imagePaths);
          for (const { path, url } of signed) signedUrlByPath.set(path, url);
        } catch (_) { /* ok */ }
      }
      paintImageGrid();
      repaintTagArea();
      updateDeleteVisibility();
    });
  } else {
    // New entry: load journals + tags, default the selector to the
    // active journal (or the user's default journal, or "No journal").
    Promise.all([db.listJournals(userId), db.listTags(userId)])
      .then(([jRes, tRes]) => {
        if (!jRes.error) {
          journals = jRes.data || [];
          journalState.setCachedJournals(journals);
          const defaultJournal = journals.find((j) => j.is_default);
          const active = journalState.getActiveJournalId();
          const target =
            (active && journals.some((j) => j.id === active) && active) ||
            (defaultJournal && defaultJournal.id) ||
            null;
          stateJournalId = target;
          rebuildJournalSelect(target);
        }
        if (!tRes.error) {
          allTags = tRes.data || [];
        }
      })
      .finally(() => {
        loading = false;
        setMood(3);
        dateInput.value = todayIso();
        updateDeleteVisibility();
        paintImageGrid();
        repaintTagArea();
        setTimeout(() => titleInput.focus(), 0);
      });
  }

  function rebuildJournalSelect(selectedId) {
    journalSelect.replaceChildren();
    journalSelect.appendChild(
      el("option", { attrs: { value: "" }, text: "No journal" })
    );
    for (const j of journals) {
      const opt = document.createElement("option");
      opt.value = j.id;
      opt.textContent = `${j.icon || "📓"}  ${j.name}`;
      journalSelect.appendChild(opt);
    }
    journalSelect.value = selectedId || "";
  }

  function updateDeleteVisibility() {
    deleteBtn.style.visibility = entryId ? "visible" : "hidden";
  }

  function showError(msg) {
    savingError = msg || "";
    errorEl.textContent = savingError;
    errorEl.classList.toggle("visible", Boolean(savingError));
  }

  function setStatus(text) {
    status.textContent = text || "";
  }

  async function save() {
    if (saving) return;
    showError("");
    setStatus("");

    const title = titleInput.value.trim();
    const body = bodyTextarea.value;
    const mood = state.mood;
    const entry_date = dateInput.value || todayIso();

    if (!body.trim()) {
      showError("Write something in the body before saving.");
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    try {
      const journalId = stateJournalId || journalSelect.value || null;
      let savedEntry = null;
      if (entryId) {
        const { data, error } = await db.updateEntry(entryId, {
          title,
          body,
          mood,
          entry_date,
          image_paths: imagePaths,
          journal_id: journalId,
        });
        if (error) throw error;
        entry = data;
        savedEntry = data;
        setStatus("Saved");
        flashStatus();
      } else {
        const { data, error } = await db.createEntry({
          user_id: userId,
          title,
          body,
          mood,
          entry_date,
          image_paths: imagePaths,
          journal_id: journalId,
        });
        if (error) throw error;
        entry = data;
        savedEntry = data;
        setStatus("Saved");
        flashStatus();
      }
      // Save tags separately (they live in entry_tags). We always
      // re-write the full set, even for an existing entry, so the
      // displayed set is the source of truth.
      const tagIds = selectedTags.map((t) => t.id).filter(Boolean);
      const { error: tagErr } = await db.setEntryTags({
        user_id: userId,
        entry_id: savedEntry.id,
        tagIds,
      });
      if (tagErr) {
        // Don't fail the whole save — the entry is saved, the user
        // just sees a softer warning.
        showError("Entry saved, but couldn't save tags: " + (tagErr.message || ""));
      }
      // Return the entry with its tags for the caller.
      onSaved?.({ ...savedEntry, tags: selectedTags });
    } catch (e) {
      showError(e?.message || "Couldn't save. Please try again.");
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  }

  async function remove() {
    if (!entryId) return;
    const ok = window.confirm("Delete this entry? This cannot be undone.");
    if (!ok) return;
    saving = true;
    deleteBtn.disabled = true;
    saveBtn.disabled = true;
    try {
      const { error } = await db.deleteEntry(entryId);
      if (error) throw error;
      // Best-effort cleanup of attached images.
      for (const p of imagePaths) {
        deleteImage(p).catch(() => {});
      }
      onDeleted?.(entryId);
    } catch (e) {
      showError(e?.message || "Couldn't delete. Please try again.");
      saving = false;
      deleteBtn.disabled = false;
      saveBtn.disabled = false;
    }
  }

  let statusTimer = null;
  function flashStatus() {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatus(""), 1800);
  }
}
