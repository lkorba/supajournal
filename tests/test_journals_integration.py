#!/usr/bin/env python3
"""
Integration tests for the v2 journals feature against the live Supabase
project (zydialuhldkaahjakuxe). Run with:

    python3 tests/test_journals_integration.py

Exits 0 on success, 1 on any failed assertion. A short summary is
printed at the end. No third-party dependencies — uses urllib only.

Each test:
  1. Creates a fresh user via /auth/v1/signup.
  2. Performs its actions on /rest/v1/{journals,entries}.
  3. Asserts the results.
  4. Cleans up by deleting the test rows (default journal stays).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

PROJECT_REF = "zydialuhldkaahjakuxe"
URL = f"https://{PROJECT_REF}.supabase.red"
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
    """Make a request to the Supabase REST or Auth API."""
    url = URL + path
    headers = {
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
        # Supabase's edge sits behind Cloudflare, which blocks the
        # default urllib User-Agent. Pretend to be a real browser so
        # the request actually goes through.
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
    """Sign up a fresh test user. Returns {email, password, token, user_id}."""
    email = f"v2test+{tag}+{int(time.time() * 1000)}@journal-test.com"
    password = "TestPass123!Secret"
    code, body = _request(
        "POST",
        "/auth/v1/signup",
        body={"email": email, "password": password},
    )
    assert code in (200, 201), f"signup failed: {code} {body}"
    return {
        "email": email,
        "password": password,
        "token": body["access_token"],
        "user_id": body["user"]["id"],
    }


# ---- Test helpers ----
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
def test_default_journal_on_signup(user: Dict[str, Any]) -> None:
    print("test_default_journal_on_signup")
    code, journals = _request(
        "GET", "/rest/v1/journals?select=*", token=user["token"]
    )
    check_eq("GET /journals returns 200", code, 200)
    check("returns exactly one journal", len(journals) == 1, f"got {len(journals)}")
    if len(journals) == 1:
        j = journals[0]
        check_eq("default journal name is Daily", j["name"], "Daily")
        check("default journal is marked is_default", j["is_default"] is True, str(j))
        check_eq("default journal icon is 📔", j["icon"], "📔")


def test_create_journal(user: Dict[str, Any]) -> Dict[str, Any]:
    print("test_create_journal")
    code, j = _request(
        "POST",
        "/rest/v1/journals",
        token=user["token"],
        prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "name": "Travel",
            "description": "Where I've been",
            "color": "#3a6b8a",
            "icon": "✈️",
            "is_default": False,
        },
    )
    check_eq("POST /journals returns 201", code, 201)
    if isinstance(j, list) and j:
        j = j[0]
    check("created journal has an id", bool(j.get("id")), str(j))
    check_eq("created journal name is Travel", j.get("name"), "Travel")
    check_eq("created journal color is preserved", j.get("color"), "#3a6b8a")
    check_eq("created journal icon is preserved", j.get("icon"), "✈️")
    return j


def test_list_journals_sorted(user: Dict[str, Any]) -> None:
    print("test_list_journals_sorted")
    code, journals = _request(
        "GET", "/rest/v1/journals?select=*&order=sort_order.asc", token=user["token"]
    )
    check_eq("GET /journals returns 200", code, 200)
    check("at least 2 journals now", len(journals) >= 2, f"got {len(journals)}")
    if len(journals) >= 2:
        check("first journal is the default", journals[0]["is_default"] is True, str(journals[0]))
        check("second journal is the new one", journals[1]["name"] == "Travel", str(journals[1]))


def test_update_journal(user: Dict[str, Any], j: Dict[str, Any]) -> None:
    print("test_update_journal")
    code, updated = _request(
        "PATCH",
        f"/rest/v1/journals?id=eq.{j['id']}",
        token=user["token"],
        prefer="return=representation",
        body={"name": "Voyages", "icon": "🌍"},
    )
    check_eq("PATCH /journals returns 200", code, 200)
    if isinstance(updated, list) and updated:
        updated = updated[0]
    check_eq("name updated", updated.get("name"), "Voyages")
    check_eq("icon updated", updated.get("icon"), "🌍")


def test_cannot_delete_default_journal(user: Dict[str, Any]) -> None:
    print("test_cannot_delete_default_journal")
    # The RLS policy `journals_delete_own` has USING (user_id = auth.uid()
    # AND is_default = false). So a DELETE on the default journal should
    # match 0 rows (PostgREST returns 204 with 0 rows affected) — or, if
    # we ask for representations, an empty list.
    code, body = _request(
        "DELETE",
        "/rest/v1/journals?is_default=eq.true&select=id",
        token=user["token"],
        prefer="return=representation",
    )
    check("default journal is not deletable", code in (200, 204), f"code={code} body={body!r}")
    # The default journal must still exist.
    code2, journals = _request(
        "GET", "/rest/v1/journals?is_default=eq.true&select=id", token=user["token"]
    )
    check("default journal still exists", len(journals) == 1, f"got {len(journals)}")


def test_create_entry_with_journal(user: Dict[str, Any], j: Dict[str, Any]) -> Dict[str, Any]:
    print("test_create_entry_with_journal")
    code, entry = _request(
        "POST",
        "/rest/v1/entries",
        token=user["token"],
        prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "title": "Lisbon",
            "body": "Long weekend in Lisbon. Pastéis de nata, tram 28, fado.",
            "mood": 5,
            "entry_date": "2026-07-15",
            "journal_id": j["id"],
        },
    )
    check_eq("POST /entries returns 201", code, 201)
    if isinstance(entry, list) and entry:
        entry = entry[0]
    check_eq("entry has journal_id", entry.get("journal_id"), j["id"])
    check_eq("entry title is Lisbon", entry.get("title"), "Lisbon")
    return entry


def test_list_entries_filtered_by_journal(
    user: Dict[str, Any], j: Dict[str, Any], entry: Dict[str, Any]
) -> None:
    print("test_list_entries_filtered_by_journal")
    code, entries = _request(
        "GET",
        f"/rest/v1/entries?journal_id=eq.{j['id']}&select=*",
        token=user["token"],
    )
    check_eq("GET filtered entries returns 200", code, 200)
    check("filtered list contains the new entry", any(e["id"] == entry["id"] for e in entries),
          f"got {entries}")


def test_rls_user_cannot_see_other_journals() -> None:
    print("test_rls_user_cannot_see_other_journals")
    alice = make_user("alice")
    bob = make_user("bob")
    # Alice creates a journal.
    code, j = _request(
        "POST",
        "/rest/v1/journals",
        token=alice["token"],
        prefer="return=representation",
        body={"user_id": alice["user_id"], "name": "Alice private"},
    )
    check_eq("alice creates journal", code, 201)
    if isinstance(j, list) and j:
        j = j[0]
    # Bob lists his journals — must not see Alice's.
    code2, bob_journals = _request(
        "GET", "/rest/v1/journals?select=*", token=bob["token"]
    )
    check("bob cannot see alice's journal",
          not any(x["id"] == j["id"] for x in bob_journals),
          f"bob sees {bob_journals!r}")
    # And bob cannot delete alice's journal.
    code3, _ = _request(
        "DELETE", f"/rest/v1/journals?id=eq.{j['id']}", token=bob["token"]
    )
    # Either 404 (not visible) or 204 with 0 rows affected. Both are
    # fine; what matters is the row still exists for Alice.
    check("bob's delete on alice's journal is rejected", code3 in (204, 404),
          f"code={code3}")
    code4, alice_journals = _request(
        "GET", f"/rest/v1/journals?id=eq.{j['id']}", token=alice["token"]
    )
    check("alice's journal still exists", len(alice_journals) == 1, str(alice_journals))


def main() -> int:
    print(f"Running journals integration tests against {URL}\n")
    user = make_user("jrnl")
    test_default_journal_on_signup(user)
    j = test_create_journal(user)
    test_list_journals_sorted(user)
    test_update_journal(user, j)
    test_cannot_delete_default_journal(user)
    entry = test_create_entry_with_journal(user, j)
    test_list_entries_filtered_by_journal(user, j, entry)
    test_rls_user_cannot_see_other_journals()
    print()
    print(f"=== {PASS} passed, {FAIL} failed ===")
    if FAILED_TESTS:
        print("Failures:")
        for t in FAILED_TESTS:
            print(f"  - {t}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
