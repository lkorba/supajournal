# Integration Report — Quiet Journal

**Project ref:** `zydialuhldkaahjakuxe`
**Project URL:** `https://zydialuhldkaahjakuxe.supabase.red`
**Deployed:** https://o5qco1jz96rtj.space.minimax.io
**Date:** 2026-08-01

## What shipped

A DayOne-style web journal: email/password auth, timeline of entries
grouped by date, search, new/edit/delete entries, mood selector
(1–5), calm DayOne-inspired aesthetic, mobile-responsive, dark mode
respecting `prefers-color-scheme`.

| Layer | Stack |
|---|---|
| Database | Postgres 17 (Supabase) on `*.supabase.red` |
| Auth | Supabase Auth (GoTrue) — email/password |
| Frontend | Vanilla HTML + ES modules + Supabase JS (CDN), no build step |
| Hosting | Static deploy via `website_deploy` |

## Schema and RLS

Two tables, both with **FORCE ROW LEVEL SECURITY**:

- `public.profiles` — auto-created on signup via trigger `handle_new_user`
- `public.entries` — user_id, title, body, mood (1–5), entry_date, timestamps

Seven policies, no `USING (true)`, no missing SELECT alongside UPDATE:

- `entries_select_own`, `entries_insert_own`, `entries_update_own`, `entries_delete_own`
- `profiles_select_own`, `profiles_insert_own`, `profiles_update_own`

## End-to-end test results (live, on the correct project)

Two test users were created earlier by the backend task:

| Email | Password |
|---|---|
| `tester1+journal@supabase-journal-test.com` | `TestPass123!Secret` |
| `tester2+journal@supabase-journal-test.com` | `TestPass123!Secret` |

Live HTTP results after integration:

| # | Check | Result |
|---|---|---|
| 1 | tester1 INSERT entry with own `user_id` | 201 (row created) |
| 2 | tester1 SELECT entries | 2 rows, both `user_id = tester1` |
| 3 | tester2 INSERT entry with own `user_id` | 201 |
| 4 | tester2 SELECT entries | 1 row, `user_id = tester2` |
| 5 | tester1 PATCH tester2's row | HTTP 204, 0 rows updated |
| 6 | tester2 SELECT — title still `T2 from E2E` (unchanged) | ✅ |
| 7 | Cross-user SELECT isolation: tester1 sees 2 rows, tester2 sees 1 row | ✅ |
| 8 | `service_role` key not present in any shipped JS file | ✅ (only in safety comments) |
| 9 | Project count on `api.supabase.green`: still 80 | ✅ no collateral damage |
| 10 | Anon key in deployed page decodes to `ref: zydialuhldkaahjakuxe`, `role: anon` | ✅ |

## Fix vs. the original backend report

The backend report's `BACKEND_REPORT.md` documented the wrong anon
key — it was for a different project (`zwhialuhldkaahjakuxe` instead
of `zydialuhldkaahjakuxe`). The schema was applied to the correct
project, but the report had a copy-paste error in section 1. The
correct anon key was re-fetched from `GET /v1/projects/{ref}/api-keys`
and verified to work end-to-end before deploy.

The service_role key never leaves the server side. The deployed JS
bundle only contains the anon key (which is designed to be public).

## File map

```
/workspace/journal-app/
├── BACKEND_REPORT.md        # schema + RLS + isolation test results
├── FRONTEND_REPORT.md       # UI implementation notes
├── INTEGRATION_REPORT.md    # this file
├── E2E_LOG.md               # (optional) raw HTTP log
└── dist/                    # deployed to https://o5qco1jz96rtj.space.minimax.io
    ├── index.html           # single page, hash router, config inline
    ├── app.js               # boot + router + session listener
    ├── auth.js              # login / signup / logout
    ├── config.js            # url + anon key injection
    ├── db.js                # entries CRUD wrapper
    ├── supabase-client.js   # creates the anon-key Supabase client
    ├── styles.css           # calm DayOne aesthetic + dark mode
    └── views/
        ├── login.js
        ├── timeline.js
        └── editor.js
```

## Try it

1. Open https://o5qco1jz96rtj.space.minimax.io
2. Sign up with any email + a 6+ char password (real signup, sends
   confirmation email — check your inbox or disable email confirmation
   in the Supabase dashboard if you want immediate access)
3. Write your first entry, pick a mood, save
4. Sign out, sign in, your entries are still there
5. Sign up a second account, confirm there's no cross-user visibility

## V2 ideas (not implemented)

- Tags + tag filter
- Photo attachments via Supabase Storage (with RLS on `storage.objects`)
- Calendar grid view
- Markdown rendering
- End-to-end encryption of entry bodies
- PWA / offline support
- Custom domain
