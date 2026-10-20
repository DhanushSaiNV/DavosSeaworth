#!/usr/bin/env python3
"""FP-07 Step 1 verification: `metric_vars_daily`, the guarded cron insert, three config keys.

Automated (static + linked-database):
  * migration 0031 adds no table or column (text assert + information_schema)
  * view has exactly the seven SQL variables; UTC+5:30, DST, journal-only and zero-activity
    hand-math cases match
  * the guard's truth table: in-window, out-of-window, no-metrics, already-jobed, kill-switch
  * the view is service-role-only and the cron function is definer + pinned search_path
  * the three config keys are proper jsonb

The script creates a throwaway auth user, plants rows, and deletes the user (cascade) at the
end. It never touches an existing beta user's data.

Usage: python scripts/verify-fp07-step1.py
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
    status, body = req(url, "POST", f"/rest/v1/{table}", payload, token=service, key=service,
                       )
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


def main():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service:
        sys.exit("need SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")

    print("== FP-07 Step 1: metric variables, guarded cron, config keys ==\n")

    # ---------------------------------------------------------------- static
    migration_path = os.path.join(ROOT, "supabase/migrations/0031_metrics_fp07.sql")
    with open(migration_path, encoding="utf-8") as fh:
        migration = fh.read()
    print("== A. migration surface ==")
    check("view is security_invoker", "security_invoker = true" in migration)
    check("view granted to service_role only",
          "grant select on public.metric_vars_daily to service_role" in migration
          and "grant select on public.metric_vars_daily to authenticated" not in migration)
    check("cron function is security definer", "security definer" in migration)
    check("cron function pins search_path", "set search_path = public" in migration)
    check("no create table in 0031", re.search(r"\bcreate\s+table\b", migration, re.I) is None)
    check("no alter table in 0031", re.search(r"\balter\s+table\b", migration, re.I) is None)
    check("no create index in 0031", re.search(r"\bcreate\s+(unique\s+)?index\b", migration, re.I) is None)
    check("metric_eval payload is ids + date only",
          "jsonb_build_object('user_id', c.user_id, 'computed_for', c.computed_for)" in migration)
    check("any-status job guard", "and j.payload ->> 'user_id'" in migration
          and "status" not in migration.split("where not exists", 1)[-1].split(");", 1)[0][:300])

    print("\n== B. live schema ==")
    email = f"fp07-step1-{uuid.uuid4().hex[:12]}@example.com"
    status, created = req(url, "POST", "/auth/v1/admin/users",
                          {"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
                          token=service, key=service)
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        sys.exit(f"could not create temp user: {status} {created}")
    user_id = created["id"]

    try:
        # The trigger creates the profile; wait for it.
        for _ in range(20):
            prof = rows(url, service, f"/rest/v1/profiles?select=id,timezone,checkin_cadence_minutes&id=eq.{user_id}")
            if prof:
                break
            time.sleep(0.25)
        check("temp profile created by trigger", bool(prof), repr(prof))
        if not prof:
            return 1

        patch(url, service, f"/rest/v1/profiles?id=eq.{user_id}", {
            "timezone": "Asia/Kolkata",
            "checkin_cadence_minutes": 120,
            "checkin_active_hours_start": "08:00",
            "checkin_active_hours_end": "22:00",
        })

        # India day: 4 doings (3 windowed, 1 chat), 1 impulse, 3 journal entries, 1 quest.
        insert(url, service, "doings_logs", [
            {"user_id": user_id, "kind": "doing", "content": "w1", "energy": 7,
             "source": "checkin_reply", "logged_at": "2026-10-20T03:00:00Z",
             "checkin_window": "2026-10-20T02:30:00Z"},
            {"user_id": user_id, "kind": "doing", "content": "w2", "energy": 9,
             "source": "checkin_reply", "logged_at": "2026-10-20T05:00:00Z",
             "checkin_window": "2026-10-20T04:30:00Z"},
            {"user_id": user_id, "kind": "doing", "content": "w3", "energy": 5,
             "source": "checkin_reply", "logged_at": "2026-10-20T07:00:00Z",
             "checkin_window": "2026-10-20T06:30:00Z"},
            {"user_id": user_id, "kind": "doing", "content": "chat", "energy": 3,
             "source": "chat", "logged_at": "2026-10-20T09:30:00Z", "checkin_window": None},
            {"user_id": user_id, "kind": "impulse_failure", "content": "urge", "energy": None,
             "source": "app", "logged_at": "2026-10-20T10:30:00Z", "checkin_window": None},
        ])
        insert(url, service, "journal_entries", [
            {"user_id": user_id, "content": "good", "entry_date": "2026-10-20", "severity": "S3"},
            {"user_id": user_id, "content": "hard", "entry_date": "2026-10-20", "severity": "S1"},
            {"user_id": user_id, "content": "heavy", "entry_date": "2026-10-20", "severity": "S2"},
            {"user_id": user_id, "content": "plain", "entry_date": "2026-10-19", "severity": None},
        ])
        insert(url, service, "metrics", [{
            "user_id": user_id, "name": "Step1 quest", "domain": "Purpose/Legacy",
            "is_quest": True, "quest_status": "completed", "quest_deadline": "2026-10-20",
            "formula": {"var": "doings_count"}, "formula_status": "validated",
            "output_unit": "count",
        }])

        day = rows(url, service,
                   f"/rest/v1/metric_vars_daily?select=*&user_id=eq.{user_id}&day=eq.2026-10-20")
        check("India day row present", len(day) == 1, repr(day))
        if day:
            r = day[0]
            check("doings_count = 4", float(r["doings_count"]) == 4, r["doings_count"])
            check("hours_logged = 6.0 (3 windows x 120m / 60)", abs(float(r["hours_logged"]) - 6.0) < 1e-9,
                  r["hours_logged"])
            check("energy_avg = 6.0", abs(float(r["energy_avg"]) - 6.0) < 1e-9, r["energy_avg"])
            check("impulse_failures = 1", float(r["impulse_failures"]) == 1, r["impulse_failures"])
            check("journal_positive_mentions = 1", float(r["journal_positive_mentions"]) == 1,
                  r["journal_positive_mentions"])
            check("journal_negative_mentions = 2", float(r["journal_negative_mentions"]) == 2,
                  r["journal_negative_mentions"])
            check("quest_completions = 1", float(r["quest_completions"]) == 1, r["quest_completions"])
            check("view has exactly the seven variables",
                  set(r) == {"user_id", "day", "doings_count", "hours_logged", "energy_avg",
                             "impulse_failures", "journal_positive_mentions",
                             "journal_negative_mentions", "quest_completions"}, sorted(r))

        journal_only = rows(url, service,
                            f"/rest/v1/metric_vars_daily?select=*&user_id=eq.{user_id}&day=eq.2026-10-19")
        check("journal-only day produces a row", len(journal_only) == 1, repr(journal_only))
        if journal_only:
            check("journal-only energy_avg is null", journal_only[0]["energy_avg"] is None,
                  journal_only[0]["energy_avg"])
            check("journal-only doings_count = 0", float(journal_only[0]["doings_count"]) == 0,
                  journal_only[0]["doings_count"])

        zero = rows(url, service,
                    f"/rest/v1/metric_vars_daily?select=*&user_id=eq.{user_id}&day=eq.2026-10-18")
        check("zero-activity day produces no row", zero == [], repr(zero))

        # DST day (America/New_York 2026-03-08, 60-min cadence): 00:00 EST and 03:00 EDT.
        patch(url, service, f"/rest/v1/profiles?id=eq.{user_id}", {
            "timezone": "America/New_York",
            "checkin_cadence_minutes": 60,
            "checkin_active_hours_start": "00:00",
            "checkin_active_hours_end": "06:00",
        })
        insert(url, service, "doings_logs", [
            {"user_id": user_id, "kind": "doing", "content": "dst-1", "energy": 5,
             "source": "checkin_reply", "logged_at": "2026-03-08T05:30:00Z",
             "checkin_window": "2026-03-08T05:00:00Z"},
            {"user_id": user_id, "kind": "doing", "content": "dst-2", "energy": 6,
             "source": "checkin_reply", "logged_at": "2026-03-08T07:30:00Z",
             "checkin_window": "2026-03-08T07:00:00Z"},
        ])
        dst = rows(url, service,
                   f"/rest/v1/metric_vars_daily?select=*&user_id=eq.{user_id}&day=eq.2026-03-08")
        check("DST day row present", len(dst) == 1, repr(dst))
        if dst:
            check("DST hours_logged = 2.0", abs(float(dst[0]["hours_logged"]) - 2.0) < 1e-9,
                  dst[0]["hours_logged"])
            check("DST energy_avg = 5.5", abs(float(dst[0]["energy_avg"]) - 5.5) < 1e-9,
                  dst[0]["energy_avg"])

        # ---------------------------------------------------------------- guard truth table
        print("\n== C. guard truth table ==")
        delete(url, service, f"/rest/v1/jobs?type=eq.metric_eval&payload->>user_id=eq.{user_id}")
        patch(url, service, f"/rest/v1/profiles?id=eq.{user_id}", {
            "timezone": "Asia/Kolkata",
            "checkin_cadence_minutes": 120,
            "checkin_active_hours_start": "08:00",
            "checkin_active_hours_end": "22:00",
        })

        def enqueue(now):
            status, body = req(url, "POST", "/rest/v1/rpc/enqueue_metric_eval_jobs",
                               {"p_now": now}, token=service, key=service)
            if status != 200:
                raise RuntimeError(f"rpc enqueue -> {status}: {body}")
            return body

        check("out-of-window (00:46) inserts nothing", enqueue("2026-10-21T00:46:00+05:30") == 0)
        check("in-window (00:31) inserts one", enqueue("2026-10-21T00:31:00+05:30") == 1)
        check("already-jobed blocks a second insert", enqueue("2026-10-21T00:31:00+05:30") == 0)
        job = rows(url, service,
                   f"/rest/v1/jobs?select=payload,status&type=eq.metric_eval&payload->>user_id=eq.{user_id}")
        check("job payload is {user_id, computed_for}",
              bool(job) and job[0]["payload"] == {"user_id": user_id, "computed_for": "2026-10-20"},
              repr(job))

        delete(url, service, f"/rest/v1/jobs?type=eq.metric_eval&payload->>user_id=eq.{user_id}")

        # archive the only metric -> no-metrics leg
        metric_rows = rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}")
        metric_id = metric_rows[0]["id"]
        patch(url, service, f"/rest/v1/metrics?id=eq.{metric_id}",
              {"archived_at": "2026-10-20T00:00:00Z"})
        check("no active metric inserts nothing", enqueue("2026-10-21T00:31:00+05:30") == 0)
        patch(url, service, f"/rest/v1/metrics?id=eq.{metric_id}", {"archived_at": None})

        # kill switch
        patch(url, service, "/rest/v1/config?key=eq.metric_eval_enabled", {"value": False})
        check("kill switch off inserts nothing", enqueue("2026-10-21T00:31:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.metric_eval_enabled", {"value": True})
        check("kill switch restored", enqueue("2026-10-21T00:31:00+05:30") == 1)

        print("\n== D. schema, privileges, schedule ==")
        kind = sql_rows("select table_type from information_schema.tables "
                        "where table_schema='public' and table_name='metric_vars_daily';")
        check("information_schema says metric_vars_daily is a VIEW",
              bool(kind) and kind[0].get("table_type") == "VIEW", repr(kind))
        cols = sql_rows("select table_name, count(*)::int as n from information_schema.columns "
                        "where table_schema='public' and table_name in ('metrics','metric_points') "
                        "group by table_name order by table_name;")
        col_map = {r["table_name"]: r["n"] for r in cols}
        check("metrics keeps its 13 columns", col_map.get("metrics") == 13, repr(col_map))
        check("metric_points keeps its 5 columns", col_map.get("metric_points") == 5, repr(col_map))
        priv = sql_rows("select has_table_privilege('authenticated','public.metric_vars_daily','select') "
                        "as auth_select, has_table_privilege('service_role','public.metric_vars_daily','select') "
                        "as svc_select;")
        check("authenticated has no view grant", bool(priv) and priv[0]["auth_select"] is False, repr(priv))
        check("service_role can read the view", bool(priv) and priv[0]["svc_select"] is True, repr(priv))
        func = sql_rows("select prosecdef, proconfig from pg_proc where proname='enqueue_metric_eval_jobs';")
        check("enqueue fn is definer + pinned search_path",
              bool(func) and func[0].get("prosecdef") is True
              and "search_path=public" in (func[0].get("proconfig") or []), repr(func))
        sched = sql_rows("select jobname, schedule, active from cron.job where jobname='metric-eval-daily';")
        check("metric-eval-daily is scheduled every 15 min",
              bool(sched) and sched[0].get("schedule") == "*/15 * * * *" and sched[0].get("active") is True,
              repr(sched))

        cfg = rows(url, service,
                   "/rest/v1/config?select=key,value&key=in.(metric_formula_bounds,metric_eval_enabled,metric_history_days)&order=key")
        cfg_map = {r["key"]: r["value"] for r in cfg}
        check("metric_formula_bounds exact",
              cfg_map.get("metric_formula_bounds") == {"max_depth": 6, "max_nodes": 30,
                                                       "literal_abs_max": 1000}, repr(cfg_map))
        check("metric_eval_enabled is boolean true", cfg_map.get("metric_eval_enabled") is True)
        check("metric_history_days = 30", cfg_map.get("metric_history_days") == 30)

    finally:
        # Cleanup: remove jobs (no FK) then the auth user (cascades profile/doings/journal/metrics).
        try:
            delete(url, service, f"/rest/v1/jobs?type=eq.metric_eval&payload->>user_id=eq.{user_id}")
        except Exception:  # noqa: BLE001
            pass
        try:
            req(url, "DELETE", f"/auth/v1/admin/users/{user_id}", token=service, key=service)
        except Exception:  # noqa: BLE001
            pass

    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s)")
        return 1
    print("PASS: FP-07 Step 1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
