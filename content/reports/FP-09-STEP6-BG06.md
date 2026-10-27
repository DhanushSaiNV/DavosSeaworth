# FP-09 Step 6 — BG-06 onboarding scripts & content baseline

**Date:** 2026-10-27
**Status:** source-complete, **DRAFT** — opening approved and live 2026-10-27; stage scripts pending full approval
**Refs:** FP-BG BG-06; FP-09 FR-14, AC-8; TECH-SPEC §3.3, §7.7; D17, D22; AGENTS.md §8.4

## What landed

- `content/ui-copy/onboarding-scripts.json` — the BG-06 draft: the opening
  copy, the per-stage diagnostic questions and their extraction targets, the
  dedicated high-dopamine-alternatives wording, and the metric-chip guidance.
  The stage scripts are `status: draft` with a visible DRAFT label; the opening is
  `status: approved` and live. The file is **not seeded** as a unit.
- `_shared/onboarding/state.ts` — the internal stage-generation fragments now
  mirror the same diagnostic goals (baseline wake/sleep/energy/load, goals
  why-now/better-week, routine wake/sleep/real-day/easy-hit, metric
  do-not-invent). The fragments remain internal instructions, not owner copy.
- `scripts/verify-fp09-step6.py` — the repeatable gate for this step.

## Owner review — 2026-10-27

The owner rejected the original goal-first opening as product-onboarding voice. The
DRAFT opening is now:

> "Hey, it's Davos. We'll get to the big stuff soon enough — first, how's your day actually going?"

The greeting + single-question contract is unchanged. The goals stage keeps the
"what do you want to change first?" question, so the opening no longer duplicates it.
The owner then approved this opening and asked to make it live.

## Live promotion — 2026-10-27

- `config.onboarding_opening_text` now carries the approved text with no DRAFT prefix.
- All eight `messages` rows with `metadata.source='onboarding_opening'` were rewritten
  to the same text (8/8 exact).
- The live readback verified the config value and every row; no placeholder row remains.
- New profiles get the same text from the trigger; existing threads were updated in
  place, so current beta users see the new opening immediately.
- The stage scripts remain `status: draft`; only the opening is approved.

## Content baseline

```
content/rules.csv: OK (144 row(s))
content/exemplars.csv: OK (233 row(s))

Validation PASSED — all rows valid (status: approved=377).
```

- `_shared/content.ts` `DOMAIN_ENUM` = the canonical 16 domains (BG-02 Option 1).
- 144 approved rules across all 16 domains, with at least 6 per domain
  (the library is uneven by design; the floor is the invariant).
- 233 approved exemplars; status total `approved=377`.
- Zero `PLACEHOLDER-DEV` rows in either file.

## BG-06 stage map

| Stage | Questions | Extraction target |
| --- | --- | --- |
| `intro` | 1 (the opening itself) | optional baseline fact; no profile write |
| `baseline` | 3 | `sleep_time`, `wake_time`; optional baseline facts |
| `goals` | 3 | optional baseline facts (the goal, why now, a better normal week) |
| `routine` | 4 | `wake_time`; `sleep_time`; `routine` summary; `high_dopamine_activities` |
| `metric_selection` | 0 | 1–2 server-offered preset chips → `select-metrics` |
| `complete` | 0 | normal chat resumes |

The opening folds the greeting and the intro question into one turn. Every
question asks exactly one thing; the file contains no form/questionnaire/
checklist wording.

## Owner gate — opening approved; stage scripts pending

The opening is approved and live. The stage scripts in
`content/ui-copy/onboarding-scripts.json` remain **DRAFT**; only the owner can approve
them. On full approval:

1. Flip the file `status` to `approved` (the opening is already `approved`).
2. Re-run `python scripts/verify-fp09-step6.py` and the Step 8 acceptance sweep.

Step 6 itself changed no live config or rows; the 2026-10-27 opening promotion is
recorded above.
