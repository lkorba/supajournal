# SupaJournal — Quiet

A DayOne-inspired journal web app: multi-journal notebooks, tags,
bookmarks, calendar view, "On This Day" memories, daily writing
prompts, word-count stats, and the same warm paper / dark theme
DayOne users love. All data is private — each user only sees their
own entries, enforced by Postgres RLS on the server.

Vanilla HTML + ES modules. No build step, no framework, ~50 KB of
app JS. Hosted as a static site; everything dynamic goes through
Supabase (auth, REST, Storage).

![light](https://img.shields.io/badge/theme-warm%20paper-f6efdc) ![dark](https://img.shields.io/badge/theme-warm%20dark-1a1714)

## Live demo

A reference deployment is at <https://4f5bl3w4amd5s.space.minimax.io>.
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
│   ├── db.js            # entries, journals, tags, prompts
│   ├── images.js        # storage upload + signed URL helpers
│   ├── journal-state.js # active-journal + cached journal list
│   ├── markdown.js      # marked + DOMPurify + highlight.js
│   ├── prompts-state.js # deterministic prompt-of-the-day picker
│   ├── supabase-client.js
│   ├── theme.js         # light/dark toggle
│   ├── styles.css
│   └── views/
│       ├── login.js
│       ├── timeline.js
│       ├── editor.js
│       ├── reader.js
│       ├── journals.js  # manage journals
│       └── calendar.js  # month grid
├── schema.sql           # full v1+v2 schema + RLS + storage setup
├── schema-v2.sql        # v2-only migration (idempotent)
├── tests/               # integration test suite (113 assertions)
│   ├── test_journals_integration.py
│   ├── test_tags_integration.py
│   ├── test_bookmarks_integration.py
│   ├── test_prompts_integration.py
│   ├── test_wordcount_integration.py
│   └── test_e2e_integration.py
├── scripts/             # repo tooling
│   ├── open_pr.sh
│   ├── open_pr.py
│   └── merge_pr.py
├── FRONTEND_REPORT.md   # UI implementation notes
├── INTEGRATION_REPORT.md  # deployment + E2E results
└── README.md
```

## Setup

### 1. Create a Supabase project

Use the Supabase dashboard or any Supabase-compatible host. Grab the
project URL and the `anon` JWT from the API keys panel.

### 2. Apply the schema

`schema.sql` is a single file containing tables, triggers, RLS, the
storage bucket, and storage RLS. Apply it via your host's SQL
endpoint, e.g.:

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

For an existing v1 database, just apply `schema-v2.sql` on top — all
statements are idempotent.

### 3. Optional: disable email confirmation (dev / self-host)

```bash
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mailer_autoconfirm": true}' \
  https://api.supabase.com/v1/projects/$REF/config/auth
```

Leave it off in production so users confirm their email before
signing in.

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

(`useMock: true` runs the app against an in-memory mock for local UI
demo without a Supabase project — handy for design work.)

### 5. Deploy `dist/`

Drop the `dist/` directory on any static host. The app makes all API
calls from the browser; no server-side rendering is needed.

## Security model

- **Email/password auth** via Supabase Auth (GoTrue). The anon key
  ships in the JS bundle — that's by design, RLS is what actually
  authorizes access.
- **The `service_role` key is server-side only.** It is never loaded
  by the frontend and must never be committed to this repo.
- **Row-Level Security** on every public table — all with
  `FORCE ROW LEVEL SECURITY` so the table owner doesn't bypass:
  - `entries`, `profiles`, `journals`, `tags`, `entry_tags` have
    `SELECT/INSERT/UPDATE/DELETE` policies scoped to the owning user.
  - `prompts` is read-only for `authenticated`; writes are admin-only.
- **Storage** — `journal-images` is a private bucket. Files are
  stored under `<user_id>/<uuid>.<ext>` and RLS restricts every
  operation to the owning user's folder. The frontend signs URLs on
  demand (1h TTL) for display.
- **Markdown** is parsed with `marked`, then sanitized through
  `DOMPurify` with a tight allow-list (no `<script>`, no `on*`
  handlers, no `javascript:` URLs). The allow-list explicitly
  permits `span` and `class` so `highlight.js` token classes survive
  sanitization.

## Features

### Writing
- **Email/password** sign up + sign in
- **Full markdown editor** with `Write` / `Preview` tabs
- **Image attachments** — file picker, multi-upload, thumbnail grid,
  per-image remove
- **Mood selector** — 1–5 with emoji labels
- **Word count** — live counter under the body, stored on save
- **Light / dark theme** toggle, persisted in `localStorage`,
  follows OS preference on first visit
- **Responsive** down to ~360 px wide

### Organization
- **Multiple journals** — per-user notebooks with custom color +
  icon. A "Daily" default journal is auto-created on signup.
- **Tags** — autocomplete from your existing tag library; click a
  chip on a card to filter the timeline by that tag
- **Bookmarks** — star an entry, filter the timeline to bookmarks only
- **Reorder** journals with ↑/↓ on the management page

### Discovery
- **Calendar view** (`#/calendar`) — month grid with entry counts
  per day, click a day to expand the entries inline
- **"On This Day"** — section on the timeline that surfaces entries
  from past years with the same month+day as today
- **Daily prompt** — on an empty timeline, shows a curated writing
  prompt and a "Start writing" button. The same user sees the same
  prompt across reloads.
- **Stats card** at the top of the timeline — total entries, total
  words, days written, current streak

### Search & filter
- **Client-side search** (title or body, case-insensitive)
- **Filter by journal** (header dropdown)
- **Filter by tag** (header dropdown)
- **Filter by bookmark** (header toggle)
- **Combined filters** — all three compose

## Architecture notes

- **No build step.** Every JS file is a native ES module. The
  non-vendor libs (marked, DOMPurify, highlight.js) load via CDN
  (`<script>` for highlight.js so it's ready before the app module).
- **Routes:** `#/` timeline, `#/new` editor (new entry),
  `#/entry/<id>` reader, `#/entry/<id>/edit` editor (existing),
  `#/journals` manage journals, `#/calendar` month grid.
- **Image uploads** go through `supabase.storage.from(BUCKET).upload()`,
  then signed URLs are minted in a single batch for the timeline to
  avoid one round-trip per image.
- **The image-signing flow is epoch-guarded** so an in-flight signing
  from a previous paint can't repaint the timeline after the user
  has navigated away.
- **The `entry_tags` link is a separate write** from the entry
  itself, so we can swap a tag set atomically without touching the
  entry row.

## Tests

113-assertion integration suite under `tests/`. Run with:

```bash
for t in tests/test_*.py; do python3 "$t"; done
```

- `test_journals_integration.py` — 28 assertions
- `test_tags_integration.py` — 24 assertions
- `test_bookmarks_integration.py` — 15 assertions
- `test_prompts_integration.py` — 9 assertions
- `test_wordcount_integration.py` — 8 assertions
- `test_e2e_integration.py` — 29 assertions (full feature flow)

Each test file runs against the live Supabase project and uses
freshly-signed-up users; the cleanup phase deletes what it created.

## License

MIT — do whatever you want.
