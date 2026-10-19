#!/usr/bin/env python3
"""Automate FP-05 Step 4 verification (the `journal_probe` handler).

Covers PLAN Step 4 Verify: "vague fixture ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ persona journal_probe_persona_vague; S2 fixture ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢
journal_probe_persona_severe; exactly one unprompted row per entry with the right metadata;
exactly one default-priority push attempt logged (and none when expo_push_enabled=false);
`probed` set; a re-claim of the same job writes nothing (pre-check); the probe's generation
carries no chips/options (an unprompted row is not a Medium turn ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡5.3)".

  AUTOMATED -- static (no network):
    handler    : `runJournalProbe` exists, loads the entry, selects the persona from the two
                 config keys by severity, generates on the locked-persona surface (General /
                 D7 fallback), and writes one unprompted row (reply_to_message_id null)
    metadata   : source='journal_probe' + entry_id + severity + persona + domain + rule_ids
                 + source_job_id (the watchdog-window audit shape)
    ordering   : pre-check BEFORE generation; `probed=true` AFTER the row write
    push       : exactly one sendPush, default priority, `davos://chat`, 5s bounded race,
                 no `priority: "high"` anywhere in the file
    registry   : journal_probe delegates to runChain; NOT in FAST_JOB_TYPES
    no chips   : no route/options/chips construction on this path

  NOT AUTOMATED: the live fixtures (persona per severity, one row per entry, push attempt,
  re-claim no-op) need a deployed dispatcher + stub mode; recorded in FP-05-ACCEPTANCE ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡5.

Usage: python scripts/verify-fp05-step4.py [--static-only]
"""

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAIN = "supabase/functions/_shared/journal/runChain.ts"
DISPATCHER = "supabase/functions/job-dispatcher/index.ts"
PROBE_CTX = "supabase/functions/_shared/journal/probeContext.ts"

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

    print("== FP-05 Step 4: journal_probe handler ==\n")

    chain = read(CHAIN)
    dispatcher = read(DISPATCHER)
    probe_ctx = read(PROBE_CTX)

    check(f"{CHAIN} exists", bool(chain))
    # The PLAN named a pure `probeContext.ts`; the implementation did not add one. The entry text
    # is still delimited, because stage 5 fences *every* user Message centrally ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â so aert the
    # fence rather than a module that was never built (the deviation is recorded in the AC ledger).
    generate = read("supabase/functions/_shared/pipeline/generate.ts")
    check("user text is delimited centrally (<user_message>)",
          "<user_message>" in generate and "</user_message>" in generate)
    check("probe paes the entry content as the turn text",
          "text: entryContent" in chain)

    print("\n== A. Persona selection from config (ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡5.3 enum, no literals) ==")
    check("reads journal_probe_persona_severe",
          'getConfigString("journal_probe_persona_severe")' in chain)
    check("reads journal_probe_persona_vague",
          'getConfigString("journal_probe_persona_vague")' in chain)
    check("non-S3 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ severe persona", 'severity !== "S3"' in chain)
    check("no hardcoded persona literal in the probe leg",
          '"therapist_empath"' not in chain and '"mentor_tough"' not in chain)

    print("\n== B. One unprompted row, audited metadata ==")
    check("reply_to_message_id: null", "reply_to_message_id: null" in chain)
    check("metadata.source = journal_probe", 'source: "journal_probe"' in chain)
    check("metadata.entry_id", "entry_id: entryId" in chain)
    check("metadata carries severity", "severity: severity" in chain)
    check("metadata carries rule_ids", "rule_ids: probeResult.ruleIds" in chain)
    check("metadata carries source_job_id", "source_job_id: job.id" in chain)
    check("generation on the locked-persona surface",
          "runLockedPersonaReply({" in chain and 'domain: "General"' in chain)

    print("\n== C. Idempotency + ordering (crash safety) ==")
    pre = chain.find('metadata->>source", "journal_probe')
    gen = chain.find("runLockedPersonaReply({", chain.find("runJournalProbe"))
    push = chain.find("createAiMessagePushPayload")
    flag = chain.find('update({ probed: true })', push)
    check("pre-check on metadata->>source before generation", 0 < pre < gen, f"pre={pre} gen={gen}")
    check("pre-check sets probed on an already-written row", pre > 0 and "update({ probed: true })" in chain[pre:gen])
    check("probed=true AFTER the row write and push", flag > push > 0, f"push={push} flag={flag}")

    print("\n== D. Push: exactly one, default priority, bounded ==")
    check("exactly one createAiMessagePushPayload call",
          chain.count("createAiMessagePushPayload(") == 1, f"count={chain.count('createAiMessagePushPayload(')}")
    check("needs a push on this path (source=journal_probe)", "sendPush(pushPayload)" in chain)
    check("deep link davos://chat", '"davos://chat"' in chain)
    check("5s bounded race", "Promise.race" in chain and "5000" in chain)
    check("no high-priority payload",
          'priority: "high"' not in chain and "priority:'high'" not in chain and 'priority:"high"' not in chain)

    print("\n== E. No chips / options (unprompted ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  Medium turn) ==")
    check("no route: \"options\" in runChain", 'route: "options"' not in chain)
    check("no options array on the probe insert", "options:" not in chain[gen:flag] if gen > 0 and flag > 0 else False)

    print("\n== F. Dispatcher registry ==")
    check("journal_probe case delegates to runChain", "journal_probe" in dispatcher and "runChain" in dispatcher)
    m = dispatcher.find("FAST_JOB_TYPES")
    check("journal_probe NOT in FAST_JOB_TYPES",
          m < 0 or "journal_probe" not in dispatcher[m:m + 400])

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
