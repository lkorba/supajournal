# Frontend Report — Quiet journal app

A DayOne-like journal web app, built as a static site with vanilla HTML +
ES-module JavaScript. Backend integration via the Supabase JS client loaded
from a CDN. No build step.

## Files

All files live under `/workspace/journal-app/dist/`:

```
dist/
├── index.html               single page; inline __JOURNAL_CONFIG__ stub
├── app.js                   main entry: boot, routing, session wiring
├── auth.js                  auth wrapper (login / signup / signout / onAuthStateChange)
├── config.js                reads window.__JOURNAL_CONFIG__; mock-mode flag
├── db.js                    entries CRUD wrapper with mock-mode fallback
├── supabase-client.js       shared, lazy Supabase client (one per page)
├── styles.css               single calm/paper stylesheet, dark-mode aware
└── views/
    ├── login.js             login + signup form
    ├── timeline.js          grouped, searchable entry list
    └── editor.js            new / edit / delete entry
```

Auxiliary files:
- `/workspace/journal-app/FRONTEND_REPORT.md` — this report.

## How the integration task plugs in

`index.html` defines a global config stub:

```html
<script>
  window.__JOURNAL_CONFIG__ = {
    url: "",        // ← fill in with the project URL
    anonKey: "",    // ← fill in with the anon (publishable) key
    useMock: true,  // ← set to false once the backend is wired up
  };
</script>
```

When `useMock === true` (the default) the UI runs entirely against canned
data so the app is demoable without a backend. Setting `useMock: false` and
providing `url` + `anonKey` switches every Supabase call to the real client
automatically. The integration task does **not** need to change any other
file.

The Supabase client is created lazily in `supabase-client.js` from
`@supabase/supabase-js@2` via `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`.

## Feature checklist

| Area | Spec | Status |
|------|------|--------|
| Auth | Email + password login | ✅ |
| Auth | Toggle to signup mode | ✅ |
| Auth | Error messages (invalid creds, weak password, etc.) | ✅ — `humanizeAuthError` in `views/login.js` |
| Auth | Persist session via `onAuthStateChange` | ✅ — `auth.bindSupabaseAuth()` in `app.js` |
| Auth | Logout button on main app | ✅ — header "Sign out" |
| Auth | Auto-redirect: signed in → timeline, signed out → login | ✅ — `render()` in `app.js` |
| Timeline | List all entries, newest first | ✅ |
| Timeline | Grouped by `entry_date` with "Today"/"Yesterday"/formatted headers | ✅ |
| Timeline | Card: title (or "Untitled"), 200-char snippet, mood emoji, date | ✅ |
| Timeline | Click card → editor | ✅ — keyboard accessible (Enter/Space) |
| Timeline | Search box, client-side, case-insensitive, title or body | ✅ |
| Timeline | "+ New entry" FAB | ✅ |
| Editor | Title (optional), body (textarea, monospace), mood (1–5), entry_date picker | ✅ |
| Editor | Save and Delete (with confirm) buttons | ✅ |
| Editor | Auto-fill body when editing | ✅ |
| Editor | "Saved" indicator after save | ✅ — flashes then fades |
| Editor | Back button to timeline | ✅ |
| Aesthetic | Off-white `#fafaf7`, charcoal `#222`, accent `#3a7d5d` | ✅ — CSS custom props in `styles.css` |
| Aesthetic | System font stack | ✅ |
| Aesthetic | Mobile-first, 720px max content column on desktop | ✅ |
| Aesthetic | Dark mode via `prefers-color-scheme` (`#1a1a1a`) | ✅ |

## Security posture

- `innerHTML` is **never** used. All user-controlled text (entry titles,
  bodies, emails) goes through `textContent` or controlled element
  `value` setters via the `el()` helper in each view.
- No reference to `service_role` exists in code; only in comments warning
  future contributors not to add it. The anon key is the only key the
  bundle ever touches.
- Authorization is expected to live in RLS on the `entries` and
  `profiles` tables. The frontend does **not** read or trust
  `user_metadata` for any decision; the user id is taken from
  `session.user.id` (issued by Supabase Auth, validated by the JWT).
- Supabase JS persists the session token in `localStorage` by default;
  this is acceptable because the RLS policies are the source of truth
  for authorization. We do not duplicate the token anywhere.
