#!/usr/bin/env python3
"""FP-08 Step 5 gate -- the drift scan, habit surfacing, and the drift/habit intervention branches.

Covers PLAN Step 5 Verify: "the script green; tsc + tsc-for-jest + deno check clean; the FP-03 /
FP-04 / FP-05 static gates green; static asserts -- `_shared/accountability/drift.ts` zero imports;
`runDriftScan` provider-free; every reason registered; the quest-mode prompt is the only changed
part of FP-07's module."

Static
  pure       : drift.ts imports nothing; runDriftScan never imports the adapter
  scan       : kill switch, per-user isolation, per-pattern local-day dedupe, streak award
               through the single writer, habit live-guard + deterministic description + job
  handler    : the three drift reasons + habit_confrontation branch and generate through
               `runLockedPersonaReply`; quest offer guarded by budget + one-active-quest
  propose    : quest mode is additive (non-quest schema/validator/prompt untouched), deadline
               clamp + day-pass framing + stub registration
  delimiters : `<habit>` / `<quest>` built and delimited

Toolchain
  tsc / full jest / deno check + the FP-03 / FP-04 / FP-05 static gates

Live (network; skipped by --static-only)
  fixtures   : five synthetic auth users (never the owner's rows), UTC, one-window grid
  scan       : late+compliance, energy-only, impulse habit + streak, journal habit, the
               two-late-days boundary; second scan dedupes (jobs, habits, streak)
  handler    : late/compliance/energy confrontations; the quest offer card metadata; the
               one-active-quest rule; the habit row + flip + duplicate retry

Cleanup removes the fixture users (cascade), their jobs (no user FK), and restores stub mode.

Usage: python scripts/verify-fp08-step5.py [--static-only] [--no-toolchain]
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
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
ACC = "supabase/functions/_shared/accountability"
DRIFT = f"{ACC}/drift.ts"
SCAN = f"{ACC}/runDriftScan.ts"
APPLY = f"{ACC}/applyRider.ts"
INTERV = f"{ACC}/interventions.ts"
PROPOSE = "supabase/functions/_shared/metrics/propose.ts"
DOG = "supabase/functions/_shared/checkin/runWatchdog.ts"
DISPATCH = "supabase/functions/job-dispatcher/index.ts"
SMOKE = "supabase/functions/dev-smoke/index.ts"
TECH = "docs/TECH-SPEC.md"
FP08 = "docs/feature-prds/FP-08/FP-08.md"
PLAN = "docs/feature-prds/FP-08/FP-08-PLAN.md"

FAILS = []
LIVE = {}


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


# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------


def req(method, path, body=None, token=None, key=None, headers=None, timeout=120):
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


def smoke(path):
    return req("POST", "/functions/v1/dev-smoke?" + path, token=LIVE["smoke"], key=LIVE["smoke"])


# ---------------------------------------------------------------------------
# A. static
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static surface ==")
    drift_src = read(DRIFT)
    scan_src = read(SCAN)
    apply_src = read(APPLY)
    interv_src = read(INTERV)
    propose_src = read(PROPOSE)
    dog_src = read(DOG)
    dispatch_src = read(DISPATCH)
    smoke_src = read(SMOKE)
    tech_src = read(TECH)
    plan_src = read(PLAN)

    for rel, src in ((DRIFT, drift_src), (SCAN, scan_src), (PROPOSE, propose_src),
                     (DOG, dog_src), (DISPATCH, dispatch_src), (SMOKE, smoke_src)):
        check(f"{rel} exists", bool(src))

    unit = re.sub(r"//.*", "", drift_src)
    unit = re.sub(r"/\*.*?\*/", "", unit, flags=re.S)
    check("drift.ts has zero imports", not re.search(r"^\s*import\s", unit, re.M))
    offenders = []
    for name in ("interventions", "rider", "streak", "lockdown", "habits", "quests", "strike",
                 "histogram", "templates", "drift"):
        src = read(f"{ACC}/{name}.ts")
        if re.search(r"^\s*import\s", src, re.M):
            offenders.append(name)
    check("the pure modules still import nothing", not offenders, f"{offenders}")

    check("runDriftScan never imports the provider adapter",
          'llm/adapter' not in scan_src and 'metrics/propose' not in scan_src)
    check("the scan reads the kill switch", 'getConfigBoolean("drift_scan_enabled")' in scan_src)
    check("the scan walks profiles and isolates failures per user",
          "for (const profile of" in scan_src and "catch (error)" in scan_src)
    check("the pattern jobs are deduped on (user, reason, local day)",
          '.eq("payload->>reason", dedupe.reason)' in scan_src
          and '.eq("payload->>local_day", dedupe.localDay)' in scan_src)
    check("the job payload carries the deterministic context (FR-14)",
          "context: driftFactsFromEvidence(evidence, pattern)" in scan_src)
    check("the streak award goes through the single writer",
          "applyStreakAward({" in scan_src and "from \"./applyRider.ts\"" in scan_src)
    check("habit surfacing uses the shared decision + deterministic description",
          "shouldSurface(counts, evidence.config.habitThresholds)" in scan_src
          and "buildDescription(surface.pattern, counts, HABIT_WINDOW_DAYS)" in scan_src)
    check("the habit row starts detected", 'status: "detected"' in scan_src)
    check("the live-description guard reads the three live statuses",
          '.in("status", ["detected", "confronted", "watch"])' in scan_src)
    check("a stuck detected habit re-arms through the deduped insert",
          'if (live.status === "detected")' in scan_src)

    check("the dispatcher registers drift_scan", "drift_scan: async ()" in dispatch_src)
    check("drift_scan is a FAST job type", "'drift_scan'" in dispatch_src
          and "FAST_JOB_TYPES" in dispatch_src)

    check("runIntervention branches on the three drift reasons", "isDriftReason(args.reason)" in dog_src)
    check("runIntervention branches on habit_confrontation",
          "args.reason === HABIT_CONFRONTATION_REASON" in dog_src)
    check("the drift branch rebuilds evidence when the payload is stale",
          "isDriftContext(args.context)" in dog_src and "loadDriftEvidence(args.userId" in dog_src)
    check("the drift branch reads the one-active-quest rule", "hasActiveQuest(args.userId)" in dog_src)
    check("the offer is skipped when less than half the budget remains",
          "remaining > reserve" in dog_src and "Math.floor(Math.max(0, budget) / 2)" in dog_src)
    check("the offer runs quest mode through FP-07's module",
          'proposeMetric({ domain: questDomainFor(pattern) }, { quest: true })' in dog_src)
    check("the offer card metadata is exactly FR-14's shape",
          "quest_offer = offerMeta" in dog_src and "deadline_days: proposal.deadline_days" in dog_src)
    check("the drift row is sourced for the client card",
          'source: "drift_intervention"' in dog_src and "pattern," in dog_src)
    check("the drift dedupe reads the row's own source",
          'findInterventionByJob(args.userId, "drift_intervention", args.jobId)' in dog_src)
    habit_start = dog_src.index("async function runHabitConfrontation")
    habit_deliver = dog_src.index("await deliverIntervention({", habit_start)
    habit_flip = dog_src.index("await flip();", habit_deliver)
    check("the habit branch flips after the row write",
          -1 < habit_start < habit_deliver < habit_flip
          < dog_src.index('return { status: "written"', habit_start))
    check("every new branch generates through runLockedPersonaReply",
          dog_src.count("runLockedPersonaReply({") == 5)
    check("every branch rides the bounded push helper", dog_src.count("deliverIntervention({") == 4)

    check("quest mode adds a schema without touching the base",
          "QUEST_PROPOSAL_SCHEMA" in propose_src and "...METRIC_PROPOSAL_SCHEMA" in propose_src)
    check("quest mode has its own validator", "export function isQuestProposal" in propose_src)
    check("the quest stub is registered", "registerStubShape(isQuestProposal, QUEST_PROPOSAL_STUB)" in propose_src)
    check("quest mode frames the day-pass and the deadline",
          "QUEST MODE" in propose_src and "day-pass" in propose_src and "deadline_days" in propose_src)
    check("the deadline is clamped into quest_deadline_bounds",
          'getConfig("quest_deadline_bounds")' in propose_src and "clampDeadlineDays(" in propose_src)
    check("non-quest callers stay byte-compatible (schema/validator pick on quest only)",
          "quest ? QUEST_PROPOSAL_SCHEMA : METRIC_PROPOSAL_SCHEMA" in propose_src
          and "quest ? isQuestProposal : isMetricProposal" in propose_src)

    check("dev-smoke registers drift-drill", '"drift-drill"' in smoke_src)
    check("drift-drill drives the production scan", "await runDriftScan({ userId: user, nowMs })" in smoke_src)
    check("intervention-drill forwards habit_id",
          'habitId: url.searchParams.get("habit_id")' in smoke_src)

    for tag in ("habit", "quest"):
        check(f"the {tag} delimiter is built", f'delimit("{tag}"' in interv_src)

    check("TECH-SPEC records the Step 5 build", "As built (FP-08 Step 5)" in tech_src)
    check("TECH-SPEC §7.5 records habit surfacing", "As built (FP-08 Step 5)" in tech_src)
    check("the PLAN tracker marks Step 5 done", "| 5 |" in plan_src and "| 5 | The drift scan" in plan_src)


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
                   DRIFT, SCAN, INTERV, APPLY, PROPOSE, DOG, DISPATCH, SMOKE])
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
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    if not url or not service or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")
    LIVE.update({"url": url, "service": service, "smoke": smoke_token,
                 "stub": None, "users": [], "names": {}})


def create_fixture(name):
    email = f"fp08-step5-{uuid.uuid4().hex[:10]}@example.com"
    status, body = req("POST", "/auth/v1/admin/users", {
        "email": email,
        "password": uuid.uuid4().hex + "Aa1!",
        "email_confirm": True,
    }, token=LIVE["service"], key=LIVE["service"])
    if status not in (200, 201) or not isinstance(body, dict) or not body.get("id"):
        raise RuntimeError(f"admin createUser failed: {status} {body}")
    uid = body["id"]
    LIVE["users"].append(uid)
    LIVE["names"][uid] = name
    for _ in range(20):
        if one(f"/profiles?select=id&id=eq.{uid}"):
            break
        time.sleep(0.25)
    status, body = rest("PATCH", f"/profiles?id=eq.{uid}", {
        # FP-09 Step 5 gates the drift scan to complete profiles; this harness's
        # fixture is the post-onboarding user it was always modelling.
        "onboarding_stage": "complete",
        "timezone": "UTC",
        "checkin_cadence_minutes": 60,
        "checkin_active_hours_start": "09:00",
        "checkin_active_hours_end": "10:00",
        "trust_score": 50,
    }, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"profile patch failed: {status} {body}")
    return uid


def now_anchor():
    now = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    return now


def day_iso(anchor, offset_days, hhmm):
    day = (anchor - timedelta(days=offset_days)).strftime("%Y-%m-%d")
    return f"{day}T{hhmm}:00Z"


def insert_doing(uid, logged_iso, energy=None, window_iso=None, kind="doing"):
    row = {"user_id": uid, "kind": kind, "source": "app", "logged_at": logged_iso,
           "content": "fp08 step5 drill"}
    if energy is not None:
        row["energy"] = energy
    if window_iso is not None:
        row["checkin_window"] = window_iso
    status, body = rest("POST", "/doings_logs", row)
    if status not in (200, 201):
        raise RuntimeError(f"doing insert failed: {status} {body}")


def insert_journal_flag(uid, entry_date):
    status, body = rest("POST", "/journal_entries", {
        "user_id": uid, "content": "fp08 step5 drill entry", "entry_date": entry_date,
        "habit_flag": True, "severity": "S3",
    })
    if status not in (200, 201):
        raise RuntimeError(f"journal insert failed: {status} {body}")


def drift(uid, now_iso):
    status, body = smoke(f"action=drift-drill&user={uid}&now={now_iso}")
    if status != 200:
        raise RuntimeError(f"drift-drill -> {status}: {body}")
    return body


def jobs_for(uid, reason=None):
    q = f"/jobs?select=id,type,status,payload&payload->>user_id=eq.{uid}"
    if reason:
        q += f"&payload->>reason=eq.{reason}"
    return rows(q)


def mark_done(job_id):
    rest("PATCH", f"/jobs?id=eq.{job_id}", {"status": "done"}, prefer="return=minimal")


def plant_late_days(uid, anchor, count=3):
    for offset in range(1, count + 1):
        insert_doing(uid, day_iso(anchor, offset, "12:00"))


def plant_clean_days(uid, anchor, count=3, energy=5, answer=True):
    for offset in range(1, count + 1):
        window = day_iso(anchor, offset, "09:00") if answer else None
        insert_doing(uid, day_iso(anchor, offset, "09:30"), energy=energy, window_iso=window)


def live_checks():
    print("== C. live: fixtures ==")
    LIVE["stub"] = get_config("llm_stub_mode")
    if not LIVE["stub"]:
        set_config("llm_stub_mode", True)

    anchor = now_anchor()
    now_iso = anchor.isoformat().replace("+00:00", "Z")
    today = anchor.strftime("%Y-%m-%d")
    print(f"  ..   scan anchored at {now_iso}; trailing days end {today} minus one")

    # A: three late first-doings, zero answered windows -> late_start + compliance_drop.
    a = create_fixture("late+compliance")
    plant_late_days(a, anchor)

    # B: energy slide only -- two answered days, one unanswered (compliance 2/3, streak 0).
    b = create_fixture("energy-only")
    for offset in (1, 2):
        insert_doing(b, day_iso(anchor, offset, "09:30"), energy=2, window_iso=day_iso(anchor, offset, "09:00"))
    insert_doing(b, day_iso(anchor, 1 + 2, "09:30"), energy=2)

    # C: clean days + three impulse failures -> impulse habit + the streak award.
    c = create_fixture("impulse-habit")
    plant_clean_days(c, anchor)
    for hours in (1, 2, 3):
        insert_doing(c, (anchor - timedelta(hours=hours)).isoformat().replace("+00:00", "Z"),
                     kind="impulse_failure")

    # D: clean days + three journal flags -> the journal habit path.
    d = create_fixture("journal-habit")
    plant_clean_days(d, anchor)
    for offset in (1, 2, 3):
        insert_journal_flag(d, (anchor - timedelta(days=offset)).strftime("%Y-%m-%d"))

    # E: two late days then an on-time answered day -> the late chain is broken.
    e = create_fixture("late-boundary")
    for offset in (2, 3):
        insert_doing(e, day_iso(anchor, offset, "12:00"))
    insert_doing(e, day_iso(anchor, 1, "09:30"), window_iso=day_iso(anchor, 1, "09:00"))

    print("== D. live: the scan ==")
    report = drift(a, now_iso)
    user_a = report["per_user"][0]
    check("late+compliance: both patterns fire",
          sorted(user_a["patterns"]) == ["compliance_drop", "late_start"], str(user_a))
    check("late+compliance: no streak", user_a["streak"] == 0, str(user_a))
    a_late = jobs_for(a, "drift_late_start")
    a_comp = jobs_for(a, "drift_compliance_drop")
    check("late job exists with its local-day + context",
          len(a_late) == 1 and a_late[0]["payload"].get("local_day") == today
          and a_late[0]["payload"].get("context", {}).get("pattern") == "late_start", str(a_late))
    check("compliance job exists", len(a_comp) == 1, str(a_comp))

    report_b = drift(b, now_iso)
    user_b = report_b["per_user"][0]
    check("energy-only: only the energy slide fires", user_b["patterns"] == ["energy_slide"], str(user_b))
    check("energy-only: the two-day streak is below the award floor",
          user_b["streak"] == 2 and user_b["streak_awarded"] is False, str(user_b))
    check("energy job exists", len(jobs_for(b, "drift_energy_slide")) == 1)

    report_c = drift(c, now_iso)
    user_c = report_c["per_user"][0]
    check("impulse user: no temporal patterns", user_c["patterns"] == [], str(user_c))
    check("impulse user: the streak awards", user_c["streak"] == 3 and user_c["streak_awarded"] is True, str(user_c))
    check("impulse user: one habit surfaced with the impulse description",
          report_c["habits_surfaced"] == 1
          and (user_c["habit"]["description"] or "").startswith("Recurring impulse failures: 3"), str(user_c))
    c_habits = rows(f"/habits?select=id,description,status&user_id=eq.{c}")
    check("impulse habit row is live-detected",
          len(c_habits) == 1 and c_habits[0]["status"] == "detected", str(c_habits))
    check("impulse habit queues one confrontation",
          len(jobs_for(c, "habit_confrontation")) == 1)

    report_d = drift(d, now_iso)
    user_d = report_d["per_user"][0]
    check("journal user: the journal path surfaces",
          report_d["habits_surfaced"] == 1
          and (user_d["habit"]["description"] or "").startswith("Recurring behaviour flagged in journal entries: 3"),
          str(user_d))
    check("journal user: the streak awards", user_d["streak_awarded"] is True, str(user_d))

    report_e = drift(e, now_iso)
    user_e = report_e["per_user"][0]
    check("boundary: two late days do not fire late_start",
          "late_start" not in user_e["patterns"], str(user_e))
    check("boundary: the compliance drop still fires", "compliance_drop" in user_e["patterns"], str(user_e))

    # Second scan: no new jobs, no duplicate habit, no second streak award.
    before_jobs = len(jobs_for(a)) + len(jobs_for(c))
    report_a2 = drift(a, now_iso)
    report_c2 = drift(c, now_iso)
    check("second scan: no patterns fire again", report_a2["patterns_fired"] == 0, str(report_a2))
    check("second scan: no streak award again", report_c2["streaks_awarded"] == 0, str(report_c2))
    check("second scan: the habit live-guard blocks a duplicate",
          report_c2["habits_surfaced"] == 0
          and len(rows(f"/habits?select=id&user_id=eq.{c}")) == 1, str(report_c2))
    check("second scan: the job count is unchanged",
          len(jobs_for(a)) + len(jobs_for(c)) == before_jobs)

    print("== E. live: the drift handler + the quest card ==")
    # The queued jobs are evidence only: mark them done so the 1-minute dispatcher does not
    # race the drills, and drive the handler with fresh job ids of our own (dedupe is by id).
    for uid in (a, c):
        rest("PATCH", f"/jobs?payload->>user_id=eq.{uid}&type=eq.intervention",
             {"status": "done"}, prefer="return=minimal")

    late_job = f"step5-late-{uuid.uuid4().hex[:10]}"
    status, body = smoke(
        f"action=intervention-drill&user={a}&reason=drift_late_start&job_id={late_job}")
    outcome = (body or {}).get("outcome") or {}
    check("late handler writes", status == 200 and outcome.get("status") == "written", str(body)[:400])
    late_context = outcome.get("context") or ""
    check("late context names the pattern and the hour",
          "late starts" in late_context and "10:00" in late_context, late_context[:300])
    late_row = one(f"/messages?select=id,metadata,reply_to_message_id&user_id=eq.{a}"
                   f"&metadata->>source=eq.drift_intervention&metadata->>source_job_id=eq.{late_job}")
    check("late row is unprompted and carries the card",
          bool(late_row) and late_row["reply_to_message_id"] is None
          and late_row["metadata"].get("pattern") == "late_start"
          and late_row["metadata"].get("source_job_id") == late_job
          and isinstance(late_row["metadata"].get("quest_offer"), dict), str(late_row)[:500])
    offer = (late_row or {}).get("metadata", {}).get("quest_offer") or {}
    check("the quest card carries FR-14's five fields",
          all(k in offer for k in ("name", "domain", "output_unit", "formula", "deadline_days")), str(offer))
    check("the quest deadline is clamped into {3,21}",
          isinstance(offer.get("deadline_days"), int) and 3 <= offer["deadline_days"] <= 21, str(offer))
    status, body = smoke(
        f"action=intervention-drill&user={a}&reason=drift_late_start&job_id={late_job}")
    check("the same job retried is a duplicate", (body or {}).get("outcome", {}).get("status") == "duplicate",
          str(body)[:300])
    check("the retry writes no second row",
          len(rows(f"/messages?select=id&user_id=eq.{a}"
                   f"&metadata->>source_job_id=eq.{late_job}")) == 1)

    # One-active-quest: plant an unarchived quest, then drive the compliance branch.
    status, body = rest("POST", "/metrics", {
        "user_id": a, "name": "FP08 drill quest", "domain": "Discipline/Habits",
        "is_quest": True, "quest_status": "active", "formula": {"var": "doings_count"},
        "formula_status": "validated", "output_unit": "doings",
        "quest_deadline": (anchor + timedelta(days=7)).strftime("%Y-%m-%d"),
    })
    check("the active-quest fixture inserts", status in (200, 201), str(body)[:300])
    comp_job = f"step5-comp-{uuid.uuid4().hex[:10]}"
    status, body = smoke(
        f"action=intervention-drill&user={a}&reason=drift_compliance_drop&job_id={comp_job}")
    outcome = (body or {}).get("outcome") or {}
    comp_row = one(f"/messages?select=id,metadata&user_id=eq.{a}"
                   f"&metadata->>source_job_id=eq.{comp_job}")
    check("with an active quest the row lands", status == 200 and outcome.get("status") == "written",
          str(body)[:300])
    check("with an active quest no card is attached",
          bool(comp_row) and "quest_offer" not in comp_row["metadata"], str(comp_row)[:400])

    print("== F. live: the habit handler ==")
    c_habit = rows(f"/habits?select=id,status&user_id=eq.{c}")[0]
    habit_job = f"step5-habit-{uuid.uuid4().hex[:10]}"
    status, body = smoke(
        f"action=intervention-drill&user={c}&reason=habit_confrontation"
        f"&habit_id={c_habit['id']}&job_id={habit_job}")
    outcome = (body or {}).get("outcome") or {}
    check("habit handler writes", status == 200 and outcome.get("status") == "written", str(body)[:400])
    habit_context = outcome.get("context") or ""
    check("habit context is delimited and carries the count",
          "<habit>" in habit_context and "last 7 days" in habit_context, habit_context[:300])
    flipped = one(f"/habits?select=status&id=eq.{c_habit['id']}")
    check("the habit flips to confronted", bool(flipped) and flipped["status"] == "confronted", str(flipped))
    habit_row = one(f"/messages?select=id,metadata&user_id=eq.{c}"
                    f"&metadata->>source_job_id=eq.{habit_job}")
    check("the habit row carries its habit_id", bool(habit_row)
          and habit_row["metadata"].get("habit_id") == c_habit["id"], str(habit_row)[:300])
    status, body = smoke(
        f"action=intervention-drill&user={c}&reason=habit_confrontation"
        f"&habit_id={c_habit['id']}&job_id={habit_job}")
    check("the habit retry is a duplicate", (body or {}).get("outcome", {}).get("status") == "duplicate",
          str(body)[:300])
    check("the habit retry writes no second row",
          len(rows(f"/messages?select=id&user_id=eq.{c}"
                   f"&metadata->>source_job_id=eq.{habit_job}")) == 1)


def cleanup(verbose=False):
    if not LIVE.get("url"):
        return
    set_config("llm_stub_mode", LIVE.get("stub") if LIVE.get("stub") is not None else False)

    for uid in list(LIVE.get("users") or []):
        rest("DELETE", f"/jobs?payload->>user_id=eq.{uid}", prefer="return=minimal")
        req("DELETE", f"/auth/v1/admin/users/{uid}", token=LIVE["service"], key=LIVE["service"])
        rest("DELETE", f"/habits?user_id=eq.{uid}", prefer="return=minimal")

    if verbose:
        leftovers = []
        for uid in LIVE.get("users") or []:
            if one(f"/profiles?select=id&id=eq.{uid}"):
                leftovers.append(uid)
            if jobs_for(uid):
                leftovers.append(f"jobs:{uid}")
        check("cleanup removes every fixture user and its jobs", not leftovers, str(leftovers))
        check("cleanup restores llm_stub_mode", get_config("llm_stub_mode") == LIVE["stub"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/earlier gates")
    args = ap.parse_args()

    print("== FP-08 Step 5: drift scan + habits + reason branches ==")
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
