#!/usr/bin/env python3
"""Automate FP-04 Step 6 verification (the watchdog schedule + the two dispatcher handlers).

PLAN Step 6 Verify: "with a synthetic unanswered window (backdated `now`): scan -> `intervention`
job inserted; dispatcher claim -> exactly one unprompted assistant row + one high-push log;
re-scan -> no second job (dedup); an answered window and an overnight window -> no alert;
`FAST_JOB_TYPES` contains `watchdog_checkin` and not `intervention` (static assert); section 2.3
and GLOSSARY section 12 still list 15 types (static assert -- zero new job types); the twin-grid
vectors from Step 4 reproduce on the server (fixture assert); `tsc` + `deno check` + `jest` clean."

  AUTOMATED -- static (no network):
    files       : `_shared/checkin/watchdog.ts` + `runWatchdog.ts` + `watchdog.test.ts` +
                  `migrations/0027_watchdog_cron_fp04.sql` exist
    purity      : `watchdog.ts` imports **only** `./windows.ts` -- no config, no service client, no
                  `Deno.env`, no clock read (`nowMs` is a parameter), so jest can load it
    twin rules  : the scan reuses `windowsClosedBetween` / `windowsForLocalDay` from the Step 2
                  server grid -- no second grid, no second twin (NFR-7) -- and the Step 2 suite
                  still consumes the ONE shared `windows.fixture.ts` (the fixture assert)
    registry    : the dispatcher registers exactly the thirteen implemented handlers
                  (FP-05/06/07 additions plus FP-08's `drift_scan`, `quest_expire` and
                  `strike_fire`); `watchdog_checkin` is in `FAST_JOB_TYPES`, `intervention`
                  is deliberately not; TECH-SPEC section 2.3 and GLOSSARY section 12 still
                  list 15 types
    handlers    : the intervention reads `config.intervention_persona` (no hardcoded
                  `mentor_tough`), uses the exported D7 fallback domain, imports the pipeline
                  **lazily**, honours `unsavable`, writes `reply_to_message_id` NULL + the four
                  metadata keys, keeps `tactical_analysis` out of the row, and pushes bounded +
                  high-priority
    cron        : migration 0027 schedules `watchdog-checkin` at `*/5 * * * *` with the guarded
                  insert, seeds `intervention_persona`, and does not re-seed
                  `watchdog_grace_minutes` (0001 owns it)
    drill       : `dev-smoke ?action=watchdog-scan` drives the *production* scan (`&now=`/
                  `&user=`)
    docs        : TECH-SPEC sections 2.3 / 7.1 / 11 and GLOSSARY sections 12 / 13 / 15 / 16
    tools       : `deno check` (this tree) + `tsc --noEmit` (the app tree) + jest

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE + DEV_SMOKE_TOKEN + a user JWT, migration
  0027 applied, and `job-dispatcher`/`dev-smoke` redeployed at current code):
    precond.  : the five config keys exist; `dev-smoke` answers the action; a usable JWT
    answered  : a fabricated doing on the drill window -> the scan reports **0** alerts (the
                live `checkin_window` join, not just the unit test)
    missed    : delete it -> the scan reports **exactly one** alert, for that window
    dedup     : a second scan -> **0** alerts (the window already has an intervention job)
    dispatch  : one dispatcher tick -> exactly one unprompted assistant row for the window
                (`reply_to_message_id` NULL, `metadata.source='watchdog_intervention'`,
                `watchdog_window`, `source_job_id`, `persona` = the config reading, no
                `tactical_analysis`, no `trust_score`)
    re-claim  : reset the job to `pending` and tick again -> still exactly one row (FR-16)
    cleanup   : the probe row/job are deleted and the config + prefs restored in a `finally`

  REPLAYABLE -- log leg (`--logs <file>`): the Dashboard export is the only source for the push
  line (`sendPush` is silent on success), so this leg counts **this run's** intervention render:
  exactly one `[intervention] tactical_analysis (job <id>)` + exactly one `[intervention] wrote`
  for the manifest's job id, with the `[push]` line between them. The live section saves a small
  manifest so the leg can be replayed later with `--static-only --logs <file>` (no second live
  run, no provider calls).

The drill backdates its clock (`&now=`) to a window ~60 days old, which is what makes it free of
side effects: that window is certainly unanswered and certainly not queued, and the run pins
`llm_stub_mode=true` (deterministic, no provider call) and `expo_push_enabled=false` (a log line,
never a real device push) for the duration. It never nudges another user -- the cron path scans
every profile; the drill narrows with `&user=`.

Flags: `--static-only`, `--run-jest`, `--no-deno`, `--no-tsc`, `--no-mint`, `--email <addr>`,
`--keep` (leave the probe rows for inspection), `--logs <file>`.

PREREQUISITES: migration 0027 applied (`supabase db push`) and
`supabase functions deploy job-dispatcher dev-smoke`.
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    # Sibling helper module (scripts/ is sys.path[0] for `python scripts/verify-fp04-step6.py`).
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001 -- the gate still runs; token resolution then falls back
    resolve_gate_token = None

FAILURES = []

WATCHDOG_TS = "supabase/functions/_shared/checkin/watchdog.ts"
RUN_WATCHDOG_TS = "supabase/functions/_shared/checkin/runWatchdog.ts"
WATCHDOG_TEST_TS = "supabase/functions/_shared/checkin/watchdog.test.ts"
WINDOWS_TS = "supabase/functions/_shared/checkin/windows.ts"
WINDOWS_TEST_TS = "supabase/functions/_shared/checkin/windows.test.ts"
FIXTURE_TS = "supabase/functions/_shared/checkin/windows.fixture.ts"
LOAD_GRID_TS = "supabase/functions/_shared/checkin/loadGrid.ts"
CONFIG_TS = "supabase/functions/_shared/config.ts"
PERSONA_TS = "supabase/functions/_shared/pipeline/persona.ts"
DISPATCH_TS = "supabase/functions/job-dispatcher/index.ts"
SMOKE_TS = "supabase/functions/dev-smoke/index.ts"
MIGRATION = "supabase/migrations/0027_watchdog_cron_fp04.sql"
TECH = "docs/TECH-SPEC.md"
GLOSS = "docs/GLOSSARY.md"

SMOKE_URL = "/functions/v1/dev-smoke"
DISPATCH_URL = "/functions/v1/job-dispatcher"
PROBE = "FP04S6-PROBE"

# The grid the gate pins for the live run, so the expected window can be computed in Python.
# 08:00-22:00 cadence 60 in UTC: starts 08:00..21:00, closes 09:00..22:00.
GRID_CADENCE_MIN = 60
GRID_START_MIN = 8 * 60
GRID_END_MIN = 22 * 60

# The scan bounds the live config carries: grace 10, lookback 120 (TECH-SPEC section 11).
GRACE_MIN = 10
LOOKBACK_MIN = 120

# The drill's window sits this far in the past -- certainly unanswered, certainly not queued, and
# nowhere near a check-in the beta user might still be looking at.
BACKDATE_DAYS = 60

# Pinned for the drill's duration, then restored.
SNAPSHOT_KEYS = ("llm_stub_mode", "expo_push_enabled")

# The keys the scan and the intervention read, in the order the handler checks them.
REQUIRED_CONFIG = (
    "watchdog_grace_minutes",
    "watchdog_lookback_minutes",
    "intervention_persona",
    "sliding_window_messages",
    "pipeline_deadline_ms",
)

EXPECTED_HANDLERS = {"smoke_test", "llm_retry", "watchdog_checkin", "intervention",
                     "journal_extract", "journal_probe", "anchor_plan", "purge_memory",
                     "memory_extract", "metric_eval", "drift_scan", "quest_expire",
                     "strike_fire", "histogram_daily"}
EXPECTED_JOB_TYPES = 15

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

URL = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
SMOKE_TOKEN = os.environ.get("DEV_SMOKE_TOKEN")
JWT = os.environ.get("DAVOS_USER_JWT")
EMAIL = os.environ.get("DAVOS_USER_EMAIL")

USER_JWT = None
RUN_MANIFEST = {}
NO_MINT = False
KEEP = False


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def info(label, value):
    print(f"  ..   {label}: {value}")


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def table_rows(md, start_marker, end_marker):
    """The identifier cells of the `| \\`type\\` | ...` rows between two markers."""
    seg = md.split(start_marker, 1)[-1].split(end_marker, 1)[0]
    return set(re.findall(r"^\|\s*`([a-z_]+)`\s*\|", seg, re.M))


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def deno_check(rels):
    """`deno check` a set of entry points. Returns (ok, output)."""
    try:
        if shutil.which("deno") is None:
            return None, "deno not on PATH"
        p = subprocess.run(
            ["deno", "check"] + rels,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=900,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def npx_check(cmd, args):
    try:
        use_shell = os.name == "nt"
        if not use_shell and shutil.which("npx") is None:
            return None, "npx not on PATH"
        p = subprocess.run(
            f"npx {cmd} {' '.join(args)}".strip() if use_shell else ["npx", cmd] + args,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=900,
            shell=use_shell,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def static_checks(run_deno=True, run_tsc=True):
    print("== A. static (no network) ==")

    wd = read_text(WATCHDOG_TS)
    rw = read_text(RUN_WATCHDOG_TS)
    wd_test = read_text(WATCHDOG_TEST_TS)
    windows = read_text(WINDOWS_TS)
    windows_test = read_text(WINDOWS_TEST_TS)
    fixture = read_text(FIXTURE_TS)
    load_grid = read_text(LOAD_GRID_TS)
    cfg = read_text(CONFIG_TS)
    persona = read_text(PERSONA_TS)
    disp = read_text(DISPATCH_TS)
    smoke = read_text(SMOKE_TS)
    mig = read_text(MIGRATION)
    tech = read_text(TECH)
    gloss = read_text(GLOSS)
    gloss_n = re.sub(r"[ \t]+", " ", gloss or "")  # table-padding tolerant

    check("_shared/checkin/watchdog.ts exists (the pure half)", wd is not None)
    check("_shared/checkin/runWatchdog.ts exists (the impure half)", rw is not None)
    check("_shared/checkin/watchdog.test.ts exists", wd_test is not None)
    check("migrations/0027_watchdog_cron_fp04.sql exists", mig is not None)
    required = (wd, rw, wd_test, windows, windows_test, fixture, load_grid, cfg, persona, disp, smoke, mig, tech, gloss)
    if any(v is None for v in required):
        print("  SKIP the remaining static checks -- a required file is missing")
        return

    # --- the pure module: jest-loadable, and only the decisions the scan makes ----
    specifiers = set(re.findall(r'from\s+"([^"]+)"', wd))
    check(
        "watchdog.ts imports only ./windows.ts (no config, no service client, no Deno.env)",
        specifiers == {"./windows.ts"},
        f"imports: {sorted(specifiers)}",
    )
    check("watchdog.ts reads no clock (nowMs is a parameter)", "Date.now" not in wd)
    check("watchdog.ts owns the scan decision", "export function selectMissedWindows" in wd)
    check("watchdog.ts owns the prompt context", "export function buildInterventionContext" in wd)
    check("watchdog.ts fixes the reason tag", 'MISSED_CHECKIN_REASON = "missed_checkin"' in wd)
    check(
        "watchdog.ts takes the evidence id sets as input (the lookups stay in the impure half)",
        "answeredStartMs: ReadonlySet<number>" in wd and "queuedStartMs: ReadonlySet<number>" in wd,
    )
    check(
        "the suite pins grace, lookback, the answered filter and the dedup",
        all(
            t in wd_test
            for t in (
                "leaves a window alone until its grace has elapsed",
                "does not reach back past the lookback bound",
                "the canonical checkin_window join",
                "already has an intervention queued",
            )
        ),
    )
    check(
        "the suite pins the no-overnight case (the PLAN's overnight leg, at unit level)",
        "never alerts across a window the grid does not emit" in wd_test,
    )
    check(
        "the suite pins the profile-local label (the section 7.1 twin contract)",
        "Asia/Kolkata" in wd_test and "14:30-15:30" in wd_test,
    )

    # --- NFR-7: the scan reuses the Step 2 grid, and the fixture stays shared ------
    check("runWatchdog.ts scans with windowsClosedBetween (the Step 2 server grid)", "windowsClosedBetween" in rw)
    check("runWatchdog.ts resolves the window span with windowsForLocalDay", "windowsForLocalDay" in rw)
    check(
        "runWatchdog.ts loads the grid through the shared loader (no second profiles read)",
        'from "./loadGrid.ts"' in rw and "loadGrid(" in rw,
    )
    check(
        "runWatchdog.ts derives no grid arithmetic of its own",
        "localWallToUtcMs" not in rw and "parseClock" not in rw,
    )
    check(
        "the Step 2 server suite still consumes the ONE shared fixture (NFR-7)",
        "windows.fixture" in windows_test and "WINDOW_SPANS" in windows_test,
    )
    check(
        "the fixture is the frozen twin case table both sides read",
        "WINDOW_SPANS" in fixture and "WINDOW_DAYS" in fixture,
    )
    check(
        "the server suite already covers the Step 6 scan decision",
        "windowsClosedBetween (the Step 6 scan)" in windows_test,
    )

    # --- the scan's contract ------------------------------------------------------
    check(
        "the scan is fail-closed per user, never per scan (a bad profile cannot stop the batch)",
        "skipped.push" in rw and "no_grid" in rw,
    )
    check("the scan logs one structured line (FR-18)", "[watchdog] scan now=" in rw)
    alert_iface = re.search(r"export interface WatchdogAlert \{(.*?)\}", rw, re.S)
    check(
        "the alert shape carries ids only (no user text in the log line)",
        alert_iface is not None
        and "userId" in alert_iface.group(1)
        and "window" in alert_iface.group(1)
        and "content" not in alert_iface.group(1),
    )
    check(
        "the dedup ignores status: one job row per missed window, ever",
        "if ((queuedRows ?? []).length > 0) queuedStartMs.add(window.startMs);" in rw
        and "IN_FLIGHT_STATUSES" not in rw,
    )
    check(
        "the answered join reads the canonical window key the same way submit-checkin does",
        '.eq("user_id", uid)' in rw and '.eq("checkin_window", windowIso)' in rw,
    )

    # --- the intervention: config, persona, domain, laziness ----------------------
    check(
        "the persona is read from config, never hardcoded (AGENTS.md section 2)",
        'getConfigString("intervention_persona")' in rw and "mentor_tough" not in rw,
    )
    check(
        "the recent-thread size is the [SPEC] sliding_window_messages, not a literal",
        'getConfigNumber("sliding_window_messages")' in rw,
    )
    check("the generation budget is config.pipeline_deadline_ms", 'getConfigNumber("pipeline_deadline_ms")' in rw)
    check(
        "the domain is the exported D7 fallback domain (no invented domain label)",
        "FALLBACK_DOMAIN" in rw and '"General"' not in rw,
    )
    check(
        "persona.ts exports FALLBACK_DOMAIN (one source for the neutral domain)",
        "export const FALLBACK_DOMAIN" in persona,
    )
    check(
        "the pipeline is imported lazily, the llm_retry precedent (a missing secret fails this job type only)",
        'await import("../pipeline/runPipeline.ts")' in rw
        and re.search(r'^\s*import[^\n]*"\.\./pipeline/runPipeline\.ts"', rw, re.M) is None,
    )
    check("generation runs the locked-persona path", "runLockedPersonaReply(" in rw and "persona," in rw)
    check(
        "the prompt goes in as `text`, so the generation guard delimiters apply (AGENTS.md section 4.6)",
        "text: context," in rw,
    )

    # --- the unprompted row --------------------------------------------------------
    check("the row is unprompted: reply_to_message_id NULL", "reply_to_message_id: null" in rw)
    check("the row is tagged source='watchdog_intervention'", 'source: "watchdog_intervention"' in rw)
    check("the row carries the window (the FR-16 dedup key)", "watchdog_window: windowIso" in rw)
    check("the row carries its job id", "source_job_id: jobId" in rw)
    check("the row records persona_key", "persona_key: result.persona" in rw)
    metadata_block = re.search(r"const metadata: Record<string, unknown> = \{(.*?)\};", rw, re.S)
    check(
        "tactical_analysis never reaches the row (AGENTS.md section 4.3)",
        metadata_block is not None and "tactical" not in metadata_block.group(1).lower(),
    )
    check("tactical_analysis is logged server-side instead", "result.tacticalAnalysis" in rw)
    check(
        "the thread read honours the unsavable permission flag (section 7.6)",
        '.eq("unsavable", false)' in rw,
    )
    check(
        "the dedup probe runs before generation (a re-claim is a cheap no-op)",
        "findWatchdogIntervention" in rw
        and rw.index("findWatchdogIntervention(userId, windowIso)") < rw.index("runLockedPersonaReply({"),
    )
    check(
        "one high-priority push behind a bounded await",
        "createHighPriorityPushPayload(" in rw and "setTimeout(resolve, 5000)" in rw,
    )
    check(
        "a malformed payload closes the job instead of burning five attempts",
        '"window_malformed"' in rw,
    )
    check("a transport failure propagates as a job failure (no holding reply)", "throw new Error" in rw)

    # --- the shared helpers the handler leans on -----------------------------------
    check(
        "config.ts gained a fail-closed string reader",
        "export async function getConfigString" in cfg and 'typeof val !== "string"' in cfg,
    )

    # --- the dispatcher registry ----------------------------------------------------
    handlers_block = re.search(r"const HANDLERS:[\s\S]*?\n\};", disp)
    keys = set(re.findall(r"^  ([a-z_]+):", handlers_block.group(0), re.M)) if handlers_block else set()
    check(
        "the dispatcher registers exactly the fourteen implemented handlers (FP-05 added three: journal_extract, journal_probe, anchor_plan; FP-06 added purge_memory and memory_extract; FP-07 added metric_eval; FP-08 adds drift_scan, quest_expire, strike_fire and histogram_daily)",
        keys == EXPECTED_HANDLERS,
        f"{sorted(keys)}",
    )
    fast = re.search(r"FAST_JOB_TYPES = new Set\(\[([^\]]*)\]\)", disp)
    fast_set = set(re.findall(r"'([a-z_]+)'", fast.group(1))) if fast else set()
    check("watchdog_checkin is cheap and opts into FAST_JOB_TYPES", "watchdog_checkin" in fast_set, f"{sorted(fast_set)}")
    check(
        "intervention deliberately does NOT (it reserves pipeline_deadline_ms)",
        "intervention" not in fast_set,
        f"{sorted(fast_set)}",
    )
    check(
        "the intervention handler validates the payload before delegating",
        "asString(payload.user_id)" in disp and "asString(payload.window)" in disp,
    )
    check(
        "the intervention handler passes the job id through (the row records its origin)",
        "jobId: job.id" in disp,
    )

    # --- the registry is still 15 types (both docs agree) ---------------------------
    tech_types = table_rows(tech, "### 2.3 Job type registry", "**Daily invocation budget")
    gloss_types = table_rows(gloss, "## 12. Job Type Identifiers", "## 13. Edge Function Identifiers")
    check(
        "TECH-SPEC section 2.3 still lists exactly 15 job types",
        len(tech_types) == EXPECTED_JOB_TYPES,
        f"{len(tech_types)}: {sorted(tech_types)}",
    )
    check(
        "GLOSSARY section 12 still lists exactly 15 job types",
        len(gloss_types) == EXPECTED_JOB_TYPES,
        f"{len(gloss_types)}: {sorted(gloss_types)}",
    )
    check("the two registries agree (no type invented in one place)", tech_types == gloss_types)
    check(
        "both Step 6 types were already in the registry (Step 6 adds none)",
        {"watchdog_checkin", "intervention"} <= tech_types,
    )

    # --- the migration ---------------------------------------------------------------
    check("the cron job is named watchdog-checkin", "cron.schedule(" in mig and "'watchdog-checkin'" in mig)
    check("the tick is every 5 minutes", "'*/5 * * * *'" in mig)
    check(
        "the tick only *inserts* a job row, guarded (the dispatcher stays the sole claimer)",
        "insert into public.jobs" in mig
        and "not exists" in mig
        and "'watchdog_checkin'" in mig
        and "status in ('pending', 'claimed', 'running')" in mig,
    )
    check("the migration seeds the intervention persona", "'intervention_persona'" in mig and '"mentor_tough"' in mig)
    config_inserts = re.findall(r"insert into config[\s\S]*?;", mig)
    check(
        "the migration does not re-seed watchdog_grace_minutes (0001 owns it)",
        bool(config_inserts)
        and all("watchdog_grace_minutes" not in seg for seg in config_inserts),
        f"config inserts: {config_inserts}",
    )

    # --- the drill drives the production scan -----------------------------------------
    check("dev-smoke exposes the watchdog-scan action", '"watchdog-scan"' in smoke)
    check("dev-smoke calls the production scan", "runWatchdogScan(" in smoke)
    check(
        "the drill can backdate the clock and scope to one profile",
        'searchParams.get("now")' in smoke and 'searchParams.get("user")' in smoke,
    )
    check(
        "the drill reaches the same function the cron handler does (no second scan)",
        "runWatchdogScan" in smoke and "runWatchdogScan" in disp,
    )

    # --- docs written back in the same change -----------------------------------------
    check("TECH-SPEC section 2.3 marks both types as built", "as built (Step 6)" in tech)
    check(
        "TECH-SPEC section 7.1 documents the scan, the intervention and the idempotency",
        "**Watchdog (Step 6, as built).**" in tech
        and "**The intervention.**" in tech
        and "**Idempotency (FR-16, \u00a72.2.4).**" in tech,
    )
    check("TECH-SPEC section 11 registers the new key", "`intervention_persona`" in tech)
    check(
        "GLOSSARY section 12 records both types",
        "`watchdog_checkin` | pg_cron, every 5 min" in gloss_n
        and "`intervention` | watchdog / sync evaluation" in gloss_n,
    )
    check("GLOSSARY section 13 records the drill action", "watchdog-scan" in gloss)
    check(
        "GLOSSARY section 15 records the window key and the modules",
        "`watchdog_window` (on `messages.metadata`)" in gloss and "runWatchdogScan" in gloss,
    )
    check("GLOSSARY section 16 lists the config key", "`intervention_persona`" in gloss)
    check(
        "GLOSSARY section 14 already carried the metadata source (no enum change needed)",
        "`watchdog_intervention`" in gloss,
    )

    if run_tsc:
        print("-- running tsc --noEmit --")
        ok, out = npx_check("tsc", ["--noEmit"])
        if ok is None:
            check("tsc --noEmit clean", False, f"SKIP: {out}")
        else:
            check("tsc --noEmit clean", ok, out[-2000:])

    if run_deno:
        print("-- running deno check --")
        ok, out = deno_check([DISPATCH_TS, SMOKE_TS, RUN_WATCHDOG_TS, WATCHDOG_TS, WATCHDOG_TEST_TS, PERSONA_TS, CONFIG_TS])
        if ok is None:
            check("deno check clean", False, f"SKIP: {out}")
        else:
            check("deno check clean (both functions + every new/changed module + the suite)", ok, out[-2000:])


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


def req(method, path, body=None, key=None, headers=None, timeout=90):
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
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:  # noqa: BLE001
            return e.code, {"raw": raw}


def rest(path, key=SERVICE):
    """GET rows from PostgREST. `path` is relative to `/rest/v1/` — pass `jobs?select=...`, never
    `/rest/v1/jobs?select=...` (the prefix is added here).

    A non-200 is reported as a FAIL: swallowing it into `[]` makes a rejected query look exactly
    like "no rows", which is how a doubled path prefix once hid three real passes."""
    st, rows = req("GET", f"/rest/v1/{path}", key=key, headers={"Accept": "application/json"})
    if st != 200:
        check(f"the REST read succeeded ({path.split('?')[0]})", False, f"{st} {rows}")
    return (rows if st == 200 and isinstance(rows, list) else []), st


def get_config(key):
    rows, _ = rest(f"config?select=value&key=eq.{key}")
    return rows[0]["value"] if rows else None


def set_config(key, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def auth_headers():
    return {"Authorization": f"Bearer {USER_JWT or JWT}"}


def resolve_user_jwt():
    """(token, usable, note) -- delegates to the shared resolver, which prints exactly which token
    this run will send (source, `sub`, `exp`, verdict, the raw token), so an `expired JWT` 401 is
    never a mystery."""
    if resolve_gate_token is None:
        print("  JWT   note   : _mint_dev_jwt.py unavailable -- using $DAVOS_USER_JWT as supplied")
        return JWT, bool(JWT), "supplied (helper unavailable, not pre-checked)"
    return resolve_gate_token(JWT, URL, SERVICE, EMAIL, allow_mint=not NO_MINT)


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"{SMOKE_URL}?action={action}" + (f"&{q}" if q else "")
    return req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"})


def iso_ms(dt):
    """The exact wire form the server writes: `new Date(ms).toISOString()`."""
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def grid_windows(day):
    """(start, close) for the pinned grid on one UTC day, mirroring windowsForLocalDay."""
    base = datetime.datetime.combine(day, datetime.time(0), tzinfo=datetime.timezone.utc)
    out = []
    m = GRID_START_MIN
    while m + GRID_CADENCE_MIN <= GRID_END_MIN:
        out.append((base + datetime.timedelta(minutes=m), base + datetime.timedelta(minutes=m + GRID_CADENCE_MIN)))
        m += GRID_CADENCE_MIN
    return out


def band_windows(now_dt, day):
    """The windows whose close falls in (now - lookback, now - grace] -- the scan's candidate set."""
    from_ = now_dt - datetime.timedelta(minutes=LOOKBACK_MIN)
    to = now_dt - datetime.timedelta(minutes=GRACE_MIN)
    wins = []
    for d in (-1, 0):
        for start, close in grid_windows(day + datetime.timedelta(days=d)):
            if from_ < close <= to:
                wins.append((start, close))
    return wins


