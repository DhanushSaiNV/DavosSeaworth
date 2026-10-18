#!/usr/bin/env python3
"""Automate FP-03 Step 5 verification (pipeline wiring: mode branch + embed await point).

Covers PLAN Step 5 Verify: `runPipeline` branches stage 2 on `config.classifier_mode`; the real
branch consumes the message embed (the same single embed stage 3 reuses) and degrades a failed
embed to the §6.4 D7 block instead of throwing, so the §4.1 sync-degrade hand-off still carries a
concrete `persona`/`domain` into the `llm_retry` payload; dev overrides apply post-classification
in both modes; one structured classify log line is emitted per real turn; and the rollback to
`'stub'` needs no redeploy.

  AUTOMATED -- static (no network):
    branch    : `runPipeline.ts` reads `classifier_mode` from `config` (never a literal mode),
                keeps the stub as the default/rollback, and imports `classifyReal`
    embed     : exactly one `await embedPromise`, placed *before* the classify branch; stage 3
                no longer awaits it a second time; stage 3 still throws with `context`
    fallback  : the real branch guards `embedResult.ok` and yields `D7Fallback()`, so stage 2
                stays non-fatal (§5.1, FR-12) and the decision survives into the throw
    overrides : `applyOverrides` is applied in the real branch only, and the stub keeps its own
                byte-for-byte `classify(text, overrides)` call (FP-02 drill parity)
    log       : exactly one `console.log` in `runPipeline.ts`, carrying the nine FR-17 fields and
                no `provider`/`requestId` (so verify-step11.py's log parse is unaffected)
    types     : `ClassifierMode` + the `energy`/`classifierMode` options + `routeInfo.classifierMode`
    smoke     : dev-smoke's `pipeline` action takes `classifier=` (validated) and `energy=`
    unit      : `classify.test.ts` covers `applyOverrides` (jest really discovers it)
    docs      : GLOSSARY §15 (`routeInfo.classifierMode` + the classify log line), TECH-SPEC §5.1
                (the stage-2 mode branch), the plan tracker
    types     : `deno check` over the five entry points + the pipeline sources (tsconfig excludes
                `supabase/functions`, so deno is the only type gate that reaches them)

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DEV_SMOKE_TOKEN, dev-smoke
  redeployed; the user JWT is minted if unset; snapshots and restores `classifier_mode`,
  `llm_stub_mode`, `llm_call_timeout_ms`,
  `llm_force_fail` in a `finally`):
    real      : with `classifier_mode='real'` a gym-flavoured text classifies away from the stub's
                `Career`, the route follows the live bands, and stage 3 retrieved the *decided*
                domain's rules (forced-domain probe)
    energy    : the orchestrator's energy plumbing forces `exhausted` at the configured floor
    routes    : the four-tier `dev_force` drill produces all four routes end-to-end (AC-10)
    rollback  : `classifier=stub` still yields the FP-02 stub block and the same four routes
    degrade   : with `llm_call_timeout_ms=1` the embed aborts as a transport failure -> holding
                reply with `metadata.route='degrade'` and a **non-null** `domain`, plus exactly
                one `llm_retry` job whose payload carries non-null `persona` and `domain`; after
                the timeout is restored the retry tick produces the real reply
    forcefail : `llm_force_fail='both'` degrades identically (the FP-02 behaviour, unchanged)
    empty     : with the corpus cleared, a real-mode turn still answers (`fallback` / `General` /
                a real reply, not a holding one) -- AC-5's pipeline half
    logs      : with `--logs <exported-log-file>`: one embed line per classify line, and every
                classify line carries the nine fields and no `requestId`

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp03-step5.py [--static-only] [--no-jest] [--no-retry] [--logs <file>]

PREREQUISITES: migration 0025 applied, the 228 placeholder exemplars seeded, and `dev-smoke` +
`send-message` deployed at current code. The live section temporarily flips `classifier_mode` to
`'real'` (the dark-ship default is `'stub'`) and restores it in a `finally`. `dev_overrides_enabled`
is read, never written.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fp03_corpus import PLACEHOLDER_SOURCE, seed_corpus  # noqa: E402

# Windows consoles/pipes are not UTF-8 by default and the tracker row carries ▶/✅ — never let
# a print abort the gate.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []

RUN_TS = "supabase/functions/_shared/pipeline/runPipeline.ts"
CLASSIFY_TS = "supabase/functions/_shared/pipeline/classify.ts"
CLASSIFY_REAL_TS = "supabase/functions/_shared/pipeline/classifyReal.ts"
CLASSIFY_TEST_TS = "supabase/functions/_shared/pipeline/classify.test.ts"
SMOKE_TS = "supabase/functions/dev-smoke/index.ts"
SEND_TS = "supabase/functions/send-message/index.ts"
SELECT_TS = "supabase/functions/select-persona/index.ts"
DISPATCH_TS = "supabase/functions/job-dispatcher/index.ts"
HEALTH_TS = "supabase/functions/health/index.ts"
TEST_REL_POSIX = "supabase/functions/_shared/pipeline/classify.test.ts"

ENTRY_POINTS = [SMOKE_TS, SEND_TS, SELECT_TS, DISPATCH_TS, HEALTH_TS]

LOG_FIELDS = [
    "ts",
    "stage",
    "mode",
    "domain",
    "emotion",
    "overall_conf",
    "quit_signal",
    "route",
    "latencyMs",
]
ROUTES = ("auto", "options", "low_question", "fallback")

# Snapshotted and restored around the live section.
SNAPSHOT_KEYS = ("classifier_mode", "llm_stub_mode", "llm_call_timeout_ms", "llm_force_fail")

EXPECTED_TOTAL = 228
REAL_PROBE = "I skipped the gym all week and my knees hurt when I squat."
OTHER_PROBE = "I checked my bank account and there is less in it than I thought."


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def info(label, value):
    print(f"  ..   {label}: {value}")


def skip(label, why):
    print(f"  SKIP {label} -- {why}")


def env(name, *alts):
    for k in (name,) + alts:
        if os.environ.get(k):
            return os.environ[k]
    return None


URL = (env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
ANON = env("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")
SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")
JWT = env("DAVOS_USER_JWT")
SMOKE_TOKEN = env("DEV_SMOKE_TOKEN")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def strip_ts_comments(text):
    """Drop // line comments so structural checks see code, not prose about the code."""
    return "\n".join(re.sub(r"//.*$", "", ln) for ln in text.splitlines())


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


