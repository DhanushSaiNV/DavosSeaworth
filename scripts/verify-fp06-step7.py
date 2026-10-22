#!/usr/bin/env python3
"""Automate FP-06 Step 7 verification (live drill surface, write-backs, acceptance ledger).

Covers PLAN Step 7 Verify: "every AC marked with evidence (drill-judged rows may sit at
pending the owner drill); write-back diffs present; all regression legs green; repo clean."

  AUTOMATED -- static (no network):
    drill      : dev-smoke gains `action=memory-drill` with the four legs, driving the
                 same shared runners the handlers use: backlog -> loadMemoryBacklog,
                 extract -> runMemoryExtract, retrieve -> the kill switch then embed +
                 loadMemoryContext, purge -> runPurgeMemory; no direct table writes in
                 the drill; the existing DEV_SMOKE_TOKEN gate still covers it
    runners    : runPurgeMemory lives in _shared/memory/purge.ts (guarded UPDATE, oath
                 exemption, idempotent, count report) and the dispatcher delegates to it;
                 runMemoryExtract returns ExtractRunReport on both exits
    acceptance : FP-06-ACCEPTANCE.md exists; its AC ids equal FP-06.md's (AC-1..AC-11);
                 the evidence tags and the eight required recorded readings are present;
                 the runbook names all four legs; the write-back ledger and re-run recipe
                 exist
    writeback  : TECH-SPEC 2.3 (15 types / nine handlers), 5.1-5.2 (memory slot),
                 7.6 (unprompted exclusion + shared purge runner); GLOSSARY 12/13/15/16
                 (memory-drill, the new identifiers, both config keys); PLAN rows marked
                 source-complete
    hygiene    : migration 0029 adds no table; registry still 15; FAST membership exact;
                 no secret literals in the touched files; no trust_score in the new code

  NOT AUTOMATED: the owner drill itself (16-message conversation, fact-quality judgment,
  web flag loop, outages) -- recorded in FP-06-ACCEPTANCE section 4.

Usage: python scripts/verify-fp06-step7.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEV_SMOKE = "supabase/functions/dev-smoke/index.ts"
DISPATCHER = "supabase/functions/job-dispatcher/index.ts"
PURGE = "supabase/functions/_shared/memory/purge.ts"
RUN_EXTRACT = "supabase/functions/_shared/memory/runExtract.ts"
TECH = "docs/TECH-SPEC.md"
GLOSS = "docs/GLOSSARY.md"
PLAN = "docs/feature-prds/FP-06/FP-06-PLAN.md"
PRD = "docs/feature-prds/FP-06/FP-06.md"
ACCEPT = "docs/feature-prds/FP-06/FP-06-ACCEPTANCE.md"
MIGRATION = "supabase/migrations/0029_memory_fp06.sql"

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

    print("== FP-06 Step 7: live drill surface, write-backs, AC sweep ==\n")

    smoke = read(DEV_SMOKE)
    disp = read(DISPATCHER)
    purge = read(PURGE)
    run_extract = read(RUN_EXTRACT)
    tech = read(TECH)
    gloss = read(GLOSS)
    plan = read(PLAN)
    prd = read(PRD)
    accept = read(ACCEPT)
    migration = read(MIGRATION)

    print("== A. dev-smoke memory-drill (four legs over the shared runners) ==")
    check("action in the request union", '| "memory-drill"' in smoke and '| "metric-drill";' in smoke)
    check("action in the available list", '"memory-drill",' in smoke)
    m = re.search(r'case "memory-drill": \{(.*?)\n      \}\n', smoke, re.S)
    drill = m.group(1) if m else ""
    check("memory-drill case exists", bool(drill))
    check("backlog leg drives loadMemoryBacklog", 'leg === "backlog"' in drill and "await loadMemoryBacklog(user as string)" in drill)
    check("backlog reports both roles", "userMessages:" in drill and "assistantMessages:" in drill)
    check("extract leg drives runMemoryExtract", 'leg === "extract"' in drill and "await runMemoryExtract(" in drill)
    check("extract echoes the run report", "...report" in drill)
    check("retrieve leg checks the kill switch first", 'leg === "retrieve"' in drill and "await memoryRetrievalEnabled()" in drill)
    check("retrieve reuses a fresh embed + loadMemoryContext", "await embed([text])" in drill and "await loadMemoryContext(user as string, embedRes.data.embeddings[0])" in drill)
    check("retrieve returns the rendered block", "block: load.memoryContext ?? null" in drill)
    check("purge leg drives runPurgeMemory", 'leg === "purge"' in drill and "await runPurgeMemory({ message_id: messageId })" in drill)
    check("unknown leg fails loudly", "unknown leg" in drill)
    check("no direct table writes in the drill", '.from("memory_facts")' not in drill and ".insert(" not in drill and ".update(" not in drill)
    check("still behind the DEV_SMOKE_TOKEN gate", 'Bearer ${DEV_SMOKE_TOKEN}' in smoke)

    print("\n== B. Shared runners (one implementation, drillable) ==")
    check("purge runner exists", bool(purge))
    check("dispatcher imports it", 'from \'../_shared/memory/purge.ts\'' in disp)
    check("purge case delegates", "runPurgeMemory({ message_id: messageId })" in disp)
    check("guarded UPDATE: provenance + unpurged + oath", '.eq("source_message_id", messageId)' in purge and '.is("purged_at", null)' in purge and '.neq("fact_type", "oath")' in purge)
    check("soft delete only (no row delete, no re-embed)", ".delete(" not in purge and "embedding" not in purge)
    check("count report (0 on a re-run)", "purged: data?.length ?? 0" in purge)
    check("extract runner declares its report", "export interface ExtractRunReport" in run_extract)
    check("both exits return the report", run_extract.count("windowCutoff,") >= 3 and "opennessDelta:" in run_extract)
    check("dispatcher still awaits the shared extractor", "await runMemoryExtract(payload, job)" in disp)

    print("\n== C. Acceptance ledger (ids parsed from FP-06.md) ==")
    prd_ids = sorted(set(re.findall(r"^\| (AC-\d+) \|", prd, re.M)), key=lambda s: int(s.split("-")[1]))
    acc_ids = sorted(set(re.findall(r"^\| (AC-\d+) \|", accept, re.M)), key=lambda s: int(s.split("-")[1]))
    expected = [f"AC-{i}" for i in range(1, 12)]
    check("FP-06.md lists AC-1..AC-11", prd_ids == expected, f"prd={prd_ids}")
    check("acceptance ledger matches FP-06.md exactly", acc_ids == prd_ids, f"acc={acc_ids}")
    check("evidence tags present", "[script]" in accept and "[owner-observed]" in accept and "[derived]" in accept)
    for label in (
        "All-user-roles boundary count",
        "Both-roles backlog",
        "Validator bounds",
        "Slice bound",
        "One-way flag",
        "Unprompted-turns exclusion",
        "PATCH-bypass live item",
        "Doings seam",
    ):
        check(f"recorded reading: {label}", label in accept)
    check("drill-judged rows pending, not invented",
          ("web drill pending owner" in accept) and ("live drill pending" in accept))
    check("runbook names all four legs", all(f"leg={leg}" in accept for leg in ("backlog", "extract", "retrieve", "purge")))
    check("write-back ledger present", "Write-Back Ledger" in accept and "fe7ddf2" in accept)
    check("re-run recipe present", "Re-run Recipe" in accept and "verify-fp06-step7.py" in accept)

    print("\n== D. Doc write-backs ==")
    check("TECH-SPEC 2.3 counts (15 types, ten handlers)", "15 registered types" in tech and "ten" in tech)
    check("TECH-SPEC 5.1 memory slot", "Recalled-memory slot" in tech and "byte-identical to FP-05" in tech)
    check("TECH-SPEC 5.2 same-slot note", "The same stage-3 slot also carries" in tech)
    check("TECH-SPEC 7.6 unprompted exclusion", "unprompted generations stay memory-free" in tech)
    check("TECH-SPEC 7.6 shared purge runner", "runPurgeMemory" in tech)
    check("GLOSSARY 12 still 15 types", "complete 15-type registry" in gloss)
    check("GLOSSARY 12 purge runner note", "_shared/memory/purge.ts" in gloss)
    check("GLOSSARY 13 memory-drill", "memory-drill" in gloss and "leg=backlog" in gloss)
    check("GLOSSARY 15 identifiers", all(k in gloss for k in ("recalled_memory", "memoryProbe", "runPurgeMemory", "FlagState")))
    check("GLOSSARY 16 both config keys", "memory_fact_top_k" in gloss and "memory_retrieval_enabled" in gloss)
    plan_rows = re.findall(r"^\| (\d) \|.*\| (.) \|$", plan, re.M)
    check("PLAN rows marked source-complete", len(plan_rows) == 8 and all(mark == "\u25b6" for _, mark in plan_rows),
          f"rows={plan_rows}")

    print("\n== E. Hygiene (AGENTS section 9) ==")
    check("migration 0029 adds no table", "create table" not in migration.lower())
    check("registry still 15 rows in 2.3", len(re.findall(r"^\| `[a-z_]+` \|", tech.split("### 2.3")[1].split("**Daily invocation budget")[0], re.M)) == 15)
    m2 = re.search(r"const FAST_JOB_TYPES = new Set\(\[(.*?)\]\)", disp)
    members = [s.strip().strip("'") for s in (m2.group(1).split(",") if m2 else []) if s.strip()]
    check("FAST_JOB_TYPES (5 members after FP-07's metric_eval and FP-08's drift_scan)",
          members == ["smoke_test", "watchdog_checkin", "purge_memory", "metric_eval", "drift_scan"],
          f"members={members}")
    secrets = re.compile(r"(AIza[0-9A-Za-z_\-]{20,}|eyJ[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{20,})")
    touched = [DEV_SMOKE, DISPATCHER, PURGE, RUN_EXTRACT, ACCEPT]
    check("no secret literals in the touched files", not any(secrets.search(read(p)) for p in touched))
    check("no trust_score in the memory handlers (dev-smoke may echo it for the FP-08 drills)",
          all("trust_score" not in read(p) for p in (PURGE, run_extract)))

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