def pick_drill(day):
    """(now, start, close) with exactly ONE candidate -- so "one alert" is an exact assertion."""
    for _start, close in grid_windows(day):
        now_dt = close + datetime.timedelta(minutes=5)
        wins = band_windows(now_dt, day)
        if len(wins) == 1:
            return now_dt, wins[0][0], wins[0][1]
    return None


def messages_for(uid, query):
    rows, _ = rest(
        "messages?select=id,role,content,reply_to_message_id,persona_key,metadata"
        f"&user_id=eq.{uid}&{query}",
    )
    return rows


def intervention_jobs(uid, window_iso):
    rows, _ = rest(
        "jobs?select=id,status,payload"
        f"&type=eq.intervention&payload->>user_id=eq.{uid}&payload->>window=eq.{window_iso}",
    )
    return rows


def dispatch_once():
    return req("POST", DISPATCH_URL, {}, key=SERVICE)


def manifest_path():
    """Where the live section remembers its probe ids (temp dir: a transient run artifact)."""
    return os.path.join(tempfile.gettempdir(), "fp04s6-last-run.json")


def save_run_manifest():
    """Remember this run's job id + window, so `--static-only --logs <file>` can replay the log leg
    against an export taken *after* the run, without a second live run."""
    try:
        with open(manifest_path(), "w", encoding="utf-8") as fh:
            json.dump(RUN_MANIFEST, fh)
        info("run manifest", manifest_path())
    except Exception as e:  # noqa: BLE001
        info("run manifest", f"could not be written ({e}) -- --logs still works in this process")


