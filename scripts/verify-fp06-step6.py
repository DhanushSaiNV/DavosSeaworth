#!/usr/bin/env python3
"""Automate FP-06 Step 6 verification (the chat flag affordance).

Covers PLAN Step 6 Verify: "tsc + jest clean; the web drill records a full flag -> marker
loop; static asserts -- no send-message/sendQueue import on this path, no new message rows
or metadata values written client-side, the strip module and journal screen untouched."

  AUTOMATED -- static (no network):
    module     : lib/memoryFlag.ts is pure (no imports at all); the four phases; the
                 single-flight begin; ok -> flagged and failure -> retryable/terminal; the
                 payload is an id and nothing else; the marker derives from the row's own
                 unsavable column, never from local phase state
    builder    : ChatItem carries messageId + unsavable; buildChatItems fills both from
                 the server row (optimistic bubbles carry neither)
    screen     : the bubble's long-press opens the menu only when canMarkUnsavable; the
                 menu offers Mark Unsavable; the POST is functions.invoke('flag-unsavable')
                 with flagPayload, gated by a single-flight ref; on ok the row is re-read
                 and merged (the marker truth), then the menu closes; on failure the
                 inline copy + Retry re-runs the same handler; logger only, no console
    writes     : the flag path writes nothing client-side (no insert/update/upsert, no
                 new rows, no metadata) and touches no sendQueue/send-message import
    untouched  : lib/journal/strip.ts and app/(app)/journal.tsx carry no flag code
    primitives : no HTML/DOM elements in the flag UI (View/Text/Pressable only)
    tests      : the state-machine suite pins ok/failure/assistant/marker-from-row

  NOT AUTOMATED: the web drill (the route renders, long-press/right-click reaches the
  menu, the full flag -> marker loop posts through the Step 2 CORS surface) needs the
  running app + deployed function; recorded in FP-06-ACCEPTANCE.

Usage: python scripts/verify-fp06-step6.py [--static-only]
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE = "lib/memoryFlag.ts"
TEST = "lib/memoryFlag.test.ts"
CHAT_LIB = "lib/chat.ts"
SCREEN = "app/(app)/chat.tsx"
STRIP = "lib/journal/strip.ts"
JOURNAL = "app/(app)/journal.tsx"

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

    print("== FP-06 Step 6: the chat flag affordance ==\n")

    mod = read(MODULE)
    test = read(TEST)
    chat_lib = read(CHAT_LIB)
    screen = read(SCREEN)
    strip = read(STRIP)
    journal = read(JOURNAL)

    check(f"{MODULE} exists", bool(mod))
    if not mod:
        print("\nFAILED: memoryFlag module missing")
        return 1

    print("\n== A. Pure state machine ==")
    check("no imports (pure)", not re.search(r"^import\b", mod, re.M))
    check("four phases", 'export type FlagPhase = "idle" | "in-flight" | "flagged" | "failed";' in mod)
    check("idle constant", "export const IDLE_FLAG" in mod)
    check("affordance: own committed user bubbles only", 'target.role === "user"' in mod and "target.unsavable !== true" in mod)
    check("marker derives from the row column", "return target.unsavable === true;" in mod)
    check("payload is an id and nothing else", "return { message_id: messageId };" in mod)
    check("single-flight begin", 'if (state.phase === "in-flight") return state;' in mod)
    check("ok -> flagged", 'return { phase: "flagged", messageId, retryable: true };' in mod)
    check("retry policy: transport/5xx/429", "if (status === undefined) return true;" in mod and "return status === 429;" in mod)
    check("inline copy per status class", "export function flagFailureCopy" in mod)

    print("\n== B. ChatItem + builder (row truth) ==")
    check("ChatItem carries messageId", "messageId?: string;" in chat_lib)
    check("ChatItem carries unsavable", "unsavable?: boolean;" in chat_lib)
    check("builder fills both from the row", "messageId: row.id," in chat_lib and "unsavable: row.unsavable === true," in chat_lib)

    print("\n== C. The screen (long-press, single-flight, marker, retry) ==")
    check("imports the pure module", "from '../../lib/memoryFlag'" in screen)
    check("bubble long-press", "onLongPress={flaggable ? () => setFlagMenuFor(item.messageId ?? null) : undefined}" in screen)
    check("long-press delay", "delayLongPress={400}" in screen)
    check("gated by the affordance truth", "const flaggable = canMarkUnsavable(item);" in screen)
    check("menu offers Mark Unsavable", '"Mark Unsavable"' in screen or "'Mark Unsavable'" in screen)
    check("single-flight ref gate", "flagBusyRef.current" in screen and "if (!user || !limits || flagBusyRef.current) return;" in screen)
    check("POSTs the Step 2 surface", "supabase.functions.invoke('flag-unsavable'" in screen and "body: flagPayload(messageId)" in screen)

    m = re.search(r"const onMarkUnsavable = useCallback\(.*?\n  \);\n", screen, re.S)
    handler = m.group(0) if m else ""
    check("handler exists", bool(handler))
    check("ok path re-reads the row", "from('messages')" in handler and ".eq('id', messageId)" in handler and "maybeSingle()" in handler)
    check("ok path merges the server row", "mergeRows(prev, [row as Message])" in handler)
    check("ok path closes the menu", "setFlagMenuFor((prev) => (prev === messageId ? null : prev));" in handler)
    check("failure records the status", "flagFailed(prev, messageId, status)" in handler)
    check("logs via logger only", "logger.warn('chat', 'flag-unsavable failed'" in handler and "console." not in handler)
    check("no client-side writes on the flag path", not re.search(r"\.(insert|update|upsert)\(", handler))
    check("no queue/send import on the flag path", "enqueueSend" not in handler and "sendQueue" not in handler)

    print("\n== D. Rendering (marker from the row, inline error + Retry) ==")
    check("marker via the pure truth", "showsUnsavableMarker(item)" in screen)
    check("inline error via the pure getter", "const flagError = flagErrorFor(flag, item.messageId);" in screen)
    check("Retry re-runs the same handler", "accessibilityLabel=\"Retry marking unsavable\"" in screen)
    check("RN primitives only", not re.search(r"<(div|span|button|input|form|a)\b", screen))
    check("menu/actions are Pressables", "styles.flagMenu" in screen and "accessibilityRole=\"button\"" in screen)

    print("\n== E. Untouched surfaces ==")
    check("strip module carries no flag code", "flag-unsavable" not in strip and "memoryFlag" not in strip)
    check("journal screen carries no flag code", "flag-unsavable" not in journal and "memoryFlag" not in journal)

    print("\n== F. Tests ==")
    check("suite exists", bool(test))
    check("ok -> flagged case", "idle -> in-flight -> flagged" in test)
    check("single-flight case", "a second begin while in flight is a no-op" in test)
    check("assistant offers nothing", "offers nothing on assistant bubbles" in test)
    check("marker never from local state", "a flagged phase alone is not the marker" in test)
    check("failure retryable/terminal table", "failure is retryable for transport/5xx/429 and terminal for 4xx" in test)
    check("payload shape case", "is an id and nothing else" in test)

    print("\n" + "=" * 60)
    if _failures:
        print(f"FAILED: {_failures} check(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
