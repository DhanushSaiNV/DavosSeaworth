# FP-09 Step 6 — BG-06 onboarding scripts & content baseline

**Date:** 2026-10-27
**Status:** source-complete, **DRAFT** — opening revised after owner review; full approval pending
**Refs:** FP-BG BG-06; FP-09 FR-14, AC-8; TECH-SPEC §3.3, §7.7; D17, D22; AGENTS.md §8.4

## What landed

- `content/ui-copy/onboarding-scripts.json` — the BG-06 draft: the opening
  copy, the per-stage diagnostic questions and their extraction targets, the
  dedicated high-dopamine-alternatives wording, and the metric-chip guidance.
  The file is `status: draft` with a visible DRAFT label. It is **not seeded**.
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
The file remains `status: draft`; no live config value or opening row was changed.

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

## Owner gate (not yet performed)

The live `config.onboarding_opening_text` and the persisted
`metadata.source='onboarding_opening'` rows still carry the **labeled DRAFT
placeholder** from migration `0033`. Per AGENTS.md §8.4, only the owner can
approve owner content. On approval:

1. Flip `content/ui-copy/onboarding-scripts.json` `status` to `approved`.
2. Update `config.onboarding_opening_text` to the approved text (without the
   DRAFT prefix).
3. Rewrite every `metadata.source='onboarding_opening'` row to the same text
   (the trigger copies text; it does not reference the config).
4. Re-run `python scripts/verify-fp09-step6.py` and the Step 8 acceptance
   sweep.

No live config or message row was changed in this step.