def load_run_manifest():
    """Restore the previous live run's ids. False when there is nothing usable to restore."""
    global RUN_MANIFEST
    try:
        with open(manifest_path(), encoding="utf-8-sig") as fh:
            data = json.load(fh)
    except Exception:  # noqa: BLE001
        return False
    if not data.get("job"):
        return False
    RUN_MANIFEST = data
    return True


def live_checks():
    print("== B. live (needs env; migration 0027 + job-dispatcher/dev-smoke deployed) ==")

    missing_keys = [k for k in REQUIRED_CONFIG if get_config(k) is None]
    check(
        "the watchdog config keys exist (migration 0027 applied)",
        not missing_keys,
        f"missing: {missing_keys} -- run `supabase db push`",
    )
    if missing_keys:
        print("  SKIP the remaining live checks -- a required config key is absent")
        FAILURES.append("migration 0027 not applied")
        return

    if not SMOKE_TOKEN:
        check("DEV_SMOKE_TOKEN is set (the drill's entry point)", False, "not set")
        print("  SKIP the remaining live checks")
        return

    global USER_JWT
    USER_JWT, jwt_usable, note = resolve_user_jwt()
    info("user JWT", note)
    if not jwt_usable:
        check("a usable user JWT", False, note)
        print("  SKIP the remaining live checks")
        return

    st, rows = req("GET", "/rest/v1/profiles?select=id&limit=1", key=ANON, headers=auth_headers())
    check("the JWT is accepted by the gateway (own profile row readable)", st == 200 and bool(rows), f"{st} {rows}")
    if not (st == 200 and isinstance(rows, list) and rows):
        print("  SKIP the remaining live checks")
        return
    uid = rows[0]["id"]
    info("drill user", uid)

    st, body = dev_smoke("watchdog-scan", now=iso_ms(datetime.datetime.now(datetime.timezone.utc)), user=uid)
    if st == 404:
        check("dev-smoke is deployed at current code", False, "404 -- run `supabase functions deploy dev-smoke`")
        FAILURES.append("dev-smoke not deployed")
        print("  SKIP the remaining live checks")
        return
    check(
        "dev-smoke answers the watchdog-scan action for the drill user",
        st == 200 and isinstance(body, dict) and body.get("ok") is True and body.get("profiles") == 1,
        f"{st} {body}",
    )
    if not (st == 200 and isinstance(body, dict) and body.get("ok") is True):
        print("  SKIP the remaining live checks")
        return

    snapshots = {k: get_config(k) for k in SNAPSHOT_KEYS}
    info("config snapshot", snapshots)

    prefs_sel = "select=checkin_cadence_minutes,checkin_active_hours_start,checkin_active_hours_end,timezone&limit=1"
    st, pref_rows = req("GET", f"/rest/v1/profiles?{prefs_sel}", key=ANON, headers=auth_headers())
    original = pref_rows[0] if (st == 200 and isinstance(pref_rows, list) and pref_rows) else {}
    info("prefs snapshot", original)

    # Pick a backdated window that is provably free: unanswered (no `doings_logs` row — the unique
    # index would reject the fabricated one) and unqueued (no `intervention` row). A gate that is
    # re-run must land on a fresh window rather than colliding with the previous run's leftovers.
    day0 = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=BACKDATE_DAYS)).date()
    picked = None
    for back in range(7):
        cand = pick_drill(day0 - datetime.timedelta(days=back))
        if cand is None:
            continue
        cand_iso = iso_ms(cand[1])
        taken, _ = rest(f"doings_logs?select=id&user_id=eq.{uid}&checkin_window=eq.{cand_iso}")
        if taken or intervention_jobs(uid, cand_iso):
            continue
        picked = cand
        break
    if picked is None:
        check(
            "the pinned grid yields a free single-candidate drill window",
            False,
            "no unanswered, unqueued window in the candidate days",
        )
        return
    now_dt, win_start, win_close = picked
    window_iso = iso_ms(win_start)
    info("drill now", iso_ms(now_dt))
    info("drill window", f"{window_iso} (closes {iso_ms(win_close)})")

    doing_id = None
    job_id = None
    try:
        check("pin `llm_stub_mode` = true (deterministic, no provider call)", set_config("llm_stub_mode", True))
        check(
            "pin `expo_push_enabled` = false (the push is a log line, not a device ping)",
            set_config("expo_push_enabled", False),
        )
        st, body = req(
            "POST",
            "/rest/v1/rpc/update_checkin_prefs",
            {"p_cadence": GRID_CADENCE_MIN, "p_start": "08:00", "p_end": "22:00", "p_tz": "UTC"},
            key=ANON,
            headers=auth_headers(),
        )
        check("pin the gate's grid (60 / 08:00-22:00 / UTC)", st in (200, 204), f"{st} {body}")

        # --- 1. answered: a doing on the window suppresses the alert --------------
        st, body = req(
            "POST",
            "/rest/v1/doings_logs",
            {
                "user_id": uid,
                "kind": "doing",
                "content": f"{PROBE} watchdog drill (the answered leg)",
                "source": "app",
                "logged_at": iso_ms(win_close),
                "checkin_window": window_iso,
            },
            key=SERVICE,
            headers={"Prefer": "return=representation"},
        )
        doing_id = body[0].get("id") if (st in (200, 201) and isinstance(body, list) and body) else None
        check("fabricate a doing for the drill window (the `checkin_window` join)", doing_id is not None, f"{st} {body}")

        st, body = dev_smoke("watchdog-scan", now=iso_ms(now_dt), user=uid)
        check(
            "the scan suppresses an ANSWERED window (live `checkin_window` join)",
            st == 200 and isinstance(body, dict) and body.get("alerts") == [],
            f"{st} {body}",
        )

        # --- 2. missed: removing the doing produces exactly one alert -------------
        st, _ = req("DELETE", f"/rest/v1/doings_logs?id=eq.{doing_id}", key=SERVICE)
        check("delete the fabricated doing", st in (200, 204), f"{st}")
        doing_id = None

        st, body = dev_smoke("watchdog-scan", now=iso_ms(now_dt), user=uid)
        alerts = (body or {}).get("alerts") if isinstance(body, dict) else None
        alerts = alerts or []
        check(
            "the scan reports exactly one MISSED window, for the drill window",
            st == 200
            and len(alerts) == 1
            and alerts[0].get("window") == window_iso
            and alerts[0].get("userId") == uid,
            f"{st} {body}",
        )
        check(
            "the scan counted the candidate window it decided on",
            isinstance(body, dict) and body.get("considered", 0) >= 1,
            f"{body}",
        )
        check(
            "the scan skipped nothing for the drill user",
            isinstance(body, dict) and body.get("skipped") == [],
            f"{body}",
        )

        jobs = intervention_jobs(uid, window_iso)
        job_id = jobs[0]["id"] if jobs else None
        check("exactly one `intervention` job was inserted (window dedup)", len(jobs) == 1, f"{jobs}")
        if job_id:
            RUN_MANIFEST.update({"job": job_id, "window": window_iso, "uid": uid})
            save_run_manifest()

        # --- 3. dedup: a second scan adds nothing --------------------------------
        st, body = dev_smoke("watchdog-scan", now=iso_ms(now_dt), user=uid)
        check(
            "a second scan inserts nothing (the window already has an intervention)",
            st == 200 and isinstance(body, dict) and body.get("alerts") == [],
            f"{st} {body}",
        )
        # Without this, a server-side `jobs_read_failed` also yields `alerts == []`: an errored
        # dedup read must not be able to masquerade as a successful suppression.
        check(
            "the second scan's dedup read actually succeeded (not a swallowed read error)",
            isinstance(body, dict) and body.get("skipped") == [],
            f"{body}",
        )
        check("still exactly one job row", len(intervention_jobs(uid, window_iso)) == 1)

        # --- 4. dispatch: one tick writes exactly one unprompted row --------------
        rows = []
        for attempt in range(4):
            st, body = dispatch_once()
            if st not in (200, 202):
                check(f"dispatcher tick {attempt + 1} accepted", False, f"{st} {body}")
                break
            deadline = time.time() + 20
            while time.time() < deadline:
                rows = messages_for(uid, f"metadata->>watchdog_window=eq.{window_iso}&role=eq.assistant")
                if rows:
                    break
                time.sleep(3)
            if rows:
                break
        check("exactly one unprompted assistant row for the window", len(rows) == 1, f"{len(rows)}")

        if len(rows) == 1:
            row = rows[0]
            md = row.get("metadata") or {}
            check(
                "the row is unprompted (reply_to_message_id NULL)",
                row.get("reply_to_message_id") is None,
                f"{row.get('reply_to_message_id')}",
            )
            check(
                "metadata.source is 'watchdog_intervention'",
                md.get("source") == "watchdog_intervention",
                f"{md.get('source')}",
            )
            check("metadata records the window (the dedup key)", md.get("watchdog_window") == window_iso)
            check("metadata records the job it came from", md.get("source_job_id") == job_id)
            check(
                "metadata.persona is the config reading (intervention_persona), not a literal",
                md.get("persona") == get_config("intervention_persona"),
                f"{md.get('persona')} vs {get_config('intervention_persona')}",
            )
            check("the row records persona_key", row.get("persona_key") == md.get("persona"))
            check("the row has content", bool((row.get("content") or "").strip()))
            check(
                "tactical_analysis is NOT on the row (AGENTS.md section 4.3)",
                "tactical_analysis" not in json.dumps(md),
            )
            check("the row's metadata carries no `trust_score`", "trust_score" not in json.dumps(md))

            # --- 5. re-claim: the same job run again writes nothing --------------
            st, _ = req(
                "PATCH",
                f"/rest/v1/jobs?id=eq.{job_id}",
                {
                    "status": "pending",
                    "attempts": 0,
                    "next_retry_at": iso_ms(datetime.datetime.now(datetime.timezone.utc)),
                },
                key=SERVICE,
                headers={"Prefer": "return=minimal"},
            )
            check("reset the intervention job to pending (simulate a re-claim)", st in (200, 204), f"{st}")
            for _ in range(3):
                st, _body = dispatch_once()
                if st not in (200, 202):
                    break
                time.sleep(5)
            again = messages_for(uid, f"metadata->>watchdog_window=eq.{window_iso}&role=eq.assistant")
            check("a re-claimed intervention writes nothing (FR-16 idempotency)", len(again) == 1, f"{len(again)}")
    finally:
        if not KEEP:
            if doing_id:
                req("DELETE", f"/rest/v1/doings_logs?id=eq.{doing_id}", key=SERVICE)
            if job_id:
                st, _ = req("DELETE", f"/rest/v1/jobs?id=eq.{job_id}", key=SERVICE)
                check("probe job cleaned up", st in (200, 204), f"{st}")
            st, _ = req("DELETE", f"/rest/v1/messages?metadata->>watchdog_window=eq.{window_iso}", key=SERVICE)
            check("probe intervention row cleaned up", st in (200, 204), f"{st}")
            if original:
                st, _ = req(
                    "POST",
                    "/rest/v1/rpc/update_checkin_prefs",
                    {
                        "p_cadence": original.get("checkin_cadence_minutes"),
                        "p_start": original.get("checkin_active_hours_start"),
                        "p_end": original.get("checkin_active_hours_end"),
                        "p_tz": original.get("timezone") or "UTC",
                    },
                    key=ANON,
                    headers=auth_headers(),
                )
                check("check-in prefs restored", st in (200, 204), f"{st}")
        for key, value in snapshots.items():
            if set_config(key, value):
                info(f"restored {key}", repr(value))
            else:
                check(f"restore `{key}`", False, "config PATCH failed")


