# Integration Report — Quiet Journal

**Live URL:** https://ptk2cvwqbglw7.space.minimax.io
**Repo:** https://github.com/lkorba/supajournal
**Date:** 2026-08-01

## What shipped

A DayOne-style web journal: email/password auth, timeline of entries
grouped by date, full-content cards with markdown + image previews,
search, new/edit/delete entries, mood selector (1–5), dark/light theme
toggle, mobile-responsive.

| Layer | Stack |
|---|---|
| Database | Postgres 17 (Supabase) on `*.supabase.red` |
| Auth | Supabase Auth (GoTrue) — email/password, autoconfirm enabled |
| Frontend | Vanilla HTML + ES modules + Supabase JS (CDN), no build step |
| Markdown | `marked` + `DOMPurify` + `highlight.js` (theme-aware) |
| Images | Supabase Storage, private bucket + signed URLs |
| Hosting | Static deploy (`dist/`) |

## Live URL

The current deployment is at:

**https://ptk2cvwqbglw7.space.minimax.io**

(Six earlier deployment URLs were retired; only the current one is live.)

## Schema and RLS

Two tables, both with **FORCE ROW LEVEL SECURITY**:

- `public.profiles` — auto-created on signup via trigger `handle_new_user`
- `public.entries` — user_id, title, body, mood (1–5), entry_date,
  image_paths (text[]), timestamps

Seven policies, no `USING (true)`, no missing SELECT alongside UPDATE:

- `entries_select_own`, `entries_insert_own`, `entries_update_own`, `entries_delete_own`
- `profiles_select_own`, `profiles_insert_own`, `profiles_update_own`

Storage: one private bucket `journal-images` with four policies
(`select/insert/update/delete` scoped to `auth.uid()`'s folder).

The full SQL lives in [`schema.sql`](./schema.sql).

## End-to-end test results

Live HTTP results against the project's API:

| # | Check | Result |
|---|---|---|
| 1 | Sign up a fresh user | 200 (mailer_autoconfirm on) |
| 2 | Sign in | 200 + access_token |
| 3 | Insert entry with own `user_id` | 201 |
| 4 | Insert entry with **another** user's `user_id` | 403 RLS WITH CHECK violation |
| 5 | SELECT entries as user A | only user A's rows |
| 6 | PATCH another user's row | 0 rows updated (RLS blocks silently) |
| 7 | DELETE another user's row | 0 rows deleted |
| 8 | Upload to own folder in `journal-images` | 200, file stored |
| 9 | Upload to another user's folder | 403 RLS rejection |
| 10 | Signed URL generation | 422-char token returned |
| 11 | Cross-user image list | empty (RLS denies) |

For the exact test transcript and SQL, see
[`BACKEND_REPORT.md`](./BACKEND_REPORT.md) (with secrets redacted).

## Fixes applied during development

The app went through eight iterations during build. Notable fixes:

- **POST /entries sent a custom `id`** like `e-rv4ysgqt` (a mock-mode
  helper that leaked into live code). The DB rejected it with
  `invalid input syntax for type uuid: "e-rv4ysgqt"`. Fix: in live
  mode, omit `id`/`created_at`/`updated_at` so the DB defaults apply.
- **Image-signing caused an infinite re-render loop** — each `paint()`
  fired another `signImagePaths()` whose `.then()` called `paint()`
  again. Fix: hoist `signedUrlByPath` and a `signingInFlight` Set
  to the closure scope, plus a `paintEpoch` counter to ignore
  stale resolutions.
- **Signup rate-limited** — Supabase's email-sending limit was
  exceeded. Fix: enabled `mailer_autoconfirm` on the project so
  signups don't trigger an email round-trip.

## File map

```
/workspace/journal-app/
├── README.md                # setup walkthrough
├── schema.sql               # full database + storage setup
├── BACKEND_REPORT.md        # SQL transcript, secrets REDACTED
├── FRONTEND_REPORT.md       # UI implementation notes
├── INTEGRATION_REPORT.md    # this file
└── dist/                    # deployed to the live URL
    ├── index.html           # single page, hash router, config inline
    ├── app.js               # boot + router + session listener
    ├── auth.js              # login / signup / logout
    ├── config.js            # url + anon key injection
    ├── db.js                # entries CRUD
    ├── images.js            # storage upload + signed URL helpers
    ├── markdown.js          # marked + DOMPurify + highlight.js
    ├── supabase-client.js   # anon-key Supabase client
    ├── theme.js             # light/dark toggle
    ├── styles.css           # warm paper / warm dark
    └── views/
        ├── login.js
        ├── timeline.js
        ├── editor.js
        └── reader.js
```

## Try it

1. Open the live URL.
2. Sign up with any email + a 6+ char password — sign-in is immediate
   (autoconfirm on).
3. Write an entry, pick a mood, attach an image, save.
4. Click an entry on the timeline → read view. Edit or Delete from
   the card footer or the reader.
5. Toggle the theme (☾ / ☼) — choice persists across reloads.

## V2 ideas (not implemented)

- Tags + tag filter
- Calendar grid view
- Markdown extensions (footnotes, math, mermaid)
- End-to-end encryption of entry bodies
- PWA / offline support
- Custom domain
- Replace legacy anon JWT with the `sb_publishable_*` key on hosts
  that support it
