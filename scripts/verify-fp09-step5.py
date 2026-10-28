#!/usr/bin/env python3
"""FP-09 Step 5 gate -- the `proactive` job and the watchdog/drift onboarding gates.

Refs: FP-09 FR-11, FR-12, FR-13; TECH-SPEC §2.2-2.3, §7.1, §7.3, §7.5, §7.7-7.8, §8,
§12; D12, D17, D22; PRD §3.0, §3.4.

Static
  handler        : payload enums -> silence re-check -> kill-switch re-check -> job-id
                   duplicate -> context -> one generation -> one row -> one push
  prompt         : gap/companionship builders carry only server enums, timestamps and one
                   delimited metric name/direction; no habit/watch/impulse symbol
  reuse          : `runLockedPersonaReply` + `createAiMessagePushPayload`; no provider import
  registry       : 15 of 15 handlers; `proactive` deliberately outside `FAST_JOB_TYPES`
  gates          : `runWatchdogScan`/`runDriftScan` add only the `complete` filter
  drill          : `onboarding-drill` gains `proactive`/`gaps`; the global tick guard prevents
                   a drill from nudging another complete profile
  scope          : package.json unchanged; no SQL/migration, client or FP-07 file changes;
                   the enumerated touch set is the whole diff
  docs           : TECH-SPEC + GLOSSARY as-built entries
  toolchain      : tsc, jest, deno check, eslint; FP-04/FP-08 static legs

Live (network; skipped by --static-only)
  tick table     : both windows once per local day, never a third; exact-boundary silence;
                   complete-only gate; any-status dedup; kill switch inserts nothing
  gap            : empty high_dopamine_activities -> the gap ask; row + metadata + push
  companionship  : filled profile + baseline facts + metric/journal -> the next window's
                   light check-in, no gap field
  duplicate      : re-firing the same job returns `duplicate`, never a second row
  race           : a user row planted between tick and fire -> `silent`, no row
  kill switch    : a planted job with `proactive_enabled=false` -> `disabled`, no row
  gates          : planted missed windows / late starts on an `intro` user fire nothing;
                   the same plants on a `complete` user fire exactly as before
  cleanup        : users, jobs and config restored

Owner-manual (reported, never claimed):
  * the proactive cadence/voice drill (receive the ask, fill it, judge the next ping)

Usage: python scripts/verify-fp09-step5.py [--static-only] [--no-toolchain]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []
SKIPS = []
LIVE = {}

HANDLER = "supabase/functions/_shared/proactive/runProactive.ts"
DISPATCH = "supabase/functions/job-dispatcher/index.ts"
WATCHDOG = "supabase/functions/_shared/checkin/runWatchdog.ts"
DRIFT = "supabase/functions/_shared/accountability/runDriftScan.ts"
DEV_SMOKE = "supabase/functions/dev-smoke/index.ts"
SCRIPT = "scripts/verify-fp09-step5.py"
FP04_STEP6 = "scripts/verify-fp04-step6.py"
FP08_STEP5 = "scripts/verify-fp08-step5.py"

ALLOWED_TOUCH_SET = {
    HANDLER,
    DISPATCH,
    WATCHDOG,
    DRIFT,
    DEV_SMOKE,
    SCRIPT,
    FP04_STEP6,
    FP08_STEP5,
    "docs/TECH-SPEC.md",
    "docs/GLOSSARY.md",
}

FP07_FILES = {
    "app/(app)/dashboard.tsx",
    "lib/metricsData.ts",
    "components/metrics/ConsistencyHeatmap.tsx",
    "components/metrics/ProgressBar.tsx",
    "components/metrics/StatCard.tsx",
    "components/metrics/TrendLineGraph.tsx",
}


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label +
          (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def skip(label, why):
    print(f"  SKIP {label} ({why})")
    SKIPS.append(label)


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def run(cmd, timeout=900):
    proc = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def run_stdout(cmd, timeout=120):
    proc = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, proc.stdout or ""


# --------------------------------------------------------------------------- REST


def req(method, path, body=None, token=None, key=None, headers=None, timeout=120,
        raw=None):
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    if raw is not None:
        data = raw.encode()
    else:
        data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(LIVE["url"] + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as exc:
        text = exc.read().decode()
        try:
            return exc.code, json.loads(text)
        except Exception:  # noqa: BLE001
            return exc.code, {"raw": text[:400]}


def service_req(method, path, body=None, prefer=None):
    headers = {"Prefer": prefer} if prefer else None
    return req(method, "/rest/v1" + path, body, token=LIVE["service"], key=LIVE["service"],
               headers=headers)


def user_req(method, path, token=None, body=None):
    return req(method, "/rest/v1" + path, body, token=token or LIVE["jwt"],
               key=LIVE["anon"])


def rows(path):
    status, body = service_req("GET", path)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def one(path):
    found = rows(path)
    return found[0] if found else None


def insert(table, payload):
    status, body = service_req("POST", f"/{table}", payload, prefer="return=representation")
    if status not in (200, 201, 204):
        raise RuntimeError(f"POST {table} -> {status}: {body}")
    return body


def patch(path, payload):
    status, body = service_req("PATCH", path, payload, prefer="return=representation")
    if status not in (200, 204):
        raise RuntimeError(f"PATCH {path} -> {status}: {body}")
    return body


def delete(path):
    status, body = service_req("DELETE", path)
    if status not in (200, 204):
        raise RuntimeError(f"DELETE {path} -> {status}: {body}")
    return body


def rpc(name, payload):
    return req("POST", f"/rest/v1/rpc/{name}", payload, token=LIVE["service"],
               key=LIVE["service"])


def config_value(key):
    row = one(f"/config?select=key,value&key=eq.{key}")
    return row["value"] if row else None


def set_config(key, value):
    patch(f"/config?key=eq.{key}", {"value": value})


def make_user(tag):
    email = f"{tag}-{uuid.uuid4().hex[:12]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, created = req("POST", "/auth/v1/admin/users",
                          {"email": email, "password": password, "email_confirm": True},
                          token=LIVE["service"], key=LIVE["service"])
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        raise RuntimeError(f"could not create temp user: {status} {created}")
    uid = created["id"]
    for _ in range(40):
        if rows(f"/profiles?select=id&id=eq.{uid}"):
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("temp profile not created by trigger")
    for _ in range(40):
        if rows(f"/messages?select=id&user_id=eq.{uid}"
                "&metadata->>source=eq.onboarding_opening"):
            break
        time.sleep(0.25)

    status, session = req("POST", "/auth/v1/token?grant_type=password",
                          {"email": email, "password": password}, key=LIVE["anon"])
    if status != 200 or not isinstance(session, dict) or not session.get("access_token"):
        raise RuntimeError(f"could not sign in temp user: {status} {session}")
    return uid, session["access_token"]


def drop_user(uid):
    try:
        delete(f"/jobs?payload->>user_id=eq.{uid}")
    except Exception as exc:  # noqa: BLE001
        print(f"  (job cleanup warning for {uid}: {exc})")
    req("DELETE", f"/auth/v1/admin/users/{uid}", token=LIVE["service"], key=LIVE["service"])


def smoke(query):
    return req("POST", "/functions/v1/dev-smoke?" + query, token=LIVE["smoke"],
               key=LIVE["smoke"])


def profile(uid):
    return one("/profiles?select=id,onboarding_stage,created_at,wake_time,sleep_time,routine,"
               "high_dopamine_activities,timezone,trust_score"
               f"&id=eq.{uid}")


def patch_profile(uid, payload):
    return patch(f"/profiles?id=eq.{uid}", payload)


def proactive_rows(uid):
    return rows("/messages?select=id,role,content,metadata,reply_to_message_id,persona_key,"
                f"created_at&user_id=eq.{uid}&metadata->>source=eq.proactive"
                "&order=created_at.asc")


def jobs_for(uid, day):
    nxt = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    return rows("/jobs?select=id,type,payload,status,created_at"
                f"&payload->>user_id=eq.{uid}"
                f"&created_at=gte.{day}T00:00:00Z&created_at=lt.{nxt}T00:00:00Z"
                "&order=created_at.asc")


def job_at(jobs, slot):
    for job in jobs:
        if (job.get("payload") or {}).get("slot") == slot:
            return job
    return None


def quarantine(jobs):
    for job in jobs:
        patch(f"/jobs?id=eq.{job['id']}", {
            "status": "dead",
            "next_retry_at": "2099-01-01T00:00:00Z",
        })


def tick(day, clock):
    now = f"{day}T{clock}:00Z"
    status, body = rpc("proactive_tick", {"p_now": now})
    if status != 200:
        raise RuntimeError(f"proactive_tick {now} -> {status}: {body}")
    return now, int(body or 0)


def fire(uid, job_id):
    return smoke(f"action=onboarding-drill&leg=proactive&phase=fire&user={uid}&job={job_id}")


def gaps_leg(uid):
    return smoke(f"action=onboarding-drill&leg=gaps&user={uid}")


def insert_doing(uid, logged_iso, content):
    return insert("doings_logs", {
        "user_id": uid,
        "kind": "doing",
        "source": "app",
        "logged_at": logged_iso,
        "content": content,
    })


# --------------------------------------------------------------------------- static


STEP4_BASE = "f76c874"
STEP5_COMMIT = "a780ec1"


def git_paths():
    # Pin the historical touch set to the Step 5 commit so later FP-09 steps cannot
    # pollute the Step 5 scope assertion.
    rc, diff = run_stdout(f"git diff --name-only {STEP4_BASE} {STEP5_COMMIT}")
    if rc != 0:
        raise RuntimeError(diff)
    return sorted({p.strip() for p in diff.splitlines() if p.strip()})


def functional_diff(rel):
    rc, diff = run_stdout(f'git diff -U0 {STEP4_BASE} {STEP5_COMMIT} -- "{rel}"')
    if rc != 0:
        raise RuntimeError(diff)
    added, removed = [], []
    for line in diff.splitlines():
        if line.startswith(("+++", "---", "@@")):
            continue
        if line.startswith("+"):
            body = line[1:].strip()
            if body and not body.startswith(("*", "//")):
                added.append(body)
        elif line.startswith("-"):
            body = line[1:].strip()
            if body and not body.startswith(("*", "//")):
                removed.append(body)
    return added, removed


def static_checks():
    print("== A. static: the proactive handler ==")
    src = read(HANDLER)
    check("the handler exists", bool(src))
    check("the module cites FP-09 FR-11/FR-12 and the governing sections",
          "FR-11" in src and "FR-12" in src and "§7.7" in src)
    import_lines = "\n".join(line for line in src.splitlines()
                             if line.lstrip().startswith("import"))
    check("no provider/adapter import",
          "llm" not in import_lines.replace("runPipeline", "")
          and 'from "../llm' not in src)
    check("generation reuses the locked-persona path",
          'await import("../pipeline/runPipeline.ts")' in src
          and "runLockedPersonaReply({" in src)
    lock_call = src.split("const result = await runLockedPersonaReply({", 1)[1].split("});", 1)[0]
    check("the generation call passes no userId (memory-free by construction)",
          "text: context," in lock_call and "domain: FALLBACK_DOMAIN," in lock_call
          and "persona," in lock_call and "userId:" not in lock_call)
    check("the guard order is payload -> silence -> enabled -> duplicate -> context",
          src.find("unusable payload") < src.find("Race guard first")
          < src.find("Kill switch re-check") < src.find("idempotency key")
          < src.find('await import("../pipeline/runPipeline.ts")'))
    check("the silence boundary fails closed at exact equality",
          "newestUserMs >= nowMs - minSilenceMinutes * 60_000" in src)
    check("the kill switch is a fail-closed config read",
          'getConfigBoolean("proactive_enabled")' in src)
    check("the duplicate is keyed by source_job_id",
          'metadata->>source_job_id' in src and "jobId" in src)
    check("the row is unprompted and source-stamped",
          'reply_to_message_id: null' in src
          and 'source: "proactive"' in src
          and "proactive_slot: slot" in src
          and "proactive_kind: kind" in src
          and "source_job_id: jobId" in src)
    meta_block = src.split("const metadata", 1)[1].split("const { data: inserted", 1)[0]
    check("tactical_analysis is never persisted", "tactical_analysis" not in meta_block)
    check("the push is the shared default-priority helper",
          "createAiMessagePushPayload(userId, result.assistantContent)" in src
          and "sendPush(push)" in src)
    check("a push failure is logged after the row, not rethrown",
          "push send failed" in src)

    builder = src.split("export function buildProactiveContext", 1)[1].split("function asString", 1)[0]
    check("the builder has both kinds", 'input.kind === "gap"' in builder
          and "companionship" in builder)
    check("the builder carries delimited context",
          "<proactive_context>" in builder and "</proactive_context>" in builder)
    banned = re.search(r"\b(habit|watch|impulse)\w*", builder, re.I)
    check("the builder has no habit/watch/impulse symbol", banned is None,
          banned.group(0) if banned else "")

    print("\n== B. static: registry, gates, drill and docs ==")
    dispatch = read(DISPATCH)
    check("the dispatcher registers proactive",
          "proactive: async (payload, job) =>" in dispatch
          and "runProactive(payload, job.id)" in dispatch)
    handlers_block = dispatch.split("const HANDLERS", 1)[1].split("\n};", 1)[0]
    handlers = re.findall(r"^  ([a-z_]+):", handlers_block, re.M)
    check("the registry is 15 of 15", len(set(handlers)) == 15 and "proactive" in handlers,
          repr(sorted(set(handlers))))
    fast_line = next((line for line in dispatch.splitlines() if "FAST_JOB_TYPES" in line
                      and "=" in line), "")
    check("proactive is outside FAST_JOB_TYPES",
          "proactive" not in fast_line and all(name in fast_line for name in (
              "smoke_test", "watchdog_checkin", "purge_memory", "metric_eval", "drift_scan")),
          fast_line)

    for path, source in ((WATCHDOG, read(WATCHDOG)), (DRIFT, read(DRIFT))):
        check(f"{path} gates the profiles walk to complete",
              source.count('.eq("onboarding_stage", "complete")') == 1)
    wd_add, wd_rem = functional_diff(WATCHDOG)
    dr_add, dr_rem = functional_diff(DRIFT)
    check("the watchdog diff is only the gate (plus its comment)",
          len(wd_add) == 1 and "onboarding_stage" in wd_add[0]
          and len(wd_rem) == 1 and 'from("profiles")' in wd_rem[0],
          f"added={wd_add} removed={wd_rem}")
    check("the drift diff is only the gate (plus its comment)",
          len(dr_add) == 1 and "onboarding_stage" in dr_add[0] and not dr_rem,
          f"added={dr_add} removed={dr_rem}")

    smoke_src = read(DEV_SMOKE)
    check("dev-smoke adds the gaps leg",
          'leg === "gaps"' in smoke_src and "gapVector(" in smoke_src)
    check("dev-smoke adds the proactive tick/fire leg",
          'leg === "proactive"' in smoke_src and "runProactive(job.payload, job.id)" in smoke_src
          and 'phase !== "tick" && phase !== "fire" && phase !== "both"' in smoke_src)
    check("the global tick guard refuses another complete profile",
          "another complete profile exists" in smoke_src
          and '.eq("onboarding_stage", "complete")' in smoke_src
          and '.neq("id", user)' in smoke_src)

    tech = read("docs/TECH-SPEC.md")
    glossary = read("docs/GLOSSARY.md")
    check("TECH-SPEC records the Step 5 as-built and the closed registry",
          "FP-09 Step 5" in tech and "fifteen" in tech and "runProactive" in tech)
    check("GLOSSARY records the handler, the metadata source and the drill",
          "runProactive" in glossary and "`proactive`" in glossary
          and "onboarding-drill&leg=gaps" in glossary)
    check("the FP-08 fixture is planted complete for the new gate",
          '"onboarding_stage": "complete"' in read(FP08_STEP5))

    print("\n== C. static: scope ==")
    paths = git_paths()
    extra = [p for p in paths if p not in ALLOWED_TOUCH_SET]
    check("the Step 5 touch set is exact", not extra, repr(extra))
    check("package.json is unchanged",
          not run_stdout(f"git diff --name-only {STEP4_BASE} {STEP5_COMMIT} -- package.json")[1].strip())
    check("no migration or SQL file changed",
          not any(p.startswith("supabase/migrations/") or p.endswith(".sql") for p in paths),
          repr(paths))
    check("no client file changed",
          not any(p.startswith(("app/", "lib/", "components/")) for p in paths),
          repr(paths))
    check("zero FP-07 files changed", not any(p in FP07_FILES for p in paths))


# --------------------------------------------------------------------------- toolchain


def toolchain():
    print("\n== D. toolchain ==")
    rc, out = run("npx tsc --noEmit", timeout=900)
    check("tsc --noEmit clean", rc == 0, out[-800:])
    rc, out = run("npx jest --runInBand", timeout=1200)
    check("jest green", rc == 0, out[-1200:])
    rc, out = run(
        "deno check supabase/functions/_shared/proactive/runProactive.ts "
        "supabase/functions/job-dispatcher/index.ts supabase/functions/dev-smoke/index.ts",
        timeout=600)
    check("deno check clean", rc == 0, out[-800:])
    rc, out = run("npx eslint .", timeout=900)
    check("eslint has no errors", rc == 0, out[-1200:])

    rc, out = run("python scripts/verify-fp04-step6.py --static-only --no-deno --no-tsc",
                  timeout=900)
    check("FP-04 Step 6 static gate green", rc == 0, out[-1200:])
    rc, out = run("python scripts/verify-fp08-step5.py --static-only --no-toolchain",
                  timeout=900)
    check("FP-08 Step 5 static gate green", rc == 0, out[-1200:])


# --------------------------------------------------------------------------- live


def live_checks():
    uid, token = make_user("fp09-step5")
    LIVE["uid"] = uid
    LIVE["jwt"] = token
    patch_profile(uid, {
        "onboarding_stage": "complete",
        "timezone": "UTC",
        "wake_time": "07:00",
        "sleep_time": "23:00",
        "routine": {"summary": "Coffee, work, a walk, and an early night."},
        "high_dopamine_activities": [],
    })

    print("\n== E. live: gap vector and the tick qualification table ==")
    status, gaps = gaps_leg(uid)
    check("the gaps leg returns high_dopamine_activities first",
          status == 200 and gaps.get("gap_key") == "high_dopamine_activities",
          f"{status} {gaps}")
    check("the empty profile has zero baseline facts", gaps.get("baseline_facts") == 0,
          repr(gaps))

    day1 = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    _, c1 = tick(day1, "10:10")
    check("the first window qualifies once", c1 == 1, str(c1))
    _, c1b = tick(day1, "10:10")
    check("the first window never qualifies twice", c1b == 0, str(c1b))
    _, c2 = tick(day1, "19:40")
    check("the second window qualifies once", c2 == 1, str(c2))
    _, c2b = tick(day1, "19:40")
    check("the second window never qualifies twice", c2b == 0, str(c2b))
    _, c3 = tick(day1, "12:00")
    check("a non-window tick inserts nothing", c3 == 0, str(c3))
    jobs1 = jobs_for(uid, day1)
    check("exactly two jobs exist for the local day", len(jobs1) == 2, repr(jobs1))
    gap_job = job_at(jobs1, "10:00")
    check("the first job carries the gap kind and key",
          bool(gap_job) and (gap_job.get("payload") or {}).get("kind") == "gap"
          and (gap_job.get("payload") or {}).get("gap_key") == "high_dopamine_activities",
          repr(gap_job))
    quarantine(jobs1)

    print("\n== F. live: the gap ask, row, push and duplicate ==")
    status, body = fire(uid, gap_job["id"])
    outcome = (body or {}).get("outcome") or {}
    check("firing the gap job writes one message",
          status == 200 and outcome.get("status") == "written", f"{status} {body}")
    check("the gap context carries the server-built ask",
          "gap: high_dopamine_activities" in (outcome.get("context") or "")
          and "easy hit of stimulation" in (outcome.get("context") or ""),
          repr(outcome.get("context")))
    banned = re.search(r"\b(habit|watch|impulse)\w*", outcome.get("context") or "", re.I)
    check("the gap context has no habit/watch/impulse symbol", banned is None,
          banned.group(0) if banned else "")

    rows_after_gap = proactive_rows(uid)
    check("exactly one proactive row exists", len(rows_after_gap) == 1, repr(rows_after_gap))
    row = rows_after_gap[0]
    meta = row.get("metadata") or {}
    check("the row is unprompted and persona-stamped",
          row.get("role") == "assistant" and row.get("reply_to_message_id") is None
          and bool(row.get("persona_key")), repr(row))
    check("the row metadata carries source/slot/kind/gap/job",
          meta.get("source") == "proactive"
          and meta.get("proactive_slot") == "10:00"
          and meta.get("proactive_kind") == "gap"
          and meta.get("proactive_gap_key") == "high_dopamine_activities"
          and meta.get("source_job_id") == gap_job["id"], repr(meta))
    check("tactical_analysis is not in the persisted metadata",
          "tactical_analysis" not in meta, repr(meta))
    push = outcome.get("push") or {}
    check("the push is default priority, collapsed and deep-linked",
          push.get("priority") == "default"
          and push.get("collapseKey") == f"chat_{uid}"
          and (push.get("data") or {}).get("deepLink") == "davos://chat"
          and push.get("userId") == uid, repr(push))

    status, dup = fire(uid, gap_job["id"])
    dup_outcome = (dup or {}).get("outcome") or {}
    check("a re-fired job returns duplicate",
          status == 200 and dup_outcome.get("status") == "duplicate", f"{status} {dup}")
    check("duplicate writes no second row", len(proactive_rows(uid)) == 1)

    patch(f"/jobs?id=eq.{gap_job['id']}", {"status": "dead"})
    _, dedup = tick(day1, "10:10")
    check("the any-status dedupe sees a dead job", dedup == 0, str(dedup))

    print("\n== G. live: gap -> companionship ==")
    patch_profile(uid, {"high_dopamine_activities": ["scrolling", "snacks"]})
    for index in range(5):
        insert("memory_facts", {
            "user_id": uid,
            "fact": f"FP09 baseline fact {index}",
            "fact_type": "baseline",
        })
    metric = insert("metrics", {
        "user_id": uid,
        "name": "FP09 Momentum",
        "domain": "Discipline/Habits",
        "is_core": True,
        "formula": {"var": "doings_count"},
        "formula_status": "validated",
        "output_unit": "count",
    })[0]
    today = datetime.now(timezone.utc).date()
    insert("metric_points", [
        {"metric_id": metric["id"], "value": 1, "computed_for": (today - timedelta(days=1)).isoformat()},
        {"metric_id": metric["id"], "value": 2, "computed_for": today.isoformat()},
    ])
    insert("journal_entries", {
        "user_id": uid,
        "content": "FP09 companionship journal probe.",
        "entry_date": (today - timedelta(days=4)).isoformat(),
    })

    status, gaps = gaps_leg(uid)
    check("the filled profile has no gap", status == 200 and gaps.get("gap_key") is None,
          f"{status} {gaps}")
    check("the gaps leg counts the five baseline facts", gaps.get("baseline_facts") == 5,
          repr(gaps))

    day2 = (today + timedelta(days=3)).isoformat()
    _, c4 = tick(day2, "19:40")
    check("the next window qualifies for companionship", c4 == 1, str(c4))
    jobs2 = jobs_for(uid, day2)
    comp_job = job_at(jobs2, "19:30")
    check("the job carries the companionship kind without a gap key",
          bool(comp_job) and (comp_job.get("payload") or {}).get("kind") == "companionship"
          and "gap_key" not in (comp_job.get("payload") or {}), repr(comp_job))
    quarantine(jobs2)
    status, body = fire(uid, comp_job["id"])
    comp_outcome = (body or {}).get("outcome") or {}
    check("firing the companionship job writes one message",
          status == 200 and comp_outcome.get("status") == "written", f"{status} {body}")
    context = comp_outcome.get("context") or ""
    check("the companionship context carries silence, journal and the metric",
          "silence_hours:" in context and "journal_gap_days: 4" in context
          and "<metric_name>FP09 Momentum</metric_name> up" in context, repr(context))
    check("the companionship context contains no gap ask", "gap:" not in context,
          repr(context))
    banned = re.search(r"\b(habit|watch|impulse)\w*", context, re.I)
    check("the companionship context has no habit/watch/impulse symbol", banned is None,
          banned.group(0) if banned else "")
    comp_rows = proactive_rows(uid)
    comp_row = next((r for r in comp_rows
                     if (r.get("metadata") or {}).get("source_job_id") == comp_job["id"]), None)
    comp_meta = (comp_row or {}).get("metadata") or {}
    check("the companionship row is stamped without a gap key",
          bool(comp_row) and comp_meta.get("proactive_kind") == "companionship"
          and "proactive_gap_key" not in comp_meta, repr(comp_meta))
    check("two proactive rows exist after both kinds", len(comp_rows) == 2, repr(comp_rows))

    print("\n== H. live: the race guard and the kill switch ==")
    race_message = insert("messages", {
        "user_id": uid,
        "role": "user",
        "content": "FP09 race probe",
        "client_message_id": str(uuid.uuid4()),
    })[0]
    day3 = (today + timedelta(days=4)).isoformat()
    _, c5 = tick(day3, "10:10")
    check("the tick still inserts before the race is known", c5 == 1, str(c5))
    jobs3 = jobs_for(uid, day3)
    race_job = job_at(jobs3, "10:00")
    quarantine(jobs3)
    status, body = fire(uid, race_job["id"])
    race_outcome = (body or {}).get("outcome") or {}
    check("a user row between tick and fire -> silent",
          status == 200 and race_outcome.get("status") == "silent", f"{status} {body}")
    check("the race writes no row",
          not any((r.get("metadata") or {}).get("source_job_id") == race_job["id"]
                  for r in proactive_rows(uid)))
    delete(f"/messages?id=eq.{race_message['id']}")

    set_config("proactive_enabled", False)
    day4 = (today + timedelta(days=5)).isoformat()
    _, c6 = tick(day4, "10:10")
    check("the disabled tick inserts nothing", c6 == 0, str(c6))
    planted = insert("jobs", {
        "type": "proactive",
        "payload": {"user_id": uid, "slot": "10:10", "kind": "gap",
                    "gap_key": "wake_time"},
        "status": "pending",
        "next_retry_at": datetime.now(timezone.utc).isoformat(),
    })[0]
    patch(f"/jobs?id=eq.{planted['id']}", {"status": "dead"})
    status, body = fire(uid, planted["id"])
    kill_outcome = (body or {}).get("outcome") or {}
    check("a planted job with the kill switch off -> disabled",
          status == 200 and kill_outcome.get("status") == "disabled", f"{status} {body}")
    check("the kill switch writes no row",
          not any((r.get("metadata") or {}).get("source_job_id") == planted["id"]
                  for r in proactive_rows(uid)))
    set_config("proactive_enabled", True)

    print("\n== I. live: the onboarding gate and the exact silence boundary ==")
    patch_profile(uid, {"onboarding_stage": "intro"})
    day5 = (today + timedelta(days=6)).isoformat()
    _, c7 = tick(day5, "10:10")
    check("an intro profile never qualifies", c7 == 0, str(c7))
    patch_profile(uid, {"onboarding_stage": "complete"})
    _, c8 = tick(day5, "10:10")
    check("the same profile qualifies at complete", c8 == 1, str(c8))
    quarantine(jobs_for(uid, day5))

    day6 = (today + timedelta(days=7)).isoformat()
    minimum = int(config_value("proactive_min_silence_minutes"))
    boundary = datetime.fromisoformat(f"{day6}T10:10:00+00:00")
    at_boundary = (boundary - timedelta(minutes=minimum)).isoformat()
    boundary_message = insert("messages", {
        "user_id": uid,
        "role": "user",
        "content": "FP09 silence boundary probe",
        "client_message_id": str(uuid.uuid4()),
        "created_at": at_boundary,
    })[0]
    _, c9 = tick(day6, "10:10")
    check("a message exactly at the silence boundary blocks the tick", c9 == 0, str(c9))
    patch(f"/messages?id=eq.{boundary_message['id']}",
          {"created_at": (boundary - timedelta(minutes=minimum + 1)).isoformat()})
    _, c10 = tick(day6, "10:10")
    check("one minute older qualifies", c10 == 1, str(c10))
    quarantine(jobs_for(uid, day6))
    delete(f"/messages?id=eq.{boundary_message['id']}")

    print("\n== J. live: the watchdog and drift gates ==")
    gate_uid, gate_token = make_user("fp09-step5-gates")
    LIVE["gate_uid"] = gate_uid
    LIVE["gate_jwt"] = gate_token
    patch_profile(gate_uid, {
        "timezone": "UTC",
        "checkin_cadence_minutes": 60,
        "checkin_active_hours_start": "09:00",
        "checkin_active_hours_end": "10:00",
        "trust_score": 50,
    })
    for offset in (1, 2, 3):
        insert_doing(gate_uid, f"{(today - timedelta(days=offset)).isoformat()}T11:00:00Z",
                     "FP09 late-start probe")

    watchdog_now = f"{today.isoformat()}T10:30:00Z"
    drift_now = f"{today.isoformat()}T12:00:00Z"
    status, intro_watch = smoke(f"action=watchdog-scan&user={gate_uid}&now={watchdog_now}")
    check("an intro user is invisible to the watchdog",
          status == 200 and intro_watch.get("profiles") == 0
          and not (intro_watch.get("alerts") or []), f"{status} {intro_watch}")
    status, intro_drift = smoke(f"action=drift-drill&user={gate_uid}&now={drift_now}")
    check("an intro user is invisible to the drift scan",
          status == 200 and intro_drift.get("users") == 0
          and intro_drift.get("patterns_fired") == 0, f"{status} {intro_drift}")

    patch_profile(gate_uid, {"onboarding_stage": "complete"})
    status, complete_watch = smoke(f"action=watchdog-scan&user={gate_uid}&now={watchdog_now}")
    check("a complete user with a missed window still fires",
          status == 200 and complete_watch.get("profiles") == 1
          and len(complete_watch.get("alerts") or []) >= 1, f"{status} {complete_watch}")
    status, complete_drift = smoke(f"action=drift-drill&user={gate_uid}&now={drift_now}")
    check("a complete user with three late starts still fires",
          status == 200 and complete_drift.get("users") == 1
          and complete_drift.get("patterns_fired", 0) >= 1,
          f"{status} {complete_drift}")
    gate_jobs = rows("/jobs?select=id,type,payload,status"
                     f"&payload->>user_id=eq.{gate_uid}&type=eq.intervention")
    reasons = [(j.get("payload") or {}).get("reason") for j in gate_jobs]
    check("the watchdog gate did not suppress the complete intervention",
          "missed_checkin" in reasons, repr(reasons))
    check("the drift gate did not suppress the complete late-start intervention",
          "drift_late_start" in reasons, repr(reasons))

    skip("proactive cadence/voice drill",
         "owner-manual: receive the ask, fill it, then judge the next window's ping")


# --------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/eslint")
    args = ap.parse_args()

    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or
           os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    LIVE.update({"url": url, "service": service, "anon": anon, "smoke": smoke_token})

    static_checks()
    if args.static_only:
        if not args.no_toolchain:
            toolchain()
        return finish()

    if not url or not service or not anon or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, "
                 "DEV_SMOKE_TOKEN")

    originals = {}
    uid = None
    gate_uid = None
    try:
        for key in ("llm_stub_mode", "classifier_mode", "dev_overrides_enabled",
                    "proactive_enabled", "drift_scan_enabled"):
            originals[key] = config_value(key)
        set_config("llm_stub_mode", True)
        set_config("classifier_mode", "stub")
        set_config("dev_overrides_enabled", True)
        set_config("proactive_enabled", True)
        set_config("drift_scan_enabled", True)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL config setup: {exc}")
        FAILS.append("config setup")
        return finish()

    try:
        live_checks()
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL live leg crashed: {exc}")
        FAILS.append("live leg crashed")
    finally:
        uid = LIVE.get("uid")
        gate_uid = LIVE.get("gate_uid")
        try:
            for key, value in originals.items():
                set_config(key, value)
        except Exception as exc:  # noqa: BLE001
            print(f"  (config restore warning: {exc})")
        if uid:
            drop_user(uid)
        if gate_uid:
            drop_user(gate_uid)
        if uid:
            check("cleanup removes the temp profile",
                  not rows(f"/profiles?select=id&id=eq.{uid}"))
            check("cleanup removes the temp jobs",
                  not rows(f"/jobs?select=id&payload->>user_id=eq.{uid}"))
        if gate_uid:
            check("cleanup removes the gate profile",
                  not rows(f"/profiles?select=id&id=eq.{gate_uid}"))

    if not args.no_toolchain:
        toolchain()
    return finish()


def finish():
    print("\n" + ("FAIL: " + ", ".join(FAILS) if FAILS else "ALL CHECKS PASS"))
    if SKIPS:
        print("OWNER MANUAL: " + ", ".join(SKIPS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
