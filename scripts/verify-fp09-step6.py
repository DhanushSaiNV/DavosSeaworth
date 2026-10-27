#!/usr/bin/env python3
"""Automate FP-09 Step 6 verification (BG-06 scripts + content library baseline).

PLAN Step 6 Verify: "`validate.ts` PASS with 377 approved rows; `DOMAIN_ENUM` is
canonical 16; opening copy and stage diagnostic prompts authored without sterile
forms; static check clean."

  AUTOMATED -- static:
    BG-06 file  : content/ui-copy/onboarding-scripts.json exists, parses, is
                  status=draft and carries a visible DRAFT label
    stages      : all six stages are present; the question counts match
                  config.onboarding_stage_questions (intro 1, baseline 3, goals 3,
                  routine 4, metric_selection 0, complete 0)
    opening     : the intro question is the opening text; greeting + exactly one
                  question; no sterile form language in any question
    extraction  : baseline maps wake/sleep + baseline facts; routine maps
                  wake_time, sleep_time, routine_summary and
                  high_dopamine_activities; the dedicated alternatives wording
                  points at the routine-easy-hit question
    chips       : metric_selection has no questions, the server-owned selection
                  rule, and the eight preset names/domains/units from presets.ts
    fragments   : state.ts's internal stage fragments implement the same goals
                  (baseline wake/sleep/energy/load, goals why-now/better-week,
                  routine easy-hit, metric do-not-invent)
    domains     : _shared/content.ts DOMAIN_ENUM is the canonical 16
    library     : rules.csv = 144 approved rows across all 16 domains with at
                  least 6 each; exemplars.csv = 233 approved rows; status total
                  approved=377; no PLACEHOLDER-DEV rows
    validator   : `deno run --allow-read content/validate.ts` exits 0 and prints
                  approved=377
    docs        : TECH-SPEC and GLOSSARY record the DRAFT scripts; FP-BG's BG-06
                  row records the draft (owner review pending)
    scope       : the Step 6 touch set is exact; no SQL, client, package.json or
                  live config/row change

Flags: `--no-toolchain` skips tsc + jest (the content library and static checks
still run).
"""

import argparse
import csv
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG06 = "content/ui-copy/onboarding-scripts.json"
STATE = "supabase/functions/_shared/onboarding/state.ts"
CONTENT = "supabase/functions/_shared/content.ts"
RULES = "content/rules.csv"
EXEMPLARS = "content/exemplars.csv"
REPORT = "content/reports/FP-09-STEP6-BG06.md"
SCRIPT = "scripts/verify-fp09-step6.py"
TECH = "docs/TECH-SPEC.md"
GLOSSARY = "docs/GLOSSARY.md"
FPBG = "docs/feature-prds/FP-BG/FP-BG.md"

CANONICAL_16 = [
    "Career",
    "Finance",
    "Fitness",
    "Health",
    "Learning",
    "Creativity",
    "Relationships",
    "Family",
    "Social",
    "Mental/Emotional",
    "Spirituality",
    "Discipline/Habits",
    "Communication",
    "Environment/Home",
    "Recreation",
    "Purpose/Legacy",
]

EXPECTED_COUNTS = {
    "intro": 1,
    "baseline": 3,
    "goals": 3,
    "routine": 4,
    "metric_selection": 0,
    "complete": 0,
}

EXPECTED_CHIPS = {
    "Momentum": ("Discipline/Habits", "doings"),
    "Deep Work Hours": ("Career", "h"),
    "Check-in Consistency": ("Discipline/Habits", "%"),
    "Energy Level": ("Health", "/10"),
    "Impulse Control": ("Discipline/Habits", "score"),
    "Journal Positivity": ("Mental/Emotional", "%"),
    "Quest Completions": ("Purpose/Legacy", "quests"),
    "Life Balance": ("Purpose/Legacy", "pts"),
}

FAILS = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS {label}")
    else:
        print(f"  FAIL {label}" + (f" -- {detail}" if detail else ""))
        FAILS.append(label)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as handle:
        return handle.read()