- All module code is `type="module"`; the document enforces a strict
  CSP-friendly default of no inline scripts except the single
  `__JOURNAL_CONFIG__` block. That block contains **no secrets** —
  the real anon key is also a public value.

## Mock-mode demoable flow

With `useMock: true` (default), the user can:

1. Open the page → see the login card.
2. Enter any email and a 6+ char password → "Sign in" succeeds (the mock
   layer accepts everything).
3. Land on the timeline with 6 seeded entries, grouped under "Today",
   "Yesterday", and earlier dates.
4. Type in the search box to filter live.
5. Click any card → opens the editor pre-filled.
6. Click "+ New entry" → opens a blank editor; Save creates a new entry
   and returns to the timeline.
7. Save an edit; "Saved" appears briefly.
8. Delete with confirmation; returns to timeline.
9. Sign out → returns to the login screen.

## Verification

Served with `python3 -m http.server 8765` from `dist/`; fetched `/` and
each module — all return HTTP 200 and the expected content. Modules were
imported under Node with a stub `document` to confirm clean syntax and
the CRUD round-trip works (create → list → update → delete). Server was
stopped after verification.

```
$ curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/
200
$ for f in app.js config.js db.js auth.js supabase-client.js styles.css \
           views/login.js views/timeline.js views/editor.js; do
    curl -s -o /dev/null -w "%{http_code} $f\n" "http://127.0.0.1:8765/$f"
  done
200 app.js
200 config.js
200 db.js
200 auth.js
200 supabase-client.js
200 styles.css
200 views/login.js
200 views/timeline.js
200 views/editor.js
```

Node mock CRUD round-trip:

```
config: {"url":"","anonKey":"","useMock":true}  isMock: true  describe: mock
db.isMock: true
list count: 6   first date: 2026-07-31   mood: 5
created id: e-tzdi7j6o  title: hello
after create: 7
updated title: hi  body: edited
delete ok: true
final count: 6
```

## UI description (text-mode)

The product is called **Quiet** (a single ✦ mark + wordmark in the
header). Three views:

**Login** — centered card on the off-white background, with the brand
mark, a title ("Welcome back" / "Create your journal"), subtitle, email
field, password field, primary action button, and a small "Need an
account? Create one" link below. Errors render as a soft red banner above
the button.

**Timeline** — sticky header with brand on the left and email + "Sign out"
on the right. Below: a single search input filling the column. The
content is a vertical list of date sections. Each section has a small
uppercase date label (TODAY, YESTERDAY, TUE AUG 25) and one or more
paper-card entry rows. Each card shows: bold title (or "Untitled" in
muted text), three-line clamp of the body in muted color, and a small
row with the mood emoji and the date. A floating "+ New entry" pill in
the bottom-right opens the editor.

**Editor** — header with a "← Back" button, brand, and a spacer. The
page title is "New entry" or "Edit entry". Below: a title input, a
12-row monospace body textarea, an inline row with a date picker on the
left and a five-button segmented mood control (😔 😐 🙂 😄 🤩) on the
right. The bottom action row contains "Delete" (only visible when
editing an existing entry), a status area for "Saved", and a primary
"Save" button.

**Dark mode** automatically flips to `#1a1a1a` background with
light text. The accent becomes a softer `#6fb591` for legibility on
dark.

## Open items / TODOs for the integration task

1. Fill in `window.__JOURNAL_CONFIG__` in `index.html` with the real
   `url` and `anonKey`, and set `useMock: false`.
2. Verify the `entries` and `profiles` tables (and the
   `auth.users` linkage) match what `db.js` and `auth.js` assume:
   - `entries` columns: `id`, `user_id`, `title`, `body`, `mood`,
     `entry_date`, `created_at`, `updated_at`.
   - RLS enabled on `entries`; SELECT/INSERT/UPDATE/DELETE policies
     scoped to `auth.uid() = user_id`.
3. Confirm the auth project has email/password sign-in enabled.
4. Optional: tighten CSP to disallow the inline `__JOURNAL_CONFIG__`
   script (move it to `config.js` and serve via a separate file) once
   the deploy pipeline is set.
5. Consider adding a "Forgot password" flow (`auth.resetPasswordForEmail`)
   — not in v1 spec.
6. Consider infinite scroll or pagination if user growth is expected
   — current view loads everything at once.

No frontend-side changes are required beyond #1 for the integration to
go live.
