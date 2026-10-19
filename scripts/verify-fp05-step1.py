#!/usr/bin/env python3
"""Automate FP-05 Step 1 verification (four config keys ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â migration 0028, no schema).

Covers PLAN Step 1 Verify: "migration applies clean and re-applies idempotently; `select *
from config` returns all four with jsonb values; the two persona values match the ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§5.3
persona-key enum exactly (gate aert); `information_schema` diff proves zero schema change;
the FP-02/03/04 static legs still green after the doc edits."

  AUTOMATED -- static (no network):
    migration  : 0028 exists, seeds exactly the four keys, quoted jsonb literals,
                 idempotent `on conflict (key) do update`
    no schema  : no CREATE/ALTER/DROP of TABLE, INDEX, POLICY, COLUMN, FUNCTION in the file
    personas   : both persona values are members of PERSONA_KEYS (guardrails.ts) -- the
                 enum the runtime actually validates against (ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§5.3)
    docs       : TECH-SPEC ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§11 and GLOSSARY ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§16 list all four keys
    readers    : each key is read at runtime through the fail-closed config helpers, and
                 no literal fallback shadows it (AGENTS ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§3.5 / ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§9 "[SPEC] from config")

  NOT AUTOMATED: the live `select * from config` / re-apply / information_schema diff legs
  need a database (they are the Step 1 live drill, recorded in FP-05-ACCEPTANCE ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§2).

Usage: python scripts/verify-fp05-step1.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION = "supabase/migrations/0028_journal_chain_fp05.sql"
KEYS = [
    "journal_probe_vagueness_threshold",
    "journal_probe_persona_severe",
    "journal_probe_persona_vague",
    "anchor_plan_persona",
]

_failures = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global _failures
    if cond:
        print(f"  PA {label}")
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

    print("== FP-05 Step 1: four config keys (migration 0028, no schema) ==\n")

    mig = read(MIGRATION)
    check(f"{MIGRATION} exists", bool(mig))

    print("\n== A. Migration seeds ==")
    for key in KEYS:
        check(f"seeds {key}", f"'{key}'" in mig)
    # jsonb, not bare strings: the 0014/0027 leon is quoted literals for string values.
    check("persona values are quoted JSON strings",
          '\'"therapist_empath"\'' in mig and '\'"mentor_tough"\'' in mig)
    check("threshold is a JSON number", "'0.6'" in mig and "'\"0.6\"'" not in mig)
    check("idempotent upsert", "on conflict (key) do update" in mig)

    print("\n== B. Zero schema change ==")
    lowered = mig.lower()
    forbidden = ["create table", "alter table", "drop table", "create index",
                 "create policy", "alter policy", "add column", "drop column",
                 "create function", "enable row level security"]
    for frag in forbidden:
        check(f"no '{frag}'", frag not in lowered)

    print("\n== C. Personas match the runtime enum (ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§5.3) ==")
    guardrails = read("supabase/functions/_shared/prompts/guardrails.ts")
    m = re.search(r"export const PERSONA_KEYS\s*=\s*\[(.*?)\]", guardrails, re.S)
    enum = re.findall(r'"([a-z_]+)"', m.group(1)) if m else []
    check("PERSONA_KEYS parsed", len(enum) >= 3, f"found {enum}")
    for persona in ("therapist_empath", "mentor_tough"):
        check(f"'{persona}' is a persona key", persona in enum, f"enum={enum}")

    print("\n== D. Docs list the keys ==")
    tech = read("docs/TECH-SPEC.md")
    glo = read("docs/GLOSSARY.md")
    for key in KEYS:
        check(f"TECH-SPEC ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§11 lists {key}", key in tech)
        check(f"GLOSSARY ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§16 lists {key}", key in glo)

    print("\n== E. Read through config, never hardcoded ==")
    chain = read("supabase/functions/_shared/journal/runChain.ts")
    for helper, key in (
        ("getConfigNumber", "journal_probe_vagueness_threshold"),
        ("getConfigString", "journal_probe_persona_severe"),
        ("getConfigString", "journal_probe_persona_vague"),
    ):
        check(f"{helper}('{key}') in runChain", f'{helper}("{key}")' in chain)
    check("anchor_plan persona read from config",
          'getConfigString("anchor_plan_persona")' in chain)
    # The [SPEC] values must not appear as literal fallbacks beside the read.
    check("no literal 0.6 fallback in runChain", "?? 0.6" not in chain and "|| 0.6" not in chain)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
