#!/usr/bin/env python3
"""FP-08 Step 7 gate -- the Strike: strike_fire + the snooze convention + the claim-check.

Covers PLAN Step 7 Verify: the dispatcher snooze contract (five deferrals never
dead-letter), the `runStrike` handler (status guard, kill switch, S1/S2 snooze, Tiered
Proof, one corrected re-output, template fallback), the dev-smoke `strike` / `oath` legs,
and the live drills (planted evidence -> forced strike, the corrected output, the template,
the real dispatcher snooze + re-fire, and the `quit_committed` no-op).

Static
  snooze     : pure update resets pending / sets next_retry_at / decrements attempts;
               the five-snooze table; the dispatcher consumes `{snooze_until}`
  strike     : watch-only guard, kill switch, duplicate repair, S1/S2 snooze, Tiered Proof,
               one embed + match_facts, claim-check -> correction -> template, one [strike]
               line, row before the `struck` flip, no tactical_analysis persistence
  dispatch   : strike_fire registered, NOT in FAST_JOB_TYPES
  smoke      : drift-drill legs strike + oath (`oath` behind dev_overrides_enabled)
  docs       : TECH-SPEC §2.2/§7.5, GLOSSARY, PLAN row 7
  watchdog   : byte-identical (no diff in this step)

Toolchain
  tsc / full jest / deno check + the FP-03 / FP-04 / FP-05 static gates

Live (network; skipped by --static-only)
  fixture    : one synthetic auth user with a password grant JWT (never the owner)
  corrected  : planted evidence -> forced strike -> the context aggregates + fact, the
               violating quote corrected, `struck`, the unprompted row + metadata
  template   : two violations -> the deterministic evidence template
  snooze     : a live S2 inside 24 h -> the real dispatcher returns the job to pending with
               next_retry_at +24 h and attempts decremented; after the window -> struck
  cancelled  : a `quit_committed` habit completes the job without generating
  oath       : the dev-gated oath request leg writes the request row

Cleanup removes the fixture user (cascade), its jobs (no user FK), and restores
`llm_stub_mode` / `dev_overrides_enabled`.

Usage: python scripts/verify-fp08-step7.py [--static-only] [--no-toolchain]
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACC = "supabase/functions/_shared/accountability"
STRIKE = f"{ACC}/runStrike.ts"
SNOOZE = "supabase/functions/_shared/jobs/snooze.ts"
SNOOZE_TEST = "supabase/functions/_shared/jobs/snooze.test.ts"
STRIKE_PURE = f"{ACC}/strike.ts"
TEMPLATES = f"{ACC}/templates.ts"
INTERV = f"{ACC}/interventions.ts"
QUESTS = f"{ACC}/quests.ts"
DOG = "supabase/functions/_shared/checkin/runWatchdog.ts"
ADAPTER = "supabase/functions/_shared/llm/adapter.ts"
GENERATE = "supabase/functions/_shared/pipeline/generate.ts"
PIPELINE = "supabase/functions/_shared/pipeline/runPipeline.ts"
DISPATCH = "supabase/functions/job-dispatcher/index.ts"
SMOKE = "supabase/functions/dev-smoke/index.ts"
TECH = "docs/TECH-SPEC.md"
GLOSSARY = "docs/GLOSSARY.md"
PLAN = "docs/feature-prds/FP-08/FP-08-PLAN.md"

FP07_PATHS = [
    "lib/metricsData.ts",
    "lib/metricsData.test.ts",
    "app/(app)/dashboard.tsx",
    "supabase/functions/_shared/metrics/create.ts",
    "supabase/functions/_shared/metrics/formula.ts",
    "supabase/functions/_shared/metrics/presets.ts",
    "supabase/functions/_shared/metrics/runEval.ts",
    "supabase/functions/metric-eval/index.ts",
]

FAILS = []
LIVE = {}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def skip(label, why):
    print(f"  SKIP {label} ({why})")


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def run(args, timeout=900):
    proc = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                          encoding="utf-8", errors="replace")
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def git(args):
    return run(["git"] + args, timeout=120)


# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------


def req(method, path, body=None, token=None, key=None, headers=None, timeout=200):
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(3):
        request = urllib.request.Request(LIVE["url"] + path, data=data, headers=h, method=method)
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
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def rest(method, path, body=None, prefer="return=representation"):
    headers = {"Prefer": prefer} if prefer else None
    return req(method, "/rest/v1" + path, body, token=LIVE["service"], key=LIVE["service"],
               headers=headers)


def rows(path):
    status, body = rest("GET", path, prefer=None)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def one(path):
    result = rows(path)
    return result[0] if result else None


def get_config(key):
    row = one(f"/config?select=value&key=eq.{key}")
    return row["value"] if row else None


def set_config(key, value):
    status, body = rest("PATCH", f"/config?key=eq.{key}", {"value": value}, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"config {key} write failed: {status} {body}")


def smoke(query):
    return req("POST", "/functions/v1/dev-smoke?" + query, token=LIVE["smoke"], key=LIVE["smoke"])


# ---------------------------------------------------------------------------
# A. static
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static surface ==")
    strike_src = read(STRIKE)
    snooze_src = read(SNOOZE)
    snooze_test = read(SNOOZE_TEST)
    pure_src = read(STRIKE_PURE)
    templates_src = read(TEMPLATES)
    interv_src = read(INTERV)
    dispatch_src = read(DISPATCH)
    smoke_src = read(SMOKE)
    adapter_src = read(ADAPTER)
    generate_src = read(GENERATE)
    pipeline_src = read(PIPELINE)
    tech_src = read(TECH)
    glos_src = read(GLOSSARY)
    plan_src = read(PLAN)

    for rel, src in ((STRIKE, strike_src), (SNOOZE, snooze_src), (SNOOZE_TEST, snooze_test)):
        check(f"{rel} exists", bool(src))

    # -- the pure snooze update + its unit table
    check("snooze resets to pending", 'status: "pending"' in snooze_src)
    check("snooze decrements the claim increment", "Math.max(claimed - 1, 0)" in snooze_src)
    check("snooze sets next_retry_at from the request", "next_retry_at: new Date(until).toISOString()" in snooze_src)
    check("an unparseable snooze_until is rejected", "if (!Number.isFinite(until)) return null;" in snooze_src)
    check("the five-snooze table asserts attempts stays at zero",
          "for (let i = 0; i < 5; i += 1)" in snooze_test
          and "expect(attempts).toBe(0)" in snooze_test)

    # -- the dispatcher contract
    check("the dispatcher consumes a handler's snooze_until",
          "typeof result.snooze_until === 'string'" in dispatch_src
          and "await snoozeJob(job, result.snoozeUntil)" in dispatch_src)
    check("snoozeJob writes the pure update", "snoozeUpdate({" in dispatch_src)
    check("snoozeJob only settles a row it still owns", ".eq('status', 'running')" in dispatch_src)
    check("an invalid snooze fails the job instead of completing it",
          "invalid snooze_until" in dispatch_src and "throw new Error" in dispatch_src)

    # -- the Strike handler
    check("runStrike guards on watch only", 'habit.status !== "watch"' in strike_src)
    check("runStrike checks the kill switch", 'getConfigBoolean("strike_fire_enabled")' in strike_src)
    check("runStrike dedupes before generating",
          strike_src.find("const existing = await findStrikeMessage") < strike_src.find("await runLockedPersonaReply({"))
    check("runStrike reads the S1/S2 window and snoozes",
          "await loadS1S2(userId, nowMs)" in strike_src
          and 'status: "snoozed"' in strike_src
          and "snooze.snooze_until" in strike_src)
    check("the S1/S2 window is the trailing 24 h",
          "nowMs - 24 * 3_600_000" in strike_src)
    check("the Tiered Proof context is built", "buildStrikeContext({" in strike_src)
    check("verified goals use one embed against the habit description",
          "await embed([description])" in strike_src and 'rpc("match_facts"' in strike_src
          and "p_top_k: 5" in strike_src)
    check("the claim-check runs on the first output", "checkClaims(content, evidence)" in strike_src)
    check("one corrected re-output is requested", "buildStrikeCorrectionContext(baseContext" in strike_src)
    check("the corrected output is re-checked", "checkClaims(corrected.assistantContent, evidence)" in strike_src)
    check("a second violation falls to the template", "strikeTemplate({" in strike_src)
    check("the template is claim-checked before delivery",
          0 <= strike_src.find('claimCheck === "template" && checkClaims(content, evidence)')
          < strike_src.find("await deliverIntervention("))
    check("the unprompted row carries source=strike + habit_id",
          'source: "strike"' in strike_src and "habit_id: habitId" in strike_src)
    check("the high push is the deliverIntervention default",
          'priority: "default"' not in strike_src)
    check("the row lands before the struck flip",
          strike_src.find("await deliverIntervention(")
          < strike_src.rfind("await markStruck(userId, habitId)"))
    check("the handler never persists tactical_analysis",
          "tacticalAnalysis" not in strike_src and "tactical_analysis" not in strike_src)
    check("one structured [strike] log line per outcome", '"[strike]"' in strike_src
          and "JSON.stringify({" in strike_src)
    check("the dev planted quotes are read only behind the override",
          "plantedQuote(payload" in strike_src and "overridesEnabled" in strike_src)
    check("runStrike imports the provider adapter, never a provider SDK",
          "llm/adapter" in strike_src and "gemini" not in strike_src.lower()
          and "groq" not in strike_src.lower())

    # -- pure context builders (Step 2 floor)
    check("buildStrikeContext is pure and delimited",
          "export function buildStrikeContext(" in interv_src
          and 'delimit("habit"' in interv_src and 'delimit("evidence"' in interv_src
          and 'delimit("verified_goals"' in interv_src)
    check("the correction carries its violations in a delimiter",
          'delimit("claim_violation"' in interv_src)
    check("the override seam is stub-mode + dev-gated",
          "function stubDirectQuote(" in adapter_src
          and "await isDevOverridesEnabled()" in adapter_src)

    # -- dispatcher case + FAST set
    check("the dispatcher registers strike_fire", "strike_fire: async (payload)" in dispatch_src)
    check("strike_fire is NOT in FAST_JOB_TYPES",
          "FAST_JOB_TYPES = new Set(['smoke_test', 'watchdog_checkin', 'purge_memory', 'metric_eval', 'drift_scan'])" in dispatch_src
          and "strike_fire" not in re.search(
              r"FAST_JOB_TYPES\s*=\s*new Set\((\[[^\]]*\])", dispatch_src).group(1))
    check("the dispatcher drives the shared runner",
          "await runStrike(payload)" in dispatch_src
          and "outcome.status === 'snoozed'" in dispatch_src)

    # -- dev-smoke legs
    check("drift-drill gained the strike leg",
          'leg === "strike"' in smoke_src and "await runStrike({" in smoke_src)
    check("drift-drill gained the dev-gated oath leg",
          'leg === "oath"' in smoke_src and 'getConfigBoolean("dev_overrides_enabled")' in smoke_src)

    # -- the watchdog path is byte-identical in this step
    rc, out = git(["diff", "--name-only", "HEAD", "--", DOG])
    check("the watchdog path is byte-identical", rc == 0 and out.strip() == "", out.strip())

    # -- docs
    check("TECH-SPEC records the snooze convention", "Snooze convention (as built, FP-08 Step 7)" in tech_src)
    check("TECH-SPEC records the Strike build", "As built (FP-08 Step 7)" in tech_src)
    check("GLOSSARY records runStrike + the snooze helper",
          "`runStrike`" in glos_src and "`snoozeUpdate`" in glos_src)
    check("GLOSSARY records the drift-drill strike/oath legs",
          "leg=strike&habit" in glos_src and "leg=oath&source_message_id" in glos_src)
    check("the PLAN tracker marks Step 7 done",
          "| 7 | The Strike: `strike_fire` + snooze + the claim-check | ✅ |" in plan_src)

    # -- no FP-07 edits in this step
    rc, out = git(["diff", "--name-only", "HEAD", "--"] + FP07_PATHS)
    check("git diff proves zero FP-07 file edits", rc == 0 and out.strip() == "", out.strip())


def toolchain_checks():
    print("== B. toolchain + earlier gates ==")
    if not os.path.exists(os.path.join(ROOT, "node_modules")):
        skip("tsc/jest", "node_modules missing")
    else:
        rc, out = run(["cmd", "/c", "npx", "tsc", "--noEmit"])
        check("tsc --noEmit is clean", rc == 0, out[-1500:])
        rc, out = run(["cmd", "/c", "npx", "jest", "--ci"])
        check("the full jest suite is green", rc == 0, out[-1500:])
        match = re.search(r"Tests:\s+(\d+) passed, (\d+) total", out)
        check("jest ran the whole suite", bool(match) and int(match.group(1)) >= 700,
              match.group(0) if match else "no summary")

    rc, out = run(["cmd", "/c", "deno", "check",
                   STRIKE, SNOOZE, INTERV, STRIKE_PURE, TEMPLATES, DISPATCH, SMOKE,
                   ADAPTER, GENERATE, PIPELINE])
    check("deno check is clean over the wired files", rc == 0, out[-1500:])

    for label, args in (
        ("FP-03 step 7 static", ["python", "scripts/verify-fp03-step7.py", "--static-only", "--no-jest", "--no-fp02"]),
        ("FP-04 step 6 static", ["python", "scripts/verify-fp04-step6.py", "--static-only", "--no-tsc", "--no-deno"]),
        ("FP-05 step 3 static", ["python", "scripts/verify-fp05-step3.py", "--static-only"]),
    ):
        rc, out = run(args)
        check(f"{label} is green", rc == 0, out[-1800:])


# ---------------------------------------------------------------------------
# C. live
# ---------------------------------------------------------------------------


def live_setup():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    if not url or not service or not anon or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")
    LIVE.update({"url": url, "service": service, "anon": anon, "smoke": smoke_token,
                 "stub": None, "overrides": None, "users": [], "jwt": None})


def create_fixture():
    email = f"fp08-step7-{uuid.uuid4().hex[:10]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, body = req("POST", "/auth/v1/admin/users", {
        "email": email, "password": password, "email_confirm": True,
    }, token=LIVE["service"], key=LIVE["service"])
    if status not in (200, 201) or not isinstance(body, dict) or not body.get("id"):
        raise RuntimeError(f"admin createUser failed: {status} {body}")
    uid = body["id"]
    LIVE["users"].append(uid)
    for _ in range(20):
        if one(f"/profiles?select=id&id=eq.{uid}"):
            break
        time.sleep(0.25)
    status, body = rest("PATCH", f"/profiles?id=eq.{uid}", {
        "timezone": "UTC",
        "checkin_cadence_minutes": 60,
        "checkin_active_hours_start": "09:00",
        "checkin_active_hours_end": "10:00",
        "trust_score": 50,
    }, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"profile patch failed: {status} {body}")

    status, body = req("POST", "/auth/v1/token?grant_type=password",
                       {"email": email, "password": password}, key=LIVE["anon"])
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        raise RuntimeError(f"password grant failed: {status} {body}")
    LIVE["jwt"] = body["access_token"]
    return uid


def insert_habit(uid, description, status="watch", start=None, strike=None):
    start = start or (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
    strike = strike or datetime.now(timezone.utc).date().isoformat()
    payload = {
        "user_id": uid,
        "description": description,
        "status": status,
        "watch_started_at": start,
        "strike_at": strike,
        "watch_days": 7,
    }
    st, body = rest("POST", "/habits", payload)
    if st not in (200, 201) or not body:
        raise RuntimeError(f"habit insert failed: {st} {body}")
    return body[0]["id"]


def insert_doing(uid, kind, iso, source="app", window=None):
    payload = {
        "user_id": uid, "kind": kind, "source": source,
        "logged_at": iso, "content": "fp08 step7 drill",
    }
    if window:
        payload["checkin_window"] = window
    st, body = rest("POST", "/doings_logs", payload)
    if st not in (200, 201):
        raise RuntimeError(f"doing insert failed: {st} {body}")


def insert_fact(uid, fact):
    vector = "[" + ",".join(f"{math.sin(i * 0.1):.6f}" for i in range(768)) + "]"
    st, body = rest("POST", "/memory_facts", {
        "user_id": uid,
        "fact": fact,
        "fact_type": "chat",
        "embed_model": "gemini-embedding-001@768",
        "embedding": vector,
    })
    if st not in (200, 201):
        raise RuntimeError(f"fact insert failed: {st} {str(body)[:400]}")


def plant_evidence(uid):
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=7)
    for offset in (0, 1):
        day = start + timedelta(days=offset)
        iso = f"{day.isoformat()}T09:00:00Z"
        insert_doing(uid, "doing", iso, source="checkin_reply", window=iso)
    insert_doing(uid, "doing", f"{start + timedelta(days=2)}T12:00:00Z")
    insert_doing(uid, "impulse_failure", f"{start + timedelta(days=3)}T12:00:00Z")
    insert_doing(uid, "impulse_failure", f"{start + timedelta(days=4)}T12:00:00Z")


def call_strike(uid, habit, quote1=None, quote2=None):
    params = {"action": "drift-drill", "leg": "strike", "user": uid, "habit": habit}
    if quote1 is not None:
        params["stub_quote"] = quote1
    if quote2 is not None:
        params["stub_corrected_quote"] = quote2
    status, body = smoke(urllib.parse.urlencode(params))
    if status != 200:
        raise RuntimeError(f"drift-drill strike -> {status}: {body}")
    return (body or {}).get("outcome") or {}


def strike_rows(uid, habit):
    return rows(f"/messages?select=id,content,metadata,reply_to_message_id&user_id=eq.{uid}"
                f"&metadata->>source=eq.strike&metadata->>habit_id=eq.{habit}")


def habit_row(habit):
    return one(f"/habits?select=id,status,description,watch_started_at,strike_at&id=eq.{habit}")


def insert_job(uid, habit, quote, attempts=0):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    st, body = rest("POST", "/jobs", {
        "type": "strike_fire",
        "payload": {"user_id": uid, "habit_id": habit, "stub_quote": quote},
        "status": "pending",
        "attempts": attempts,
        "max_attempts": 5,
        "next_retry_at": past,
    })
    if st not in (200, 201) or not body:
        raise RuntimeError(f"job insert failed: {st} {body}")
    return body[0]["id"]


def job_row(job_id):
    return one(f"/jobs?select=id,status,attempts,next_retry_at,last_error&id=eq.{job_id}")


def dispatch():
    status, body = req("POST", "/functions/v1/job-dispatcher", {},
                       token=LIVE["service"], key=LIVE["service"])
    if status != 200:
        raise RuntimeError(f"job-dispatcher -> {status}: {body}")


def force_next(job_id):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    rest("PATCH", f"/jobs?id=eq.{job_id}", {"next_retry_at": past}, prefer="return=minimal")


def live_checks():
    print("== C. live: fixture ==")
    LIVE["stub"] = get_config("llm_stub_mode")
    LIVE["overrides"] = get_config("dev_overrides_enabled")
    if not LIVE["stub"]:
        set_config("llm_stub_mode", True)
    if not LIVE["overrides"]:
        set_config("dev_overrides_enabled", True)

    uid = create_fixture()
    plant_evidence(uid)
    insert_fact(uid, "Finish the 90-day program by 2026-12-01")
    print(f"  ..   user {uid}; watch {datetime.now(timezone.utc).date() - timedelta(days=7)}"
          f" -> {datetime.now(timezone.utc).date()}")

    clean = ("In 7 days you logged 3 doings and 2 hours, missed 5 check-in windows, "
             "and logged 2 impulse failures.")
    violating = "You gave me a 400-hour deadline. That is the line you drew."
    second_violation = "You promised a 500-hour deadline. That is the line you drew."

    print("== D. live: corrected output, context, struck ==")
    habit_a = insert_habit(uid, "Doomscroll before work")
    outcome = call_strike(uid, habit_a, violating, clean)
    check("the forcing leg runs the real handler", outcome.get("status") == "written",
          str(outcome)[:400])
    check("the first violation is corrected", outcome.get("claim_check") == "corrected",
          str(outcome)[:400])
    context = outcome.get("context") or ""
    check("the context carries the aggregates",
          all(token in context for token in (
              "<evidence>", "doings logged: 3", "hours accounted for: 2",
              "check-in windows missed: 5", "impulse failures logged: 2",
              "watch days: 7")), context[:1200])
    check("the context carries the habit inside its delimiter",
          "<habit>" in context and "Doomscroll before work" in context, context[:800])
    check("the context carries the verified goal",
          "<verified_goals>" in context and "Finish the 90-day program" in context,
          context[:1500])
    check("the verified mode is reported", outcome.get("mode") == "verified", str(outcome)[:300])
    row = (strike_rows(uid, habit_a) or [None])[0]
    check("exactly one strike row lands", bool(row), str(strike_rows(uid, habit_a))[:400])
    check("the corrected text is the delivered text",
          bool(row) and row["content"] == clean, str(row)[:400] if row else "no row")
    check("the corrected text drops the fabricated figure",
          bool(row) and "400" not in row["content"], str(row)[:300] if row else "no row")
    check("the row is unprompted and metadata-stamped",
          bool(row) and row["reply_to_message_id"] is None
          and row["metadata"].get("source") == "strike"
          and row["metadata"].get("habit_id") == habit_a
          and row["metadata"].get("claim_check") == "corrected", str(row)[:500] if row else "no row")
    check("the habit is struck", (habit_row(habit_a) or {}).get("status") == "struck",
          str(habit_row(habit_a)))
    again = call_strike(uid, habit_a, clean)
    check("a re-fire after the flip is the status no-op",
          again.get("status") == "skipped" and again.get("reason") == "status_struck",
          str(again)[:300])
    check("the status no-op writes no second row", len(strike_rows(uid, habit_a)) == 1)
    # Crash repair: the message landed but the flip did not. A re-claim must return duplicate
    # and repair the status, never write a second Strike.
    rest("PATCH", f"/habits?id=eq.{habit_a}", {"status": "watch"}, prefer="return=minimal")
    again = call_strike(uid, habit_a, clean)
    check("the crash-repair path returns duplicate", again.get("status") == "duplicate",
          str(again)[:300])
    check("the crash-repair path repairs the struck flip",
          (habit_row(habit_a) or {}).get("status") == "struck", str(habit_row(habit_a)))
    check("the crash-repair path writes no second row", len(strike_rows(uid, habit_a)) == 1)

    print("== E. live: the template fallback ==")
    habit_b = insert_habit(uid, "Skip the morning review")
    outcome = call_strike(uid, habit_b, violating, second_violation)
    check("the second violation falls to the template", outcome.get("claim_check") == "template",
          str(outcome)[:400])
    template_row = (strike_rows(uid, habit_b) or [None])[0]
    content = (template_row or {}).get("content", "")
    check("the template is the deterministic evidence text",
          content.startswith("Here is the record, not an opinion."), content[:300])
    check("the template carries only licensed figures",
          "3 doings logged" in content and "2 hours accounted for" in content
          and "5 check-in windows missed" in content and "2 impulse failures logged" in content,
          content[:400])
    check("the template drops both fabricated figures",
          "400" not in content and "500" not in content, content[:300])
    check("the template habit is struck", (habit_row(habit_b) or {}).get("status") == "struck")

    print("== F. live: the real dispatcher snooze + re-fire ==")
    habit_c = insert_habit(uid, "Phone in bed after midnight")
    st, body = rest("POST", "/journal_entries", {
        "user_id": uid,
        "content": "fp08 step7 drill",
        "entry_date": datetime.now(timezone.utc).date().isoformat(),
        "severity": "S2",
    })
    if st not in (200, 201):
        raise RuntimeError(f"journal insert failed: {st} {body}")
    journal_id = body[0]["id"]
    job_id = insert_job(uid, habit_c, clean)
    dispatch()
    job = job_row(job_id) or {}
    check("the S1/S2 deferral leaves the job pending", job.get("status") == "pending", str(job))
    check("the deferral decrements attempts back to zero", job.get("attempts") == 0, str(job))
    try:
        retry = datetime.fromisoformat(str(job.get("next_retry_at")).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        retry = None
    target = datetime.now(timezone.utc) + timedelta(hours=24)
    check("next_retry_at is pushed 24 h",
          retry is not None and abs((retry - target).total_seconds()) < 300,
          f"{job.get('next_retry_at')} vs {target.isoformat()}")
    check("the habit is still on watch", (habit_row(habit_c) or {}).get("status") == "watch")
    check("no strike row is written during the snooze", len(strike_rows(uid, habit_c)) == 0)

    old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat().replace("+00:00", "Z")
    rest("PATCH", f"/journal_entries?id=eq.{journal_id}", {"created_at": old},
         prefer="return=minimal")
    force_next(job_id)
    dispatch()
    job = job_row(job_id) or {}
    check("the re-fire completes after the window passes", job.get("status") == "done", str(job))
    check("the re-fire strikes", (habit_row(habit_c) or {}).get("status") == "struck",
          str(habit_row(habit_c)))
    refire_rows = strike_rows(uid, habit_c)
    check("the re-fire writes exactly one row",
          len(refire_rows) == 1 and refire_rows[0]["content"] == clean,
          str(refire_rows)[:400])

    print("== G. live: the cancellation no-op ==")
    habit_d = insert_habit(uid, "Late-night spending", status="quit_committed")
    job_d = insert_job(uid, habit_d, clean)
    dispatch()
    job = job_row(job_d) or {}
    check("a quit_committed habit completes the job", job.get("status") == "done", str(job))
    check("the cancellation writes no strike row", len(strike_rows(uid, habit_d)) == 0)
    check("the cancelled habit keeps its status",
          (habit_row(habit_d) or {}).get("status") == "quit_committed",
          str(habit_row(habit_d)))

    print("== H. live: the dev-gated oath request leg ==")
    st, body = rest("POST", "/messages", {
        "user_id": uid, "role": "user", "content": "I swear I will finish the draft by Friday.",
    })
    if st not in (200, 201) or not body:
        raise RuntimeError(f"source message insert failed: {st} {body}")
    source = body[0]["id"]
    st, body = smoke(urllib.parse.urlencode({
        "action": "drift-drill", "leg": "oath", "user": uid, "source_message_id": source,
    }))
    outcome = (body or {}).get("outcome") or {}
    check("the oath leg forces the request branch",
          st == 200 and outcome.get("status") == "written", str(body)[:400])
    oath_rows = rows(f"/messages?select=id,metadata&user_id=eq.{uid}"
                     f"&metadata->>source=eq.oath_request&metadata->>source_message_id=eq.{source}")
    check("the oath request row is stamped", len(oath_rows) == 1, str(oath_rows)[:300])


def cleanup(verbose=False):
    if not LIVE.get("url"):
        return
    if LIVE.get("stub") is not None:
        set_config("llm_stub_mode", LIVE["stub"])
    if LIVE.get("overrides") is not None:
        set_config("dev_overrides_enabled", LIVE["overrides"])

    for uid in list(LIVE.get("users") or []):
        rest("DELETE", f"/jobs?payload->>user_id=eq.{uid}", prefer="return=minimal")
        req("DELETE", f"/auth/v1/admin/users/{uid}", token=LIVE["service"], key=LIVE["service"])

    if verbose:
        leftovers = []
        for uid in LIVE.get("users") or []:
            if one(f"/profiles?select=id&id=eq.{uid}"):
                leftovers.append(uid)
        check("cleanup removes every fixture user", not leftovers, str(leftovers))
        check("cleanup restores llm_stub_mode", get_config("llm_stub_mode") == LIVE["stub"])
        check("cleanup restores dev_overrides_enabled",
              get_config("dev_overrides_enabled") == LIVE["overrides"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/earlier gates")
    args = ap.parse_args()

    print("== FP-08 Step 7: the Strike ==")
    static_checks()
    if not args.no_toolchain:
        toolchain_checks()

    if not args.static_only:
        print("== C. live == ")
        live_setup()
        try:
            live_checks()
        finally:
            cleanup(verbose=True)

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + "; ".join(FAILS))
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
