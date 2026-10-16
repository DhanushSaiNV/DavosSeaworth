#!/usr/bin/env python3
"""Automate FP-03 Step 7 verification (BG-04 swap drill + doc write-backs + AC sweep).

Covers PLAN Step 7 Verify: "every AC marked with evidence; the BG-04 drill round-trips;
write-back diffs present; FP-02 suite green under both modes; repo clean".

  AUTOMATED -- static (no network):
    fixture  : `_shared/content/exemplars/bg04.ts` exists, is stamped DRAFT and cites the BG-01
               content rule, carries `status='draft'`, the visible DRAFT label, the `BG-04`
               source stamp, exactly 2 labels x 2 texts, all `setKind='domain'`, labels drawn
               from the §3.3 16-domain set, texts disjoint from the placeholder corpus and the
               golden set, and no [SPEC] value (values live in `config`)
    slot     : the fixture is reachable only from `dev-smoke` -- no pipeline, classifier or
               non-dev action references it
    action   : `seed-exemplars` / `clear-exemplars` accept `&source=` restricted to the two FR-1
               values; the default is the placeholder source, so every pre-Step-7 caller is
               unchanged; the reset predicate is the *named* source; rows carry that source
    bands    : `bands.ts` exports the pure `routeFor`/`applyBandShift`, `persona.ts` re-exports
               them and calls `routeFor` (no inline band comparison left), and `bands.test.ts`
               covers AC-2's six edges -- jest really discovers it
    ledger   : TECH-SPEC §6.1/§6.2 as-built readings + §6.4 swap paragraph; GLOSSARY §11/§13/
               §14/§15/§16 entries; the acceptance ledger's AC ids match the PRD exactly and
               every row carries a status + an evidence tag; the runbook's four stages, content
               rule and two-write rollback; the plan correction note
    registry : zero new job types -- TECH-SPEC §2.3 and GLOSSARY §12 still hold 15 types
    earlier  : the Step 1-6 static legs still pass (the seed contract changed this step)
    types    : `deno check` over the entry points + the new modules (tsconfig excludes
               `supabase/functions`, so deno is the only type gate that reaches them)

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DEV_SMOKE_TOKEN, dev-smoke redeployed;
  snapshots and restores `classifier_mode`, `llm_stub_mode`, `llm_force_fail` in a `finally`):
    corpus   : the 228 placeholder exemplars are seeded (reused when complete -- 0 units)
    drill    : AC-8's additive round-trip, per drill label -- classify the fixture's own text
               (baseline) -> `seed-exemplars&source=BG-04` -> the drill label wins at ~1.0 and
               beats the baseline -> `clear-exemplars&source=BG-04` -> the baseline label and
               confidence return exactly. Self-match makes the argmax deterministic; the gate
               fails loudly if the fixture stops moving the outcome
    whitelist: an unknown `&source=` is a 400 on both actions (a typo can never insert rows
               under an arbitrary tag or delete rows the caller did not name)
    parity   : `classifier_mode='real'` -> the §6.3 block from the corpus and the route
               re-derived from the live `effectiveBands`; `classifier_mode='stub'` -> FP-02's
               defaults, unchanged (AC-6: the rollback is a config write, no redeploy)
    fp02     : `scripts/verify-step11.py --turns 6 --cleanup` under `real`, then under `stub`
               (the DoD's "FP-02 suite green under both modes"). Skipped without
               `DAVOS_USER_JWT`; `--no-fp02` opts out
    restore  : the `BG-04` slot is cleared defensively, config is restored to the snapshot, and
               both are asserted as post-checks (so an aborted drill cannot bias the next run)

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  $env:DAVOS_USER_JWT="<signed-in-user-jwt>"   # only for the FP-02 harness leg
  python scripts/verify-fp03-step7.py [--static-only] [--no-jest] [--no-fp02]
                                      [--fp02-turns N]

PREREQUISITES: migrations 0024 + 0025 applied, `dev-smoke` redeployed at current code, and the
placeholder corpus seeded (the gate re-seeds it if missing -- 228 embedding units). Quota note:
the drill costs ~6 embedding units and the FP-02 harness re-seeds the *rules* corpus once per
mode (AC-11), so run this gate alone on a given day.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fp03_corpus import PLACEHOLDER_SOURCE, SEED_PACE_S, seed_corpus  # noqa: E402

# Windows consoles/pipes are not UTF-8 by default and the tracker row carries ▶/✅ — never let
# a print abort the gate.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []

BG04_TS = "supabase/functions/_shared/content/exemplars/bg04.ts"
BANDS_TS = "supabase/functions/_shared/pipeline/bands.ts"
BANDS_TEST_TS = "supabase/functions/_shared/pipeline/bands.test.ts"
PERSONA_TS = "supabase/functions/_shared/pipeline/persona.ts"
PLACEHOLDER_TS = "supabase/functions/_shared/dev/placeholderExemplars.ts"
GOLDEN_TS = "supabase/functions/_shared/dev/goldenSet.ts"
SMOKE_TS = "supabase/functions/dev-smoke/index.ts"
TECH_SPEC = "docs/TECH-SPEC.md"
GLOSSARY = "docs/GLOSSARY.md"
PLAN = "docs/feature-prds/FP-03/FP-03-PLAN.md"
PRD = "docs/feature-prds/FP-03/FP-03.md"
ACCEPTANCE = "docs/feature-prds/FP-03/FP-03-ACCEPTANCE.md"
RUNBOOK = "docs/feature-prds/FP-03/FP-03-BG04-SWAP-RUNBOOK.md"
PROGRESS = "PROGRESS.md"
FP02_HARNESS = "scripts/verify-step11.py"

ENTRY_POINTS = [
    SMOKE_TS,
    "supabase/functions/send-message/index.ts",
    "supabase/functions/select-persona/index.ts",
    "supabase/functions/job-dispatcher/index.ts",
    "supabase/functions/health/index.ts",
]
NEW_TS = [BG04_TS, BANDS_TS, BANDS_TEST_TS, PERSONA_TS]

PLACEHOLDER_SOURCE_TAG = "PLACEHOLDER-DEV"
BG04_SOURCE = "BG-04"
EXPECTED_TOTAL = 228
EXPECTED_BG04_ITEMS = 4
EXPECTED_AC_IDS = {f"AC-{i}" for i in range(1, 11)}
EXPECTED_JOB_TYPES = 15
SNAPSHOT_KEYS = ("classifier_mode", "llm_stub_mode", "llm_force_fail")
EVIDENCE_TAGS = ("[script]", "[measured]", "[owner-observed]", "[derived]")

# The additive drill: the fixture's own text self-matches, so the seeded label's similarity is
# ~1.0 and no placeholder row can reach it.
SELF_MATCH_MIN = 0.99
FLOAT_TOL = 1e-9

ITEM_RE = re.compile(
    r'setKind:\s*"(?P<kind>\w+)"\s*,\s*label:\s*"(?P<label>[^"]+)"\s*,\s*'
    r'text:\s*"(?P<text>(?:[^"\\]|\\.)*)"'
)
DOMAIN_LABEL_RE = re.compile(r'build\(\s*"domain"\s*,\s*"([^"]+)"')
TS_TEXT_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')


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
USER_JWT = env("DAVOS_USER_JWT")
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


def section(text, start, *ends):
    """Slice a doc between a heading and the next heading(s) — for section-scoped assertions."""
    i = text.find(start)
    if i < 0:
        return ""
    j = len(text)
    for end in ends:
        k = text.find(end, i + len(start))
        if 0 <= k < j:
            j = k
    return text[i:j]


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


def placeholder_count():
    """(rows, status) for the placeholder subset -- the paced seed's short-circuit/resume point."""
    rows, st = rest(f"exemplars?source=eq.{PLACEHOLDER_SOURCE}&select=id&limit=1000")
    return (len(rows) if st == 200 else None), st


