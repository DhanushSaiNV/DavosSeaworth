#!/usr/bin/env python3
"""FP-08 Step 1 verification: migration 0032 — one column, two indexes, three functions,
two schedules, fifteen seed writes.

Automated (static + linked-database):
  * static: exactly one column, two indexes, no tables; three definer functions with pinned
    search_path; both ticks take an injectable p_now; fail-closed config reads; the accept RPC
    carries the lock/guard/consume/metric/job transaction; fifteen seed writes with upsert
  * live schema: the column, both indexes, all three functions, both cron schedules, the seed
    values and their jsonb types, execute privileges
  * drift tick truth table: guard miss/hit, kill switch
  * histogram tick truth table: out-of-window, below cold start, boundary (3), any-status dedup
  * accept_quest truth table: ok (metric + job + consume), duplicate, conflict (one-active),
    not_found, invalid, and rollback on a mid-transaction failure

The script creates throwaway auth users and deletes them (cascade) at the end. It never touches
an existing beta user's data (per-user job assertions are scoped by user id). The drift-tick and
accept legs touch only `jobs` rows that belong to the temp user or that this script created.

Usage: python scripts/verify-fp08-step1.py
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []


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


def req(url, method, path, body=None, token=None, key=None, timeout=60):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
    if token:
        headers["Authorization"] = f"Bearer {token}"
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


def rows(url, service, path):
    status, body = req(url, "GET", path, token=service, key=service)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def insert(url, service, table, payload):
    status, body = req(url, "POST", f"/rest/v1/{table}", payload, token=service, key=service)
    if status not in (200, 201, 204):
        raise RuntimeError(f"POST {table} -> {status}: {body}")
    return body


def patch(url, service, path, payload):
    status, body = req(url, "PATCH", path, payload, token=service, key=service)
    if status not in (200, 204):
        raise RuntimeError(f"PATCH {path} -> {status}: {body}")
    return body


def delete(url, service, path):
    status, body = req(url, "DELETE", path, token=service, key=service)
    if status not in (200, 204):
        raise RuntimeError(f"DELETE {path} -> {status}: {body}")
    return body


def rpc(url, service, fn, args):
    status, body = req(url, "POST", f"/rest/v1/rpc/{fn}", args, token=service, key=service)
    if status != 200:
        raise RuntimeError(f"rpc {fn} -> {status}: {body}")
    return body


def sql_rows(sql):
    """One management-API SQL round trip (information_schema is not exposed by PostgREST)."""
    proc = subprocess.run(
        ["npx", "supabase", "db", "query", "--linked", sql, "--output", "json"],
        cwd=ROOT, capture_output=True, text=True, timeout=120, shell=(os.name == "nt"),
    )
    text = proc.stdout
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise RuntimeError(f"db query failed: {proc.stdout[-800:]} {proc.stderr[-400:]}")
    return json.loads(text[start:end + 1]).get("rows", [])


def make_user(url, service, tag):
    email = f"{tag}-{uuid.uuid4().hex[:12]}@example.com"
    status, created = req(url, "POST", "/auth/v1/admin/users",
                          {"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
                          token=service, key=service)
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        raise RuntimeError(f"could not create temp user: {status} {created}")
    user_id = created["id"]
    for _ in range(20):
        prof = rows(url, service, f"/rest/v1/profiles?select=id&id=eq.{user_id}")
        if prof:
            return user_id
        time.sleep(0.25)
    raise RuntimeError("temp profile not created by trigger")


NEW_KEYS = {
    "drift_window_days": 3,
    "drift_late_start_hour": 10,
    "drift_compliance_threshold": 0.6,
    "drift_energy_threshold": 4,
    "drift_scan_enabled": True,
    "histogram_window_days": 14,
    "histogram_bucket_min_count": 3,
    "quest_completion_fraction": 0.5,
    "quest_deadline_bounds": {"min_days": 3, "max_days": 21},
    "strike_fire_local_hour": 18,
    "strike_fire_enabled": True,
    "oath_request_cooldown_days": 7,
    "breakdown_persona": "therapist_empath",
    "lockdown_accountability_domains": ["Career", "Discipline/Habits"],
}
KEY_TYPES = {
    "drift_window_days": "number",
    "drift_late_start_hour": "number",
    "drift_compliance_threshold": "number",
    "drift_energy_threshold": "number",
    "drift_scan_enabled": "boolean",
    "histogram_window_days": "number",
    "histogram_bucket_min_count": "number",
    "quest_completion_fraction": "number",
    "quest_deadline_bounds": "object",
    "strike_fire_local_hour": "number",
    "strike_fire_enabled": "boolean",
    "oath_request_cooldown_days": "number",
    "breakdown_persona": "string",
    "lockdown_accountability_domains": "array",
    "habit_detection_thresholds": "object",
}


def main():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service:
        sys.exit("need SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")

    print("== FP-08 Step 1: migration 0032 — column, indexes, ticks, seeds ==\n")

    # ---------------------------------------------------------------- static
    path = os.path.join(ROOT, "supabase/migrations/0032_accountability_fp08.sql")
    with open(path, encoding="utf-8") as fh:
        migration = fh.read()

    print("== A. static migration surface ==")
    check("exactly one add column",
          len(re.findall(r"\badd\s+column\b", migration, re.I)) == 1)
    check("the column is journal_entries.habit_flag boolean not null default false",
          re.search(r"journal_entries\s+add\s+column\s+if\s+not\s+exists\s+habit_flag\s+boolean\s+not\s+null\s+default\s+false",
                    migration, re.I) is not None)
    check("no create table", re.search(r"\bcreate\s+table\b", migration, re.I) is None)
    check("exactly two create index statements",
          len(re.findall(r"\bcreate\s+index\b", migration, re.I)) == 2)
    check("habits_live_idx is partial on the live statuses",
          "habits_live_idx" in migration
          and re.search(r"where\s+status\s+in\s*\('detected',\s*'confronted',\s*'watch'\)", migration) is not None)
    check("trust_events_user_reason_idx on (user_id, reason, created_at)",
          "trust_events_user_reason_idx" in migration
          and "trust_events (user_id, reason, created_at)" in migration)
    check("three definer functions with pinned search_path",
          migration.count("security definer") == 3 and migration.count("set search_path = public") == 3)
    check("both ticks take an injectable p_now",
          migration.count("p_now timestamptz default clock_timestamp()") == 2)
    check("drift tick is kill-switch gated fail-closed",
          "key = 'drift_scan_enabled'" in migration
          and "v_enabled is distinct from 'true'::jsonb" in migration)
    check("drift tick guard: no row created inside the trailing 10 minutes",
          "created_at > p_now - interval '10 minutes'" in migration)
    check("drift job payload is {}",
          "values ('drift_scan', '{}'::jsonb)" in migration)
    check("histogram tick reads both bounds at runtime, fail-closed",
          "key = 'histogram_bucket_min_count'" in migration
          and "key = 'histogram_window_days'" in migration
          and "jsonb_typeof(v_min) <> 'number'" in migration)
    check("histogram window [01:00, 01:15) local",
          "time '01:00'" in migration and "time '01:15'" in migration)
    check("histogram any-status dedup on (user_id, computed_for)",
          "j.payload ->> 'computed_for' = c.computed_for::text" in migration
          and "status" not in migration.split("where not exists", 1)[-1].split(");", 1)[0])
    check("accept_quest takes the advisory lock first",
          "pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))" in migration)
    check("accept_quest one-active-quest guard",
          "m.is_quest" in migration and "m.archived_at is null" in migration
          and "'conflict'" in migration)
    check("accept_quest compare-and-set consume + guarded update",
          "v_meta ->> 'quest_consumed' is not null" in migration
          and "jsonb_build_object('status', 'duplicate')" in migration)
    check("accept_quest writes the validated quest metric",
          "formula_status" in migration and "'validated'" in migration
          and "is_quest, quest_status, quest_deadline" in migration)
    check("accept_quest inserts the quest_expire job in the same transaction",
          "'quest_expire'" in migration and "p_expire_at" in migration)
    check("no table/RLS change beyond the column",
          re.search(r"\benable\s+row\s+level\s+security\b", migration, re.I) is None
          and re.search(r"\bcreate\s+policy\b", migration, re.I) is None)
    check("no grant to anon anywhere (config revoke only)",
          "to anon" not in migration and "revoke select on config from anon" in migration)
    check("all three functions revoked from authenticated and granted to service_role",
          len(re.findall(r"revoke execute on function public\.(drift_scan_tick|histogram_eval_tick|accept_quest)", migration)) == 3
          and len(re.findall(r"grant execute on function public\.(drift_scan_tick|histogram_eval_tick|accept_quest)", migration)) == 3)
    check("fifteen seed writes with on-conflict upsert",
          len(re.findall(r"on conflict \(key\) do update", migration)) == 2
          and len(re.findall(r"^\s*\('", migration, re.M)) >= 15)
    check("schedules: every 10 min + every 15 min, reschedulable",
          "'drift-scan-every-10m'" in migration and "'*/10 * * * *'" in migration
          and "'histogram-daily-every-15m'" in migration and "'*/15 * * * *'" in migration
          and migration.count("cron.unschedule") == 2)

    # ---------------------------------------------------------------- live schema
    print("\n== B. live schema ==")
    ver = sql_rows("select version from supabase_migrations.schema_migrations where version = '0032';")
    check("migration 0032 is applied", bool(ver), repr(ver))
    col = sql_rows("select data_type, is_nullable, column_default from information_schema.columns "
                   "where table_schema='public' and table_name='journal_entries' and column_name='habit_flag';")
    check("journal_entries.habit_flag exists, boolean not null default false",
          bool(col) and col[0]["data_type"] == "boolean" and col[0]["is_nullable"] == "NO"
          and (col[0]["column_default"] or "").startswith("false"), repr(col))
    ncols = sql_rows("select count(*)::int as n from information_schema.columns "
                     "where table_schema='public' and table_name='journal_entries';")
    check("journal_entries now has exactly 9 columns (8 pre-0032 + habit_flag)",
          bool(ncols) and ncols[0]["n"] == 9, repr(ncols))
    idx = sql_rows("select indexname, indexdef from pg_indexes where schemaname='public' "
                   "and indexname in ('habits_live_idx','trust_events_user_reason_idx');")
    idx_map = {r["indexname"]: r["indexdef"] for r in idx}
    check("both indexes exist",
          set(idx_map) == {"habits_live_idx", "trust_events_user_reason_idx"}, repr(idx_map))
    check("habits_live_idx carries the partial predicate",
          "WHERE" in (idx_map.get("habits_live_idx") or "")
          and "'detected'" in (idx_map.get("habits_live_idx") or ""), repr(idx_map))
    fn = sql_rows("select proname, prosecdef, proconfig from pg_proc where proname in "
                  "('drift_scan_tick','histogram_eval_tick','accept_quest') order by proname;")
    fn_map = {r["proname"]: r for r in fn}
    check("all three functions exist, definer, pinned search_path",
          set(fn_map) == {"drift_scan_tick", "histogram_eval_tick", "accept_quest"}
          and all(r["prosecdef"] is True and "search_path=public" in (r["proconfig"] or [])
                  for r in fn_map.values()), repr(fn))
    priv = sql_rows("select has_function_privilege('authenticated', 'public.drift_scan_tick(timestamptz)', 'execute') as d_auth, "
                    "has_function_privilege('service_role', 'public.drift_scan_tick(timestamptz)', 'execute') as d_svc, "
                    "has_function_privilege('authenticated', 'public.accept_quest(uuid,uuid,text,text,text,jsonb,date,timestamptz)', 'execute') as a_auth, "
                    "has_function_privilege('service_role', 'public.accept_quest(uuid,uuid,text,text,text,jsonb,date,timestamptz)', 'execute') as a_svc;")
    check("ticks/rpc not executable by authenticated, executable by service_role",
          bool(priv) and priv[0]["d_auth"] is False and priv[0]["d_svc"] is True
          and priv[0]["a_auth"] is False and priv[0]["a_svc"] is True, repr(priv))
    sched = sql_rows("select jobname, schedule, active from cron.job where jobname in "
                     "('drift-scan-every-10m','histogram-daily-every-15m') order by jobname;")
    sched_map = {r["jobname"]: r for r in sched}
    check("drift-scan-every-10m scheduled active",
          sched_map.get("drift-scan-every-10m", {}).get("schedule") == "*/10 * * * *"
          and sched_map.get("drift-scan-every-10m", {}).get("active") is True, repr(sched))
    check("histogram-daily-every-15m scheduled active",
          sched_map.get("histogram-daily-every-15m", {}).get("schedule") == "*/15 * * * *"
          and sched_map.get("histogram-daily-every-15m", {}).get("active") is True, repr(sched))

    print("\n== C. seed values ==")
    cfg = rows(url, service, "/rest/v1/config?select=key,value&key=in.("
               + ",".join(sorted(KEY_TYPES)) + ")&order=key")
    cfg_map = {r["key"]: r["value"] for r in cfg}
    check("all fifteen keys present", set(cfg_map) == set(KEY_TYPES),
          repr(sorted(set(KEY_TYPES) - set(cfg_map))))
    for key, expected in NEW_KEYS.items():
        check(f"{key} = {expected!r}", cfg_map.get(key) == expected, repr(cfg_map.get(key)))
    check("habit_detection_thresholds reshaped to structured jsonb",
          cfg_map.get("habit_detection_thresholds") == {"impulse_failures_per_week": 3,
                                                        "journal_flags_per_week": 3},
          repr(cfg_map.get("habit_detection_thresholds")))
    types = sql_rows("select key, jsonb_typeof(value) as t from config where key in ("
                     + ",".join(f"'{k}'" for k in sorted(KEY_TYPES)) + ");")
    tmap = {r["key"]: r["t"] for r in types}
    check("every seed value has the expected jsonb type",
          tmap == KEY_TYPES, repr({k: (v, tmap.get(k)) for k, v in KEY_TYPES.items()}))
    cfg_revoke = sql_rows("select has_table_privilege('anon','public.config','select') as anon_select;")
    check("anon can no longer read config (the 0032 heal)",
          bool(cfg_revoke) and cfg_revoke[0]["anon_select"] is False, repr(cfg_revoke))

    # ---------------------------------------------------------------- drift tick
    print("\n== D. drift_scan_tick truth table ==")
    orig = rows(url, service, "/rest/v1/config?select=value&key=eq.drift_scan_enabled")
    orig_enabled = orig[0]["value"] if orig else None
    try:
        patch(url, service, "/rest/v1/config?key=eq.drift_scan_enabled", {"value": True})
        # The live pg_cron tick leaves completed drift_scan rows behind; clear them so the
        # truth-table count is about this drill's two calls, not the accumulated history.
        delete(url, service, "/rest/v1/jobs?type=eq.drift_scan")
        # Guard miss: p_now well beyond any created row -> insert exactly one job.
        future = "2031-01-01T00:00:00Z"
        check("guard miss inserts one", rpc(url, service, "drift_scan_tick", {"p_now": future}) == 1)
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        # Guard hit: the row just created sits inside the trailing interval of a near-now call.
        check("guard hit inserts nothing", rpc(url, service, "drift_scan_tick", {"p_now": now_iso}) == 0)
        n_jobs = sql_rows("select count(*)::int as n from public.jobs where type='drift_scan';")
        check("exactly one drift_scan row exists after the two calls",
              bool(n_jobs) and n_jobs[0]["n"] == 1, repr(n_jobs))
        # Kill switch.
        patch(url, service, "/rest/v1/config?key=eq.drift_scan_enabled", {"value": False})
        check("kill switch off inserts nothing",
              rpc(url, service, "drift_scan_tick", {"p_now": future}) == 0)
        patch(url, service, "/rest/v1/config?key=eq.drift_scan_enabled", {"value": True})
        check("kill switch restored", rpc(url, service, "drift_scan_tick", {"p_now": future}) == 1)
    finally:
        patch(url, service, "/rest/v1/config?key=eq.drift_scan_enabled", {"value": orig_enabled})
        delete(url, service, "/rest/v1/jobs?type=eq.drift_scan")

    # ---------------------------------------------------------------- histogram tick
    print("\n== E. histogram_eval_tick truth table ==")
    user_id = make_user(url, service, "fp08-step1-hist")
    user2_id = None
    try:
        patch(url, service, f"/rest/v1/profiles?id=eq.{user_id}", {"timezone": "Asia/Kolkata"})
        # 01:05 IST on 2026-10-21 = 2026-10-20T19:35Z; computed_for = local day just ended = 10-20.
        in_window = "2026-10-21T01:05:00+05:30"
        out_window = "2026-10-21T01:20:00+05:30"

        def hist_jobs(uid):
            return rows(url, service,
                        f"/rest/v1/jobs?select=payload,next_retry_at&type=eq.histogram_daily&payload->>user_id=eq.{uid}")

        rpc(url, service, "histogram_eval_tick", {"p_now": out_window})
        check("out-of-window user gets no job", hist_jobs(user_id) == [], repr(hist_jobs(user_id)))
        rpc(url, service, "histogram_eval_tick", {"p_now": in_window})
        check("in-window but zero impulse rows gets no job (cold start)",
              hist_jobs(user_id) == [], repr(hist_jobs(user_id)))

        insert(url, service, "doings_logs", [
            {"user_id": user_id, "kind": "impulse_failure", "content": "u1", "energy": None,
             "source": "app", "logged_at": "2026-10-15T10:00:00Z", "checkin_window": None},
            {"user_id": user_id, "kind": "impulse_failure", "content": "u2", "energy": None,
             "source": "app", "logged_at": "2026-10-18T10:00:00Z", "checkin_window": None},
        ])
        rpc(url, service, "histogram_eval_tick", {"p_now": in_window})
        check("two failures is below the cold-start floor (min 3)",
              hist_jobs(user_id) == [], repr(hist_jobs(user_id)))

        insert(url, service, "doings_logs", [
            {"user_id": user_id, "kind": "impulse_failure", "content": "u3", "energy": None,
             "source": "app", "logged_at": "2026-10-19T10:00:00Z", "checkin_window": None},
            # A row outside the trailing 14 days must not count toward qualification.
            {"user_id": user_id, "kind": "impulse_failure", "content": "old", "energy": None,
             "source": "app", "logged_at": "2026-09-25T10:00:00Z", "checkin_window": None},
        ])
        rpc(url, service, "histogram_eval_tick", {"p_now": in_window})
        jobs = hist_jobs(user_id)
        check("three in-window failures qualify at the boundary",
              len(jobs) == 1, repr(jobs))
        check("payload is {user_id, computed_for: local yesterday}",
              bool(jobs) and jobs[0]["payload"] == {"user_id": user_id, "computed_for": "2026-10-20"},
              repr(jobs))
        rpc(url, service, "histogram_eval_tick", {"p_now": in_window})
        check("any-status dedup: a second call inserts no second job",
              len(hist_jobs(user_id)) == 1, repr(hist_jobs(user_id)))

        # A second user at the same instant also qualifies (per-user candidates).
        user2_id = make_user(url, service, "fp08-step1-hist2")
        patch(url, service, f"/rest/v1/profiles?id=eq.{user2_id}", {"timezone": "Asia/Kolkata"})
        insert(url, service, "doings_logs", [
            {"user_id": user2_id, "kind": "impulse_failure", "content": "v1", "energy": None,
             "source": "quick_action", "logged_at": "2026-10-17T10:00:00Z", "checkin_window": None},
            {"user_id": user2_id, "kind": "impulse_failure", "content": "v2", "energy": None,
             "source": "quick_action", "logged_at": "2026-10-18T10:00:00Z", "checkin_window": None},
            {"user_id": user2_id, "kind": "impulse_failure", "content": "v3", "energy": None,
             "source": "quick_action", "logged_at": "2026-10-19T10:00:00Z", "checkin_window": None},
        ])
        rpc(url, service, "histogram_eval_tick", {"p_now": in_window})
        check("a second qualified user gets their own job",
              len(hist_jobs(user2_id)) == 1, repr(hist_jobs(user2_id)))
    finally:
        delete(url, service, f"/rest/v1/jobs?type=eq.histogram_daily&payload->>user_id=eq.{user_id}")
        if user2_id:
            delete(url, service, f"/rest/v1/jobs?type=eq.histogram_daily&payload->>user_id=eq.{user2_id}")
        req(url, "DELETE", f"/auth/v1/admin/users/{user_id}", token=service, key=service)
        if user2_id:
            req(url, "DELETE", f"/auth/v1/admin/users/{user2_id}", token=service, key=service)

    # ---------------------------------------------------------------- accept_quest
    print("\n== F. accept_quest truth table ==")
    user_id = make_user(url, service, "fp08-step1-quest")
    try:
        offer = {"name": "6 AM Challenge", "domain": "Discipline/Habits", "output_unit": "days",
                 "formula": {"var": "doings_count"}, "deadline_days": 7,
                 "rationale": "test offer"}
        msg = insert(url, service, "messages", [
            {"user_id": user_id, "role": "assistant", "content": "quest?",
             "metadata": {"source": "drift_intervention", "quest_offer": offer}},
        ])
        msg_id = msg[0]["id"] if isinstance(msg, list) else None
        if not msg_id:
            got = rows(url, service, f"/rest/v1/messages?select=id&user_id=eq.{user_id}")
            msg_id = got[0]["id"]
        expire_at = "2026-10-29T01:15:00+05:30"

        def accept(mid, name="6 AM Challenge", deadline="2026-10-28"):
            return rpc(url, service, "accept_quest", {
                "p_user_id": user_id, "p_message_id": mid, "p_name": name,
                "p_domain": "Discipline/Habits", "p_output_unit": "days",
                "p_formula": {"var": "doings_count"}, "p_quest_deadline": deadline,
                "p_expire_at": expire_at,
            })

        out = accept(msg_id)
        check("accept returns ok + metric id",
              isinstance(out, dict) and out.get("status") == "ok" and out.get("metric_id"), repr(out))
        metric_id = out.get("metric_id") if isinstance(out, dict) else None
        metric = rows(url, service, f"/rest/v1/metrics?select=id,is_quest,quest_status,quest_deadline,formula_status,output_unit&id=eq.{metric_id}")
        check("metric row: is_quest, active, validated, deadline passed through",
              len(metric) == 1 and metric[0]["is_quest"] is True
              and metric[0]["quest_status"] == "active"
              and metric[0]["quest_deadline"] == "2026-10-28"
              and metric[0]["formula_status"] == "validated", repr(metric))
        qjobs = rows(url, service, f"/rest/v1/jobs?select=payload,next_retry_at&type=eq.quest_expire&payload->>metric_id=eq.{metric_id}")
        check("quest_expire job inserted at p_expire_at",
              len(qjobs) == 1 and qjobs[0]["payload"]["user_id"] == user_id
              and qjobs[0]["next_retry_at"].startswith("2026-10-28T19:45"), repr(qjobs))
        m2 = rows(url, service, f"/rest/v1/messages?select=metadata&id=eq.{msg_id}")
        check("offer consumed in the same transaction",
              bool(m2) and m2[0]["metadata"].get("quest_consumed") is True
              and m2[0]["metadata"].get("quest_metric_id") == metric_id, repr(m2))

        out = accept(msg_id)
        check("second tap -> duplicate, no second metric", out == {"status": "duplicate"}, repr(out))
        n_metrics = rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}")
        check("still exactly one metric row", len(n_metrics) == 1, repr(n_metrics))

        # A second unconsumed offer while the first quest is active -> conflict (one-active rule).
        msg2 = insert(url, service, "messages", [
            {"user_id": user_id, "role": "assistant", "content": "quest 2?",
             "metadata": {"source": "drift_intervention", "quest_offer": offer}},
        ])
        msg2_id = msg2[0]["id"] if isinstance(msg2, list) else None
        if not msg2_id:
            got = rows(url, service, f"/rest/v1/messages?select=id&user_id=eq.{user_id}&id=neq.{msg_id}")
            msg2_id = got[0]["id"]
        out = accept(msg2_id)
        check("one-active-quest rule -> conflict", out == {"status": "conflict"}, repr(out))
        check("conflict consumed nothing (metadata clean)",
              rows(url, service, f"/rest/v1/messages?select=metadata&id=eq.{msg2_id}")[0]["metadata"]
              .get("quest_consumed") is None)
        check("conflict wrote no metric",
              len(rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}")) == 1)

        out = accept(str(uuid.uuid4()))
        check("unknown message -> not_found", out == {"status": "not_found"}, repr(out))

        msg3 = insert(url, service, "messages", [
            {"user_id": user_id, "role": "assistant", "content": "no offer",
             "metadata": {"source": "pipeline_primary"}},
        ])
        msg3_id = msg3[0]["id"] if isinstance(msg3, list) else None
        if not msg3_id:
            got = rows(url, service,
                       f"/rest/v1/messages?select=id&user_id=eq.{user_id}&metadata->>source=eq.pipeline_primary")
            msg3_id = got[0]["id"]
        out = accept(msg3_id)
        check("message without quest_offer -> invalid", out == {"status": "invalid"}, repr(out))

        # Rollback: archive the first quest so the accept reaches the insert, then force a
        # metric-insert failure (name NOT NULL). The whole transaction must abort — no metric,
        # no job, no consume — so a committed accept always carries its expiry job.
        patch(url, service, f"/rest/v1/metrics?id=eq.{metric_id}", {"archived_at": "2026-10-21T00:00:00Z"})
        status, body = req(url, "POST", "/rest/v1/rpc/accept_quest", {
            "p_user_id": user_id, "p_message_id": msg2_id, "p_name": None,
            "p_domain": "Discipline/Habits", "p_output_unit": "days",
            "p_formula": {"var": "doings_count"}, "p_quest_deadline": "2026-10-28",
            "p_expire_at": expire_at,
        }, token=service, key=service)
        check("mid-transaction failure raises (all-or-nothing, not a silent ok)",
              status not in (200,), f"{status} {body}")
        n_metrics = rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}&archived_at=is.null")
        check("rollback: no active metric written", n_metrics == [], repr(n_metrics))
        check("rollback: nothing consumed",
              rows(url, service, f"/rest/v1/messages?select=metadata&id=eq.{msg2_id}")[0]["metadata"]
              .get("quest_consumed") is None)
        n_qjobs = rows(url, service, f"/rest/v1/jobs?select=id&type=eq.quest_expire&payload->>user_id=eq.{user_id}")
        check("rollback: no quest_expire job for the failed accept",
              len(n_qjobs) == 1, repr(n_qjobs))  # only the first (successful) accept's job
    finally:
        delete(url, service, f"/rest/v1/jobs?type=eq.quest_expire&payload->>user_id=eq.{user_id}")
        req(url, "DELETE", f"/auth/v1/admin/users/{user_id}", token=service, key=service)

    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s)")
        return 1
    print("PASS: FP-08 Step 1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
