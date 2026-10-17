#!/usr/bin/env python3
"""Automate FP-04 Step 3b verification (the check-in eval turn + the §5.3 check-in transparency).

Covers PLAN Step 3b Verify: "stub mode with `dev_force.eval_intervention` + energy 2 -> user row +
primary reply + one high-push attempt logged; the AC-4 real half via `dev-smoke&classifier=real` ->
emotion `exhausted`; energy 6 on-time -> `eval_ran:false`, exactly one embed line, zero generate
lines; backdated `windowTs` -> `eval_ran:true`; `llm_force_fail='both'` on a forced-intervention
submit -> holding reply + one `llm_retry` row, recover on `'none'`; §5.3 units green;
`send-message` changes limited to the helper import + the §5.3 block; tsc + deno check + jest
clean".

  AUTOMATED -- static (no network):
    modules   : `_shared/pipeline/autoAdopt.ts` is pure (it imports nothing at all, and reads no
                clock -- `nowMs` is a parameter); `_shared/replies.ts` is the ONE definition of
                `insertPrimaryReply`/`findPrimaryReply`/`writeHoldingReplyAndEnqueueRetry` in the
                tree; both new jest suites exist
    send-msg  : the §5.3 rule is imported, not re-implemented (no local `insertPrimaryReply`, no
                local `route !== "auto"` test); the scan is the bounded slice, selected with `id`
                (the anchor needs every row in the slice, so `limit(1)` is gone)
    submit    : the two deterministic gates (energy <= `energy_exhausted_max`, `nowMs` past
                `window.closeMs + checkin_late_minutes`), `evaluateDoing` reached ONLY inside the
                gate branch, `dev_force.eval_intervention` read through the shared parse, the
                intervention user row (`source:'checkin'` + `doing_id`, `client_message_id` only
                for the chat capture), `runPipeline` fed the check-in's `energy`, the primary
                reply + `createHighPriorityPushPayload`, the FR-10 replay lookup on
                `metadata->>doing_id`, the 503 embed contract and the one-embed call site intact,
                no `jobs` insert (zero new job types), no `trust_score`, `tactical_analysis`
                logged server-side only
    registry  : TECH-SPEC 7.1 / 5.3 / 4.1 and GLOSSARY 15 carry this step's write-backs; the
                FP-04 plan's Step 3b records the owner's four decisions
    log parser: `log_parser_self_test()` -- ten synthetic exports (raw, timestamp-prefixed, the
                Dashboard CSV, an `event_message` wrapper, a foreign run, a truncation) and four
                injected defects, so the `--logs` leg's counting is verified without a live run or
                a hand-made log file
    types/test: `deno check` on the entry points + the new and changed modules is clean; jest is
                green with >= 15 suites (the §5.3 suite included)

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE + a user JWT, and `submit-checkin`
  DEPLOYED):
    precond.  : a usable JWT, `submit-checkin` reachable (a 404 SKIPs loudly, never vacuously
                passes), OPTIONS/405/401 intact
    pinned    : `llm_stub_mode`, `dev_overrides_enabled`, `classifier_mode`, `llm_force_fail`,
                `checkin_late_minutes` and `expo_push_enabled` are snapshotted and restored in a
                `finally`; the grid is pinned with the validated RPC and the caller's prefs +
                `latest_energy` restored; every probe doing, message and job is deleted
    intervention (stub mode, `dev_force.eval_intervention`, energy 2, late window): `ok` with
                `eval_ran`/`intervention` true and the pair's ids; the user row carries
                `source:'checkin'` + `doing_id` + the chat capture's `client_message_id`; the reply
                is anchored on it with `source:'pipeline'`; a replay of the same window returns
                `duplicate` with the SAME ids and writes nothing new
    capture   : a `capture:'reply'` intervention ignores a stray `client_message_id` (no bubble)
    degrade   : real mode + `llm_force_fail='both'` -> the turn still exists, its reply is the
                holding reply (`route:'degrade'`, `source:'sync_degrade'`) and exactly ONE
                `llm_retry` job was enqueued; restoring stub mode and `'none'` produces a full
                reply again (the stub branch returns before the force-fail check, so the flag is
                inert under stub mode -- the FP-02 Step 8 gate pins the same pair)
    late gate : a window answered well past its close, with no energy at all, runs the eval
                (`eval_ran:true`) and intervenes on nothing (the stub payload says no)
    on-track  : energy 6 inside the window -> `eval_ran:false`, the frozen five keys, NO
                `messages` row, and (via `--logs`) exactly one embed and no generate for its own
                submit
    ac-4 real : `dev-smoke?action=pipeline&classifier=real&energy=2` -> `classification.emotion`
                is `exhausted`, i.e. the §6.2 override, live under the pinned stub mode
    harness   : `--run-step11` re-runs `scripts/verify-step11.py --turns 6 --cleanup` AFTER the
                config restore, so the FP-02 `send-message` suite is proven against the live modes
                (the refactor's regression leg, the FP-03 Step 7 precedent)

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DEV_SMOKE_TOKEN="<token>"
  python scripts/verify-fp04-step3.py [--static-only] [--run-jest] [--logs <file>] [--run-step11]

DAVOS_USER_JWT is optional: if set and still valid it is used, otherwise the gate mints one via
the admin API (`scripts/_mint_dev_jwt.py`). Either way the run PRINTS the token it will send --
source, `sub`, `exp`, a verdict and the raw token -- so an `expired JWT` 401 is never a mystery.
Pass --no-mint to require a hand-supplied token, or --email to pin the user.

--logs <file> adds the call-count leg. The CLI has **no** `functions logs` subcommand (checked on
v2.120.0 -- `supabase functions` is list/delete/download/deploy/new/serve), so the file comes from
the Dashboard: Edge Functions -> `submit-checkin` -> Logs -> download. That export is **CSV**
(`event_message,event_type,...`, quotes doubled, the line's trailing newline inside the quoted
field); the leg reads it through `csv` first, so the Dashboard file works as downloaded. Because the
export can only be taken *after* the run ends, the live section saves its probe ids to a manifest
(temp dir) and the leg replays on its own:

    python scripts/verify-fp04-step3.py                     # the live legs (writes the manifest)
    python scripts/verify-fp04-step3.py --static-only --logs logs.csv

The leg accepts any of the export shapes (raw stdout lines, a timestamp-prefixed copy, a dashboard
entry whose `event_message` holds the line as an escaped string, or the Dashboard's own CSV),
filters to *this* run's doings, and asserts one embed per stored doing plus one more for each
intervention turn (the turn is a full pipeline run, NFR-2), exactly one embed and no generate for
the ungated on-track submit's own window, and that the push block ran once per COMPLETED
intervention turn. That last one is why the live section pins `expo_push_enabled=false`:
`sendPush` is silent when it succeeds (it logs only the disabled/missing-config/no-token/failure
paths), so a successful push is invisible in the logs, and pinning the flag both makes the block's
run a deterministic line and keeps a gate run from pushing at a real device. Without `--logs` the
leg SKIPs -- it never fails for a file the owner has not supplied.

The gates and the counting legs both need the owner's dashboard:
  * `dev_overrides_enabled` is pinned true for the drill legs (the eval re-checks it
    fail-closed), and `llm_stub_mode` true so the run is deterministic and free; both are
    restored. This is the stub-mode end-to-end proof FP-04 Step 3a deferred to this step.
  * The §12 quota impact is one embed per check-in (plus the pipeline's own embed when the turn
    intervenes, NFR-2) and an eval `generate` only behind a deterministic gate.

PREREQUISITES: `supabase functions deploy submit-checkin` (and `send-message`), migration 0026
applied, and the FP-03 exemplar corpus seeded (the AC-4 real leg needs a non-empty corpus).
"""

import argparse
import contextlib
import csv
import datetime
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

try:
    # Sibling helper module (scripts/ is sys.path[0] for `python scripts/verify-fp04-step3.py`).
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001 -- the gate still runs; token resolution then falls back
    resolve_gate_token = None

FAILURES = []

# The on-track leg's `doings_logs` id, recorded by the live section so the `--logs` leg can find
# *its* submit line in an export that may also carry other invocations (see `log_checks`).
ONTIME_DOING_ID = None

# This run's probe doings, recorded as each leg answers (same purpose).
RUN_DOING_IDS = set()

# The live section submits five probes and replays one of them; the replay answers `duplicate`, so
# a complete export carries one submit line per recorded doing plus that replay. The `--logs` leg
# calls an export "complete" only at that count -- extend the `+ 1` if a later step adds another
# already-answered window.
def submit_lines_expected():
    return len(RUN_DOING_IDS) + 1


# The live section completes exactly two intervention turns (the recovery and the capture leg). The
# degrade leg's turn answers with the holding reply, which returns before the push block, so it
# must leave no `[push]` line.
COMPLETED_TURNS = 2

