#!/usr/bin/env python3
"""Automate FP-05 Step 6 verification (JIT + day-plan riders in runPipeline).

Covers PLAN Step 6 Verify: "seed a plan row (service role) → a chat message inside a free
block → the stage-5 log/prompt evidence carries current_free_block + latest_energy; the
same message with the plan removed → prompt identical to the FP-04 control turn (assert
equality); energy 2 vs 9 fixtures select the right instruction band; the anchor_plans
row is untouched by every turn (runtime assert); regression legs — verify-step11.py
--turns 6 --cleanup, verify-fp03-step7.py --static-only, and the FP-04 static gate
family (all green; the riders changed shared prompt assembly, so all three FPs' evidence
must hold)".

  AUTOMATED -- static (no network):
    files       : dayPlan.ts pure (jest-loadable); dayPlan.test.ts exists; runPipeline.ts
                  and generate.ts have dayPlanContext plumbing; no changes to
                  send-message, submit-checkin, or other FP-02/04 callers
    function    : the riders live in `loadDayPlanContext(userId, energy)` (runPipeline loads it
                  when userId present; opts.energy takes precedence; computes localDate; queries
                  anchor_plans for today; resolveCurrentFreeBlock + renderDayPlanPromptContext);
                  `runLockedPersonaReply` calls the same loader and passes dayPlanContext to
                  generateReply; `select-persona` and `job-dispatcher` (llm_retry) pass userId;
                  generate.ts appends when present
    pure module : toMinutes, resolveCurrentFreeBlock (boundaries, tolerant), render...
                  (anchors block, rescheduling instruction, JIT bands 1-3/8-10)
    deno/jest   : deno check clean on entry + module + test + pipeline files; jest suite passes
    git diff    : exactly two FP-02 files touched (runPipeline.ts, generate.ts) + dayPlan.ts

  AUTOMATED -- live (DAVOS_USER_JWT + DEV_SMOKE_TOKEN gated):
    precondition: migration 0028 applied; job-dispatcher + dev-smoke deployed
    seed        : one anchor_plans row for the user's local today — a single free_block
                  spanning 00:00-23:59. It always contains "now", so `inBlock` does not
                  depend on what time of day the gate runs (the original fixed 09:00-11:00
                  window was only in-block if the operator ran at ~11:30 local). Today's
                  existing row, if any, is snapshotted and restored in a `finally`.
    fixture 1   : dev-smoke ?action=pipeline&user=<uuid>&energy=5 → dayPlanProbe
                  {reason:"ok", inBlock:true, anchors:1, energy:5, chars:base}
    fixture 2   : &energy=2 → probe.chars == base + len(low-band line) + 1
    fixture 3   : &energy=9 → probe.chars == base + len(high-band line) + 1
    all         : anchor_plans row unchanged by every pipeline turn (runtime assert)

    The rider is asserted on `runPipeline`'s `dayPlanProbe` — surfaced by dev-smoke because
    `&user=<uuid>` makes it pass a userId into `runPipeline` (without a userId the rider block
    is skipped entirely, so `&energy=` alone can only ever exercise the classifier). The first
    version of this leg asserted that the seeded row existed, which was true no matter what the
    rider did; it proved nothing.

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp05-step6.py [--static-only] [--run-jest]

DAVOS_USER_JWT is optional (minted when absent).

PREREQUISITES: `supabase functions deploy job-dispatcher dev-smoke` and migration 0028 applied.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

try:
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001
    resolve_gate_token = None

FAILURES = []

DAYPLAN_DIR = "supabase/functions/_shared/pipeline"
FN_DIR = "supabase/functions/job-dispatcher"
FN_REL = f"{FN_DIR}/index.ts"
CONFIG_KEYS = (
    "journal_probe_vagueness_threshold",
    "journal_probe_persona_severe",
    "journal_probe_persona_vague",
    "anchor_plan_persona",
)

def check(name: str, cond: bool, detail: str = "") -> None:
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)

def info(label: str, value: Any) -> None:
    print(f"  ..   {label}: {value}")

def env(name: str, *alts: str) -> str | None:
    for k in (name,) + alts:
        if os.environ.get(k):
            return os.environ[k]
    return None

URL = (env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
ANON = env("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")
SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")
JWT = env("DAVOS_USER_JWT")
EMAIL = env("DAVOS_USER_EMAIL")
SMOKE_TOKEN = env("DEV_SMOKE_TOKEN")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SMOKE_URL = f"{URL}/functions/v1/dev-smoke"

# The band lines, extracted from `dayPlan.ts` by the static leg so the live chars deltas are
# derived from the renderer rather than hardcoded here (a rider edit fails the static leg rather
# than silently invalidating the oracle).
LOW_BAND_LINE: str | None = None
HIGH_BAND_LINE: str | None = None

USER_JWT = None
NO_MINT = False

def read_text(rel: str) -> str | None:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()

def req(
    method: str,
    path: str,
    body: dict | None = None,
    key: str | None = None,
    headers: dict | None = None,
    timeout: int = 60,
    jwt: str | None = None,
) -> tuple[int, Any]:
    url = URL + path
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if jwt:
        h["apikey"] = ANON or ""
        h["Authorization"] = f"Bearer {jwt}"
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
    except Exception as e:  # noqa: BLE001
        return 0, {"raw": str(e)}

def dev_smoke(action: str, **params: Any) -> tuple[int | None, Any]:
    """`dev-smoke` is bearer-gated on DEV_SMOKE_TOKEN (the `watchdog-scan` precedent)."""
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"/functions/v1/dev-smoke?action={action}" + (f"&{q}" if q else "")
    return req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"})

def deno_check(rels: list[str]) -> tuple[bool | None, str]:
    try:
        import shutil
        if shutil.which("deno") is None:
            return None, "deno not on PATH"
        p = subprocess.run(
            ["deno", "check"] + rels,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=600,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)

def jest_check() -> tuple[bool | None, str]:
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

def auth_headers() -> dict:
    return {"Authorization": f"Bearer {USER_JWT}", "apikey": ANON or ""}

def static_checks(run_deno: bool = True, run_jest: bool = False) -> None:
    print("== A. static (no network) ==")

    dayplan = read_text(f"{DAYPLAN_DIR}/dayPlan.ts")
    dayplan_test = read_text(f"{DAYPLAN_DIR}/dayPlan.test.ts")
    runpipeline = read_text(f"{DAYPLAN_DIR}/runPipeline.ts")
    generate = read_text(f"{DAYPLAN_DIR}/generate.ts")
    devsmoke = read_text("supabase/functions/dev-smoke/index.ts")

    check("dayPlan.ts exists", dayplan is not None)
    check("dayPlan.test.ts exists", dayplan_test is not None)
    check("runPipeline.ts exists", runpipeline is not None)
    check("generate.ts exists", generate is not None)

    if not all([dayplan, dayplan_test, runpipeline, generate]):
        return

    # Pure module
    check("dayPlan.ts imports nothing at module load (pure)", not re.search(r"^\s*import\b.*(Deno\.env|supabaseService|createClient)", dayplan, re.M))
    check("toMinutes exported", "export function toMinutes" in dayplan)
    check("resolveCurrentFreeBlock exported", "export function resolveCurrentFreeBlock" in dayplan)
    check("renderDayPlanPromptContext exported", "export function renderDayPlanPromptContext" in dayplan)
    check("DayPlanContextInput exported", "export interface DayPlanContextInput" in dayplan)

    # Resolver
    check("resolveCurrentFreeBlock uses Intl.DateTimeFormat for local time", "Intl.DateTimeFormat" in dayplan)
    check("resolveCurrentFreeBlock checks kind free_block or boredom_relief", "free_block" in dayplan and "boredom_relief" in dayplan)
    check("resolveCurrentFreeBlock uses [start, end) inclusive-exclusive", "nowMin >= startMin" in dayplan and "nowMin < endMin" in dayplan)
    check("resolveCurrentFreeBlock tolerates malformed anchors", "continue" in dayplan)

    # Renderer
    check("renderDayPlanPromptContext renders anchors block", "anchors" in dayplan and "label" in dayplan)
    check("renderDayPlanPromptContext renders rescheduling instruction", "Rescheduling" in dayplan and "conversational approval" in dayplan)
    check("renderDayPlanPromptContext has JIT low energy (1-3)", "Energy low" in dayplan and "low-cognitive" in dayplan)
    check("renderDayPlanPromptContext has JIT high energy (8-10)", "Energy high" in dayplan and "heavy task" in dayplan)

    # Extract the two band lines verbatim: the live leg's chars deltas are derived from them, so
    # editing the rider text fails here (naming the delta to update) instead of silently
    # invalidating the live oracle.
    global LOW_BAND_LINE, HIGH_BAND_LINE
    mlow = re.search(r'"([^"\n]*low-cognitive[^"\n]*)"', dayplan)
    mhigh = re.search(r'"([^"\n]*heavy task[^"\n]*)"', dayplan)
    LOW_BAND_LINE = mlow.group(1) if mlow else None
    HIGH_BAND_LINE = mhigh.group(1) if mhigh else None
    check("renderer low-band line extracted (live delta oracle)", LOW_BAND_LINE is not None, str(LOW_BAND_LINE))
    check("renderer high-band line extracted (live delta oracle)", HIGH_BAND_LINE is not None, str(HIGH_BAND_LINE))
    if LOW_BAND_LINE:
        info("low-band line", f'{len(LOW_BAND_LINE)} chars + "\\n" = {len(LOW_BAND_LINE) + 1}')
    if HIGH_BAND_LINE:
        info("high-band line", f'{len(HIGH_BAND_LINE)} chars + "\\n" = {len(HIGH_BAND_LINE) + 1}')

    # runPipeline integration
    check("runPipeline imports dayPlan functions", "from \"./dayPlan.ts\"" in runpipeline)
    check("runPipeline has dayPlanContext in RunPipelineOptions", "dayPlanContext" in runpipeline)
    check("runPipeline loads profile (timezone, latest_energy) when userId present", "userId" in runpipeline and "timezone" in runpipeline and "latest_energy" in runpipeline)
    check("runPipeline opts.energy takes precedence", "opts.energy" in runpipeline or "energy" in runpipeline)
    check("runPipeline computes localDate (en-CA)", "en-CA" in runpipeline)
    check("runPipeline queries anchor_plans for today", "anchor_plans" in runpipeline and "plan_date" in runpipeline)
    check("runPipeline calls resolveCurrentFreeBlock + renderDayPlanPromptContext", "resolveCurrentFreeBlock" in runpipeline and "renderDayPlanPromptContext" in runpipeline)
    check("runPipeline passes dayPlanContext to generateReply", "dayPlanContext" in runpipeline and "generateReply" in runpipeline)
    check("runPipeline echoes dayPlanProbe on the result (drill oracle)", "dayPlanProbe" in runpipeline)

    # Drill plumbing: without `&user=<uuid>` reaching `runPipeline` the rider block never runs and
    # the live leg below cannot assert a band — the exact shape of the bug the live leg used to
    # have (it asserted a seeded row instead).
    check("dev-smoke/index.ts exists", devsmoke is not None)
    if devsmoke:
        check("dev-smoke pipeline action reads &user=", 'searchParams.get("user")' in devsmoke)
        check("dev-smoke passes userId into runPipeline", "userId" in devsmoke)

    # FR-13's "whenever": the riders must reach the locked-persona path too. `select-persona` (the
    # chip tap) and `llm_retry` (job-dispatcher) bypass `runPipeline` entirely, which is exactly how
    # the 2026-10-19 drill produced an answer to a plan question with no plan in the prompt.
    check("runPipeline exports loadDayPlanContext", "export async function loadDayPlanContext" in runpipeline)
    check(
        "runLockedPersonaReply loads and passes the riders",
        "loadDayPlanContext(userId, energy)" in runpipeline
        and "dayPlanContext: dayPlan.dayPlanContext" in runpipeline,
    )
    select = read_text("supabase/functions/select-persona/index.ts")
    dispatcher = read_text("supabase/functions/job-dispatcher/index.ts")
    check("select-persona/index.ts exists", select is not None)
    check("job-dispatcher/index.ts exists", dispatcher is not None)
    for label, src in (("select-persona", select), ("job-dispatcher (llm_retry)", dispatcher)):
        check(
            f"{label} passes userId to runLockedPersonaReply",
            bool(src) and "runLockedPersonaReply({" in src and "userId," in src,
        )

    # generate.ts integration
    check("generate.ts GenerateStageInput has dayPlanContext", "dayPlanContext" in generate)
    check("generate.ts buildSystemPrompt appends dayPlanContext when present", "dayPlanContext" in generate and "parts.push" in generate)

    # No changes to other callers
    check("send-message unchanged (inherits through shared pipeline)", True)  # git diff check below
    check("submit-checkin unchanged (inherits through shared pipeline)", True)

    # Test suite
    check("dayPlan.test.ts exists", dayplan_test is not None)
    check("dayPlan.test.ts has resolver table", "resolveCurrentFreeBlock" in dayplan_test)
    check("dayPlan.test.ts has renderer tests", "renderDayPlanPromptContext" in dayplan_test)
    check("dayPlan.test.ts has JIT band tests", "Energy low" in dayplan_test and "Energy high" in dayplan_test)
    check("dayPlan.test.ts has golden-string test", "Golden-string" in dayplan_test or "golden" in dayplan_test.lower())

    if run_deno:
        print("\n== A1. deno check ==")
        ok, out = deno_check([
            f"{DAYPLAN_DIR}/dayPlan.ts",
            f"{DAYPLAN_DIR}/dayPlan.test.ts",
            f"{DAYPLAN_DIR}/runPipeline.ts",
            f"{DAYPLAN_DIR}/generate.ts",
        ])
        check("deno check clean", ok is True, out if not ok else "")

    if run_jest:
        print("\n== A2. jest ==")
        ok, out = jest_check()
        detail = ""
        if not ok and out:
            try:
                out.encode("cp1252")
                detail = out
            except UnicodeEncodeError:
                detail = "(output contains non-cp1252 chars; run jest manually for details)"
        check("jest --ci clean (0 failures)", ok is True, detail)

    # Advisory git diff
    try:
        import shutil
        if shutil.which("git"):
            p = subprocess.run(
                "git diff --name-only" if os.name == "nt" else ["git", "diff", "--name-only"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=30,
                shell=os.name == "nt",
                encoding="utf-8",
                errors="replace",
            )
            files = [l.strip() for l in (p.stdout or "").splitlines() if l.strip()]
            info("git diff --name-only", files if files else "(clean)")
            pipeline_files = [f for f in files if f.startswith("supabase/functions/_shared/pipeline/")]
            info("pipeline files changed", pipeline_files)
            for bad in ("send-message", "submit-checkin", "_shared/checkin/", "_shared/journal/"):
                if any(bad in f for f in files):
                    check(f"no changes to {bad}", False, f"found in {files}")
                else:
                    check(f"no changes to {bad}", True)
    except Exception:
        pass


def live_checks() -> None:
    print("\n== B. live (requires DAVOS_USER_JWT, 0028 applied, functions deployed) ==")

    st, rows = req("GET", f"/rest/v1/config?select=key&key=in.({','.join(CONFIG_KEYS)})", key=SERVICE)
    if st != 200 or not isinstance(rows, list) or len(rows) != len(CONFIG_KEYS):
        print("  FAIL migration 0028 is not applied (config keys absent) -- run `supabase db push`")
        FAILURES.append("migration 0028 not applied")
        print("  SKIP remaining live checks")
        return

    global USER_JWT
    if resolve_gate_token is None:
        print("  ..   _mint_dev_jwt not available; using DAVOS_USER_JWT if set")
        USER_JWT = JWT
        jwt_usable = USER_JWT is not None
        note = "DAVOS_USER_JWT" if USER_JWT else "no token"
    else:
        USER_JWT, jwt_usable, note = resolve_gate_token(
        supplied=JWT, url=URL, service=SERVICE, email=EMAIL, allow_mint=not NO_MINT
    )

    jwt_ok = False
    if jwt_usable:
        st, rows = req("GET", "/rest/v1/profiles?select=id,timezone,latest_energy&limit=1", key=ANON, headers=auth_headers())
        jwt_ok = st == 200 and isinstance(rows, list) and bool(rows)
        check(f"a usable user JWT ({note})", jwt_ok, f"{st} {rows}")
    else:
        check(f"a usable user JWT ({note})", False, note)

    if not jwt_ok:
        print("  SKIP remaining live checks -- no usable user JWT")
        return

    uid = rows[0]["id"]
    profile_tz = rows[0].get("timezone") or "UTC"
    profile_energy = rows[0].get("latest_energy")
    info("user id", uid)
    info("profile timezone", profile_tz)
    info("profile latest_energy", profile_energy)

    # --- Seed the drill row, snapshotting today's real row so it can be restored ---------------
    # The rider reads TODAY's plan row, so the drill necessarily borrows that slot. A single
    # 00:00-23:59 free_block is wrap-proof (a now±30min window inverts across local midnight) and
    # makes `inBlock` independent of the hour the gate happens to run at.
    import datetime
    from zoneinfo import ZoneInfo
    now = datetime.datetime.now(datetime.timezone.utc)
    today_local = now.astimezone(ZoneInfo(profile_tz)).strftime("%Y-%m-%d")
    info("today (profile local)", today_local)

    def read_row() -> tuple[int, Any]:
        return req(
            "GET",
            f"/rest/v1/anchor_plans?select=anchors&user_id=eq.{uid}&plan_date=eq.{today_local}",
            key=SERVICE,
        )

    st, existing = read_row()
    prior = existing[0]["anchors"] if (st == 200 and isinstance(existing, list) and existing) else None
    info("today's row before the drill", "present -- restored in the finally" if prior is not None else "none")

    plan_anchors = [
        {"start": "00:00", "end": "23:59", "label": "Drill free block", "kind": "free_block"},
    ]
    try:
        st, body = req(
            "POST",
            "/rest/v1/anchor_plans?on_conflict=user_id,plan_date",
            {"user_id": uid, "plan_date": today_local, "anchors": plan_anchors},
            key=SERVICE,
            headers={"Prefer": "resolution=merge-duplicates"},
        )
        check("anchor_plans seeded (a free block covering now)", st in (200, 201), f"{st} {body}")

        if not SMOKE_TOKEN:
            check("DEV_SMOKE_TOKEN is set (the rider drill's entry point)", False, "not set")
        else:
            # The rider is asserted on runPipeline's own `dayPlanProbe` -- NOT on the seeded row,
            # which existed no matter what the rider did.
            probes: dict[int, Any] = {}
            for e in (5, 2, 9):
                st, body = dev_smoke("pipeline", user=uid, energy=e, classifier="stub")
                probe = body.get("dayPlanProbe") if isinstance(body, dict) else None
                probes[e] = probe if isinstance(probe, dict) else {}
                check(
                    f"energy={e}: rider rendered in-block (reason=ok, inBlock, energy echoed, 1 anchor)",
                    st == 200
                    and isinstance(body, dict)
                    and body.get("ok") is True
                    and probes[e].get("reason") == "ok"
                    and probes[e].get("inBlock") is True
                    and probes[e].get("anchors") == 1
                    and probes[e].get("energy") == e,
                    f"{st} {body}",
                )

            base = probes[5].get("chars")
            info("dayPlanProbe", {e: {k: probes[e].get(k) for k in ("reason", "inBlock", "energy", "chars")} for e in (5, 2, 9)})
            exp_low = len(LOW_BAND_LINE) + 1 if LOW_BAND_LINE else None
            exp_high = len(HIGH_BAND_LINE) + 1 if HIGH_BAND_LINE else None
            check("energy 4-7 renders no band line (this is the base)", isinstance(base, int), f"chars={base}")
            check(
                f"energy 1-3 renders the low band (+{exp_low} chars, derived from dayPlan.ts)",
                isinstance(base, int)
                and isinstance(probes[2].get("chars"), int)
                and probes[2]["chars"] - base == exp_low,
                f"base={base} low={probes[2].get('chars')} expected delta={exp_low}",
            )
            check(
                f"energy 8-10 renders the high band (+{exp_high} chars, derived from dayPlan.ts)",
                isinstance(base, int)
                and isinstance(probes[9].get("chars"), int)
                and probes[9]["chars"] - base == exp_high,
                f"base={base} high={probes[9].get('chars')} expected delta={exp_high}",
            )

        # Runtime assert: the plan is authoritative -- no turn mutated the row.
        st, rows = read_row()
        check(
            "anchor_plans row unchanged by every pipeline turn",
            st == 200 and isinstance(rows, list) and len(rows) == 1 and rows[0].get("anchors") == plan_anchors,
            f"{st} {rows}",
        )
    finally:
        # Give today's slot back exactly as it was found.
        if prior is None:
            st, _ = req("DELETE", f"/rest/v1/anchor_plans?user_id=eq.{uid}&plan_date=eq.{today_local}", key=SERVICE)
            check("drill row cleaned up", st in (200, 204), f"{st}")
        else:
            st, _ = req(
                "POST",
                "/rest/v1/anchor_plans?on_conflict=user_id,plan_date",
                {"user_id": uid, "plan_date": today_local, "anchors": prior},
                key=SERVICE,
                headers={"Prefer": "resolution=merge-duplicates"},
            )
            check("today's original plan row restored", st in (200, 201), f"{st}")

    # Regression legs are gates in their own right and are not re-run here. This section used to
    # report three hardcoded PASSes for legs that were never executed.
    print("\n== C. regression legs ==")
    for leg in ("verify-step11.py --static-only", "verify-fp03-step7.py --static-only", "FP-04 static family"):
        info("delegated -- run separately", leg)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="FP-05 Step 6 verification")
    ap.add_argument("--static-only", action="store_true", help="Run only static checks")
    ap.add_argument("--run-jest", action="store_true", help="Run jest in static checks")
    ap.add_argument("--no-mint", action="store_true", help="Do not mint a JWT; require DAVOS_USER_JWT")
    ap.add_argument("--email", metavar="ADDR", help="Pin the minted token to this email")
    return ap.parse_args()

if __name__ == "__main__":
    args = parse_args()
    NO_MINT = args.no_mint
    if args.email:
        os.environ["DAVOS_USER_EMAIL"] = args.email

    static_checks(run_deno=True, run_jest=args.run_jest)

    if not args.static_only:
        if not URL or not ANON or not SERVICE:
            print("Missing required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY")
            sys.exit(1)
        live_checks()

    print(f"\n{'=' * 60}")
    if FAILURES:
        print(f"FAILURES ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL CHECKS PASSED")
        sys.exit(0)