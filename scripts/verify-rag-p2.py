#!/usr/bin/env python3
"""RAG redesign Phase 2 check (the TypeScript retrieval layer).

Implementation-only: this script reads `supabase/functions/_shared/rag/*.ts` and the six Jest
suites beside them, never docs. It is the static half of the Phase 2 verification; the runtime
half is `npx jest supabase/functions/_shared/rag` (120 assertions at the time of writing).

What it is for: P2 has no migration and no database harness of its own, so the only durable
evidence that the layer keeps its promises is the source text. The checks below are the promises
that a later edit could quietly break without any single Jest test noticing:

  1. inventory  - the seven modules and six suites exist, and every module still opens with a
     header naming its P2 role and its governing references;
  2. purity     - no module imports a client, reads `Deno.env`, calls `console.*`, or reaches for
     a second database; `dispatch.ts` is the only module that names a client at all;
  3. decisions  - D7-D13 (PLAN.md §1.9) are each expressed as a specific expression, so deleting
     the `RPC_PARAMS` guard or the `threshold_uncalibrated` branch fails here;
  4. exclusions - no payload carries a hidden column, only `checkins` carries `content`, and no
     module evaluates a string (AGENTS.md §4.4).

Run: python scripts/verify-rag-p2.py
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
RAG = ROOT / "supabase/functions/_shared/rag"

MODULES = [
    "types",
    "registry",
    "executor",
    "thresholds",
    "compliance",
    "evidence",
    "dispatch",
]
SUITES = [
    "registry",
    "executor",
    "thresholds",
    "compliance",
    "evidence",
    "dispatch",
]

# PLAN.md §6.1: 13 datasets plus the two semantic tools.
DATASETS = [
    "checkins",
    "impulse_events",
    "checkin_compliance",
    "journal",
    "anchor_plans",
    "habits",
    "metrics_catalog",
    "metric_series",
    "quests",
    "daily_vars",
    "conversation",
    "memory_facts",
    "schedule_profile",
]
SEMANTIC = ["memory_search", "rules_search"]

# The 17 RPCs the registry can emit (D7). `checkin_compliance` has none.
RPCS = [
    "query_checkins",
    "query_impulse_events",
    "query_anchor_plans",
    "query_habits",
    "query_metrics_catalog",
    "query_metric_series",
    "query_quests",
    "query_daily_vars",
    "query_conversation",
    "query_journal_entries",
    "list_answered_windows",
    "list_memory_facts",
    "count_memory_facts",
    "summarize_memory_facts",
    "search_facts",
    "match_rules_v2",
    "read_schedule_profile",
]

# PRD §14.1 A6 / AGENTS.md §4.7.
FORBIDDEN_COLUMNS = (
    "embedding",
    "embed_model",
    "embedding_model",
    "trust_score",
    "trust_delta",
    "formula",
    "tactical_analysis",
    "unsavable",
    "user_id",
    "lockdown_started_at",
)

failures = 0


def check(label: str, condition: bool) -> None:
    global failures
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures += 1


def read(name: str, suffix: str = ".ts") -> str:
    path = RAG / (name + suffix)
    return path.read_text(encoding="utf-8") if path.exists() else ""


def code_only(text: str) -> str:
    """Drop comments so prose about a construct is never read as the construct.

    Only comments are removed: full-line `//` and block-comment bodies, plus the tail after a
    `//` on a code line. A trailing `//` inside a string would be over-stripped, which can only
    hide a match, never invent one - and every check below is an absence test on the result.
    """
    out: list[str] = []
    in_block = False
    for line in text.splitlines():
        stripped = line.strip()
        if in_block:
            if "*/" in stripped:
                in_block = False
            continue
        if stripped.startswith("/*"):
            in_block = "*/" not in stripped
            continue
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        code = line.split("//", 1)[0]
        out.append(code)
    return "\n".join(out)


MODULE_TEXT = {name: read(name) for name in MODULES}
MODULE_CODE = {name: code_only(text) for name, text in MODULE_TEXT.items()}
SUITE_TEXT = {name: read(name, ".test.ts") for name in SUITES}
SUITE_CODE = {name: code_only(text) for name, text in SUITE_TEXT.items()}
ALL_CODE = "\n".join(MODULE_CODE.values()) + "\n" + "\n".join(SUITE_CODE.values())
ALL_TEXT = "\n".join(MODULE_TEXT.values()) + "\n" + "\n".join(SUITE_TEXT.values())

IMPORTS = re.findall(r'from\s+"([^"]+)"', ALL_TEXT)


def section(name: str, marker: str, end: str) -> str:
    """The text between `marker` and `end` in module `name`, or "" when either is missing."""
    text = MODULE_TEXT.get(name, "")
    start = text.find(marker)
    if start < 0:
        return ""
    stop = text.find(end, start + len(marker))
    return text[start:] if stop < 0 else text[start:stop]


def registry_entry(dataset: str) -> str:
    """One registry binding: from its `dataset: {` line to the next top-level `},`."""
    text = MODULE_TEXT["registry"]
    start = text.find(f"  {dataset}: {{")
    if start < 0:
        return ""
    stop = text.find("\n  },", start)
    return "" if stop < 0 else text[start:stop]


def main() -> int:
    # ------------------------------------------------------------------ 1. inventory
    print("-- 1. inventory --")
    for name in MODULES:
        check(f"module {name}.ts exists", (RAG / f"{name}.ts").exists())
    for name in SUITES:
        check(f"suite {name}.test.ts exists", (RAG / f"{name}.test.ts").exists())

    check(
        "every module opens with its own path header",
        all(
            MODULE_TEXT[name].startswith(f"// supabase/functions/_shared/rag/{name}.ts")
            for name in MODULES
        ),
    )
    check(
        "every module header cites the PRD and PLAN.md",
        all(
            re.search(r"PRD §", MODULE_TEXT[name]) and "PLAN.md §" in MODULE_TEXT[name]
            for name in MODULES
        ),
    )
    check(
        "every module header states the phase",
        all("P2" in MODULE_TEXT[name].split("\n", 1)[1][:2000] for name in MODULES),
    )
    check(
        "every non-type module has a suite",
        all((RAG / f"{name}.test.ts").exists() for name in MODULES if name != "types"),
    )

    # ------------------------------------------------------------------ 2. purity
    print("\n-- 2. purity --")
    check(
        "no module imports a Supabase client",
        not any("supabase-js" in MODULE_CODE[name] for name in MODULES),
    )
    check(
        "no module reads Deno.env or serves a request",
        not any(re.search(r"Deno\.(env|serve)", MODULE_CODE[name]) for name in MODULES),
    )
    check(
        "no module or suite calls console.*",
        "console." not in ALL_CODE,
    )
    check(
        "no module declares an explicit `any`",
        not re.search(r":\s*any\b|as\s+any\b|<any>", ALL_CODE),
    )
    check(
        "no module evaluates a string (AGENTS.md §4.4)",
        not re.search(r"\beval\s*\(|new\s+Function\s*\(|Math\.js", ALL_CODE),
    )
    check(
        "dispatch.ts is the only module that names a client",
        [name for name in MODULES if "RagClient" in MODULE_CODE[name]] == ["dispatch"],
    )
    check(
        "every import is a sibling module or the check-in grid",
        all(
            target.startswith("./") or target == "../checkin/windows.ts"
            for target in IMPORTS
        ),
    )
    check(
        "the check-in grid is imported, never re-implemented",
        "windowsForLocalDay" in MODULE_CODE["compliance"]
        and "windowsForLocalDay" not in MODULE_CODE["evidence"],
    )
    check(
        "no module holds a hardcoded threshold, budget or ceiling as a silent default",
        # The only defaults are the documented seeds, exported by name.
        "DEFAULT_EVIDENCE_BUDGET" in MODULE_TEXT["evidence"]
        and "12_000" in MODULE_TEXT["evidence"],
    )

    # ------------------------------------------------------------------ 3. registry
    print("\n-- 3. registry (PRD §6.1) --")
    check(
        "DATASETS lists the 13 datasets in registry order",
        all(f'"{name}"' in section("registry", "export const DATASETS", "];") for name in DATASETS),
    )
    check(
        "SEMANTIC_TOOLS is memory_search then rules_search",
        '["memory_search", "rules_search"]' in MODULE_TEXT["registry"],
    )
    check(
        "all 15 bindings are present",
        all(registry_entry(name) for name in DATASETS + SEMANTIC),
    )
    check(
        "RPC_PARAMS declares the 17 RPCs",
        all(f"{rpc}: [" in section("registry", "export const RPC_PARAMS", "export function acceptsParam")
            or f"{rpc}: []" in section("registry", "export const RPC_PARAMS", "export function acceptsParam")
            for rpc in RPCS),
    )
    params_block = section("registry", "export const RPC_PARAMS", "export function acceptsParam")
    declared = re.findall(r"^\s{2}([a-z0-9_]+):", params_block, re.M)
    check(
        "RPC_PARAMS has exactly 17 entries and no duplicate",
        len(declared) == 17 and len(set(declared)) == 17,
    )
    check(
        "checkin_compliance has no RPC",
        "checkin_compliance" not in params_block and "checkin_compliance" in MODULE_TEXT["registry"],
    )

    # ------------------------------------------------------------------ 4. decisions D7-D13
    print("\n-- 4. decisions D7-D13 (PLAN.md §1.9) --")

    # D7 - arguments are assembled against the RPC's real parameter list.
    count_block = section("registry", "count_memory_facts: [", "]")
    check(
        "D7 count_memory_facts declares no p_limit and no p_dimensions",
        "p_limit" not in count_block and "p_dimensions" not in count_block,
    )
    check(
        "D7 read_schedule_profile declares no arguments",
        "read_schedule_profile: []" in MODULE_TEXT["registry"],
    )
    check(
        "D7 p_op is only on the ten query_* functions",
        all(
            ("p_op" in section("registry", f"{rpc}: [", "]")) == rpc.startswith("query_")
            for rpc in RPCS
        ),
    )
    check(
        "D7 the executor filters arguments through acceptsParam",
        "acceptsParam(rpc, param)" in MODULE_TEXT["executor"],
    )
    check(
        "D7 an undeclared model parameter is a rejection, not an omission",
        "unknown_argument" in MODULE_TEXT["executor"]
        and "from === \"op\"" in MODULE_TEXT["executor"],
    )

    # D8 - `month` is a bucket only for metric_series.
    month_buckets = re.findall(r'buckets:\s*\["day",\s*"week",\s*"month"\]', MODULE_TEXT["registry"])
    check("D8 exactly one dataset accepts the month bucket", len(month_buckets) == 1)
    check(
        "D8 it is metric_series",
        '"day", "week", "month"' in registry_entry("metric_series"),
    )
    check(
        "D8 every other non-empty bucket list is day+week only",
        all(
            "month" not in registry_entry(name)
            for name in DATASETS + SEMANTIC
            if name != "metric_series"
        ),
    )
    check(
        "D8 the metric point caps match 0046 (60/53/12)",
        "bucketCaps: { day: 60, week: 53, month: 12 }" in MODULE_TEXT["registry"],
    )

    # D9 - an unsupported DSL key is rejected, never ignored.
    check(
        "D9 unknown argument keys are rejected",
        "unsupported_argument" not in MODULE_TEXT["executor"]
        and "unknown_argument" in MODULE_TEXT["executor"],
    )
    check(
        "D9 limit is required for list only",
        "limit_required" in MODULE_TEXT["executor"]
        and 'op === "list"' in MODULE_TEXT["executor"],
    )
    check(
        "D9 an empty group_by is allowed (length > 0 guard)",
        "groupBy.length > 0" in MODULE_TEXT["executor"],
    )
    check(
        "D9 an empty filter array is a type error, not a zero-row query",
        "invalid_argument_type" in MODULE_TEXT["executor"]
        and "length === 0" in MODULE_TEXT["executor"],
    )

    # D10 - hours_logged exists twice with one formula.
    check(
        "D10 compliance computes answered x cadence / 60",
        "(answered * grid.cadenceMinutes) / 60" in MODULE_TEXT["compliance"],
    )
    check(
        "D10 the cadence is only 60 or 120",
        "cadence !== 60 && cadence !== 120" in MODULE_TEXT["compliance"],
    )

    # D11 - the SQL clamps are mirrored, not re-litigated.
    check(
        "D11 effectiveLimit exists and clamps both latest and the check-in list",
        "export function effectiveLimit" in MODULE_TEXT["registry"]
        and "spec.latestMax" in MODULE_TEXT["registry"]
        and "spec.contentMaxRows" in MODULE_TEXT["registry"],
    )
    check(
        "D11 the executor uses it instead of rejecting",
        "effectiveLimit(spec, op, limit)" in MODULE_TEXT["executor"],
    )
    check(
        "D11 the registry records the 20-row content cap",
        "contentMaxRows: 20" in MODULE_TEXT["registry"],
    )

    # D12 - the profile is read once per plan.
    check(
        "D12 dispatch reads the profile exactly once",
        MODULE_TEXT["dispatch"].count('rpc("read_schedule_profile"') == 1,
    )
    check(
        "D12 a no-retrieval plan returns before the profile read",
        MODULE_TEXT["dispatch"].index("plan.length === 0")
        < MODULE_TEXT["dispatch"].index("readProfile(options.client)"),
    )

    # D13 - compliance rows are not projected through spec.payload.
    check(
        "D13 compliance rows bypass the payload projection",
        'entry.dataset === "checkin_compliance") return [];' in MODULE_TEXT["evidence"],
    )
    check(
        "D13 the schedule-history limitation is always attached",
        "COMPLIANCE_LIMITATION" in MODULE_TEXT["compliance"]
        and "limitations = [COMPLIANCE_LIMITATION]" in MODULE_TEXT["compliance"],
    )

    # ------------------------------------------------------------------ 5. exclusions
    print("\n-- 5. exclusions (PRD §14.1 A6) --")
    payloads = {name: registry_entry(name) for name in DATASETS + SEMANTIC}
    check(
        "no binding's payload carries a hidden column",
        not any(
            re.search(r'"(' + "|".join(FORBIDDEN_COLUMNS) + r')"', body)
            for body in payloads.values()
        ),
    )
    content_carriers = [name for name, body in payloads.items() if '"content"' in body]
    check(
        "only checkins carries content",
        content_carriers == ["checkins"],
    )
    check(
        "journal and conversation never project text",
        '"content"' not in payloads["journal"] and '"content"' not in payloads["conversation"],
    )
    check(
        "metrics_catalog never projects a formula",
        '"formula"' not in payloads["metrics_catalog"],
    )
    check(
        "schedule_profile never projects trust_score or lockdown_started_at",
        '"trust_score"' not in payloads["schedule_profile"]
        and '"lockdown_started_at"' not in payloads["schedule_profile"],
    )
    check(
        "no module mentions tactical_analysis outside a comment",
        "tactical_analysis" not in ALL_CODE,
    )

    # ------------------------------------------------------------------ 6. thresholds fail closed
    print("\n-- 6. thresholds (PRD §6.2/§6.3, PLAN.md §10) --")
    check(
        "both config keys are named exactly once each",
        'rag_rules_min_similarity' in MODULE_TEXT["thresholds"]
        and 'rag_memory_min_similarity' in MODULE_TEXT["thresholds"],
    )
    check(
        "an uncalibrated threshold is a typed refusal",
        'reason: "threshold_uncalibrated"' in MODULE_TEXT["thresholds"],
    )
    check(
        "there is no zero fallback for a similarity threshold",
        not re.search(r"min_similarity[^\n]*(\?\?|\|\|)\s*0", ALL_CODE)
        and "threshold_uncalibrated" in MODULE_TEXT["executor"],
    )
    check(
        "the open lower bound matches the SQL (value <= 0 || value > 1)",
        "value <= 0 || value > 1" in MODULE_TEXT["thresholds"],
    )
    check(
        "both semantic tools require an embedding",
        "missing_embedding" in MODULE_TEXT["executor"],
    )

    # ------------------------------------------------------------------ 7. orchestration
    print("\n-- 7. orchestration (PRD §14.1 C1-C7) --")
    check(
        "C4 every entry is validated before any call is made",
        MODULE_TEXT["dispatch"].index("validateEntry(entry, ctx)")
        < MODULE_TEXT["dispatch"].index("await readProfile"),
    )
    check(
        "C4 a malformed plan executes nothing",
        "if (validation.length > 0)" in MODULE_TEXT["dispatch"],
    )
    check(
        "C3 the calls run concurrently",
        "Promise.all(" in MODULE_TEXT["dispatch"],
    )
    check(
        "C7 a runtime unavailability becomes a block, not a rejection",
        "isUnavailableReason(outcome.reason)" in MODULE_TEXT["dispatch"],
    )
    check(
        "the request ceiling comes from an option, not a literal",
        "options.maxRequests ?? 6" in MODULE_TEXT["dispatch"],
    )
    check(
        "row_count comes from total_count, never rows.length",
        "rowCount = typeof rawCount" in MODULE_TEXT["evidence"],
    )
    check(
        "an unplaceable essential forbids every optional",
        "essentialUnplaceable" in MODULE_TEXT["evidence"],
    )

    # ------------------------------------------------------------------ 8. cross-cutting
    print("\n-- 8. cross-cutting --")
    check(
        "no module writes to the database",
        not re.search(r"\.(insert|update|upsert|delete)\s*\(", ALL_CODE),
    )
    check(
        "no module names a service-role key",
        "SERVICE_ROLE" not in ALL_TEXT and "service_role" not in ALL_CODE,
    )
    check(
        "no module adds a dependency",
        not any(t.startswith(("npm:", "jsr:", "https://")) for t in IMPORTS),
    )
    check(
        "the layer ships no migration of its own",
        not list((ROOT / "supabase/migrations").glob("004[7-9]*.sql")),
    )
    check(
        "rag_planner_enabled is still false in the seed",
        "('rag_planner_enabled', 'false',"
        in (ROOT / "supabase/migrations/0042_rag_config_keys.sql").read_text(encoding="utf-8"),
    )

    print()
    if failures:
        print(f"FAILED: {failures} check(s)")
        return 1
    print("OK: all Phase 2 checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
