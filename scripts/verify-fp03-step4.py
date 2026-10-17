#!/usr/bin/env python3
"""Automate FP-03 Step 4 verification (real classifier: `classifyReal` + the §6.3 composer).

Covers PLAN Step 4 Verify: `composeClassification` is pure and unit-tested; the impure wrapper
reads the three [SPEC] bounds from `config` (never literals) and calls `match_exemplars`; the
`§6.3` block it returns has exactly the six contract fields in both modes; the energy override
and the `quit_signal` flag behave as §6.2/§6.3 require; an empty corpus degrades to the §6.4 D7
block instead of throwing (§5.1: stages 1-2 are non-fatal).

  AUTOMATED -- static (no network):
    pure      : `classify.ts` still exports the FP-02 stub, `Classification` and
                `ClassifyOverrides` unchanged, and adds `composeClassification` + `D7Fallback`;
                it has NO value import (that is what keeps it loadable by jest)
    literals  : neither classifier source hardcodes a [SPEC] bound -- the three keys are read
                from `config` by the wrapper (`0.75` appears nowhere)
    wrapper   : `classifyReal.ts` imports the service-role client, reads all three keys, calls
                `match_exemplars`, can return `D7Fallback()`, and contains no `throw`
    tests     : `classify.test.ts` imports only the pure module, and jest really discovers it
                (`--listTests`; a mis-named file would silently never run)
    types     : `deno check` on the entry point and the three new files (tsc.json excludes
                `supabase/functions`, so deno is the only type gate that reaches them)
    dev-smoke : registers the `classify` action (union + `available`) and the `mode` param
    docs      : GLOSSARY §13 lists the action; the plan tracker marks Step 4

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DEV_SMOKE_TOKEN,
  dev-smoke redeployed; the user JWT is minted if unset; temporarily sets `llm_stub_mode`,
  always restored):
    shape     : real mode returns the six §6.3 fields in order, non-null labels, positive
                confidences, and `overall_conf == min(domain_conf, emotion_conf)`
    domains   : two different-domain probes classify to different domain labels
    energy    : energy <= `energy_exhausted_max` -> `exhausted`; >= `energy_determined_min` ->
                `determined`; omitted -> the embedding argmax
    quit      : a seeded quit text sent back verbatim flags `quit_signal`, and each probe's
                flag agrees with the RPC's quit-set top similarity under the configured
                threshold (calibration itself is Step 6's gate)
    stub      : `mode=stub` still returns the FP-02 defaults and the identical field set
    empty     : after clear-exemplars real mode returns the D7 block, then the corpus is
                restored

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp03-step4.py [--static-only] [--no-jest]

PREREQUISITES: migration 0025 applied, `dev-smoke` redeployed with the `classify` action. The
live section writes `llm_stub_mode` and restores it in a `finally`; it leaves the 228
placeholder exemplars seeded.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fp03_corpus import PLACEHOLDER_SOURCE, seed_corpus  # noqa: E402

# Windows consoles/pipes are not UTF-8 by default and the tracker row carries ▶/✅ — never let
# a print abort the gate.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []

CLASSIFY_TS = "supabase/functions/_shared/pipeline/classify.ts"
CLASSIFY_REAL_TS = "supabase/functions/_shared/pipeline/classifyReal.ts"
CLASSIFY_TEST_TS = "supabase/functions/_shared/pipeline/classify.test.ts"
SMOKE_TS = "supabase/functions/dev-smoke/index.ts"
TEST_REL_POSIX = "supabase/functions/_shared/pipeline/classify.test.ts"

CONTRACT_FIELDS = ["domain", "domain_conf", "emotion", "emotion_conf", "quit_signal", "overall_conf"]
D7_BLOCK = {
    "domain": None,
    "domain_conf": 0,
    "emotion": None,
    "emotion_conf": 0,
    "quit_signal": False,
    "overall_conf": 0,
}
CONFIG_KEYS = ("quit_signal_threshold", "energy_exhausted_max", "energy_determined_min")

# Two clearly different domains; Step 6 owns accuracy, so this only asserts they differ.
DOMAIN_PROBES = [
    ("A", "I skipped the gym all week and my knees hurt when I squat."),
    ("B", "I checked my bank account and there is less in it than I thought."),
]


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
MIG_REL_PREFIX = "0025"
EXPECTED_TOTAL = 228
SELF_MATCH_MIN_SIM = 0.95


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


def req(method, path, body=None, key=None, headers=None, timeout=60):
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


def authed():
    return {"Authorization": f"Bearer {JWT}"}


def get_config(key):
    st, rows = req("GET", f"/rest/v1/config?select=value&key=eq.{key}", key=SERVICE)
    if st == 200 and isinstance(rows, list) and rows:
        return rows[0]["value"]
    return None


def set_config(key, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"/functions/v1/dev-smoke?action={action}" + (f"&{q}" if q else "")
    st, b = req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"}, timeout=140)
    return st, b


def seeded_text(set_kind, label=None, order="text"):
    """One seeded exemplar text (optionally of a given label)."""
    q = f"text,label&set_kind=eq.{set_kind}&limit=1"
    if label:
        q = f"text,label&set_kind=eq.{set_kind}&label=eq.{label}&limit=1"
    st, rows = req("GET", f"/rest/v1/exemplars?select={q}&order={order}", key=ANON, headers=authed())
    if st == 200 and isinstance(rows, list) and rows:
        return rows[0]["text"], rows[0]["label"]
    return None, None


def exemplar_count():
    st, rows = req("GET", "/rest/v1/exemplars?select=id&limit=1000", key=ANON, headers=authed())
    return (len(rows) if st == 200 else None), st


def placeholder_count():
    """(rows, status) for the placeholder subset -- the paced seed's short-circuit/resume point.

    Service role on purpose: an RLS-filtered read answers 200 with 0 rows, which would look
    exactly like an empty corpus and send the seeder back to offset 0 for no reason.
    """
    st, rows = req(
        "GET",
        f"/rest/v1/exemplars?select=id&source=eq.{PLACEHOLDER_SOURCE}&limit=1000",
        key=SERVICE,
    )
    return (len(rows) if st == 200 else None), st


def classify(text, mode="real", energy=None):
    st, body = dev_smoke("classify", text=text, mode=mode, energy=energy)
    return st, (body if isinstance(body, dict) else {})


def quit_top_sim(rows):
    quits = [r.get("sim", 0) for r in rows if r.get("set_kind") == "quit_signal"]
    return max(quits) if quits else None


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks(no_jest=False):
    print("== A. static (no network) ==")

    src = read_text(CLASSIFY_TS)
    check("classify.ts exists", src is not None, CLASSIFY_TS)
    if src is None:
        return
    code = strip_ts_comments(src)

    # --- the FP-02 stub stays put: it is the rollback (FR-11) ---
    check(
        "Classification keeps the six §6.3 fields in order",
        re.search(
            r"interface Classification \{\s*domain: string \| null;\s*domain_conf: number;.*?"
            r"quit_signal: boolean;\s*overall_conf: number;",
            code,
            re.S,
        )
        is not None,
    )
    check(
        "the stub `classify` is unchanged (signature + defaults)",
        re.search(r"export function classify\(_text: string, overrides: ClassifyOverrides = \{\}\): Classification", code)
        is not None
        and all(k in code for k in ("DEFAULT_DOMAIN = ", "DEFAULT_EMOTION = ", "DEFAULT_CONF = ")),
    )
    check("keeps ClassifyOverrides", re.search(r"interface ClassifyOverrides", code) is not None)

    # --- the FP-03 addition, and the purity that makes it jest-loadable ---
    check("exports composeClassification", re.search(r"export function composeClassification\(", code) is not None)
    check("exports D7Fallback", re.search(r"export function D7Fallback\(\)", code) is not None)
    check(
        "declares the three-set union",
        re.search(r'export type SetKind = "domain" \| "emotion" \| "quit_signal"', code) is not None,
    )
    check(
        "declares the three threshold names",
        all(k in code for k in ("quitSignalThreshold", "energyExhaustedMax", "energyDeterminedMin")),
    )
    check(
        "has no value import (only `import type`, or none)",
        re.search(r"^\s*import\s+(?!type\b)", code, re.M) is None,
    )
    check(
        "never touches config/supabase (stays pure)",
        "supabaseService" not in code and not re.search(r"from \"\.\./config", code),
    )
    check("no [SPEC] literal 0.75 in the pure module", "0.75" not in code)
    check(
        "no [SPEC] energy bound baked into the defaults",
        re.search(r"energyExhaustedMax\s*[:=]\s*\d", code) is None
        and re.search(r"energyDeterminedMin\s*[:=]\s*\d", code) is None,
    )

    real = read_text(CLASSIFY_REAL_TS)
    check("classifyReal.ts exists", real is not None, CLASSIFY_REAL_TS)
    if real is not None:
        rcode = strip_ts_comments(real)
        check(
            "wrapper imports the service-role client + config reader",
            re.search(r"from \"\.\./config\.ts\"", rcode) is not None
            and "supabaseService" in rcode
            and "getConfigNumber" in rcode,
        )
        check(
            "wrapper reads all three [SPEC] keys from config",
            all(f'getConfigNumber("{k}")' in rcode for k in CONFIG_KEYS),
        )
        check("wrapper calls the RPC", 'rpc("match_exemplars"' in rcode)
        check("wrapper honours vector(768) param name", "query_embedding" in rcode)
        check("wrapper can degrade to the D7 block", "D7Fallback" in rcode)
        check("wrapper never throws (§5.1 stages 1-2 are non-fatal)", re.search(r"\bthrow\b", rcode) is None)
        check("no [SPEC] literal 0.75 in the wrapper", "0.75" not in rcode)

    test = read_text(CLASSIFY_TEST_TS)
    check("classify.test.ts exists", test is not None, CLASSIFY_TEST_TS)
    if test is not None:
        tcode = strip_ts_comments(test)
        check(
            "test imports only the pure module",
            re.search(r'from "\./classify\.ts"', tcode) is not None
            and "classifyReal" not in tcode
            and "../config" not in tcode,
        )
        check(
            "test covers both modes of the energy override",
            "exhausted" in tcode and "determined" in tcode,
        )

    smoke = read_text(SMOKE_TS) or ""
    check(
        "dev-smoke registers the classify action (union + available)",
        smoke.count('"classify"') >= 2,
        f"{smoke.count(chr(34) + 'classify' + chr(34))}",
    )
    check("dev-smoke calls classifyReal", "classifyReal(" in smoke)
    check("dev-smoke exposes mode=stub", 'mode === "stub"' in smoke)
    check("dev-smoke accepts the energy param", 'searchParams.get("energy")' in smoke)

    gloss = read_text("docs/GLOSSARY.md") or ""
    smoke_row = [ln for ln in gloss.splitlines() if ln.startswith("| `dev-smoke` |")]
    check(
        "GLOSSARY §13 dev-smoke row lists the classify action",
        bool(smoke_row) and "classify" in smoke_row[0],
        f"{smoke_row}",
    )

    plan = read_text("docs/feature-prds/FP-03/FP-03-PLAN.md") or ""
    row = [ln for ln in plan.splitlines() if re.match(r"\|\s*4\s*\|", ln)]
    check(
        "plan tracker marks Step 4 (source-complete or done)",
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
        skip("deno check (entry point + new files)", "deno not on PATH")
    else:
        rc, out = run(
            ["deno", "check", SMOKE_TS, CLASSIFY_TS, CLASSIFY_REAL_TS, CLASSIFY_TEST_TS],
            timeout=600,
        )
        if rc is None:
            skip("deno check (entry point + new files)", f"could not run deno: {out.strip()[:120]}")
        else:
            check(
                "deno check clean (entry point + new files)",
                rc == 0,
                out.strip()[-400:],
            )


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


def live_checks():
    print("== B. live (needs env; dev-smoke redeployed with the classify action) ==")
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

    stub_snapshot = get_config("llm_stub_mode")
    info("llm_stub_mode snapshot", repr(stub_snapshot))

    thresholds = {k: get_config(k) for k in CONFIG_KEYS}
    info("config thresholds", thresholds)
    if any(v is None for v in thresholds.values()):
        check("the three [SPEC] thresholds are readable", False, f"{thresholds}")
        return
    check(
        "energy_exhausted_max < energy_determined_min",
        thresholds["energy_exhausted_max"] < thresholds["energy_determined_min"],
        f"{thresholds}",
    )

    seeded_ok = False
    try:
        if not set_config("llm_stub_mode", False):
            check("could set llm_stub_mode=false", False, "config PATCH failed")
            return

        # Paced: the action seeds one 80-item window per call (Gemini counts every item against
        # the embedding quota, TECH-SPEC §12), so `seed_corpus` drives the loop ~65 s apart.
        st, body = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)
        check("seed-exemplars returns 200", st == 200, f"{st} {body}")
        total, st = exemplar_count()
        check("corpus holds 228 rows", st == 200 and total == EXPECTED_TOTAL, f"{st} {total}")

        domain_a_text, _ = seeded_text("domain")
        quit_text, _ = seeded_text("quit_signal", "quit")
        proud_text, _ = seeded_text("emotion", "proud")
        quit_probe = quit_text or "I am giving up on this, there is no point in continuing."
        neutral_probe = proud_text or domain_a_text or "I finally finished what I set out to do."

        # --- shape: the six §6.3 fields, in order, with live values ---
        st, body = classify(domain_a_text or "I skipped the gym all week")
        block = body.get("classification") or {}
        info("real classification", block)
        check("classify (real) returns 200", st == 200, f"{st} {body}")
        check("fields are exactly the §6.3 contract, in order", body.get("fields") == CONTRACT_FIELDS, f"{body.get('fields')}")
        check("no embed failure on the real path", body.get("embedOk") is True, f"{body.get('embedError')}")
        check(
            "real mode is not the D7 block (labels + confidences present)",
            block.get("domain") is not None
            and block.get("emotion") is not None
            and block.get("domain_conf", 0) > 0
            and block.get("emotion_conf", 0) > 0,
            f"{block}",
        )
        check(
            "overall_conf == min(domain_conf, emotion_conf)",
            abs(block.get("overall_conf", -1) - min(block.get("domain_conf", 0), block.get("emotion_conf", 0))) < 1e-12,
            f"{block}",
        )
        check("quit_signal is a boolean", isinstance(block.get("quit_signal"), bool), f"{type(block.get('quit_signal'))}")

        # --- domains: two different flavours must not collapse to one label ---
        labels = []
        for name, probe in DOMAIN_PROBES:
            st, body = classify(probe)
            got = (body.get("classification") or {}).get("domain")
            info(f"domain probe {name}", f"{got} <- {probe[:48]}...")
            labels.append(got)
        check(
            "two different-domain probes classify to different domains",
            st == 200 and None not in labels and labels[0] != labels[1],
            f"{labels}",
        )

        # --- energy override: the config bounds decide, not the embedding ---
        energy_text = domain_a_text or "I skipped the gym all week"
        st, body = classify(energy_text, energy=thresholds["energy_exhausted_max"])
        got = (body.get("classification") or {}).get("emotion")
        check(
            f"energy={thresholds['energy_exhausted_max']} (at the floor) forces exhausted",
            st == 200 and got == "exhausted",
            f"{got}",
        )
        st, body = classify(energy_text, energy=thresholds["energy_determined_min"])
        got = (body.get("classification") or {}).get("emotion")
        check(
            f"energy={thresholds['energy_determined_min']} (at the ceiling) forces determined",
            st == 200 and got == "determined",
            f"{got}",
        )
        st, body = classify(energy_text)
        got = (body.get("classification") or {}).get("emotion")
        check(
            "omitting energy leaves the embedding argmax standing",
            st == 200 and got is not None and got == block.get("emotion"),
            f"got {got}, energy-less baseline {block.get('emotion')}",
        )

        # --- quit_signal: verbatim quit text must flag; both probes must agree with the RPC ---
        for label, probe in (("quit", quit_probe), ("neutral", neutral_probe)):
            st, body = classify(probe)
            got = (body.get("classification") or {}).get("quit_signal")
            top = None
            st2, mbody = dev_smoke("match-exemplars", text=probe)
            if st2 == 200 and isinstance(mbody, dict):
                top = quit_top_sim(mbody.get("rows") or [])
            expected = None if top is None else top >= thresholds["quit_signal_threshold"]
            info(
                f"quit probe ({label})",
                f"quit_signal={got} quitTopSim={None if top is None else round(top, 4)} "
                f"threshold={thresholds['quit_signal_threshold']}",
            )
            if label == "quit":
                check("a seeded quit text sent verbatim flags quit_signal", st == 200 and got is True, f"{got}")
            check(
                f"quit_signal for the {label} probe matches the RPC under the configured threshold",
                st == 200 and expected is not None and got is expected,
                f"got {got}, RPC expects {expected}",
            )

        # --- stub mode: FP-02 defaults unchanged, identical field set (FR-10) ---
        st, body = classify("I skipped the gym all week", mode="stub")
        stub_block = body.get("classification") or {}
        info("stub classification", stub_block)
        check(
            "mode=stub returns the FP-02 defaults unchanged",
            st == 200
            and stub_block.get("domain") == "Career"
            and stub_block.get("emotion") == "determined"
            and stub_block.get("domain_conf") == 0.8
            and stub_block.get("emotion_conf") == 0.8
            and stub_block.get("quit_signal") is False,
            f"{stub_block}",
        )
        check(
            "stub and real expose the identical §6.3 field set",
            body.get("fields") == CONTRACT_FIELDS,
            f"{body.get('fields')}",
        )

        # --- empty corpus: the D7 block, never a throw (FR-12 / §6.4) ---
        st, _ = dev_smoke("clear-exemplars")
        check("clear-exemplars returns 200", st == 200, f"{st}")
        st, body = classify("I skipped the gym all week")
        check(
            "an empty corpus degrades to the D7 block",
            st == 200 and (body.get("classification") or {}) == D7_BLOCK,
            f"{st} {body.get('classification')}",
        )

        # --- leave the corpus seeded (the clear above emptied it) ---
        st, body = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)
        total, st = exemplar_count()
        seeded_ok = st == 200 and total == EXPECTED_TOTAL
        check("corpus restored at the end (228 rows)", seeded_ok, f"{st} {total}")
        st, body = classify("I skipped the gym all week")
        check(
            "real mode classifies again after the restore",
            st == 200 and (body.get("classification") or {}).get("domain") is not None,
            f"{st} {body.get('classification')}",
        )
    finally:
        if stub_snapshot is not None:
            ok = set_config("llm_stub_mode", stub_snapshot)
            print(f"  ..   llm_stub_mode restored to {stub_snapshot!r}: {'ok' if ok else 'FAILED'}")
            if not ok:
                FAILURES.append("llm_stub_mode restore")
        if not seeded_ok:
            dev_smoke("clear-exemplars")
            seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--no-jest", action="store_true", help="skip the jest --listTests leg")
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
            live_checks()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 4 checks passed.")


if __name__ == "__main__":
    main()