# ---------------------------------------------------------------------------
# D. the log leg (--logs)
# ---------------------------------------------------------------------------


def read_any(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except Exception:  # noqa: BLE001
        return None


def log_records(text):
    """The export's messages as `(sort_key, execution_id, message)` records.

    A raw stdout capture is already line-per-message, in the order the function logged it, with no
    timestamp to sort by — there, file position *is* the clock.

    The Dashboard's CSV export is the opposite: it carries a `timestamp` (and an `execution_id`)
    but lists its rows **newest-first**, so file position is the reverse of the order the function
    ran in. Comparing two messages by index therefore reports "not between" for a correctly ordered
    pair like `tactical_analysis` → `[push]` → `wrote`. Sorting on the row's own timestamp is what
    makes the push-line check order-independent. Reading the export through `csv` also keeps a
    multi-line message in one piece, which `splitlines()` would shred.
    """
    lines = text.splitlines()
    if lines and "," in lines[0] and "event_message" in lines[0]:
        import csv
        import io

        try:
            rows = list(csv.reader(io.StringIO(text)))
        except Exception:  # noqa: BLE001
            rows = []
        if rows and "event_message" in rows[0]:
            header = rows[0]
            msg_i = header.index("event_message")
            ts_i = header.index("timestamp") if "timestamp" in header else None
            exec_i = header.index("execution_id") if "execution_id" in header else None
            out = []
            for pos, row in enumerate(rows[1:]):
                if len(row) <= msg_i:
                    continue
                sort_key = pos
                if ts_i is not None and len(row) > ts_i:
                    try:
                        sort_key = float(row[ts_i].strip())
                    except ValueError:
                        pass
                exec_id = row[exec_i] if (exec_i is not None and len(row) > exec_i) else None
                for msg in row[msg_i].splitlines() or [row[msg_i]]:
                    out.append((sort_key, exec_id, msg))
            return out
    return [(pos, None, ln) for pos, ln in enumerate(lines)]


def log_checks(path):
    print("== D. log cross-check (--logs) ==")
    raw = read_any(path)
    if raw is None:
        check("the log export is readable", False, path)
        return
    job = RUN_MANIFEST.get("job")
    if not job:
        check(
            "this run's intervention job id is available for the counting leg",
            False,
            f"no manifest at {manifest_path()} -- run the gate's live section once first",
        )
        return

    records = log_records(raw)
    tactical = [r for r in records if f"[intervention] tactical_analysis (job {job})" in r[2]]
    wrote = [r for r in records if "[intervention] wrote " in r[2] and f"(job {job}" in r[2]]
    check(
        "exactly one intervention render for the run's job (tactical_analysis + wrote)",
        len(tactical) == 1 and len(wrote) == 1,
        f"tactical={len(tactical)} wrote={len(wrote)}",
    )
    if len(tactical) == 1 and len(wrote) == 1:
        lo, hi = sorted((tactical[0][0], wrote[0][0]))
        # When the export carries execution ids, the push must belong to *this* render — a
        # neighbouring job's push line can otherwise share the timestamps in between.
        render_exec = tactical[0][1] if tactical[0][1] == wrote[0][1] else None
        between = [
            r
            for r in records
            if "[push]" in r[2] and lo <= r[0] <= hi and (render_exec is None or r[1] == render_exec)
        ]
        check(
            "the push block ran inside that render (one `[push]` line between the two)",
            len(between) >= 1,
            "no [push] line between tactical_analysis and wrote -- was the push block skipped?",
        )
    check(
        "the scan's own line is in the export (FR-18 evidence)",
        any("[watchdog] scan now=" in r[2] for r in records),
    )


# ---------------------------------------------------------------------------
# C. jest
# ---------------------------------------------------------------------------


def run_jest():
    print("== C. jest ==")
    ok, out = npx_check("jest", ["--ci"])
    if ok is None:
        check("jest green", False, f"SKIP: {out}")
        return
    suites = re.search(r"Test Suites:.*?(\d+) passed,\s*(\d+) total", out)
    check("jest green", ok, out[-2000:])
    check(
        "the watchdog suite is discovered and passes",
        "PASS supabase/functions/_shared/checkin/watchdog.test.ts" in out,
        "watchdog.test.ts missing from the run",
    )
    if suites:
        info("jest suites", suites.group(0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--no-deno", action="store_true", help="skip `deno check`")
    ap.add_argument("--no-tsc", action="store_true", help="skip `tsc --noEmit`")
    ap.add_argument("--no-mint", action="store_true", help="never mint a JWT; require DAVOS_USER_JWT to be valid")
    ap.add_argument("--email", help="user to mint for (default: DAVOS_USER_EMAIL, else inferred)")
    ap.add_argument("--keep", action="store_true", help="leave the probe rows in place (skip the cleanup)")
    ap.add_argument("--logs", help="an exported job-dispatcher log file for the push-line leg")
    args = ap.parse_args()

    global NO_MINT, EMAIL, KEEP
    NO_MINT = args.no_mint
    KEEP = args.keep
    if args.email:
        EMAIL = args.email

    static_checks(run_deno=not args.no_deno, run_tsc=not args.no_tsc)

    if not args.static_only:
        missing = [
            n
            for n, v in (
                ("SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)", URL),
                ("SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)", ANON),
                ("SUPABASE_SERVICE_ROLE_KEY", SERVICE),
            )
            if not v
        ]
        if missing:
            print("  SKIP live section -- need " + ", ".join(missing))
        else:
            live_checks()

    if args.logs:
        if not RUN_MANIFEST:
            load_run_manifest()
        log_checks(args.logs)
    elif not args.static_only:
        print("== D. log cross-check (--logs) ==")
        print("  SKIP the push-line leg -- save this run's job-dispatcher log from the Dashboard")
        print("       (Edge Functions -> job-dispatcher -> Logs), then replay it without a second")
        print(f"       live run: `--static-only --logs <file>` (job id: {RUN_MANIFEST.get('job')})")

    if args.run_jest:
        run_jest()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 6 checks passed.")


if __name__ == "__main__":
    main()
