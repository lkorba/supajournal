#!/usr/bin/env python3
"""
Integration tests for the v2 word_count column on entries.

Run: python3 tests/test_wordcount_integration.py

Covers:
  - PATCH an entry with a word_count value
  - GET the entry back, verify the value
  - The value is also returned by listEntries
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple

URL = "https://zydialuhldkaahjakuxe.supabase.red"
ANON_KEY = os.environ.get(
    "ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5ZGlhbHVobGRrYWFoamFrdXhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTY0MDQsImV4cCI6MjEwMDM5MjQwNH0._2jYFhbxP4EJ6O0mbHCHUgWJ2yR0RY5Vx5eDBAbYJGQ",
)

PASS = 0
FAIL = 0
FAILED_TESTS = []


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
    email = f"v2wc+{tag}+{int(time.time() * 1000)}@journal-test.com"
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


def test_create_with_wordcount(user):
    print("test_create_with_wordcount")
    code, e = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "title": "Word count test",
            "body": "one two three four five",
            "entry_date": "2026-07-30",
            "word_count": 5,
        },
    )
    check_eq("create returns 201", code, 201)
    if isinstance(e, list) and e: e = e[0]
    check_eq("word_count round-trips", e.get("word_count"), 5)
    return e


def test_update_wordcount(user, eid):
    print("test_update_wordcount")
    code, _ = _request(
        "PATCH", f"/rest/v1/entries?id=eq.{eid}",
        token=user["token"], prefer="return=minimal",
        body={"word_count": 42},
    )
    check_eq("PATCH returns 204", code, 204)
    code, rows = _request(
        "GET", f"/rest/v1/entries?select=word_count&id=eq.{eid}",
        token=user["token"],
    )
    check_eq("GET returns 200", code, 200)
    check("read after update is 42", rows and rows[0]["word_count"] == 42, f"got {rows}")


def test_list_includes_wordcount(user, eid):
    print("test_list_includes_wordcount")
    code, rows = _request(
        "GET", f"/rest/v1/entries?select=id,word_count&id=eq.{eid}",
        token=user["token"],
    )
    check_eq("list returns 200", code, 200)
    check("word_count is in the projection", rows and "word_count" in rows[0],
          f"got {rows}")


def test_default_is_zero(user):
    print("test_default_is_zero")
    code, e = _request(
        "POST", "/rest/v1/entries", token=user["token"], prefer="return=representation",
        body={
            "user_id": user["user_id"],
            "title": "No word count",
            "body": "Body",
            "entry_date": "2026-07-31",
        },
    )
    if isinstance(e, list) and e: e = e[0]
    check_eq("default word_count is 0", e.get("word_count"), 0)


def main():
    print(f"Running word_count integration tests against {URL}\n")
    user = make_user("wc")
    e = test_create_with_wordcount(user)
    test_update_wordcount(user, e["id"])
    test_list_includes_wordcount(user, e["id"])
    test_default_is_zero(user)
    print()
    print(f"=== {PASS} passed, {FAIL} failed ===")
    if FAILED_TESTS:
        print("Failures:")
        for t in FAILED_TESTS:
            print(f"  - {t}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
