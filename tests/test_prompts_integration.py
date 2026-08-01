#!/usr/bin/env python3
"""
Integration tests for the v2 prompts feature.

Run: python3 tests/test_prompts_integration.py

Covers:
  - GET /rest/v1/prompts returns the 12 seeded rows for an
    authenticated user
  - All returned rows have is_active=true
  - The rows are ordered by sort_order
  - An unauthenticated request is rejected (the table is RLS'd
    to authenticated)
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
    email = f"v2prompt+{tag}+{int(time.time() * 1000)}@journal-test.com"
    password = "TestPass123!Secret"
    code, body = _request(
        "POST", "/auth/v1/signup",
        body={"email": email, "password": password},
    )
    assert code in (200, 201), f"signup failed: {code} {body}"
    return {"email": email, "token": body["access_token"]}


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


def test_list_prompts_authenticated(user):
    print("test_list_prompts_authenticated")
    code, rows = _request(
        "GET", "/rest/v1/prompts?select=*&order=sort_order.asc",
        token=user["token"],
    )
    check_eq("GET /prompts returns 200", code, 200)
    check("returns at least the 12 seeded prompts",
          len(rows or []) >= 12, f"got {len(rows or [])}")
    if rows:
        check("all rows are active",
              all(r["is_active"] is True for r in rows),
              f"non-active rows: {[r for r in rows if not r['is_active']]}")
        # Sort order should be ascending
        orders = [r["sort_order"] for r in rows]
        check("sort_order is ascending", orders == sorted(orders),
              f"got {orders}")
        # Categories should be a meaningful mix
        cats = {r["category"] for r in rows}
        check("at least 3 different categories", len(cats) >= 3, f"got {cats}")


def test_prompts_unauthenticated():
    print("test_prompts_unauthenticated")
    # No Authorization header — only the apikey is sent. The
    # `prompts_select_all` policy is `TO authenticated`, so this
    # should return 0 rows (or 401 depending on PostgREST config).
    code, rows = _request("GET", "/rest/v1/prompts?select=id")
    # Some PostgREST versions return 401 for TO authenticated when
    # the user is anon; others return 200 with an empty array.
    if code == 200:
        check("unauthenticated gets 0 rows", len(rows or []) == 0, f"got {len(rows or [])}")
    else:
        check("unauthenticated is rejected", code in (401, 403), f"code={code}")


def test_prompts_have_text():
    print("test_prompts_have_text")
    user = make_user("text")
    code, rows = _request(
        "GET", "/rest/v1/prompts?select=text&limit=1", token=user["token"]
    )
    check_eq("returns 200", code, 200)
    check("got a row", len(rows or []) == 1, f"got {len(rows or [])}")
    if rows:
        check("text is non-empty", len(rows[0].get("text", "")) > 0,
              f"text={rows[0].get('text')!r}")


def main():
    print(f"Running prompts integration tests against {URL}\n")
    user = make_user("prm")
    test_list_prompts_authenticated(user)
    test_prompts_unauthenticated()
    test_prompts_have_text()
    print()
    print(f"=== {PASS} passed, {FAIL} failed ===")
    if FAILED_TESTS:
        print("Failures:")
        for t in FAILED_TESTS:
            print(f"  - {t}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
