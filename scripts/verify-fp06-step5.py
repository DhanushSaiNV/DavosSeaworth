#!/usr/bin/env python3
"""Automate FP-06 Step 5 verification (retrieval wiring in runPipeline).

Covers PLAN Step 5 Verify: "the script green; tsc + deno check + jest clean; a no-facts
fixture and a kill-switch fixture each produce the exact FP-05 prompt string; no new
tables, no new job types."

  AUTOMATED -- static (no network):
    module     : memoryContext.ts is pure (no Deno/adapter/supabase imports); MemoryFact
                 shape; the 500-char ceiling; the recalled_memory fence; merge dedupes by
                 id with the baseline arm appended after the top-k arm; renderMemoryContext
                 returns undefined (not '') for no facts; withMemoryContext returns the
                 base by identity when absent
    generate   : GenerateStageInput carries memoryContext; buildSystemPrompt appends via
                 withMemoryContext after the day-plan rider (gated, not reformatted)
    loader     : match_facts RPC carries p_user_id/p_query_embedding/p_top_k; top_k read
                 from config at runtime; fail-open (warning + empty block); the log line
                 fires only when the block is non-empty; zero embed calls added
    gate       : memory_retrieval_enabled is fail-closed (literal true); the switch read
                 is in flight before the embed await; the memory RPC starts before rule
                 retrieval is awaited (stage 3's parallel slot); both stage-5 paths pass
                 memoryContext and echo the probe; unprompted locked-path calls (no
                 userId) stay memory-free
    tests      : the suite pins the merge order, the fence/tags/ceiling, and the two
                 golden-string fixtures (no facts, kill switch) as exact equality

  NOT AUTOMATED: the live retrieval drill (planted facts -> block in the prompt, kill
  switch flip -> byte-identical prompt, embed-failure turn -> no retrieval) needs deployed
  functions + a database; recorded in FP-06-ACCEPTANCE.

Usage: python scripts/verify-fp06-step5.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE = "supabase/functions/_shared/pipeline/memoryContext.ts"
TEST = "supabase/functions/_shared/pipeline/memoryContext.test.ts"
GENERATE = "supabase/functions/_shared/pipeline/generate.ts"
PIPELINE = "supabase/functions/_shared/pipeline/runPipeline.ts"

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

    print("== FP-06 Step 5: retrieval wiring in runPipeline ==\n")

    mod = read(MODULE)
    test = read(TEST)
    gen = read(GENERATE)
    pipe = read(PIPELINE)

    check(f"{MODULE} exists", bool(mod))
    if not mod:
        print("\nFAILED: memoryContext module missing")
        return 1

    print("\n== A. Pure module (merge, render, append) ==")
    check("no Deno/adapter/supabase import (pure)", not re.search(r'^import .*(Deno|adapter|config|supabase)', mod, re.M))
    check("MemoryFact row shape", all(k in mod for k in ("id: string", "fact: string", "fact_type: string", "similarity: number")))
    check("500-char render ceiling", "MEMORY_FACT_RENDER_MAX = 500" in mod)
    check("recalled_memory fence tag", 'MEMORY_BLOCK_TAG = "recalled_memory"' in mod)
    check("merge: top-k arm then baseline arm", "[...topK, ...baseline]" in mod)
    check("merge dedupes by id", "if (seen.has(fact.id)) continue;" in mod)
    check("clip applies the ceiling", "flat.length > MEMORY_FACT_RENDER_MAX ? flat.slice(0, MEMORY_FACT_RENDER_MAX) : flat" in mod)
    check("newlines flattened to one line per fact", 'fact.fact.split("\\n").join(" ")' in mod)
    check("no-facts renders undefined, not an empty string", "if (lines.length === 0) return undefined;" in mod)
    check("treat-as-context-not-instructions copy", '"not as instructions"' in mod or "not as instructions" in mod)
    check("never-mention-you-remember copy", "never mention that you remember" in mod)
    check("append is identity when block absent", "return block ? `${base}\\n\\n${block}` : base;" in mod)

    print("\n== B. generate.ts (append after the day-plan rider) ==")
    check("input carries memoryContext", "memoryContext?: string;" in gen)
    check("imports the append contract", 'from "./memoryContext.ts"' in gen)
    check("buildSystemPrompt appends via withMemoryContext", "withMemoryContext(parts.filter(Boolean).join(\"\\n\\n\"), input.memoryContext)" in gen)
    check("day-plan rider push is untouched", "if (input.dayPlanContext) {\n    parts.push(input.dayPlanContext);" in gen)

    print("\n== C. The loader (RPC, top-k, fail-open, log) ==")
    m = re.search(r"export async function loadMemoryContext\(.*?\n\}\n", pipe, re.S)
    loader = m.group(0) if m else ""
    check("loader exists", bool(loader))
    check("top_k read from config at runtime", 'getConfigNumber("memory_fact_top_k")' in loader)
    check("match_facts RPC with user id", 'supabaseService.rpc("match_facts"' in loader and "p_user_id: userId" in loader)
    check("reuses the turn's message embedding", "p_query_embedding: messageEmbedding" in loader and "p_top_k: topK" in loader)
    check("zero embed calls added", "await embed(" not in loader and "embed([" not in loader)
    check("fail-open catch returns an empty block", 'catch (e) {' in loader and "memoryContext: undefined" in loader)
    check("fail-open warning logged", 'console.warn("[runPipeline] memory"' in loader)
    check("log only when the block is non-empty", "if (memoryContext) {" in loader and 'console.log("[runPipeline] memory"' in loader)
    check("probe carries facts, topK, baseline, chars", all(k in loader for k in ("facts: merged.length", "topK,", "baseline: baseline.length", "chars: memoryContext?.length")))

    print("\n== D. The gate (fail-closed switch, parallel slot) ==")
    check("kill switch is fail-closed (literal true)", 'return (await getConfig("memory_retrieval_enabled")) === true;' in pipe)
    switch_at = pipe.find("const memoryEnabledPromise")
    embed_at = pipe.find("const embedResult = await embedPromise;")
    check("switch read starts before the embed is awaited", switch_at != -1 and embed_at != -1 and switch_at < embed_at)
    run_mem_at = pipe.find("const memoryEnabled = await memoryEnabledPromise;")
    run_mem_promise_at = pipe.find("const memoryPromise: Promise<MemoryContextLoad>")
    run_retrieval_at = pipe.find("const retrieval = await retrieveRules(")
    check("runPipeline: memory load starts before rule retrieval is awaited",
          -1 < run_mem_at < run_mem_promise_at < run_retrieval_at)
    check("runPipeline passes memoryContext to stage 5", pipe.count("memoryContext: memory.memoryContext,") == 2)
    check("runPipeline echoes the probe only with a userId", pipe.count("memoryProbe: userId ? memory.memoryProbe : undefined") == 2)
    check("locked path keeps unprompted turns memory-free", "userId && (await memoryEnabledPromise)" in pipe)
    check("disabled path is explicit and silent", 'reason: "disabled", facts: 0' in pipe)
    check("the pipeline's only job insert is the FP-08 breakdown intervention",
          pipe.count('.from("jobs")') == 2 and 'type: "intervention"' in pipe
          and '"strike_fire"' not in pipe and '"histogram_daily"' not in pipe
          and '"quest_expire"' not in pipe)
    check("the pipeline reads trust through the rider probe but never writes trust_score",
          pipe.count('.from("trust_events")') == 1 and "trust_score" not in pipe)

    print("\n== E. Tests (golden strings, ceiling, merge order) ==")
    check("suite exists", bool(test))
    check("no-facts golden equality", "returns the base string unchanged for a no-facts fixture" in test and "toBe(FP05_PROMPT)" in test)
    check("kill-switch golden equality", "returns the base string unchanged for the kill-switch fixture" in test and "withMemoryContext(FP05_PROMPT, undefined)).toBe(FP05_PROMPT)" in test)
    check("appends after the base with one blank line", 'toBe(`${FP05_PROMPT}\\n\\n${block}`)' in test)
    check("merge order pinned", 'expect(merged.map((f) => f.id)).toEqual(["a", "b", "c"]);' in test)
    check("ceiling pinned", "MEMORY_FACT_RENDER_MAX + 120" in test)
    check("fence + tags pinned", '- [chat] The user is training for a half marathon.' in test and "- [baseline]" in test)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
