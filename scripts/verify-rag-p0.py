#!/usr/bin/env python3
"""RAG redesign Phase 0 check (migrations 0039-0042).

Implementation-only: this script reads the migrations and the client source, never docs.

The load-bearing assertions are the two directions of the column-grant check:

  * every granted column must appear in a real client projection (or be a filter column), so a
    grant can never be speculative - "might be useful later" is not a projection;
  * every client projection must be covered by the grant, so hardening cannot silently break a
    shipped screen.

Both directions are computed from the actual `.select()` strings in lib/, not from a hand-written
list, so editing a projection without revisiting the grant fails this check.

Run: python scripts/verify-rag-p0.py
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
M = ROOT / "supabase/migrations"

MIG_0039 = M / "0039_rag_forbidden_table_revokes.sql"
MIG_0040 = M / "0040_rag_column_grants.sql"
MIG_0041 = M / "0041_rag_config_hardening.sql"
MIG_0042 = M / "0042_rag_config_keys.sql"
MIG_0043 = M / "0043_rag_push_tokens_upsert_select.sql"

CLIENT_DIRS = ("lib", "app", "components", "domain")

failures = 0


def check(label: str, condition: bool) -> None:
    global failures
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures += 1


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def strip_comments(text: str) -> str:
    """Remove SQL/TS comments so prose about a statement is never read as the statement.

    Tracks single- and double-quoted strings (with '' / "" escapes) so a comment marker inside a
    literal survives. Dollar-quoted bodies are left alone: none of the Phase 0 bodies contain a
    comment marker.
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
        if c in ("'", '"'):
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
    """Collapse whitespace so multi-line statements match as one string."""
    return re.sub(r"\s+", " ", sql)


def client_sources() -> dict[str, str]:
    out: dict[str, str] = {}
    for d in CLIENT_DIRS:
        for p in (ROOT / d).rglob("*.ts*"):
            if ".test." in p.name or "node_modules" in p.parts:
                continue
            out[str(p.relative_to(ROOT)).replace("\\", "/")] = strip_comments(read(p))
    return out


def selections(src: str) -> list[set[str]]:
    """Every .select('a, b, c') / .select("a") argument in a file, as column sets."""
    found = []
    for m in re.finditer(r"\.select\(\s*(['\"])(.*?)\1", src, re.S):
        body = re.sub(r"\s+", " ", m.group(2))
        cols = {c.strip() for c in body.split(",") if c.strip() and c.strip() != "*"}
        if cols:
            found.append(cols)
    return found


def grant_columns(sql: str, table: str) -> set[str] | None:
    """Columns in `grant select ( ... ) on public.<table> to authenticated;` (None = no grant)."""
    m = re.search(
        r"grant\s+select\s*\(([^)]*)\)\s+on\s+public\." + table + r"\s+to\s+authenticated\s*;",
        squash(sql),
        re.I,
    )
    if not m:
        return None
    return {c.strip() for c in m.group(1).split(",") if c.strip()}


