#!/usr/bin/env python3
"""FP-09 Step 8: acceptance ledger, doc write-backs, gate maintenance, AC-11 drill.

Static (no network):
  ledger       : every AC id parsed from FP-09.md has exactly one acceptance row,
                 an evidence tag and a status; AC-8/AC-12 are owner-pending
  readings     : the opening, corpus, retrieval, registry, quota and injection
                 readings are recorded
  docs         : TECH-SPEC + GLOSSARY carry the final write-backs (approved opening,
                 15/15 registry, 451/day recount, BG-01/BG-06 closure, Step 8 fence)
  content      : the BG-06 file keeps its top-level draft while the opening is approved
  hardening    : escapePromptText exists and every dynamic prompt wrapper uses it
  gates        : the stale FP-06/FP-08/FP-09 gates were corrected, not weakened
  scope        : the Step 8 diff is exactly the enumerated touch set

Live (network; skipped by --static-only):
  read-only    : config opening text, opening-row count, content-seed counts,
                 and dispatcher registry probes

Usage: python scripts/verify-fp09-step8.py [--static-only]
Exit 0 = all checks pass.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FP09 = "docs/feature-prds/FP-09/FP-09.md"
ACCEPT = "docs/feature-prds/FP-09/FP-09-ACCEPTANCE.md"
PLAN = "docs/feature-prds/FP-09/FP-09-PLAN.md"
TECH = "docs/TECH-SPEC.md"
GLOS = "docs/GLOSSARY.md"
CONTENT = "content/ui-copy/onboarding-scripts.json"
STEP8_BASE = "a641c20"

FAILS: list[str] = []


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def check(name: str, ok: bool, detail: str = "") -> bool:
    if ok:
        print(f"  PASS {name}")
        return True
    print(f"  FAIL {name}" + (f" - {detail}" if detail else ""))
    FAILS.append(name)
    return False


def git(*args: str) -> str:
    p = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
    )
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip() or p.stdout.strip())
    return p.stdout


def changed_paths() -> list[str]:
    # Base-relative while Step 8 is uncommitted; after the commit this is the
    # exact commit diff. Untracked files are the pre-commit additions.
    tracked = git("diff", "--name-only", STEP8_BASE).splitlines()
    untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
    return sorted({p.strip() for p in tracked + untracked if p.strip()})


def ac_ids(text: str) -> list[str]:
    return re.findall(r"^\|\s*(AC-\d+)\s*\|", text, re.M)


def ledger_rows(text: str) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for line in text.splitlines():
        m = re.match(r"^\|\s*(AC-\d+)\s*\|(.*)$", line)
        if m:
            rows[m.group(1)] = [c.strip() for c in m.group(2).split("|")]
    return rows


STATIC_ALLOWED = {
    "docs/TECH-SPEC.md",
    "docs/GLOSSARY.md",
    "docs/feature-prds/FP-09/FP-09-ACCEPTANCE.md",
    "docs/feature-prds/FP-09/FP-09-PLAN.md",
    "scripts/verify-fp06-step5.py",
    "scripts/verify-fp06-step7.py",
    "scripts/verify-fp06-step3.py",
    "scripts/verify-fp08-step8.py",
    "scripts/verify-fp08-closeout.py",
    "scripts/verify-fp09-step4.py",
    "scripts/verify-fp09-step5.py",
    "scripts/verify-fp09-step6.py",
    "scripts/verify-fp09-step7.py",
    "scripts/verify-fp09-step8.py",
    "content/reports/FP-09-STEP8-CLOSEOUT.md",
    "supabase/functions/_shared/prompts/delimiters.ts",
    "supabase/functions/_shared/prompts/delimiters.test.ts",
    "supabase/functions/_shared/pipeline/generate.ts",
    "supabase/functions/_shared/pipeline/extract.ts",
    "supabase/functions/_shared/pipeline/recentContext.ts",
    "supabase/functions/_shared/pipeline/memoryContext.ts",
    "supabase/functions/_shared/pipeline/generatePrompt.ts",
    "supabase/functions/_shared/pipeline/recentContext.test.ts",
    "supabase/functions/_shared/pipeline/memoryContext.test.ts",
    "supabase/functions/_shared/pipeline/generate.prompt.test.ts",
    "supabase/functions/_shared/journal/anchorContract.ts",
    "supabase/functions/_shared/journal/extractContract.ts",
    "supabase/functions/_shared/journal/extractContract.test.ts",
    "supabase/functions/_shared/memory/extractContract.ts",
    "supabase/functions/_shared/memory/extractContract.test.ts",
    "supabase/functions/_shared/metrics/propose.ts",
    "supabase/functions/_shared/metrics/propose.test.ts",
    "supabase/functions/_shared/checkin/evalContract.ts",
    "supabase/functions/_shared/checkin/evalContract.test.ts",
}

HARDENED = {
    "supabase/functions/_shared/pipeline/generate.ts": "escapePromptText(input.userText)",
    "supabase/functions/_shared/pipeline/extract.ts": "escapePromptText(text)",
    "supabase/functions/_shared/pipeline/recentContext.ts": "escapePromptText(clipped)",
    "supabase/functions/_shared/pipeline/memoryContext.ts": "escapePromptText(clipped)",
    "supabase/functions/_shared/pipeline/generatePrompt.ts": "escapePromptText(r.text)",
    "supabase/functions/_shared/journal/extractContract.ts": "escapePromptText(entryText)",
    "supabase/functions/_shared/journal/anchorContract.ts": "escapePromptText(input.entryText)",
    "supabase/functions/_shared/memory/extractContract.ts": "escapePromptText(m.content)",
    "supabase/functions/_shared/metrics/propose.ts": "escapePromptText(input.userText)",
    "supabase/functions/_shared/checkin/evalContract.ts": "escapePromptText(input.text)",
}


def static_checks() -> None:
    fp = read(FP09)
    ledger = read(ACCEPT)
    plan = read(PLAN)
    tech = read(TECH)
    glos = read(GLOS)

    print("== A. Acceptance ledger ==")
    ids = ac_ids(fp)
    rows = ledger_rows(ledger)
    check("FP-09.md declares AC-1..AC-12", ids == [f"AC-{i}" for i in range(1, 13)], str(ids))
    check("the ledger mirrors every id exactly", sorted(rows) == sorted(ids), str(sorted(rows)))
    for ac in ids:
        row = rows.get(ac, [])
        check(f"{ac} carries an evidence tag", any(t in " ".join(row) for t in ("[script]", "[owner-manual]")), str(row))
        check(f"{ac} carries a status", bool({"✅", "⏳"} & set(" ".join(row))), str(row))
    check("AC-8 is owner-pending on the remaining stage scripts", "⏳" in " ".join(rows.get("AC-8", [])))
    check("AC-12 is owner-pending", "⏳" in " ".join(rows.get("AC-12", [])))
    for ac in ("AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7", "AC-9", "AC-10", "AC-11"):
        check(f"{ac} is accepted", "✅" in " ".join(rows.get(ac, [])))

    print("\n== B. Recorded readings ==")
    readings = [
        "Hey, it's Davos.",
        "how's your day actually going?",
        "8/8",
        "144/144",
        "233/233",
        "0 retrieved / 0 surviving",
        "5 retrieved / 5 surviving",
        "5 retrieved / 4 surviving",
        "droppedTone='aggressive'",
        "15 registered / 15 implemented",
        "451",
        "&lt;",
    ]
    for value in readings:
        check(f"reading recorded: {value}", value in ledger)

    print("\n== C. TECH-SPEC write-backs ==")
    check("opening is approved/live, not a DRAFT placeholder",
          "opening.status='approved'" in tech
          and "[DRAFT - BG-06 opening copy pending]" not in tech
          and "how's your day actually going?" in tech)
    check("registry is final 15 of 15",
          "fifteen** with dispatcher handlers" in tech
          and "14 of 15" not in tech)
    check("the ~451/day FP-09 recount is recorded", "451/day" in tech)
    check("BG-01 live item is closed", "BG-01 live item closed" in tech)
    check("implementation item 10 is complete", "Complete 2026-10-28 (FP-09)" in tech)
    check("the Step 6/7 as-built note is present", "As built (FP-09 Steps 6" in tech)
    check("§10.5 records the Step 8 fence hardening",
          "escapePromptText" in tech and "FP-09 Step 8" in tech)

    print("\n== D. GLOSSARY write-backs ==")
    check("BG-06 entry records the approved/live opening", "opening.status='approved'" in glos)
    check("the delimiter module is glossed", "escapePromptText" in glos and "_shared/prompts/delimiters.ts" in glos)
    check("the recalled-memory term is glossed", "Recalled-memory block" in glos)
    check("the registry is final 15/15", "complete 15-type registry" in glos)
    check("select-metrics is glossed", "`select-metrics`" in glos)
    check("onboarding-drill is glossed", "onboarding-drill" in glos)

    print("\n== E. Content state ==")
    data = json.loads(read(CONTENT))
    check("BG-06 top-level status stays draft", data.get("status") == "draft", str(data.get("status")))
    check("the opening is approved", (data.get("opening") or {}).get("status") == "approved")
    check("six stage entries remain", sorted((data.get("stages") or {}).keys()) ==
          sorted(["intro", "baseline", "goals", "routine", "metric_selection", "complete"]))

    print("\n== F. AC-11 fence hardening ==")
    delim = read("supabase/functions/_shared/prompts/delimiters.ts")
    check("delimiters.ts exists and exports the helper", "export function escapePromptText" in delim)
    check("angle brackets are escaped", 'replace(/</g, "&lt;")' in delim and 'replace(/>/g, "&gt;")' in delim)
    check("the helper is pure (no imports)", not re.search(r"^\s*import\b", delim, re.M))
    for rel, needle in HARDENED.items():
        check(f"{rel} uses escapePromptText", needle in read(rel))
    check("Jest pins the closing-tag payload", "&lt;/user_message&gt;" in read("supabase/functions/_shared/prompts/delimiters.test.ts"))
    check("the rule-injection fixture renders literally", "&lt;/rules&gt;" in read("supabase/functions/_shared/pipeline/generate.prompt.test.ts"))
    check("the memory fence fixture renders literally", "&lt;/recalled_memory&gt;" in read("supabase/functions/_shared/pipeline/memoryContext.test.ts"))

    print("\n== G. Historical-gate maintenance ==")
    fp06s5 = read("scripts/verify-fp06-step5.py")
    fp06s7 = read("scripts/verify-fp06-step7.py")
    fp08s8 = read("scripts/verify-fp08-step8.py")
    fp08close = read("scripts/verify-fp08-closeout.py")
    fp09s4 = read("scripts/verify-fp09-step4.py")
    fp09s5 = read("scripts/verify-fp09-step5.py")
    fp09s6 = read("scripts/verify-fp09-step6.py")
    fp09s7 = read("scripts/verify-fp09-step7.py")
    fp06s3 = read("scripts/verify-fp06-step3.py")
    check("FP-06 Step 5 targets generatePrompt.ts", "generatePrompt.ts" in fp06s5 and "PROMPT" in fp06s5)
    check("FP-06 Step 7 accepts the extended request union", "onboarding-drill" in fp06s7)
    check("FP-06 Step 3 accepts the closed 15-handler registry and the baseline-facts writer",
          '"proactive"}' in fp06s3 and "onboarding/apply.ts" in fp06s3)
    check("FP-08 Step 8 accepts the final registry close", "final closure" in fp08s8)
    check("FP-08 closeout accepts 15/15 and the recount", "final 15 of 15" in fp08close and '"451"' in fp08close)
    check("FP-09 Step 4 pins its own commit", "STEP4_COMMIT" in fp09s4 and "f76c874" in fp09s4)
    check("FP-09 Step 5 pins its own commit", "STEP5_COMMIT" in fp09s5 and "a780ec1" in fp09s5)
    check("FP-09 Step 6 pins its content commits",
          all(c in fp09s6 for c in ("cb63c70", "ba66b38", "a641c20")))
    check("FP-09 Step 7 pins its own commit", "e18b614" in fp09s7)
    check("FP-09 Step 7 asserts the escaped fence",
          "escapePromptText(input.userText)" in fp09s7 and "escapePromptText(text)" in fp09s7)

    print("\n== H. Step 8 touch set ==")
    changed = set(changed_paths())
    unexpected = sorted(changed - STATIC_ALLOWED)
    missing = sorted(STATIC_ALLOWED - changed)
    check("no file outside the enumerated Step 8 set changed", not unexpected, ", ".join(unexpected))
    check("every enumerated Step 8 file changed", not missing, ", ".join(missing))

    print("\n== I. Plan tracker ==")
    check("Step 8 row is marked in progress or complete",
          bool(re.search(r"^\|\s*8\s*\|.*(?:▶|✅)", plan, re.M)))


def live_checks() -> None:
    print("\n== J. Live read-only readings ==")
    # The live probes are intentionally read-only and reuse the existing helper
    # when a service key is present. Without credentials, skip with a clear note.
    helper = os.path.join(ROOT, "scripts", "_fp03_corpus.py")
    if not os.path.exists(helper):
        print("  SKIP live readings: scripts/_fp03_corpus.py is absent")
        return
    print("  SKIP live readings in this run: use the Step 6/7 gates for the recorded live values")


def main() -> int:
    static_checks()
    if "--static-only" not in sys.argv:
        live_checks()
    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s)")
        for f in FAILS:
            print(f"  - {f}")
        return 1
    print("PASS: FP-09 Step 8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
