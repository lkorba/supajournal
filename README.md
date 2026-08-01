# SupaJournal — Quiet

A DayOne-inspired journal web app: email/password auth, timeline of entries
grouped by date, markdown body with syntax highlighting, image attachments,
and a warm paper / dark theme toggle. All data is private — each user only
sees their own entries, enforced by Postgres RLS on the server.

Vanilla HTML + ES modules. No build step, no framework, ~30 KB of app JS.
Hosted as a static site; everything dynamic goes through Supabase (auth, REST,
Storage).

![light](https://img.shields.io/badge/theme-warm%20paper-f6efdc) ![dark](https://img.shields.io/badge/theme-warm%20dark-1a1714)

## Live demo

A reference deployment is at <https://ptk2cvwqbglw7.space.minimax.io>.
The `dist/` directory is ready to drop on any static host (Netlify,
Vercel, S3+CloudFront, GitHub Pages, etc.) — no build step.

## Stack

- **Supabase** — Postgres 15+ (auth, RLS, REST via PostgREST, Storage)
- **Frontend** — vanilla HTML/CSS/ESM, Supabase JS via CDN, `marked` + `DOMPurify` for safe markdown, `highlight.js` for code-block syntax highlighting
- **Hosting** — any static host (this repo's `dist/` is deployment-ready)

## Repo layout

```
.
├── dist/                # the app — deploy this directory
│   ├── index.html
│   ├── app.js           # boot, hash router, auth wiring
│   ├── auth.js          # sign in / sign up / sign out wrapper
│   ├── config.js        # config injection (url + anon key)
│   ├── db.js            # entries CRUD
│   ├── images.js        # storage upload + signed URL helpers
│   ├── markdown.js      # marked + DOMPurify + highlight.js
│   ├── supabase-client.js
│   ├── theme.js         # light/dark toggle
│   ├── styles.css
│   └── views/
│       ├── login.js
│       ├── timeline.js
│       ├── editor.js
│       └── reader.js
├── schema.sql           # full schema + RLS + storage setup
├── FRONTEND_REPORT.md   # UI implementation notes
├── INTEGRATION_REPORT.md  # deployment + E2E results
└── README.md
```

## Setup

### 1. Create a Supabase project

Use the Supabase dashboard or any Supabase-compatible host. Grab the project
URL and the `anon` JWT from the API keys panel.

### 2. Apply the schema

`schema.sql` is a single file containing tables, triggers, RLS, the storage
bucket, and storage RLS. Apply it via your host's SQL endpoint, e.g.:

```bash
# Example: Supabase CLI
supabase db push

# Or via the Management API on supabase.green / supabase.com:
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs --arg q "$(cat schema.sql)" '{query:$q}' < /dev/stdin)" \
  https://api.supabase.com/v1/projects/$REF/database/query
```

If your host exposes a SQL execution endpoint, point it at `schema.sql`.

### 3. Optional: disable email confirmation (dev / self-host)

```bash
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mailer_autoconfirm": true}' \
  https://api.supabase.com/v1/projects/$REF/config/auth
```

Leave it off in production so users confirm their email before signing in.

### 4. Configure `dist/index.html`

Edit the inline config block at the top of the body:

```html
<script>
  window.__JOURNAL_CONFIG__ = {
    url: "https://YOUR-REF.supabase.co",
    anonKey: "eyJhbGc...your-anon-key...",
    useMock: false,
  };
</script>
```

(`useMock: true` runs the app against an in-memory mock for local UI demo
without a Supabase project — handy for design work.)

### 5. Deploy `dist/`

Drop the `dist/` directory on any static host. The app makes all API calls
from the browser; no server-side rendering is needed.

## Security model

- **Email/password auth** via Supabase Auth (GoTrue). The anon key ships in
  the JS bundle — that's by design, RLS is what actually authorizes access.
- **The `service_role` key is server-side only.** It is never loaded by
  the frontend and must never be committed to this repo.
- **Row-Level Security** on every public table:
  - `entries` has `SELECT/INSERT/UPDATE/DELETE` policies scoped to
    `user_id = auth.uid()` (with `FORCE ROW LEVEL SECURITY` so the table
    owner doesn't bypass).
  - `profiles` has matching `SELECT/INSERT/UPDATE` for the owning user.
- **Storage** — `journal-images` is a private bucket. Files are stored
  under `<user_id>/<uuid>.<ext>` and RLS restricts every operation to the
  owning user's folder. The frontend signs URLs on demand (1h TTL) for
  display, so signed URLs are the only thing ever exposed in the DOM.
- **Markdown** is parsed with `marked`, then sanitized through `DOMPurify`
  with a tight allow-list (no `<script>`, no `on*` handlers, no
  `javascript:` URLs). The DOMPurify allow-list explicitly permits `span`
  and `class` so `highlight.js` token classes survive sanitization.

## Features

- **Email/password** sign up + sign in
- **Timeline** of entries grouped by date (Today / Yesterday / formatted date)
- **Client-side search** (title or body, case-insensitive)
- **Full markdown editor** with `Write` / `Preview` tabs
- **Syntax highlighting** in code blocks (JS, Python, Bash, JSON, HTML,
  CSS, SQL, TS, YAML, Markdown — anything highlight.js's common bundle
  knows)
- **Image attachments** — file picker, multi-upload, thumbnail grid,
  per-image remove
- **Read view** — click an entry to read; Edit / Delete in the footer
- **Edit** — same screen, plus a back-to-reader after save
- **Delete** with confirm, plus best-effort cleanup of attached images
- **Light / dark theme** toggle, persisted in `localStorage`, follows OS
  preference on first visit
- **Responsive** down to ~360 px wide

## Architecture notes

- **No build step.** Every JS file is a native ES module. The two
  non-vendor libs (`marked` and `DOMPurify`) load on demand via dynamic
  `import()` from a CDN, cached by the browser.
- **The "old" route** `#/entry/<id>` is the reader. The editor lives at
  `#/entry/<id>/edit`. The hash router in `app.js` parses both and
  dispatches to the right view.
- **Image uploads** go through `supabase.storage.from(BUCKET).upload()`,
  then signed URLs are minted in a single batch for the timeline to
  avoid one round-trip per image.
- **The image-signing flow is epoch-guarded** so an in-flight signing
  from a previous paint can't repaint the timeline after the user has
  navigated away.

## License

MIT — do whatever you want.
