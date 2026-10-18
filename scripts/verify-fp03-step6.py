#!/usr/bin/env python3
"""Automate FP-03 Step 6 verification (golden set + eval gate + calibration).

Covers PLAN Step 6 Verify: the 40-item golden set exists and is well-formed and disjoint from the
seeded exemplars; `dev-smoke ?action=eval-classifier` runs the real classifier over it; the gate
fails unless clear-domain accuracy >= 0.90 and energy-override compliance == 100%; the quit /
false-constraint confusion matrix, the tier distribution, the confidence histograms and the
energy subset's tier histogram are produced as calibration evidence; and a report with the
*proposed* `confidence_bands` is archived. Nothing is applied here -- the bands are shared with
the stub, so a move is a Step 7 (D4) decision.

  AUTOMATED -- static (no network):
    fixture  : `goldenSet.ts` exists, is stamped DRAFT/PLACEHOLDER (AGENTS.md §8.4), exports the
               five-case union, and parses to exactly 12 clear / 8 ambiguous / 8 energy / 6 quit
               / 6 false-constraint items with unique ids and the plan's `{id,text,case,expect}`
    expects  : each item's `expect` carries exactly the keys its case defines; the 12 clear
               domains are distinct; ambiguous pairs are two distinct labels; the energy bucket
               splits 4 low / 4 high and forces the matching emotion; quit labels match the case
    leakage  : no golden text appears in `placeholderExemplars.ts` (normalised, string level) --
               a leaked item would measure memorisation instead of generalisation
    notseeded: `GOLDEN_SET` is referenced by the eval action only, never by `seed-exemplars`
    action   : dev-smoke registers `eval-classifier` (union + available list), refuses to run
               under `llm_stub_mode`, issues exactly one batched `embed(texts)`, calls
               `classifyReal` + `determinePersona`, and returns the quit-set argmax (`quitTop`)
    unit     : `goldenSet.test.ts` exists and jest really discovers it
    docs     : GLOSSARY §13 (dev-smoke action list), TECH-SPEC §6.4, the plan tracker, and any
               already-archived `FP-03-GOLDEN-SET-*.md` report carries the required sections
    types    : `deno check` over the entry points + the fixture (tsconfig excludes
               `supabase/functions`, so deno is the only type gate that reaches them)

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DEV_SMOKE_TOKEN, dev-smoke redeployed;
  snapshots and restores `classifier_mode`, `llm_stub_mode`, `llm_force_fail` in a `finally`):
    guard    : with `llm_stub_mode=true` the action refuses (400), proving the eval can never
               silently measure stub vectors
    corpus   : the 228 placeholder exemplars are seeded (re-seeded if missing). This is a
               *precondition*, not a finding: an empty corpus degrades every item to the D7 block
               (`classifyReal` -> `exemplars_empty`), so a failed seed prints its response body and
               aborts the eval legs instead of reporting 0/12 accuracy as if it meant something
    eval     : one run -> the gates are recomputed from the per-item results and cross-checked
               against the action's own summary (a buggy aggregation cannot pass)
    gates    : clear-domain accuracy >= 0.90; energy-override compliance == 100%
    determinism : a second run returns identical per-item classifications (NFR-3)
    leakage  : no golden text is present in the seeded `exemplars` rows (live, normalised)
    report   : `docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<date>.md` is written with the gate
               results, the per-case table, the confusion matrix, the histograms and the proposed
               bands -- a proposal only; nothing is applied
    restore  : config restored to the snapshot (post-check)

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp03-step6.py [--static-only] [--no-jest] [--no-determinism]
                                      [--report <path>] [--no-report]

PREREQUISITES: migration 0025 applied, the 228 placeholder exemplars seeded, and `dev-smoke`
deployed at current code. The live section temporarily flips `llm_stub_mode` (restored in a
`finally`). `classifier_mode` is snapshotted but never changed -- the eval action calls
`classifyReal` directly and does not read the dark-ship switch.
"""

import argparse
import glob
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
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fp03_corpus import PLACEHOLDER_SOURCE, SEED_PACE_S, seed_corpus  # noqa: E402

# Windows consoles/pipes are not UTF-8 by default and the tracker row carries ▶/✅ — never let
# a print abort the gate.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []

GOLDEN_TS = "supabase/functions/_shared/dev/goldenSet.ts"
GOLDEN_TEST_TS = "supabase/functions/_shared/dev/goldenSet.test.ts"
PLACEHOLDER_TS = "supabase/functions/_shared/dev/placeholderExemplars.ts"
SMOKE_TS = "supabase/functions/dev-smoke/index.ts"
SEND_TS = "supabase/functions/send-message/index.ts"
SELECT_TS = "supabase/functions/select-persona/index.ts"
DISPATCH_TS = "supabase/functions/job-dispatcher/index.ts"
HEALTH_TS = "supabase/functions/health/index.ts"
GOLDEN_TEST_REL_POSIX = "supabase/functions/_shared/dev/goldenSet.test.ts"

ENTRY_POINTS = [SMOKE_TS, SEND_TS, SELECT_TS, DISPATCH_TS, HEALTH_TS]