def run(args):
    return subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def npx(args):
    """Run npx portably; Windows resolves the npm shim through cmd.exe."""
    return run(["cmd", "/c", "npx", *args]) if os.name == "nt" else run(["npx", *args])


def static_checks():
    print("== A. static: BG-06 scripts ==")

    path = os.path.join(ROOT, BG06)
    check("the BG-06 draft file exists", os.path.exists(path))
    if not os.path.exists(path):
        return

    try:
        data = json.loads(read(BG06))
        parsed = True
    except json.JSONDecodeError as err:
        parsed = False
        data = {}
        check("the BG-06 draft file is valid JSON", False, str(err))
    if parsed:
        check("the BG-06 draft file is valid JSON", True)

    check("the file is status=draft", data.get("status") == "draft",
          repr(data.get("status")))
    check("the file carries a visible DRAFT label",
          isinstance(data.get("label"), str) and data["label"].startswith("DRAFT"),
          repr(data.get("label")))

    stages = data.get("stages") or {}
    check("all six stages are present",
          set(stages) == set(EXPECTED_COUNTS), str(sorted(stages)))
    check("the stage counts match config.onboarding_stage_questions",
          data.get("stage_counts") == EXPECTED_COUNTS, repr(data.get("stage_counts")))

    for stage, expected in EXPECTED_COUNTS.items():
        questions = (stages.get(stage) or {}).get("questions")
        check(
            f"{stage} carries {expected} question(s)",
            isinstance(questions, list) and len(questions) == expected,
            f"{len(questions) if isinstance(questions, list) else questions}",
        )

    opening = data.get("opening") or {}
    intro_questions = (stages.get("intro") or {}).get("questions") or []
    intro_text = intro_questions[0].get("text", "") if intro_questions else ""
    check("the opening is the intro stage's single question",
          opening.get("text") == intro_text and bool(intro_text))
    check("the opening folds a greeting and exactly one question",
          "I'm Davos" in intro_text and intro_text.count("?") == 1, repr(intro_text))

    all_questions = []
    for stage in EXPECTED_COUNTS:
        for question in (stages.get(stage) or {}).get("questions") or []:
            all_questions.append(question)
    check("every question has a non-empty text and an extraction target",
          all(
              isinstance(question.get("text"), str)
              and question["text"].strip()
              and isinstance(question.get("extraction"), dict)
              for question in all_questions
          ))
    check("every question asks exactly one question",
          all(question["text"].count("?") == 1 for question in all_questions),
          str([question.get("id") for question in all_questions if question.get("text", "").count("?") != 1]))
    sterile = re.compile(r"\b(form|questionnaire|survey|checklist)\b", re.IGNORECASE)
    check("no question uses sterile form language",
          all(not sterile.search(question["text"]) for question in all_questions),
          str([question.get("id") for question in all_questions if sterile.search(question.get("text", ""))]))

    baseline_fields = set()
    for question in (stages.get("baseline") or {}).get("questions") or []:
        baseline_fields.update(question.get("extraction", {}).get("profile_fields") or [])
    check("baseline maps wake_time and sleep_time",
          {"wake_time", "sleep_time"}.issubset(baseline_fields), str(sorted(baseline_fields)))
    check("baseline maps baseline facts",
          all("baseline_facts" in (question.get("extraction", {}).get("memory") or "")
              for question in (stages.get("baseline") or {}).get("questions") or []))

    routine_by_id = {
        question.get("id"): question
        for question in (stages.get("routine") or {}).get("questions") or []
    }
    expected_routine_fields = {
        "routine-wake": "wake_time",
        "routine-sleep": "sleep_time",
        "routine-day-shape": "routine_summary",
        "routine-easy-hit": "high_dopamine_activities",
    }
    check("routine maps each of its four extraction targets",
          all(
              expected in (routine_by_id.get(qid, {}).get("extraction", {}).get("profile_fields") or [])
              for qid, expected in expected_routine_fields.items()
          ),
          str({qid: routine_by_id.get(qid, {}).get("extraction", {}).get("profile_fields") for qid in expected_routine_fields}))

    alternatives = data.get("high_dopamine_alternatives") or {}
    check("the dedicated alternatives wording is the routine-easy-hit question",
          alternatives.get("question_id") == "routine-easy-hit"
          and alternatives.get("text") == (routine_by_id.get("routine-easy-hit") or {}).get("text"))
    check("the alternatives extraction targets high_dopamine_activities",
          (alternatives.get("extraction") or {}).get("profile_field") == "high_dopamine_activities")

    metric = stages.get("metric_selection") or {}
    check("metric_selection asks no diagnostic question", metric.get("questions") == [])
    check("metric_selection states the server-owned top-three rule",
          "top three" in (metric.get("selection_rule") or "").lower()
          and "server" in (metric.get("selection_rule") or "").lower())
    catalog = {
        row.get("name"): (row.get("domain"), row.get("output_unit"))
        for row in metric.get("catalog") or []
    }
    check("the chip catalog is the eight preset names/domains/units",
          catalog == EXPECTED_CHIPS, str(catalog))

    print("== B. static: internal fragments and domain enum ==")
    state = read(STATE)
    fragments = {
        "baseline": r"baseline:\s*\"(?:[^\"]|\"\s*\+\s*\")*\"",
        "goals": r"goals:\s*\"(?:[^\"]|\"\s*\+\s*\")*\"",
        "routine": r"routine:\s*\"(?:[^\"]|\"\s*\+\s*\")*\"",
        "metric_selection": r"metric_selection:\s*\"(?:[^\"]|\"\s*\+\s*\")*\"",
    }
    # The fragments are adjacent string concatenations; collapse them for the word checks.
    def fragment_words(name):
        match = re.search(fragments[name], state, re.S)
        if not match:
            return ""
        literals = re.findall(r"\"([^\"]*)\"", match.group(0))
        return " ".join(literals)

    baseline_fragment = fragment_words("baseline")
    check("the baseline fragment names wake, sleep, energy and load",
          all(word in baseline_fragment.lower() for word in ("wake", "sleep", "energy", "load")),
          repr(baseline_fragment))
    check("the baseline fragment asks one question at a time",
          "one question at a time" in baseline_fragment.lower(), repr(baseline_fragment))
    goals_fragment = fragment_words("goals")
    check("the goals fragment names why-now and a better normal week",
          "why it matters now" in goals_fragment.lower()
          and "normal week" in goals_fragment.lower(), repr(goals_fragment))
    routine_fragment = fragment_words("routine")
    check("the routine fragment names wake, sleep, the real day and the easy hit",
          all(word in routine_fragment.lower() for word in ("wake time", "sleep time", "waking to bed", "easy hit")),
          repr(routine_fragment))
    metric_fragment = fragment_words("metric_selection")
    check("the metric fragment forbids inventing a metric",
          "do not invent a metric" in metric_fragment.lower(), repr(metric_fragment))

    content = read(CONTENT)
    enum_match = re.search(r"export const DOMAIN_ENUM = new Set\(\[(.*?)\]\);", content, re.S)
    enum_values = re.findall(r"\"([^\"]+)\"", enum_match.group(1)) if enum_match else []
    check("DOMAIN_ENUM is the canonical sixteen", enum_values == CANONICAL_16, str(enum_values))

    print("== C. static: the approved content library ==")
    with open(os.path.join(ROOT, RULES), encoding="utf-8", newline="") as handle:
        rule_rows = list(csv.DictReader(handle))
    with open(os.path.join(ROOT, EXEMPLARS), encoding="utf-8", newline="") as handle:
        exemplar_rows = list(csv.DictReader(handle))

    check("rules.csv has 144 rows", len(rule_rows) == 144, str(len(rule_rows)))
    check("exemplars.csv has 233 rows", len(exemplar_rows) == 233, str(len(exemplar_rows)))
    ruled_statuses = [row.get("status", "").strip() for row in rule_rows]
    exemplar_statuses = [row.get("status", "").strip() for row in exemplar_rows]
    check("every rule and exemplar is approved",
          set(ruled_statuses) == {"approved"} and set(exemplar_statuses) == {"approved"},
          f"rules={sorted(set(ruled_statuses))} exemplars={sorted(set(exemplar_statuses))}")

    domain_counts = {}
    for row in rule_rows:
        domain = row.get("domain", "").strip()
        domain_counts[domain] = domain_counts.get(domain, 0) + 1
    check("rules cover all sixteen domains with at least six rules each",
          set(domain_counts) == set(CANONICAL_16)
          and all(count >= 6 for count in domain_counts.values()),
          str(domain_counts))
    check("no rule carries the placeholder source",
          all("PLACEHOLDER-DEV" not in row.get("source_figure", "") for row in rule_rows))
    check("no exemplar carries the placeholder label",
          all("PLACEHOLDER-DEV" not in row.get("label", "") for row in exemplar_rows))

    print("== D. static: validator and docs ==")
    validator = run(["deno", "run", "--allow-read", "content/validate.ts"])
    output = (validator.stdout or "") + (validator.stderr or "")
    check("validate.ts exits 0", validator.returncode == 0, output.strip()[-500:])
    check("validate.ts reports approved=377", "approved=377" in output, output.strip()[-500:])

    tech = read(TECH)
    check("TECH-SPEC records the Step 6 DRAFT scripts",
          "FP-09 Step 6" in tech and "onboarding-scripts.json" in tech
          and "approved=377" in tech)
    glossary = read(GLOSSARY)
    check("GLOSSARY records the BG-06 draft identifier",
          "onboarding-scripts.json" in glossary)
    fpgb = read(FPBG)
    check("FP-BG's BG-06 row records the draft and owner review",
          "BG-06" in fpgb and "DRAFT" in fpgb and "owner review pending" in fpgb.lower())

    print("== E. static: scope ==")
    status = run(["git", "status", "--porcelain"])
    changed = set()
    for line in (status.stdout or "").splitlines():
        if not line.strip():
            continue
        name = line[3:].strip()
        if " -> " in name:
            name = name.split(" -> ", 1)[1]
        changed.add(name.replace("\\", "/"))
    allowed = {
        BG06,
        REPORT,
        SCRIPT,
        STATE,
        TECH,
        GLOSSARY,
        FPBG,
    }
    check("the Step 6 touch set is exact", changed == allowed,
          f"changed={sorted(changed)} allowed={sorted(allowed)}")
    check("package.json is unchanged", "package.json" not in changed)
    check("no SQL or migration changed",
          not any(name.endswith(".sql") or name.startswith("supabase/migrations/") for name in changed))
    check("no client file changed",
          not any(name.startswith(("app/", "components/", "lib/", "hooks/")) for name in changed))


def toolchain_checks():
    print("== F. toolchain ==")
    tsc = npx(["tsc", "--noEmit"])
    check("tsc --noEmit clean", tsc.returncode == 0,
          ((tsc.stdout or "") + (tsc.stderr or "")).strip()[-1000:])
    jest = npx(["jest", "supabase/functions/_shared/onboarding/state.test.ts", "--runInBand"])
    check("the onboarding state suite is green", jest.returncode == 0,
          ((jest.stdout or "") + (jest.stderr or "")).strip()[-1000:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc + jest")
    args = ap.parse_args()

    print("== FP-09 Step 6: BG-06 onboarding scripts + content baseline ==")
    static_checks()
    if not args.no_toolchain:
        toolchain_checks()

    print()
    if FAILS:
        print(f"{len(FAILS)} check(s) failed.")
        sys.exit(1)
    print("ALL CHECKS PASS")


if __name__ == "__main__":
    main()