def source_count(source):
    rows, st = rest(f"exemplars?source=eq.{source}&select=id&limit=1000")
    return (len(rows) if st == 200 else None), st


def norm(text):
    t = text.lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def route_for(conf, bands):
    """Mirror the pure `routeFor` — used to re-derive a route from the live effective bands."""
    if conf >= bands["high"]:
        return "auto"
    if conf >= bands["medium_low"]:
        return "options"
    if conf >= bands["low_low"]:
        return "low_question"
    return "fallback"


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def parse_items(src):
    """Parse the fixture's items straight from source (the module cannot be imported)."""
    return [
        {"kind": m.group("kind"), "label": m.group("label"), "text": m.group("text")}
        for m in ITEM_RE.finditer(src)
    ]


def static_checks(no_jest=False):
    print("== A. static (no network) ==")

    # --- the BG-04 content slot ---------------------------------------------
    src = read_text(BG04_TS)
    check("the BG-04 slot exists", src is not None, BG04_TS)
    if src is None:
        return
    code = strip_ts_comments(src)

    check(
        "the slot is stamped DRAFT and cites the BG-01 content rule / AGENTS.md §8.4",
        "DRAFT" in src and ("BG-01" in src or "AGENTS.md §8.4" in src),
    )
    check(
        "the slot declares status='draft' and a visible DRAFT label",
        re.search(r'export const BG04_STATUS = "draft"', code) is not None
        and re.search(r"export const BG04_DRAFT_LABEL", code) is not None,
    )
    check(
        "the slot owns the BG-04 source stamp",
        re.search(r'export const BG04_EXEMPLAR_SOURCE = "BG-04"', code) is not None,
    )
    check(
        "the slot says the swap needs no classifier/pipeline/schema code change (FR-16)",
        "no classifier" in src.lower() and "code change" in src.lower(),
    )
    check(
        "the slot carries no [SPEC] value (values live in config)",
        "confidence_bands" not in code and "quit_signal_threshold" not in code,
    )

    items = parse_items(code)
    labels = [it["label"] for it in items]
    per_label = {lab: labels.count(lab) for lab in set(labels)}
    check(
        f"the fixture is exactly 2 labels x 2 texts ({EXPECTED_BG04_ITEMS} items)",
        len(items) == EXPECTED_BG04_ITEMS and len(per_label) == 2 and set(per_label.values()) == {2},
        f"n={len(items)} per_label={per_label}",
    )
    check(
        "every drill item is a `domain` item (the swap's most-consumed set)",
        all(it["kind"] == "domain" for it in items),
        f"{sorted({it['kind'] for it in items})}",
    )

    placeholder_src = read_text(PLACEHOLDER_TS) or ""
    domain_labels = set(DOMAIN_LABEL_RE.findall(strip_ts_comments(placeholder_src)))
    check(
        "the drill labels come from the §3.3 16-domain set",
        set(labels) and set(labels) <= domain_labels,
        f"{sorted(set(labels))} not in {len(domain_labels)} labels",
    )

    # Leakage: a drill text that already exists in the corpus would be measuring memorisation,
    # and the self-match proof would be indistinguishable from a placeholder hit.
    corpus = {norm(t) for t in TS_TEXT_RE.findall(strip_ts_comments(placeholder_src))}
    golden = {norm(t) for t in TS_TEXT_RE.findall(strip_ts_comments(read_text(GOLDEN_TS) or ""))}
    drill_norm = [norm(it["text"]) for it in items]
    check(
        "no drill text is already in the placeholder corpus or the golden set",
        all(t and t not in corpus and t not in golden for t in drill_norm),
        f"{[it['text'] for it in items if norm(it['text']) in corpus or norm(it['text']) in golden]}",
    )
    check("the drill texts are unique", len(set(drill_norm)) == len(drill_norm))

    # The slot must not be reachable from production code.
    referenced = []
    for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "supabase", "functions")):
        for fn in files:
            if not fn.endswith(".ts"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            try:
                with open(full, encoding="utf-8", errors="replace") as fh:
                    if re.search(r"bg04", fh.read(), re.IGNORECASE):
                        referenced.append(rel)
            except OSError:
                continue
    allowed = {BG04_TS, SMOKE_TS}
    check(
        "the BG-04 slot is referenced only by dev-smoke (never by the pipeline or classifier)",
        set(referenced) <= allowed,
        f"unexpected readers: {sorted(set(referenced) - allowed)}",
    )

    # --- the dev-smoke `&source=` contract -----------------------------------
    smoke = read_text(SMOKE_TS) or ""
    smoke_code = strip_ts_comments(smoke)
    check(
        "dev-smoke maps exactly the two FR-1 sources to their content slots",
        "[PLACEHOLDER_EXEMPLAR_SOURCE]: PLACEHOLDER_EXEMPLARS" in smoke_code
        and "[BG04_EXEMPLAR_SOURCE]: BG04_EXEMPLARS" in smoke_code,
    )
    check(
        "the source selector defaults to the placeholder set and whitelists via the map",
        re.search(r'searchParams\.get\("source"\)', smoke_code) is not None
        and re.search(r"return PLACEHOLDER_EXEMPLAR_SOURCE;", smoke_code) is not None
        and "hasOwnProperty.call(EXEMPLAR_SETS" in smoke_code,
    )
    check(
        "an unknown source is refused with a 400 (never an arbitrary-tag insert)",
        "unknownSourceResponse" in smoke_code and "status: 400" in smoke_code,
    )
    check(
        "both exemplar actions resolve `&source=`",
        smoke_code.count("const source = exemplarSource(url);") == 2,
        f"{smoke_code.count('const source = exemplarSource(url);')}",
    )
    check(
        "the seed's reset predicate is the named source, not the placeholder constant",
        '.eq("source", source)' in smoke_code
        and '.eq("source", PLACEHOLDER_EXEMPLAR_SOURCE)' not in smoke_code,
    )
    check(
        "the seed window is drawn from the named set and rows carry that source",
        "const set = EXEMPLAR_SETS[source];" in smoke_code
        and "const total = set.length;" in smoke_code
        and "set.slice(offset, offset + limit)" in smoke_code
        and "\n          source,\n" in smoke_code,
    )
    check(
        "clear-exemplars reports which slot it cleared",
        re.search(r"JSON\.stringify\(\{ ok: true, source \}\)", smoke_code) is not None,
    )

    # --- the pure band arithmetic + AC-2's unit coverage ---------------------
    bands = read_text(BANDS_TS)
    check("bands.ts exists", bands is not None, BANDS_TS)
    if bands is not None:
        bands_code = strip_ts_comments(bands)
        check(
            "bands.ts exports the pure routeFor / applyBandShift and the Route union",
            "export function routeFor(" in bands_code
            and "export function applyBandShift(" in bands_code
            and re.search(r'export type Route = "auto" \| "options" \| "low_question" \| "fallback"', bands_code)
            is not None,
        )
        route_body = section(bands_code, "export function routeFor(", "}")
        check(
            "routeFor reads only high / medium_low / low_low (the Low floor is low_low)",
            route_body.count("bands.high") == 1
            and route_body.count("bands.medium_low") == 1
            and route_body.count("bands.low_low") == 1
            and "bands.medium_high" not in route_body
            and "bands.fallback" not in route_body,
            route_body,
        )

    persona = strip_ts_comments(read_text(PERSONA_TS) or "")
    check(
        "persona.ts re-exports the band arithmetic and calls routeFor",
        re.search(r'export \{ applyBandShift, routeFor \} from "\./bands\.ts"', persona) is not None
        and "routeFor(conf, eff)" in persona,
    )
    check(
        "persona.ts keeps no inline band comparison (the extraction is real)",
        "conf >= eff.high" not in persona and "conf >= eff.medium_low" not in persona,
    )

    test_src = read_text(BANDS_TEST_TS) or ""
    check(
        "bands.test.ts covers AC-2's sub-edge numerics",
        all(edge in test_src for edge in ("0.749", "0.549", "0.399", "0.75", "0.55", "0.40")),
    )

    # --- the write-back ledger ----------------------------------------------
    spec = read_text(TECH_SPEC) or ""
    check(
        "TECH-SPEC carries the §6.1/§6.2 as-built readings",
        spec.count("**As built (FP-03 Step 7):**") >= 2,
        f"{spec.count('**As built (FP-03 Step 7):**')} markers",
    )
    spec62 = section(spec, "### 6.2 Process", "### 6.3 Outputs")
    check(
        "§6.2 records the spec-literal forced-emotion confidence and the open alternative",
        "spec-literal" in spec62 and "emotion_conf = 1.0" in spec62,
    )
    spec61 = section(spec, "### 6.1 Inputs", "### 6.2 Process")
    check(
        "§6.1 records that no chat-turn caller passes energy",
        "no chat-turn caller passes" in spec61.lower(),
    )
    spec64 = section(spec, "### 6.4 Fallback", "**Evaluation gate", "---")
    check(
        "§6.4 documents the `&source=` swap slot, the drill and the runbook",
        "&source=" in spec64 and "FP-03-BG04-SWAP-RUNBOOK.md" in spec64 and "verify-fp03-step7.py" in spec64,
    )

    glossary = read_text(GLOSSARY) or ""
    check(
        "GLOSSARY §14 gained the missing exemplars.source enum row",
        "| Exemplar source | `PLACEHOLDER-DEV` / `BG-04` | `exemplars.source` | §3.3 |" in glossary,
    )
    g13 = section(glossary, "## 13. Edge Function Identifiers", "## 14.")
    check(
        "GLOSSARY §13's dev-smoke row lists the `&source=` selector",
        "&source=" in g13 and "FP-03 Steps 2–7" in g13,
    )
    g11 = section(glossary, "## 11. Table Nomenclature", "## 12.")
    check("GLOSSARY §11's `exemplars` row still tags the source values", "PLACEHOLDER-DEV" in g11)
    g15 = section(glossary, "## 15. Field & Output Identifiers", "## 16.")
    check("GLOSSARY §15 still carries `classifierMode` + the classify log line", "classifierMode" in g15)
    g16 = section(glossary, "## 16. Config Keys", "---")
    check(
        "GLOSSARY §16 still lists the four FP-03 config keys",
        all(k in g16 for k in ("classifier_mode", "quit_signal_threshold", "energy_exhausted_max", "energy_determined_min")),
    )

    # Zero new job types (§2.3 + GLOSSARY §12 untouched).
    spec23 = section(spec, "### 2.3 Job type registry", "## 3. Data Layer")
    types_spec = len(re.findall(r"^\| `[a-z_]+`", spec23, re.MULTILINE))
    g12 = section(glossary, "## 12. Job Type Identifiers", "## 13.")
    types_gloss = len(re.findall(r"^\| `[a-z_]+`", g12, re.MULTILINE))
    check(
        f"zero new job types — both registries still hold {EXPECTED_JOB_TYPES} types",
        types_spec == EXPECTED_JOB_TYPES and types_gloss == EXPECTED_JOB_TYPES,
        f"TECH-SPEC §2.3={types_spec}, GLOSSARY §12={types_gloss}",
    )

    # --- the acceptance ledger ----------------------------------------------
    prd = read_text(PRD) or ""
    prd_ac = section(prd, "## 6. Acceptance Criteria", "## 7. Build Order")
    prd_ids = {f"AC-{n}" for n in re.findall(r"\bAC-(\d+)\b", prd_ac)}
    acc = read_text(ACCEPTANCE)
    check("the acceptance ledger exists", acc is not None, ACCEPTANCE)
    if acc is not None:
        acc_ids = {f"AC-{n}" for n in re.findall(r"\*\*AC-(\d+)\*\*", acc)}
        check(
            "the ledger's AC set matches the PRD exactly",
            acc_ids == prd_ids == EXPECTED_AC_IDS,
            f"ledger={sorted(acc_ids)} prd={sorted(prd_ids)}",
        )
        rows = [ln for ln in acc.splitlines() if re.match(r"^\| \*\*AC-\d+\*\* \|", ln)]
        check(
            "every AC row carries a status and an evidence tag",
            len(rows) == len(EXPECTED_AC_IDS)
            and all(("✅" in ln or "❌" in ln or "⏳" in ln) for ln in rows)
            and all(any(tag in ln for tag in EVIDENCE_TAGS) for ln in rows),
            f"{[ln[:40] for ln in rows if not any(tag in ln for tag in EVIDENCE_TAGS)]}",
        )

    # --- the runbook ---------------------------------------------------------
    runbook = read_text(RUNBOOK) or ""
    check("the BG-04 runbook exists", bool(runbook), RUNBOOK)
    check(
        "the runbook carries the four stages",
        all(s in runbook for s in ("## Stage 1", "## Stage 2", "## Stage 3", "## Stage 4")),
    )
    check(
        "the runbook states the content-rule provenance (owner-authored, content migration)",
        "owner-authored" in runbook.lower() and "content migration" in runbook.lower(),
    )
    check(
        "the runbook states the two-write rollback",
        "classifier_mode='stub'" in runbook and "two config writes" in runbook,
    )
    check(
        "the runbook names the drill as its proof",
        "verify-fp03-step7.py" in runbook,
    )

    # --- the plan correction + tracker --------------------------------------
    plan = read_text(PLAN) or ""
    check(
        "the plan records the Step 7 slot-path correction",
        "_shared/content/exemplars/bg04.ts" in plan
        and "bg04Drill" in plan
        and "bundled" in plan.lower(),
    )
    check(
        "the plan's tracker carries a Step 7 row",
        re.search(r"^\| *7 *\|", plan, re.MULTILINE) is not None,
    )
    check("PROGRESS.md carries a Step 7 entry", "Step 7" in (read_text(PROGRESS) or ""))

    # --- the earlier gates still pass (the seed contract changed) ------------
    print("  -- re-running the Step 1-6 static legs --")
    for step in range(1, 7):
        cmd = [sys.executable, f"scripts/verify-fp03-step{step}.py", "--static-only"]
        if step >= 4:
            cmd.append("--no-jest")
        rc, out = run(cmd, timeout=600)
        ok = rc == 0
        check(f"verify-fp03-step{step}.py --static-only is green", ok, (out or "")[-400:])

    # --- types ---------------------------------------------------------------
    deno = run(["deno", "check", *ENTRY_POINTS, *NEW_TS], timeout=600)
    if deno[0] is None:
        skip("deno check (entry points + new modules)", "deno not on PATH")
    else:
        rc, out = deno
        check("deno check clean (entry points + new modules)", rc == 0, out.strip()[-500:])

    # --- jest ---------------------------------------------------------------
    if no_jest:
        skip("jest discovers the new unit suite", "--no-jest")
    else:
        rc, out = run(["npx", "jest", "--ci"], timeout=900)
        check("jest is green (all suites)", rc == 0, (out or "")[-600:])
        rc, out = run(["npx", "jest", "--listTests"], timeout=600)
        check(
            "jest discovers bands.test.ts",
            rc == 0 and "bands.test.ts" in (out or ""),
            (out or "")[-300:],
        )

    # --- repo gates ----------------------------------------------------------
    rc, out = run(["npx", "tsc", "--noEmit"], timeout=600)
    check("tsc --noEmit is clean", rc == 0, (out or "")[-400:])
    rc, out = run(["npx", "eslint", "."], timeout=600)
    check("eslint has no errors", rc == 0, (out or "")[-400:])
    rc, out = run([sys.executable, "-m", "py_compile", "scripts/verify-fp03-step7.py"], timeout=120)
    check("verify-fp03-step7.py compiles", rc == 0, (out or "")[-200:])


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


def classify(text, **params):
    st, body = dev_smoke("classify", text=text, **params)
    return st, (body if isinstance(body, dict) else {})


def pipeline(text, **params):
    st, body = dev_smoke("pipeline", text=text, **params)
    return st, (body if isinstance(body, dict) else {})


def live_checks(args):
    print("== B. live ==")

    snapshots = {k: get_config(k) for k in SNAPSHOT_KEYS}
    info("config snapshot", snapshots)

    drill_items = parse_items(strip_ts_comments(read_text(BG04_TS) or ""))
    probes = []
    seen = set()
    for it in drill_items:
        if it["label"] not in seen:
            seen.add(it["label"])
            probes.append(it)

    try:
        # --- preflight: real embeddings + a seeded corpus --------------------
        if not set_config("llm_stub_mode", False):
            check("llm_stub_mode could be cleared for the real legs", False, "config write failed")
            return
        check("llm_stub_mode cleared for the real legs", get_config("llm_stub_mode") is False)

        st, body = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL, force=False)
        check(
            f"the placeholder corpus is seeded ({EXPECTED_TOTAL} rows)",
            st == 200 and isinstance(body, dict) and body.get("seeded") == EXPECTED_TOTAL,
            f"HTTP {st} {str(body)[:200]}",
        )

        rows, st = source_count(BG04_SOURCE)
        if st == 200 and rows:
            # A previous run aborted mid-drill; clear it so the baseline is honest.
            info("stale BG-04 rows", f"{rows} -- clearing before the drill")
            dev_smoke("clear-exemplars", source=BG04_SOURCE)

        # --- the whitelist ---------------------------------------------------
        st, body = dev_smoke("seed-exemplars", source="NOT-A-SOURCE")
        check("an unknown seed source is a 400", st == 400, f"HTTP {st} {str(body)[:160]}")
        st, body = dev_smoke("clear-exemplars", source="NOT-A-SOURCE")
        check("an unknown clear source is a 400", st == 400, f"HTTP {st} {str(body)[:160]}")

        # --- the additive BG-04 round-trip (AC-8) ----------------------------
        for probe in probes:
            label, text = probe["label"], probe["text"]
            st, body = classify(text)
            base = body.get("classification") or {}
            check(
                f"baseline classify for {label!r} returns a real block",
                st == 200 and body.get("embedOk") is not False and base.get("domain") is not None,
                f"HTTP {st} {str(body)[:200]}",
            )
            base_label, base_conf = base.get("domain"), base.get("domain_conf")

            st, body = dev_smoke("seed-exemplars", source=BG04_SOURCE)
            check(
                f"seed-exemplars&source=BG-04 seeds the {EXPECTED_BG04_ITEMS}-item drill slot",
                st == 200 and isinstance(body, dict) and body.get("seeded") == EXPECTED_BG04_ITEMS,
                f"HTTP {st} {str(body)[:200]}",
            )

            st, body = classify(text)
            got = body.get("classification") or {}
            check(
                f"{label!r} wins after the swap (self-match at ~1.0)",
                st == 200
                and got.get("domain") == label
                and isinstance(got.get("domain_conf"), (int, float))
                and got["domain_conf"] >= SELF_MATCH_MIN,
                f"HTTP {st} domain={got.get('domain')} conf={got.get('domain_conf')}",
            )
            check(
                f"the seeded rows are what moved {label!r} (confidence strictly up)",
                isinstance(base_conf, (int, float))
                and isinstance(got.get("domain_conf"), (int, float))
                and got["domain_conf"] > base_conf,
                f"baseline {base_conf} -> seeded {got.get('domain_conf')}",
            )

            st, body = dev_smoke("clear-exemplars", source=BG04_SOURCE)
            check(
                f"clear-exemplars&source=BG-04 removes the drill rows",
                st == 200 and isinstance(body, dict) and body.get("source") == BG04_SOURCE,
                f"HTTP {st} {str(body)[:160]}",
            )

            st, body = classify(text)
            back = body.get("classification") or {}
            check(
                f"revert restores the {label!r} baseline exactly",
                st == 200
                and back.get("domain") == base_label
                and isinstance(back.get("domain_conf"), (int, float))
                and abs(back["domain_conf"] - base_conf) <= FLOAT_TOL,
                f"HTTP {st} {back.get('domain')}/{back.get('domain_conf')} vs {base_label}/{base_conf}",
            )

        rows, st = source_count(BG04_SOURCE)
        check("no BG-04 rows survive the drill", rows == 0, f"{rows} rows")

        # --- mode parity (AC-6: the rollback is a config write) ---------------
        probe_text = probes[0]["text"] if probes else "I skipped the gym all week"

        check("classifier_mode could be set to real", set_config("classifier_mode", "real"))
        st, body = pipeline(probe_text)
        real_info = body.get("routeInfo") or {}
        real_block = real_info.get("classification") or {}
        check(
            "real mode: the pipeline routes on the embedding classifier",
            st == 200 and real_info.get("classifierMode") == "real",
            f"HTTP {st} mode={real_info.get('classifierMode')}",
        )
        bands = real_info.get("effectiveBands") or {}
        check(
            "real mode: the route follows the live effective bands",
            real_info.get("route") == route_for(real_info.get("overallConf", -1), bands)
            if bands
            else False,
            f"route={real_info.get('route')} conf={real_info.get('overallConf')} bands={bands}",
        )
        check(
            "real mode: the §6.3 block is well formed",
            sorted(real_block.keys())
            == ["domain", "domain_conf", "emotion", "emotion_conf", "overall_conf", "quit_signal"],
            f"{sorted(real_block.keys())}",
        )

        check("classifier_mode could be set to stub", set_config("classifier_mode", "stub"))
        st, body = pipeline(probe_text)
        stub_info = body.get("routeInfo") or {}
        stub_block = stub_info.get("classification") or {}
        check(
            "stub mode: the pipeline is back on the FP-02 stub, no redeploy",
            st == 200
            and stub_info.get("classifierMode") == "stub"
            and stub_block.get("domain") == "Career"
            and stub_block.get("emotion") == "determined"
            and stub_block.get("overall_conf") == 0.8
            and stub_block.get("quit_signal") is False,
            f"HTTP {st} {stub_block}",
        )
        check(
            "both modes emit the identical §6.3 field set (stages 3-5 cannot tell)",
            sorted(stub_block.keys()) == sorted(real_block.keys()),
        )

        # --- the FP-02 harness under both modes ------------------------------
        if args.no_fp02:
            skip("FP-02 suite green under both modes", "--no-fp02")
        elif not USER_JWT:
            skip("FP-02 suite green under both modes", "DAVOS_USER_JWT not set")
        else:
            for mode in ("real", "stub"):
                set_config("classifier_mode", mode)
                rc, out = run(
                    [
                        sys.executable,
                        FP02_HARNESS,
                        "--turns",
                        str(args.fp02_turns),
                        "--cleanup",
                    ],
                    timeout=1800,
                )
                check(
                    f"verify-step11.py is green under classifier_mode='{mode}'",
                    rc == 0,
                    (out or "")[-800:],
                )
    finally:
        # Defensive first: a mid-drill abort must not leave the drill rows in the corpus. They
        # would bias the next run's baseline, because `match_exemplars` deliberately carries no
        # source filter (Step 3) — that is what makes the additive drill work at all.
        dev_smoke("clear-exemplars", source=BG04_SOURCE)
        for k in SNAPSHOT_KEYS:
            ok = set_config(k, snapshots[k])
            print(f"  ..   {k} restored to {snapshots[k]!r}: {'ok' if ok else 'FAILED'}")
            if not ok:
                FAILURES.append(f"{k} restore")
        post = {k: get_config(k) for k in SNAPSHOT_KEYS}
        check("config restored to the snapshot (post-check)", post == snapshots, f"{post}")

        rows, st = source_count(BG04_SOURCE)
        check("no BG-04 rows left behind (post-check)", rows == 0, f"{rows} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--no-jest", action="store_true", help="skip the jest legs")
    ap.add_argument("--no-fp02", action="store_true", help="skip the verify-step11.py parity runs")
    ap.add_argument("--fp02-turns", type=int, default=6, help="audit length for the FP-02 harness")
    args = ap.parse_args()

    static_checks(no_jest=args.no_jest)
    if not args.static_only:
        if not all((URL, ANON, SERVICE, SMOKE_TOKEN)):
            skip(
                "live checks",
                "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / DEV_SMOKE_TOKEN not all set",
            )
        else:
            live_checks(args)

    print()
    if FAILURES:
        print(f"FAIL -- {len(FAILURES)} check(s):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("PASS -- all checks green")
    sys.exit(0)


if __name__ == "__main__":
    main()