REPORT_DIR = "docs/feature-prds/FP-03"
REPORT_PREFIX = "FP-03-GOLDEN-SET-"
REPORT_SECTIONS = [
    "## 1. Gate results",
    "## 2. Per-case results",
    "## 3. Quit-set confusion matrix",
    "## 4. Tier distribution and confidence histograms",
    "## 5. Energy subset",
    "## 6. Proposed confidence_bands",
    "## 7. Owner decisions",
]

CASES = {"clear": 12, "ambiguous": 8, "energy": 8, "quit": 6, "false_constraint": 6}
EXPECT_KEYS = {
    "clear": ["domain"],
    "ambiguous": ["domains"],
    "energy": ["emotion", "energy"],
    "quit": ["quit_label"],
    "false_constraint": ["quit_label"],
}
CLEAR_ACCURACY_GATE = 0.90
ENERGY_COMPLIANCE_GATE = 1.0
EXPECTED_TOTAL = 228
BAND_KEYS = ("high", "medium_low", "medium_high", "low_low", "low_high", "fallback")

# Snapshotted and restored around the live section.
SNAPSHOT_KEYS = ("classifier_mode", "llm_stub_mode", "llm_force_fail")

ITEM_RE = re.compile(
    r'\{\s*id:\s*"(?P<id>[^"]+)"\s*,\s*case:\s*"(?P<case>[a-z_]+)"\s*,\s*'
    r'text:\s*"(?P<text>(?:[^"\\]|\\.)*)"\s*,\s*'
    r'expect:\s*\{(?P<expect>[^}]*)\}\s*,\s*\}'
)


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


def eval_classifier():
    st, body = dev_smoke("eval-classifier")
    return st, (body if isinstance(body, dict) else {})


def eval_classifier_paced(attempts=4):
    """eval-classifier, waiting out a quota refusal.

    The gate costs 80 embedding units per run (2 x 40-item batches) and the seed's last window
    may still sit inside the same rolling minute, so a 429 here is pacing, not a broken eval.
    """
    st, body = eval_classifier()
    for i in range(attempts - 1):
        if st != 429:
            break
        info("embedding quota", f"429 -- waiting {SEED_PACE_S:.0f}s (attempt {i + 1}/{attempts})")
        time.sleep(SEED_PACE_S)
        st, body = eval_classifier()
    return st, body


def placeholder_count():
    """(rows, status) for the placeholder subset -- the paced seed's short-circuit/resume point."""
    rows, st = rest(f"exemplars?source=eq.{PLACEHOLDER_SOURCE}&select=id&limit=1000")
    return (len(rows) if st == 200 else None), st


def exemplar_texts():
    rows, _ = rest("exemplars?select=text&limit=1000")
    return [r["text"] for r in rows if isinstance(r.get("text"), str)]


def norm(text):
    t = text.lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def percentile(values, p):
    if not values:
        return None
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def expected_route(conf, domain, emotion, bands):
    """Mirror `determinePersona` with zero band shift (dev-smoke passes no userId)."""
    if not domain or not emotion or conf < bands["low_low"]:
        return "fallback"
    if conf >= bands["high"]:
        return "auto"
    if conf >= bands["medium_low"]:
        return "options"
    return "low_question"


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def parse_golden(src):
    """Parse the fixture's items straight from source (the module cannot be imported)."""
    items = []
    for m in ITEM_RE.finditer(src):
        body = m.group("expect")
        keys = sorted(re.findall(r"(\w+)\s*:", body))
        items.append(
            {
                "id": m.group("id"),
                "case": m.group("case"),
                "text": m.group("text"),
                "expect_body": body,
                "keys": keys,
            }
        )
    return items


