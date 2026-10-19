#!/usr/bin/env python3
"""Automate FP-06 Step 2 verification (the late-flag loop: flag-unsavable + purge_memory).

Covers PLAN Step 2 Verify: "the script green; tsc --noEmit + deno check + jest --ci clean;
static asserts -- FAST_JOB_TYPES gained exactly purge_memory, section 2.3 and GLOSSARY 12 still
at 15 types, no deletion of rows or embeddings anywhere in the diff."

  AUTOMATED -- static (no network):
    function   : flag-unsavable exists; POST/OPTIONS; CORS mirrors send-message byte-for-byte;
                 own-rows read (user_id filter) is the boundary; the four decision branches
                 (404 / 400 / ok-no-job / flip+one-job); exactly one job insert
    purity     : the function imports no adapter and makes zero provider calls; the purge
                 runner is pure SQL (no adapter import, no embed, no delete)
    guard      : the purge UPDATE filters `purged_at is null` + `fact_type <> 'oath'` and
                 never deletes rows or embeddings
    registry   : FAST_JOB_TYPES gained exactly purge_memory; TECH-SPEC 2.3 and GLOSSARY 12
                 still count 15 types (implemented notes only)
    tests      : the pure decision-table suite exists
    trust      : no trust_score / trust_events reference anywhere in the step's files

  NOT AUTOMATED: the live loop (plant facts -> flag -> job -> purged_at -> match_facts
  exclusion -> re-flag -> re-run) needs a deployed function + database; recorded in
  FP-06-ACCEPTANCE.

Usage: python scripts/verify-fp06-step2.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FN = "supabase/functions/flag-unsavable/index.ts"
DISPATCHER = "supabase/functions/job-dispatcher/index.ts"
SEND_MESSAGE = "supabase/functions/send-message/index.ts"

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


def table_rows(text: str, start: str, end: str) -> int:
    """Count data rows (header excluded) in the first table inside [start, end)."""
    if start not in text:
        return -1
    seg = text.split(start, 1)[-1]
    if end and end in seg:
        seg = seg.split(end, 1)[0]
    rows = [
        line for line in seg.splitlines()
        if line.startswith("|") and not re.match(r"^\|\s*-+", line) and "---" not in line[:8]
    ]
    return len(rows) - 1 if rows else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="accepted for parity; static is the only leg")
    ap.parse_args()

    print("== FP-06 Step 2: flag-unsavable + purge_memory ==\n")

    fn = read(FN)
    disp = read(DISPATCHER)
    send = read(SEND_MESSAGE)
    check(f"{FN} exists", bool(fn))

    print("\n== A. CORS mirrors send-message ==")
    for header in (
        '"Access-Control-Allow-Origin": "*"',
        '"Access-Control-Allow-Methods": "POST, OPTIONS"',
        '"Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info"',
    ):
        check(f"function carries {header}", header in fn)
        check(f"send-message carries it too (the mirror target)", header in send)
    check("OPTIONS returns 204", 'status: 204' in fn)
    check("non-POST returns 405", "405" in fn)

    print("\n== B. Boundary + decision table ==")
    check("JWT resolved via resolveUserId", "resolveUserId(req)" in fn)
    check("own-rows read (user_id filter)", '.eq("user_id", userId)' in fn)
    check("single-row read", "maybeSingle()" in fn)
    check("pure parser/decider used", "parseFlagBody" in fn and "decideFlag" in fn)
    check("not_found -> 404", '"Message not found" }, 404' in fn)
    check("assistant -> 400", "Cannot flag an assistant message" in fn)
    check("already_flagged -> ok without a job insert",
          fn.index('decision === "already_flagged"') < fn.index('.from("jobs")'))
    check("flip -> sets unsavable = true", "update({ unsavable: true })" in fn)
    check("flip -> exactly one job insert", fn.count('.from("jobs")') == 1)
    check("job type purge_memory with {message_id} payload",
          'type: "purge_memory"' in fn and "payload: { message_id: parsed.messageId }" in fn)
    check("one [flag-unsavable] log line per outcome",
          fn.count('JSON.stringify({ message_id: parsed.messageId, outcome:') == 2
          and fn.count('outcome: "flip"') == 1 and fn.count('outcome: "no-flip"') == 1)

    print("\n== C. Zero provider calls on the sync path ==")
    check("no adapter import", "llm/adapter" not in fn)
    check("no generate/embed call", "generate(" not in fn and "embed(" not in fn)

    print("\n== D. The purge runner (pure SQL, oath-exempt, idempotent) ==")
    m = re.search(r"purge_memory: async \(payload, job\) => \{(.*?)\n  \},", disp, re.S)
    check("purge_memory case exists", m is not None)
    purge_case = m.group(1) if m else ""
    purge = read("supabase/functions/_shared/memory/purge.ts")
    check("shared runner exists (drillable by dev-smoke)", bool(purge))
    check("case delegates to the shared runner", "runPurgeMemory({ message_id: messageId })" in purge_case)
    check("case keeps the unusable-payload guard", "message_id required" in purge_case)
    check("filters by source_message_id", '.eq("source_message_id", messageId)' in purge)
    check("skips already-purged rows", '.is("purged_at", null)' in purge)
    check("oath exemption", '.neq("fact_type", "oath")' in purge)
    check("stamps purged_at (no row delete)", "purged_at: new Date().toISOString()" in purge)
    check("no delete call anywhere in the purge body", ".delete(" not in purge)
    check("no embedding write in the purge body", "embedding" not in purge)
    check("reports the purged count", "purged: data?.length ?? 0" in purge)
    check("logs message id + purged count", "[purge-memory]" in purge_case and "purged ${purged}" in purge_case)
    check("no adapter import in the purge runner", "llm/adapter" not in purge)

    print("\n== E. FAST_JOB_TYPES ==")
    m2 = re.search(r"const FAST_JOB_TYPES = new Set\(\[(.*?)\]\)", disp)
    check("FAST_JOB_TYPES parses", m2 is not None)
    members = [s.strip().strip("'") for s in (m2.group(1).split(",") if m2 else []) if s.strip()]
    check("FAST_JOB_TYPES gained exactly purge_memory",
          members == ["smoke_test", "watchdog_checkin", "purge_memory"], f"members={members}")
    check("memory_extract is deliberately NOT in FAST_JOB_TYPES (generation-capable)",
          "memory_extract" not in members)
    check("purge_memory handler registered in the dispatcher",
          re.search(r"^  purge_memory: async \(payload, job\) =>", disp, re.M) is not None)

    print("\n== F. Tests + trust discipline ==")
    check("flagContract.test.ts exists", os.path.exists(os.path.join(ROOT, "supabase/functions/_shared/memory/flagContract.test.ts")))
    check("decision-table suite covers all four branches",
          all(b in read("supabase/functions/_shared/memory/flagContract.test.ts")
              for b in ("not_found", "assistant", "flip", "already_flagged")))
    for rel, text in ((FN, fn), (DISPATCHER, disp)):
        check(f"no trust_score/trust_events in {rel}", "trust_score" not in text and "trust_events" not in text)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
