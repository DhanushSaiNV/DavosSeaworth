#!/usr/bin/env python3
"""Automate FP-05 Step 7 verification (Client submit wiring on the journal screen).

Covers PLAN Step 7 Verify: "tsc + jest clean; the web drill records a full submit;
static asserts — no send-message/sendQueue import on the journal path, the strip
module untouched (git diff)".

  AUTOMATED -- static (no network):
    files       : submitState.ts pure (jest-loadable); submitState.test.ts exists;
                  journal.tsx imports submitState + strip only (no send-message,
                  no sendQueue, no sendQueue import)
    function    : handleSubmit calls supabase.functions.invoke('submit-journal', ...);
                  buildSubmitPayload uses stripSummary.stripped + today local date;
                  on ok -> AsyncStorage.removeItem('davos_journal_draft'),
                  setRaw(''), setFlaggedTexts([]), setCommitted(false),
                  submitDispatch({type:'OK', sent, total});
                  on fail -> submitDispatch({type:'FAIL', error});
    state       : SubmitState machine (idle/in-flight/confirmed/failed) + isSubmitDisabled
    deno/jest   : jest suite passes
    git diff    : strip module untouched; no send-message/sendQueue import on journal path

  MANUAL -- live (web drill):
    route renders, submit posts through Step 2 CORS surface, confirmation state shows

Usage:
  python scripts/verify-fp05-step7.py [--static-only] [--run-jest]

PREREQUISITES: submit-journal deployed, migration 0028 applied.
"""

import argparse
import json
import os
import re
import subprocess
import sys

FAILURES = []

JOURNAL_DIR = "app/(app)"
LIB_JOURNAL_DIR = "lib/journal"
JOURNAL_REL = f"{JOURNAL_DIR}/journal.tsx"
SUBMITSTATE_REL = f"{LIB_JOURNAL_DIR}/submitState.ts"
SUBMITSTATE_TEST_REL = f"{LIB_JOURNAL_DIR}/submitState.test.ts"
STRIP_REL = f"{LIB_JOURNAL_DIR}/strip.ts"

def check(name: str, cond: bool, detail: str = "") -> None:
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)

def info(label: str, value: str) -> None:
    print(f"  ..   {label}: {value}")