def static_checks(no_jest=False):
    print("== A. static (no network) ==")

    src = read_text(GOLDEN_TS)
    check("goldenSet.ts exists", src is not None, GOLDEN_TS)
    if src is None:
        return
    code = strip_ts_comments(src)

    # --- provenance labelling (AGENTS.md §8.4) ---
    check(
        "the fixture is stamped DRAFT / PLACEHOLDER and cites AGENTS.md §8.4",
        "DRAFT / PLACEHOLDER" in src and "AGENTS.md §8.4" in src,
    )
    check(
        "the fixture is marked as never-seeded",
        "Never seeded" in src or "never seeded" in src,
    )
    check(
        "the fixture exports the five-case union and the source stamp",
        re.search(r'export type GoldenCase = "clear" \| "ambiguous" \| "energy" \| "quit" \| "false_constraint"', code)
        is not None
        and 'export const GOLDEN_SET_SOURCE = "GOLDEN-DRAFT"' in code,
    )
    check(
        "the fixture carries no [SPEC] band value (values live in config)",
        "confidence_bands" not in code and "quit_signal_threshold" not in code,
    )

    items = parse_golden(code)
    counts = {k: 0 for k in CASES}
    for it in items:
        if it["case"] in counts:
            counts[it["case"]] += 1
    check(
        "the fixture parses to exactly the plan's 40 items and per-case counts",
        len(items) == 40 and counts == CASES,
        f"n={len(items)} counts={counts}",
    )
    ids = [it["id"] for it in items]
    check("every golden id is unique and non-empty", len(set(ids)) == len(ids) and all(ids))
    check(
        "every item's expect carries exactly the keys its case defines",
        all(it["keys"] == EXPECT_KEYS.get(it["case"], []) for it in items),
        f"{[ (it['id'], it['keys']) for it in items if it['keys'] != EXPECT_KEYS.get(it['case'], []) ][:3]}",
    )

    clear_domains = re.findall(r'domain:\s*"([^"]+)"', "\n".join(
        it["expect_body"] for it in items if it["case"] == "clear"
    ))
    check(
        "the 12 clear items name 12 distinct domains",
        len(clear_domains) == 12 and len(set(clear_domains)) == 12,
        f"{sorted(set(clear_domains))}",
    )

    ambiguous_pairs = re.findall(r'domains:\s*\["([^"]+)",\s*"([^"]+)"\]', "\n".join(
        it["expect_body"] for it in items if it["case"] == "ambiguous"
    ))
    check(
        "every ambiguous item lists two distinct non-empty domains",
        len(ambiguous_pairs) == 8 and all(a and b and a != b for a, b in ambiguous_pairs),
        f"{ambiguous_pairs}",
    )

    energy_rows = []
    for it in items:
        if it["case"] != "energy":
            continue
        e = re.search(r"energy:\s*(\d+)", it["expect_body"])
        em = re.search(r'emotion:\s*"([^"]+)"', it["expect_body"])
        energy_rows.append((int(e.group(1)) if e else None, em.group(1) if em else None))
    low = [r for r in energy_rows if r[0] is not None and r[0] <= 3]
    high = [r for r in energy_rows if r[0] is not None and r[0] >= 8]
    check(
        "the energy bucket splits 4 low / 4 high and forces the matching emotion",
        len(energy_rows) == 8
        and len(low) == 4
        and len(high) == 4
        and all(r[1] == "exhausted" for r in low)
        and all(r[1] == "determined" for r in high),
        f"{energy_rows}",
    )

    quit_labels = re.findall(r'quit_label:\s*"([^"]+)"', "\n".join(
        it["expect_body"] for it in items if it["case"] in ("quit", "false_constraint")
    ))
    check(
        "every quit-set item labels itself quit / false_constraint (6 each)",
        quit_labels.count("quit") == 6 and quit_labels.count("false_constraint") == 6,
        f"{quit_labels}",
    )

    # --- leakage: static, string level, against the exemplar fixture ---
    placeholder = read_text(PLACEHOLDER_TS) or ""
    exemplar_strings = {norm(s) for s in re.findall(r'"((?:[^"\\]|\\.)*)"', placeholder)}
    leaked = [it["id"] for it in items if norm(it["text"]) in exemplar_strings]
    check(
        "no golden text appears in placeholderExemplars.ts (static leakage grep)",
        not leaked,
        f"leaked ids {leaked}",
    )

    # --- dev-smoke action wiring ---
    smoke_raw = read_text(SMOKE_TS) or ""
    smoke = strip_ts_comments(smoke_raw)
    check(
        "dev-smoke registers eval-classifier (union + available list)",
        smoke.count('"eval-classifier"') >= 2,
        f"occurrences={smoke.count('\"eval-classifier\"')}",
    )
    body_m = re.search(r'case "eval-classifier": \{(.*?)\n      \}\n', smoke, re.S)
    body = body_m.group(1) if body_m else ""
    embed_calls = len(re.findall(r"\bembed\(", body))
    check("the eval action refuses to run under llm_stub_mode", 'requires llm_stub_mode=false' in body)
    check(
        "the eval action issues exactly one batched embed",
        embed_calls == 1 and "await embed(texts)" in body,
        f"embed( calls={embed_calls}",
    )
    check(
        "the eval action runs the real path (classifyReal + determinePersona)",
        "classifyReal(" in body and "determinePersona(" in body,
    )
    check(
        "the eval action returns the quit-set argmax for the confusion matrix",
        "quitTop" in body and "topQuitMatch(rows)" in body,
    )
    check(
        "the quit-set argmax helper reads only the quit_signal rows",
        'raw.set_kind !== "quit_signal"' in smoke,
    )
    check(
        "the eval action returns a summary the gate can cross-check",
        "summarizeEval(results)" in body,
    )

    seed_m = re.search(r'case "seed-exemplars": \{(.*?)\n      \}\n', smoke, re.S)
    seed_body = seed_m.group(1) if seed_m else ""
    check(
        "the golden fixture is never seeded (GOLDEN_SET absent from seed-exemplars)",
        "GOLDEN_SET" not in seed_body and "goldenSet" not in seed_body,
    )

    test = read_text(GOLDEN_TEST_TS)
    check("goldenSet.test.ts exists", test is not None, GOLDEN_TEST_TS)
    if test is not None:
        tcode = strip_ts_comments(test)
        check(
            "the fixture suite imports only the fixture module",
            re.search(r'from "\./goldenSet\.ts"', tcode) is not None and "config.ts" not in tcode,
        )
        check(
            "the fixture suite asserts the plan's per-case counts",
            "clear: 12" in tcode and "false_constraint: 6" in tcode,
        )

    # --- docs land in the same change ---
    gloss = read_text("docs/GLOSSARY.md") or ""
    gloss_n = re.sub(r"[ \t]+", " ", gloss)  # table-padding tolerant
    smoke_row = [ln for ln in gloss_n.splitlines() if ln.startswith("| `dev-smoke` |")]
    check(
        "GLOSSARY §13 lists eval-classifier in the dev-smoke action registry",
        bool(smoke_row) and "eval-classifier" in smoke_row[0],
        f"{smoke_row[:1]}",
    )
    spec = read_text("docs/TECH-SPEC.md") or ""
    check(
        "TECH-SPEC §6.4 points at the golden-set gate and its report",
        "golden set" in spec.lower() and "FP-03-GOLDEN-SET-" in spec,
    )
    plan = read_text("docs/feature-prds/FP-03/FP-03-PLAN.md") or ""
    row = [ln for ln in plan.splitlines() if re.match(r"\|\s*6\s*\|", ln)]
    check(
        "plan tracker marks Step 6 (source-complete or done)",
        bool(row) and any(("▶" in ln or "✅" in ln) for ln in row),
        f"{row[:1]}",
    )

    # Any already-archived report must still carry the required evidence sections.
    archived = sorted(glob.glob(os.path.join(ROOT, REPORT_DIR, REPORT_PREFIX + "*.md")))
    if archived:
        bad = []
        for path in archived:
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            missing = [s for s in REPORT_SECTIONS if s not in text]
            if missing:
                bad.append((os.path.basename(path), missing))
        check("every archived report carries the required sections", not bad, f"{bad[:2]}")
    else:
        skip("archived report sections", "no report archived yet (the live leg writes one)")

    # jest must really discover the fixture suite.
    if no_jest:
        skip("jest discovers goldenSet.test.ts", "--no-jest")
    elif shutil.which("npx") is None:
        skip("jest discovers goldenSet.test.ts", "npx not on PATH")
    else:
        rc, out = run(["npx", "jest", "--ci", "--listTests"], timeout=300)
        listing = out.replace("\\", "/")
        if rc is None:
            skip("jest discovers goldenSet.test.ts", f"could not run jest: {out.strip()[:120]}")
        else:
            check(
                "jest discovers goldenSet.test.ts",
                rc == 0 and GOLDEN_TEST_REL_POSIX in listing,
                f"rc={rc} listed={'yes' if GOLDEN_TEST_REL_POSIX in listing else 'no'}",
            )

    # deno is the only type gate that reaches `supabase/functions` (tsconfig excludes it).
    if shutil.which("deno") is None:
        skip("deno check (entry points + golden fixture)", "deno not on PATH")
    else:
        rc, out = run(
            ["deno", "check", *ENTRY_POINTS, GOLDEN_TS, GOLDEN_TEST_TS],
            timeout=900,
        )
        if rc is None:
            skip("deno check (entry points + golden fixture)", f"could not run deno: {out.strip()[:120]}")
        else:
            check("deno check clean (entry points + golden fixture)", rc == 0, out.strip()[-500:])


