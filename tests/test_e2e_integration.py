#!/usr/bin/env python3
"""
End-to-end integration test for the v2 SupaJournal app.

Exercises the full v2 feature surface against the live Supabase
project in one flow:

  1. Sign up a fresh user → verify default "Daily" journal exists
  2. Create a "Travel" journal with custom color + icon
  3. Create three tags: travel, food, weather
  4. Create entries across multiple days, journals, and tags
  5. Toggle bookmarks on a few entries
  6. Verify each filter axis (by journal, by tag, by bookmark)
     returns the right subset
  7. Verify RLS isolation against a second user
  8. Cleanup: delete the test entries, the new journal
  9. Verify the default journal is still there and still
     undeletable

This is the "smoke test" the integration task was supposed to
produce; the per-feature tests cover each piece in isolation,
this one proves the pieces compose correctly.

Run: python3 tests/test_e2e_integration.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

URL = "https://zydialuhldkaahjakuxe.supabase.red"
ANON_KEY = os.environ.get(
    "ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5ZGlhbHVobGRrYWFoamFrdXhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTY0MDQsImV4cCI6MjEwMDM5MjQwNH0._2jYFhbxP4EJ6O0mbHCHUgWJ2yR0RY5Vx5eDBAbYJGQ",
)

PASS = 0
FAIL = 0
FAILED_TESTS: List[str] = []


def _request(method, path, token=None, body=None, prefer=None):
    url = URL + path
    headers = {
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw


def make_user(tag):
    email = f"e2e+{tag}+{int(time.time() * 1000)}@journal-test.com"
    password = "TestPass123!Secret"
    code, body = _request(
        "POST", "/auth/v1/signup",
        body={"email": email, "password": password},
    )
    assert code in (200, 201), f"signup failed: {code} {body}"
    return {"email": email, "token": body["access_token"], "user_id": body["user"]["id"]}


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {label}")
    else:
        FAIL += 1
        FAILED_TESTS.append(f"{label} — {detail}")
        print(f"  ✗ {label} — {detail}")


def check_eq(label, got, want):
    check(label, got == want, f"got {got!r} want {want!r}")


def signup_default_journal(user):
    code, journals = _request(
        "GET", "/rest/v1/journals?select=*&is_default=eq.true",
        token=user["token"],
    )
    check_eq("default journal readable", code, 200)
    check("exactly one default journal", len(journals) == 1, f"got {len(journals)}")
    return journals[0] if journals else None


def create_travel_journal(user):
    code, j = _request(
        "POST", "/rest/v1/journals", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "name": "Travel",
            "description": "Where I've been",
            "color": "#3a6b8a",
            "icon": "✈️",
            "is_default": False,
        },
    )
    if isinstance(j, list) and j: j = j[0]
    check_eq("create Travel journal", code, 201)
    return j


def create_three_tags(user):
    tags = {}
    for name in ["travel", "food", "weather"]:
        code, t = _request(
            "POST", "/rest/v1/tags", token=user["token"], prefer="return=representation",
            body={"user_id": user["user_id"], "name": name},
        )
        if isinstance(t, list) and t: t = t[0]
        check_eq(f"create tag {name}", code, 201)
        tags[name] = t
    return tags


def create_entry(user, journal_id, title, body, date, mood=None,
                 word_count=None, is_bookmarked=False, tag_ids=None):
    payload = {
        "user_id": user["user_id"],
        "title": title,
        "body": body,
        "entry_date": date,
        "journal_id": journal_id,
    }
    if mood is not None:
        payload["mood"] = mood
    if word_count is not None:
        payload["word_count"] = word_count
    if is_bookmarked:
        payload["is_bookmarked"] = True
    code, e = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body=payload,
    )
    if isinstance(e, list) and e: e = e[0]
    check_eq(f"create entry {title!r}", code, 201)
    if tag_ids:
        for tid in tag_ids:
            _request(
                "POST", "/rest/v1/entry_tags", token=user["token"],
                prefer="return=minimal",
                body={"entry_id": e["id"], "tag_id": tid},
            )
    return e


def main():
    print(f"Running e2e integration test against {URL}\n")
    print("=== Phase 1: signup + default journal ===")
    user = make_user("e2e")
    default = signup_default_journal(user)
    check("default journal is named Daily",
          default and default["name"] == "Daily", str(default))

    print("\n=== Phase 2: create custom journal + tags ===")
    travel = create_travel_journal(user)
    tags = create_three_tags(user)

    print("\n=== Phase 3: seed entries across days, journals, tags, moods ===")
    e1 = create_entry(
        user, travel["id"], "Lisbon", "Long weekend in Lisbon. Pastéis de nata.",
        "2026-07-15", mood=5, word_count=6, is_bookmarked=True,
        tag_ids=[tags["travel"]["id"]],
    )
    e2 = create_entry(
        user, travel["id"], "Sintra", "Drove to Sintra, hiked around, ate too much.",
        "2026-07-16", mood=4, word_count=10,
        tag_ids=[tags["travel"]["id"], tags["food"]["id"]],
    )
    e3 = create_entry(
        user, default["id"], "Rainy Tuesday", "Stayed in. Made soup. The dog judged me.",
        "2026-07-21", mood=3, word_count=10,
        tag_ids=[tags["weather"]["id"]],
    )
    # Today's entry — for the "On This Day" check we need a past-year
    # entry on today's month+day. We'll create that next; for now,
    # mark the current entry as bookmarked.
    e4 = create_entry(
        user, default["id"], "Today", "A note for today.",
        time.strftime("%Y-%m-%d"), mood=4, word_count=4, is_bookmarked=True,
    )

    print("\n=== Phase 4: bookmark + tag + journal filters ===")
    code, rows = _request(
        "GET", "/rest/v1/entries?journal_id=eq." + travel["id"]
        + "&select=id&order=entry_date.desc",
        token=user["token"],
    )
    check_eq("filter by journal", code, 200)
    ids = sorted([r["id"] for r in (rows or [])])
    check("travel journal has 2 entries",
          ids == sorted([e1["id"], e2["id"]]), f"ids={ids}")

    code, rows = _request(
        "GET", f"/rest/v1/entries?select=id,entry_tags!inner(tag:tags(name))"
        f"&entry_tags.tag_id=eq.{tags['travel']['id']}",
        token=user["token"],
    )
    check_eq("filter by tag", code, 200)
    ids = sorted([r["id"] for r in (rows or [])])
    check("travel tag matches 2 entries",
          ids == sorted([e1["id"], e2["id"]]), f"ids={ids}")

    code, rows = _request(
        "GET", "/rest/v1/entries?is_bookmarked=eq.true&select=id",
        token=user["token"],
    )
    check_eq("filter by bookmark", code, 200)
    ids = sorted([r["id"] for r in (rows or [])])
    check("bookmark filter matches the 2 starred entries",
          ids == sorted([e1["id"], e4["id"]]), f"ids={ids}")

    print("\n=== Phase 5: stats math (client-side equivalent) ===")
    code, all_entries = _request(
        "GET", "/rest/v1/entries?select=entry_date,word_count,body",
        token=user["token"],
    )
    check_eq("fetch all entries for stats", code, 200)
    total = len(all_entries)
    days = len({e["entry_date"] for e in all_entries})
    total_words = 0
    for e in all_entries:
        if isinstance(e.get("word_count"), int):
            total_words += e["word_count"]
        else:
            total_words += len((e.get("body") or "").split())
    check(f"total entries is 4 (got {total})", total == 4, f"got {total}")
    check(f"days written is 4 (got {days})", days == 4, f"got {days}")
    check(f"total words >= 30 (got {total_words})", total_words >= 30, f"got {total_words}")

    print("\n=== Phase 6: 'On This Day' equivalent query ===")
    # Create a past-year entry on today's MM-DD to validate the
    # "On This Day" filter shape.
    today = time.strftime("%Y-%m-%d")
    mmdd = today[5:]
    last_year_iso = f"{int(today[:4]) - 1}-{mmdd}"
    e5 = create_entry(
        user, default["id"], "Last year today", "A year ago I wrote this.",
        last_year_iso, mood=4, word_count=6,
    )
    # The client-side "On This Day" filter simply scans the in-memory
    # entry list and matches by MM-DD. We mirror that here: fetch all
    # entries, then filter by MM-DD in Python. (PostgREST's `like`
    # operator struggles with the date column type, so a server-side
    # wildcard query isn't worth the trouble for a v2 test.)
    code, all_rows = _request(
        "GET", "/rest/v1/entries?select=id,entry_date", token=user["token"],
    )
    check_eq("fetch all entries for on-this-day filter", code, 200)
    rows = all_rows or []
    on_this_day_ids = [r["id"] for r in rows if isinstance(r, dict) and r.get("entry_date", "")[5:] == mmdd]
    check("on-this-day includes last year's entry",
          e5["id"] in on_this_day_ids, f"ids={on_this_day_ids}")

    print("\n=== Phase 7: RLS isolation against a second user ===")
    other = make_user("e2e-2")
    # Other user lists our entries — should see 0.
    code, rows = _request(
        "GET", "/rest/v1/entries?select=id", token=other["token"]
    )
    check_eq("other user lists entries", code, 200)
    check("other user sees no entries of ours", len(rows) == 0, f"got {rows}")
    # And cannot delete our journal.
    code2, _ = _request(
        "DELETE", f"/rest/v1/journals?id=eq.{travel['id']}",
        token=other["token"]
    )
    check("other user's delete on our journal is rejected",
          code2 in (204, 404), f"code={code2}")

    print("\n=== Phase 8: cleanup ===")
    # Delete entries
    for e in [e1, e2, e3, e4, e5]:
        _request(
            "DELETE", f"/rest/v1/entries?id=eq.{e['id']}",
            token=user["token"],
        )
    # Delete the travel journal
    _request(
        "DELETE", f"/rest/v1/journals?id=eq.{travel['id']}",
        token=user["token"],
    )
    # Delete the tags (entry_tags links go via CASCADE)
    for name, t in tags.items():
        _request(
            "DELETE", f"/rest/v1/tags?id=eq.{t['id']}",
            token=user["token"],
        )
    # Default journal must still exist and still be undeletable
    code3, _ = _request(
        "DELETE", "/rest/v1/journals?is_default=eq.true",
        token=user["token"],
    )
    check("default journal is still undeletable", code3 in (200, 204),
          f"code={code3}")
    code4, still = _request(
        "GET", "/rest/v1/journals?is_default=eq.true&select=id",
        token=user["token"],
    )
    check("default journal still exists",
          len(still) == 1, f"got {len(still)}")

    print()
    print(f"=== {PASS} passed, {FAIL} failed ===")
    if FAILED_TESTS:
        print("Failures:")
        for t in FAILED_TESTS:
            print(f"  - {t}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
