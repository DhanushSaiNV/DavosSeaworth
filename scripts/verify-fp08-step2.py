#!/usr/bin/env python3
"""FP-08 Step 2 gate — the pure accountability modules + decision-table suites.

Covers PLAN Step 2 Verify: "suites green; `tsc --noEmit` + `deno check` + `jest --ci`
clean; every module imports nothing (jest loads them with zero Deno shims)."

Static
  files       : eight modules + eight suites under `_shared/accountability/`
  purity      : every module file has zero import statements and no Deno/supabase/adapter/
                fetch/console reference — the jest-loadable floor
  constants   : the §5.4 arithmetic (score 0–100, openness ±5, admission +10, candor cap 3),
                the D8 band steps/bounds, the streak constants, the D21 persona/domains
  lifecycle   : `habits.ts`'s status union matches 0007's CHECK exactly, `cancelled` has no
                writer, `quit_committed` is reachable from every live state
  suites      : every module has a suite, each declares its own jest globals, and the
                decision tables cover the FR rows (flags × state, boundaries, fixtures)
  docs        : the module headers cite the governing refs (FR + TECH-SPEC + D)

Toolchain
  jest        : the new suites (fast, scoped) and the full suite
  tsc         : `npx tsc --noEmit`
  deno        : `deno check` over the eight modules and the eight suites
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACC = ROOT / "supabase" / "functions" / "_shared" / "accountability"
MIGRATION = ROOT / "supabase" / "migrations" / "0007_features.sql"

MODULES = [
    "rider.ts",
    "streak.ts",
    "lockdown.ts",
    "habits.ts",
    "quests.ts",
    "strike.ts",
    "histogram.ts",
    "templates.ts",
]
SUITES = [name.replace(".ts", ".test.ts") for name in MODULES]

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'} {name}")
    if not ok:
        FAILURES.append(name)
        if detail:
            print(f"       {detail[:600]}")


def skip(name: str, reason: str) -> None:
    print(f"  SKIP {name} ({reason})")


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def run(command: list[str], timeout: int = 900) -> tuple[int, str]:
    use_shell = os.name == "nt"
    rendered = subprocess.list2cmdline(command) if use_shell else command
    proc = subprocess.run(
        rendered,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def tool(name: str) -> bool:
    return shutil.which(name) is not None


def static_checks() -> None:
    print("== A. files and purity ==")
    for name in MODULES + SUITES:
        check(f"{name} exists", (ACC / name).is_file())

    module_texts = {name: read(ACC / name) for name in MODULES}
    for name, text in module_texts.items():
        imports = [line for line in text.splitlines() if line.startswith("import ")]
        check(f"{name} imports nothing", not imports, f"{imports}")
    forbidden = re.compile(r"\b(Deno\.|supabase|createClient|from \"@|fetch\(|console\.)")
    for name, text in module_texts.items():
        code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("//"))
        hit = forbidden.search(code)
        check(f"{name} has no IO/runtime references", hit is None, hit.group(0) if hit else "")

    print("== B. the arithmetic constants (§5.4, §11, D8) ==")
    rider = module_texts["rider.ts"]
    for constant, value in [
        ("TRUST_MIN", "0"),
        ("TRUST_MAX", "100"),
        ("OPENNESS_BOUND", "5"),
        ("ADMISSION_BONUS", "10"),
        ("IMPULSE_CANDOR_CAP_PER_DAY", "3"),
        ("BAND_SHIFT_OVERRIDE_STEP", "-0.02"),
        ("BAND_SHIFT_OVERRIDE_FLOOR", "-0.1"),
        ("BAND_SHIFT_SUCCESS_STEP", "0.01"),
        ("BAND_SHIFT_SUCCESS_CAP", "0.1"),
    ]:
        check(
            f"rider constant {constant} = {value}",
            re.search(rf"export const {constant} = {re.escape(value)};", rider) is not None,
        )
    for helper in [
        "decideRider",
        "clampTrustScore",
        "normalizeOpennessDelta",
        "admissionDelta",
        "impulseCandorCredit",
        "clampBandShift",
        "signalsFromExtraction",
    ]:
        check(f"rider exports {helper}", f"export function {helper}" in rider)

    streak = module_texts["streak.ts"]
    check("streak minimum is 3 days", "export const STREAK_MIN_DAYS = 3;" in streak)
    check("streak award is +2", "export const STREAK_TRUST_AWARD = 2;" in streak)
    for helper in ["streakDays", "awardStreak", "isCompleteDay"]:
        check(f"streak exports {helper}", f"export function {helper}" in streak)

    lockdown = module_texts["lockdown.ts"]
    check("D21 persona is confrontation", 'export const LOCKDOWN_PERSONA = "confrontation";' in lockdown)
    check(
        "the §11 default domain pair is Career + Discipline/Habits",
        '["Career", "Discipline/Habits"]' in lockdown,
    )
    for helper in ["shouldEnterLockdown", "shouldExit", "effectiveDomain", "buildRedirectInstruction"]:
        check(f"lockdown exports {helper}", f"export function {helper}" in lockdown)

    habits = module_texts["habits.ts"]
    for helper in ["shouldSurface", "nextStatus", "buildDescription", "isLive"]:
        check(f"habits exports {helper}", f"export function {helper}" in habits)

    quests = module_texts["quests.ts"]
    for helper in ["clampDeadlineDays", "questVerdict", "progressFraction", "elapsedDays"]:
        check(f"quests exports {helper}", f"export function {helper}" in quests)
    check("quest verdict union is completed|failed|expired", 'export type QuestVerdict = "completed" | "failed" | "expired";' in quests)

    strike = module_texts["strike.ts"]
    for helper in ["extractNumericClaims", "checkClaims", "snoozeDecision", "assembleEvidence"]:
        check(f"strike exports {helper}", f"export function {helper}" in strike)
    check("strike model's claim kinds", 'export type ClaimKind = "duration" | "quantity" | "date" | "goal";' in strike)

    histogram = module_texts["histogram.ts"]
    for helper in ["bucketByLocalHour", "qualifyingBuckets", "fireTime", "rotateActivity"]:
        check(f"histogram exports {helper}", f"export function {helper}" in histogram)
    check("the top-2 default cap is in the signature", "cap = 2" in histogram)

    templates = module_texts["templates.ts"]
    for helper in ["preemptiveText", "strikeTemplate"]:
        check(f"templates exports {helper}", f"export function {helper}" in templates)

    print("== C. habit lifecycle against 0007's CHECK ==")
    migration = read(MIGRATION)
    constraint = re.search(
        r"check \(status in \(([^)]*)\)\)", migration
    )
    declared = set()
    if constraint:
        declared = {item.strip().strip("'") for item in constraint.group(1).split(",")}
    union = re.search(
        r"export type HabitStatus =([^;]+);", habits, re.S
    )
    typed = set(re.findall(r'"([a-z_]+)"', union.group(1))) if union else set()
    check("habits.ts's union matches 0007's CHECK exactly", declared == typed and bool(declared), f"{declared} vs {typed}")
    check("`cancelled` is reserved (no writer)", "return \"cancelled\"" not in habits and "status: \"cancelled\"" not in habits)
    check(
        "quit_commitment is reachable from every live status",
        'if (event === "quit_commitment")' in habits and 'isLive(current) ? "quit_committed" : current' in habits,
    )

    print("== D. suites: discovery, globals, coverage shape ==")
    for name in SUITES:
        text = read(ACC / name)
        check(f"{name} declares its own jest globals", "declare const describe:" in text and "declare const expect:" in text)
        it_count = len(re.findall(r"\bit\(", text))
        check(f"{name} has a real decision table (>= 5 cases)", it_count >= 5, f"{it_count} cases")
    rider_suite = read(ACC / "rider.test.ts")
    for row in ["give_up", "false_constraint", "concession", "quit_commitment", "quit_signal"]:
        check(f"rider table covers {row}", row in rider_suite)
    strike_suite = read(ACC / "strike.test.ts")
    check("claim-check fixture: the fabricated 400-hour deadline", "400-hour deadline" in strike_suite)
    quest_suite = read(ACC / "quests.test.ts")
    check("quest table covers zero points -> expired", "expired" in quest_suite)
    check("quest table covers the fraction boundary", "boundary" in quest_suite)
    streak_suite = read(ACC / "streak.test.ts")
    check("streak table covers the 2/3-day boundary", "awardStreak(2, false)" in streak_suite and "awardStreak(3, false)" in streak_suite)

    print("== E. governing refs in the module headers ==")
    for name, text in module_texts.items():
        head = "\n".join(text.splitlines()[:20])
        has_refs = ("FP-08 FR-" in head) and ("TECH-SPEC" in head) and re.search(r"\bD\d+\b", head) is not None
        check(f"{name} cites its FR/TECH-SPEC/D refs", has_refs)


def toolchain_checks() -> None:
    print("== F. jest (scoped suites + full) ==")
    if not tool("npx"):
        skip("jest", "npx not on PATH")
        skip("tsc", "npx not on PATH")
    else:
        rc, out = run(["npx", "jest", "supabase/functions/_shared/accountability", "--ci"])
        check("the eight new suites are green", rc == 0, out[-1500:])
        match = re.search(r"Tests:\s+(\d+) passed, (\d+) total", out)
        check("at least 120 decision-table cases ran", bool(match) and int(match.group(1)) >= 120, match.group(0) if match else "no summary")

        rc, out = run(["npx", "jest", "--ci"])
        check("the full jest suite is green", rc == 0, out[-1500:])

        rc, out = run(["npx", "tsc", "--noEmit"])
        check("tsc --noEmit is clean", rc == 0, out[-1500:])

    print("== G. deno check (modules + suites) ==")
    if not tool("deno"):
        skip("deno check", "deno not on PATH")
    else:
        targets = [str((ACC / name).relative_to(ROOT)) for name in MODULES + SUITES]
        rc, out = run(["deno", "check", *targets], timeout=600)
        check("deno check is clean over the sixteen files", rc == 0, out[-1500:])


def main() -> int:
    print("== FP-08 Step 2: pure accountability modules + decision-table suites ==")
    static_checks()
    toolchain_checks()
    print()
    if FAILURES:
        print(f"FAIL: FP-08 Step 2 — {len(FAILURES)} check(s) failed")
        for name in FAILURES:
            print(f"  - {name}")
        return 1
    print("PASS: FP-08 Step 2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