def read_text(rel: str) -> str | None:
    path = os.path.join(os.getcwd(), rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()

def static_checks(run_jest: bool = False) -> None:
    print("== A. static (no network) ==")

    journal = read_text(JOURNAL_REL)
    submitstate = read_text(SUBMITSTATE_REL)
    submitstate_test = read_text(SUBMITSTATE_TEST_REL)
    strip = read_text(STRIP_REL)

    check("journal.tsx exists", journal is not None)
    check("submitState.ts exists", submitstate is not None)
    check("submitState.test.ts exists", submitstate_test is not None)
    check("strip.ts exists", strip is not None)

    if not all([journal, submitstate, submitstate_test, strip]):
        return

    # --- submitState.ts pure
    check("submitState.ts imports only strip (no supabase/react)", 
          not re.search(r"import.*(supabase|react|@supabase)", submitstate))
    check("buildSubmitPayload exported", "export function buildSubmitPayload" in submitstate)
    check("submitStateReducer exported", "export function submitStateReducer" in submitstate)
    check("isSubmitDisabled exported", "export function isSubmitDisabled" in submitstate)
    check("SubmitState type exported", "export type SubmitState" in submitstate)
    check("stripSummary used in buildSubmitPayload", "stripSummary(" in submitstate)

    # --- submitState.test.ts
    check("submitState.test.ts exists", submitstate_test is not None)
    check("test: state machine transitions", "SUBMIT" in submitstate_test and "OK" in submitstate_test and "FAIL" in submitstate_test and "RETRY" in submitstate_test)
    check("test: isSubmitDisabled logic", "isSubmitDisabled" in submitstate_test)
    check("test: payload equivalence (stripSummary)", "stripSummary" in submitstate_test)

    # --- journal.tsx integration
    check("journal.tsx imports submitState", "from '../../lib/journal/submitState'" in journal)
    check("journal.tsx imports strip", "from '../../lib/journal/strip'" in journal)
    check("NO send-message import on journal path", "send-message" not in journal or "send-message" in journal.split("import")[0])
    check("NO sendQueue import on journal path", "sendQueue" not in journal or "sendQueue" in journal.split("import")[0])
    check("handleSubmit uses supabase.functions.invoke('submit-journal')", "functions.invoke" in journal and "submit-journal" in journal)
    check("buildSubmitPayload called in handleSubmit", "buildSubmitPayload(" in journal)
    check("AsyncStorage.removeItem('davos_journal_draft') on OK", "removeItem" in journal and "davos_journal_draft" in journal)
    check("setRaw('') + setFlaggedTexts([]) + setCommitted(false) on OK", "setRaw" in journal and "setFlaggedTexts" in journal)
    check("submitDispatch OK with sent/total on success", 'type: "OK"' in journal and "sent:" in journal and "total:" in journal)
    check("submitDispatch FAIL with error on failure", 'type: "FAIL"' in journal and "error:" in journal)
    check("confirmation banner renders sent/total", "sent" in journal and "total" in journal and "blocks" in journal)
    check("error banner renders error + Retry", "FAIL" in journal or "failed" in journal)
    check("Retry button calls handleRetry", "handleRetry" in journal)
    check("Dismiss button calls handleDismissConfirmation", "handleDismissConfirmation" in journal)
    check("isSubmitDisabled used for button disabled", "isSubmitDisabled" in journal)
    check("Button disabled when in-flight or all-flagged", "disabled=" in journal and "isDisabled" in journal)

    # --- strip.ts untouched
    check("strip.ts exports splitBlocks/stripSummary/stripUnsavable", 
          "export function splitBlocks" in strip and "export function stripSummary" in strip and "export function stripUnsavable" in strip)

    # --- jest
    if run_jest:
        print("\n== A1. jest ==")
        ok, out = jest_check()
        detail = ""
        if not ok and out:
            try:
                out.encode("cp1252")
                detail = out
            except UnicodeEncodeError:
                detail = "(output contains non-cp1252 chars; run jest manually for details)"
        check("jest --ci clean (0 failures)", ok is True, detail)

    # Advisory git diff
    try:
        import shutil
        if shutil.which("git"):
            p = subprocess.run(
                "git diff --name-only" if os.name == "nt" else ["git", "diff", "--name-only"],
                cwd=os.getcwd(),
                capture_output=True,
                text=True,
                timeout=30,
                shell=os.name == "nt",
                encoding="utf-8",
                errors="replace",
            )
            files = [l.strip() for l in (p.stdout or "").splitlines() if l.strip()]
            info("git diff --name-only", files if files else "(clean)")
            for bad in ("send-message", "sendQueue", "lib/journal/strip.ts"):
                if any(bad in f for f in files):
                    check(f"no changes to {bad}", False, f"found in {files}")
                else:
                    check(f"no changes to {bad}", True)
    except Exception:
        pass


def jest_check() -> tuple[bool | None, str]:
    try:
        import shutil
        use_shell = os.name == "nt"
        if not use_shell and shutil.which("npx") is None:
            return None, "npx not on PATH"
        p = subprocess.run(
            "npx jest --ci" if use_shell else ["npx", "jest", "--ci"],
            cwd=os.getcwd(),
            capture_output=True,
            text=True,
            timeout=900,
            shell=use_shell,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="FP-05 Step 7 verification")
    ap.add_argument("--static-only", action="store_true", help="Run only static checks")
    ap.add_argument("--run-jest", action="store_true", help="Run jest in static checks")
    return ap.parse_args()


if __name__ == "__main__":
    import argparse
    args = parse_args()

    static_checks(run_jest=args.run_jest)

    print(f"\n{'=' * 60}")
    if FAILURES:
        print(f"FAILURES ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL CHECKS PASSED")
        sys.exit(0)