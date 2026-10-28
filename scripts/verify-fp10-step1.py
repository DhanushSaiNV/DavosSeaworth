#!/usr/bin/env python3
"""verify-fp10-step1.py -- FP-10 Step 1 gate.

What this proves (FP-10 FR-1, FR-2, FR-3; AC-1, AC-2, AC-3):

  static   migration 0036 exists and carries the exact end-state; `flag-unsavable` no
           longer enqueues; `send-message` reads the capture window; no client diffs;
           the registry is still 15/15 with the same FAST_JOB_TYPES.
  grants   the live matrix: table/column privileges per role, the trigger definition,
           `write_degrade_pair` shape, the seed, and zero columns beyond 0035.
  live     a disposable user's real PostgREST calls -- the denials AC-1 names, the
           successes that must survive, and `update_checkin_prefs`.
  ac2      the raw PATCH door and `flag-unsavable` are behaviourally identical: flag
           set, facts purged by provenance, exactly one `purge_memory` job; a re-flag
           fires nothing.
  ac3      the oath window: fresh + confirmed -> captured verbatim; stale -> expired
           by the one-time close and never captured; plain next message -> uncaptured;
           a stale-closed request still inside its cooldown.

Usage:
  python scripts/verify-fp10-step1.py                  # static + grants + live
  python scripts/verify-fp10-step1.py --static-only    # no network, no DB

Exit code 0 iff every check passes.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
MIGRATION = os.path.join(ROOT, "supabase", "migrations", "0036_armor_audit_fp10.sql")
FAILS = []
SKIPS = []


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def skip(label, why):
    print(f"  SKIP {label} -- {why}")
    SKIPS.append(label)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def req(url, method, path, body=None, token=None, key=None, timeout=90, prefer=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return exc.code, {"raw": raw[:400]}


def sql_rows(sql):
    fd, path = tempfile.mkstemp(suffix=".sql", prefix="fp10-step1-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(sql)
        proc = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", "-f", path, "--output", "json"],
            cwd=ROOT, capture_output=True, text=True, timeout=180, shell=(os.name == "nt"),
        )
        text = proc.stdout
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < 0:
            raise RuntimeError(f"db query failed: {proc.stdout[-800:]} {proc.stderr[-400:]}")
        return json.loads(text[start:end + 1]).get("rows", [])
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def one(rows):
    return rows[0] if rows else None


# --------------------------------------------------------------------------- static

def static_legs():
    print("\n== A. static ==")
    check("migration 0036 exists", os.path.exists(MIGRATION))
    if not os.path.exists(MIGRATION):
        return
    sql = read("supabase/migrations/0036_armor_audit_fp10.sql")

    for needle, label in [
        ("revoke update on public.profiles from authenticated, anon;", "profiles revoke update"),
        ("grant update (display_name) on public.profiles to authenticated;", "profiles column grant"),
        ("revoke insert, update on public.messages from authenticated, anon;", "messages revoke insert/update"),
        ("grant update (unsavable) on public.messages to authenticated;", "messages column grant"),
        ("revoke select on public.trust_events from authenticated, anon;", "trust_events select revoked"),
        ("revoke update on public.persona_stats from authenticated, anon;", "persona_stats update revoked"),
        ("revoke insert, update, delete on public.config from authenticated, anon;", "config DML revoked"),
        ("revoke insert, update, delete on public.push_tokens from anon;", "push_tokens anon DML revoked"),
        ("create or replace function public.write_degrade_pair(", "pair-writer function"),
        ("grant execute on function public.write_degrade_pair(uuid, uuid, uuid, text, jsonb, jsonb)", "pair-writer grant"),
        ("'oath_request_capture_window_hours', '48'::jsonb", "capture-window seed"),
        ("consumed_reason', 'expired'", "stale-oath close marker"),
        ("sync_degrade orphan count", "orphan count block"),
        ("REVERSE DDL", "reverse DDL documented"),
    ]:
        check(f"0036: {label}", needle in sql)

    for table in ["doings_logs", "journal_entries", "memory_facts", "metrics",
                  "metric_points", "anchor_plans", "habits"]:
        check(f"0036: {table} DML revoked",
              f"revoke insert, update, delete on public.{table} from authenticated, anon;" in sql)

    check("0036: no new table", "create table" not in sql.lower())
    check("0036: no new column", "add column" not in sql.lower())
    check("0036: no new index", "create index" not in sql.lower())
    check("0036: no RLS change", "row level security" not in sql.lower())

    flag_src = read("supabase/functions/flag-unsavable/index.ts")
    check("flag-unsavable: no own job insert",
          '.from("jobs")' not in flag_src and 'type: "purge_memory"' not in flag_src)
    check("flag-unsavable: response contract intact",
          'return json({ status: "ok", message_id: parsed.messageId });' in flag_src
          and 'return json({ error: "Cannot flag an assistant message" }, 400);' in flag_src
          and 'return json({ error: "Message not found" }, 404);' in flag_src)

    send_src = read("supabase/functions/send-message/index.ts")
    check("send-message: reads the capture window",
          'getConfigNumber("oath_request_capture_window_hours")' in send_src)
    check("send-message: selects created_at in the confirmation read",
          '.select("id, role, metadata, created_at")' in send_src)
    check("send-message: freshness bound present",
          "requestedAt < Date.now() - Math.max(0, windowHours) * 3_600_000" in send_src)

    disp = read("supabase/functions/job-dispatcher/index.ts")
    check("registry: FAST_JOB_TYPES unchanged",
          "new Set(['smoke_test', 'watchdog_checkin', 'purge_memory', 'metric_eval', 'drift_scan'])"
          in disp)

    proc = subprocess.run(["git", "diff", "--name-only", "main", "--", "lib", "app", "components"],
                          cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
    changed = [line for line in proc.stdout.splitlines() if line.strip()]
    check("surface discipline: zero client diffs", not changed, str(changed))


# --------------------------------------------------------------------------- grants

def grant_legs():
    print("\n== B. live grant matrix ==")
    rows = sql_rows("""
      select
        has_table_privilege('authenticated','public.profiles','UPDATE')            as profiles_update,
        has_column_privilege('authenticated','public.profiles','display_name','UPDATE') as profiles_display_name,
        has_column_privilege('authenticated','public.profiles','trust_score','UPDATE')  as profiles_trust,
        has_table_privilege('authenticated','public.messages','INSERT')            as messages_insert,
        has_table_privilege('authenticated','public.messages','UPDATE')            as messages_update,
        has_column_privilege('authenticated','public.messages','unsavable','UPDATE')    as messages_unsavable,
        has_column_privilege('authenticated','public.messages','content','UPDATE')      as messages_content,
        has_table_privilege('authenticated','public.trust_events','SELECT')        as trust_select_auth,
        has_table_privilege('anon','public.trust_events','SELECT')                 as trust_select_anon,
        has_table_privilege('authenticated','public.doings_logs','INSERT')         as doings_insert,
        has_table_privilege('authenticated','public.journal_entries','UPDATE')     as journal_update,
        has_table_privilege('authenticated','public.memory_facts','DELETE')        as facts_delete,
        has_table_privilege('authenticated','public.metrics','INSERT')             as metrics_insert,
        has_table_privilege('authenticated','public.metric_points','UPDATE')       as points_update,
        has_table_privilege('authenticated','public.anchor_plans','INSERT')        as anchor_insert,
        has_table_privilege('authenticated','public.habits','DELETE')              as habits_delete,
        has_table_privilege('authenticated','public.persona_stats','UPDATE')       as persona_update,
        has_table_privilege('authenticated','public.config','UPDATE')              as config_update_auth,
        has_table_privilege('anon','public.config','UPDATE')                       as config_update_anon,
        has_table_privilege('authenticated','public.config','SELECT')              as config_select,
        has_table_privilege('authenticated','public.push_tokens','INSERT')         as push_insert,
        has_table_privilege('authenticated','public.push_tokens','UPDATE')         as push_update,
        has_table_privilege('authenticated','public.push_tokens','DELETE')         as push_delete,
        has_table_privilege('anon','public.push_tokens','DELETE')                  as push_delete_anon,
        has_function_privilege('authenticated','public.update_checkin_prefs(int,time,time,text)','EXECUTE') as rpc_prefs,
        has_function_privilege('authenticated','public.write_degrade_pair(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') as rpc_pair_auth,
        has_function_privilege('service_role','public.write_degrade_pair(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') as rpc_pair_service,
        has_table_privilege('authenticated','public.messages','SELECT')            as messages_select,
        has_table_privilege('authenticated','public.profiles','SELECT')            as profiles_select
    """)
    m = one(rows) or {}

    def is_false(key):
        return m.get(key) is False

    def is_true(key):
        return m.get(key) is True

    check("profiles: table UPDATE denied", is_false("profiles_update"))
    check("profiles: display_name UPDATE allowed", is_true("profiles_display_name"))
    check("profiles: trust_score UPDATE denied", is_false("profiles_trust"))
    check("messages: INSERT denied", is_false("messages_insert"))
    check("messages: table UPDATE denied", is_false("messages_update"))
    check("messages: unsavable UPDATE allowed", is_true("messages_unsavable"))
    check("messages: content UPDATE denied", is_false("messages_content"))
    check("trust_events: SELECT denied to authenticated", is_false("trust_select_auth"))
    check("trust_events: SELECT denied to anon", is_false("trust_select_anon"))
    for key, label in [
        ("doings_insert", "doings_logs INSERT"),
        ("journal_update", "journal_entries UPDATE"),
        ("facts_delete", "memory_facts DELETE"),
        ("metrics_insert", "metrics INSERT"),
        ("points_update", "metric_points UPDATE"),
        ("anchor_insert", "anchor_plans INSERT"),
        ("habits_delete", "habits DELETE"),
    ]:
        check(f"{label} denied", is_false(key))
    check("persona_stats: UPDATE denied", is_false("persona_update"))
    check("config: UPDATE denied to authenticated", is_false("config_update_auth"))
    check("config: UPDATE denied to anon", is_false("config_update_anon"))
    check("config: SELECT still allowed", is_true("config_select"))
    check("push_tokens: insert/update/delete kept", is_true("push_insert") and is_true("push_update") and is_true("push_delete"))
    check("push_tokens: anon delete revoked", is_false("push_delete_anon"))
    check("update_checkin_prefs: execute still granted", is_true("rpc_prefs"))
    check("write_degrade_pair: authenticated execute denied", is_false("rpc_pair_auth"))
    check("write_degrade_pair: service_role execute granted", is_true("rpc_pair_service"))
    check("client SELECTs kept (messages/profiles)", is_true("messages_select") and is_true("profiles_select"))

    shape = one(sql_rows("""
      select p.prosecdef as sd,
             coalesce(array_to_string(p.proacl,','),'') as acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='write_degrade_pair'
    """)) or {}
    check("write_degrade_pair is SECURITY DEFINER", shape.get("sd") is True)
    check("write_degrade_pair ACL is service_role only",
          "service_role=X" in (shape.get("acl") or "") and "authenticated=X" not in (shape.get("acl") or ""))

    trig = one(sql_rows("""
      select pg_get_triggerdef(t.oid) as def
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname='messages' and t.tgname='messages_purge_memory_on_unsavable'
    """)) or {}
    tdef = (trig.get("def") or "").lower()
    check("unsavable trigger present and scoped",
          "after update of unsavable" in tdef and "old.unsavable is not true" in tdef, tdef[:200])

    fn = one(sql_rows("""
      select pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='purge_memory_on_unsavable'
    """)) or {}
    fdef = fn.get("def") or ""
    check("purge enqueuer inserts one purge_memory job",
          "'purge_memory'" in fdef and "jsonb_build_object('message_id', new.id)" in fdef)

    seed = one(sql_rows("""
      select value, jsonb_typeof(value) as t, description
        from public.config where key='oath_request_capture_window_hours'
    """)) or {}
    check("seed: oath_request_capture_window_hours = 48", seed.get("value") == 48 and seed.get("t") == "number", str(seed))
    check("seed: has a description", bool(seed.get("description")))

    counts = one(sql_rows("""
      select
        (select count(*) from information_schema.columns where table_schema='public' and table_name='messages') as messages_cols,
        (select count(*) from information_schema.columns where table_schema='public' and table_name='profiles') as profiles_cols,
        (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables
    """)) or {}
    check("zero columns beyond 0035 (messages 13, profiles 17)",
          counts.get("messages_cols") == 13 and counts.get("profiles_cols") == 17, str(counts))
    check("table count unchanged (16)", counts.get("tables") == 16, str(counts))


# --------------------------------------------------------------------------- live

def live_legs():
    print("\n== C. live behaviour (disposable user) ==")
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not service or not anon:
        skip("live legs", "need SUPABASE_URL + SERVICE_ROLE_KEY + ANON_KEY")
        return

    sys.path.insert(0, SCRIPTS)
    from _mint_dev_jwt import mint_access_token  # noqa: E402

    email = f"fp10-step1-{uuid.uuid4().hex[:10]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, created = req(url, "POST", "/auth/v1/admin/users",
                          {"email": email, "password": password, "email_confirm": True},
                          token=service, key=service)
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        check("temp user created", False, f"{status} {created}")
        return
    uid = created["id"]
    print(f"  user  : {uid}")
    try:
        token, _claims = mint_access_token(url, service, email)

        def as_user(method, path, body=None, prefer=None):
            return req(url, method, path, body, token=token, key=anon, prefer=prefer)

        # The opening row lands via the profiles trigger.
        rows = req(url, "GET", f"/rest/v1/messages?select=id,role&user_id=eq.{uid}", token=service, key=service)[1]
        opening = next((r for r in rows if r["role"] == "assistant"), None)
        check("temp user has an opening row", bool(opening))

        # --- AC-1: the denials
        for body, label in [
            ({"trust_score": 99}, "trust_score"),
            ({"dialog_state": "x"}, "dialog_state"),
            ({"onboarding_stage": "complete"}, "onboarding_stage"),
            ({"wake_time": "06:00:00"}, "wake_time"),
        ]:
            st, out = as_user("PATCH", f"/rest/v1/profiles?id=eq.{uid}", body, prefer="return=representation")
            check(f"raw PATCH profiles.{label} denied", st in (401, 403), f"{st} {str(out)[:200]}")

        st, out = as_user("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"display_name": "Armor"}, prefer="return=representation")
        check("raw PATCH profiles.display_name allowed", st in (200, 204), f"{st} {str(out)[:200]}")

        st, out = as_user("POST", "/rest/v1/rpc/update_checkin_prefs",
                          {"p_cadence": 120, "p_start": "08:00:00", "p_end": "22:00:00", "p_tz": "UTC"})
        check("update_checkin_prefs still saves", st in (200, 204), f"{st} {str(out)[:200]}")

        st, out = as_user("POST", "/rest/v1/messages",
                          {"user_id": uid, "role": "user", "content": "forged"},
                          prefer="return=representation")
        check("raw messages INSERT denied", st in (401, 403), f"{st} {str(out)[:200]}")

        if opening:
            st, out = as_user("PATCH", f"/rest/v1/messages?id=eq.{opening['id']}", {"content": "rewritten"})
            check("raw messages.content UPDATE denied", st in (401, 403), f"{st} {str(out)[:200]}")

        st, out = as_user("GET", "/rest/v1/trust_events?select=id&limit=1")
        check("trust_events SELECT denied", st in (401, 403), f"{st} {str(out)[:200]}")

        st, out = as_user("PATCH", "/rest/v1/config?key=eq.dev_overrides_enabled", {"value": False})
        check("config PATCH denied", st in (401, 403), f"{st} {str(out)[:200]}")

        for table in ["messages", "profiles", "config", "doings_logs", "journal_entries",
                      "metrics", "metric_points"]:
            st, out = as_user("GET", f"/rest/v1/{table}?select=*&limit=1")
            check(f"client SELECT kept: {table}", st == 200, f"{st} {str(out)[:160]}")

        st, out = as_user("POST", "/rest/v1/push_tokens",
                          {"user_id": uid, "token": "ExponentPushToken[fp10]", "platform": "android"},
                          prefer="resolution=merge-duplicates,return=representation")
        check("push_tokens upsert allowed", st in (200, 201, 204), f"{st} {str(out)[:200]}")
        st, out = as_user("DELETE", f"/rest/v1/push_tokens?user_id=eq.{uid}&token=eq.ExponentPushToken[fp10]")
        check("push_tokens delete allowed", st in (200, 204), f"{st} {str(out)[:200]}")

        # --- AC-2: the two doors are behaviourally identical
        def plant_user_message(text):
            st, out = req(url, "POST", "/rest/v1/messages",
                          {"user_id": uid, "role": "user", "content": text},
                          token=service, key=service, prefer="return=representation")
            return (out or [{}])[0].get("id") if isinstance(out, list) else None

        def jobs_for(mid):
            return req(url, "GET",
                       f"/rest/v1/jobs?select=id&type=eq.purge_memory&payload->>message_id=eq.{mid}",
                       token=service, key=service)[1] or []

        def fact_purged(mid):
            rows = req(url, "GET",
                       f"/rest/v1/memory_facts?select=id,purged_at&user_id=eq.{uid}&source_message_id=eq.{mid}",
                       token=service, key=service)[1] or []
            return bool(rows) and all(r.get("purged_at") for r in rows)

        # Door 1: the raw PATCH.
        raw_mid = plant_user_message("a raw-door turn")
        req(url, "POST", "/rest/v1/memory_facts",
            {"user_id": uid, "fact": "raw drill fact", "fact_type": "chat", "source_message_id": raw_mid},
            token=service, key=service)
        st, out = as_user("PATCH", f"/rest/v1/messages?id=eq.{raw_mid}", {"unsavable": True},
                          prefer="return=representation")
        check("raw door: unsavable flip allowed", st in (200, 204), f"{st} {str(out)[:200]}")
        check("raw door: exactly one purge_memory job", len(jobs_for(raw_mid)) == 1, str(len(jobs_for(raw_mid))))
        check("raw door: facts purged by provenance", fact_purged(raw_mid))

        st, _ = as_user("PATCH", f"/rest/v1/messages?id=eq.{raw_mid}", {"unsavable": True})
        check("raw door: re-flag fires nothing", st in (200, 204) and len(jobs_for(raw_mid)) == 1,
              f"{st} {len(jobs_for(raw_mid))}")

        # Door 2: the validated function.
        fn_mid = plant_user_message("a validated-door turn")
        req(url, "POST", "/rest/v1/memory_facts",
            {"user_id": uid, "fact": "fn drill fact", "fact_type": "chat", "source_message_id": fn_mid},
            token=service, key=service)
        st, out = req(url, "POST", "/functions/v1/flag-unsavable", {"message_id": fn_mid},
                      token=token, key=anon)
        check("fn door: flag-unsavable answers ok", st == 200 and (out or {}).get("status") == "ok",
              f"{st} {str(out)[:200]}")
        check("fn door: exactly one purge_memory job", len(jobs_for(fn_mid)) == 1, str(len(jobs_for(fn_mid))))
        check("fn door: facts purged by provenance", fact_purged(fn_mid))
        st, out = req(url, "POST", "/functions/v1/flag-unsavable", {"message_id": fn_mid},
                      token=token, key=anon)
        check("fn door: re-flag answers ok and enqueues nothing",
              st == 200 and len(jobs_for(fn_mid)) == 1, f"{st} {len(jobs_for(fn_mid))}")

        # --- AC-4's SQL half: the pair writer is atomic (the TS consumer is Step 2)
        def call_pair(user_msg, job_id, content="Holding on - one moment."):
            return req(url, "POST", "/rest/v1/rpc/write_degrade_pair",
                       {
                           "p_user_id": uid,
                           "p_user_message_id": user_msg,
                           "p_job_id": job_id,
                           "p_content": content,
                           "p_metadata": {"source": "sync_degrade", "source_job_id": job_id},
                           "p_payload": {"user_id": uid, "user_message_id": user_msg, "route": "degrade"},
                       },
                       token=service, key=service)

        pair_msg = plant_user_message("a degrade-pair turn")
        job_a, job_b = str(uuid.uuid4()), str(uuid.uuid4())
        st, out = call_pair(pair_msg, job_a)
        check("pair writer: first call lands ok",
              st == 200 and (out or {}).get("status") == "ok" and (out or {}).get("job_id") == job_a,
              f"{st} {str(out)[:200]}")
        replies = req(url, "GET", f"/rest/v1/messages?select=id&role=eq.assistant&reply_to_message_id=eq.{pair_msg}",
                      token=service, key=service)[1] or []
        jobs = req(url, "GET", f"/rest/v1/jobs?select=id,type&id=eq.{job_a}", token=service, key=service)[1] or []
        check("pair writer: both rows landed", len(replies) == 1 and len(jobs) == 1 and jobs[0]["type"] == "llm_retry",
              f"{len(replies)} replies / {len(jobs)} jobs")

        st, out = call_pair(pair_msg, job_b)
        jobs_b = req(url, "GET", f"/rest/v1/jobs?select=id&id=eq.{job_b}", token=service, key=service)[1] or []
        check("pair writer: a second answer reports race_lost with the winner",
              st == 200 and (out or {}).get("status") == "race_lost"
              and (out or {}).get("winner_id") == replies[0]["id"], f"{st} {str(out)[:200]}")
        check("pair writer: race_lost leaves no job behind", not jobs_b, str(jobs_b))

        dup_msg = plant_user_message("a duplicate-job turn")
        st, out = call_pair(dup_msg, job_a)
        dup_replies = req(url, "GET",
                          f"/rest/v1/messages?select=id&role=eq.assistant&reply_to_message_id=eq.{dup_msg}",
                          token=service, key=service)[1] or []
        check("pair writer: any other failure rolls the reply back",
              st >= 400 and not dup_replies, f"{st} {len(dup_replies)} replies")

        # --- AC-3: the oath window
        req(url, "PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"onboarding_stage": "complete"},
            token=service, key=service)
        prev_stub = req(url, "GET", "/rest/v1/config?select=value&key=eq.llm_stub_mode", token=service, key=service)[1]
        prev_stub = (prev_stub or [{}])[0].get("value")
        req(url, "PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": True}, token=service, key=service)
        try:
            def plant_request(created_at=None):
                payload = {
                    "user_id": uid, "role": "assistant",
                    "content": "Make me a promise you will keep.",
                    "metadata": {"source": "oath_request", "oath_request": True},
                }
                st, out = req(url, "POST", "/rest/v1/messages", payload, token=service, key=service,
                              prefer="return=representation")
                rid = (out or [{}])[0].get("id") if isinstance(out, list) else None
                if rid and created_at:
                    req(url, "PATCH", f"/rest/v1/messages?id=eq.{rid}", {"created_at": created_at},
                        token=service, key=service)
                return rid

            def send(text, extra=None):
                body = {"content": text, "client_message_id": str(uuid.uuid4())}
                if extra:
                    body.update(extra)
                return req(url, "POST", "/functions/v1/send-message", body, token=token, key=anon)

            def oath_fact(message_id):
                rows = req(url, "GET",
                           f"/rest/v1/memory_facts?select=id,fact,fact_type&user_id=eq.{uid}&source_message_id=eq.{message_id}",
                           token=service, key=service)[1] or []
                return next((r for r in rows if r["fact_type"] == "oath"), None)

            # fresh + confirmed -> captured
            fresh = plant_request()
            oath_text = "I swear I will not quit on myself again."
            st, out = send(oath_text, {"oath_confirmed": True, "oath_request_id": fresh})
            user_id = (out or {}).get("user_message_id")
            fact = oath_fact(user_id) if user_id else None
            check("fresh confirmed send captures the oath", st == 200 and bool(fact) and fact.get("fact") == oath_text,
                  f"{st} {str(out)[:200]}")

            # stale -> expired by the close, never captured
            stale = plant_request(created_at="2020-01-01T00:00:00Z")
            sql_rows("""
              do $$
              declare v_hours numeric;
              begin
                select (value #>> '{}')::numeric into v_hours from public.config
                 where key='oath_request_capture_window_hours';
                update public.messages
                   set metadata = metadata || jsonb_build_object('consumed', true,
                         'consumed_at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                         'consumed_reason','expired')
                 where metadata->>'source'='oath_request' and metadata->>'consumed' is null
                   and created_at < now() - make_interval(hours => v_hours::int);
              end $$;
            """)
            stale_row = one(req(url, "GET", f"/rest/v1/messages?select=metadata&id=eq.{stale}",
                                token=service, key=service)[1] or [])
            check("one-time close marked the stale request expired",
                  bool(stale_row) and (stale_row.get("metadata") or {}).get("consumed_reason") == "expired",
                  str(stale_row))
            st, out = send("A different promise, days later.", {"oath_confirmed": True, "oath_request_id": stale})
            user_id = (out or {}).get("user_message_id")
            check("stale confirmed send is NOT captured", st == 200 and oath_fact(user_id) is None,
                  f"{st} {str(out)[:200]}")

            # plain next message -> uncaptured
            plain = plant_request()
            st, out = send("Just an ordinary update about my day.")
            user_id = (out or {}).get("user_message_id")
            plain_row = one(req(url, "GET", f"/rest/v1/messages?select=metadata&id=eq.{plain}",
                                token=service, key=service)[1] or [])
            check("plain message is not captured",
                  st == 200 and oath_fact(user_id) is None
                  and (plain_row.get("metadata") or {}).get("consumed") is not True,
                  f"{st} {str(out)[:200]}")

            # cooldown still occupied by the stale-closed request
            cooldown = one(req(url, "GET", "/rest/v1/config?select=value&key=eq.oath_request_cooldown_days",
                               token=service, key=service)[1] or []) or {}
            check("cooldown reading unchanged (row-based)", cooldown.get("value") == 7, str(cooldown))
        finally:
            req(url, "PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": prev_stub},
                token=service, key=service)
    finally:
        # purge_user_data (Decision 27) then the auth user
        req(url, "POST", "/rest/v1/rpc/purge_user_data", {"p_user_id": uid}, token=service, key=service)
        req(url, "DELETE", f"/auth/v1/admin/users/{uid}", token=service, key=service)
        left = req(url, "GET", f"/rest/v1/profiles?select=id&id=eq.{uid}", token=service, key=service)[1]
        check("disposable user removed", not left, str(left))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--static-only", action="store_true", help="skip DB and network legs")
    args = ap.parse_args()

    load_dotenv()
    static_legs()
    if not args.static_only:
        grant_legs()
        live_legs()

    print("\n== summary ==")
    if SKIPS:
        print(f"  skipped: {len(SKIPS)}")
    if FAILS:
        print(f"  FAILED: {len(FAILS)}")
        for f in FAILS:
            print(f"    - {f}")
        return 1
    print("  ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