def req(method, path, body=None, key=None, headers=None, timeout=140):
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
    st, rows = req("GET", f"/rest/v1/{path}", key=key, headers={"Accept": "application/json"})
    return (rows if st == 200 and isinstance(rows, list) else []), st


def get_config(key):
    rows, _ = rest(f"config?select=value&key=eq.{key}")
    return rows[0]["value"] if rows else None


def set_config(key, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"/functions/v1/dev-smoke?action={action}" + (f"&{q}" if q else "")
    st, b = req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"})
    return st, b


def pipeline(**params):
    st, body = dev_smoke("pipeline", **params)
    return st, (body if isinstance(body, dict) else {})


def send(content, dev=None):
    cid = str(uuid.uuid4())
    body = {
        "content": content,
        "client_message_id": cid,
        "client_sent_at": datetime.now(timezone.utc).isoformat(),
    }
    if dev:
        body["dev_force"] = dev
    st, b = req(
        "POST",
        "/functions/v1/send-message",
        body,
        key=ANON,
        headers={"Authorization": f"Bearer {JWT}"},
    )
    return st, (b if isinstance(b, dict) else {}), cid


def user_rows_by_cid(cid):
    rows, _ = rest(f"messages?select=id,role,content&client_message_id=eq.{urllib.parse.quote(cid)}")
    return rows


def assistant_rows(user_msg_id):
    path = (
        "messages?select=id,content,reply_to_message_id,secondary_reply_to_message_id,metadata,created_at"
        f"&metadata-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}&order=created_at"
    )
    rows, _ = rest(path)
    return rows


def jobs_for_turn(user_msg_id):
    path = (
        "jobs?select=id,type,status,attempts,last_error,payload,created_at"
        f"&payload-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}&order=created_at.desc&limit=5"
    )
    rows, _ = rest(path)
    return rows


def job_by_id(jid):
    rows, _ = rest(f"jobs?select=id,type,status,attempts,last_error,payload&id=eq.{jid}")
    return rows[0] if rows else None


def trigger_dispatcher():
    return req("POST", "/functions/v1/job-dispatcher", {}, key=SERVICE)


def fast_forward(jid):
    iso = datetime.now(timezone.utc).isoformat()
    st, _ = req("PATCH", f"/rest/v1/jobs?id=eq.{jid}", {"next_retry_at": iso}, key=SERVICE)
    return st


def wait_job_terminal(jid, timeout_s=180, accelerate=True):
    end = time.time() + timeout_s
    while time.time() < end:
        trigger_dispatcher()
        j = job_by_id(jid)
        if j and j["status"] in ("done", "dead"):
            return j
        if accelerate and j and j["status"] == "failed":
            fast_forward(jid)
        time.sleep(20)
    return job_by_id(jid)


def expected_route(conf, domain, emotion, bands):
    """Mirror `determinePersona` with zero band shift (dev-smoke passes no userId)."""
    if not domain or not emotion or conf < bands["low_low"]:
        return "fallback"
    if conf >= bands["high"]:
        return "auto"
    if conf >= bands["medium_low"]:
        return "options"
    return "low_question"


def exemplar_count():
    rows, st = rest("exemplars?select=id&limit=1000")
    return len(rows) if st == 200 else None, st


def placeholder_count():
    """(rows, status) for the placeholder subset -- the paced seed's short-circuit/resume point."""
    rows, st = rest(f"exemplars?source=eq.{PLACEHOLDER_SOURCE}&select=id&limit=1000")
    return len(rows) if st == 200 else None, st


def rule_domains():
    rows, _ = rest("rules?select=id,domain&limit=1000")
    return {r["id"]: r["domain"] for r in rows}


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks(no_jest=False):
    print("== A. static (no network) ==")

    src = read_text(RUN_TS)
    check("runPipeline.ts exists", src is not None, RUN_TS)
    if src is None:
        return
    code = strip_ts_comments(src)

    # --- the mode branch (FR-11): config decides, the stub is the rollback ---
    check(
        "reads classifier_mode from config",
        'getConfig("classifier_mode")' in code and "ClassifierMode" in code,
    )
    check(
        "only the exact string 'real' selects the real classifier",
        re.search(r'getConfig\("classifier_mode"\)[\s\S]{0,120}===\s*"real"', code) is not None,
    )
    check("imports the real classifier", re.search(r'from "\./classifyReal\.ts"', code) is not None)
    check("keeps the stub call for stub mode", "classify(text, overrides)" in code)

    # --- the embed await point moves; the failure semantics do not ---
    check(
        "exactly one `await embedPromise` (stage 3 no longer awaits it again)",
        code.count("await embedPromise") == 1,
        f"{code.count('await embedPromise')}",
    )
    check(
        "runPipeline still issues exactly one embed per turn",
        code.count("embed([text])") == 2,  # runPipeline + runLockedPersonaReply
        f"{code.count('embed([text])')}",
    )
    if "await embedPromise" in code and "classifyReal(" in code:
        check(
            "the embed is awaited before the classify branch",
            code.index("await embedPromise") < code.index("classifyReal("),
        )
    check(
        "the real branch degrades a failed embed to the D7 block (never throws at stage 2)",
        re.search(r'mode === "real".*?embedResult\.ok && embedResult\.data.*?D7Fallback\(\)', code, re.S)
        is not None,
    )
    check(
        "stage 3 still throws ProvidersUnavailableError carrying the resolved context",
        "throw new ProvidersUnavailableError(" in code and "context," in code,
    )
    check("imports D7Fallback + applyOverrides from the pure module", "D7Fallback," in code and "applyOverrides," in code)

    # --- dev overrides apply post-classification, real branch only (FR-14 / AC-10) ---
    check("applyOverrides is applied exactly once", code.count("applyOverrides(") == 1)
    check(
        "energy is threaded to the real classifier",
        "energy: opts.energy" in code and "energy?: number | null" in code,
    )

    # --- the FR-17 log line ---
    logs = re.findall(r"console\.log\(\s*JSON\.stringify\(\{(.*?)\}\),\s*\);", code, re.S)
    check("exactly one structured log line in runPipeline", len(logs) == 1, f"{len(logs)}")
    if len(logs) == 1:
        body = logs[0]
        # Shorthand properties (`mode,`) are legitimate — accept `key:` and `key,` alike.
        keys = re.findall(r"^\s*(\w+)\s*[:,]", body, re.M)
        check("the log line carries the nine FR-17 fields", keys == LOG_FIELDS, f"{keys}")
        check(
            "the log line has no provider/requestId (adapter log parse unaffected)",
            "requestId" not in body and "provider" not in body,
        )
        check('the log line is emitted for real classifications only', 'if (mode === "real")' in code)
        check('the log line records stage: "classify"', re.search(r'stage:\s*"classify"', body) is not None)
        check("the log line carries the decided route", re.search(r"route:\s*decision\.route", body) is not None)

    # --- routeInfo exposes the mode, and the stub stays byte-for-byte (classify.ts) ---
    check("routeInfo carries the classifier mode", "classifierMode: ClassifierMode" in code and "classifierMode: mode" in code)
    check("the options type accepts a dev mode override", "classifierMode?: ClassifierMode" in code)

    pure = read_text(CLASSIFY_TS)
    check("classify.ts exists", pure is not None, CLASSIFY_TS)
    if pure is not None:
        pcode = strip_ts_comments(pure)
        check("classify.ts exports applyOverrides", re.search(r"export function applyOverrides\(", pcode) is not None)
        check(
            "applyOverrides preserves the min invariant and leaves quit_signal alone",
            "overall_conf: Math.min(domain_conf, emotion_conf)" in pcode
            and "quit_signal: block.quit_signal" in pcode,
        )
        check("the stub is unchanged (rollback, FR-11)", "overrides.overall_conf ?? DEFAULT_CONF" in pcode)
        check(
            "classify.ts still has no value import (jest-loadable)",
            re.search(r"^\s*import\s+(?!type\b)", pcode, re.M) is None,
        )

    test = read_text(CLASSIFY_TEST_TS)
    check("classify.test.ts exists", test is not None, CLASSIFY_TEST_TS)
    if test is not None:
        tcode = strip_ts_comments(test)
        check("the test suite imports applyOverrides", "applyOverrides," in tcode)
        check('the test suite covers applyOverrides', 'describe("applyOverrides' in tcode)
        check(
            "the test suite imports only the pure module",
            re.search(r'from "\./classify\.ts"', tcode) is not None
            and "classifyReal" not in tcode
            and "../config" not in tcode,
        )

    # --- dev-smoke drills ---
    smoke = strip_ts_comments(read_text(SMOKE_TS) or "")
    check("dev-smoke's pipeline action accepts classifier=", 'searchParams.get("classifier")' in smoke)
    check("dev-smoke validates the classifier param", 'classifier must be real or stub' in smoke)
    check("dev-smoke passes the mode override to runPipeline", "classifierMode" in smoke)
    check("dev-smoke's pipeline action accepts energy=", 'searchParams.get("energy")' in smoke)

    # --- docs land in the same change ---
    gloss = read_text("docs/GLOSSARY.md") or ""
    route_row = [ln for ln in gloss.splitlines() if ln.startswith("| `routeInfo` |")]
    check(
        "GLOSSARY §15 routeInfo lists classifierMode",
        bool(route_row) and "classifierMode" in route_row[0],
        f"{route_row[:1]}",
    )
    check(
        "GLOSSARY §15 documents the classify log line",
        any(ln.startswith("| Classify log line |") for ln in gloss.splitlines()),
    )
    spec = read_text("docs/TECH-SPEC.md") or ""
    check(
        "TECH-SPEC §5.1 documents the stage-2 mode branch",
        "Stage-2 mode branch" in spec and "classifier_mode" in spec,
    )

    plan = read_text("docs/feature-prds/FP-03/FP-03-PLAN.md") or ""
    row = [ln for ln in plan.splitlines() if re.match(r"\|\s*5\s*\|", ln)]
    check(
        "plan tracker marks Step 5 (source-complete or done)",
        bool(row) and any(("▶" in ln or "✅" in ln) for ln in row),
        f"{row[:1]}",
    )

    # jest must really discover the suite (a mis-named file would never run).
    if no_jest:
        skip("jest discovers classify.test.ts", "--no-jest")
    elif shutil.which("npx") is None:
        skip("jest discovers classify.test.ts", "npx not on PATH")
    else:
        rc, out = run(["npx", "jest", "--ci", "--listTests"], timeout=300)
        listing = out.replace("\\", "/")
        if rc is None:
            skip("jest discovers classify.test.ts", f"could not run jest: {out.strip()[:120]}")
        else:
            check(
                "jest discovers classify.test.ts",
                rc == 0 and TEST_REL_POSIX in listing,
                f"rc={rc} listed={'yes' if TEST_REL_POSIX in listing else 'no'}",
            )

    # deno is the only type gate that reaches `supabase/functions` (tsconfig excludes it).
    if shutil.which("deno") is None:
        skip("deno check (entry points + pipeline sources)", "deno not on PATH")
    else:
        rc, out = run(
            ["deno", "check", *ENTRY_POINTS, RUN_TS, CLASSIFY_TS, CLASSIFY_REAL_TS, CLASSIFY_TEST_TS],
            timeout=900,
        )
        if rc is None:
            skip("deno check (entry points + pipeline sources)", f"could not run deno: {out.strip()[:120]}")
        else:
            check("deno check clean (entry points + pipeline sources)", rc == 0, out.strip()[-500:])


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


try:
    # Sibling helper (scripts/ is sys.path[0]): the one place this gate picks the user JWT it
    # sends. It prints the token (source, sub, exp, verdict) and never returns one already
    # decoded as expired -- it mints a fresh one instead (owner request, 2026-10-17). When it
    # cannot produce a usable token the gate skips its authenticated legs rather than sending a
    # dead one, which is what used to surface as a wall of unexplained 401s.
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001
    resolve_gate_token = None


def live_checks(args):
    print("== B. live (needs env; dev-smoke + send-message redeployed) ==")
    global JWT
    if resolve_gate_token is not None:
        JWT, jwt_usable, _note = resolve_gate_token(JWT, URL, SERVICE, os.environ.get("DAVOS_USER_EMAIL"))
    else:
        print("  JWT   note   : _mint_dev_jwt.py unavailable -- using $DAVOS_USER_JWT as supplied")
        jwt_usable = bool(JWT)
    if not jwt_usable:
        print("  FAIL no usable DAVOS_USER_JWT -- refresh it or run `python scripts/_mint_dev_jwt.py`")
        FAILURES.append("no usable user JWT")
        print("  SKIP remaining live checks")
        return

    if not SMOKE_TOKEN:
        skip("live section", "need DEV_SMOKE_TOKEN")
        return

    snapshots = {k: get_config(k) for k in SNAPSHOT_KEYS}
    info("config snapshot", snapshots)
    missing = [k for k, v in snapshots.items() if v is None]
    if missing:
        check("the config keys the drill snapshots are readable", False, f"missing {missing}")
        return

    bands = get_config("confidence_bands")
    if not isinstance(bands, dict) or not all(k in bands for k in ("high", "medium_low", "low_low", "fallback")):
        check("confidence_bands is readable", False, f"{bands}")
        return
    info("confidence_bands", {k: bands[k] for k in ("high", "medium_low", "low_low", "fallback")})
    floor = get_config("energy_exhausted_max")
    info("energy_exhausted_max", floor)

    domains_by_rule = rule_domains()
    corpus_seeded = False

    try:
        # --- real mode -------------------------------------------------------
        set_config("llm_stub_mode", False)
        set_config("classifier_mode", "real")

        st, body = pipeline(text=REAL_PROBE, classifier="real")
        ri = body.get("routeInfo") or {}
        block = ri.get("classification") or {}
        info("real pipeline probe", f"{st} mode={body.get('classifierMode')} route={ri.get('route')} block={block}")
        check("pipeline (real) returns 200", st == 200, f"{st} {body}")
        check("the turn records classifierMode='real'", body.get("classifierMode") == "real", f"{body.get('classifierMode')}")
        check(
            "a non-Career probe classifies away from the stub default",
            block.get("domain") is not None and block.get("domain") != "Career",
            f"{block.get('domain')}",
        )
        check(
            "the route follows the live confidence bands",
            ri.get("route") == expected_route(
                ri.get("overallConf"), ri.get("domain"), block.get("emotion"), bands
            ),
            f"route={ri.get('route')} conf={ri.get('overallConf')} domain={ri.get('domain')} emotion={block.get('emotion')}",
        )
        check("the route is one of the four", ri.get("route") in ROUTES, f"{ri.get('route')}")
        ids = ri.get("ruleIds") or []
        if ids:
            got_domains = sorted({domains_by_rule.get(rid, "?") for rid in ids})
            check(
                "every retrieved rule belongs to the decided domain",
                got_domains == [ri.get("domain")],
                f"{got_domains} vs {ri.get('domain')}",
            )
        else:
            info("retrieved rules", "0 (the decided domain may hold no seeded rules)")

        # Forced domain → the decided domain's rules must come back (stage 3 hand-off).
        st, body = pipeline(text=REAL_PROBE, classifier="real", force="high", domain="Fitness")
        ri = body.get("routeInfo") or {}
        ids = ri.get("ruleIds") or []
        info("forced-domain probe", f"route={ri.get('route')} domain={ri.get('domain')} rules={len(ids)}")
        check(
            "a forced Fitness domain retrieves Fitness rules",
            st == 200
            and ri.get("domain") == "Fitness"
            and len(ids) > 0
            and all(domains_by_rule.get(rid) == "Fitness" for rid in ids),
            f"domain={ri.get('domain')} rules={[domains_by_rule.get(r) for r in ids]}",
        )

        # --- energy plumbing (the orchestrator's own path, §6.1) --------------
        if floor is not None:
            st, body = pipeline(text=REAL_PROBE, classifier="real", energy=floor)
            got = ((body.get("routeInfo") or {}).get("classification") or {}).get("emotion")
            check(
                f"energy={floor} (the configured floor) forces exhausted through the orchestrator",
                st == 200 and got == "exhausted",
                f"{got}",
            )

        # --- the four-route drill, real mode (AC-10 live half) ----------------
        for tier, want in (
            ("high", "auto"),
            ("medium", "options"),
            ("low", "low_question"),
            ("fallback", "fallback"),
        ):
            st, body = pipeline(text=REAL_PROBE, classifier="real", force=tier)
            ri = body.get("routeInfo") or {}
            info(f"real drill force={tier}", f"route={ri.get('route')} domain={ri.get('domain')}")
            check(
                f"real mode: dev_force {tier} produces the {want} route",
                st == 200 and ri.get("route") == want,
                f"{st} {ri.get('route')}",
            )

        # --- rollback: stub mode, no redeploy (AC-6) --------------------------
        st, body = pipeline(text=REAL_PROBE, classifier="stub")
        ri = body.get("routeInfo") or {}
        block = ri.get("classification") or {}
        check(
            "stub mode returns the FP-02 stub block unchanged",
            st == 200
            and body.get("classifierMode") == "stub"
            and block.get("domain") == "Career"
            and block.get("emotion") == "determined"
            and block.get("domain_conf") == 0.8,
            f"{st} {body.get('classifierMode')} {block}",
        )
        for tier, want in (
            ("high", "auto"),
            ("medium", "options"),
            ("low", "low_question"),
            ("fallback", "fallback"),
        ):
            st, body = pipeline(text=REAL_PROBE, classifier="stub", force=tier)
            got = (body.get("routeInfo") or {}).get("route")
            check(
                f"stub mode: dev_force {tier} still produces the {want} route",
                st == 200 and got == want,
                f"{st} {got}",
            )

        # --- a real turn through send-message with dev_force (AC-10 end-to-end)
        set_config("classifier_mode", "real")
        if get_config("dev_overrides_enabled") is True:
            st, body, cid = send(f"STEP5-FORCE {cid_suffix()}", dev={"tier": "high"})
            rows = user_rows_by_cid(cid)
            check("dev_force send ok", st == 200 and body.get("status") == "ok", f"{st} {body}")
            if rows:
                replies = assistant_rows(rows[0]["id"])
                primary = [r for r in replies if r.get("reply_to_message_id")]
                check(
                    "real mode: a dev_force high turn routes to auto",
                    bool(primary) and (primary[0].get("metadata") or {}).get("route") == "auto",
                    f"{(primary[0].get('metadata') or {}).get('route') if primary else None}",
                )
        else:
            skip("dev_force end-to-end turn", "dev_overrides_enabled is not true")

        # --- AC-5's pipeline half: empty corpus still answers -----------------
        st, _ = dev_smoke("clear-exemplars")
        check("clear-exemplars returns 200", st == 200, f"{st}")
        st, body, cid = send(f"STEP5-EMPTY {cid_suffix()}")
        rows = user_rows_by_cid(cid)
        check("empty-corpus send ok", st == 200 and body.get("status") == "ok", f"{st} {body}")
        if rows:
            replies = assistant_rows(rows[0]["id"])
            primary = [r for r in replies if r.get("reply_to_message_id")]
            meta = (primary[0].get("metadata") or {}) if primary else {}
            info("empty-corpus turn", f"route={meta.get('route')} domain={meta.get('domain')} source={meta.get('source')}")
            check(
                "an empty corpus still routes to the D7 fallback",
                meta.get("route") == "fallback" and meta.get("domain") == "General",
                f"{meta}",
            )
            check(
                "the empty-corpus turn still gets a real reply (not the holding one)",
                meta.get("source") == "pipeline" and bool(primary),
                f"{meta.get('source')}",
            )
        # Paced: the action seeds one 80-item window per call (Gemini counts every item against
        # the embedding quota, TECH-SPEC §12), so `seed_corpus` drives the loop ~65 s apart.
        st, _ = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)
        total, _ = exemplar_count()
        corpus_seeded = total == EXPECTED_TOTAL
        check("corpus restored (228 rows)", corpus_seeded, f"{total}")

        # --- THE embed-failure gate (the regression this step targets) --------
        if not set_config("llm_call_timeout_ms", 1):
            check("could set llm_call_timeout_ms=1", False, "config PATCH failed")
        else:
            st, body, cid = send(f"STEP5-EMBEDFAIL {cid_suffix()}")
            rows = user_rows_by_cid(cid)
            check("embed-failure send answered (no 500)", st == 200 and body.get("status") == "ok", f"{st} {body}")
            umid = rows[0]["id"] if rows else None
            if umid:
                replies = assistant_rows(umid)
                primary = [r for r in replies if r.get("reply_to_message_id")]
                meta = (primary[0].get("metadata") or {}) if primary else {}
                info("embed-failure holding reply", meta)
                check(
                    "the embed failure produces a holding reply (route='degrade')",
                    meta.get("route") == "degrade" and meta.get("source") == "sync_degrade",
                    f"{meta}",
                )
                check(
                    "the holding reply carries a NON-NULL domain (the hand-off is total)",
                    meta.get("domain") is not None and meta.get("domain") == "General",
                    f"{meta.get('domain')}",
                )
                jobs = [j for j in jobs_for_turn(umid) if j.get("type") == "llm_retry"]
                check("exactly one llm_retry job was enqueued", len(jobs) == 1, f"{len(jobs)}")
                if len(jobs) == 1:
                    payload = jobs[0].get("payload") or {}
                    info("llm_retry payload", payload)
                    check(
                        "the llm_retry payload carries non-null persona and domain",
                        payload.get("persona") is not None and payload.get("domain") is not None,
                        f"{payload}",
                    )
                    check(
                        "the retry payload records the D7 decision",
                        payload.get("persona") == "inquirer" and payload.get("domain") == "General",
                        f"{payload}",
                    )
                    if not args.no_retry:
                        ok = set_config("llm_call_timeout_ms", snapshots["llm_call_timeout_ms"])
                        print(f"  ..   llm_call_timeout_ms restored for the retry: {'ok' if ok else 'FAILED'}")
                        j = wait_job_terminal(jobs[0]["id"])
                        check(
                            "the retry job completes once the provider is reachable",
                            bool(j) and j.get("status") == "done",
                            f"{j.get('status') if j else None} {j.get('last_error') if j else ''}",
                        )
                        replies = assistant_rows(umid)
                        secondary = [
                            r for r in replies if r.get("secondary_reply_to_message_id") or (r.get("metadata") or {}).get("source") == "llm_retry"
                        ]
                        check(
                            "the retry produces the real reply",
                            bool(secondary),
                            f"{[ (r.get('metadata') or {}).get('source') for r in replies ]}",
                        )
                    else:
                        skip("the retry produces the real reply", "--no-retry")

        # --- llm_force_fail='both': the FP-02 degrade, unchanged --------------
        set_config("llm_force_fail", "both")
        st, body, cid = send(f"STEP5-FORCEFAIL {cid_suffix()}")
        rows = user_rows_by_cid(cid)
        if rows:
            umid = rows[0]["id"]
            replies = assistant_rows(umid)
            primary = [r for r in replies if r.get("reply_to_message_id")]
            meta = (primary[0].get("metadata") or {}) if primary else {}
            jobs = [j for j in jobs_for_turn(umid) if j.get("type") == "llm_retry"]
            check(
                "llm_force_fail='both' still degrades to a holding reply + one llm_retry job",
                st == 200
                and meta.get("route") == "degrade"
                and meta.get("domain") is not None
                and len(jobs) == 1
                and (jobs[0].get("payload") or {}).get("persona") is not None,
                f"{st} {meta} jobs={len(jobs)}",
            )
        set_config("llm_force_fail", "none")

        # --- logs (optional) --------------------------------------------------
        if args.logs:
            check_logs(args.logs)
        else:
            skip("one embed line per real turn", "pass --logs <exported-log-file>")

        # --- leave the project dark-shipped -----------------------------------
        check(
            "classifier_mode is restored to the dark-ship default",
            set_config("classifier_mode", snapshots["classifier_mode"]),
            f"{snapshots['classifier_mode']!r}",
        )
    finally:
        for k in SNAPSHOT_KEYS:
            if k == "classifier_mode":
                continue  # restored above (asserted); still restored here on an early abort
            ok = set_config(k, snapshots[k])
            print(f"  ..   {k} restored to {snapshots[k]!r}: {'ok' if ok else 'FAILED'}")
            if not ok:
                FAILURES.append(f"{k} restore")
        if not corpus_seeded:
            seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)


