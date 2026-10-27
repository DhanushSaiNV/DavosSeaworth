# FP-09 Step 7 — RAG prompt boundary & live content verification

**Date:** 2026-10-27
**Status:** complete — `scripts/verify-fp09-step7.py` green
**Refs:** FP-09 FR-15 … FR-18, AC-9, AC-11; TECH-SPEC §3.4 item 7, §5.2, §6.4, §7.5, §7.7, §10.5, §13; D5, D17

## What landed

- `runLockedPersonaReply` gained `omitRules?: boolean`, threaded into `generateReply`.
  `runProactive` passes `omitRules: true`, so the proactive prompt has **no rules
  block at all**, not even the "none retrieved" line. The D7 `General` domain already
  retrieves zero rules; the option makes the boundary structural.
- `generate.prompt.test.ts` now proves a **non-empty** rules array is omitted on an
  `omitRules` turn (the earlier interview test only pinned an empty array).
- `scripts/verify-fp09-step7.py` gates the static boundary, the live retrieval/conflict
  readings, the live prompt build, the `content-seed` counts, and the scope.

## Live readings

| Check | Reading |
| --- | --- |
| `General` retrieval | `retrieved: 0`, `surviving: 0` |
| `Career` retrieval | `retrieved: 5`, `surviving: 5` |
| `Family` conflict pair | `retrieved: 5`, `surviving: 4`, `droppedTone: "aggressive"`, `window: 15` |
| `content-seed` counts | `rules 144/144` with embeddings, `exemplars 233/233` with embeddings |
| Prompt build (survivors) | contains every surviving rule text; no dropped aggressive text |
| Prompt build (`omitRules`) | no `Relevant coaching rules`, no `none retrieved`, no rule text |

The Family pair is the live §5.2 witness: the aggressive group's max priority is 74,
the empathetic group's is 82, the difference (8) is inside the seeded
`conflict_priority_window` (15), so the lower-priority aggressive group is dropped.
The prompt build uses the returned survivors, so the dropped tone cannot appear in the
generated system prompt.

## Boundary map

- **Intake answers:** `runPipeline` skips `match_rules` on the onboarding branch and
  passes `omitRules: onboardingTurn`; the prompt builder emits no rules block.
- **Complete turns:** `runPipeline` still calls `retrieveRules` and passes survivors.
- **Proactive:** `runProactive` passes `omitRules: true`; the context builder carries
  only silence hours, journal-gap days, and one delimited metric name/direction — no
  drift, habit, watch, or impulse data.
- **Delimiters:** `<user_message>` wraps generation and extraction turns;
  `<recalled_memory>` fences baseline facts; `<proactive_context>` fences the proactive
  context; `<metric_name>` sanitises angle brackets in the only user-authored name.

## Rollback / seeder readiness

`content-seed` answers `{action:"counts"}` live (144/144, 233/233) and retains the
`clear` action (explicit ids or dev label). The BG-04 swap runbook documents the
`seed-exemplars` / `clear-exemplars` rollback. No clear was executed in this step — the
counts are the readiness evidence, and destroying live corpus rows is an owner action.

No live config or message row was changed in this step.

## Known stale gates (not Step 7 regressions)

These historical scripts still assert pre-FP-09 shapes and fail on the branch; Step 7
does not touch their subjects:

- `verify-fp06-step5.py --static-only`: four checks still look for the memory append
  inside `generate.ts`. FP-09 Step 3 moved prompt assembly to `generatePrompt.ts`
  (the Step 3 gate pins the new location).
- `verify-fp06-step7.py --static-only`: its request union predates the Step 3
  onboarding-drill actions.
- `verify-fp08-step8.py` / `verify-fp08-closeout.py`: both still assert the registry
  phrase "fourteen** with dispatcher handlers". FP-09 Step 5 closed the registry at
  fifteen; `verify-fp04-step6.py` was updated then. The closeout git-shape leg is
  green after the Step 7 commit.
- `verify-fp09-step4.py` / `verify-fp09-step5.py`: their touch-set checks compare the
  whole `fp09` branch diff and only pass at their own step.

`scripts/verify-fp09-step7.py` avoids the last problem: it reads the working tree when
dirty and falls back to `git show --name-only HEAD` when clean, so it stays runnable
after the commit.
