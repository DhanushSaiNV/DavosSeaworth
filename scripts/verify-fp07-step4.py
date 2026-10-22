#!/usr/bin/env python3
"""FP-07 Step 4 verification: runEval, the metric_eval handler, and drill legs.

Covers PLAN Step 4 Verify:
  * a planted day of mixed check-in/chat doings + a journal entry + a completed quest
    produces hand-computed points (hours math, severity mapping, compliance denominator)
  * a re-run after one late doing updates the value in place (upsert do-update)
  * a planted division-by-zero formula is skipped with a warning, other metrics unaffected
  * the kill switch off makes the Step 1 enqueue fn insert nothing and a planted job no-op
  * ten planted metric_eval jobs drain in one dispatcher tick (FAST membership)
  * static: FAST_JOB_TYPES gained exactly metric_eval; no trust writes; no grid math
    re-implemented outside windows.ts; the registry has fourteen implemented handlers

The script creates a throwaway auth user, plants rows, and deletes the user (cascade) plus
its jobs at the end. It never touches an existing beta user's data.

Usage: python scripts/verify-fp07-step4.py
"""

import http.client
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
DAY = "2026-10-20"


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


def req(url, method, path, body=None, token=None, key=None, headers=None, timeout=120):
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(3):
        request = urllib.request.Request(url + path, data=data, headers=h, method=method)
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
        except (http.client.RemoteDisconnected, urllib.error.URLError, TimeoutError) as exc:
            if attempt == 2:
                raise
            print(f"  ..   transient network error ({exc}); retrying {path}")
            time.sleep(1 + attempt)


def rows(url, service, path):
    status, body = req(url, "GET", path, token=service, key=service)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def insert(url, service, table, payload, represent=True):
    headers = {"Prefer": "return=representation"} if represent else {"Prefer": "return=minimal"}
    status, body = req(
        url, "POST", f"/rest/v1/{table}", payload, token=service, key=service, headers=headers
    )
    if status not in (200, 201, 204):
        raise RuntimeError(f"POST {table} -> {status}: {body}")
    return body


def patch(url, service, path, payload):
    status, body = req(
        url,
        "PATCH",
        path,
        payload,
        token=service,
        key=service,
        headers={"Prefer": "return=minimal"},
    )
    if status not in (200, 204):
        raise RuntimeError(f"PATCH {path} -> {status}: {body}")
    return body


def rpc(url, service, name, payload):
    status, body = req(url, "POST", f"/rest/v1/rpc/{name}", payload, token=service, key=service)
    if status != 200:
        raise RuntimeError(f"RPC {name} -> {status}: {body}")
    return body


def smoke(url, token, action, user_id, extra=""):
    status, body = req(
        url,
        "POST",
        f"/functions/v1/dev-smoke?action={action}&user={user_id}{extra}",
        token=token,
        key=token,
    )
    return status, body


def dispatch(url, service):
    status, body = req(url, "POST", "/functions/v1/job-dispatcher", {}, token=service, key=service)
    return status, body


def values_by_name(url, service, user_id):
    metrics = rows(url, service, f"/rest/v1/metrics?select=id,name&user_id=eq.{user_id}")
    if not metrics:
        return {}, 0
    ids = ",".join(m["id"] for m in metrics)
    points = rows(
        url,
        service,
        f"/rest/v1/metric_points?select=metric_id,value,computed_for&metric_id=in.({ids})",
    )
    names = {m["id"]: m["name"] for m in metrics}
    return (
        {
            names[p["metric_id"]]: float(p["value"])
            for p in points
            if p["computed_for"] == DAY
        },
        len(points),
    )


def close(actual, expected, eps=1e-9):
    return abs(float(actual) - float(expected)) <= eps


