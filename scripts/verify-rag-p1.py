#!/usr/bin/env python3
"""RAG redesign Phase 1 check (migrations 0044-0046, 18 functions).

Implementation-only: this script reads the migrations, never docs. It is the static half of the
Phase 1 verification; `scripts/rag_p1_fixtures.sql` (local) and `scripts/rag_p1_live_check.sql`
(production) are the runtime halves.

What it is for: a SQL contract is only as good as the text of the migration. The runtime harnesses
prove behaviour on the two databases that exist today; this file proves that the *properties* the
plan depends on are present in the source, so a later edit that drops `search_path`, widens a grant
or adds an `embedding` column to a result type fails here even if no fixture happens to notice.

Three groups of checks:

  1. per-function shape  - security mode, pinned search_path, REVOKE/GRANT pair, no timezone
     argument, no dynamic SQL, no forbidden column in the result type;
  2. per-migration text  - the decisions that are expressed as a specific expression (the 20-row
     clamp, the vector_dims check, the no-default threshold, the hours_logged formula);
  3. cross-cutting       - the total is 18, nothing in P1 grants anything to `anon`, and no
     migration >= 0044 re-opens a table P0 closed.

Run: python scripts/verify-rag-p1.py
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
M = ROOT / "supabase/migrations"

MIG_0044 = M / "0044_rag_identity_and_memory.sql"
MIG_0045 = M / "0045_rag_match_rules_v2.sql"
MIG_0046 = M / "0046_rag_dataset_rpcs.sql"

# PLAN.md §6.1 inventory. 7 + 1 + 10.
FUNCS_0044 = [
    "current_user_timezone",
    "read_schedule_profile",
    "list_answered_windows",
    "search_facts",
    "list_memory_facts",
    "count_memory_facts",
    "summarize_memory_facts",
]
FUNCS_0045 = ["match_rules_v2"]
FUNCS_0046 = [
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
]
ALL_FUNCS = FUNCS_0044 + FUNCS_0045 + FUNCS_0046

# D1: the common return prefix every query_* dataset carries.
COMMON_PREFIX = (
    "bucket_start date, n bigint, value numeric, id uuid, occurred_at timestamptz, "
    "total_count bigint"
)

# Columns that must never appear in a P1 result type (D1, AGENTS.md §4.7).
FORBIDDEN_RESULT_COLUMNS = (
    "embedding",
    "embed_model",
    "unsavable",
    "tactical_analysis",
    "trust_score",
    "user_id",
)

failures = 0


def check(label: str, condition: bool) -> None:
    global failures
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures += 1


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def strip_comments(text: str) -> str:
    """Remove SQL comments so prose about a statement is never read as the statement.

    Tracks single-quoted strings (with '' escapes). Dollar-quoted bodies are deliberately left
    alone: the Phase 1 bodies contain `--` comments inside `$$ ... $$`, and stripping them is not
    needed because every check below is an absence-or-presence test on qualified text.
    """
    out: list[str] = []
    i, n = 0, len(text)
    quote = ""
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == quote:
                if i + 1 < n and text[i + 1] == quote:
                    out.append(text[i + 1])
                    i += 2
                    continue
                quote = ""
            i += 1
            continue
        if c == "'":
            quote = c
            out.append(c)
            i += 1
            continue
        if c == "-" and i + 1 < n and text[i + 1] == "-":
            while i < n and text[i] != "\n":
                i += 1
            out.append("\n")
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def read_sql(path: Path) -> str:
    return strip_comments(read(path))


def squash(sql: str) -> str:
    return re.sub(r"\s+", " ", sql)


def function_blocks(sql: str) -> dict[str, str]:
    """name -> text from `create or replace function public.<name>(` to the next definition.

    The trailing REVOKE/GRANT statements belong to the block they follow, so they are included.
    """
    starts = [
        (m.start(), m.group(1))
        for m in re.finditer(r"create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(", sql, re.I)
    ]
    blocks: dict[str, str] = {}
    for idx, (pos, name) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(sql)
        blocks[name] = sql[pos:end]
    return blocks


def signature(block: str) -> str:
    m = re.search(r"create\s+or\s+replace\s+function\s+public\.\w+\s*\((.*?)\)\s*returns", block, re.I | re.S)
    return squash(m.group(1)).strip() if m else ""


def result_columns(block: str) -> str:
    m = re.search(r"returns\s+table\s*\((.*?)\)\s*language", block, re.I | re.S)
    return squash(m.group(1)).strip() if m else ""


def param_names(sig: str) -> list[str]:
    """Parameter names from a squashed parameter list, ignoring type/default text."""
    if not sig.strip():
        return []
    out = []
    depth = 0
    current = ""
    for ch in sig + ",":
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            part = current.strip()
            current = ""
            if not part:
                continue
            name = part.split()[0]
            if name.lower() != "default":
                out.append(name)
        else:
            current += ch
    return out


def no_dynamic_sql(block: str) -> bool:
    cleaned = re.sub(r"(grant|revoke)[^;]*?execute[^;]*?;", "", block, flags=re.I)
    return "format(" not in cleaned and not re.search(r"\bexecute\s", cleaned, re.I)


def main() -> int:
    print("== RAG Phase 1 (0044-0046, 18 functions) ==\n")

    for p in (MIG_0044, MIG_0045, MIG_0046):
        check(f"migration exists: {p.name}", p.exists())
    if failures:
        print("\nFAILED: a Phase 1 migration is missing; nothing else can be checked")
        return 1

    raw = {p.name: read(p) for p in (MIG_0044, MIG_0045, MIG_0046)}
    sql = {p.name: read_sql(p) for p in (MIG_0044, MIG_0045, MIG_0046)}
    m44, m45, m46 = sql[MIG_0044.name], sql[MIG_0045.name], sql[MIG_0046.name]

    blocks: dict[str, str] = {}
    for name, text in (
        (MIG_0044.name, m44),
        (MIG_0045.name, m45),
        (MIG_0046.name, m46),
    ):
        found = function_blocks(text)
        for fn in found:
            if fn in blocks:
                print(f"      duplicate definition: {fn} in {name}")
            blocks[fn] = found[fn]

    # ------------------------------------------------------------- inventory
    print("\n-- inventory: 18 functions, 7 + 1 + 10 --")
    for fn in ALL_FUNCS:
        check(f"defined: {fn}", fn in blocks)
    extra = sorted(set(blocks) - set(ALL_FUNCS))
    check(f"no unexpected public function defined in P1 ({len(blocks)} total)", not extra)
    if extra:
        print(f"      unexpected: {extra}")

    # --------------------------------------------------------- per function
    print("\n-- per function: security mode, search_path, grants, arguments --")
    for fn in ALL_FUNCS:
        block = blocks.get(fn)
        if not block:
            continue
        flat = squash(block)

        is_invoker = fn == "current_user_timezone"
        check(
            f"{fn}: {'INVOKER' if is_invoker else 'DEFINER'} as specified",
            ("security invoker" in flat.lower()) if is_invoker else ("security definer" in flat.lower()),
        )
        check(f"{fn}: search_path pinned to empty", "set search_path = ''" in flat)
        check(
            f"{fn}: no EXECUTE left for PUBLIC",
            re.search(r"revoke\s+all\s+on\s+function\s+public\." + fn + r"\s*\([^)]*\)\s+from[^;]*\bpublic\b", flat, re.I)
            is not None,
        )
        if is_invoker:
            check(
                f"{fn}: granted to nobody (owner-only)",
                re.search(r"grant\s+execute\s+on\s+function\s+public\." + fn + r"\b", flat, re.I) is None,
            )
        else:
            check(
                f"{fn}: EXECUTE granted to authenticated",
                re.search(
                    r"grant\s+execute\s+on\s+function\s+public\." + fn + r"\s*\([^)]*\)\s+to\s+authenticated\s*[,;]",
                    flat,
                    re.I,
                )
                is not None,
            )

        names = [p.lower() for p in param_names(signature(block))]
        check(
            f"{fn}: takes no timezone argument",
            not ({"p_tz", "timezone", "tz"} & set(names)),
        )
        check(f"{fn}: no dynamic SQL", no_dynamic_sql(block))
        check(
            f"{fn}: no projection/table/column/order argument",
            not ({"p_sql", "p_table", "p_column", "p_order_by", "p_where"} & set(names)),
        )

        cols = result_columns(block)
        offenders = [c for c in FORBIDDEN_RESULT_COLUMNS if re.search(rf"\b{c}\b", cols)]
        check(f"{fn}: result type exposes no forbidden column", not offenders)
        if offenders:
            print(f"      exposed: {offenders}")

    # --------------------------------------------------- 0044 specific text
    print("\n-- 0044: identity and memory surface --")
    check(
        "current_user_timezone: no UTC fallback and no coalesce on profiles.timezone",
        "coalesce" not in squash(blocks.get("current_user_timezone", "")).lower(),
    )
    check("0044: the string 'UTC' never appears (no silent fallback)", "UTC" not in m44)
    check(
        "current_user_timezone: missing/invalid zone is 22023 timezone_unavailable",
        "raise exception 'timezone_unavailable' using errcode = '22023'" in squash(m44),
    )
    check(
        "all four memory functions filter purged_at is null",
        all(
            "purged_at is null" in squash(blocks.get(fn, ""))
            for fn in ("search_facts", "list_memory_facts", "count_memory_facts", "summarize_memory_facts")
        ),
    )
    check(
        "search_facts: p_min_similarity has NO default",
        "p_min_similarity double precision," in squash(m44)
        and "p_min_similarity double precision default" not in squash(m44),
    )
    check(
        "search_facts: embedding validated with vector_dims(...) = 768",
        "public.vector_dims(p_query_embedding) is distinct from 768" in squash(m44),
    )
    check(
        "no P1 function declares a constrained vector(768) parameter (D5)",
        not re.search(r"\bvector\s*\(\s*768\s*\)", m44 + m45 + m46, re.I),
    )
    check(
        "fact_type validated against the live CHECK domain (D4)",
        "array['chat', 'journal', 'oath', 'baseline']" in squash(m44),
    )
    check(
        "memory functions cap p_limit at the registry values (5 / 50)",
        "p_limit > 5" in squash(m44) and "p_limit > 50" in squash(m44),
    )
    check(
        "list_answered_windows refuses over-cap ranges instead of truncating (T11)",
        "range_too_large" in squash(m44) and "rag_compliance_max_windows" in squash(m44),
    )
    check(
        "read_schedule_profile never returns trust_score or lockdown_started_at",
        not re.search(r"\btrust_score\b|\blockdown_started_at\b", result_columns(blocks.get("read_schedule_profile", ""))),
    )
    check("0044: schema reload notified", "notify pgrst" in m44)

    # --------------------------------------------------- 0045 specific text
    print("\n-- 0045: match_rules_v2 --")
    b45 = squash(blocks.get("match_rules_v2", ""))
    check(
        "match_rules_v2: grants exactly authenticated + service_role",
        re.search(
            r"grant\s+execute\s+on\s+function\s+public\.match_rules_v2\s*\([^)]*\)\s+to\s+authenticated,\s*service_role\s*;",
            b45,
            re.I,
        )
        is not None,
    )
    check(
        "match_rules_v2: p_min_similarity has NO default",
        "p_min_similarity double precision," in b45 and "p_min_similarity double precision default" not in b45,
    )
    check(
        "match_rules_v2: domain hints boost, never filter (hint_rank in the ORDER BY)",
        "hint_rank" in b45 and re.search(r"order by s\.similarity desc, s\.hint_rank asc", b45, re.I) is not None,
    )
    check(
        "match_rules_v2: no case-sensitive `where domain =` filter",
        not re.search(r"where\s+r?\.?domain\s*=", b45, re.I),
    )
    check("match_rules_v2: embedding similarity is schema-qualified", "operator(public.<=>)" in b45)
    check("0045: schema reload notified", "notify pgrst" in m45)
    check(
        "0045: does not touch the legacy match_rules definition",
        "create or replace function public.match_rules(" not in m45,
    )

    # --------------------------------------------------- 0046 specific text
    print("\n-- 0046: the ten dataset functions --")
    for fn in FUNCS_0046:
        block = blocks.get(fn, "")
        flat = squash(block)
        check(
            f"{fn}: ownership predicate user_id = v_uid",
            re.search(r"user_id\s*=\s*v_uid", flat) is not None,
        )
        check(
            f"{fn}: grants authenticated only (no service_role, no anon)",
            re.search(
                r"grant\s+execute\s+on\s+function\s+public\." + fn + r"\s*\([^)]*\)\s+to\s+authenticated\s*;",
                flat,
                re.I,
            )
            is not None
            and "to authenticated, service_role" not in flat,
        )
        check(
            f"{fn}: carries the D1 common return prefix",
            result_columns(block).startswith(COMMON_PREFIX),
        )

    check(
        "0046: D2 content clamp is least(p_limit, 20), not a rejection",
        "least(p_limit, 20)" in squash(m46),
    )
    check(
        "0046: D3 hours_logged is computed in SQL from the grid cadence",
        "v_cadence / 60.0" in squash(m46),
    )
    check(
        "0046: metric_series requires an explicit selector",
        "metric_selector_required" in squash(m46),
    )
    check(
        "0046: metric_series ownership is the metrics join, not a WHERE clause",
        "m.user_id = v_uid" in squash(m46),
    )
    check(
        "0046: pure date columns are never converted through a timezone",
        not re.search(r"entry_date at time zone", m46, re.I)
        and not re.search(r"plan_date at time zone", m46, re.I)
        and not re.search(r"quest_deadline at time zone", m46, re.I)
        and not re.search(r"computed_for at time zone", m46, re.I),
    )
    check(
        "0046: only query_checkins projects content",
        [fn for fn in FUNCS_0046 if re.search(r"\bcontent\b", result_columns(blocks.get(fn, "")))]
        == ["query_checkins"],
    )
    check(
        "0046: conversation and journal never project message/journal text",
        not re.search(r"\bcontent\b", result_columns(blocks.get("query_conversation", "")))
        and not re.search(r"\bcontent\b", result_columns(blocks.get("query_journal_entries", ""))),
    )
    check(
        "0046: unsavable messages are excluded from the conversation dataset",
        "unsavable = false" in squash(blocks.get("query_conversation", "")),
    )
    check("0046: schema reload notified", "notify pgrst" in m46)

    # --------------------------------------------------------- cross-cutting
    print("\n-- cross-cutting --")
    check("total function count is 18", len(blocks) == 18)
    check(
        "no P1 migration grants EXECUTE to anon",
        not re.search(r"grant\s+execute[^;]*\bto\b[^;]*\banon\b", m44 + m45 + m46, re.I),
    )
    check(
        "no P1 migration grants a table privilege to anon or authenticated",
        not re.search(r"grant\s+(select|insert|update|delete|all)\b[^;]*\bto\b[^;]*\b(anon|authenticated)\b", m44 + m45 + m46, re.I),
    )
    check(
        "no P1 migration mentions trust_score outside a comment",
        "trust_score" not in m44 + m45 + m46,
    )
    check(
        "every function is SECURITY INVOKER or DEFINER (none left at the default)",
        all("security definer" in squash(b).lower() or "security invoker" in squash(b).lower() for b in blocks.values()),
    )

    # P0 closed these tables; no P1 migration may re-open one.
    p1_text = m44 + m45 + m46
    reopened = [
        t
        for t in ("rules", "exemplars", "jobs", "trust_events", "persona_stats",
                  "memory_facts", "habits", "journal_entries")
        if re.search(r"grant\s+(select|insert|update|delete|all)\b[^;]*\bon\s+(public\.)?" + t + r"\b", p1_text, re.I)
    ]
    check("no P1 migration re-opens a table P0 closed", not reopened)
    if reopened:
        print(f"      reopened: {reopened}")

    check(
        "no P1 migration adds a policy",
        "create policy" not in p1_text.lower(),
    )
    check(
        "no P1 migration alters a table",
        not re.search(r"\balter\s+table\b", p1_text, re.I),
    )

    print()
    if failures:
        print(f"FAILED: {failures} check(s)")
        return 1
    print("OK: all Phase 1 checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
