// views/login.js
// ------------------------------------------------------------------
// Login + signup form. Toggle between the two modes with a single
// submit button whose label changes.
// ------------------------------------------------------------------

import { auth } from "../auth.js";

// Small DOM helper. All user input that gets displayed later flows
// through textContent or controlled element.value, never innerHTML.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "on") {
      for (const [evt, fn] of Object.entries(v)) {
        node.addEventListener(evt, fn);
      }
    } else if (k === "attrs") {
      for (const [ak, av] of Object.entries(v)) {
        node.setAttribute(ak, av);
      }
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

export function renderLoginView(root) {
  let mode = "signin"; // 'signin' | 'signup'
  let busy = false;

  const titleEl = el("h1", { class: "auth-title", text: "Welcome back" });
  const subtitleEl = el(
    "p",
    { class: "auth-subtitle" },
    "Sign in to write in your journal."
  );

  const emailInput = el("input", {
    type: "email",
    autocomplete: "email",
    required: true,
    placeholder: "you@example.com",
    class: "auth-input",
  });
  emailInput.id = "login-email";

  const passwordInput = el("input", {
    type: "password",
    autocomplete: "current-password",
    required: true,
    minLength: 6,
    placeholder: "••••••••",
    class: "auth-input",
  });
  passwordInput.id = "login-password";

  const errorEl = el("div", {
    class: "auth-error",
    attrs: { role: "alert", "aria-live": "polite" },
  });
  errorEl.id = "login-error";

  const submitBtn = el(
    "button",
    {
      type: "submit",
      class: "btn btn-primary auth-submit",
      attrs: { id: "login-submit" },
    },
    "Sign in"
  );

  const toggleBtn = el(
    "button",
    {
      type: "button",
      class: "link-button",
      on: { click: () => setMode(mode === "signin" ? "signup" : "signin") },
    },
    "Need an account? Create one"
  );
  toggleBtn.id = "login-toggle";

  const form = el(
    "form",
    {
      class: "auth-form",
      on: {
        submit: async (e) => {
          e.preventDefault();
          if (busy) return;
          await submit();
        },
      },
    },
    [
      el("label", { class: "auth-label" }, [
        el("span", { text: "Email" }),
        emailInput,
      ]),
      el("label", { class: "auth-label" }, [
        el("span", { text: "Password" }),
        passwordInput,
      ]),
      errorEl,
      submitBtn,
      toggleBtn,
    ]
  );
  form.id = "login-form";

  function setMode(next) {
    mode = next;
    if (mode === "signin") {
      titleEl.textContent = "Welcome back";
      subtitleEl.textContent = "Sign in to write in your journal.";
      passwordInput.setAttribute("autocomplete", "current-password");
      submitBtn.textContent = "Sign in";
      toggleBtn.textContent = "Need an account? Create one";
    } else {
      titleEl.textContent = "Create your journal";
      subtitleEl.textContent = "Pick an email and a password to get started.";
      passwordInput.setAttribute("autocomplete", "new-password");
      submitBtn.textContent = "Create account";
      toggleBtn.textContent = "Already have an account? Sign in";
    }
    setError("");
  }

  function setError(msg) {
    errorEl.textContent = msg || "";
    errorEl.classList.toggle("visible", Boolean(msg));
  }

  async function submit() {
    setError("");
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    busy = true;
    submitBtn.disabled = true;
    submitBtn.classList.add("is-loading");
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = mode === "signin" ? "Signing in…" : "Creating…";
    try {
      const fn =
        mode === "signin"
          ? auth.signInWithPassword.bind(auth)
          : auth.signUp.bind(auth);
      const { data, error } = await fn({ email, password });
      if (error) {
        setError(humanizeAuthError(error));
      } else if (mode === "signup") {
        // If the project requires email confirmation, the session will
        // be null until the user clicks the link. Auto-sign-in only when
        // a session came back (mailer_autoconfirm: true).
        if (data?.session) {
          // Auth listener will swap us to the timeline.
        } else {
          setError(
            "Account created. Check your inbox for the confirmation link, then sign in."
          );
        }
      }
      // On success the auth listener will swap us to the timeline.
    } catch (e) {
      setError(e?.message || "Something went wrong. Please try again.");
    } finally {
      busy = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-loading");
      submitBtn.textContent = originalLabel;
    }
  }

  root.replaceChildren(
    el("main", { class: "auth-shell" }, [
      el("div", { class: "auth-card" }, [
        el("div", { class: "brand" }, [
          el("div", { class: "brand-mark", text: "✦" }),
          el("div", { class: "brand-name", text: "Quiet" }),
        ]),
        titleEl,
        subtitleEl,
        form,
      ]),
    ])
  );

  // Autofocus the first empty field.
  if (!emailInput.value) emailInput.focus();
}

function humanizeAuthError(err) {
  // Supabase Auth errors vary across versions and hosts. Pull the most
  // specific message we can find, then map known phrases to friendlier text.
  const raw = err && (err.message || err.error_description || err.msg || err.error || "");
  const msg = typeof raw === "string" ? raw : "";
  const lower = msg.toLowerCase();
  // Map the error code to a friendly message even when the message text
  // is unhelpful (e.g. some hosts return only a numeric error code).
  const code = (err && (err.code || err.error_code || err.status || "")).toString().toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "That email and password don't match. Try again.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox.";
  }
  if (lower.includes("password") && lower.includes("at least")) {
    return "Password is too short — use at least 6 characters.";
  }
  if (lower.includes("user already registered") || code === "user_already_exists") {
    return "That email is already in use. Try signing in instead.";
  }
  if (lower.includes("rate limit") || code === "over_email_send_rate_limit" || code === "429") {
    return "Too many attempts. Wait a moment, then try again.";
  }
  if (code === "email_address_invalid" || lower.includes("invalid email")) {
    return "That email address doesn't look right.";
  }
  if (lower.includes("weak password") || code === "weak_password") {
    return "Password is too weak. Use at least 6 characters with a mix of letters and numbers.";
  }
  if (code === "signup_disabled") {
    return "New signups are currently disabled on this project.";
  }
  return msg || "Couldn't sign you in. Please try again.";
}
