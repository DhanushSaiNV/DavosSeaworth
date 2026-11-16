# DRAFT — RAG smoke set and threshold calibration fixtures

**Status: `draft`. Nothing here is approved content.** These files exist so the owner can review
them, not so they can be seeded. `AGENTS.md` §8 permits an agent to draft owner content only in
`content/` with `status=draft` and a visible DRAFT label; the approved home named by
`PLAN.md` §10 is `docs/feature-prds/RAG-REDESIGN/fixtures/`, which is where these move once the
`status` flips to `approved`.

Refs: PRD §14.1 D (the ten prompt kinds), §14.2 (the manual checklist), §14.3 (no evaluation
platform), §10 (calibration); `PLAN.md` §15 (P4, gates G2/G3), §16 (ceilings), §1.10 D20/D21.

---

## 1. `smoke_prompts.json` — the ten-prompt smoke set

Ten prompts, one per PRD §14.1 D bullet. Each carries what a human judges appropriate:

| field | meaning |
|---|---|
| `expect.retrieval` | `none` means the turn must make **zero** tool calls; `required` means it must ask for data |
| `expect.datasets` | advisory. A different but valid choice is reported as a `warn`, not a failure, because the planner may legitimately pick another dataset |
| `expect.must_not_quote` | fixture-specific strings that must not appear in the evidence block |
| `expect.manual_review` | answer-level checks no observation can make. Each one keeps the verdict at `warn` |

The verdict rules live in `supabase/functions/_shared/rag/smoke.ts` (`evaluateObservation`), so a
drill cannot report a clean pass for a turn nobody read. Every observation is also checked against
`NEVER_IN_EVIDENCE` (`embedding`, `trust_score`, `tactical_analysis`, `unsavable`, `user_id`) and
against the two ceilings (`generation_requests ≤ 3`, `evidence chars ≤ 12,000`).

**How to review:** read the ten prompts and their expectations. If a prompt is not one you would
actually ask, or an expectation is wrong, edit the JSON — the set is the input to G2, so it should
reflect your product, not mine.

---

## 2. `semantic_thresholds.json` — the §10 calibration fixture

Twenty queries per semantic source, with an **empty** `judged_relevant` array. Filling those arrays
is owner judgement: it requires looking at the live corpus (144 rules, 53 memory facts at the time
of writing) and deciding which ids a human would call relevant.

The arithmetic is code, not judgement. `calibrationThreshold(similarities)` in
`_shared/rag/smoke.ts` implements PLAN.md §10:

```
threshold = round((min(similarity of true positives) - 0.02) * 100) / 100
```

It returns `null` when nothing was judged, or when the result leaves the `(0, 1]` range SQL accepts
(`0045`), because there is then no number to write — and a silent zero is the v4 defect §10 exists
to prevent.

**Procedure (PLAN.md §10, unchanged):**

1. Fill `judged_relevant` for both sources using the calibration user's own facts and the global
   rules table.
2. Run each query once against the live corpus, collecting the similarity of every judged-relevant
   pair. `match_rules_v2` returns `similarity` directly; `search_facts` returns it per fact.
3. Feed the collected similarities to `calibrationThreshold` and record the number.
4. The owner reviews the fixture and the number; only then is each value written to `config`
   (`rag_rules_min_similarity`, `rag_memory_min_similarity`).
5. Move this file to the `docs/` path, flip `status` to `approved`, and keep it as the regression
   baseline.

Until step 4, both `config` rows stay `NULL`, every semantic source reports
`threshold_uncalibrated`, and `rag_planner_enabled` must stay `false` (PLAN.md §10 item 5).

---

## 3. What is not here yet

The **runner** that produces a `SmokeObservation` per prompt is not wired. It needs a running
Supabase stack: the retrieval RPCs are `authenticated`-only, so a drill must sign in as a synthetic
user (the pattern already exists in `dev-smoke`'s `account-drill`, which mints a throwaway user and
seeds it) and then call `runRagTurn` in-process.

That wiring is deliberately left out of this draft: it cannot be executed in an environment without
the Supabase CLI or Docker, and unrun drill code inside a deployed dev function is worse than no
drill code. The pieces it will call are already tested — `smoke.ts` (fixtures, verdicts, ceiling,
threshold arithmetic) and `ragSmokeRun.ts` (per-prompt orchestration over injected dependencies).

When the stack is up, the remaining work is one `case "rag-smoke"` in
`supabase/functions/dev-smoke/index.ts`: sign in, build the user-JWT client, pass
`runRagTurn` + the extraction call as the injected dependencies, return `runSmoke(...)` as JSON.