FN_REL = "supabase/functions/submit-checkin/index.ts"
SM_REL = "supabase/functions/send-message/index.ts"
REPLIES_TS = "supabase/functions/_shared/replies.ts"
AUTO_ADOPT_TS = "supabase/functions/_shared/pipeline/autoAdopt.ts"
AUTO_ADOPT_TEST_TS = "supabase/functions/_shared/pipeline/autoAdopt.test.ts"
EVAL_CONTRACT_TS = "supabase/functions/_shared/checkin/evalContract.ts"
OVERRIDES_TS = "supabase/functions/_shared/dev/overrides.ts"
OVERRIDES_TEST_TS = "supabase/functions/_shared/dev/overrides.test.ts"

FN_URL = "/functions/v1/submit-checkin"
SMOKE_URL = "/functions/v1/dev-smoke"
PROBE = "FP04S3-PROBE"

RESPONSE_KEYS = {"status", "doing_id", "energy", "eval_ran", "intervention"}
INTERVENTION_KEYS = RESPONSE_KEYS | {"user_message_id", "assistant_message_id"}

# The grid the gate pins for the live run, so it can compute expected windows in Python.
# 08:00-22:00 cadence 60 in UTC: starts 08:00..21:00, the last one closing exactly at 22:00.
GRID_CADENCE_MIN = 60
GRID_START_MIN = 8 * 60
GRID_END_MIN = 22 * 60

# The gate's own late-gate pair. `PINNED_LATE_MIN` keeps every probe window "on time" (so a leg
# can isolate the energy gate), and the late leg restores the real 15-minute gate and pins a
# window that closed hours ago.
PINNED_LATE_MIN = 1440
REAL_LATE_MIN = 15
# Windows older than this are excluded: a hint over 24 h old is rejected outright by
# `canonicalizeWindow`, and one near the boundary would be trivially "late" under the pin.
MAX_AGE_HOURS = 20

SNAPSHOT_KEYS = (
    "llm_stub_mode",
    "dev_overrides_enabled",
    "classifier_mode",
    "llm_force_fail",
    "checkin_late_minutes",
    # Pinned false so the push block's run is a deterministic log line (`sendPush` is silent on
    # success) and a gate run never pushes at a real device.
    "expo_push_enabled",
)


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def info(label, value):
    print(f"  ..   {label}: {value}")


def env(name, *alts):
    for k in (name,) + alts:
        if os.environ.get(k):
            return os.environ[k]
    return None


