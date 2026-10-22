#!/usr/bin/env python3
"""Automate FP-06 Step 3 verification (memory_extract: contract, backlog, slices).

Covers PLAN Step 3 Verify: "the script green; tsc + deno check + jest clean; static
asserts -- no trust_score/trust_events write anywhere in the diff, FAST_JOB_TYPES
unchanged by this step, no memory_facts writer outside runExtract."

  AUTOMATED -- static (no network):
    contract   : the section 4.3 chunk schema (facts[{text, source_message_id}],
                 openness_delta), the shape validator, the bounds+provenance validator
                 (0-32 facts, 5-500 chars, foreign source_message_id = hard reject,
                 never a rewrite), the delimited prompt with role markers and ids,
                 the dynamic stub factory registered against the contract validator
    call       : extract.ts binds the contract to llm.generate; exactly one bounded
                 retry on structural failure; transport fails immediately
    backlog    : loadMemoryBacklog derives the sliding-window cutoff from the newest
                 sliding_window_messages rows, reads aged-out rows (both roles), and
                 reads cited message ids batched; deriveBacklog drops unsavable rows
                 and cited rows (a purged message never re-extracts); slices at 32
    run        : runMemoryExtract inserts fact_type='chat' rows citing their message,
                 one batched embed per slice, embed_model stamped, throws on failure
                 (dispatcher backoff), logs one structured line with the rider logged
                 not applied; an empty backlog is a no-op with zero adapter calls
    registry   : the dispatcher's memory_extract case delegates via lazy import to
                 runMemoryExtract and is NOT in FAST_JOB_TYPES; the handler set is
                 exactly the nine implemented types
    writers    : the only files inserting into memory_facts are runChain.ts (FP-05
                 journal writer) and runExtract.ts (this step)
    tests      : the contract suite exists and covers provenance, resume, transport,
                 the factory

  NOT AUTOMATED: the live extraction drill (stub mode, planted thread, dispatcher
  ticks, foreign-stub reject, llm_force_fail recovery, empty-backlog no-op) needs
  deployed functions + a database; recorded in FP-06-ACCEPTANCE.

Usage: python scripts/verify-fp06-step3.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = "supabase/functions/_shared/memory/extractContract.ts"
EXTRACT = "supabase/functions/_shared/memory/extract.ts"
RUN = "supabase/functions/_shared/memory/runExtract.ts"
DISPATCHER = "supabase/functions/job-dispatcher/index.ts"
ADAPTER = "supabase/functions/_shared/llm/adapter.ts"
STUBSHAPES = "supabase/functions/_shared/llm/stubShapes.ts"
TEST = "supabase/functions/_shared/memory/extractContract.test.ts"

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

    print("== FP-06 Step 3: memory_extract (contract, backlog, slices) ==\n")

    contract = read(CONTRACT)
    extract = read(EXTRACT)
    run = read(RUN)
    disp = read(DISPATCHER)
    adapter = read(ADAPTER)
    stubs = read(STUBSHAPES)
    test = read(TEST)

    check(f"{CONTRACT} exists", bool(contract))
    if not contract:
        print("\nFAILED: contract module missing")
        return 1

    print("\n== A. The section 4.3 chunk contract ==")
    check("facts items carry text + source_message_id, both required",
          'source_message_id: { type: "string" }' in contract and 'required: ["text", "source_message_id"]' in contract)
    check("schema bounds: 0..32 facts", "minItems: 0" in contract and "MAX_FACTS_PER_SLICE" in contract)
    check("schema requires openness_delta", 'required: ["facts", "openness_delta"]' in contract)
    check("MAX_FACTS_PER_SLICE = 32", re.search(r"MAX_FACTS_PER_SLICE = 32", contract) is not None)
    check("text bounds 5..500", "MIN_FACT_CHARS = 5" in contract and "MAX_FACT_CHARS = 500" in contract)
    check("shape validator exists", "export function isChatFactsResult" in contract)
    check("bounds validator takes the slice ids", "parsed: ChatFactsResult,\n  sliceIds: ReadonlySet<string>," in contract)
    check("foreign citation is a hard reject, never a rewrite",
          "!sliceIds.has(fact.source_message_id)" in contract and "hard reject, never a rewrite" in contract)
    check("openness delta bounded -5..5", "parsed.openness_delta < -5 || parsed.openness_delta > 5" in contract)

    print("\n== B. Prompt (delimiters, role markers, ids, injection guard) ==")
    check("injection guard rides the system prompt", "INJECTION_GUARD" in contract and "CHAT_FACTS_SYSTEM" in contract)
    check("slice wrapped in user_message delimiters", "<user_message>" in contract and "</user_message>" in contract)
    check("per-message id + role markers", 'id="${m.id}" role="${m.role}"' in contract)
    check("extract-user-facts-only instruction", "never record Davos's own phrasings" in contract)
    check("empty facts allowed by the prompt", "Return an\nempty facts array" in contract)

    print("\n== C. Stub factory (dynamic arm, validator identity) ==")
    check("factory registered against the contract validator",
          "registerStubShapeFactory(isChatFactsResult, chatFactsStubPayload)" in contract)
    check("factory cites real slice ids (first and last)",
          "source_message_id: ids[0]" in contract and "source_message_id: ids[ids.length - 1]" in contract)
    check("stubContext rides the request", "stubContext: { sliceIds: messages.map((m) => m.id) }" in contract)
    check("adapter request carries stubContext", "stubContext?: unknown" in adapter)
    check("stubShapes exports the factory arm", "export function registerStubShapeFactory" in stubs)
    check("selectStubPayload dispatches factory entries", "typeof entry === \"function\"" in stubs)

    print("\n== D. The call (one bounded retry) ==")
    check("extract.ts binds llm.generate", "import { generate }" in extract and "extractChunkWith(generate" in extract)
    check("exactly two attempts (bounded)", "attempt < 2" in contract and "attempt < 3" not in contract)
    check("retry injects the validation errors", "VALIDATION ERRORS" in contract)
    check("transport fails immediately", 'res.kind === "transport"' in contract)
    check("second structural failure throws", "validation failed after retry" in contract and "failed after retry" in contract)

    print("\n== E. Backlog derivation (job time) ==")
    check("window read: newest sliding_window_messages rows",
          'getConfigNumber("sliding_window_messages")' in run
          and '.order("created_at", { ascending: false })' in run
          and ".limit(windowSize)" in run)
    check("cutoff is the window's oldest row", "windowRows[windowRows.length - 1].created_at" in run)
    check("short thread (fewer rows than the window) is a clean empty report", "windowRows.length < windowSize" in run)
    check("aged-out read is strictly older than the cutoff", '.lt("created_at", cutoff)' in run)
    check("both roles included (no role filter on candidates)", 'select("id, role, content, unsavable, created_at")' in run)
    check("cited ids read batched (bounded URL)", "CITED_READ_BATCH = 100" in run and '.in("source_message_id", batch)' in run)
    check("deriveBacklog drops unsavable rows", "m.unsavable !== true" in contract)
    check("deriveBacklog drops cited rows (purged still count)",
          "!citedMessageIds.has(m.id)" in contract and "a purged message never re-extracts" in contract)
    check("slices at 32 messages", "SLICE_SIZE = 32" in contract and "sliceBacklog" in contract)

    print("\n== F. The run (writes, embed, log, failure semantics) ==")
    check("missing user_id throws (job failure, not silent)", "missing user_id in payload" in run)
    check("empty backlog is a no-op", 'outcome: "no-op"' in run)
    check("facts inserted with fact_type chat + provenance", 'fact_type: "chat" as const' in run and "source_message_id: f.source_message_id" in run)
    check("one batched embed per slice", "await embed(facts.map((f) => f.text))" in run)
    check("embed_model stamped with the frozen fallback", 'FROZEN_EMBED_MODEL = "gemini-embedding-001@768"' in run)
    check("embedding stamped per fact row", "updateData.embedding = embeddings[i]" in run)
    check("insert failure throws (dispatcher backoff)", "facts insert failed" in run)
    check("stamp failure throws", "embed stamp failed" in run)
    check("one structured log line per run with the rider logged-not-applied",
          'tag: RUN_LOG_TAG' in run and 'openness_delta_rider: "logged_not_applied"' in run)
    check("log carries boundary, windowCutoff, candidates, slices, messages, facts",
          all(k in run for k in ("boundary,", "windowCutoff,", "candidates,", "slices: slices.length", "messages: messagesProcessed", "facts: factsWritten")))
    check("no jobs insert in runExtract (zero new job types)", '.from("jobs")' not in run)
    check("no trust_score/trust_events write", "trust_score" not in run and "trust_events" not in run)

    print("\n== G. Dispatcher registry ==")
    check("memory_extract delegates via lazy import",
          "memory_extract: async (payload, job) => {" in disp and "await import('../_shared/memory/runExtract.ts')" in disp
          and "await runMemoryExtract(payload, job)" in disp)
    m = re.search(r"const FAST_JOB_TYPES = new Set\(\[([^\]]*)\]\)", disp)
    members = [s.strip().strip("'") for s in (m.group(1).split(",") if m else []) if s.strip()]
    check("memory_extract NOT in FAST_JOB_TYPES", "memory_extract" not in members, f"members={members}")
    handlers_block = re.search(r"const HANDLERS:[\s\S]*?\n\};", disp)
    handlers = set(re.findall(r"^  ([a-z_]+):", handlers_block.group(0), re.M)) if handlers_block else set()
    check("handler set is exactly the fourteen implemented types (FP-07 adds metric_eval; FP-08 adds drift_scan, quest_expire, strike_fire, histogram_daily)",
          handlers == {"smoke_test", "llm_retry", "watchdog_checkin", "intervention",
                       "journal_extract", "journal_probe", "anchor_plan",
                       "purge_memory", "memory_extract", "metric_eval",
                       "drift_scan", "quest_expire", "strike_fire", "histogram_daily"},
          f"{sorted(handlers)}")

    print("\n== H. Sole memory_facts writer ==")
    writers = set()
    for base in ("supabase/functions",):
        for dirpath, _dirs, files in os.walk(os.path.join(ROOT, base)):
            for fname in files:
                if not fname.endswith(".ts") or fname.endswith(".test.ts"):
                    continue
                p = os.path.join(dirpath, fname)
                with open(p, encoding="utf-8", errors="replace") as fh:
                    body = fh.read()
                if re.search(r'\.from\("memory_facts"\)\s*\n?\s*\.insert', body) or ".from('memory_facts')\n      .insert" in body:
                    writers.add(os.path.relpath(p, ROOT).replace("\\", "/"))
    check("only runChain.ts + runExtract.ts insert memory_facts, plus FP-08's oath capture in send-message",
          writers == {"supabase/functions/_shared/journal/runChain.ts",
                      "supabase/functions/_shared/memory/runExtract.ts",
                      "supabase/functions/send-message/index.ts"},
          f"{sorted(writers)}")

    print("\n== I. Tests ==")
    check("contract suite exists", bool(test))
    for label, needle in (
        ("provenance hard-reject case", "hard-rejects a foreign source_message_id"),
        ("resume semantics case", "extracts only the remainder"),
        ("transport no-retry case", "fails immediately on transport"),
        ("factory case", "registered against the contract validator"),
        ("backlog unsavable case", "drops unsavable rows"),
        ("slice bound case", "slices at 32 messages"),
    ):
        check(label, needle in test)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
