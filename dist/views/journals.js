// views/journals.js
// ------------------------------------------------------------------
// Manage journals: list, create, rename, recolor, re-icon, delete.
// The default journal is shown with a badge and cannot be removed.
// ------------------------------------------------------------------

import { db } from "../db.js";
import { makeThemeToggle } from "../theme.js";
import { journalState, JOURNAL_ICONS, JOURNAL_COLORS } from "../journal-state.js";

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

export function renderJournalsView(root, { userId, onBack, userEmail }) {
  let journals = [];
  let loading = true;
  let errorMsg = "";

  // ----- Header -----
  const header = el("header", { class: "app-header" }, [
    el("div", { class: "app-header-inner" }, [
      el(
        "button",
        {
          class: "btn btn-ghost btn-small",
          attrs: { id: "journals-back", "aria-label": "Back to timeline" },
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
      ]),
    ]),
  ]);

  const titleEl = el("h1", { class: "journals-title", text: "Journals" });
  const subEl = el(
    "p",
    {
      class: "journals-sub",
      text: "Use journals to keep different parts of your life separate — Daily, Travel, Work, anything you like.",
    }
  );

  const errorEl = el("div", { class: "auth-error", attrs: { id: "journals-error" } });

  // ----- List -----
  const listEl = el("div", { class: "journals-list" });

  // ----- Create form -----
  const nameInput = el("input", {
    type: "text",
    class: "input",
    placeholder: "New journal name",
    maxlength: 60,
  });
  nameInput.id = "journal-name-input";

  const iconPicker = el("div", { class: "picker picker-icons" });
  let pickedIcon = "📓";
  for (const ic of JOURNAL_ICONS) {
    const b = el("button", {
      type: "button",
      class: "picker-btn" + (ic === pickedIcon ? " is-active" : ""),
      attrs: { "data-icon": ic, "aria-label": `Icon ${ic}` },
      on: { click: () => { pickedIcon = ic; refreshPickers(); } },
      text: ic,
    });
    iconPicker.appendChild(b);
  }

  const colorPicker = el("div", { class: "picker picker-colors" });
  let pickedColor = JOURNAL_COLORS[0];
  for (const c of JOURNAL_COLORS) {
    const b = el("button", {
      type: "button",
      class: "picker-btn picker-color" + (c === pickedColor ? " is-active" : ""),
      attrs: { "data-color": c, "aria-label": `Color ${c}` },
      on: { click: () => { pickedColor = c; refreshPickers(); } },
    });
    b.style.background = c;
    colorPicker.appendChild(b);
  }

  function refreshPickers() {
    for (const b of iconPicker.children) {
      b.classList.toggle("is-active", b.dataset.icon === pickedIcon);
    }
    for (const b of colorPicker.children) {
      b.classList.toggle("is-active", b.dataset.color === pickedColor);
    }
  }

  const descInput = el("input", {
    type: "text",
    class: "input",
    placeholder: "Description (optional)",
    maxlength: 200,
  });

  let creating = false;
  const createBtn = el(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      attrs: { id: "journal-create-btn" },
      on: { click: createJournal },
    },
    "Create journal"
  );

  const createForm = el("form", {
    class: "journal-create-form",
    on: { submit: (e) => { e.preventDefault(); createJournal(); } },
  }, [
    el("label", { class: "field" }, [el("span", { text: "Name" }), nameInput]),
    el("label", { class: "field" }, [el("span", { text: "Description" }), descInput]),
    el("div", { class: "field" }, [
      el("span", { text: "Icon" }),
      iconPicker,
    ]),
    el("div", { class: "field" }, [
      el("span", { text: "Color" }),
      colorPicker,
    ]),
    createBtn,
  ]);

  // ----- Render -----
  root.replaceChildren(
    el("div", { class: "app-shell" }, [
      header,
      el("main", { class: "app-main" }, [
        titleEl,
        subEl,
        errorEl,
        listEl,
        el("section", { class: "journal-create" }, [
          el("h2", { class: "journals-section-title", text: "Add a journal" }),
          createForm,
        ]),
      ]),
    ])
  );

  load();

  function setError(msg) {
    errorMsg = msg || "";
    errorEl.textContent = errorMsg;
    errorEl.classList.toggle("visible", Boolean(errorMsg));
  }

  function load() {
    loading = true;
    setError("");
    paint();
    db.listJournals(userId)
      .then(({ data, error }) => {
        loading = false;
        if (error) {
          setError(error.message || "Could not load journals.");
          return;
        }
        journals = data || [];
        journalState.setCachedJournals(journals);
        paint();
      })
      .catch((e) => {
        loading = false;
        setError(e?.message || "Could not load journals.");
        paint();
      });
  }

  function paint() {
    if (loading) {
      listEl.replaceChildren(
        el("div", { class: "state state-loading", text: "Loading journals…" })
      );
      return;
    }
    if (journals.length === 0) {
      listEl.replaceChildren(
        el("div", { class: "state state-empty" }, [
          el("p", { class: "state-title", text: "No journals yet" }),
          el("p", { class: "state-sub", text: "Create your first one below." }),
        ])
      );
      return;
    }
    listEl.replaceChildren(
      ...journals.map((j, idx) => renderJournalRow(j, idx))
    );
  }

  function renderJournalRow(j, idx) {
    const isDefault = !!j.is_default;
    const row = el("div", {
      class: "journal-row",
      attrs: { "data-journal-id": j.id },
    });

    const swatch = el("div", {
      class: "journal-swatch",
      text: j.icon || "📓",
    });
    swatch.style.background = j.color || "#6b8a5a";

    const nameField = el("input", {
      type: "text",
      class: "input journal-name-input",
      value: j.name || "",
      maxlength: 60,
    });
    nameField.disabled = isDefault; // can't rename the default journal in v2

    const descField = el("input", {
      type: "text",
      class: "input journal-desc-input",
      value: j.description || "",
      maxlength: 200,
      placeholder: "Description (optional)",
    });
    descField.disabled = isDefault;

    const iconRow = el("div", { class: "picker picker-icons picker-small" });
    let editIcon = j.icon || "📓";
    for (const ic of JOURNAL_ICONS) {
      const b = el("button", {
        type: "button",
        class: "picker-btn" + (ic === editIcon ? " is-active" : ""),
        attrs: { "aria-label": `Icon ${ic}` },
        on: { click: () => { editIcon = ic; refreshRowIcons(); } },
        text: ic,
      });
      iconRow.appendChild(b);
    }
    function refreshRowIcons() {
      for (const b of iconRow.children) {
        b.classList.toggle("is-active", b.textContent === editIcon);
      }
    }

    const colorRow = el("div", { class: "picker picker-colors picker-small" });
    let editColor = j.color || JOURNAL_COLORS[0];
    for (const c of JOURNAL_COLORS) {
      const b = el("button", {
        type: "button",
        class: "picker-btn picker-color" + (c === editColor ? " is-active" : ""),
        attrs: { "data-color": c, "aria-label": `Color ${c}` },
      });
      b.style.background = c;
      b.addEventListener("click", () => { editColor = c; refreshRowColors(); });
      colorRow.appendChild(b);
    }
    function refreshRowColors() {
      for (const b of colorRow.children) {
        b.classList.toggle("is-active", b.dataset.color === editColor);
      }
    }

    const saveBtn = el(
      "button",
      {
        class: "btn btn-primary btn-small",
        type: "button",
        on: { click: () => saveRow(j) },
      },
      "Save"
    );

    const removeBtn = isDefault
      ? el("span", { class: "journal-default-badge", text: "Default" })
      : el(
          "button",
          {
            class: "btn btn-danger btn-small",
            type: "button",
            on: { click: () => removeRow(j) },
          },
          "Delete"
        );

    const moveUp = el(
      "button",
      {
        class: "btn btn-ghost btn-tiny",
        type: "button",
        attrs: { "aria-label": "Move up", title: "Move up" },
        on: { click: () => move(idx, -1) },
        disabled: idx === 0,
      },
      "↑"
    );
    const moveDown = el(
      "button",
      {
        class: "btn btn-ghost btn-tiny",
        type: "button",
        attrs: { "aria-label": "Move down", title: "Move down" },
        on: { click: () => move(idx, 1) },
        disabled: idx === journals.length - 1,
      },
      "↓"
    );

    row.appendChild(swatch);
    row.appendChild(
      el("div", { class: "journal-fields" }, [
        el("div", { class: "journal-line" }, [nameField, moveUp, moveDown]),
        el("div", { class: "journal-line" }, [descField]),
        el("div", { class: "journal-line" }, [iconRow, colorRow]),
        el("div", { class: "journal-line" }, [saveBtn, removeBtn]),
      ])
    );

    return row;
  }

  async function createJournal() {
    if (creating) return;
    setError("");
    const name = nameInput.value.trim();
    if (!name) {
      setError("Give the journal a name first.");
      return;
    }
    creating = true;
    createBtn.disabled = true;
    try {
      const { data, error } = await db.createJournal({
        user_id: userId,
        name,
        description: descInput.value.trim(),
        color: pickedColor,
        icon: pickedIcon,
      });
      if (error) throw error;
      nameInput.value = "";
      descInput.value = "";
      load();
    } catch (e) {
      setError(e?.message || "Couldn't create that journal.");
    } finally {
      creating = false;
      createBtn.disabled = false;
    }
  }

  async function saveRow(j) {
    setError("");
    const row = listEl.querySelector(`[data-journal-id="${j.id}"]`);
    if (!row) return;
    const name = row.querySelector(".journal-name-input").value.trim();
    const description = row.querySelector(".journal-desc-input").value.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    // Read the selected icon + color from the row.
    const iconBtn = row.querySelector(".picker-icons .is-active");
    const colorBtn = row.querySelector(".picker-colors .is-active");
    const icon = iconBtn ? iconBtn.textContent : j.icon;
    const color = colorBtn ? colorBtn.dataset.color : j.color;
    const patch = {
      name,
      description: description || null,
      icon,
      color: color || j.color,
    };
    const { data, error } = await db.updateJournal(j.id, patch);
    if (error) {
      setError(error.message || "Couldn't save.");
      return;
    }
    // Refresh cache.
    journalState.setCachedJournals(
      journals.map((x) => (x.id === j.id ? { ...x, ...data } : x))
    );
    setError(""); // clear any prior error
    flashSaved(row);
  }

  function hexFromCss(css) {
    if (!css) return null;
    if (css.startsWith("#")) return css;
    // Convert "rgb(r, g, b)" to "#rrggbb".
    const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!m) return css;
    return "#" + [1, 2, 3]
      .map((i) => Number(m[i]).toString(16).padStart(2, "0"))
      .join("");
  }

  function flashSaved(row) {
    row.classList.add("is-saved");
    setTimeout(() => row.classList.remove("is-saved"), 1200);
  }

  // (rgbToCss removed — we now read the picked color from a data
  // attribute set at construction time, which avoids the
  // style.background rgb() round-trip.)

  async function removeRow(j) {
    setError("");
    const ok = window.confirm(
      `Delete the journal "${j.name}"?\n\nEntries in it will be kept (the journal reference will be cleared).`
    );
    if (!ok) return;
    const { error } = await db.deleteJournal(j.id);
    if (error) {
      setError(error.message || "Couldn't delete.");
      return;
    }
    if (journalState.getActiveJournalId() === j.id) {
      journalState.setActiveJournalId(null);
    }
    load();
  }

  async function move(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= journals.length) return;
    const next = [...journals];
    const [item] = next.splice(idx, 1);
    next.splice(newIdx, 0, item);
    journals = next;
    paint();
    const orderedIds = journals.map((j) => j.id);
    await db.reorderJournals(orderedIds);
    journalState.setCachedJournals(journals);
  }
}