URL = (env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
ANON = env("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")
SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")
SMOKE_TOKEN = env("DEV_SMOKE_TOKEN")
JWT = env("DAVOS_USER_JWT")
EMAIL = env("DAVOS_USER_EMAIL")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

USER_JWT = None
NO_MINT = False


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def strip_ts_comments(text):
    """Drop // line comments so structural checks see code, not prose about the code."""
    return "\n".join(re.sub(r"//.*$", "", ln) for ln in text.splitlines())


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


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def deno_check(rels):
    """`deno check` a set of entry points. Returns (ok, output)."""
    try:
        import shutil

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


def jest_check():
    """Full jest suite. Returns (ok, output). Needs >= 15 suites and 0 failures."""
    try:
        import shutil

        use_shell = os.name == "nt"
        if not use_shell and shutil.which("npx") is None:
            return None, "npx not on PATH"
        p = subprocess.run(
            "npx jest --ci" if use_shell else ["npx", "jest", "--ci"],
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


def static_checks(run_deno=True, run_jest=False):
    print("== A. static (no network) ==")

    # The one leg that needs a hand-made artifact gets its parser pinned by synthetic exports.
    log_parser_self_test()

    fn = read_text(FN_REL)
    sm = read_text(SM_REL)
    replies = read_text(REPLIES_TS)
    adopt = read_text(AUTO_ADOPT_TS)
    contract = read_text(EVAL_CONTRACT_TS)
    overrides = read_text(OVERRIDES_TS)

    check("submit-checkin/index.ts exists", fn is not None)
    check("send-message/index.ts exists", sm is not None)
    check("_shared/replies.ts exists (the extracted reply machinery)", replies is not None)
    check("_shared/pipeline/autoAdopt.ts exists (the pure §5.3 rule)", adopt is not None)
    check("_shared/checkin/evalContract.ts exists", contract is not None)
    check("_shared/dev/overrides.ts exists", overrides is not None)
    if any(v is None for v in (fn, sm, replies, adopt, contract, overrides)):
        return

    # --- the pure §5.3 module
    check(
        "autoAdopt.ts is pure (imports nothing at all)",
        not re.search(r"^\s*import\b", adopt, re.M),
    )
    check(
        "autoAdopt.ts reads no clock (nowMs is a parameter)",
        "Date.now" not in adopt and "new Date(" not in adopt,
    )
    check("autoAdopt.ts owns the rule", "export function decideAutoAdopt" in adopt)
    check(
        "autoAdopt.ts names every stop reason the live legs assert",
        all(
            r in adopt
            for r in (
                '"qualifies"',
                '"no_rows"',
                '"preceded_by_user"',
                '"not_primary"',
                '"anchor_unresolved"',
                '"not_auto"',
                '"no_domain"',
                '"stale"',
            )
        ),
    )
    check("autoAdopt.ts keys FR-10 off the check-in source", 'CHECKIN_SOURCE = "checkin"' in adopt)
    check(
        "the check-in reply is identified by its anchor (FR-10's second clause)",
        "row.reply_to_message_id" in adopt and "byId.get(row.reply_to_message_id)" in adopt,
    )
    check(
        "a check-in turn is transparent, not chain-breaking (FR-10 / AC-7)",
        'if (checkin === "yes") continue;' in adopt,
    )
    for suite, rel in (
        ("autoAdopt.test.ts", AUTO_ADOPT_TEST_TS),
        ("overrides.test.ts", OVERRIDES_TEST_TS),
    ):
        check(f"{suite} exists (jest-discovered, .test.ts per bands.test.ts)", read_text(rel) is not None)

    # --- one implementation of the reply machinery
    tree_fns = []
    for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "supabase", "functions")):
        for name in files:
            if name.endswith(".ts"):
                src = read_text(os.path.relpath(os.path.join(dirpath, name), ROOT)) or ""
                tree_fns += re.findall(r"(?:async )?function (insertPrimaryReply|findPrimaryReply)", src)
    check(
        "`insertPrimaryReply` and `findPrimaryReply` are defined exactly once, in _shared/replies.ts",
        sorted(tree_fns) == ["findPrimaryReply", "insertPrimaryReply"],
        f"{tree_fns}",
    )
    for exported in ("findPrimaryReply", "insertPrimaryReply", "writeHoldingReplyAndEnqueueRetry"):
        check(f"replies.ts exports `{exported}`", f"export async function {exported}" in replies)
    check(
        "replies.ts reuses the at-most-one-primary-reply index rather than a second writer",
        'from("messages")' in replies and "insertPrimaryReply({" in replies,
    )
    check(
        "the degrade enqueues exactly one `llm_retry` job and never pushes",
        'type: "llm_retry"' in replies and "sendPush" not in replies,
    )
    check(
        "the degrade still reads `sync_degrade_reply` from config ([SPEC], §2)",
        'getConfig("sync_degrade_reply")' in replies and "sync_degrade_reply" in replies,
    )
    check(
        "replies.ts returns data, not a Response (each caller shapes its own body)",
        "Promise<Response>" not in replies,
    )

    # --- send-message: the rule moved out, the scan widened
    sm_code = strip_ts_comments(sm)
    check(
        "send-message imports the extracted machinery",
        'from "../_shared/replies.ts"' in sm_code
        and "writeHoldingReplyAndEnqueueRetry(args)" in sm_code,
    )
    check(
        "send-message no longer defines the reply helpers locally",
        "async function insertPrimaryReply" not in sm_code
        and "async function findPrimaryReply" not in sm_code,
    )
    check("send-message delegates the §5.3 decision", "decideAutoAdopt({" in sm_code)
    check(
        "the scan is the bounded slice, not `limit(1)`",
        "const AUTO_ADOPT_SLICE = 10;" in sm_code and ".limit(AUTO_ADOPT_SLICE)" in sm_code,
    )
    check(
        "the scan selects `id` (FR-10's anchor resolution needs every row in the slice)",
        '.select("id, role, reply_to_message_id, metadata, created_at")' in sm_code,
    )
    check("the §5.3 clauses are not re-implemented in send-message", 'metadata.route !== "auto"' not in sm_code)
    check(
        "send-message keeps only the I/O half (one RPC after the decision)",
        'increment_auto_adopt_successes' in sm_code and "decision.domain" in sm_code,
    )

    # --- submit-checkin: the gates, the turn, the response
    fn_code = strip_ts_comments(fn)
    check(
        "the FR-11 energy gate reuses `energy_exhausted_max` (§7.1's key reuse)",
        'getConfigNumber("energy_exhausted_max")' in fn_code and "energy <= energyExhaustedMax" in fn_code,
    )
    check(
        "the FR-11 late gate is window.closeMs + checkin_late_minutes",
        'getConfigNumber("checkin_late_minutes")' in fn_code
        and "nowMs > window.closeMs + lateMinutes * 60_000" in fn_code,
    )
    check(
        "the gates are evaluated into a list of reasons (FR-18's log field)",
        'gates.push("low_energy")' in fn_code and 'gates.push("late")' in fn_code,
    )
    eval_at = fn_code.find("await evaluateDoing(")
    gate_at = fn_code.find("if (gates.length > 0) {")
    check(
        "the eval is reached ONLY inside the gate branch (FR-11: no gate, no LLM)",
        gate_at != -1 and eval_at != -1 and gate_at < eval_at,
        f"gate@{gate_at} eval@{eval_at}",
    )
    check(
        "the eval passes the doing text, the check-in's energy and today's anchors",
        "{ text: content, energy, anchors }" in fn_code,
    )
    check(
        "the drill flag is read through the shared parse, not inline",
        "evalForceIntervention(body)" in fn_code and "export function evalForceIntervention" in overrides,
    )
    check(
        "the drill parse is fail-closed on anything but a JSON true",
        "eval_intervention === true" in overrides,
    )
    check(
        "anchors come from `anchor_plans` through the tolerant mapper (not a hardcoded [])",
        'from("anchor_plans")' in fn_code and "toEvalAnchors(" in fn_code and "return [];" in fn_code,
    )
    check("evalContract.ts exports the tolerant anchor mapper", "export function toEvalAnchors" in contract)
    check(
        "the anchor read is non-fatal (a lookup problem is not a failed check-in)",
        re.search(r"async function loadTodayAnchors[\s\S]*?\n\}", fn_code) is not None
        and "catch" in re.search(r"async function loadTodayAnchors[\s\S]*?\n\}", fn_code).group(0),
    )

    # the frozen response shape: the five keys, plus the pair's ids only when a turn exists
    check("the response keeps the frozen five keys", all(f"{k}:" in fn_code for k in sorted(RESPONSE_KEYS)))
    check(
        "`eval_ran` is derived from the gate outcome, never hardcoded (FR-11/FR-12)",
        'eval_ran: evalOutcome !== "skipped"' in fn_code,
    )
    check(
        "`intervention` is derived from the turn, never hardcoded (FR-9)",
        "intervention: turn !== null" in fn_code and "eval_ran: turn !== null" in fn_code,
    )
    check(
        "Step 3 ADDS the ids; it renames nothing",
        "user_message_id: turn.userMessageId" in fn_code
        and "assistant_message_id: turn.assistantMessageId" in fn_code,
    )

    # the intervention turn (FR-9)
    check("the intervention turn is one function, shared by both capture paths", "async function writeInterventionTurn" in fn_code)
    check(
        "the user row is the anchor: source 'checkin' + the doing id (FR-9, FR-10)",
        'metadata: { source: "checkin", doing_id: doingId }' in fn_code,
    )
    check(
        "`client_message_id` is written only for the chat capture (FR-9 — the reply path has no bubble)",
        'if (capture === "chat") clientMessageId = body.client_message_id;' in fn_code
        and "row.client_message_id = clientMessageId;" in fn_code,
    )
    check(
        "a 23505 on the user row re-selects the bubble's row instead of failing",
        'code !== "23505"' in fn_code or 'code === "23505"' in fn_code,
    )
    check(
        "the pipeline runs with the check-in's energy and the config deadline (FP-03 param goes live)",
        "runPipeline({ text: content, userId, energy, deadlineAt })" in fn_code
        and 'getConfigNumber("pipeline_deadline_ms")' in fn_code,
    )
    check(
        "the reply is inserted through the extracted helper",
        "await insertPrimaryReply({" in fn_code and "findPrimaryReply(userMessageId)" in fn_code,
    )
    check(
        "the reply's metadata is the §3.2 pipeline block",
        'source: "pipeline"' in fn_code and "user_message_id: userMessageId" in fn_code,
    )
    check(
        "the intervention push is the HIGH-priority payload (§7.10, FR-13)",
        re.search(r"createHighPriorityPushPayload\(\s*userId,", fn_code) is not None,
    )
    check(
        "the push await is bounded (the turn is already committed)",
        "Promise.race([sendPush(payload)" in fn_code,
    )
    check(
        "a transport failure degrades through the SAME §4.1 machinery (an intervention turn is a turn)",
        "writeHoldingReplyAndEnqueueRetry({" in fn_code and "isProvidersUnavailable(err)" in fn_code,
    )
    check(
        "the FR-8 replay resolves the turn it already materialized (`metadata->>doing_id`)",
        '.eq("metadata->>doing_id", doingId)' in fn_code and "async function findInterventionTurn" in fn_code,
    )
    msg_insert = re.search(r'from\("messages"\)\s*\.insert\(', fn_code)
    turn_fn_at = fn_code.find("async function writeInterventionTurn")
    check(
        "an on-track check-in writes no `messages` row (FR-9): the tree's only insert is the turn's",
        msg_insert is not None and turn_fn_at != -1 and turn_fn_at < msg_insert.start(),
        f"insert@{msg_insert.start() if msg_insert else -1} turn@{turn_fn_at}",
    )
    check(
        "a check-in turn never scores D8's counter (FR-10: submit-checkin never calls the recorder)",
        re.search(r"\brecordAutoAdoptSuccess\s*\(", fn_code) is None
        and re.search(r"\bincrement_auto_adopt_successes\s*\(", fn_code) is None,
    )

    # --- invariants that must survive the step
    check(
        "still exactly one embed call site, and it is the adapter's",
        fn_code.count("await embed(") == 1 and 'from "../_shared/llm/adapter.ts"' in fn_code,
    )
    check("the 503 embed contract is intact (§7.1)", '"embed_unavailable"' in fn_code and "503" in fn_code)
    dup_at = fn_code.find("findDoingForWindow(userId, windowIso)")
    embed_at = fn_code.find("await embed(")
    check(
        "the duplicate check still precedes the embed (FR-8: a repeat costs zero embeds)",
        dup_at != -1 and embed_at != -1 and dup_at < embed_at,
        f"dup@{dup_at} embed@{embed_at}",
    )
    check("zero new job types: submit-checkin writes no `jobs` row", 'from("jobs")' not in fn_code)
    check("no `trust_score` ever leaves the server (§4.7)", "trust_score" not in fn_code)
    check(
        "tactical_analysis is logged server-side only (§4.3: never persisted, never returned)",
        fn_code.count("tacticalAnalysis") == 1 and "[submit-checkin] tactical_analysis:" in fn_code,
    )
    check(
        "no evaluable code beyond the JSONLogic gate (§4.4: no eval/new Function)",
        re.search(r"\beval\s*\(", fn_code) is None and "new Function" not in fn_code,
    )
    check(
        "no provider SDK is imported into feature code (AGENTS §3.5)",
        not re.search(r"npm:@google|groq", fn_code, re.I),
    )

    # --- registry / docs
    tech = read_text("docs/TECH-SPEC.md") or ""
    gloss = read_text("docs/GLOSSARY.md") or ""
    plan = read_text("docs/feature-prds/FP-04/FP-04-PLAN.md") or ""
    check(
        "TECH-SPEC 7.1 documents the deterministic gates and the intervention turn",
        "evaluateDoing" in tech and "writeInterventionTurn" in tech and "energy_exhausted_max" in tech,
    )
    check(
        "TECH-SPEC 7.1 documents the replay contract and the added response keys",
        "user_message_id" in tech and "assistant_message_id" in tech and "metadata->>doing_id" in tech,
    )
    check(
        "TECH-SPEC 5.3 documents FR-10's check-in transparency",
        "check-in" in tech and "auto_adopt_successes" in tech and "transparen" in tech.lower(),
    )
    check(
        "TECH-SPEC 4.1 keeps the schema-selected stub dispatch",
        "stubShapes.ts" in tech and "validator identity" in tech,
    )
    check(
        "GLOSSARY 15 registers the check-in turn's metadata keys",
        "doing_id" in gloss and "sync_degrade" in gloss and "watchdog_intervention" in gloss,
    )
    check(
        "TECH-SPEC 5.3 records the Step 3b decisions (FR-10 transparency, no recorder call)",
        "auto_adopt_successes" in tech and "never calls the recorder" in tech,
    )
    check(
        "the FP-04 docs keep `zero new job types` (no 16th type was introduced)",
        "Zero new job types" in plan or "zero new job types" in plan,
    )

    if run_deno:
        print("-- running deno check --")
        ok, out = deno_check(
            [
                FN_REL,
                SM_REL,
                REPLIES_TS,
                AUTO_ADOPT_TS,
                AUTO_ADOPT_TEST_TS,
                EVAL_CONTRACT_TS,
                OVERRIDES_TS,
                OVERRIDES_TEST_TS,
                "supabase/functions/_shared/llm/adapter.ts",
                "supabase/functions/_shared/checkin/eval.ts",
                "supabase/functions/dev-smoke/index.ts",
                "supabase/functions/select-persona/index.ts",
                "supabase/functions/job-dispatcher/index.ts",
                "supabase/functions/health/index.ts",
            ]
        )
        if ok is None:
            check("deno check clean", False, f"SKIP: {out}")
        else:
            check("deno check clean (entry points + every new/changed module + both suites)", ok, out[-2000:])

    if run_jest:
        print("-- running jest (full suite) --")
        ok, out = jest_check()
        if ok is None:
            check("jest green", False, f"SKIP: {out}")
        else:
            suites = re.search(r"Test Suites:.*?(\d+) passed,\s*(\d+) total", out)
            tests = re.search(r"Tests:.*?(\d+) passed,\s*(\d+) total", out)
            n_suites = int(suites.group(1)) if suites else -1
            failed = int(suites.group(2)) - n_suites if suites else -1
            check("jest green", ok, out[-2000:])
            check("jest runs >= 15 suites with 0 failures", n_suites >= 15 and failed == 0, f"{n_suites} passed / {failed} failed")
            check(
                "the §5.3 suite is discovered and passes (AC-7 both directions)",
                out.count("pipeline/autoAdopt.test.ts") >= 1,
            )
            info("jest tests", tests.group(0) if tests else "?")


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


