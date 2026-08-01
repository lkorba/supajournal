#!/usr/bin/env python3
"""
Integration tests for the v2 bookmarks feature.

Run: python3 tests/test_bookmarks_integration.py

Covers:
  - bookmark an entry (set is_bookmarked=true)
  - listEntries({onlyBookmarked:true}) returns only bookmarked rows
  - unbookmark returns the entry to the unfiltered list
  - toggle idempotency (read after write reflects new state)
  - RLS: another user cannot see / toggle my bookmarks
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


def _request(
    method: str,
    path: str,
    token: Optional[str] = None,
    body: Any = None,
    prefer: Optional[str] = None,
) -> Tuple[int, Any]:
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


def make_user(tag: str) -> Dict[str, Any]:
    email = f"v2bm+{tag}+{int(time.time() * 1000)}@journal-test.com"
    password = "TestPass123!Secret"
    code, body = _request(
        "POST", "/auth/v1/signup",
        body={"email": email, "password": password},
    )
    assert code in (200, 201), f"signup failed: {code} {body}"
    return {
        "email": email,
        "token": body["access_token"],
        "user_id": body["user"]["id"],
    }


def check(label: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {label}")
    else:
        FAIL += 1
        FAILED_TESTS.append(f"{label} — {detail}")
        print(f"  ✗ {label} — {detail}")


def check_eq(label: str, got: Any, want: Any) -> None:
    check(label, got == want, f"got {got!r} want {want!r}")


# ---- Tests ----
def make_entry(user: Dict[str, Any], title: str, body: str, date: str) -> str:
    code, e = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"], "title": title, "body": body,
            "entry_date": date,
        },
    )
    if isinstance(e, list) and e: e = e[0]
    return e["id"]


def test_bookmark_via_patch(user: Dict[str, Any]) -> str:
    print("test_bookmark_via_patch")
    eid = make_entry(user, "BM test", "Body", "2026-07-01")
    code, _ = _request(
        "PATCH", f"/rest/v1/entries?id=eq.{eid}",
        token=user["token"], prefer="return=minimal",
        body={"is_bookmarked": True},
    )
    check_eq("PATCH returns 204", code, 204)
    code, rows = _request(
        "GET", f"/rest/v1/entries?select=is_bookmarked&id=eq.{eid}",
        token=user["token"],
    )
    check_eq("read returns 200", code, 200)
    check("is_bookmarked is now true", rows and rows[0]["is_bookmarked"] is True,
          f"got {rows}")
    return eid


def test_list_only_bookmarked(
    user: Dict[str, Any], bookmarked_id: str
) -> None:
    print("test_list_only_bookmarked")
    # Add two more entries that are not bookmarked.
    a = make_entry(user, "plain A", "Body A", "2026-07-02")
    b = make_entry(user, "plain B", "Body B", "2026-07-03")
    # Filter on is_bookmarked=true.
    code, rows = _request(
        "GET", "/rest/v1/entries?is_bookmarked=eq.true&select=id",
        token=user["token"],
    )
    check_eq("filter returns 200", code, 200)
    ids = [r["id"] for r in (rows or [])]
    check("only the bookmarked entry is returned", ids == [bookmarked_id], f"ids={ids}")
    # And the unfiltered list still has all three.
    code, all_rows = _request(
        "GET", "/rest/v1/entries?select=id&order=entry_date.desc",
        token=user["token"],
    )
    check("unfiltered list has 3 entries", len(all_rows or []) == 3, f"got {len(all_rows or [])}")


def test_unbookmark(
    user: Dict[str, Any], bookmarked_id: str
) -> None:
    print("test_unbookmark")
    code, _ = _request(
        "PATCH", f"/rest/v1/entries?id=eq.{bookmarked_id}",
        token=user["token"], prefer="return=minimal",
        body={"is_bookmarked": False},
    )
    check_eq("PATCH returns 204", code, 204)
    code, rows = _request(
        "GET", f"/rest/v1/entries?is_bookmarked=eq.true&select=id",
        token=user["token"],
    )
    check_eq("filtered list is now empty", code, 200)
    check("no bookmarked rows remain", len(rows or []) == 0, f"got {rows}")


def test_toggle_pattern(
    user: Dict[str, Any], bookmarked_id: str
) -> None:
    print("test_toggle_pattern")
    # This mirrors what db.toggleBookmark() does in JS: read state,
    # flip, write. We verify the read/write loop is consistent.
    def get_flag(eid: str) -> bool:
        _, rows = _request(
            "GET", f"/rest/v1/entries?select=is_bookmarked&id=eq.{eid}",
            token=user["token"],
        )
        return bool(rows and rows[0]["is_bookmarked"])

    def set_flag(eid: str, v: bool) -> None:
        code, _ = _request(
            "PATCH", f"/rest/v1/entries?id=eq.{eid}",
            token=user["token"], prefer="return=minimal",
            body={"is_bookmarked": v},
        )
        assert code == 204, f"PATCH failed: {code}"

    # Currently unbookmarked (we just unbookmarked it).
    before = get_flag(bookmarked_id)
    check("current state is false", before is False, f"got {before}")
    # Toggle on.
    set_flag(bookmarked_id, not before)
    check_eq("read after toggle on is true", get_flag(bookmarked_id), True)
    # Toggle off.
    set_flag(bookmarked_id, False)
    check_eq("read after toggle off is false", get_flag(bookmarked_id), False)


def test_rls_bookmark_isolation() -> None:
    print("test_rls_bookmark_isolation")
    alice = make_user("alice")
    bob = make_user("bob")
    eid = make_entry(alice, "Alice's secret", "Body", "2026-07-04")
    _request(
        "PATCH", f"/rest/v1/entries?id=eq.{eid}",
        token=alice["token"], prefer="return=minimal",
        body={"is_bookmarked": True},
    )
    # Bob lists his own bookmarks: must not include alice's.
    code, rows = _request(
        "GET", "/rest/v1/entries?is_bookmarked=eq.true&select=id",
        token=bob["token"],
    )
    check("bob cannot see alice's bookmarked entry",
          not any(r["id"] == eid for r in (rows or [])),
          f"bob sees {rows!r}")
    # Bob cannot flip alice's flag.
    code2, _ = _request(
        "PATCH", f"/rest/v1/entries?id=eq.{eid}",
        token=bob["token"], prefer="return=minimal",
        body={"is_bookmarked": False},
    )
    # PATCH against a row not visible via RLS will match 0 rows and
    # return 204 with 0 rows affected (or 200/204 with Prefer
    # return=minimal). The row stays as alice left it.
    check("bob's PATCH is rejected or no-op", code2 in (200, 204), f"code={code2}")
    # Verify alice's row is still bookmarked.
    code3, rows3 = _request(
        "GET", f"/rest/v1/entries?select=is_bookmarked&id=eq.{eid}",
        token=alice["token"],
    )
    check("alice's bookmark is still on", rows3 and rows3[0]["is_bookmarked"] is True,
          f"got {rows3}")


def main() -> int:
    print(f"Running bookmarks integration tests against {URL}\n")
    user = make_user("bm")
    eid = test_bookmark_via_patch(user)
    test_list_only_bookmarked(user, eid)
    test_unbookmark(user, eid)
    test_toggle_pattern(user, eid)
    test_rls_bookmark_isolation()
    print()
    print(f"=== {PASS} passed, {FAIL} failed ===")
    if FAILED_TESTS:
        print("Failures:")
        for t in FAILED_TESTS:
            print(f"  - {t}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
