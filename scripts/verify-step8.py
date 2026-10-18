#!/usr/bin/env python3
"""Automate FP-02 Step 8 verification (sync degrade + llm_retry).

Covers PLAN Step 8 Verify: Degrade, Recover, Dead-letter, Structural, Inline fallback.
Reads/writes the same paths the functions read:
  adapter timeouts/kinds: supabase/functions/_shared/llm/adapter.ts:170
  degrade path: supabase/functions/send-message/index.ts:135
  retry handler: supabase/functions/job-dispatcher/index.ts:83

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  python scripts/verify-step8.py [--no-deadletter] [--trigger-dispatcher]

Env:
  SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)
  SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)
  SUPABASE_SERVICE_ROLE_KEY (required, never commit it)
  DAVOS_USER_JWT (optional: supplied, else minted via scripts/_mint_dev_jwt.py)

Notes:
  - Each send uses a fresh client_message_id so Step 5a dedupe never fires.
  - Dead-letter is accelerated by fast-forwarding jobs.next_retry_at between
    dispatcher triggers. Pass --no-deadletter to skip it (~8-10 min unaccelerated).
  - Config is snapshotted at start and restored in a finally block.
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

STEP8_KEYS = [
    "sync_degrade_reply",
    "malformed_fallback_reply",
    "llm_stub_mode",
    "llm_stub_malformed",
    "llm_force_fail",
    "llm_call_timeout_ms",
    "pipeline_deadline_ms",
    "job_dispatcher_budget_ms",
]

BASELINE = {
    "llm_stub_mode": False,
    "llm_stub_malformed": False,
    "llm_force_fail": "none",
}


def env(name, *alts):
    for k in (name,) + alts:
        if os.environ.get(k):
            return os.environ[k]
    return None


URL = (env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
ANON = env("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")
SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")
JWT = env("DAVOS_USER_JWT")

FAILURES = []


def check(name, cond, detail=""):
    print(
        ("  PASS " if cond else "  FAIL ")
        + name
        + (f" — {detail}" if detail and not cond else "")
    )
    if not cond:
        FAILURES.append(name)


def req(method, path, body=None, key=None, headers=None):
    url = URL + path
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
        h["Authorization"] = f"Bearer {key}"
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=140) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, {"raw": raw}


def rest(table, query, key):
    return (
        req(
            "GET",
            f"/rest/v1/{table}?{query}",
            key=key,
            headers={"Accept": "application/json"},
        )[1]
        or []
    )


def set_config(key_name, value):
    # config.value is jsonb; PostgREST PATCH with json body
    st, _ = req(
        "PATCH", f"/rest/v1/config?key=eq.{key_name}", {"value": value}, key=SERVICE
    )
    return st in (200, 204)


def get_configs():
    rows = rest("config", "select=key,value", SERVICE)
    return {r["key"]: r["value"] for r in rows}


def unwrap(v):
    # migration stores numbers as JSON numbers, strings as JSON strings
    return v


def send(content):
    cid = str(uuid.uuid4())
    st, body = req(
        "POST",
        "/functions/v1/send-message",
        {"content": content, "client_message_id": cid},
        key=ANON,
        headers={"Authorization": f"Bearer {JWT}"},
    )
    return st, body, cid


def assistant_rows(user_msg_id):
    q = (
        "select=id,content,reply_to_message_id,secondary_reply_to_message_id,metadata,created_at"
        f"&metadata->>user_message_id=eq.{user_msg_id}&order=created_at"
    )
    # PostgREST JSON selector needs URL-encoding of ->>; urllib handles via quote in req? build manually:
    path = (
        "/rest/v1/messages?select=id,content,reply_to_message_id,secondary_reply_to_message_id,metadata,created_at"
        + f"&metadata-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}&order=created_at"
    )
    return (
        req("GET", path, key=SERVICE, headers={"Accept": "application/json"})[1] or []
    )


def jobs_for_turn(user_msg_id):
    path = (
        "/rest/v1/jobs?select=id,type,status,attempts,last_error,payload,created_at"
        + f"&payload-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}&order=created_at.desc&limit=5"
    )
    return (
        req("GET", path, key=SERVICE, headers={"Accept": "application/json"})[1] or []
    )


def job_by_id(jid):
    rows = rest(
        "jobs",
        f"select=id,type,status,attempts,last_error,payload&id=eq.{jid}",
        SERVICE,
    )
    return rows[0] if rows else None


def trigger_dispatcher():
    st, body = req("POST", "/functions/v1/job-dispatcher", {}, key=SERVICE)
    return st, body


def fast_forward(jid):
    st, _ = req(
        "PATCH", f"/rest/v1/jobs?id=eq.{jid}", {"next_retry_at": "now()"}, key=SERVICE
    )
    # "now()" is not valid JSON for timestamptz via REST; fall back to ISO now
    if st not in (200, 204):
        from datetime import datetime, timezone

        iso = datetime.now(timezone.utc).isoformat()
        st, _ = req(
            "PATCH", f"/rest/v1/jobs?id=eq.{jid}", {"next_retry_at": iso}, key=SERVICE
        )
    return st


def wait_job_terminal(jid, timeout_s, accelerate=False):
    end = time.time() + timeout_s
    while time.time() < end:
        trigger_dispatcher()
        j = job_by_id(jid)
        if j and j["status"] in ("done", "dead"):
            return j
        if accelerate and j and j["status"] == "failed":
            fast_forward(jid)
        time.sleep(20)
    return job_by_id(jid)


try:
    # Sibling helper (scripts/ is sys.path[0]): the one place this gate picks the user JWT it
    # sends. It prints the token (source, sub, exp, verdict) and never returns one already
    # decoded as expired -- it mints a fresh one instead (owner request, 2026-10-17). When it
    # cannot produce a usable token the gate skips its authenticated legs rather than sending a
    # dead one, which is what used to surface as a wall of unexplained 401s.
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001
    resolve_gate_token = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-deadletter", action="store_true")
    ap.add_argument(
        "--trigger-dispatcher",
        action="store_true",
        help="trigger dispatcher ticks from this script (else rely on pg_cron)",
    )
    args = ap.parse_args()

    for v in (URL, ANON, SERVICE):
        if not v:
            print(
                "Missing env: need SUPABASE_URL, SUPABASE_ANON_KEY, "
                "SUPABASE_SERVICE_ROLE_KEY (the user JWT is minted automatically)"
            )
            sys.exit(2)

    global JWT
    if resolve_gate_token is not None:
        JWT, jwt_usable, _note = resolve_gate_token(JWT, URL, SERVICE, os.environ.get("DAVOS_USER_EMAIL"))
    else:
        print("  JWT   note   : _mint_dev_jwt.py unavailable -- using $DAVOS_USER_JWT as supplied")
        jwt_usable = bool(JWT)
    if not jwt_usable:
        print("  FAIL no usable DAVOS_USER_JWT -- refresh it or run `python scripts/_mint_dev_jwt.py`")
        FAILURES.append("no usable user JWT")
        sys.exit(1)

    print("== prereqs ==")
    cfg = get_configs()
    for k in STEP8_KEYS:
        check(f"config {k} present", k in cfg)
    if FAILURES:
        print("Fix missing keys first (migration 0021_llm_retry_config.sql), aborting.")
        sys.exit(1)
    degrade_text, malformed_text = (
        unwrap(cfg["sync_degrade_reply"]),
        unwrap(cfg["malformed_fallback_reply"]),
    )
    check(
        "sync_degrade_reply non-empty",
        isinstance(degrade_text, str) and len(degrade_text) > 0,
    )
    check(
        "malformed_fallback_reply non-empty",
        isinstance(malformed_text, str) and len(malformed_text) > 0,
    )

    snapshot = {
        k: cfg.get(k) for k in ("llm_stub_mode", "llm_stub_malformed", "llm_force_fail")
    }
    TEXT = "I keep saying I'll start tomorrow and then I never do."

    try:
        # ---- 1. Degrade ----
        print("== 1. Degrade (force=both) ==")
        set_config("llm_stub_mode", False)
        set_config("llm_stub_malformed", False)
        set_config("llm_force_fail", "both")
        st, body, _ = send(TEXT)
        check(
            "degrade http 200 ok",
            st == 200 and (body or {}).get("status") == "ok",
            f"{st} {body}",
        )
        uid = (body or {}).get("user_message_id")
        jid = None
        rows = assistant_rows(uid)
        check("degrade: 1 assistant row", len(rows) == 1, f"got {len(rows)}")
        if rows:
            m = rows[0]
            check(
                "degrade: content == sync_degrade_reply", m["content"] == degrade_text
            )
            check(
                "degrade: route=degrade",
                (m["metadata"] or {}).get("route") == "degrade",
            )
            check(
                "degrade: source=sync_degrade",
                (m["metadata"] or {}).get("source") == "sync_degrade",
            )
            check("degrade: primary anchor set", m["reply_to_message_id"] == uid)
            jid = (m["metadata"] or {}).get("source_job_id")
        check("degrade: source_job_id set", bool(jid))
        jobs = jobs_for_turn(uid)
        check(
            "degrade: 1 llm_retry job",
            len(jobs) == 1 and jobs[0]["type"] == "llm_retry",
            f"got {jobs}",
        )

        # ---- 2. Recover ----
        print("== 2. Recover (force=none, wait tick) ==")
        set_config("llm_force_fail", "none")
        j = wait_job_terminal(jid, timeout_s=300, accelerate=False)
        check("recover: job done", j and j["status"] == "done", f"{j}")
        rows = assistant_rows(uid)
        check("recover: 2 rows in order", len(rows) == 2, f"got {len(rows)}")
        if len(rows) == 2:
            check(
                "recover: holding first",
                (rows[0]["metadata"] or {}).get("route") == "degrade",
            )
            check(
                "recover: real is secondary",
                rows[1]["secondary_reply_to_message_id"] == uid
                and rows[1]["reply_to_message_id"] is None
                and (rows[1]["metadata"] or {}).get("source") == "llm_retry",
            )

        # ---- 3. Dead-letter ----
        if not args.no_deadletter:
            print("== 3. Dead-letter (force=both, 5 attempts) ==")
            set_config("llm_force_fail", "both")
            st, body, _ = send(TEXT + " " + str(uuid.uuid4())[:8])
            uid2 = (body or {}).get("user_message_id")
            rows = assistant_rows(uid2)
            jid2 = (rows[0]["metadata"] or {}).get("source_job_id") if rows else None
            j = wait_job_terminal(jid2, timeout_s=900, accelerate=True)
            check("deadletter: job dead", j and j["status"] == "dead", f"{j}")
            check("deadletter: attempts==5", j and j["attempts"] == 5, f"{j}")
            check("deadletter: last_error set", bool(j and j.get("last_error")))
            rows = assistant_rows(uid2)
            check(
                "deadletter: still 1 row, 0 real replies",
                len(rows) == 1,
                f"got {len(rows)}",
            )
            set_config("llm_force_fail", "none")
        else:
            print("== 3. Dead-letter skipped (--no-deadletter) ==")

        # ---- 4. Structural ----
        print("== 4. Structural (stub+malformed, no job) ==")
        set_config("llm_stub_mode", True)
        set_config("llm_stub_malformed", True)
        set_config("llm_force_fail", "none")
        st, body, _ = send(TEXT)
        uid3 = (body or {}).get("user_message_id")
        rows = assistant_rows(uid3)
        check("structural: 1 row", len(rows) == 1, f"got {len(rows)}")
        if rows:
            check(
                "structural: content == malformed fallback",
                rows[0]["content"] == malformed_text,
            )
        check("structural: no llm_retry", len(jobs_for_turn(uid3)) == 0)

        # ---- 5. Inline fallback ----
        print("== 5. Inline fallback (force=primary, no job) ==")
        set_config("llm_stub_mode", False)
        set_config("llm_stub_malformed", False)
        set_config("llm_force_fail", "primary")
        st, body, _ = send(TEXT)
        uid4 = (body or {}).get("user_message_id")
        rows = assistant_rows(uid4)
        check("inline: 1 normal row", len(rows) == 1, f"got {len(rows)}")
        if rows:
            md = rows[0]["metadata"] or {}
            check("inline: not holding", rows[0]["content"] != degrade_text)
            check("inline: not malformed", rows[0]["content"] != malformed_text)
            check("inline: source=pipeline", md.get("source") == "pipeline")
        check("inline: no llm_retry", len(jobs_for_turn(uid4)) == 0)
    finally:
        print("== restore ==")
        # restore to pre-run snapshot, defaulting to safe baseline
        for k in ("llm_stub_mode", "llm_stub_malformed", "llm_force_fail"):
            target = snapshot.get(k, BASELINE[k])
            ok = set_config(k, target)
            print(f"  restore {k}={target!r}: {'ok' if ok else 'FAILED'}")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All Step 8 checks passed.")


if __name__ == "__main__":
    main()