def rest(path, key=SERVICE):
    st, rows = req("GET", f"/rest/v1/{path}", key=key, headers={"Accept": "application/json"})
    return (rows if st == 200 and isinstance(rows, list) else []), st


def get_config(key):
    rows, _ = rest(f"config?select=value&key=eq.{key}")
    return rows[0]["value"] if rows else None


def set_config(key, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def run(cmd, timeout):
    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=(os.name == "nt"),
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        return None, str(exc)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def step11_checks(turns):
    """The plan's `send-message` regression leg (the FP-03 Step 7 precedent).

    Step 3b rewrites `send-message`'s counter into a shared pure module, so the FP-02 harness -- the
    only end-to-end proof that the turn machinery still behaves -- is re-run here rather than
    trusted. It runs AFTER the config restore, so it sees the live modes (`dev_overrides_enabled` /
    `llm_stub_mode` as configured), not this gate's drills.
    """
    print("== D. the send-message regression harness ==")
    if not USER_JWT:
        print("  SKIP the harness -- it signs its own requests with the user JWT this run resolved")
        return
    rc, out = run(
        [sys.executable, "scripts/verify-step11.py", "--turns", str(turns), "--cleanup"],
        timeout=1800,
    )
    if rc is None:
        check("verify-step11.py ran", False, out)
        return
    check(
        f"verify-step11.py is green with --turns {turns} --cleanup (the `send-message` regression leg)",
        rc == 0,
        (out or "")[-1500:],
    )


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"{SMOKE_URL}?action={action}" + (f"&{q}" if q else "")
    st, body = req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"})
    return st, body


def auth_headers():
    return {"Authorization": f"Bearer {USER_JWT or JWT}"}


def resolve_user_jwt():
    """(token, usable, note). Delegates to the shared resolver, which prints exactly which token
    this run will send (source, `sub`, `exp`, verdict, the token itself) -- see
    `_mint_dev_jwt.resolve_gate_token`. It never hands back a token already known to be expired;
    when it cannot produce a usable one the gate skips its authenticated legs instead of
    collecting a wall of unexplained 401s."""
    if resolve_gate_token is None:
        print("  JWT   note   : _mint_dev_jwt.py unavailable -- using $DAVOS_USER_JWT as supplied")
        return JWT, bool(JWT), "supplied (helper unavailable, not pre-checked)"
    return resolve_gate_token(JWT, URL, SERVICE, EMAIL, allow_mint=not NO_MINT)


def iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_starts(day):
    """The grid's emitted starts for one UTC day, mirroring windowsForLocalDay's rule."""
    out = []
    m = GRID_START_MIN
    while m + GRID_CADENCE_MIN <= GRID_END_MIN:
        out.append(datetime.datetime.combine(day, datetime.time(m // 60, m % 60), tzinfo=datetime.timezone.utc))
        m += GRID_CADENCE_MIN
    return out


def all_starts(now_dt):
    starts = []
    for d in (-2, -1, 0, 1):
        starts += day_starts((now_dt + datetime.timedelta(days=d)).date())
    return starts


def min_distance_minutes(now_dt, t):
    return min(abs((s - t).total_seconds()) / 60.0 for s in all_starts(now_dt))


_POST_AS_USER = object()


def remember_doing(body):
    """Record a probe doing id, so the `--logs` leg can pick this run's submit lines out of an
    export that may also carry other invocations."""
    doing_id = (body or {}).get("doing_id")
    if doing_id:
        RUN_DOING_IDS.add(str(doing_id))
    return doing_id


def fn_post(body, jwt=_POST_AS_USER):
    """POST to the function as the check-in user, carrying the gate's resolved token.

    Pass `jwt=None` for the single deliberately unauthenticated call in the auth section (it
    asserts a 401). Anything else sends `USER_JWT` -- resolved after the gateway-probe retry, so
    every later call uses the token the function actually accepts."""
    if jwt is _POST_AS_USER:
        jwt = USER_JWT
    headers = {"Authorization": f"Bearer {jwt}"} if jwt else None
    return req("POST", FN_URL, body, key=ANON, headers=headers)


def doing_for_window(uid, window_iso):
    st, rows = req(
        "GET",
        "/rest/v1/doings_logs?select=id,content,source,energy,logged_at,embed_model"
        f"&user_id=eq.{uid}&checkin_window=eq.{window_iso}",
        key=SERVICE,
    )
    return (rows or []) if st == 200 and isinstance(rows, list) else []


def messages_for(uid, query):
    st, rows = req(
        "GET",
        "/rest/v1/messages?select=id,role,content,reply_to_message_id,client_message_id,metadata"
        f"&user_id=eq.{uid}&{query}",
        key=SERVICE,
    )
    return (rows or []) if st == 200 and isinstance(rows, list) else []


def turn_for_doing(uid, doing_id):
    """(user_row, reply_row) for the turn a doing materialized, or (None, None)."""
    rows = messages_for(uid, f"metadata->>doing_id=eq.{doing_id}")
    user_row = next((r for r in rows if r.get("role") == "user"), None)
    if not user_row:
        return None, None
    replies = messages_for(uid, f"reply_to_message_id=eq.{user_row['id']}")
    return user_row, (replies[0] if replies else None)


def live_checks(logfile=None):
    print("== B. live (needs env; submit-checkin + send-message deployed) ==")

    # --- preconditions: the config keys exist, a usable JWT, the function deployed ---
    st, rows = req(
        "GET",
        "/rest/v1/config?select=key&key=in.(checkin_late_minutes,watchdog_lookback_minutes)",
        key=SERVICE,
    )
    if st != 200 or not isinstance(rows, list) or len(rows) != 2:
        print("  FAIL migration 0026 is not applied (config keys absent) -- run `supabase db push`")
        FAILURES.append("migration 0026 not applied")
        print("  SKIP remaining live checks")
        return

    global USER_JWT
    USER_JWT, jwt_usable, note = resolve_user_jwt()
    jwt_ok = False
    rows = []
    if jwt_usable:
        st, rows = req("GET", "/rest/v1/profiles?select=id&limit=1", key=ANON, headers=auth_headers())
        jwt_ok = st == 200 and isinstance(rows, list) and bool(rows)
        check(f"a usable user JWT ({note})", jwt_ok, f"{st} {rows}")
    else:
        check(f"a usable user JWT ({note})", False, note)
    if not jwt_ok:
        print("  SKIP remaining live checks -- no usable user JWT")
        return
    uid = rows[0]["id"]

    st, body = fn_post({}, jwt=USER_JWT)
    if st == 401 and resolve_gate_token is not None and not NO_MINT:
        print("  ..   the Edge gateway rejected the token (401) though it decodes valid -- "
              "minting a fresh one and retrying once")
        fresh, fresh_ok, _fresh_note = resolve_gate_token("", URL, SERVICE, EMAIL, allow_mint=True)
        if fresh_ok:
            USER_JWT = fresh
            st, body = fn_post({}, jwt=USER_JWT)
    if st == 404:
        print("  FAIL `submit-checkin` is not deployed -- run `supabase functions deploy submit-checkin`")
        FAILURES.append("submit-checkin not deployed")
        print("  SKIP remaining live checks")
        return
    check("the function is reachable and accepts the token (a body-less POST is a 400)", st == 400, f"{st} {body}")
    check("the body-less POST names the missing field", "content" in json.dumps(body or {}), f"{body}")

    st, _ = req(
        "OPTIONS",
        FN_URL,
        key=ANON,
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    check("OPTIONS preflight is 204", st == 204, f"{st}")
    st, body = fn_post(
        {"content": "hi", "capture": "reply", "windowTs": iso(datetime.datetime.now(datetime.timezone.utc))},
        jwt=None,
    )
    check("an unauthenticated POST is rejected by the gateway (401)", st == 401, f"{st} {body}")

    # --- snapshot the shared config, then pin a deterministic, free run ---
    snapshots = {k: get_config(k) for k in SNAPSHOT_KEYS}
    info("config snapshot", snapshots)
    if snapshots["dev_overrides_enabled"] is not True:
        # The eval re-checks this flag fail-closed, so the drill legs are meaningless without it.
        print("  ..   `dev_overrides_enabled` is not true; pinning it true for the drill legs")
    prefs_sel = "select=checkin_cadence_minutes,checkin_active_hours_start,checkin_active_hours_end,timezone,latest_energy&limit=1"
    st, rows = req("GET", f"/rest/v1/profiles?{prefs_sel}", key=ANON, headers=auth_headers())
    check("read the current check-in prefs", st == 200 and isinstance(rows, list) and len(rows) == 1, f"{st} {rows}")
    original = rows[0] if (isinstance(rows, list) and rows) else {}
    original_latest_energy = original.get("latest_energy")

    turn_ids = []  # every probe user-message id, for the cleanup
    now_dt = datetime.datetime.now(datetime.timezone.utc)

    try:
        for key, value in (
            ("llm_stub_mode", True),
            ("dev_overrides_enabled", True),
            ("llm_force_fail", "none"),
            ("classifier_mode", "stub"),
            ("checkin_late_minutes", PINNED_LATE_MIN),
            ("expo_push_enabled", False),
        ):
            check(f"pin `{key}` = {json.dumps(value)} for the run", set_config(key, value))

        st, body = req(
            "POST",
            "/rest/v1/rpc/update_checkin_prefs",
            {"p_cadence": GRID_CADENCE_MIN, "p_start": "08:00", "p_end": "22:00", "p_tz": "UTC"},
            key=ANON,
            headers=auth_headers(),
        )
        check("pin the gate's grid (60 / 08:00-22:00 / UTC)", st in (200, 204), f"{st} {body}")

        # --- pick five free, recently-closed windows (never touch a real user row) ---
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        candidates = [
            s
            for s in sorted(all_starts(now_dt), reverse=True)
            if s + datetime.timedelta(minutes=GRID_CADENCE_MIN) <= now_dt
            and now_dt - s <= datetime.timedelta(hours=MAX_AGE_HOURS)
        ]
        free = []
        for s in candidates:
            if len(free) >= 5:
                break
            if not doing_for_window(uid, iso(s)):
                free.append(s)
        if len(free) < 5:
            print("  FAIL no five free closed windows to probe -- SKIP")
            FAILURES.append("no free closed windows to probe")
            return
        w_degrade, w_turn, w_capture, w_ontime, w_late = free[0], free[1], free[2], free[3], free[4]
        for label, s in (
            ("degrade", w_degrade),
            ("turn", w_turn),
            ("capture", w_capture),
            ("on-track", w_ontime),
            ("late", w_late),
        ):
            info(f"window[{label}]", f"{iso(s)} (close {iso(s + datetime.timedelta(minutes=GRID_CADENCE_MIN))})")

        # ---------------------------------------------------------------
        # 1. the degrade leg: every provider fails, so the turn holds
        # ---------------------------------------------------------------
        # `llm_force_fail` only acts past the adapter's stub branch (which returns first), so the
        # flag is inert while `llm_stub_mode` is true -- the FP-02 Step 8 gate pins the same pair
        # for the same reason. The forced failure is *synthetic* (two log lines, no provider
        # call), so this leg costs one real embed for the turn and nothing else.
        check(
            "real mode for the degrade leg (the stub branch returns before the forced-failure check)",
            set_config("llm_stub_mode", False),
        )
        check("`llm_force_fail` = 'both' for the degrade leg", set_config("llm_force_fail", "both"))
        st, body = fn_post(
            {
                "content": f"{PROBE} degrade leg, drained 2",
                "capture": "reply",
                "windowTs": iso(w_degrade),
                "dev_force": {"eval_intervention": True},
            }
        )
        remember_doing(body)
        check(
            "degrade: the forced intervention returns ok with a turn",
            st == 200 and isinstance(body, dict) and body.get("status") == "ok",
            f"{st} {body}",
        )
        check(
            "degrade: the response carries exactly the five keys plus the pair's ids",
            isinstance(body, dict) and set(body.keys()) == INTERVENTION_KEYS,
            f"{list((body or {}).keys())}",
        )
        check("degrade: eval_ran is true (a gate tripped and the eval ran)", (body or {}).get("eval_ran") is True, f"{body}")
        check("degrade: intervention is true", (body or {}).get("intervention") is True, f"{body}")
        deg_user_id = (body or {}).get("user_message_id")
        deg_reply_id = (body or {}).get("assistant_message_id")
        deg_doing_id = (body or {}).get("doing_id")
        if deg_user_id:
            turn_ids.append(deg_user_id)

        deg_row = (doing_for_window(uid, iso(w_degrade)) or [{}])[0]
        user_row, reply_row = turn_for_doing(uid, deg_row.get("id"))
        check("degrade: the user row exists and is the check-in anchor", user_row is not None)
        check(
            "degrade: the holding reply is the primary reply (route 'degrade')",
            reply_row is not None and (reply_row.get("metadata") or {}).get("route") == "degrade",
            f"{reply_row}",
        )
        check(
            "degrade: the holding reply is `sync_degrade` and points at its retry job",
            reply_row is not None
            and (reply_row.get("metadata") or {}).get("source") == "sync_degrade"
            and (reply_row.get("metadata") or {}).get("source_job_id"),
            f"{(reply_row or {}).get('metadata')}",
        )
        check(
            "degrade: the response's assistant id IS the holding reply",
            deg_reply_id is not None and reply_row is not None and deg_reply_id == reply_row.get("id"),
            f"{deg_reply_id} vs {(reply_row or {}).get('id')}",
        )
        job_id = ((reply_row or {}).get("metadata") or {}).get("source_job_id")
        jobs, _ = rest(f"jobs?select=id,type&type=eq.llm_retry&payload->>user_message_id=eq.{deg_user_id}")
        check(
            "degrade: exactly ONE `llm_retry` job was enqueued for the turn (§4.1)",
            len(jobs) == 1 and (jobs[0].get("id") == job_id if jobs else False),
            f"{jobs}",
        )
        deg_calls = messages_for(uid, "metadata->>doing_id=eq." + str(deg_row.get("id")))
        check("degrade: the turn is exactly the user row + the holding reply", len(deg_calls) == 1, f"{len(deg_calls)} rows besides the reply")

        # ---------------------------------------------------------------
        # 2. the recovery leg (the full intervention turn), chat capture
        # ---------------------------------------------------------------
        bubble = "11111111-2222-4333-8444-555555555555"
        # The recovery leg: the same forced intervention, with the outage cleared and the stub
        # back on, so the turn answers with a real (stubbed) pipeline reply.
        check("restore stub mode for the recovery leg", set_config("llm_stub_mode", True))
        check("restore `llm_force_fail` = 'none' (recover on 'none')", set_config("llm_force_fail", "none"))
        st, body = fn_post(
            {
                "content": f"{PROBE} finished the report, drained 2",
                "capture": "chat",
                "windowTs": iso(w_turn),
                "client_message_id": bubble,
                "dev_force": {"eval_intervention": True},
            }
        )
        remember_doing(body)
        check(
            "recover: a normal forced intervention returns ok with a turn",
            st == 200 and isinstance(body, dict) and body.get("status") == "ok",
            f"{st} {body}",
        )
        check(
            "recover: the response is the five keys + the pair's ids",
            isinstance(body, dict) and set(body.keys()) == INTERVENTION_KEYS,
            f"{list((body or {}).keys())}",
        )
        check("recover: eval_ran is true", (body or {}).get("eval_ran") is True, f"{body}")
        check("recover: intervention is true", (body or {}).get("intervention") is True, f"{body}")
        check("recover: the parsed energy is echoed (2)", (body or {}).get("energy") == 2, f"{body}")
        turn_user_id = (body or {}).get("user_message_id")
        turn_reply_id = (body or {}).get("assistant_message_id")
        turn_doing_id = (body or {}).get("doing_id")
        if turn_user_id:
            turn_ids.append(turn_user_id)

        user_row, reply_row = turn_for_doing(uid, turn_doing_id)
        check(
            "the user row carries metadata.source='checkin' + the doing id (FR-9/FR-10)",
            user_row is not None
            and (user_row.get("metadata") or {}).get("source") == "checkin"
            and (user_row.get("metadata") or {}).get("doing_id") == turn_doing_id,
            f"{(user_row or {}).get('metadata')}",
        )
        check(
            "the user row's content is the submitted text (the turn is a real turn)",
            user_row is not None and PROBE in str(user_row.get("content")),
            f"{(user_row or {}).get('content')}",
        )
        check(
            "the chat capture's client_message_id lands on the row (the bubble reconciles)",
            user_row is not None and user_row.get("client_message_id") == bubble,
            f"{(user_row or {}).get('client_message_id')}",
        )
        reply_meta = (reply_row or {}).get("metadata") or {}
        check(
            "the primary reply is anchored on the user row (§3.2)",
            reply_row is not None and reply_row.get("reply_to_message_id") == turn_user_id,
            f"{(reply_row or {}).get('reply_to_message_id')} vs {turn_user_id}",
        )
        check(
            "the reply's metadata is the pipeline block (source/route/persona/domain/rule_ids)",
            all(k in reply_meta for k in ("source", "route", "persona", "domain", "rule_ids")),
            f"{reply_meta}",
        )
        check(
            "the reply's metadata is source:'pipeline' (NOT 'checkin' -- FR-10 resolves it by anchor)",
            reply_meta.get("source") == "pipeline",
            f"{reply_meta.get('source')}",
        )
        check(
            "the reply points back at its user row (the §3.2 anchor pair)",
            reply_meta.get("user_message_id") == turn_user_id,
            f"{reply_meta.get('user_message_id')}",
        )
        check(
            "the response's ids are the rows' ids",
            turn_reply_id == (reply_row or {}).get("id") and turn_user_id == (user_row or {}).get("id"),
            f"{turn_reply_id} / {turn_user_id}",
        )

        # --- the replay: the same window answers with the SAME pair, writing nothing ---
        st, body = fn_post(
            {
                "content": f"{PROBE} replay with a shifted hint",
                "capture": "chat",
                "windowTs": iso(w_turn + datetime.timedelta(minutes=3)),
                "dev_force": {"eval_intervention": True},
            }
        )
        check(
            "replay: a shifted-hint replay of the window returns duplicate",
            st == 200 and isinstance(body, dict) and body.get("status") == "duplicate",
            f"{st} {body}",
        )
        check("replay: the duplicate returns the SAME doing_id", (body or {}).get("doing_id") == turn_doing_id, f"{body}")
        check(
            "replay: the duplicate reports the turn it already materialized (FR-9)",
            (body or {}).get("eval_ran") is True
            and (body or {}).get("intervention") is True
            and (body or {}).get("user_message_id") == turn_user_id
            and (body or {}).get("assistant_message_id") == turn_reply_id,
            f"{body}",
        )
        check(
            "replay: the duplicate's key set is the five + the pair's ids",
            isinstance(body, dict) and set(body.keys()) == INTERVENTION_KEYS,
            f"{list((body or {}).keys())}",
        )
        rows = messages_for(uid, f"metadata->>doing_id=eq.{turn_doing_id}")
        check("replay: no second user row was written", len(rows) == 1, f"{len(rows)}")

        # --- FR-9: the reply capture has no bubble, so a stray id is ignored ---
        stray = "99999999-8888-4777-8666-555555555555"
        st, body = fn_post(
            {
                "content": f"{PROBE} notification reply, drained 2",
                "capture": "reply",
                "windowTs": iso(w_capture),
                "client_message_id": stray,
                "dev_force": {"eval_intervention": True},
            }
        )
        check(
            "capture: the reply capture still intervenes",
            st == 200 and (body or {}).get("intervention") is True,
            f"{st} {body}",
        )
        cap_doing_id = remember_doing(body)
        if (body or {}).get("user_message_id"):
            turn_ids.append(body.get("user_message_id"))
        user_row, _reply = turn_for_doing(uid, cap_doing_id)
        check(
            "capture: a stray client_message_id is NOT written on the reply-capture row (FR-9)",
            user_row is not None and user_row.get("client_message_id") is None,
            f"{(user_row or {}).get('client_message_id')}",
        )

        # ---------------------------------------------------------------
        # 3. the late gate alone: no energy at all, a window answered hours ago
        # ---------------------------------------------------------------
        check("restore the real late gate (15 min)", set_config("checkin_late_minutes", REAL_LATE_MIN))
        late_age = (now_dt - (w_late + datetime.timedelta(minutes=GRID_CADENCE_MIN))).total_seconds() / 60.0
        info("the late probe's age past its close", f"{late_age:.0f} min")
        check("the late probe really is past the gate", late_age > REAL_LATE_MIN, f"{late_age:.0f} min")
        st, body = fn_post({"content": f"{PROBE} no score at all", "capture": "reply", "windowTs": iso(w_late)})
        remember_doing(body)
        check(
            "late gate: the eval ran on a window answered too long after its close",
            st == 200 and isinstance(body, dict) and (body or {}).get("eval_ran") is True,
            f"{st} {body}",
        )
        check("late gate: the energy is null (nothing else could have tripped)", (body or {}).get("energy") is None, f"{body}")
        check("late gate: the stub eval intervened on nothing", (body or {}).get("intervention") is False, f"{body}")
        check(
            "late gate: an on-track-after-eval check-in writes NO messages row (FR-9)",
            turn_for_doing(uid, (body or {}).get("doing_id"))[0] is None,
        )

        # ---------------------------------------------------------------
        # 4. the on-track leg (LAST: the log leg needs no provider call after it)
        # ---------------------------------------------------------------
        check("re-pin the late gate so the energy test is isolated", set_config("checkin_late_minutes", PINNED_LATE_MIN))
        st, body = fn_post(
            # The parse rule takes the TRAILING standalone 1-10 (`/\b(10|[1-9])\s*$/`), so the
            # text must end with the score -- "6 of 10" would parse as 10.
            {"content": f"{PROBE} finished the report, energy 6", "capture": "reply", "windowTs": iso(w_ontime)}
        )
        check(
            "on-track: a healthy energy returns ok",
            st == 200 and isinstance(body, dict) and body.get("status") == "ok",
            f"{st} {body}",
        )
        check(
            "on-track: the response is EXACTLY the frozen five keys (no turn, no ids)",
            isinstance(body, dict) and set(body.keys()) == RESPONSE_KEYS,
            f"{list((body or {}).keys())}",
        )
        check("on-track: eval_ran is false (no deterministic gate tripped)", (body or {}).get("eval_ran") is False, f"{body}")
        check("on-track: intervention is false", (body or {}).get("intervention") is False, f"{body}")
        check("on-track: the energy is parsed from the text (6)", (body or {}).get("energy") == 6, f"{body}")
        on_track_doing = remember_doing(body)
        global ONTIME_DOING_ID
        ONTIME_DOING_ID = on_track_doing
        save_run_manifest()
        check(
            "on-track: NO messages row was written for the doing (FR-9)",
            on_track_doing is not None and turn_for_doing(uid, on_track_doing)[0] is None,
        )

        # ---------------------------------------------------------------
        # 5. AC-4's real half: the §6.2 energy override in the REAL classifier
        # ---------------------------------------------------------------
        st, body = dev_smoke("pipeline", classifier="real", energy=2, text="drained, everything is heavy today")
        if st is None:
            print("  SKIP the AC-4 real half -- DEV_SMOKE_TOKEN is not set")
        elif st != 200 or not isinstance(body, dict):
            check("AC-4: dev-smoke's pipeline action answers 200", False, f"{st} {body}")
        else:
            route_info = body.get("routeInfo") or {}
            classification = route_info.get("classification") or {}
            check(
                "AC-4 (real half): the real classifier forced emotion 'exhausted' from energy 2",
                classification.get("emotion") == "exhausted",
                f"{classification}",
            )
            check(
                "AC-4 (real half): stage 2 really was the real classifier (the override is mode-independent)",
                route_info.get("classifierMode") == "real",
                f"{route_info.get('classifierMode')}",
            )
            if classification.get("emotion") is None:
                check(
                    "AC-4 (real half): the exemplar corpus is non-empty (a D7 block means it is not)",
                    False,
                    "seed it with the FP-03 step (`verify-fp03-step7.py`)",
                )

        info("probe doings", "degrade/turn/capture/late/on-track = " + str([str(x) for x in (deg_doing_id, turn_doing_id, cap_doing_id, on_track_doing)]))

    finally:
        # --- no residue: probe rows gone, every shared value restored ---
        for key, value in snapshots.items():
            if value is not None:
                check(f"restore `{key}`", set_config(key, value))

        rows = messages_for(uid, f"content=like.{PROBE}*&role=eq.user")
        ids = [r["id"] for r in rows]
        if ids:
            joined = ",".join(ids)
            st, _ = req("DELETE", f"/rest/v1/messages?reply_to_message_id=in.({joined})", key=SERVICE)
            check("probe replies cleaned up", st in (200, 204), f"{st}")
            st, _ = req("DELETE", f"/rest/v1/messages?id=in.({joined})", key=SERVICE)
            check("probe user rows cleaned up", st in (200, 204), f"{st}")
            st, _ = req("DELETE", f"/rest/v1/jobs?payload->>user_message_id=in.({joined})", key=SERVICE)
            check("probe retry jobs cleaned up", st in (200, 204), f"{st}")
        st, _ = req("DELETE", f"/rest/v1/doings_logs?content=like.{PROBE}*", key=SERVICE)
        check("probe doings cleaned up", st in (200, 204), f"{st}")
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
            st, _ = req(
                "PATCH",
                f"/rest/v1/profiles?id=eq.{uid}",
                {"latest_energy": original_latest_energy},
                key=SERVICE,
                headers={"Prefer": "return=minimal"},
            )
            check("latest_energy restored", st in (200, 204), f"{st}")


def log_chunks(text):
    """The message strings an export carries, in whatever shape it was produced.

    A raw stdout capture and a timestamp-prefixed copy are already message text. The Dashboard's
    own export is CSV: one quoted `event_message` field per row, with the quotes doubled and the
    line's trailing newline inside the field. Reading that through `csv` is what makes the JSON
    visible -- with every quote doubled, a brace scanner over the raw bytes never balances.
    """
    lines = text.splitlines()
    if lines and "," in lines[0] and "event_message" in lines[0]:
        try:
            rows = list(csv.reader(io.StringIO(text)))
        except Exception:  # noqa: BLE001
            return [text]
        if rows and "event_message" in rows[0]:
            idx = rows[0].index("event_message")
            return [row[idx] for row in rows[1:] if len(row) > idx]
    return [text]


def log_objects(text):
    """Every JSON object in a log export, however that export was produced.

    `logCall` emits bare JSON lines and `submit-checkin` prints its own; a hand-exported log may
    be the Dashboard CSV, timestamp-prefixed, or wrap each line in an entry whose `event_message`
    carries the line as an escaped string. All of those shapes yield the same objects here, so the
    counting below never depends on *how* the owner obtained the file.
    """

    def balanced(s):
        out = []
        i, n = 0, len(s)
        while i < n:
            if s[i] != "{":
                i += 1
                continue
            depth, in_str, esc, j = 0, False, False, i
            while j < n:
                c = s[j]
                if in_str:
                    if esc:
                        esc = False
                    elif c == "\\":
                        esc = True
                    elif c == '"':
                        in_str = False
                elif c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        out.append(s[i : j + 1])
                        break
                j += 1
            i = j + 1
        return out

    found = []
    for chunk in log_chunks(text):
        for piece in balanced(chunk):
            try:
                obj = json.loads(piece)
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(obj, dict):
                continue
            found.append(obj)
            for key in ("event_message", "msg", "message", "log"):
                inner = obj.get(key)
                if not isinstance(inner, str):
                    continue
                for sub in balanced(inner):
                    try:
                        sub_obj = json.loads(sub)
                    except Exception:  # noqa: BLE001
                        continue
                    if isinstance(sub_obj, dict):
                        found.append(sub_obj)
    return found


def manifest_path():
    """Where the live section remembers its probe ids (temp dir: a transient run artifact)."""
    return os.path.join(tempfile.gettempdir(), "fp04s3-last-run.json")


def save_run_manifest():
    """Remember this run's probe doings and on-track doing id.

    The Dashboard export can only be taken *after* the run ends, so the manifest is what lets
    `--static-only --logs <file>` replay the counting leg against that export without spending a
    second live run (which would put two runs' lines in the file and cost provider calls).
    """
    try:
        with open(manifest_path(), "w", encoding="utf-8") as fh:
            json.dump({"doings": sorted(RUN_DOING_IDS), "ontime": ONTIME_DOING_ID}, fh)
        info("run manifest", manifest_path())
    except Exception as e:  # noqa: BLE001
        info("run manifest", f"could not be written ({e}) -- --logs still works in this process")


def load_run_manifest():
    """Restore the previous live run's ids. False when there is nothing usable to restore."""
    global ONTIME_DOING_ID
    try:
        with open(manifest_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:  # noqa: BLE001
        return False
    doings = [str(d) for d in (data.get("doings") or [])]
    if not doings or not data.get("ontime"):
        return False
    RUN_DOING_IDS.update(doings)
    ONTIME_DOING_ID = str(data["ontime"])
    return True


def log_checks(path):
    """The call-count leg: one embed per stored doing plus one per intervention, and exactly one
    embed with no generate for the ungated on-track submit.

    Adapter lines are recognised by `provider` (only `logCall` emits it) and submit lines by
    `outcome` (only this function's own `log()` emits that), so the split needs no line order and
    survives any export wrapper. Submit lines are then filtered to **this run's** doings, so an
    export that also carries other invocations still counts this run correctly; the exact embed
    equality is only asserted when the export carries no foreign submit line (otherwise it is
    reported, and the inequality direction is still checked).
    """
    print("== C. log cross-check (--logs) ==")
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception as e:  # noqa: BLE001
        check(
            "log file readable (Dashboard -> Edge Functions -> submit-checkin -> Logs; save this "
            "run's window, then re-run `--static-only --logs <file>`)",
            False,
            str(e),
        )
        return

    objects = log_objects(text)
    blob = "\n".join(log_chunks(text))
    calls = [o for o in objects if "provider" in o and "latencyMs" in o and "ts" in o]
    parsed = [o for o in objects if "outcome" in o and "provider" not in o]
    ours = [p for p in parsed if str(p.get("doingId")) in RUN_DOING_IDS] if RUN_DOING_IDS else []
    foreign = [p for p in parsed if str(p.get("doingId")) not in RUN_DOING_IDS]
    embeds = [c for c in calls if c.get("requestId") == "embed"]
    generates = [c for c in calls if c.get("requestId") != "embed"]
    oks = [p for p in ours if p.get("outcome") == "ok"]
    # An intervention turn is an ordinary pipeline run, so `runPipeline`'s own stage-3 embed is a
    # *second* embed for that check-in. NFR-2's "1 embed per check-in" is the on-track count
    # ("full pipeline only on intervention"), so the identity is oks + intervention turns.
    interventions = [p for p in oks if p.get("intervention") is True]
    info(
        "log lines",
        f"json_objects={len(objects)} adapter_calls={len(calls)} embed={len(embeds)} "
        f"generate={len(generates)} run_submits={len(ours)} foreign_submits={len(foreign)} "
        f"submit_ok={len(oks)} interventions={len(interventions)}",
    )

    check("the log carries this run's submit lines", len(oks) >= 4, f"ok={len(oks)}")
    # A full export carries one of this run's submit lines per recorded doing plus the replay's
    # duplicate. With fewer the export is partial, and with foreign lines present the file is
    # broader than the run; either way the *exact* identity cannot be computed from the file, so it
    # is reported as a bound instead of failed -- a defect is only called a defect on complete
    # evidence.
    complete = len(ours) >= submit_lines_expected()
    expected = len(oks) + len(interventions)
    if complete and not foreign:
        check(
            "exactly one embed per stored doing, plus the pipeline's own embed per intervention (NFR-2)",
            len(embeds) == expected,
            f"embed={len(embeds)} != ok={len(oks)} + interventions={len(interventions)}",
        )
    else:
        why = (
            f"the export also carries {len(foreign)} submit line(s) from another run"
            if foreign
            else f"only {len(ours)} of this run's {submit_lines_expected()} submit lines are in the export"
        )
        info("note", f"{why}, so the embed count is only bounded below; export a window that covers the whole run for the exact form")
        check(
            "at least one embed per stored doing plus one per intervention (NFR-2, lower bound)",
            len(embeds) >= expected,
            f"embed={len(embeds)} < ok={len(oks)} + interventions={len(interventions)}",
        )
    check(
        "the intervention legs reached the pipeline (generates exist)",
        len(generates) >= 1,
        f"generate={len(generates)}",
    )

    # The on-track leg is the LAST the gate submits. Its own provider calls are the adapter calls
    # that fall between the *previous* leg's submit line and its own: the adapter lines carry no
    # request id, so submit lines are the only attribution available, and a call newer than our own
    # submit line cannot belong to us (the function logs, then returns).
    skipped = [p for p in ours if p.get("eval") == "skipped"]
    target = None
    if ONTIME_DOING_ID:
        target = next((p for p in skipped if str(p.get("doingId")) == ONTIME_DOING_ID), None)
    if target is None:
        check(
            "the log carries the on-track leg's submit line (matched by its doing id)",
            False,
            f"eval:'skipped' lines={len(skipped)}, on-time doing id={ONTIME_DOING_ID}",
        )
    else:
        tail = str(target.get("ts"))
        earlier = sorted(str(p.get("ts")) for p in ours if str(p.get("ts")) < tail)
        if not complete or not earlier:
            info(
                "note",
                f"only {len(ours)} of this run's {submit_lines_expected()} submit lines are in the "
                "export, so the on-track leg's own calls cannot be separated from an earlier leg's "
                "-- export a window that covers the whole run for this check",
            )
        else:
            lo = earlier[-1]
            window = [c for c in calls if lo < str(c.get("ts")) <= tail]
            win_embeds = [c for c in window if c.get("requestId") == "embed"]
            win_generates = [c for c in window if c.get("requestId") != "embed"]
            check(
                "the ungated submit issued exactly ONE embed and NO generate (energy 6, on-time)",
                len(win_embeds) == 1 and len(win_generates) == 0,
                f"embed={len(win_embeds)} generate={len(win_generates)} since {lo}",
            )

    # `sendPush` is silent when it *succeeds* -- it logs only the disabled, missing-config, no-token
    # and failure paths. The live section therefore pins `expo_push_enabled=false`, which turns
    # "the push block ran" into a deterministic log line (and keeps a gate run from pushing at a
    # real device). One per COMPLETED intervention turn: the degraded leg answers with the holding
    # reply instead, and the retry job's reply is the one that pushes.
    push_skips = len(re.findall(r"\[push\] expo_push_enabled=false, skipping", blob))
    if complete and not foreign:
        check(
            f"the push block ran once per completed intervention turn ({COMPLETED_TURNS}) and never "
            "for the degraded one (§7.10, FR-13)",
            push_skips == COMPLETED_TURNS,
            f"{push_skips} [push] line(s)",
        )
    else:
        check(
            "the push block ran for a completed intervention turn (§7.10, FR-13)",
            push_skips >= 1,
            f"{push_skips} [push] line(s)",
        )


def log_parser_self_test():
    """Section A's parser leg: the `--logs` counting must survive an export's shape.

    Synthetic exports (no network) in the shapes an owner can produce -- raw stdout lines, a
    timestamp-prefixed copy, the Dashboard's own CSV, an entry wrapping the line in
    `event_message` -- plus a foreign run in the same file, a truncated file and four injected
    defects (an extra generate inside the on-track window, a missing intervention embed, a missing
    push, a push for the degraded turn). The real leg is the one part of this gate that needs a
    hand-made artifact, so keeping its parser self-verified means a change that would misread the
    owner's log fails here instead.
    """

    PUSH = "[push] expo_push_enabled=false, skipping"

    def sub(ts, doing, outcome="ok", intervention=False, ev="skipped"):
        return "[submit-checkin] submit " + json.dumps(
            {
                "ts": ts,
                "capture": "reply",
                "latencyMs": 900,
                "energy": 2,
                "eval": ev,
                "intervention": intervention,
                "outcome": outcome,
                "doingId": doing,
            },
            separators=(",", ":"),
        )

    def call(ts, kind="embed"):
        return json.dumps(
            {"ts": ts, "provider": "stub", "model": "stub", "latencyMs": 0, "ok": True, "requestId": kind},
            separators=(",", ":"),
        )

    def at(minute, second):
        return f"2026-10-17T10:{minute:02d}:{second:02d}.000Z"

    def build(drop_late=False, extra_generate=False, foreign=False, drop_push=False, degrade_push=False):
        lines = []
        for minute, doing in ((0, "D1"), (1, "D2"), (2, "D3")):
            # An intervention leg: the doing's own embed, the pipeline's stage-3 embed, one generate.
            lines += [
                call(at(minute, 10)),
                call(at(minute, 11)),
                call(at(minute, 12), "generate"),
                sub(at(minute, 13), doing, intervention=True, ev="intervention"),
            ]
            # D1 is the degrade leg: its turn answered with the holding reply, so it pushed nothing.
            if doing == "D1":
                if degrade_push:
                    lines.append(PUSH)
            elif not drop_push:
                lines.append(PUSH)
        # The replay of D2's window: a duplicate line and no provider call at all.
        lines.append(sub(at(1, 20), "D2", outcome="duplicate", intervention=True, ev="intervention"))
        lines.append(call(at(3, 10)))  # the late leg: the eval ran, nothing intervened
        if not drop_late:
            lines.append(sub(at(3, 13), "D4", ev="on_track"))
        if extra_generate:
            lines.append(call(at(4, 5), "generate"))  # inside the on-track leg's own window
        lines += [call(at(4, 10)), sub(at(4, 13), "D5")]
        if foreign:
            lines += [call(at(5, 10)), sub(at(5, 13), "FOR1")]
        return lines

    def verdict(lines, shape):
        """`log_checks`' verdict for one synthetic export, leaving the gate's tally alone.

        Returns `(failure_count, detail)`; a crash in the leg counts as one failure with the
        exception as the detail, so section A reports it instead of aborting mid-run.
        """
        global ONTIME_DOING_ID
        path = os.path.join(tempfile.gettempdir(), "fp04s3-logdrill.log")
        with open(path, "w", encoding="utf-8", newline="") as fh:
            if shape == "csv":
                # The Dashboard's own export: one quoted `event_message` field per row, doubled
                # quotes, and the line's trailing newline inside the field.
                writer = csv.writer(fh)
                writer.writerow(["event_message", "event_type", "execution_id", "function_id", "id",
                                 "level", "timestamp"])
                for i, line in enumerate(lines):
                    writer.writerow([line + "\n", "Log", f"exec{i}", "fn", f"id{i}", "info",
                                     1792241529455000 + i])
                lines = []  # written already
            for line in lines:
                if shape == "raw":
                    fh.write(line + "\n")
                elif shape == "prefixed":
                    fh.write("2026-10-17T10:00:00.000Z " + line + "\n")
                elif shape != "csv":
                    fh.write(json.dumps({"event_message": line, "timestamp": "2026-10-17T10:00:00Z"}) + "\n")
        saved_failures = list(FAILURES)
        saved_doings = set(RUN_DOING_IDS)
        saved_ontime = ONTIME_DOING_ID
        del FAILURES[:]
        RUN_DOING_IDS.clear()
        RUN_DOING_IDS.update(("D1", "D2", "D3", "D4", "D5"))
        ONTIME_DOING_ID = "D5"
        detail = ""
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                log_checks(path)
            found = list(FAILURES)
            detail = "; ".join(found)
        except Exception as e:  # noqa: BLE001
            found = [f"raised {type(e).__name__}: {e}"]
            detail = found[0]
        finally:
            del FAILURES[:]
            FAILURES.extend(saved_failures)
            RUN_DOING_IDS.clear()
            RUN_DOING_IDS.update(saved_doings)
            ONTIME_DOING_ID = saved_ontime
        return len(found), detail

    cases = [
        ("a raw export", build(), "raw", 0),
        ("a timestamp-prefixed export", build(), "prefixed", 0),
        ("an export wrapping each line in `event_message`", build(), "wrapped", 0),
        ("the Dashboard CSV export", build(), "csv", 0),
        ("an export that also carries another run", build(foreign=True), "raw", 0),
        ("a truncated export (a bound, not a failure)", build(drop_late=True), "raw", 0),
        ("an extra generate in the on-track leg's window", build(extra_generate=True), "raw", 1),
        ("a missing intervention embed", [ln for ln in build() if ln != call(at(2, 11))], "raw", 1),
        ("a missing push for a completed turn", build(drop_push=True), "raw", 1),
        ("a push for the degraded turn", build(degrade_push=True), "raw", 1),
        ("a missing push, in the CSV shape", build(drop_push=True), "csv", 1),
    ]
    for label, lines, shape, expected in cases:
        got, detail = verdict(lines, shape)
        check(
            f"the `--logs` parser: {label} -> {expected} failure(s)",
            got == expected,
            f"{got} {detail}",
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--no-deno", action="store_true", help="skip `deno check`")
    ap.add_argument("--logs", help="an exported submit-checkin log file for the call-count legs")
    ap.add_argument("--run-step11", action="store_true",
                    help="also run scripts/verify-step11.py (the send-message regression harness)")
    ap.add_argument("--step11-turns", type=int, default=6,
                    help="turn count for --run-step11 (default 6, the plan's value)")
    ap.add_argument("--no-mint", action="store_true",
                    help="never mint a JWT; require DAVOS_USER_JWT to be valid as supplied")
    ap.add_argument("--email", help="user to mint for (default: DAVOS_USER_EMAIL, else inferred)")
    args = ap.parse_args()

    global NO_MINT, EMAIL
    NO_MINT = args.no_mint
    if args.email:
        EMAIL = args.email

    static_checks(run_deno=not args.no_deno, run_jest=args.run_jest)
    if not args.static_only:
        missing = [n for n, v in (
            ("SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)", URL),
            ("SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)", ANON),
            ("SUPABASE_SERVICE_ROLE_KEY", SERVICE),
        ) if not v]
        if missing:
            print("  SKIP live section -- need " + ", ".join(missing))
        else:
            live_checks(args.logs)
            # The log leg only parses a file, so it runs before the harness (which talks to the
            # network) purely to keep the printed order A -> B -> C -> D.
            if args.logs:
                log_checks(args.logs)
            else:
                print("== C. log cross-check (--logs) ==")
                print("  SKIP the call-count leg -- save this run's log from the Dashboard (Edge")
                print("       Functions -> submit-checkin -> Logs), then replay it without a second")
                print(f"       live run: `--static-only --logs <file>` (ids: {manifest_path()})")
            if args.run_step11:
                step11_checks(args.step11_turns)
    elif args.logs:
        # The export arrives after the run, so the counting leg is replayable on its own against
        # the ids the live section saved. Same code path, no second live run (no probe rows, no
        # provider calls, and only one run's lines in the file).
        if load_run_manifest():
            log_checks(args.logs)
        else:
            print("== C. log cross-check (--logs) ==")
            check(
                "the live run's probe ids are available for the counting leg",
                False,
                f"no manifest at {manifest_path()} -- run the gate's live section once first",
            )
    elif args.run_step11:
        print("  SKIP the regression harness -- --static-only")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 3 checks passed.")


if __name__ == "__main__":
    main()
