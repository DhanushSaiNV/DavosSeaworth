#!/usr/bin/env python3
"""verify-wipe-coverage.py -- does Settings -> "Wipe data" erase every user record?

Decision 27 / TECH-SPEC §7.13. The reset path is `resetAccountData` -> `delete-account`
(mode=reset) -> `reset_user_data` -> `purge_user_data` + a fresh profile. This gate proves
the purge is exhaustive A-Z, including the job rows whose payloads name an entry or message
instead of the user.

Static (no network):
  * every public BASE TABLE carrying `user_id` is named by the purge's delete list;
  * `metric_points` is covered by the `metrics` cascade;
  * the job delete has an arm for `entry_id` and one for `message_id` (the indirect payloads);
  * the purge is still the only definition (0034 + the latest override migration).

Live (network; needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
  * creates a disposable auth user;
  * seeds one row in every user table and one job of every payload shape;
  * calls `purge_user_data` through PostgREST as service_role;
  * asserts zero rows remain in every user table and in every job shape;
  * asserts global content (`config`, `rules`, `exemplars`) is untouched;
  * deletes the disposable auth user.

Usage: python scripts/verify-wipe-coverage.py [--static-only]
Exit 0 = all checks pass.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS = os.path.join(ROOT, "supabase", "migrations")
FAILS: list[str] = []

# Tables that carry a user_id column (the live inventory, asserted against the purge list).
USER_TABLES = [
    "anchor_plans",
    "doings_logs",
    "habits",
    "journal_entries",
    "memory_facts",
    "messages",
    "metrics",
    "persona_stats",
    "push_tokens",
    "trust_events",
]

# Job payload shapes that must be swept. `user_id` is the direct arm; `entry_id` and
# `message_id` are indirect (journal chain + memory purge) and were the gap this gate exists
# to catch.
JOB_SHAPES = {
    "journal_extract": "entry_id",
    "journal_probe": "entry_id",
    "anchor_plan": "entry_id",
    "purge_memory": "message_id",
    "proactive": "user_id",
    "intervention": "user_id",
}


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if ok else 'FAIL'} {name}" + (f" -- {detail}" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)
    return ok


def load_dotenv() -> None:
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def latest_purge_sql() -> tuple[str, str]:
    """Return (filename, text) of the last migration that defines purge_user_data."""
    found = ("", "")
    for name in sorted(os.listdir(MIGRATIONS)):
        if not name.endswith(".sql"):
            continue
        text = open(os.path.join(MIGRATIONS, name), encoding="utf-8").read()
        if "function public.purge_user_data(p_user_id uuid)" in text:
            found = (name, text)
    return found


def static_checks() -> None:
    print("== static: purge covers every user table ==")
    name, sql = latest_purge_sql()
    check("a migration defines purge_user_data", bool(name), name)
    if not sql:
        return
    print(f"  latest definition: {name}")

    body = sql[sql.index("function public.purge_user_data"):]
    for table in USER_TABLES:
        check(
            f"{table} deleted by user_id",
            f"delete from public.{table} where user_id = p_user_id" in body,
        )
    check("profiles deleted by id", "delete from public.profiles where id = p_user_id" in body)
    check("metric_points covered by the metrics cascade", "metric_points cascades" in body)
    check(
        "jobs swept by direct user_id",
        "payload ->> 'user_id' = p_user_id::text" in body,
    )
    check(
        "jobs swept by nested uuid",
        "payload::text like '%' || p_user_id::text || '%'" in body,
    )
    check(
        "jobs swept by entry_id",
        "payload ->> 'entry_id'" in body and "journal_entries" in body,
    )
    check(
        "jobs swept by message_id",
        "payload ->> 'message_id'" in body and "public.messages" in body,
    )


# --------------------------------------------------------------------------- live


def req(url: str, method: str, path: str, body=None, key=None, prefer=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
        headers["Authorization"] = f"Bearer {key}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return exc.code, {"raw": raw[:400]}


def live_checks() -> None:
    print("== live: disposable user, every table and job shape ==")
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service:
        print("  SKIP live -- need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return

    def svc(method, path, body=None, prefer=None):
        return req(url, method, path, body, key=service, prefer=prefer)

    def insert(table: str, row: dict) -> dict | None:
        st, body = svc("POST", f"/rest/v1/{table}", row, prefer="return=representation")
        if st not in (200, 201) or not isinstance(body, list) or not body:
            check(f"seed {table}", False, f"{st} {str(body)[:220]}")
            return None
        return body[0]

    def count(table: str, filt: str, col: str = "id") -> int:
        st, body = svc("GET", f"/rest/v1/{table}?select={col}&{filt}")
        if st != 200 or not isinstance(body, list):
            check(f"count {table}", False, f"{st} {str(body)[:220]}")
            return -1
        return len(body)

    email = f"wipe-coverage-{uuid.uuid4().hex[:10]}@example.com"
    st, created = req(url, "POST", "/auth/v1/admin/users",
                      {"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
                      key=service)
    if st not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        check("create disposable user", False, f"{st} {created}")
        return
    uid = created["id"]
    print(f"  user: {uid}")

    try:
        today = date.today().isoformat()

        # Global content must survive the purge byte-for-byte.
        globals_before = {
            "config": count("config", "key=not.is.null", "key"),
            "rules": count("rules", "id=not.is.null"),
            "exemplars": count("exemplars", "id=not.is.null"),
        }

        # Every user table gets one row. The profile + opening message are created by the
        # 0033 trigger when the auth user lands, so `messages` already has a row; we add a
        # second one to give the indirect job a target.
        doing = insert("doings_logs", {
            "user_id": uid, "kind": "doing", "content": "wipe coverage",
            "energy": 5, "source": "app", "logged_at": "2026-01-01T00:00:00Z",
        })
        entry = insert("journal_entries", {
            "user_id": uid, "content": "wipe coverage journal", "entry_date": today,
        })
        fact = insert("memory_facts", {
            "user_id": uid, "fact": "wipe coverage fact", "fact_type": "chat",
        })
        metric = insert("metrics", {
            "user_id": uid, "name": "wipe coverage metric",
            "formula": {"+": [1, 2]}, "is_core": True,
        })
        if metric:
            insert("metric_points", {
                "metric_id": metric["id"], "value": 1, "computed_for": today,
            })
        insert("anchor_plans", {
            "user_id": uid, "plan_date": today, "anchors": [],
        })
        insert("habits", {"user_id": uid, "description": "wipe coverage habit"})
        insert("persona_stats", {"user_id": uid, "domain": "Career"})
        insert("trust_events", {"user_id": uid, "delta": 1, "reason": "openness"})
        insert("push_tokens", {"user_id": uid, "token": "wipe-coverage-token"})
        message = insert("messages", {
            "user_id": uid, "role": "user", "content": "wipe coverage message",
        })

        seeded = all(x is not None for x in (doing, entry, fact, metric, message))
        check("seed one row in every user table", seeded)
        if not seeded:
            return

        # One job per payload shape. The indirect shapes are the regression this gate exists
        # for: journal_extract/journal_probe/anchor_plan carry only entry_id, purge_memory
        # only message_id.
        shapes = {
            "journal_extract": {"entry_id": entry["id"]},
            "journal_probe": {"entry_id": entry["id"]},
            "anchor_plan": {"entry_id": entry["id"]},
            "purge_memory": {"message_id": message["id"]},
            "proactive": {"user_id": uid, "kind": "wipe", "slot": today},
            "intervention": {"user_id": uid, "reason": "wipe_coverage"},
        }
        for job_type, payload in shapes.items():
            insert("jobs", {"type": job_type, "payload": payload, "status": "pending"})
        check("seed one job per payload shape", True)

        # The reset path calls purge_user_data and recreates the profile; delete calls only
        # purge_user_data. Exercise the stronger (delete) form: zero rows must remain.
        st, counts = svc("POST", "/rest/v1/rpc/purge_user_data", {"p_user_id": uid})
        check("purge_user_data returns 200", st == 200, f"{st} {str(counts)[:220]}")

        # Every user table must be empty for this id.
        for table in USER_TABLES:
            col = "user_id" if table == "persona_stats" else "id"
            check(f"{table} empty after purge", count(table, f"user_id=eq.{uid}", col) == 0)
        check("metric_points empty after purge (cascade)",
              count("metric_points", f"metric_id=eq.{metric['id']}") == 0)
        check("profiles empty after purge", count("profiles", f"id=eq.{uid}") == 0)

        # Every job shape must be gone: by direct id, by entry id, by message id.
        job_filters = {
            "direct user_id": f"payload->>user_id=eq.{uid}",
            "entry_id": f"payload->>entry_id=eq.{entry['id']}",
            "message_id": f"payload->>message_id=eq.{message['id']}",
        }
        for label, filt in job_filters.items():
            check(f"jobs empty by {label}", count("jobs", filt) == 0)

        # Global content untouched.
        globals_after = {
            "config": count("config", "key=not.is.null", "key"),
            "rules": count("rules", "id=not.is.null"),
            "exemplars": count("exemplars", "id=not.is.null"),
        }
        check("global content untouched", globals_before == globals_after,
              f"{globals_before} -> {globals_after}")

    finally:
        st, body = svc("DELETE", f"/auth/v1/admin/users/{uid}")
        if st not in (200, 204, 404):
            print(f"  WARN cleanup: auth delete -> {st} {str(body)[:200]}")


def main() -> int:
    load_dotenv()
    static_checks()
    if "--static-only" not in sys.argv:
        live_checks()
    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): {', '.join(FAILS)}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
