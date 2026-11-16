#!/usr/bin/env python3
"""RAG Redesign Phase 5 static check (migration 0047 compatibility wrapper).

Verifies properties of migration 0047_rag_match_rules_compat.sql:
  1. Signature preservation: (vector(768), text, integer)
  2. Return type: setof public.rules
  3. Security definer with search_path = ''
  4. Access privileges: revoked from public/anon/authenticated, granted to service_role only
  5. Calibrated threshold: reads rag_rules_min_similarity from config
  6. Cosine distance operator qualification: operator(public.<=>)

Run: python scripts/verify-rag-p5.py
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MIG_0047 = ROOT / "docs/feature-prds/RAG-REDESIGN/0047_rag_match_rules_compat.sql"

def main():
    if not MIG_0047.exists():
        print(f"FAIL: {MIG_0047} does not exist")
        sys.exit(1)

    text = MIG_0047.read_text(encoding="utf-8")
    checks = []

    def check(name, ok, msg=""):
        checks.append((name, ok, msg))
        status = "PASS" if ok else "FAIL"
        extra = f" -- {msg}" if msg and not ok else ""
        print(f"  [{status}] {name}{extra}")

    print("Verifying 0047_rag_match_rules_compat.sql invariants:")

    # 1. Signature
    check(
        "Function signature matches (vector(768), text, integer)",
        "query_embedding vector(768)" in text and "match_domain text" in text and "match_count integer default 5" in text,
    )

    # 2. Return type
    check(
        "Return type is setof public.rules",
        "returns setof public.rules" in text,
    )

    # 3. Security definer and pinned search path
    check(
        "Security definer is set",
        "security definer" in text,
    )
    check(
        "Search path pinned to empty string",
        "set search_path = ''" in text,
    )

    # 4. Access privileges
    check(
        "Revoked from public, anon, authenticated",
        "revoke all on function public.match_rules(vector(768), text, integer)" in text and "from public, anon, authenticated;" in text,
    )
    check(
        "Granted to service_role only",
        "grant execute on function public.match_rules(vector(768), text, integer) to service_role;" in text,
    )

    # 5. Threshold usage
    check(
        "Reads rag_rules_min_similarity from config",
        "where key = 'rag_rules_min_similarity'" in text,
    )
    check(
        "Enforces similarity >= v_min_similarity",
        "operator(public.<=>) query_embedding)) >= v_min_similarity" in text,
    )

    # 6. Safety limits
    check(
        "Caps match count with least()",
        "least(coalesce(match_count, 5), 20)" in text,
    )

    failed = [c for c in checks if not c[1]]
    print(f"\nSummary: {len(checks) - len(failed)} / {len(checks)} assertions passed.")
    if failed:
        sys.exit(1)

if __name__ == "__main__":
    main()