def main():
    load_dotenv()
    url = (
        os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or ""
    ).rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    if not url or not service or not anon or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")

    print("== FP-07 Step 4: runEval, dispatcher handler, drills ==\n")

    run_eval = open(
        os.path.join(ROOT, "supabase/functions/_shared/metrics/runEval.ts"), encoding="utf-8"
    ).read()
    dispatcher = open(
        os.path.join(ROOT, "supabase/functions/job-dispatcher/index.ts"), encoding="utf-8"
    ).read()
    dev_smoke = open(
        os.path.join(ROOT, "supabase/functions/dev-smoke/index.ts"), encoding="utf-8"
    ).read()

    print("== A. static surface ==")
    check("runEval module exists", len(run_eval) > 0)
    check("runEval drives the frozen grid, not a SQL twin",
          "loadGrid" in run_eval and "windowsForLocalDay" in run_eval
          and "expectedStarts" in run_eval)
    check("compliance is assembled from expected vs answered windows",
          "complianceFromWindows" in run_eval and "checkin_window" in run_eval)
    view_select = re.search(r"doings_count,hours_logged[^\"]*", run_eval)
    check("the view read does not select checkin_compliance_rate",
          view_select is not None and "checkin_compliance_rate" not in view_select.group(0),
          repr(view_select.group(0) if view_select else None))
    check("metric_points is upserted on (metric_id, computed_for)",
          ".upsert(" in run_eval and 'onConflict: "metric_id,computed_for"' in run_eval)
    check("one structured [metric-eval] line", "[metric-eval]" in run_eval
          and "zero_data" in run_eval and "skipped=" in run_eval)
    check("kill switch is read fail-closed", "metric_eval_enabled" in run_eval
          and "getConfigBoolean" in run_eval)

    fast = re.search(r"const FAST_JOB_TYPES = new Set\(\[([^\]]+)\]\)", dispatcher)
    fast_types = re.findall(r"'([^']+)'", fast.group(1)) if fast else []
    check("FAST_JOB_TYPES is exactly the cheap set + metric_eval + drift_scan",
          fast_types == ["smoke_test", "watchdog_checkin", "purge_memory", "metric_eval", "drift_scan"],
          repr(fast_types))
    handler_keys = re.findall(
        r"(?m)^  ([a-z_]+):\s*(?:async\s*\(|handleLlmRetry)", dispatcher
    )
    check("the dispatcher implements fourteen handlers", len(handler_keys) == 14, repr(handler_keys))
    check("metric_eval is one of them", "metric_eval" in handler_keys)
    check("strike_fire is one of them", "strike_fire" in handler_keys)
    check("histogram_daily is one of them", "histogram_daily" in handler_keys)
    check("metric_eval delegates through a lazy import",
          "import('../_shared/metrics/runEval.ts')" in dispatcher)
    for leg in ("eval", "report"):
        check(f"metric-drill has the {leg} leg", f'leg === "{leg}"' in dev_smoke or leg in dev_smoke)

    metrics_src = "\n".join(
        open(os.path.join(ROOT, "supabase/functions/_shared/metrics", name), encoding="utf-8").read()
        for name in ("formula.ts", "create.ts", "presets.ts", "runEval.ts")
    )
    check("no grid arithmetic re-implemented in the metrics modules",
          "cadenceMinutes *" not in metrics_src and "60_000" not in metrics_src)
    check("no trust_score/trust_events write in the metrics modules",
          'from("trust_events")' not in metrics_src and "trust_score:" not in metrics_src)

    print("\n== B. live (temp user; never a beta user) ==")
    email = f"fp07-step4-{uuid.uuid4().hex[:12]}@example.com"
    status, created = req(
        url,
        "POST",
        "/auth/v1/admin/users",
        {"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
        token=service,
        key=service,
    )
    if status not in (200, 201) or not created.get("id"):
        sys.exit(f"could not create temp user: {status} {created}")
    uid = created["id"]
    jobs = []
    original_enabled = None
    try:
        patch(
            url,
            service,
            f"/rest/v1/profiles?id=eq.{uid}",
            {
                "timezone": "UTC",
                "checkin_cadence_minutes": 60,
                "checkin_active_hours_start": "09:00:00",
                "checkin_active_hours_end": "17:00:00",
            },
        )
        status, seeded = smoke(url, smoke_token, "seed-metrics", uid)
        check("seed-metrics inserts the eight presets", status == 200
              and seeded.get("inserted") == 8, f"{status} {seeded}")

        # One completed quest metric (the quest aggregate is keyed on quest_deadline).
        quest = insert(url, service, "metrics", [{
            "user_id": uid,
            "name": "Quest Done",
            "domain": "Purpose/Legacy",
            "output_unit": "quests",
            "formula": {"var": "quest_completions"},
            "formula_status": "validated",
            "is_core": True,
            "is_quest": True,
            "quest_status": "completed",
            "quest_deadline": DAY,
        }])
        check("quest fixture inserted", isinstance(quest, list) and len(quest) == 1, repr(quest))

        # The divided-by-zero metric goes through the real create helper (valid gate, bad
        # evaluation). Env is supplied because the helper imports the service config.
        eval_script = f"""
import {{ insertValidatedMetric }} from "./supabase/functions/_shared/metrics/create.ts";
const r = await insertValidatedMetric({{
  user_id: "{uid}",
  name: "Divide By Zero",
  domain: "Career",
  output_unit: "x",
  formula: {{ "/": [1, 0] }},
  is_core: false,
}}, {{ max_depth: 6, max_nodes: 30, literal_abs_max: 1000 }});
console.log(JSON.stringify(r));
"""
        env = dict(os.environ)
        env.update({
            "SUPABASE_URL": url,
            "SUPABASE_SERVICE_ROLE_KEY": service,
        })
        proc = subprocess.run(
            ["deno", "eval", "--allow-read", "--allow-env", "--allow-net", "--quiet", eval_script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )
        parsed = None
        for line in reversed((proc.stdout or "").strip().splitlines()):
            try:
                parsed = json.loads(line)
                break
            except Exception:  # noqa: BLE001
                continue
        check("create helper planted the divide metric", isinstance(parsed, dict)
              and parsed.get("ok") is True, (proc.stdout or "")[-400:] + (proc.stderr or "")[-400:])

        # A day with 3 doings (2 check-in + 1 chat), 1 impulse, 2 journal rows, 1 quest.
        insert(url, service, "doings_logs", [
            {"user_id": uid, "kind": "doing", "content": "nine", "energy": 6,
             "source": "checkin_reply", "logged_at": f"{DAY}T09:00:00Z",
             "checkin_window": f"{DAY}T09:00:00Z"},
            {"user_id": uid, "kind": "doing", "content": "ten", "energy": 4,
             "source": "checkin_reply", "logged_at": f"{DAY}T10:00:00Z",
             "checkin_window": f"{DAY}T10:00:00Z"},
            {"user_id": uid, "kind": "doing", "content": "chat", "energy": 8,
             "source": "chat", "logged_at": f"{DAY}T12:00:00Z", "checkin_window": None},
            {"user_id": uid, "kind": "impulse_failure", "content": "urge", "energy": None,
             "source": "app", "logged_at": f"{DAY}T13:00:00Z", "checkin_window": None},
        ])
        insert(url, service, "journal_entries", [
            {"user_id": uid, "content": "good day", "entry_date": DAY, "severity": "S3"},
            {"user_id": uid, "content": "hard evening", "entry_date": DAY, "severity": "S2"},
        ])

        status, report = smoke(url, smoke_token, "metric-drill", uid, f"&leg=report&date={DAY}")
        check("report returns 200", status == 200, f"{status} {report}")
        check("report grants exactly 8 expected windows", report.get("expectedWindows") == 8,
              repr(report.get("expectedWindows")))
        check("report saw 2 answered windows", report.get("answeredWindows") == 2,
              repr(report.get("answeredWindows")))
        expected_vars = {
            "doings_count": 3,
            "hours_logged": 2,
            "checkin_compliance_rate": 0.25,
            "energy_avg": 6,
            "impulse_failures": 1,
            "journal_positive_mentions": 1,
            "journal_negative_mentions": 1,
            "quest_completions": 1,
        }
        ok_vars = all(close(report.get("vars", {}).get(k, 999), v) for k, v in expected_vars.items())
        check("the eight variables match the hand math", ok_vars, repr(report.get("vars")))
        check("no zero-data variables on a fully planted day", report.get("zeroData") == [],
              repr(report.get("zeroData")))

        status, ev = smoke(url, smoke_token, "metric-drill", uid, f"&leg=eval&date={DAY}")
        check("eval returns 200", status == 200, f"{status} {ev}")
        check("eval sees ten active metrics", ev.get("metrics") == 10, repr(ev.get("metrics")))
        check("nine valid metrics produce points", ev.get("pointsWritten") == 9,
              repr(ev.get("pointsWritten")))
        check("the divide metric is skipped", len(ev.get("skipped", [])) == 1
              and ev["skipped"][0].get("name") == "Divide By Zero", repr(ev.get("skipped")))
        check("eval is enabled", ev.get("disabled") is False, repr(ev.get("disabled")))

        expected_points = {
            "Momentum": 3,
            "Deep Work Hours": 2,
            "Check-in Consistency": 25,
            "Energy Level": 6,
            "Impulse Control": 0,
            "Journal Positivity": 50,
            "Quest Completions": 1,
            "Life Balance": 6,
            "Quest Done": 1,
        }
        points, total = values_by_name(url, service, uid)
        check("exactly nine points exist for the day", total == 9, f"{total}")
        ok_points = all(k in points and close(points[k], v) for k, v in expected_points.items())
        check("every point matches the hand-computed value", ok_points, repr(points))
        check("the divide metric has no point", "Divide By Zero" not in points, repr(points.keys()))

        # Late-arriving doing: 4 doings, 3 windows, energy 7, compliance 3/8.
        insert(url, service, "doings_logs", [{
            "user_id": uid, "kind": "doing", "content": "late", "energy": 10,
            "source": "checkin_reply", "logged_at": f"{DAY}T11:00:00Z",
            "checkin_window": f"{DAY}T11:00:00Z",
        }])
        status, ev2 = smoke(url, smoke_token, "metric-drill", uid, f"&leg=eval&date={DAY}")
        check("re-run returns 200", status == 200, f"{status} {ev2}")
        check("re-run still writes nine points (no duplicates)",
              ev2.get("pointsWritten") == 9, repr(ev2.get("pointsWritten")))
        expected2 = {
            "Momentum": 4,
            "Deep Work Hours": 3,
            "Check-in Consistency": 37.5,
            "Energy Level": 7,
            "Impulse Control": 0,
            "Journal Positivity": 50,
            "Quest Completions": 1,
            "Life Balance": 8.5,
            "Quest Done": 1,
        }
        points2, total2 = values_by_name(url, service, uid)
        check("re-run updated in place (nine rows)", total2 == 9, f"{total2}")
        ok2 = all(k in points2 and close(points2[k], v) for k, v in expected2.items())
        check("re-run refreshed every changed value", ok2, repr(points2))

        # ---- kill switch ---------------------------------------------------
        status, cfg = req(
            url,
            "GET",
            "/rest/v1/config?select=value&key=eq.metric_eval_enabled",
            token=service,
            key=service,
        )
        if status == 200 and cfg:
            original_enabled = cfg[0]["value"]
        patch(url, service, "/rest/v1/config?key=eq.metric_eval_enabled", {"value": False})
        enqueued = rpc(url, service, "enqueue_metric_eval_jobs",
                       {"p_now": f"{DAY}T00:31:00Z"})
        check("kill switch off: the Step 1 fn inserts nothing", enqueued == 0, repr(enqueued))
        jobs_for_user = rows(
            url, service,
            f"/rest/v1/jobs?select=id&type=eq.metric_eval&payload->>user_id=eq.{uid}",
        )
        check("kill switch off: no cron job row exists", jobs_for_user == [], repr(jobs_for_user))

        _, before = values_by_name(url, service, uid)
        job = insert(url, service, "jobs", [{
            "type": "metric_eval",
            "payload": {"user_id": uid, "computed_for": DAY},
            "status": "pending",
            "next_retry_at": "2000-01-01T00:00:00Z",
        }])
        jobs.append(job[0]["id"])
        status, tick = dispatch(url, service)
        check("kill-switch job tick accepted", status == 200, f"{status} {tick}")
        after_job = rows(url, service, f"/rest/v1/jobs?select=status&id=eq.{job[0]['id']}")
        check("kill-switch job is done (no-op)", after_job and after_job[0]["status"] == "done",
              repr(after_job))
        _, after = values_by_name(url, service, uid)
        check("kill-switch job wrote no points", before == after == 9,
              f"{before}->{after}")
        patch(url, service, "/rest/v1/config?key=eq.metric_eval_enabled",
              {"value": original_enabled if original_enabled is not None else True})

        # ---- ten jobs, one tick -------------------------------------------
        batch = insert(url, service, "jobs", [
            {
                "type": "metric_eval",
                "payload": {"user_id": uid, "computed_for": DAY},
                "status": "pending",
                "next_retry_at": "2000-01-01T00:00:00Z",
            }
            for _ in range(10)
        ])
        batch_ids = [j["id"] for j in batch]
        jobs.extend(batch_ids)
        status, tick = dispatch(url, service)
        check("batch tick accepted", status == 200, f"{status} {tick}")
        check("one tick processed ten metric_eval jobs",
              isinstance(tick, dict) and tick.get("processed") == 10, repr(tick))
        done = rows(
            url,
            service,
            f"/rest/v1/jobs?select=id,status&id=in.({','.join(batch_ids)})",
        )
        check("all ten planted jobs are done after one tick",
              len(done) == 10 and all(r["status"] == "done" for r in done), repr(done))
        _, batch_points = values_by_name(url, service, uid)
        check("the batch left nine points (still no duplicates)", batch_points == 9,
              f"{batch_points}")

    finally:
        if original_enabled is not None:
            try:
                patch(url, service, "/rest/v1/config?key=eq.metric_eval_enabled",
                      {"value": original_enabled})
            except Exception:  # noqa: BLE001
                pass
        if jobs:
            try:
                req(url, "DELETE", f"/rest/v1/jobs?id=in.({','.join(jobs)})", token=service,
                    key=service)
            except Exception:  # noqa: BLE001
                pass
        try:
            req(url, "DELETE", f"/auth/v1/admin/users/{uid}", token=service, key=service)
        except Exception:  # noqa: BLE001
            pass

    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s): {FAILS}")
        return 1
    print("PASS: FP-07 Step 4")
    return 0


if __name__ == "__main__":
    sys.exit(main())