# ---------------------------------------------------------------------------
# B. calibration + report
# ---------------------------------------------------------------------------


def bucket(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return max(0, min(19, int(f * 20)))


def histogram(values):
    counts = [0] * 20
    for v in values:
        b = bucket(v)
        if b is not None:
            counts[b] += 1
    return counts


def calibration(items, bands):
    """Every number the report needs, recomputed from the per-item results."""
    tier = {"auto": 0, "options": 0, "low_question": 0, "fallback": 0}
    tier_by_case = {}
    for it in items:
        route = it.get("route")
        if route in tier:
            tier[route] += 1
        tier_by_case.setdefault(it.get("case"), {}).setdefault(route, 0)
        tier_by_case[it["case"]][route] += 1

    def confs(key, case=None):
        out = []
        for it in items:
            if case and it.get("case") != case:
                continue
            v = (it.get("got") or {}).get(key)
            if isinstance(v, (int, float)):
                out.append(float(v))
        return out

    label_confs = {}
    emotion_confs = {}
    for it in items:
        got = it.get("got") or {}
        if got.get("domain"):
            label_confs.setdefault(got["domain"], []).append(got.get("overall_conf"))
        if got.get("emotion"):
            emotion_confs.setdefault(got["emotion"], []).append(got.get("overall_conf"))

    energy_routes = {}
    for it in items:
        if it.get("case") == "energy":
            energy_routes[it.get("route")] = energy_routes.get(it.get("route"), 0) + 1

    correct_clear = [
        float(it["got"]["overall_conf"])
        for it in items
        if it.get("case") == "clear"
        and (it.get("got") or {}).get("domain") == it["expect"].get("domain")
        and isinstance((it.get("got") or {}).get("overall_conf"), (int, float))
    ]

    proposed, method = propose_bands(correct_clear, bands)

    return {
        "tier": tier,
        "tier_by_case": tier_by_case,
        "energy_routes": energy_routes,
        "label_confs": label_confs,
        "emotion_confs": emotion_confs,
        "hist": {
            "domain_conf": histogram(confs("domain_conf")),
            "emotion_conf": histogram(confs("emotion_conf")),
            "overall_conf": histogram(confs("overall_conf")),
        },
        "correct_clear_confs": sorted(correct_clear),
        "proposed": proposed,
        "proposed_method": method,
    }


def propose_bands(correct_confs, bands):
    """Percentile proposal: p50/p10/p05 of the *correct* clear-domain confidences.

    The band spacing is preserved (the fallback gap and the in-band fractions), so the proposal
    is a re-anchoring of the existing shape onto the observed distribution rather than a new
    shape. Degenerate inputs propose nothing (keep the current values).
    """
    if not all(k in bands for k in BAND_KEYS):
        return None, f"current bands lack one of {BAND_KEYS} -- keep the current values"
    if len({round(c, 4) for c in correct_confs}) < 4:
        return (
            None,
            "degenerate: fewer than 4 distinct correct-domain confidences -- keep the current values",
        )

    high = percentile(correct_confs, 0.50)
    medium_low = percentile(correct_confs, 0.10)
    low_low = percentile(correct_confs, 0.05)
    gap = float(bands["low_low"]) - float(bands["fallback"])
    fallback = low_low - gap

    span_high = float(bands["high"]) - float(bands["medium_low"])
    frac_med = (
        (float(bands["medium_high"]) - float(bands["medium_low"])) / span_high if span_high else 0.5
    )
    medium_high = medium_low + frac_med * (high - medium_low)

    span_low = float(bands["medium_low"]) - float(bands["low_low"])
    frac_low = (
        (float(bands["low_high"]) - float(bands["low_low"])) / span_low if span_low else 0.5
    )
    low_high = low_low + frac_low * (medium_low - low_low)

    out = {k: round(v, 4) for k, v in (
        ("high", high),
        ("medium_high", medium_high),
        ("medium_low", medium_low),
        ("low_high", low_high),
        ("low_low", low_low),
        ("fallback", fallback),
    )}
    if not (
        out["fallback"] < out["low_low"] <= out["low_high"] < out["medium_low"] <= out["medium_high"] < out["high"]
    ):
        return None, "degenerate: the derived bands are not strictly ordered -- keep the current values"

    method = (
        "high = p50, medium_low = p10, low_low = p05 of the correct clear-domain `overall_conf` "
        "distribution; the current fallback gap and in-band fractions are preserved for "
        "fallback / medium_high / low_high."
    )
    return out, method


def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    for r in rows:
        out.append("| " + " | ".join("" if c is None else str(c) for c in r) + " |")
    return "\n".join(out)


def fmt_hist(counts):
    lines = []
    for i, c in enumerate(counts):
        lo = i / 20
        hi = (i + 1) / 20
        lines.append(f"[{lo:.2f}, {hi:.2f}) {'#' * min(c, 60)} {c}")
    return "\n".join(lines)


def build_report(date, items, summary, bands, cal, corpus, embed_model, golden_source, runs):
    conf = "| case | expected | got | overall_conf | route |"
    rows = []
    for it in items:
        got = it.get("got") or {}
        exp = it.get("expect") or {}
        want = exp.get("domain") or exp.get("domains") or exp.get("emotion") or exp.get("quit_label")
        rows.append(
            [
                it.get("case"),
                want,
                f"{got.get('domain')} / {got.get('emotion')} / {got.get('quit_signal')}",
                got.get("overall_conf"),
                it.get("route"),
            ]
        )

    qs = summary["quit_set"]
    matrix_rows = []
    for it in items:
        if it.get("case") not in ("quit", "false_constraint"):
            continue
        matrix_rows.append(
            [
                it["id"],
                it["case"],
                (it.get("quitTop") or {}).get("label"),
                (it.get("quitTop") or {}).get("sim"),
                (it.get("got") or {}).get("quit_signal"),
            ]
        )

    proposed = cal["proposed"]
    if proposed:
        band_rows = [[k, bands.get(k), proposed.get(k)] for k in BAND_KEYS]
        proposed_block = (
            md_table(["key", "current", "proposed"], band_rows)
            + "\n\nMethod: " + cal["proposed_method"]
        )
    else:
        proposed_block = "No proposal -- " + cal["proposed_method"]

    energy_rows = [[k, v] for k, v in sorted(cal["energy_routes"].items())]

    lines = [
        f"# FP-03 Golden-Set Report — {date}",
        "",
        "**Status:** DRAFT evidence — generated by `scripts/verify-fp03-step6.py`. Nothing here is",
        "applied: the `confidence_bands` values below are a **proposal** for the owner's Step 7",
        "decision, and the fixture is a placeholder evaluation set (AGENTS.md §8.4).",
        "",
        f"- fixture: `{GOLDEN_TS}` (`{golden_source}`)",
        f"- eval runs: {runs} (the second run is the NFR-3 determinism check)",
        f"- embed model: `{embed_model}`; exemplar rows: {corpus}",
        "",
        "## 1. Gate results",
        "",
        md_table(
            ["gate", "result", "value", "threshold"],
            [
                [
                    "clear-domain accuracy",
                    "PASS" if summary["clear"]["accuracy"] >= CLEAR_ACCURACY_GATE else "FAIL",
                    f"{summary['clear']['correct']}/{summary['clear']['total']}",
                    f">= {CLEAR_ACCURACY_GATE}",
                ],
                [
                    "energy-override compliance",
                    "PASS" if summary["energy"]["compliance"] >= ENERGY_COMPLIANCE_GATE else "FAIL",
                    f"{summary['energy']['compliant']}/{summary['energy']['total']}",
                    f"== {ENERGY_COMPLIANCE_GATE}",
                ],
                [
                    "ambiguous in-pair (recorded)",
                    "-",
                    f"{summary['ambiguous']['in_pair']}/{summary['ambiguous']['total']}",
                    "not gated",
                ],
            ],
        ),
        "",
        "## 2. Per-case results",
        "",
        md_table(["case", "expected", "got (domain / emotion / quit_signal)", "overall_conf", "route"], rows),
        "",
        "## 3. Quit-set confusion matrix",
        "",
        "`quit_signal` is a single flag over the whole quit set (§6.3), so both labels legitimately",
        "arm it; the per-label numbers below measure whether the argmax picks the *right* label.",
        "",
        md_table(
            ["label", "tp", "fp", "fn", "recall", "precision"],
            [
                ["quit", qs["quit"]["tp"], qs["quit"]["fp"], qs["quit"]["fn"], qs["quit"]["recall"], qs["quit"]["precision"]],
                [
                    "false_constraint",
                    qs["false_constraint"]["tp"],
                    qs["false_constraint"]["fp"],
                    qs["false_constraint"]["fn"],
                    qs["false_constraint"]["recall"],
                    qs["false_constraint"]["precision"],
                ],
            ],
        ),
        "",
        md_table(["id", "expected label", "quitTop label", "quitTop sim", "quit_signal flag"], matrix_rows),
        "",
        f"Flag armed: quit {qs['quit_signal_flag']['quit']}/6, false_constraint {qs['quit_signal_flag']['false_constraint']}/6.",
        "",
        "## 4. Tier distribution and confidence histograms",
        "",
        md_table(["route", "count"], [[k, cal["tier"][k]] for k in ("auto", "options", "low_question", "fallback")]),
        "",
        md_table(
            ["case", "auto", "options", "low_question", "fallback"],
            [
                [c, *[cal["tier_by_case"].get(c, {}).get(r, 0) for r in ("auto", "options", "low_question", "fallback")]]
                for c in CASES
            ],
        ),
        "",
        "Buckets are 0.05 wide, `[lo, hi)`.",
        "",
        "`domain_conf`:\n```\n" + fmt_hist(cal["hist"]["domain_conf"]) + "\n```",
        "",
        "`emotion_conf`:\n```\n" + fmt_hist(cal["hist"]["emotion_conf"]) + "\n```",
        "",
        "`overall_conf`:\n```\n" + fmt_hist(cal["hist"]["overall_conf"]) + "\n```",
        "",
        "Per-label `overall_conf` (items that landed on each label):",
        "",
        md_table(
            ["domain label", "n", "overall_conf values"],
            [[k, len(v), ", ".join(f"{x:.3f}" for x in v)] for k, v in sorted(cal["label_confs"].items())],
        ),
        "",
        md_table(
            ["emotion label", "n", "overall_conf values"],
            [[k, len(v), ", ".join(f"{x:.3f}" for x in v)] for k, v in sorted(cal["emotion_confs"].items())],
        ),
        "",
        "## 5. Energy subset",
        "",
        "The 8 energy items under the **current** bands — this is the D4 / R-5 evidence for the",
        "forced-emotion confidence reading (spec-literal: the forced label's own similarity):",
        "",
        md_table(["route", "count"], energy_rows),
        "",
        "## 6. Proposed confidence_bands",
        "",
        "A proposal only. The bands are shared with the stub, so a move is applied at the Step 7",
        "flip as a D4 product-semantics change with a decisions2 entry; the current values are the",
        "rollback record.",
        "",
        proposed_block,
        "",
        "## 7. Owner decisions",
        "",
        "1. **Forced-emotion confidence** — keep the spec-literal reading, or switch to authoritative",
        "   (`emotion_conf = 1.0`) and re-run. Evidence: §5 above.",
        "2. **`confidence_bands`** — accept the proposal above (applied at Step 7) or keep the current",
        "   values. Evidence: §4 above.",
        "3. **Flip approval** — approve or reject `classifier_mode='real'` on this evidence.",
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# C. live checks
# ---------------------------------------------------------------------------


def live_checks(args):
    print("== B. live (needs env; dev-smoke redeployed) ==")

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
    info("confidence_bands", {k: bands[k] for k in BAND_KEYS if k in bands})

    corpus_ok = False
    try:
        # --- the stub-mode guard (the eval can never measure stub vectors) ----
        set_config("llm_stub_mode", True)
        st, body = eval_classifier()
        check(
            "eval-classifier refuses to run under llm_stub_mode (400)",
            st == 400 and "requires llm_stub_mode=false" in str(body),
            f"{st} {body}",
        )
        set_config("llm_stub_mode", False)

        # --- corpus preflight (a precondition, not a gate) -------------------
        # The seed is paced: Gemini counts every item against the embedding quota (TECH-SPEC §12:
        # 100 RPM), so 228 items take ~2.5 min across three windows and a bare call cannot work.
        rows, count_st = placeholder_count()
        check(
            "the service-role REST read works (a non-200 here means the key/URL, not an empty corpus)",
            count_st == 200,
            f"HTTP {count_st}",
        )
        seeded_now = rows != EXPECTED_TOTAL
        if seeded_now:
            info("corpus", f"{rows} rows (HTTP {count_st}) -- seeding the {EXPECTED_TOTAL} placeholders, paced")
            seed_st, seed_body = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)
            info("seed", f"{seed_st} {seed_body}")
            rows, count_st = placeholder_count()
        corpus_ok = rows == EXPECTED_TOTAL
        check(f"the exemplar corpus is seeded ({EXPECTED_TOTAL} rows)", corpus_ok, f"{rows} (HTTP {count_st})")
        if not corpus_ok:
            check(
                "the live eval legs have a corpus to measure",
                False,
                "an empty corpus degrades every item to the D7 block (classifyReal -> exemplars_empty), so "
                "accuracy/compliance are 0 by construction and the report would be meaningless -- the seed's "
                "own error is reported above; fix it and re-run",
            )
            skip("the eval gates + calibration", "no exemplar corpus")
            return
        if seeded_now:
            # The seed's last window is still inside the rolling minute; the two eval runs cost 80
            # more items, so let the minute clear before the first of them.
            info("embedding quota", f"letting the minute clear after the seed ({SEED_PACE_S:.0f}s)")
            time.sleep(SEED_PACE_S)

        # --- the eval run ----------------------------------------------------
        st, body = eval_classifier_paced()
        check("eval-classifier returns 200", st == 200, f"{st} {str(body)[:200]}")
        items = body.get("items") if isinstance(body.get("items"), list) else []
        summary = body.get("summary") if isinstance(body.get("summary"), dict) else {}
        check("the eval returns all 40 per-item results", len(items) == 40, f"{len(items)}")
        if len(items) != 40:
            return
        info("golden set", f"source={body.get('goldenSet')} model={body.get('embedModel')}")

        # The gate recomputes everything from the per-item results, then cross-checks the
        # action's own summary -- a buggy aggregation cannot pass silently.
        recomputed = recompute_summary(items)
        check(
            "the action's summary matches the gate's recomputation",
            deep_close(recomputed, summary),
            f"recomputed={recomputed} vs summary={summary}",
        )

        check(
            f"clear-domain accuracy >= {CLEAR_ACCURACY_GATE}",
            recomputed["clear"]["accuracy"] >= CLEAR_ACCURACY_GATE,
            f"{recomputed['clear']['correct']}/{recomputed['clear']['total']}",
        )
        check(
            "energy-override compliance == 100%",
            recomputed["energy"]["compliance"] >= ENERGY_COMPLIANCE_GATE,
            f"{recomputed['energy']['compliant']}/{recomputed['energy']['total']}",
        )
        info(
            "quit-set (recorded)",
            f"quit r={recomputed['quit_set']['quit']['recall']} p={recomputed['quit_set']['quit']['precision']} "
            f"fc r={recomputed['quit_set']['false_constraint']['recall']} p={recomputed['quit_set']['false_constraint']['precision']} "
            f"flag quit={recomputed['quit_set']['quit_signal_flag']['quit']}/6 "
            f"fc={recomputed['quit_set']['quit_signal_flag']['false_constraint']}/6",
        )
        info("ambiguous in-pair (recorded)", f"{recomputed['ambiguous']['in_pair']}/{recomputed['ambiguous']['total']}")

        # Routes must agree with the live bands (the eval's determinePersona output).
        route_mismatch = [
            it["id"]
            for it in items
            if it.get("route")
            != expected_route(
                (it.get("got") or {}).get("overall_conf"),
                (it.get("got") or {}).get("domain"),
                (it.get("got") or {}).get("emotion"),
                bands,
            )
        ]
        check("every route follows the live confidence bands", not route_mismatch, f"{route_mismatch[:5]}")

        # --- determinism (NFR-3) --------------------------------------------
        runs = 1
        if args.no_determinism:
            skip("the eval is deterministic across runs", "--no-determinism")
        else:
            st2, body2 = eval_classifier_paced()
            runs = 2
            items2 = body2.get("items") if isinstance(body2.get("items"), list) else []
            same = len(items2) == len(items) and all(
                (a.get("got") or {}) == (b.get("got") or {})
                and a.get("route") == b.get("route")
                and (a.get("quitTop") or {}) == (b.get("quitTop") or {})
                for a, b in zip(items, items2)
            )
            check("the eval is deterministic across runs (identical blocks/routes/quitTop)", same)

        # --- live leakage ----------------------------------------------------
        seeded = {norm(t) for t in exemplar_texts()}
        leaked = [it["id"] for it in items if norm(it.get("text") or "") in seeded]
        check("no golden text is present in the seeded exemplars (live leakage grep)", not leaked, f"{leaked}")

        # --- calibration + report -------------------------------------------
        cal = calibration(items, bands)
        info("tier distribution (current bands)", cal["tier"])
        info("energy subset routes", cal["energy_routes"])
        if cal["proposed"]:
            info("proposed bands", cal["proposed"])
        else:
            info("proposed bands", cal["proposed_method"])

        if args.no_report:
            skip("report archived", "--no-report")
        else:
            # Local date, matching the PROGRESS/commit convention (a UTC date can disagree by a day).
            date = datetime.now().strftime("%Y-%m-%d")
            report_path = args.report or os.path.join(REPORT_DIR, f"{REPORT_PREFIX}{date}.md")
            full = report_path if os.path.isabs(report_path) else os.path.join(ROOT, report_path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(
                    build_report(
                        date,
                        items,
                        recomputed,
                        bands,
                        cal,
                        rows,
                        body.get("embedModel"),
                        body.get("goldenSet"),
                        runs,
                    )
                )
            info("report", report_path)
            text = read_text(report_path) or ""
            check(
                "the report is archived with every required section",
                os.path.exists(full) and all(s in text for s in REPORT_SECTIONS),
                f"missing {[s for s in REPORT_SECTIONS if s not in text]}",
            )
            check(
                "the report carries the histograms and the proposed bands",
                "`overall_conf`:" in text and "## 6. Proposed confidence_bands" in text,
            )
    finally:
        for k in SNAPSHOT_KEYS:
            ok = set_config(k, snapshots[k])
            print(f"  ..   {k} restored to {snapshots[k]!r}: {'ok' if ok else 'FAILED'}")
            if not ok:
                FAILURES.append(f"{k} restore")
        # Runs on every path, including an early abort, so the restore is always asserted.
        post = {k: get_config(k) for k in SNAPSHOT_KEYS}
        check("config restored to the snapshot (post-check)", post == snapshots, f"{post}")


def deep_close(a, b, tol=1e-9):
    """Recursive comparison with a float tolerance — the summary crosses a JSON boundary."""
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(deep_close(a[k], b[k], tol) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(deep_close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= tol
    return a == b


def recompute_summary(items):
    """Recompute the gate's summary from the per-item results (mirrors `summarizeEval`)."""
    by_case = {}
    for it in items:
        by_case.setdefault(it.get("case"), []).append(it)

    def rate(hit, total):
        return 0 if total == 0 else round(hit / total, 4)

    clear = by_case.get("clear", [])
    clear_ok = sum(1 for it in clear if (it.get("got") or {}).get("domain") == (it.get("expect") or {}).get("domain"))

    energy = by_case.get("energy", [])
    energy_ok = sum(1 for it in energy if (it.get("got") or {}).get("emotion") == (it.get("expect") or {}).get("emotion"))

    ambiguous = by_case.get("ambiguous", [])
    amb_ok = 0
    for it in ambiguous:
        pair = (it.get("expect") or {}).get("domains") or []
        dom = (it.get("got") or {}).get("domain")
        if dom is not None and dom in pair:
            amb_ok += 1

    quit_items = by_case.get("quit", [])
    fc_items = by_case.get("false_constraint", [])
    all_quit = quit_items + fc_items

    def predicted(it):
        return (it.get("quitTop") or {}).get("label")

    def predicted_count(label):
        return sum(1 for it in all_quit if predicted(it) == label)

    def true_positive(items_, label):
        return sum(1 for it in items_ if predicted(it) == label)

    quit_tp = true_positive(quit_items, "quit")
    quit_pred = predicted_count("quit")
    fc_tp = true_positive(fc_items, "false_constraint")
    fc_pred = predicted_count("false_constraint")

    counts = {}
    for it in items:
        counts[it.get("case")] = counts.get(it.get("case"), 0) + 1

    return {
        "counts": counts,
        "clear": {"correct": clear_ok, "total": len(clear), "accuracy": rate(clear_ok, len(clear))},
        "energy": {"compliant": energy_ok, "total": len(energy), "compliance": rate(energy_ok, len(energy))},
        "ambiguous": {"in_pair": amb_ok, "total": len(ambiguous), "rate": rate(amb_ok, len(ambiguous))},
        "quit_set": {
            "quit": {
                "tp": quit_tp,
                "fp": quit_pred - quit_tp,
                "fn": len(quit_items) - quit_tp,
                "recall": rate(quit_tp, len(quit_items)),
                "precision": rate(quit_tp, quit_pred),
            },
            "false_constraint": {
                "tp": fc_tp,
                "fp": fc_pred - fc_tp,
                "fn": len(fc_items) - fc_tp,
                "recall": rate(fc_tp, len(fc_items)),
                "precision": rate(fc_tp, fc_pred),
            },
            "quit_signal_flag": {
                "quit": sum(1 for it in quit_items if (it.get("got") or {}).get("quit_signal")),
                "false_constraint": sum(1 for it in fc_items if (it.get("got") or {}).get("quit_signal")),
            },
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--no-jest", action="store_true", help="skip the jest --listTests leg")
    ap.add_argument("--no-determinism", action="store_true", help="skip the second (determinism) eval run")
    ap.add_argument("--report", help="report path (default docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<date>.md)")
    ap.add_argument("--no-report", action="store_true", help="do not write the report")
    args = ap.parse_args()

    static_checks(no_jest=args.no_jest)
    if not args.static_only:
        if not all((URL, ANON, SERVICE, SMOKE_TOKEN)):
            skip(
                "live section",
                "need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN",
            )
        else:
            live_checks(args)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 6 checks passed.")


if __name__ == "__main__":
    main()