def check_logs(path):
    """`--logs` leg: one embed line per classify line, and the line's shape (FR-17)."""
    full = path if os.path.isabs(path) else os.path.join(ROOT, path)
    if not os.path.exists(full):
        check("log file exists", False, full)
        return
    embeds = 0
    classifies = 0
    bad = []
    with open(full, encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln.startswith("{"):
                continue
            try:
                obj = json.loads(ln)
            except Exception:  # noqa: BLE001
                continue
            if obj.get("requestId") == "embed":
                embeds += 1
            if obj.get("stage") == "classify":
                classifies += 1
                if "requestId" in obj or "provider" in obj:
                    bad.append("provider/requestId present")
                if obj.get("mode") != "real":
                    bad.append(f"mode={obj.get('mode')}")
                if sorted(obj.keys()) != sorted(LOG_FIELDS):
                    bad.append(f"keys={sorted(obj.keys())}")
    info("log lines", f"embed={embeds} classify={classifies}")
    check("the exported logs contain classify lines", classifies > 0, f"{classifies}")
    check(
        "one embed line per real classify line (no second embed)",
        embeds == classifies,
        f"embed={embeds} classify={classifies}",
    )
    check("every classify line has the nine FR-17 fields and no provider/requestId", not bad, f"{bad[:3]}")


def cid_suffix():
    return str(uuid.uuid4())[:8]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--no-jest", action="store_true", help="skip the jest --listTests leg")
    ap.add_argument("--no-retry", action="store_true", help="skip triggering the dispatcher for the retry leg")
    ap.add_argument("--logs", help="exported Edge Function log file (JSON lines) for the one-embed-per-turn leg")
    args = ap.parse_args()

    static_checks(no_jest=args.no_jest)
    if not args.static_only:
        if not all((URL, ANON, SERVICE)):
            skip(
                "live section",
                "need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY "
                "(the user JWT is minted automatically)",
            )
        else:
            live_checks(args)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 5 checks passed.")


if __name__ == "__main__":
    main()
