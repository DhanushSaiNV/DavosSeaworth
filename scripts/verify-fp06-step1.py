#!/usr/bin/env python3
"""Automate FP-06 Step 1 verification (migration 0029: match_facts, indexes, two config keys).

Covers PLAN Step 1 Verify: "migration applies clean and re-applies idempotently; a hand-run
`match_facts` against service-role-planted facts returns the top-k ordering and the (empty)
baseline arm; `purged_at`-set rows never return; `information_schema` diff proves zero
table/column change beyond the HNSW index; the FP-02/03/04/05 static legs still green after
the doc edits."

  AUTOMATED -- static (no network):
    migration  : 0029 exists; `match_facts(uuid, vector(768), int)` is SECURITY DEFINER with a
                 pinned `search_path = public`; EXECUTE revoked from public/anon and granted to
                 authenticated/service_role only (the 0025 pattern)
    arms       : the top-k CTE filters `purged_at is null` + `embedding is not null` and orders
                 by `<=>`; the baseline CTE takes every unpurged `fact_type='baseline'` row and
                 excludes ids already in the top-k arm (dedupe); outer order is arm-then-rank
    indexes    : HNSW cosine index on `memory_facts(embedding)` + idempotent b-tree on
                 `source_message_id`, both `if not exists`
    no schema  : no CREATE/ALTER/DROP of TABLE, COLUMN, POLICY, RLS, or TRIGGER in the file
    config     : both keys seeded with correctly-typed jsonb literals (number 5, boolean true)
                 and an idempotent upsert
    docs       : TECH-SPEC section 11 and GLOSSARY section 16 list both keys

  NOT AUTOMATED: apply / re-apply / information_schema diff / hand-run RPC need a database;
  recorded in FP-06-ACCEPTANCE.

Usage: python scripts/verify-fp06-step1.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION = "supabase/migrations/0029_memory_fp06.sql"
KEYS = ["memory_fact_top_k", "memory_retrieval_enabled"]

_failures = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global _failures
    if cond:
        print(f"  PASS {label}")
    else:
        _failures += 1
        print(f"  FAIL {label}" + (f" -- {detail}" if detail else ""))


def read(rel: str) -> str:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return ""
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="accepted for parity; static is the only leg")
    ap.parse_args()

    print("== FP-06 Step 1: migration 0029 (match_facts, indexes, two config keys) ==\n")

    mig = read(MIGRATION)
    check(f"{MIGRATION} exists", bool(mig))
    if not mig:
        print("\nFAILED: migration missing")
        return 1

    print("\n== A. match_facts hardening (the 0025 pattern) ==")
    check("function match_facts(uuid, vector(768), int) defined",
          "function public.match_facts(" in mig and "p_query_embedding vector(768)" in mig)
    check("SECURITY DEFINER", "security definer" in mig)
    check("pinned search_path = public", "set search_path = public" in mig)
    check("revoked from public, anon",
          re.search(r"revoke execute on function public\.match_facts.*from public, anon", mig) is not None)
    check("granted to authenticated + service_role",
          re.search(r"grant execute on function public\.match_facts.*to authenticated, service_role", mig) is not None)

    print("\n== B. The two arms ==")
    check("top-k arm excludes purged rows", "m.purged_at is null" in mig)
    check("top-k arm requires an embedding", "m.embedding is not null" in mig)
    check("top-k ordered by cosine distance (<=>)", "order by m.embedding <=> p_query_embedding" in mig)
    check("top-k limited by the parameter, floored at 0", "limit greatest(p_top_k, 0)" in mig)
    check("similarity = 1 - distance", "1 - (m.embedding <=> p_query_embedding)" in mig)
    check("baseline arm selects every unpurged baseline row", "m.fact_type = 'baseline'" in mig)
    check("baseline ids deduped across arms",
          "not exists (select 1 from top_k t where t.id = m.id)" in mig)
    check("deterministic outer order (arm, then rank)",
          "order by u.arm, u.rn" in mig)

    print("\n== C. Indexes ==")
    check("HNSW cosine index, if not exists",
          re.search(r"create index if not exists idx_memory_facts_embedding\s+on memory_facts using hnsw \(embedding vector_cosine_ops\)", mig) is not None)
    check("b-tree idempotent safeguard on source_message_id",
          "create index if not exists idx_memory_facts_source_message_id" in mig)

    print("\n== D. Zero schema change ==")
    lowered = mig.lower()
    for frag in ("create table", "alter table", "drop table", "add column", "drop column",
                 "create policy", "alter policy", "enable row level security", "create trigger"):
        check(f"no '{frag}'", frag not in lowered)

    print("\n== E. Config seeds (jsonb-typed) ==")
    for key in KEYS:
        check(f"seeds {key}", f"'{key}'" in mig)
    check("top_k is a JSON number, not a string", "'memory_fact_top_k', '5'" in mig)
    check("kill switch is a JSON boolean, not a string", "'memory_retrieval_enabled', 'true'" in mig)
    check("idempotent upsert", "on conflict (key) do update" in mig)

    print("\n== F. Docs ==")
    tech = read("docs/TECH-SPEC.md")
    gloss = read("docs/GLOSSARY.md")
    for key in KEYS:
        check(f"TECH-SPEC 11 lists {key}", key in tech)
        check(f"GLOSSARY 16 lists {key}", key in gloss)
    check("TECH-SPEC 3.3 records the indexes as built", "idx_memory_facts_embedding" in tech)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
