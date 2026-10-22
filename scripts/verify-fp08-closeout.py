#!/usr/bin/env python3
"""FP-08 Step 9 closeout -- AC ids, write-backs, tracker, checklist, repo shape.

This is deliberately a *document* gate: the live behavior is covered by
verify-fp08-step1..8.py. Here we prove the acceptance ledger cannot drift from
FP-08.md, that every write-back the plan names is present, that the tracker is
flipped, and that the AGENTS.md §9 invariants still hold in source.

Static only; no network. Run after the FP-08 gates.

Usage: python scripts/verify-fp08-closeout.py
"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FP08 = "docs/feature-prds/FP-08/FP-08.md"
PLAN = "docs/feature-prds/FP-08/FP-08-PLAN.md"
ACC = "docs/feature-prds/FP-08/FP-08-ACCEPTANCE.md"
TECH = "docs/TECH-SPEC.md"
GLOS = "docs/GLOSSARY.md"
IMPULSE = "lib/impulse.ts"
BUTTON = "lib/impulseButton.ts"
CHAT = "app/(app)/chat.tsx"
LAYOUT = "app/(app)/_layout.tsx"
HIST = "supabase/functions/_shared/accountability/runHistogram.ts"
FN = "supabase/functions/log-impulse/index.ts"

FAILS = []

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def main():
    print("== FP-08 closeout ==")
    fp08 = read(FP08)
    acc = read(ACC)
    plan = read(PLAN)
    tech = read(TECH)
    glos = read(GLOS)

    print("\n== A. AC ledger ==")
    ids = re.findall(r"^\| (AC-\d+) \|", fp08, re.M)
    acc_ids = re.findall(r"^\| (AC-\d+) \|", acc, re.M)
    check("FP-08.md declares AC-1..AC-12", ids == [f"AC-{i}" for i in range(1, 13)], repr(ids))
    check("the acceptance ledger mirrors every id exactly", acc_ids == ids,
          f"fp08={ids} acc={acc_ids}")

    rows = {}
    for line in acc.splitlines():
        m = re.match(r"^\| (AC-\d+) \|(.*)\|(.*)\|(.*)\|\s*$", line)
        if m:
            rows[m.group(1)] = line
    check("every id has a ledger row", set(rows) == set(ids), repr(sorted(set(ids) - set(rows))))
    for ac, line in rows.items():
        check(f"{ac} carries an evidence tag",
              any(tag in line for tag in ("[script]", "[measured]", "[derived]", "[owner-observed]")))
        check(f"{ac} carries a status", "✅" in line or "⏳" in line)
    check("AC-9 is owner-pending on the device/web half", "⏳" in rows.get("AC-9", ""))
    check("AC-12 is owner-pending", "⏳" in rows.get("AC-12", ""))
    check("the automated ACs are accepted",
          all("✅" in rows.get(f"AC-{i}", "") for i in range(1, 9))
          and "✅" in rows.get("AC-10", "") and "✅" in rows.get("AC-11", ""))

    print("\n== B. Recorded readings ==")
    for phrase in (
        "Candor credit and cap",
        "Streak carrier and day rule",
        "Override audit row",
        "Accountability-domain pair",
        "Oath cooldown + thread position",
        "Oath fact is non-purgeable",
        "Impulse-cluster routing",
        "Cold start / boundary",
        "Empty activities degradation",
        "In-code templates",
        "Live-habit guard",
        "Quest verdict fraction + expiry",
        "Future-dated strike job",
        "Snooze decrement",
        "Claim-check + fallback",
        "Strike cancellation",
        "Registries",
        "`cancelled` reserved",
        "`proactive` deferred",
        "iOS/web impulse surfaces",
    ):
        check(f"reading recorded: {phrase}", phrase in acc)

    print("\n== C. Write-backs ==")
    check("TECH-SPEC records the snooze convention",
          "Snooze convention (as built, FP-08 Step 7)" in tech)
    check("TECH-SPEC records the histogram build", "As built (FP-08 Step 8)" in tech)
    check("TECH-SPEC records the journal habit_flag contract",
          "habit_flag" in tech and "As built (FP-08 Steps" in tech
          and "As built (FP-08 Steps 3" in tech.replace("\u2013", "-"))
    check("TECH-SPEC records the iOS amendment for FP-08 pushes",
          "Amendment recorded" in tech and "FP-08 (2026-10-22)" in tech)
    check("TECH-SPEC records 14 of 15 handlers", "fourteen** with dispatcher handlers" in tech)
    check("TECH-SPEC records the 441/day quota note", "441" in tech)
    check("GLOSSARY records log-impulse", "`log-impulse`" in glos)
    check("GLOSSARY records the candor credit", "`applyImpulseCandorCredit`" in glos)
    check("GLOSSARY records the histogram runner", "`runHistogram`" in glos)
    check("GLOSSARY records the client surfaces", "`armImpulseNotification`" in glos)
    check("GLOSSARY records the preemptive deep link",
          "`davos://chat?focus=alternative` (client handler)" in glos)
    check("GLOSSARY §2 records the habit_flag chain note", "habit_flag` feeds the trailing-week" in glos)

    print("\n== D. Tracker ==")
    for step, row in enumerate((
        "| 0 | Dependency gate",
        "| 1 | Migration 0032",
        "| 2 | The pure accountability modules",
        "| 3 | Rider wiring I",
        "| 4 | Wiring II",
        "| 5 | The drift scan",
        "| 6 | The quest lifecycle",
        "| 7 | The Strike",
        "| 8 | Interception",
        "| 9 | Live drills",
    )):
        line = next((l for l in plan.splitlines() if l.startswith(row)), "")
        check(f"PLAN row {step} is flipped", "✅" in line, line)

    print("\n== E. Source invariants ==")
    hist = read(HIST)
    fn = read(FN)
    impulse = read(IMPULSE)
    button = read(BUTTON)
    chat = read(CHAT)
    layout = read(LAYOUT)
    check("the histogram runner imports no provider",
          "llm/" not in hist and "gemini" not in hist.lower() and "groq" not in hist.lower()
          and "fetch(" not in hist)
    check("log-impulse imports no provider",
          "llm/" not in fn and "gemini" not in fn.lower() and "groq" not in fn.lower())
    check("the client uses logger + traceNetworkCall and zero raw console",
          "logger" in impulse and 'traceNetworkCall("chat", "log-impulse"' in impulse
          and all("console." not in s for s in (impulse, button, chat)))
    check("the app layout arms the persistent surface",
          "armImpulseNotification(userId)" in layout
          and "disarmImpulseNotification()" in layout)
    check("chat handles focus=alternative", "focusParam !== 'alternative'" in chat)
    check("the client never reads trust_score",
          all("trust_score" not in s for s in (impulse, button, chat, layout)))
    check("no HTML/DOM element in the new client modules",
          all("<div" not in s and "<span" not in s and "<p>" not in s
              for s in (impulse, button, chat)))
    pkg = read("package.json")
    check("no new dependency for the quick action", "expo-task-manager" not in pkg)

    print("\n== F. Git shape ==")
    rc = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode
    check("nothing unexpected is staged at closeout", rc == 0)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                            capture_output=True, text=True, encoding="utf-8",
                            errors="replace").stdout
    allowed = (
        "eas.json", "package.json", "package-lock.json",
        "docs/feature-prds/FP-09/", "assets/", "app.json",
        "scripts/rebuild-app-icons.py",
    )
    unexpected = [
        line for line in status.splitlines()
        if line.strip() and not any(part in line for part in allowed)
    ]
    check("only the enumerated owner work is uncommitted", not unexpected,
          "\n".join(unexpected))

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + "; ".join(FAILS))
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
