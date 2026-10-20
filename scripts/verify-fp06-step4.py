#!/usr/bin/env python3
"""Automate FP-06 Step 4 verification (the send-message boundary trigger).

Covers PLAN Step 4 Verify: "the script green; tsc + deno check + jest clean; git diff
shows exactly one existing function file touched by this step (send-message/index.ts);
submit-checkin and submit-journal untouched."

  AUTOMATED -- static (no network):
    module     : the pure boundary rule (positive multiples of the window, fail-closed
                 guards) and the payload builder, with the scripted-thread walk test
    hook       : send-message imports the pure module, the helper counts user-role rows
                 (Postgres count(*), head) after the fresh row lands, reads
                 sliding_window_messages from config, inserts exactly one memory_extract
                 job with {user_id, boundary}, and logs the enqueue
    discipline : the call site sits inside the fresh-insert branch (after the insert,
                 before the repair branch), wrapped in a non-fatal try/catch; zero
                 provider calls added (no llm import in the hook path)
    touch      : the only function file enqueueing memory_extract is send-message;
                 submit-checkin / submit-journal carry no boundary code
    tests      : the boundary suite exists with the count table and the walk

  NOT AUTOMATED: the live 16-message drill (jobs at 8 and 16 exactly, duplicate/replay
  legs move nothing, per-turn adapter log count unchanged, sync p50 band) needs deployed
  functions + a database; recorded in FP-06-ACCEPTANCE.

Usage: python scripts/verify-fp06-step4.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE = "supabase/functions/_shared/memory/boundary.ts"
TEST = "supabase/functions/_shared/memory/boundary.test.ts"
SEND = "supabase/functions/send-message/index.ts"

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

    print("== FP-06 Step 4: send-message boundary trigger ==\n")

    mod = read(MODULE)
    test = read(TEST)
    send = read(SEND)

    check(f"{MODULE} exists", bool(mod))
    if not mod:
        print("\nFAILED: boundary module missing")
        return 1

    print("\n== A. Pure rule + payload ==")
    check("positive-multiple rule", "count % windowSize === 0" in mod and "count > 0" in mod)
    check("fail-closed guards (non-finite, non-positive window)", "Number.isFinite" in mod and "windowSize <= 0" in mod)
    check("payload builder carries user_id + boundary", "user_id: userId, boundary" in mod.replace("\n", " ") or "{ user_id: userId, boundary }" in mod)

    print("\n== B. The hook (count, config, exactly one job) ==")
    check("imports the pure module", 'from "../_shared/memory/boundary.ts"' in send)
    check("helper exists", "async function maybeEnqueueMemoryExtract(userId: string)" in send)
    m = re.search(r"async function maybeEnqueueMemoryExtract\(.*?\n\}\n", send, re.S)
    hook = m.group(0) if m else ""
    check("counts user-role rows via Postgres count(*), head read",
          'select("id", { count: "exact", head: true })' in hook and '.eq("role", "user")' in hook)
    check("count scoped to the user", '.eq("user_id", userId)' in hook)
    check("window read from config", 'getConfigNumber("sliding_window_messages")' in hook)
    check("decision via the pure rule", "shouldExtractAtBoundary(boundary, windowSize)" in hook)
    check("exactly one memory_extract job insert", hook.count('.from("jobs")') == 1 and 'type: "memory_extract"' in hook)
    check("payload via the builder", "buildMemoryExtractPayload(userId, boundary)" in hook)
    check("enqueue is logged with the boundary", "memory_extract enqueued" in hook and "JSON.stringify({ boundary })" in hook)

    print("\n== C. Zero provider calls on the sync path ==")
    check("no adapter import in the helper", "llm/adapter" not in hook)
    check("no generate/embed call in the helper", "generate(" not in hook and "embed(" not in hook)

    print("\n== D. Fresh-insert clause discipline ==")
    fresh = send.find("if (inserted && inserted.length > 0) {")
    call = send.find("await maybeEnqueueMemoryExtract(userId)")
    repair = send.find("// Repeat send. Locate the existing user row.")
    check("all three anchors found", fresh != -1 and call != -1 and repair != -1)
    check("hook is inside the fresh-insert branch (after insert, before repair)", fresh < call < repair)
    call_slice = send[call - 240 : call + 400]
    check("hook is non-fatal (try/catch with a warning)",
          "try {" in call_slice and "catch (err)" in call_slice and "console.warn(" in call_slice)

    print("\n== E. Touch surface ==")
    checkin = read("supabase/functions/submit-checkin/index.ts")
    journal = read("supabase/functions/submit-journal/index.ts")
    check("submit-checkin carries no boundary code", "memory_extract" not in checkin)
    check("submit-journal carries no boundary code", "memory_extract" not in journal)
    enqueuers = []
    for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "supabase/functions")):
        for fname in files:
            if not fname.endswith(".ts"):
                continue
            p = os.path.join(dirpath, fname)
            with open(p, encoding="utf-8", errors="replace") as fh:
                if 'type: "memory_extract"' in fh.read():
                    enqueuers.append(os.path.relpath(p, ROOT).replace("\\", "/"))
    check("only send-message enqueues memory_extract", enqueuers == ["supabase/functions/send-message/index.ts"], f"{enqueuers}")

    print("\n== F. Tests ==")
    check("boundary suite exists", bool(test))
    check("count table 7/8/9 pinned", "[7, 8, 9, 15, 16, 17, 24]" in test and "[8, 16, 24]" in test)
    check("scripted-thread walk pinned", "boundaries).toEqual([8, 16])" in test)
    check("check-in-sourced row counts", 'source: "checkin"' in test)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