def main() -> int:
    print("== RAG Phase 0 (0039-0042) ==\n")

    for p in (MIG_0039, MIG_0040, MIG_0041, MIG_0042, MIG_0043):
        check(f"migration exists: {p.name}", p.exists())

    m39, m40, m41, m42 = (squash(read_sql(p)) for p in (MIG_0039, MIG_0040, MIG_0041, MIG_0042))

    # ------------------------------------------------------------------ 0039
    print("\n-- 0039: forbidden tables and the old match_rules --")
    forbidden = [
        "rules",
        "exemplars",
        "jobs",
        "trust_events",
        "persona_stats",
        "memory_facts",
        "habits",
        "journal_entries",
    ]
    for t in forbidden:
        check(
            f"{t}: revoke all from anon + authenticated",
            f"revoke all on public.{t} from anon, authenticated;" in m39,
        )

    for policy in [
        "rules_select_authenticated",
        "exemplars_select_authenticated",
        "trust_events_select_own",
        "persona_stats_select_own",
        "persona_stats_insert_own",
        "persona_stats_update_own",
        "memory_facts_select_own",
        "memory_facts_insert_own",
        "memory_facts_update_own",
        "habits_select_own",
        "habits_insert_own",
        "habits_update_own",
        "journal_entries_select_own",
        "journal_entries_insert_own",
        "journal_entries_update_own",
    ]:
        check(f"policy dropped: {policy}", f"drop policy if exists {policy} on public." in m39)

    check("match_rules body is schema-qualified", "from public.rules r" in m39)
    check("match_rules operator is schema-qualified", "operator(public.<=>) query_embedding" in m39)
    check("match_rules has a pinned empty search_path", "set search_path = ''" in m39)
    check(
        "match_rules keeps its signature, parameter names and default",
        "query_embedding vector(768)" in m39
        and "match_domain text" in m39
        and "match_count integer default 5" in m39
        and "returns setof public.rules" in m39,
    )
    check(
        "match_rules execute revoked from PUBLIC, anon and authenticated",
        "revoke all on function public.match_rules(vector(768), text, integer) from public, anon, authenticated;"
        in m39,
    )
    check(
        "match_rules execute granted to service_role only",
        "grant execute on function public.match_rules(vector(768), text, integer) to service_role;"
        in m39,
    )
    check(
        "match_rules is never granted to authenticated",
        "grant execute on function public.match_rules(vector(768), text, integer) to authenticated" not in m39,
    )

    check("match_exemplars body is schema-qualified", "from public.exemplars e" in m39)
    check(
        "match_exemplars operator is schema-qualified",
        "e.embedding operator(public.<=>) query_embedding" in m39,
    )
    check(
        "match_exemplars execute revoked from authenticated",
        "revoke all on function public.match_exemplars(vector(768)) from public, anon, authenticated;" in m39,
    )
    check(
        "match_exemplars execute granted to service_role only",
        "grant execute on function public.match_exemplars(vector(768)) to service_role;" in m39,
    )

    # ------------------------------------------------------------------ 0040
    print("\n-- 0040: column grants --")
    for t in ["profiles", "doings_logs", "messages", "metrics", "metric_points", "anchor_plans", "push_tokens"]:
        check(f"{t}: revoke all from anon + authenticated", f"revoke all on public.{t} from anon, authenticated;" in m40)

    check("profiles: display_name UPDATE revoked", "revoke update (display_name) on public.profiles from anon, authenticated;" in m40)
    check("messages: unsavable UPDATE revoked", "revoke update (unsavable) on public.messages from anon, authenticated;" in m40)
    check("messages: table-level SELECT kept for Realtime", "grant select on public.messages to authenticated;" in m40)

    # ------------------------------------------------------------------ 0043
    # 0040 revoked SELECT on push_tokens and was wrong: ON CONFLICT DO UPDATE needs it.
    print("\n-- 0043: push_tokens upsert needs table-level SELECT --")
    check("migration exists: 0043_rag_push_tokens_upsert_select.sql", MIG_0043.exists())
    m43 = squash(read_sql(MIG_0043))
    check(
        "push_tokens: select + insert + update + delete restored for authenticated",
        "grant select, insert, update, delete on public.push_tokens to authenticated;" in m43,
    )
    check(
        "push_tokens: own-rows read policy restored",
        "create policy push_tokens_select_own on public.push_tokens" in m43
        and "for select using (auth.uid() = user_id)" in m43,
    )
    check(
        "push_tokens: truncate/references/trigger stay revoked (the point of REVOKE ALL)",
        "truncate" not in m43 and "references" not in m43 and "trigger" not in m43,
    )
    check("push_tokens: nothing granted to anon", "to anon" not in m43)

    # the two directions of the grant/projection check
    srcs = client_sources()
    union: dict[str, set[str]] = {}
    for src in srcs.values():
        for m in re.finditer(r"\.from\(\s*(['\"])([a-z_]+)\1\s*\)", src):
            table = m.group(2)
            # the select may appear before or after .from() in the chain
            window = src[max(0, m.start() - 400) : m.start() + 400]
            for cols in selections(window):
                union.setdefault(table, set()).update(cols)

    # filter-only columns, verified from the .eq()/.gte()/.in() calls in the same chain
    filter_cols = {
        "profiles": {"id"},
        "doings_logs": {"user_id"},
        "messages": {"user_id"},
        "metrics": {"user_id"},
        "metric_points": set(),
        "anchor_plans": {"user_id", "plan_date"},
    }

    for table in ["profiles", "doings_logs", "metrics", "metric_points", "anchor_plans"]:
        granted = grant_columns(m40, table)
        check(f"{table}: has an explicit column grant", granted is not None)
        if granted is None:
            continue
        projected = union.get(table, set())
        allowed = projected | filter_cols.get(table, set())
        check(
            f"{table}: every granted column is projected or filtered (no speculative grants)",
            granted <= allowed,
        )
        check(
            f"{table}: every projected column is granted",
            projected <= granted,
        )
        missing = sorted(projected - granted)
        if missing:
            print(f"      missing from grant: {missing}")

    # named exclusions, checked against the grant text itself
    metrics_grant = grant_columns(m40, "metrics") or set()
    check("metrics: is_core is NOT granted", "is_core" not in metrics_grant)
    check("metrics: formula is NOT granted", "formula" not in metrics_grant)
    doings_grant = grant_columns(m40, "doings_logs") or set()
    check("doings_logs: created_at is NOT granted", "created_at" not in doings_grant)
    check("doings_logs: embedding is NOT granted", "embedding" not in doings_grant)
    profiles_grant = grant_columns(m40, "profiles") or set()
    check("profiles: display_name is NOT granted", "display_name" not in profiles_grant)
    check("profiles: trust_score is NOT granted", "trust_score" not in profiles_grant)
    check("profiles: dialog_state is NOT granted", "dialog_state" not in profiles_grant)

    # ------------------------------------------------------- client forbidden tables
    print("\n-- client surface: no direct access to forbidden tables --")
    referenced: dict[str, list[str]] = {}
    for name, src in srcs.items():
        for m in re.finditer(r"\.from\(\s*(['\"])([a-z_]+)\1\s*\)", src):
            referenced.setdefault(m.group(2), []).append(name)
    for t in forbidden:
        hits = referenced.get(t, [])
        check(f"no client .from('{t}')", not hits)
        if hits:
            print(f"      found in: {sorted(set(hits))}")

    # ------------------------------------------------- client upserts need table SELECT
    # INSERT ... ON CONFLICT DO UPDATE requires SELECT privilege on the target table no matter what
    # representation is requested. 0040 got this wrong for push_tokens and broke push registration,
    # so derive the requirement from the source instead of trusting a comment.
    print("\n-- client upserts: ON CONFLICT DO UPDATE needs table-level SELECT --")
    upsert_tables: set[str] = set()
    for name, src in srcs.items():
        for m in re.finditer(r"\.from\(\s*(['\"])([a-z_]+)\1\s*\)", src):
            window = src[m.end() : m.end() + 400]
            if ".upsert(" in window and "onConflict" in window:
                upsert_tables.add(m.group(2))
    check("found a client upsert with onConflict (this check is not vacuous)", bool(upsert_tables))
    all_grants = squash(read_sql(MIG_0040) + "\n" + read_sql(MIG_0043))
    for t in sorted(upsert_tables):
        check(
            f"{t}: table-level SELECT granted (required by ON CONFLICT DO UPDATE)",
            f"grant select on public.{t} to authenticated;" in all_grants
            or f"grant select, insert, update, delete on public.{t} to authenticated;" in all_grants,
        )

    # ------------------------------------------------------------------ 0041
    print("\n-- 0041: config hardening --")
    check("config: revoke all from anon + authenticated", "revoke all on public.config from anon, authenticated;" in m41)
    check("config: column SELECT for authenticated", "grant select (key, value) on public.config to authenticated;" in m41)
    check("config: no table-level SELECT for authenticated", "grant select on public.config to authenticated;" not in m41)

    # ------------------------------------------------------------------ 0042
    print("\n-- 0042: config keys --")
    keys = [
        "rag_planner_enabled",
        "rag_rules_min_similarity",
        "rag_memory_min_similarity",
        "rag_evidence_total_chars",
        "rag_compliance_max_windows",
        "rag_metadata_allowlist",
        "rag_max_plan_requests",
    ]
    for k in keys:
        check(f"key seeded: {k}", f"('{k}'," in m42)
    check("planner starts disabled", "('rag_planner_enabled', 'false'," in m42)
    check(
        "both similarity thresholds start as JSON null, never 0",
        "('rag_rules_min_similarity', 'null'," in m42 and "('rag_memory_min_similarity', 'null'," in m42,
    )
    check("0042 does not re-grant config to anon", "grant select on config to anon" not in m42)
    check("0042 does not re-grant config at all", "grant select on config" not in m42)

    # ------------------------------------------------- no later migration re-opens config
    print("\n-- no later migration re-opens config --")
    later = sorted(p for p in M.glob("00*.sql") if p.name[:4].isdigit() and int(p.name[:4]) >= 41)
    offenders = [
        p.name
        for p in later
        if re.search(r"grant\s+select\s+on\s+(public\.)?config\s+to\s+[^;]*\banon\b", read_sql(p), re.I)
    ]
    check("no migration >= 0041 grants config to anon", not offenders)
    if offenders:
        print(f"      offenders: {offenders}")

    print()
    if failures:
        print(f"FAILED: {failures} check(s)")
        return 1
    print("OK: all Phase 0 checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
