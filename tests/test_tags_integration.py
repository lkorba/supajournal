#!/usr/bin/env python3
"""
Integration tests for v2 tags feature against the live Supabase project.

Run: python3 tests/test_tags_integration.py

Covers:
  - Tag CRUD round-trip (create, list, delete)
  - createTag is idempotent (same name returns same row)
  - setEntryTags replaces the full set
  - entry → tags embed works (read with .tags relation)
  - listEntries can be filtered by tag
  - RLS: user A's tags are invisible to user B
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
        # Cloudflare blocks the default urllib UA.
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
    email = f"v2tag+{tag}+{int(time.time() * 1000)}@journal-test.com"
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
def test_create_and_list_tags(user: Dict[str, Any]) -> Dict[str, Any]:
    print("test_create_and_list_tags")
    code, t1 = _request(
        "POST", "/rest/v1/tags", token=user["token"], prefer="return=representation",
        body={"user_id": user["user_id"], "name": "travel"},
    )
    check_eq("create travel returns 201", code, 201)
    if isinstance(t1, list) and t1: t1 = t1[0]
    code, t2 = _request(
        "POST", "/rest/v1/tags", token=user["token"], prefer="return=representation",
        body={"user_id": user["user_id"], "name": "work"},
    )
    if isinstance(t2, list) and t2: t2 = t2[0]
    code, t3 = _request(
        "POST", "/rest/v1/tags", token=user["token"], prefer="return=representation",
        body={"user_id": user["user_id"], "name": "family"},
    )
    if isinstance(t3, list) and t3: t3 = t3[0]
    code, listed = _request(
        "GET", "/rest/v1/tags?select=*&order=name.asc", token=user["token"],
    )
    check_eq("list tags returns 200", code, 200)
    check("user has 3 tags", len(listed) == 3, f"got {len(listed)}")
    names = [t["name"] for t in listed]
    check_eq("tags sorted alphabetically", names, ["family", "travel", "work"])
    return {"travel": t1, "work": t2, "family": t3}


def test_idempotent_create(user: Dict[str, Any]) -> None:
    print("test_idempotent_create")
    # Idempotency is provided by the JS `createTag` (uses upsert with
    # ignoreDuplicates). The REST layer raises 409 on a duplicate, so
    # the user-facing path catches that and re-reads the existing row.
    # We assert both halves of the contract here: the second REST
    # insert is rejected, and a re-read of the same name returns the
    # original row.
    code1, t1 = _request(
        "POST", "/rest/v1/tags", token=user["token"], prefer="return=representation",
        body={"user_id": user["user_id"], "name": "Recipes"},
    )
    if isinstance(t1, list) and t1: t1 = t1[0]
    check_eq("first create returns 201", code1, 201)
    code2, body2 = _request(
        "POST", "/rest/v1/tags", token=user["token"], prefer="return=representation",
        body={"user_id": user["user_id"], "name": "Recipes"},
    )
    check_eq("second create returns 409 (duplicate)", code2, 409)
    # A re-read of the same name returns the original row.
    code3, rows = _request(
        "GET", "/rest/v1/tags?name=eq.Recipes&select=*", token=user["token"]
    )
    check_eq("re-read returns 200", code3, 200)
    check("re-read returns the original row", len(rows) == 1 and rows[0]["id"] == t1["id"],
          f"rows={rows}")


def test_assign_tags_to_entry(
    user: Dict[str, Any], tags: Dict[str, Any]
) -> Dict[str, Any]:
    print("test_assign_tags_to_entry")
    code, entry = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "title": "Sintra day trip",
            "body": "Drove to Sintra, hiked around, ate too much.",
            "entry_date": "2026-07-20",
        },
    )
    if isinstance(entry, list) and entry: entry = entry[0]
    entry_id = entry["id"]
    # Insert two entry_tags links.
    code, _ = _request(
        "POST", "/rest/v1/entry_tags", token=user["token"], prefer="return=minimal",
        body=[
            {"entry_id": entry_id, "tag_id": tags["travel"]["id"]},
            {"entry_id": entry_id, "tag_id": tags["family"]["id"]},
        ],
    )
    check_eq("insert entry_tags returns 201", code, 201)
    return entry


def test_entry_tags_embed(user: Dict[str, Any], entry: Dict[str, Any]) -> None:
    print("test_entry_tags_embed")
    # Read the entry with the embed. PostgREST expects
    # `entry_tags(tag:tags(*))` to nest a `tag` object inside each
    # entry_tags row.
    code, rows = _request(
        "GET",
        "/rest/v1/entries?select=id,entry_tags(tag:tags(id,name))"
        f"&id=eq.{entry['id']}",
        token=user["token"],
    )
    check_eq("get entry with embed returns 200", code, 200)
    check("got 1 row", len(rows) == 1, f"got {len(rows)}")
    if len(rows) == 1:
        ets = rows[0].get("entry_tags") or []
        names = sorted([et["tag"]["name"] for et in ets])
        check_eq("embedded tags are family + travel", names, ["family", "travel"])


def test_filter_entries_by_tag(
    user: Dict[str, Any], entry: Dict[str, Any], tags: Dict[str, Any]
) -> None:
    print("test_filter_entries_by_tag")
    # Create a second entry tagged with `work` only.
    code, e2 = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "title": "Sprint planning",
            "body": "Roadmap, capacity, deps.",
            "entry_date": "2026-07-21",
        },
    )
    if isinstance(e2, list) and e2: e2 = e2[0]
    code, _ = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "title": "Standup",
            "body": "Status updates.",
            "entry_date": "2026-07-22",
        },
    )
    if isinstance(_, list) and _: _ = _[0]
    _request(
        "POST", "/rest/v1/entry_tags", token=user["token"], prefer="return=minimal",
        body=[{"entry_id": e2["id"], "tag_id": tags["work"]["id"]}],
    )
    # Filter entries by travel tag. With the embed, PostgREST needs
    # both the select to mention the join and the where to use the
    # qualified column. The `!inner` hint restricts the parent rows to
    # those that have at least one matching entry_tag.
    code, rows = _request(
        "GET",
        f"/rest/v1/entries?select=id,entry_tags!inner(tag:tags(id,name))"
        f"&entry_tags.tag_id=eq.{tags['travel']['id']}"
        f"&order=entry_date.desc",
        token=user["token"],
    )
    check_eq("filter by tag returns 200", code, 200)
    ids = [r["id"] for r in (rows or [])]
    check("filter includes the travel entry", entry["id"] in ids, f"ids={ids}")
    check("filter excludes the work entry", e2["id"] not in ids, f"ids={ids}")


def test_rls_tag_isolation() -> None:
    print("test_rls_tag_isolation")
    alice = make_user("alice")
    bob = make_user("bob")
    code, at = _request(
        "POST", "/rest/v1/tags", token=alice["token"], prefer="return=representation",
        body={"user_id": alice["user_id"], "name": "alice-private"},
    )
    if isinstance(at, list) and at: at = at[0]
    check_eq("alice creates tag", code, 201)
    # Bob's list should not include it.
    code2, bob_tags = _request(
        "GET", "/rest/v1/tags?select=*", token=bob["token"]
    )
    check("bob cannot see alice's tag",
          not any(t["id"] == at["id"] for t in (bob_tags or [])),
          f"bob sees {bob_tags!r}")
    # Bob cannot delete it.
    code3, _ = _request(
        "DELETE", f"/rest/v1/tags?id=eq.{at['id']}", token=bob["token"]
    )
    check("bob's delete on alice's tag is rejected", code3 in (204, 404),
          f"code={code3}")
    code4, alice_tags = _request(
        "GET", f"/rest/v1/tags?id=eq.{at['id']}", token=alice["token"]
    )
    check("alice's tag still exists", len(alice_tags or []) == 1, str(alice_tags))


def test_set_tags_replaces_full_set(
    user: Dict[str, Any], entry: Dict[str, Any], tags: Dict[str, Any]
) -> None:
    print("test_set_tags_replaces_full_set")
    # Reset: keep only the `work` tag on the entry. Family + travel
    # should disappear.
    _request(
        "DELETE", f"/rest/v1/entry_tags?entry_id=eq.{entry['id']}",
        token=user["token"],
    )
    _request(
        "POST", "/rest/v1/entry_tags", token=user["token"], prefer="return=minimal",
        body=[{"entry_id": entry["id"], "tag_id": tags["work"]["id"]}],
    )
    code, rows = _request(
        "GET",
        f"/rest/v1/entries?select=id,entry_tags(tag:tags(name))"
        f"&id=eq.{entry['id']}",
        token=user["token"],
    )
    check_eq("read after replace returns 200", code, 200)
    if rows:
        names = sorted([et["tag"]["name"] for et in (rows[0].get("entry_tags") or [])])
        check_eq("only work remains on the entry", names, ["work"])


def test_delete_tag_cascades_entry_tags(
    user: Dict[str, Any], entry: Dict[str, Any]
) -> None:
    print("test_delete_tag_cascades_entry_tags")
    # Find a tag on the entry.
    code, rows = _request(
        "GET",
        f"/rest/v1/entry_tags?entry_id=eq.{entry['id']}&select=tag_id",
        token=user["token"],
    )
    if not rows:
        check("entry still has a tag to delete", False, "no entry_tags rows")
        return
    tag_id = rows[0]["tag_id"]
    code, _ = _request("DELETE", f"/rest/v1/tags?id=eq.{tag_id}", token=user["token"])
    check_eq("delete tag returns 204", code, 204)
    # Verify the link row is gone.
    code2, rows2 = _request(
        "GET",
        f"/rest/v1/entry_tags?entry_id=eq.{entry['id']}",
        token=user["token"],
    )
    check_eq("no entry_tags remain for that tag", code2, 200)
    # No row for that tag_id should remain.
    check("entry_tags links are cleaned up",
          not any(r["tag_id"] == tag_id for r in (rows2 or [])),
          f"rows2={rows2}")


def main() -> int:
    print(f"Running tags integration tests against {URL}\n")
    user = make_user("tags")
    tags = test_create_and_list_tags(user)
    test_idempotent_create(user)
    entry = test_assign_tags_to_entry(user, tags)
    test_entry_tags_embed(user, entry)
    test_filter_entries_by_tag(user, entry, tags)
    test_set_tags_replaces_full_set(user, entry, tags)
    test_delete_tag_cascades_entry_tags(user, entry)
    test_rls_tag_isolation()
    print()
    print(f"=== {PASS} passed, {FAIL} failed ===")
    if FAILED_TESTS:
        print("Failures:")
        for t in FAILED_TESTS:
            print(f"  - {t}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
