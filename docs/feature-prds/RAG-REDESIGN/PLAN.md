# Davos RAG Redesign — Consolidated Implementation Plan

**Status:** planning complete, **awaiting owner approval**. No code, migration, config row or PRD change has been written.
**Spec:** `docs/feature-prds/RAG-REDESIGN/Davos_RAG_Redesign_PRD.md` (normative).
**Live project:** `cbwujqezrvqfcicpuwtq` (branch `main`). Every claim below marked *[live]* was read from that project's catalog on 2026-11-15.
**Supersedes:** implementation plans v1–v4 (chat only). This document is the single plan of record.

---

## 0. Reading order

1. §1 corrections applied in this pass — the reasons this plan differs from v4.
2. §3–§4 architecture and pipeline.
3. §5 dataset registry → §6 SQL contracts → §7 privilege matrix (the three normative tables).
4. §8 compliance, §9 timezone, §10 thresholds, §11 evidence, §12 budget.
5. §13 migrations, §14 tests, §15 rollout, §16 acceptance, §17 limitations.
6. §18 decision provenance: B-1 and B-4–B-9 are implemented in P0/P1; B-2 and B-3 are not yet exercised because pipeline wiring is out of P2 scope.

---

## 1. Corrections applied in this final pass

Six defects were found in v4. Each is listed with the evidence that produced it and what changed. A seventh was found during P0 implementation and is recorded in §1.7.

### 1.1 Check-in compliance

| defect in v4 | correction |
|---|---|
| `hours_logged` was `answered_windows × cadence_minutes` (hours, not minutes) | `hours_logged = answered_windows × cadence_minutes / 60` — the same formula the existing view already uses at `supabase/migrations/0031_metrics_fp07.sql:76-77`. |
| Local-day attribution implied `logged_at` | `logged_at` is the window **close** (`supabase/functions/submit-checkin/index.ts:496`); `checkin_window` is the window **start** (`:425,497`). `checkin_window` is now the grid-matching key and the local-day key. |
| Answered windows were never reconciled against the grid | TypeScript matches each answered `checkin_window` start against `windowsForLocalDay(grid, day)` starts; unmatched starts are counted and reported, never silently accepted. |
| `list_answered_windows` had `p_limit` default 500 | No limit parameter, no `LIMIT` clause. Exact per-local-day grouping, with a hard, typed range guard instead of truncation. |
| No `complete` / coverage signal | Per-block `complete` + `coverage` in the evidence envelope (§11), and `bundle_incomplete` at bundle level. |
| Zero-denominator undefined | `compliance_rate = null` with `compliance_state = "no_scheduled_windows"`; range-level `days_excluded_zero_scheduled` reported. |

Denominator arithmetic stays in TypeScript. No SQL scheduled-window count exists anywhere in this plan.

### 1.2 Energy range

v4 assumed no CHECK constraint. **Wrong** *[live]*: `doings_logs_energy_check` = `CHECK (((energy >= 1) AND (energy <= 10)))`. Both layers now validate `1 ≤ min ≤ max ≤ 10`; SQL raises `22023`, TypeScript rejects before dispatch.

### 1.3 Client column grants

Verified from actual `.select()` projections, not relation references. Four client files touch tables directly (`lib/todayService.ts`, `lib/proofService.ts`, `lib/chatService.ts`, `lib/metricsService.ts`) plus `lib/checkins.ts`, `lib/onboardingStage.ts`, `lib/config.ts`, `lib/push.ts`. Findings and the resulting matrix are in §7. Three v4 errors corrected: `metrics.is_core` must **not** be granted; `profiles` needs 6 columns, not 7 (`display_name` is selected by nothing); `messages.unsavable` UPDATE is **not** required by `flag-unsavable`.

### 1.4 Old `match_rules`

Retrieved with `pg_get_functiondef()` *[live]*. The body is fully unqualified:

```sql
select * from rules where domain = match_domain order by embedding <=> query_embedding limit match_count;
```

`SET search_path = ''` would break it. The migration now **replaces the body** with a fully qualified one, preserving signature, parameter names, default and return type (§6.5). A service-role regression test proves the legacy path still works.

### 1.5 Semantic thresholds

`p_min_similarity` no longer has a default on either semantic function. SQL rejects `≤ 0` and `> 1`. The executor reads calibrated values from `config` and fails closed when they are absent (§10).

### 1.6 Function count

**18 new functions** = 17 `SECURITY DEFINER` + 1 `SECURITY INVOKER` (`current_user_timezone()`), including `match_rules_v2`. v4 said 15. B-7, the migration estimates, the test matrix and the effort estimate are corrected in §6.1, §13, §14 and §18.

### 1.7 `push_tokens` needs `SELECT` after all (found during P0)

The matrix in §7 said `push_tokens` loses `SELECT` because `lib/push.ts:82` requests no representation. **Wrong**, and it broke push registration in production between `0040` and `0043`.

`lib/push.ts:82` is an upsert: `INSERT ... ON CONFLICT (user_id, token) DO UPDATE`. Postgres requires **table-level `SELECT`** on the target table for the `ON CONFLICT DO UPDATE` path regardless of the requested representation, because the executor locks and re-reads the conflicting tuple. Without it the statement fails `42501 permission denied for table push_tokens`. A column-level `GRANT SELECT (user_id, token)` is **not** sufficient — both facts were reproduced against the migrated schema.

`0043_rag_push_tokens_upsert_select.sql` restores `SELECT` plus the `push_tokens_select_own` policy, i.e. the pre-`0040` client contract from `0005:56` and `0005:22`. The `REVOKE ALL` hardening still removes `TRUNCATE`, `REFERENCES` and `TRIGGER`, which the old `arwdDxtm` included. `anon` still holds nothing.

Consequence for §7 and §14: `push_tokens` keeps `SELECT` (own rows only), and the `push_tokens?select=*` row in the T4 denial matrix is now an **allowance**, not a denial. `scripts/verify-rag-p0.py` derives the requirement from the source, so any future client upsert with `onConflict` on a table without table-level `SELECT` fails the static check.

### 1.8 Phase 1 decisions D1–D6 (settled during implementation)

These were approved before the P1 migrations were written, or discovered while writing them. They are
the answers to questions §6.4 left open; none of them changes a dataset, an operation or a privilege.

- **D1 — `query_*` return shape.** One typed table per dataset: a common prefix (`bucket_start date`,
  `n bigint`, `value numeric`, `id uuid`, `occurred_at timestamptz`, `total_count bigint`) plus only
  that dataset's dimension and payload columns. TypeScript strips the nulls. `total_count` is
  `count(*) over ()`, i.e. the row count **before** `LIMIT`, so the envelope can report completeness.
- **D2 — the 20-row content cap is a clamp, not a rejection.** PRD line 491 caps `content` at 20 rows.
  The default `p_limit` is 200, so rejecting `p_limit > 20` would make every default `list` call fail.
  `query_checkins` therefore uses `least(p_limit, 20)` for `list` and `latest`. `content` is `NULL`
  outside `list`, and truncated to 280 characters.
- **D3 — `hours_logged` is computed in SQL.** §6.4 said "derived in TS". It is `count(distinct
  checkin_window) per local day × checkin_cadence_minutes / 60`, computed inside `query_daily_vars`,
  so the grid denominator and the reported hours cannot disagree.
- **D4 — validate an enum array only where a live `CHECK` exists.** `doings_logs.source`,
  `doings_logs.kind`, `messages.role`, `journal_entries.severity`, `habits.status`,
  `metrics.formula_status`, `metrics.quest_status` all have `CHECK` constraints and are validated.
  `metrics.domain`, `rules.domain` and `messages.metadata->>'source'` have **no** `CHECK`, and the
  16-domain enum exists nowhere in the repository, so `p_domain`, `p_domain_hints` and `p_sources`
  (conversation) are opaque equality/hint filters: an unknown value yields zero rows or an inert
  hint, never an error. Inventing the enum would be the "do not invent" failure.
- **D5 — embedding parameters are declared unconstrained `vector`.** A `vector(768)` parameter is
  dimension-checked by the cast before the body runs, which makes the documented SQLSTATE
  unreachable. `p_query_embedding vector` + `public.vector_dims(...) is distinct from 768` →
  `22023 embedding_dimension`.
- **D6 — no `p_metric` selector (found while writing `0046`).** The §6.4 signatures have no metric
  argument, so `aggregate` returns every metric the dataset's registry row allows, as columns
  (`window_count`, `energy_avg`, `energy_sum`, `energy_min`, `energy_max` for `checkins`). The PRD's
  model-selected `metrics` array therefore becomes a **read** selection made by the P2 executor over
  those columns, not a SQL argument. This keeps the allowlist in SQL and the choice in one place. The
  alternative — a `p_metric` argument — would have added a selector that §6.4 does not have and that
  the PRD does not require.

Two further implementation notes that are not decisions but constraints on later work, plus one
grant clarification:

- **`aggregate` grouping is a facet list**, one row per requested dimension and value (the same shape
  as `summarize_memory_facts`), never a cross-tab. A null or empty `p_dimensions` produces one
  overall row. A fixed `RETURNS TABLE` cannot carry an arbitrary cross-tab.
- **Date basis is per dataset, not uniform.** A timestamp-derived date (`checkins`, `impulse_events`,
  `conversation`, `daily_vars`, `habits.detected_at`, `metrics.created_at`) is converted through the
  profile zone, and only when that filter or dimension is actually used. A pure date column
  (`entry_date`, `plan_date`, `quest_deadline`, `computed_for`) is never shifted. The §6.2 future clamp
  applies only to timestamp-derived ranges, so a deadline or plan-date range may point forward.
- **`match_rules_v2` grants `service_role` as well as `authenticated`**, but the §6.1 prologue rejects
  a null `auth.uid()`, so a service-role call must carry the user's JWT claims — which is exactly what
  an Edge Function forwarding the caller's token does. The grant is not a bypass and does not widen
  the corpus.

---

### 1.9 Phase 2 decisions D7–D13 (settled while writing the TypeScript layer)

P2 is TypeScript only: no migration, no prompt change, no pipeline wiring, and
`rag_planner_enabled` stays `false`. These are the answers the SQL contracts left to the executor.

- **D7 — arguments are assembled against the RPC's real parameter list.** The ten `query_*`
  functions take `p_op`; the memory functions do not; `count_memory_facts` has neither `p_limit`
  nor `p_dimensions`; `read_schedule_profile` takes no arguments at all. `registry.ts` carries
  `RPC_PARAMS` transcribed from the `create or replace function` headers, and the executor builds
  only parameters the target declares. `p_op` is executor-generated and is dropped where absent;
  every other parameter came from the model, so a parameter the function does not declare is a
  rejection, never a silent omission. (An undeclared named argument is a PostgREST 404, not a
  Postgres error, which is why this is enforced in TypeScript.)
- **D8 — `month` is a bucket only for `metric_series`.** `query_metric_series` accepts
  `('day','week','month')`; every other timeseries function accepts `('day','week')` and raises
  `invalid_bucket` for `month`. The registry encodes exactly that. This is recorded as a
  limitation of the registry, not fixed by a migration: widening the other functions would change
  a P1 contract after it was applied to production.
- **D9 — an unsupported DSL key is rejected, never ignored.** `order`, `cursor`, `datetime_from`
  and `datetime_to` do not exist on any RPC, so they are `unknown_argument`. A `limit` on
  `count_memory_facts`, `read_schedule_profile` or `checkin_compliance` is `unknown_argument`
  because those calls have no row cap to control; a `group_by` outside `summarize_memory_facts`
  and the facet aggregates is `unsupported_dimension`. Two deliberate allowances: an empty
  `group_by: []` means "no dimensions" (matching `0044:524` and every `v_dims` coalesce), and an
  empty filter array is `invalid_argument_type` rather than a zero-row query.
- **D10 — `hours_logged` exists twice, with one formula.** `query_daily_vars` computes it in SQL
  (D3) and `compliance.ts` computes it as `answered × cadence / 60`. Both are the formula of
  `0031_metrics_fp07.sql:76-77`, and `compliance.test.ts` asserts the TS side for both cadences.
  Cross-language equality for the same fixtures stays a P1 harness assertion
  (`rag_p1_fixtures.sql`), because P2 has no database integration tests.
- **D11 — `limit` is required for `list` only.** PRD lines 459 and 471 say so explicitly;
  `count`, `aggregate`, `timeseries` and `latest` fall back to the SQL defaults. `latest` is
  clamped to 20 in SQL, and `query_checkins` `list` is clamped to 20 by D2, so the executor applies
  the same clamps (`effectiveLimit`) rather than rejecting a value the database would accept.
- **D12 — the profile is read once per plan.** `read_schedule_profile` is needed for the compliance
  grid, and its `timezone` is what labels every block and computes `coverage`. The dispatcher
  therefore reads it once whenever the plan is non-empty, and never for a no-retrieval plan (PRD
  C1). A profile failure does not block pure-date datasets; it makes compliance and any
  timezone-derived block `unavailable` with the SQL's own reason.
- **D13 — compliance rows are not projected through `spec.payload`.** `checkin_compliance` has no
  RPC and no fixed `RETURNS TABLE`: a timeseries day row and an aggregate totals row have different
  columns. The block carries the rows `compliance.ts` shaped, with the schedule-history limitation
  always attached.

Module split, mirroring `windows.ts` / `loadGrid.ts`: `types.ts`, `registry.ts`, `executor.ts`,
`thresholds.ts`, `compliance.ts` and `evidence.ts` are pure; `dispatch.ts` is the only module that
talks to a client, and it does so through a three-method structural interface so it imports neither
`supabase-js` nor `Deno.env`.

### 1.10 Phase 3 decisions D14–D16 (settled while writing the planner)

- **D14 — the plan schema is closed on every field the registry can enumerate, and open on
  `arguments`.** `dataset`, `op`, `priority`, `intent` and `answer_mode` are enums generated from
  `registry.ts` / `planner.ts`, so the wire schema cannot describe a dataset or operation that does
  not exist. `arguments` stays a permissive object because the fifteen datasets share no filter
  vocabulary and Gemini's restricted `Schema` proto (`geminiSchema.ts`) cannot express a
  per-dataset union without duplicating the whole registry into the wire schema — which would then
  drift from the registry it duplicates. The per-dataset detail lives in the generated catalogue
  inside the instruction, and `executor.ts` rejects anything the catalogue did not allow. The
  consequence is stated plainly: schema-validity is not plan-validity, and the executor is the only
  authority on arguments.
- **D15 — the §7.3 classifications are derived at render time, not stored on the block.** Five of
  the six classifications can come out of a database, and `evidenceClassification` maps each
  dataset to one: `checkin_compliance`/`daily_vars` → derived metric, `memory_search`/`memory_facts`
  → semantic memory, `rules_search` → guiding principle, `unavailable` → unsupported/unavailable,
  everything else → observed fact. The sixth, general knowledge, is not a block at all — it is the
  model's own — so it is governed by the standing rules (`EVIDENCE_RULES`), which is also why no
  block type carries it. Keeping the label out of `evidence.ts` means the allocator's character
  budget stays independent of prose, and the mapping is asserted by `evidencePrompt.test.ts` rather
  than by the assembler.
- **D16 — a plan that cannot be read is a plan that asked for nothing.** `parsePlan` validates the
  wrapper before the array, cross-checks `retrieval_required` against `retrieval_requests` in both
  directions (a "no retrieval" plan carrying requests, and a "retrieval required" plan carrying
  none), rejects unknown request keys (D9's rule, applied to the plan), trims `purpose` and caps it
  at 120 characters. A rejection degrades to `noRetrievalPlan()` — the turn is answered without
  evidence and the reason is recorded as a non-sensitive validation event (PRD line 369). The
  planner rides the extraction response, so the appendix is appended to `EXTRACTION_SYSTEM` rather
  than issued as a second provider call, and the new `withRagPlan` parameter of
  `buildExtractionSchema`/`buildExtractionSystem` defaults to `false` so every pre-P3 call site
  produces a byte-identical prompt and schema.
- **D17 — the ledger exists only on a planner turn, and a refusal is not a transport failure.**
  `createBudget()` runs at turn start with `reserved = 1`, so extraction can never spend the
  answer's last request; `generateReply` releases the reservation because the stage that spends is
  the stage that releases. The adapter charges once per provider request (stub included) and
  refuses **without a network call** at the ceiling, returning `kind: "budget"`. That kind is
  deliberately outside `needsRetry`: the `llm_retry` job inherits the same exhausted ledger, so a
  job would arrive already spent. On the legacy path there is no ledger at all, which is what makes
  `rag_planner_enabled = false` restore the old provider-request count as well as the old prompt.
- **D18 — the refinement answer replaces the first, and a failed refinement never costs it.**
  After the first answer, `refinementAllowed` (`total − used ≥ 1`) is the only gate: a turn whose
  answer needed the fallback cannot refine (§12.3 row 8). The second `generateReply` sends
  `allowRefinement: false` (no third round) and the same ledger, and its bundle is
  `mergeBundles(first, second)` — flags OR-ed, so a clean second round cannot make an incomplete
  first round look complete. If the second dispatch or the second answer fails, the first answer is
  kept: it is already complete and non-empty (`isGenerateResponse` now requires a non-blank
  `direct_quote`), so trying to refine can never make the reply worse.
- **D19 — deviations accepted while wiring the turn.**
  - `write_degrade_pair` inserts the job unconditionally, so a turn with `remaining = 0` cannot
    omit it. The payload carries `0` and the dispatcher closes the job without a provider call
    rather than adding a second RPC or a nullable job argument.
  - `DispatchOptions.todayLocal` stays unset: the profile row is already read once inside
    `dispatchPlan` for the compliance grid, and reading it again just to clamp future dates would
    add a query per turn. The executor therefore skips the `date_range_in_future` check on the
    planner path (the plan's windows are relative phrases the prompt already bounds).
  - The two similarity thresholds are read as *nullable* (a `null` row means uncalibrated, which the
    executor fails closed), while `rag_evidence_total_chars` and `rag_max_plan_requests` use
    `getConfigNumber`, so a missing seeded value is a surfaced deploy defect rather than a silent
    default.
  - A planner-mode stub turn receives `STUB_RAG_PLAN`, a **no-retrieval** plan. A stub plan that
    asks for data would have to invent fixtures; the retrieval-bearing stub belongs to the P4
    smoke harness.
  - The `llm_retry` job re-runs stages 3–5 on the **legacy** retrieval path. The plan rode the
    extraction response and is not in the job payload, so a degraded planner turn is answered
    without evidence. Carrying the plan across the job boundary would need a new payload field and
    a TECH-SPEC revision; the ledger (`generation_budget_remaining`) is the only thing that crosses.
  - `ragPlannerEnabled()` is read before stage 1 — one extra config read — so the extraction
    contract is built once with the flag already resolved instead of being rebuilt mid-turn.
  - Only the two user-turn callers (`send-message`, `submit-checkin`) supply `ragClientFor(req)`.
    `runLockedPersonaReply`'s callers (watchdog, journal probe, `select-persona`) have no user turn
    to plan and stay on the legacy path; so does any caller that omits `ragClient`, which is also
    the defence for a `--no-verify-jwt` deployment.

---

## 2. Scope and governing references

**In scope:** the retrieval path only — planner, tool registry, SQL access functions, evidence assembly, privilege hardening, the generation budget.

**Out of scope, unchanged:** the provider adapter's model selection, persona system, classifier, journal chain, metrics evaluation, watchdog, proactive ticks, push, onboarding, the `metric_vars_daily` view, and every pre-existing local-date defect (`0031:38,46,115-119`, `0032:138-150`, `0033:245-306`). Those are recorded in §17 and must not be "fixed" opportunistically here.

**Governing references:** PRD §4.4 (budget), §5 (planner), §6 (registry), §7 (evidence), §8 (response rules), §9 (security), §10 (vectors), §12 (budgets), §13 (errors), §14 (tests), §15 (phases), §16 (acceptance). Repo rules: `AGENTS.md` §4.1–4.8, §7.7, §9.

---

## 3. Target architecture

```
send-message / submit-checkin / runWatchdog
  └─ runPipeline()
       ├─ embed user text                                   (1 embedding call, reused)
       ├─ extract (structured turn analysis)                (provider request 1)
       ├─ classify / persona / severity gate                 (unchanged)
       ├─ [rag_planner_enabled = true]
       │    ├─ plan()      → validated RAGPlan              (no provider request: reuses the
       │    │                                                extraction response's structured output)
       │    ├─ execute()   → one RPC per plan entry         (concurrent, no provider calls)
       │    ├─ assemble()  → EvidenceBundle                 (char caps, priorities, flags)
       │    └─ generate()  → answer                          (provider requests 2–3)
       │         └─ optional single refinement round        (only if budget remains)
       └─ [rag_planner_enabled = false] legacy path          (retrieveRules + match_facts, unchanged)
```

**New modules** (all under `supabase/functions/_shared/rag/`, none importing a provider SDK):

| module | responsibility |
|---|---|
| `registry.ts` | the 13 datasets: name, operations, filters, metrics, dimensions, buckets, limits, RPC binding. Single source of truth; the planner schema is generated from it. |
| `planner.ts` | builds the planning instruction, validates the plan against `registry.ts`, rejects unknown keys. |
| `executor.ts` | maps one plan entry to one RPC call, validates arguments **again** before dispatch (never trust the model twice over), maps Postgres error codes to typed states. |
| `compliance.ts` | the only implementation of scheduled/answered/rate arithmetic; wraps `windowsForLocalDay` / `windowsClosedBetween`. |
| `evidence.ts` | envelope construction, priority allocation, char budget, omission stubs, bundle flags. |
| `budget.ts` | the provider-request ledger (§12). |
| `thresholds.ts` | reads and validates the calibrated similarity thresholds; fails closed. |

**Why a planner at all:** the current pipeline retrieves rules and memory unconditionally (`runPipeline.ts:913-936`) and cannot answer "how many check-ins did I miss last week". The planner is the only component that can choose *which* dataset answers a question. It is gated off by default.

---

## 4. Pipeline and integration points

| step | current code | change |
|---|---|---|
| embed | `runPipeline.ts:660` | unchanged; the same vector is reused for memory and rules retrieval (PRD §4.4 "Embeddings"). |
| extract | `runPipeline.ts:665` | gains the planner output in the same structured response when the planner is on (§12.2). |
| classify | `runPipeline.ts:699-707` | unchanged. |
| rules + memory retrieval | `runPipeline.ts:913-936` | **planner on ⇒ skipped unconditionally.** The planner requests them only when it decides they matter (PRD §5.4 rule 5). |
| generate | `runPipeline.ts:967`, `:1105-1170` | evidence-aware prompt; refinement round; budget ledger. |
| legacy | `retrieveRules.ts:63-68`, `classifyReal.ts:98` | unchanged behaviour, service-role clients, now the only callers of the old functions. |

`rag_planner_enabled = false` by default. Every planner code path is behind it, and the fallback is the current behaviour verbatim — so the flag is a true kill switch.

---

## 5. Dataset registry — 13 datasets (PRD §6.1)

Normative. The model may not request anything not listed. `compare_periods` (PRD line 464, optional) is **not implemented** in release 1.

| # | dataset | source | ops | RPC |
|---|---|---|---|---|
| 1 | `checkins` | `doings_logs` where `kind='doing'` | list, count, aggregate, timeseries, latest | `query_checkins` |
| 2 | `impulse_events` | `doings_logs` where `kind='impulse_failure'` | count, aggregate, timeseries, metadata list | `query_impulse_events` |
| 3 | `checkin_compliance` | `doings_logs` + the frozen grid | aggregate, timeseries | `list_answered_windows` + `compliance.ts` |
| 4 | `journal` | `journal_entries` | count, aggregate, timeseries, metadata list | `query_journal_entries` |
| 5 | `anchor_plans` | `anchor_plans` | list, aggregate, latest | `query_anchor_plans` |
| 6 | `habits` | `habits` | list, aggregate | `query_habits` |
| 7 | `metrics_catalog` | `metrics` | list, aggregate | `query_metrics_catalog` |
| 8 | `metric_series` | `metric_points` ⋈ `metrics` | list, timeseries, latest, aggregate | `query_metric_series` |
| 9 | `quests` | `metrics` where `is_quest` | list, aggregate | `query_quests` |
| 10 | `daily_vars` | derived per local day | list, timeseries, aggregate | `query_daily_vars` + `list_answered_windows` |
| 11 | `conversation` | `messages` | count, aggregate, timeseries, metadata list | `query_conversation` |
| 12 | `memory_facts` | `memory_facts` | list (≤50), count, aggregate | `list_memory_facts`, `count_memory_facts`, `summarize_memory_facts` |
| 13 | `schedule_profile` | `profiles` (allowlisted) | read_one | `read_schedule_profile` |

### 5.1 Two registry entries that cannot be honoured

Reported rather than approximated (PRD line 482: "must not silently expand").

| entry | live evidence | resolution |
|---|---|---|
| `anchor_plans` dimension `status`, metric "anchor count by status" (PRD line 524-525) | live `anchors` elements are `{id?, start, end, label, kind}` — `domain/DayContext.tsx:353-358`; `anchor_plans.anchors` is `jsonb`, there is no `status` and no `evidence` | dimension `status` rejected with `22023 unsupported_dimension`; `title` is projected from `label`; `evidence` reported as a `limitations` entry. **Owner decision B-6.** |
| `anchor_plans` field `title` / `evidence` (PRD line 527) | as above | same |

0 live `anchor_plans` rows *[live]*, so there is no data to validate a guess against. Inventing a `status` would be a schema change, which is out of scope.

---

## 6. SQL contracts

All functions: `SECURITY DEFINER`, owner `postgres`, `SET search_path = ''`, `REVOKE ALL ON FUNCTION … FROM PUBLIC` immediately after creation, then `GRANT EXECUTE` to the stated role only. Body prologue:

```sql
v_uid := auth.uid();
IF v_uid IS NULL THEN
  RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
END IF;
```

Every function qualifies tables (`public.x`), functions (`auth.uid()`, `public.current_user_timezone()`, `public.vector_dims(...)`) and operators (`OPERATOR(public.<=>)`). `pg_temp` is **not** in any search path (§9).

### 6.1 Function inventory — 18 new

| # | function | security | grants |
|---|---|---|---|
| 1 | `current_user_timezone()` | **INVOKER** | none (owner-only, called from DEFINER bodies) |
| 2 | `read_schedule_profile()` | DEFINER | `authenticated` |
| 3 | `list_answered_windows(date, date)` | DEFINER | `authenticated` |
| 4 | `search_facts(vector, double precision, …)` | DEFINER | `authenticated` |
| 5 | `list_memory_facts(…)` | DEFINER | `authenticated` |
| 6 | `count_memory_facts(…)` | DEFINER | `authenticated` |
| 7 | `summarize_memory_facts(…)` | DEFINER | `authenticated` |
| 8 | `match_rules_v2(…)` | DEFINER | `authenticated`, `service_role` |
| 9 | `query_checkins(…)` | DEFINER | `authenticated` |
| 10 | `query_impulse_events(…)` | DEFINER | `authenticated` |
| 11 | `query_anchor_plans(…)` | DEFINER | `authenticated` |
| 12 | `query_habits(…)` | DEFINER | `authenticated` |
| 13 | `query_metrics_catalog(…)` | DEFINER | `authenticated` |
| 14 | `query_metric_series(…)` | DEFINER | `authenticated` |
| 15 | `query_quests(…)` | DEFINER | `authenticated` |
| 16 | `query_daily_vars(…)` | DEFINER | `authenticated` |
| 17 | `query_conversation(…)` | DEFINER | `authenticated` |
| 18 | `query_journal_entries(…)` | DEFINER | `authenticated` |

**17 DEFINER + 1 INVOKER = 18.** No generic executor, no shared query builder, no dynamic SQL. Each function is roughly 20–40 lines. The `search_facts` grant excludes `service_role` deliberately: the JWT path must be the only path, so an authenticated-only grant is itself the proof.

### 6.2 Identity, schedule, grid

```sql
-- (1) INVOKER, zero args, auth.uid() only. No EXECUTE grant to any role.
public.current_user_timezone() returns text

-- (2) DEFINER
public.read_schedule_profile() returns table (
  timezone text,
  checkin_cadence_minutes integer,
  checkin_active_hours_start time,
  checkin_active_hours_end time,
  wake_time time,
  sleep_time time,
  onboarding_stage text,
  dialog_state text,
  profile_created_at timestamptz,
  day_basis text)          -- always 'profile_local_day'

-- (3) DEFINER — exact, never truncated
public.list_answered_windows(p_from date, p_to date) returns table (
  local_day date,
  answered_count integer,
  answered_starts timestamptz[],
  first_logged_at timestamptz,
  last_logged_at timestamptz)
```

`current_user_timezone()` rules:
- `select timezone from public.profiles where id = auth.uid()`.
- null, missing profile, or `not exists (select 1 from pg_timezone_names z where z.name = tz)` → `RAISE EXCEPTION 'timezone_unavailable' USING ERRCODE = '22023'`.
- **No UTC fallback.** The `coalesce(p.timezone,'UTC')` convention in `_shared/checkin/loadGrid.ts:41-42` and `0031:31` is *not* copied; retrieval must not silently invent a zone.

`read_schedule_profile()` rules:
- `id = auth.uid()`; no profile → `22023 profile_unavailable`.
- `timezone` from `current_user_timezone()` (single source, so the two can never disagree).
- `checkin_cadence_minutes IN (60,120)` else `22023 grid_unavailable`.
- returns `profile_created_at` = `profiles.created_at`; used **only** as the compliance denominator's lower clamp (§8.2). Not exposed to the client column grant.
- never returns `trust_score`, `lockdown_started_at`, `routine`, `high_dopamine_activities`, `latest_energy`, `updated_at`, `display_name`.

`list_answered_windows()` rules:
- `d.user_id = v_uid`, `d.kind = 'doing'`, `d.checkin_window IS NOT NULL`.
- Local day = `(d.checkin_window AT TIME ZONE tz)::date`, **not** `logged_at`. Bounds: `local_day BETWEEN p_from AND p_to`.
- `answered_count = count(*)` — exact, because `doings_logs_one_checkin_window` is `UNIQUE (user_id, checkin_window) WHERE checkin_window IS NOT NULL` *[live]*, so one row per window and no duplicates are possible.
- `answered_starts = array_agg(d.checkin_window ORDER BY d.checkin_window)`.
- **No `LIMIT`.** Truncation is impossible by construction. A range guard replaces it:
  `IF (select count(*) from …) > v_max THEN RAISE EXCEPTION 'range_too_large: % answered windows, cap %' USING ERRCODE='22023'`.
  `v_max` = `config.rag_compliance_max_windows`, default 2000. At a 14-window day (60-min cadence, 08:00–22:00) that is ≈142 days; at 120-min cadence ≈285 days. The planner instruction states the cap, and the tool returns `evidence_state: "unavailable"`, `reason: "range_too_large"` if it trips.
- Validation: `p_from`/`p_to` non-null; `p_from <= p_to`; `(p_to - p_from) <= 366`; `p_to <= (now() AT TIME ZONE current_user_timezone())::date`.
- Returns raw answered windows only. **No scheduled count, no ratio, no hours.** Those are TypeScript (§8).

### 6.3 `memory_facts` — four functions, no table access

Direct `authenticated` table access to `memory_facts` is revoked (§7). These four functions are the only surface.

```sql
public.search_facts(
  p_query_embedding vector(768),
  p_min_similarity double precision,        -- NO DEFAULT (see §10)
  p_fact_types text[] default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 5)
returns table (id uuid, fact text, fact_type text, created_at timestamptz,
               has_source boolean, similarity double precision)

public.list_memory_facts(
  p_fact_types text[] default null, p_from date default null,
  p_to date default null, p_has_source boolean default null,
  p_limit integer default 50)
returns table (id uuid, fact text, fact_type text, created_at timestamptz, has_source boolean)

public.count_memory_facts(
  p_fact_types text[] default null, p_from date default null,
  p_to date default null, p_has_source boolean default null)
returns bigint

public.summarize_memory_facts(
  p_fact_types text[] default null, p_from date default null,
  p_to date default null, p_has_source boolean default null,
  p_dimensions text[] default null)
returns table (dimension text, key text, n bigint)
```

| rule | enforcement (inside SQL) |
|---|---|
| ownership | `m.user_id = v_uid` |
| null auth | `42501 not_authenticated` |
| purged | `m.purged_at IS NULL` hard-coded, never a caller argument |
| embedding / `embed_model` | absent from every `RETURNS TABLE` — the type makes them unreachable |
| source ids | not returned; `has_source := (m.source_message_id IS NOT NULL OR m.source_journal_id IS NOT NULL)` |
| `p_fact_types` | `<@ ARRAY['chat','journal','baseline','oath']` else `22023 invalid_fact_type` |
| dates | both null or both present; `p_from <= p_to`; span ≤ 366 days; `p_to <= (now() AT TIME ZONE current_user_timezone())::date` |
| `p_limit` | `search_facts` 1–5, `list_memory_facts` 1–50 (PRD line 589) |
| `p_min_similarity` | `> 0 AND <= 1` else `22023 similarity_threshold_invalid` |
| `p_dimensions` | `<@ ARRAY['fact_type','created_day']` else `22023 unsupported_dimension` |
| search | `m.embedding IS NOT NULL AND 1 - (m.embedding OPERATOR(public.<=>) p_query_embedding) >= p_min_similarity`, ordered by similarity then `id`, `limit p_limit`; uses `idx_memory_facts_embedding` (hnsw, *[live]*) |
| baseline arm | **not** reproduced. The legacy `match_facts` `baseline` arm is unbounded (`pg_get_functiondef` shows no `limit` on it); `search_facts` has a single bounded arm. Baseline facts remain reachable through `list_memory_facts`/`summarize_memory_facts` by `fact_type`. |

### 6.4 Dataset query functions — every accepted argument

Common rules for all ten: `p_op` validated against that dataset's registry operation set; `p_dimensions` subset-validated; `p_bucket ∈ {day,week,month}` and only where `timeseries` is allowed; enum arrays subset-validated against the live CHECK domains; date rules as §6.2; `p_limit` within range; every failure `22023`. No function accepts a projection, column list, table name, raw predicate or `p_tz`.

Ownership predicate on every user-data function: `x.user_id = v_uid`. For `metric_series`: `join public.metrics m on m.id = p.metric_id and m.user_id = v_uid` (PRD line 602).

| function | accepted filters | metrics / ops | dimensions | buckets | limits |
|---|---|---|---|---|---|
| `query_checkins(p_op text, p_from date, p_to date, p_sources text[] default null, p_energy_min integer default null, p_energy_max integer default null, p_has_window boolean default null, p_dimensions text[] default null, p_bucket text default null, p_limit integer default 200)` | local date range (`checkin_window` day), `source ∈ {checkin_reply,chat,app,quick_action}`, energy `1..10` with `min ≤ max`, `has_window` | list, count, aggregate (count, count_distinct window, avg/sum/min/max energy), timeseries, latest | `day, week, weekday, hour_of_day, source` | day, week | list ≤ 500; latest ≤ 20; content `left(content,280)` **and only when `p_op='list'`** |
| `query_impulse_events(p_op text, p_from date, p_to date, p_sources text[] default null, p_dimensions text[] default null, p_bucket text default null, p_limit integer default 200)` | local date range, source | count, aggregate (count), timeseries, metadata list | `day, week, weekday, hour_of_day, source` | day, week | list ≤ 500; latest ≤ 20; **never selects `content`** |
| `query_anchor_plans(p_op text, p_from date, p_to date, p_dimensions text[] default null, p_limit integer default 200)` | `plan_date` range — **no timezone shift**, `plan_date` is already a local date | list, aggregate (plan count, anchor count, anchor count by kind), latest | `day, kind` (`status` → `22023 unsupported_dimension`) | n/a | list ≤ 500; latest ≤ 20; anchors projected to `{start,end,label AS title,kind}` |
| `query_habits(p_op text, p_status text[] default null, p_detected_from date default null, p_detected_to date default null, p_watch_from date default null, p_watch_to date default null, p_dimensions text[] default null, p_limit integer default 200)` | `status ∈ {detected,confronted,watch,struck,quit_committed,cancelled}`, detected range (`detected_at` → local day), watch range (`watch_started_at`, already `date`) | list, aggregate (count, count by status) | `status, detected_day` | n/a | list ≤ 500 |
| `query_metrics_catalog(p_op text, p_domain text[] default null, p_formula_status text[] default null, p_is_quest boolean default null, p_quest_status text[] default null, p_archived_mode text default 'exclude', p_created_from date default null, p_created_to date default null, p_dimensions text[] default null, p_limit integer default 200)` | domain, `formula_status ∈ {proposed,validated,rejected}`, quest flag, `quest_status ∈ {active,completed,expired,failed}`, `p_archived_mode ∈ {exclude,include,only}`, created range | list, aggregate (count only) | `domain, formula_status, is_quest, quest_status` | n/a | list ≤ 500; **never selects `formula`** |
| `query_metric_series(p_op text, p_metric_ids uuid[] default null, p_metric_names text[] default null, p_domain text[] default null, p_from date default null, p_to date default null, p_bucket text default null, p_include_archived boolean default false, p_dimensions text[] default null, p_limit integer default 200)` | metric id / name / domain (**at least one non-null required**), local date range, archived | list, timeseries, latest, aggregate (latest, avg, sum, min, max, count, delta) | `day, week, metric_id, domain` | day, week, month | list ≤ 500; timeseries ≤ 366 days, hard-capped 60/53/12 points |
| `query_quests(p_op text, p_quest_status text[] default null, p_deadline_from date default null, p_deadline_to date default null, p_domain text[] default null, p_dimensions text[] default null, p_limit integer default 200)` | quest status, deadline range, domain | list, aggregate (count, count by status) | `quest_status, domain, deadline_day` | n/a | list ≤ 500 |
| `query_daily_vars(p_op text, p_from date, p_to date, p_dimensions text[] default null, p_bucket text default null, p_limit integer default 366)` | local date range | list, timeseries, aggregate; metrics **`doings_count`, `energy_avg`, `impulse_failures`, `journal_positive_mentions`, `journal_negative_mentions` only** | `day, week, weekday` | day, week | ≤ 366 days, zero-filled |
| `query_conversation(p_op text, p_from date, p_to date, p_role text[] default null, p_sources text[] default null, p_dimensions text[] default null, p_bucket text default null, p_limit integer default 200)` | local date range, `role ∈ {user,assistant}`, allowlisted `metadata->>'source'` | count, aggregate, timeseries, metadata list | `day, hour_of_day, role, source` | day, week | list ≤ 500; latest ≤ 20; forces `unsavable = false`; **never selects `content`**; metadata keys individually allowlisted (built from actual writers; `route` and `severity` excluded) |
| `query_journal_entries(p_op text, p_from date, p_to date, p_severity text[] default null, p_probed boolean default null, p_habit_flag boolean default null, p_dimensions text[] default null, p_bucket text default null, p_limit integer default 200)` | `entry_date` range (**no tz shift**, PRD line 607), `severity`, `probed`, `habit_flag` | count, aggregate (count, avg vagueness, count by severity), timeseries, metadata list | `day, week, severity, habit_flag` | day, week | list ≤ 500; **never selects `content`** |

`query_daily_vars` semantics, matched to the existing view where the view is right and corrected where it is not:

| metric | definition | vs `metric_vars_daily` |
|---|---|---|
| `doings_count` | `count(*) filter (where kind='doing')`, local day of `logged_at` | same |
| `energy_avg` | `avg(energy) filter (where energy is not null)` | same |
| `impulse_failures` | `count(*) filter (where kind='impulse_failure')` | same |
| `journal_positive_mentions` | `count(*) filter (where severity='S3')` on `entry_date` | same (`0031:51`) |
| `journal_negative_mentions` | `count(*) filter (where severity in ('S1','S2'))` on `entry_date` | same (`0031:52`) |
| `hours_logged` | **not in this function** — derived in TS: `answered_windows × cadence_minutes / 60` | same formula (`0031:76-77`), but the day basis becomes the window **start** instead of `logged_at` |
| `answered_windows` | **not in this function** — from `list_answered_windows`, grid-matched | view used `count(distinct checkin_window)` grouped by `logged_at` day |
| `quest_completions` | **excluded** (PRD line 572) | view attributes it to `quest_deadline` |

One authoritative definition of "answered window" exists in this plan: `list_answered_windows` + `compliance.ts`. `daily_vars` calls the same pair, so `hours_logged` and `compliance_rate` can never disagree about the numerator.

### 6.5 Semantic functions

```sql
public.match_rules_v2(
  p_query_embedding vector(768),
  p_min_similarity double precision,        -- NO DEFAULT (see §10)
  p_domain_hints text[] default null,
  p_limit integer default 5)
returns table (id uuid, text text, domain text, tone text, priority integer,
               similarity double precision)
-- grants: authenticated, service_role
-- validation: vector_dims(p_query_embedding)=768 (22023 embedding_dimension);
--             p_limit 1..20; p_min_similarity > 0 AND <= 1;
--             p_domain_hints <@ the 16-domain enum
-- ranking: order by similarity desc, hint_rank asc (hints boost, never filter)
-- no embedding column in the return type
```

**Old `match_rules` — body replacement, not just a grant change.**

Live body *[live]* uses unqualified `rules`, `embedding` and `<=>`, so `search_path=''` alone would break it. Migration `0039` therefore re-creates it with identical signature, parameter names (`query_embedding`, `match_domain`, `match_count`), default (`5`) and return type (`SETOF public.rules`), and a fully qualified body:

```sql
CREATE OR REPLACE FUNCTION public.match_rules(
  query_embedding public.vector, match_domain text, match_count integer DEFAULT 5)
RETURNS SETOF public.rules
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  select *
  from public.rules
  where domain = match_domain
  order by embedding OPERATOR(public.<=>) query_embedding
  limit match_count;
$function$;

REVOKE ALL ON FUNCTION public.match_rules(public.vector, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_rules(public.vector, text, integer) TO service_role;
```

`match_exemplars` gets the same treatment: live body qualifies `public.exemplars` but not `<=>` *[live]*, so it is rewritten to `OPERATOR(public.<=>)` with `search_path = ''`, and `EXECUTE` is revoked from `authenticated` (callers are `classifyReal.ts:98` and `dev-smoke`, both service-role).

**Legacy callers verified:** `retrieveRules.ts:6,63-68` uses `supabaseService`; `retrieveLockdownRules` (`runPipeline.ts:545-573`) delegates to it; no other caller of `match_rules` exists in the repo. `match_exemplars` callers: `classifyReal.ts:98` (`supabaseService`), `dev-smoke/index.ts:908,1156` (service-role client at `:110`).

---

## 7. Privilege matrix — all 17 `public` relations

Method: `REVOKE ALL ON public.<t> FROM anon, authenticated` on **every** relation, then re-grant only what a verified consumer needs. `REVOKE ALL` removes `a r w d D x t m` in one statement, so no residual `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` can survive. `TRUNCATE` is not RLS-protected, which is why the broad revoke — not a targeted one — is mandatory. (It is not reachable through PostgREST; this is defence-in-depth and is labelled as such.)

Consumers verified by grep across `lib/`, `app/`, `components/`, `domain/`: direct table access exists in exactly 8 files; direct client writes exist only in `lib/push.ts:82,101`; direct client RPCs are only `update_checkin_prefs` (`lib/checkins.ts:194,725`) and `save_anchor_plan` (`lib/todayService.ts:127`).

| relation | current `anon` | current `authenticated` | current policies | required client ops | required EF ops | **final `anon`** | **final `authenticated`** | **final policies** |
|---|---|---|---|---|---|---|---|---|
| `anchor_plans` | `rDxtm` | `rDxtm` | select/insert/update own | `SELECT(anchors, user_id, plan_date)` — `todayService.ts:105-109`; writes go through `save_anchor_plan` (`0037:47`) | full | none | `SELECT (user_id, plan_date, anchors)` | keep `anchor_plans_select_own`; **drop** insert + update own |
| `config` | `Dxtm` | `rDxtm` | **none, RLS off** | `SELECT(key, value)` — `config.ts:95` | full | **none** | `SELECT (key, value)` | unchanged (see 7.1) |
| `doings_logs` | `rDxtm` | `rDxtm` | select/insert/update own | `SELECT` 8 cols — `todayService.ts:155`, `proofService.ts:59` | full | none | `SELECT (id, user_id, kind, content, energy, source, logged_at, checkin_window)` | keep select own; **drop** insert + update own |
| `exemplars` | `arwdDxtm` | `arwdDxtm` | `exemplars_select_authenticated` | **none** | full | none | **none** | **drop** policy |
| `habits` | `rDxtm` | `rDxtm` | select/insert/update own | **none** | full | none | **none** | **drop** all three |
| `jobs` | `arwdDxtm` | `arwdDxtm` | none | **none** | full | **none** | **none** | none exist |
| `journal_entries` | `rDxtm` | `rDxtm` | select/insert/update own | **none** | full | none | **none** | **drop** all three |
| `memory_facts` | `rDxtm` | `rDxtm` | select/insert/update own | **none** — served by the four RPCs in §6.3 | full | none | **none** | **drop** all three |
| `messages` | `rdDxtm` | `rdDxtm` | select/insert/update own | `SELECT` 10 cols — `chatService.ts:58,81`; Realtime subscription `:163-165` | full | none | `SELECT` **table-level** (7.2) | keep `messages_select_own`; **drop** insert + update own |
| `metric_points` | `rDxtm` | `rDxtm` | select/insert own | `SELECT(metric_id, value, computed_for)` — `metricsService.ts:129` | full | none | `SELECT (metric_id, value, computed_for)` | keep `metric_points_select_own`; **drop** insert own |
| `metrics` | `rDxtm` | `rDxtm` | select/insert/update/delete own | `SELECT` 10 cols + `user_id` filter — `metricsService.ts:105-111` | full | none | `SELECT (id, user_id, name, domain, output_unit, is_quest, quest_status, quest_deadline, formula_status, archived_at, created_at)` | keep `metrics_select_own`; **drop** insert/update/delete own |
| `persona_stats` | `ardDxtm` | `ardDxtm` | select/insert/update own | **none** | full | none | **none** | **drop** all three |
| `profiles` | `ardDxtm` | `ardDxtm` | select/insert/update own | `SELECT(id, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end, timezone)` — `todayService.ts:75`; `SELECT(timezone, cadence, active hours)` — `checkins.ts:128,184`; `SELECT(onboarding_stage)` — `onboardingStage.ts:17` | full | none | `SELECT (id, timezone, onboarding_stage, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end)` | keep `profiles_select_own`; **drop** insert own; `update_checkin_prefs` is DEFINER so no UPDATE grant needed (7.3) |
| `push_tokens` | `rDxtm` | `arwdDxtm` | select/insert/update/delete own | `SELECT`+`INSERT`+`UPDATE` via `upsert` — `push.ts:82`; `DELETE` — `push.ts:101` | `SELECT` (§1.7) | **none** | `SELECT, INSERT, UPDATE, DELETE` (table-level `SELECT` is mandatory, §1.7) | keep all four own-rows policies |
| `rules` | `arwdDxtm` | `arwdDxtm` | `rules_select_authenticated` | **none** | full | none | **none** | **drop** policy |
| `trust_events` | `awdDxtm` | `awdDxtm` | `trust_events_select_own` (inert: no `r` grant) | **none** | full | none | **none** | **drop** policy |
| `metric_vars_daily` (view) | none | none | n/a | **none** | `SELECT` | none | none | unchanged — already `service_role` only *[live]* ✅ |

### 7.1 Three consequences that must be stated plainly

**`config` keeps RLS off.** The client loads the entire table and parses every key into a map (`lib/config.ts:87-118`); a narrow RLS policy would require enumerating every key any client screen reads, which is a brittle coupling outside this change. What protects it instead: `anon` loses **all** access (the client is always authenticated), and `authenticated` keeps only `SELECT (key, value)` on a table whose 70 keys *[live]* are all tunables — no secret, no user data (`AGENTS.md` §4.5: API keys never live in `config`). `trust_threshold` is a tunable, not the hidden per-user `trust_score`. Enabling RLS here is a separate hardening item (§17).

**`messages` keeps table-level `SELECT`.** `chatService.ts:163-165` subscribes to `postgres_changes` on `messages`. Realtime evaluates RLS but does not apply column privileges to the WAL payload; column grants on a Realtime-published table are unsafe and can silently break the subscription. Retrieval-side column exclusion is therefore enforced by the `query_conversation` return shape (§6.4), not by privilege. This guarantee is **not** overclaimed. **Owner decision B-1.**

**`push_tokens` keeps table-level `SELECT`.** The client's upsert at `push.ts:82` compiles to `INSERT ... ON CONFLICT DO UPDATE`, and Postgres requires table-level `SELECT` on the target table for that path no matter what representation is requested. Revoking it (the original v4 position) fails `42501` and silently stops all push registration — see §1.7. The own-rows policy keeps the read scoped to the token's owner, so this is not a cross-user exposure.

### 7.2 Column grants that were removed

| removed | evidence it is unused |
|---|---|
| `UPDATE (unsavable) ON messages` (created by `0036_armor_audit_fp10.sql:70`) | `flag-unsavable/index.ts:27,75,101-103` uses `supabaseService`; no client `UPDATE` on `messages` exists anywhere; the client invokes the Edge Function |
| `UPDATE (display_name) ON profiles` (created by `0036:64`, kept there for a "future profile-edit screen") | no `.update(` on `profiles` in any client file; `display_name` is not selected by any client query |
| `SELECT` on `rules`, `exemplars`, `memory_facts`, `habits`, `journal_entries`, `persona_stats`, `trust_events`, `jobs` | no client query references them |

Both column-grant removals are one-line restorations if a screen ships. They are listed as **B-8** because 0036 documented them as deliberate.

### 7.3 Policy notes

- Policies are attached to role `public` and rely on `auth.uid()`; revoking table privileges is what actually gates. Dropping the write policies is belt-and-braces so a future accidental grant does not reopen a write path.
- `metric_points_select_own` EXISTS-joins `metrics` on `m.id = metric_points.metric_id AND m.user_id = auth.uid()`, so the `metrics` grant **must** include `id` and `user_id` — it does.
- `update_checkin_prefs` and `save_anchor_plan` are `SECURITY DEFINER` (`0036`/`0037`), so removing `profiles` UPDATE and `anchor_plans` INSERT/UPDATE table grants does not break them.

### 7.4 Result

17 relations; `anon` has **zero** access to all 17; `authenticated` retains exactly 8 relations — 7 read-only (`config`, `profiles`, `doings_logs`, `messages`, `metrics`, `metric_points`, `anchor_plans`) plus 1 read+write (`push_tokens`). Every `D/x/t/m` bit is gone from both roles on all 17. `jobs` in particular loses `INSERT` for `authenticated` — today a signed-in user could enqueue arbitrary jobs *[live]*.

---

## 8. Check-in compliance — TypeScript owns the grid

### 8.1 Flow

```
executor (EF, user-JWT client)
 ├─ read_schedule_profile()      → timezone, cadence, active hours, wake/sleep,
 │                                 onboarding_stage, dialog_state, profile_created_at
 ├─ list_answered_windows(from,to)→ per local_day: answered_count, answered_starts[]
 ├─ grid = { timezone, cadenceMinutes, activeStart, activeEnd }      // windows.ts:34-41
 ├─ for each local day D in [max(from, createdDay) .. today]:
 │     scheduled = windowsForLocalDay(grid, anchorMs(D))
 │                  .filter(w => w.closeMs <= nowMs)                  // future excluded
 │     onGrid    = answered_starts[D].filter(s => scheduled.some(w => w.startMs === s))
 │     unmatched = answered_starts[D].length - onGrid.length
 │     answered  = onGrid.length
 │     rate      = scheduled.length === 0 ? null : answered / scheduled.length
 ├─ hours_logged(D) = answered(D) * grid.cadenceMinutes / 60
 └─ range totals: answered, scheduled, rate = scheduled === 0 ? null : answered / scheduled
```

- `nowMs` is the **server** clock in the Edge Function. Never the client's, never the model's.
- `windowsForLocalDay` (`_shared/checkin/windows.ts:177-206`) is the only place a window is emitted. `windowsClosedBetween` (`:260-268`) is reused for any range-based scan.
- `anchorMs(D)` is noon local of `D`, avoiding DST-midnight ambiguity.
- Grid matching uses `checkin_window` (window start), never `logged_at` (window close).

### 8.2 Denominator clamp and zero denominator

- `createdDay = (profile_created_at AT TIME ZONE tz)::date`. Days before it are `no_data`, not `0 %`. This is the only use of `profiles.created_at`.
- `scheduled === 0` for a day (no emitted window, e.g. an inactive-hours profile, or a day fully in the future): `rate = null`, `compliance_state = "no_scheduled_windows"`, and the day is counted in `days_excluded_zero_scheduled`. Range-level `compliance_rate` is `null` when the range total is 0 — never `0`, never `NaN`, never a division error.
- `unmatched > 0` is reported as `unmatched_answered_windows` and added to the block's `limitations`. It cannot occur while the schedule is unchanged, because `submit-checkin` writes `checkin_window` from `canonicalizeWindow` (`index.ts:425`); it can occur after a schedule change, and hiding it would inflate the numerator.

### 8.3 Preserved limitation

There is no schedule-history table, so compliance for past days uses the **current** grid. Every compliance block carries:

```json
"limitations": ["compliance uses the current check-in schedule; earlier schedule changes cannot be reconstructed"]
```

and `day_basis: "profile_local_day"`, `timezone: "<tz>"`. This matches PRD line 509.

### 8.4 Deleted from the plan

`series_checkin_compliance` (v3) is **deleted**. `series_daily_vars` becomes `query_daily_vars` and computes no ratio and no `hours_logged`. No SQL function counts scheduled windows.

---

## 9. Timezone ownership and `search_path` hardening

### 9.1 Database-owned timezone

No planner-facing function accepts a timezone. The zone is derived from `auth.uid()` → `profiles.timezone` inside `current_user_timezone()`. A caller has no argument through which to supply a zone or an identity, so the v4 hole (a valid but *different* `p_tz`) is closed structurally, not by validation.

`resolve_user_timezone(uuid)` is **deleted** — it accepted an arbitrary user id and would have been a cross-user oracle. `current_user_timezone()` takes zero arguments, is `SECURITY INVOKER`, has `search_path = ''`, and has **no EXECUTE grant to any role**; it is reachable only from inside the `SECURITY DEFINER` bodies, which execute as `postgres`.

Missing or invalid zone → `22023 timezone_unavailable`, mapped by the executor to `evidence_state: "unavailable"`, `reason: "timezone_unavailable"`. **No UTC fallback.**

Consequence, stated so it is not a surprise: with an unusable zone, only date-windowed datasets become unavailable. `schedule_profile`, `habits`, `metrics_catalog`, `quests`, `anchor_plans` (`plan_date` is already a local date) and `memory_facts` (created-date filter only) stay available. Today: 12 profiles, 0 null, 0 invalid *[live]*. **Owner decision B-4.**

Note that a user *may* legitimately change their own zone: `update_checkin_prefs(p_cadence, p_start, p_end, p_tz)` is an `authenticated`-granted DEFINER RPC (`0026:83`). That is profile mutation, not retrieval-time zone selection, and it does not weaken §9.1 — the retrieval functions read whatever the profile currently says.

### 9.2 `search_path`

Live ACL evidence *[live]*:

| schema | `nspacl` | untrusted `CREATE`? |
|---|---|---|
| `public` | `pg_database_owner=UC \| =U \| postgres=U \| anon=U \| authenticated=U \| service_role=U` | **no** — `C` only for `pg_database_owner` |
| `extensions` | `postgres=UC \| anon=U \| authenticated=U \| service_role=U \| dashboard_user=UC` | **no** — `C` only for `postgres`/`dashboard_user` |
| `pg_temp_1` | owner only (`supabase_admin`) | n/a |

`vector 0.8.2` is installed in **`public`**, not `extensions` *[live]* (`pg_extension`), so `<=>` and `vector(768)` resolve through `public`.

**Decision: `SET search_path = ''` on every new function, `pg_temp` omitted entirely** (not merely placed last). There is no legitimate reason for these functions to read a temp object, and omission removes the shadowing class rather than ordering it. `pg_catalog` is implicitly searched first, so `now()`, `count()`, `array_agg()` and `pg_timezone_names` resolve without listing it.

Everything else is qualified:
- tables: `public.memory_facts`, `public.rules`, `public.profiles`, `public.metrics`, `public.metric_points`, `public.habits`, `public.anchor_plans`, `public.doings_logs`, `public.journal_entries`, `public.messages`, `public.config`, `public.exemplars`
- functions: `auth.uid()`, `auth.role()`, `public.current_user_timezone()`, `public.vector_dims(...)`
- operators: `embedding OPERATOR(public.<=>) p_query_embedding` — the one construct that would otherwise need `public` on the path

Owner `postgres` (matches every live function). `REVOKE ALL ON FUNCTION … FROM PUBLIC` is mandatory because PostgreSQL grants `EXECUTE` to `PUBLIC` at creation — precisely how the current `match_rules` exposure arose (`=X/postgres` *[live]*).

---

## 10. Semantic thresholds — calibrated or unavailable

**Defect in v4:** `p_min_similarity double precision default 0.0` on both semantic functions, so an uncalibrated zero silently degraded retrieval to "everything".

**Correction:**
1. No default on `p_min_similarity`. Callers must pass a value.
2. SQL rejects `p_min_similarity <= 0 OR p_min_similarity > 1` → `22023 similarity_threshold_invalid`.
3. `thresholds.ts` reads `config.rag_rules_min_similarity` and `config.rag_memory_min_similarity`. Both are created **NULL**.
4. NULL, absent, non-numeric, or out of `(0,1]` ⇒ the semantic source is **unavailable**: the tool returns `evidence_state: "unavailable"`, `reason: "threshold_uncalibrated"`, the bundle sets `bundle_incomplete = true`, and the generation instruction forbids inferring the missing evidence. It never falls back to zero.
5. Planner mode therefore cannot run on an uncalibrated project: `rag_planner_enabled` stays `false` until both thresholds are set (gate G1 in §15).

**Calibration procedure (small, hand-reviewed, no evaluation platform):**
- Fixture file `docs/feature-prds/RAG-REDESIGN/fixtures/semantic_thresholds.json`: ~20 hand-written queries per source (memory, rules) with the ids a human judges relevant.
- Run once against the live corpus (144 rules, 53 memory facts *[live]*), collect the similarity of every judged-relevant pair, and take the threshold as `min(similarity of true positives) − 0.02`, rounded to 2 dp.
- The owner reviews the fixture and the chosen number; both values are then written to `config` and the fixture is committed as the regression baseline.
- This is a one-off manual exercise. No harness, no metrics dashboard, no golden-set runner.

Residual: an `authenticated` caller can invoke `search_facts`/`match_rules_v2` directly with a low-but-valid threshold (e.g. `0.001`). That is a *quality* choice on the caller's own data, not a data-exposure issue — every function is ownership-scoped. The planner path always uses `config`.

---

## 11. Evidence assembly

### 11.1 Envelope (unchanged from v3 except `priority`)

```json
{
  "dataset": "checkin_compliance",
  "op": "timeseries",
  "timezone": "Europe/London",
  "day_basis": "profile_local_day",
  "range": { "from": "2026-11-01", "to": "2026-11-14" },
  "row_count": 14,
  "rows_returned": 14,
  "complete": true,
  "coverage": { "requested_days": 14, "days_with_data": 9, "first_day_with_data": "2026-11-01" },
  "limitations": ["compliance uses the current check-in schedule; ..."],
  "rows": [ { "...": "..." } ]
}
```

`row_count` is always from `count(*)`, never `array.length`. `complete` is `false` only when a per-dataset cap truncated the rows; the allocator never truncates without saying so.

### 11.2 Planner schema — `priority` is validated

```json
{ "dataset": "checkins | impulse_events | checkin_compliance | journal | anchor_plans | habits |
              metrics_catalog | metric_series | quests | daily_vars | conversation |
              memory_facts | schedule_profile",
  "op": "<enum, validated per dataset>",
  "priority": "essential | primary | supporting | optional",
  "purpose": "<= 120 chars; which part of the user's question this answers",
  "arguments": { "...validated per §6..." } }
```

`priority` is **required** and enum-validated at parse time. An unknown value rejects the whole plan; there is no silent default. `purpose` is stored in the envelope and never re-fed to the model as an instruction.

### 11.3 Server-side allocation (deterministic, no model discretion)

1. Fixed rank: `essential` < `primary` < `supporting` < `optional`; ties break on planner array index.
2. Minimum viable block = one row plus the envelope (~200 chars).
3. Essentials are allocated first, each truncated at row granularity to fit. **An essential is never displaced by a primary, supporting or optional block.**
4. An essential that cannot receive its minimum is omitted, listed in `omitted_essential`, and sets `bundle_incomplete = true`; **no optional block is allocated at all** in that case.
5. More than one unplaceable essential: all listed, `bundle_incomplete = true`, and the generation instruction requires a qualified answer or one clarifying question (PRD §8.2 line 800).
6. Optionals only from leftover budget after every higher rank is placed.
7. The allocator never drops a block while retaining one of strictly lower rank — asserted by unit test T11.
8. Total prompt budget `rag_evidence_total_chars = 12000`; per-dataset caps are separate. Omission stubs replace dropped blocks so the model can see *that* something was dropped.

### 11.4 Bundle flags → prompt instructions

| flag | instruction |
|---|---|
| `bundle_incomplete = true` | "Some requested evidence could not be included. Do not state or imply completeness. Qualify the answer to the covered window, or ask one focused question." |
| `evidence_state = "unavailable"` (incl. `timezone_unavailable`, `threshold_uncalibrated`, `range_too_large`) | "The data needed for this part of the question is unavailable. Say so; do not infer a value." |
| `no_relevant_evidence` | render the state; never a fabricated block (PRD line 749) |
| `complete = false` on any block | no absolute quantifiers ("always", "never", "every day") |

---

## 12. Global provider-request budget

Unit = one HTTP generation request to a provider. **`total = 3`**, enforced inside `adapter.ts` before each `callGemini`/`callGroq`. The ceiling covers the original turn **and** any `llm_retry` job it causes.

### 12.1 Ledger

| step | ledger action |
|---|---|
| turn start | `reserved = 1` — guarantees the answer one request |
| extraction | may use up to `total − reserved = 2` |
| answer | `reserved = 0`; may use whatever remains, up to 2 |
| refinement | admitted only if `total − used ≥ 1` **after** the answer returns |
| any request beyond `total` | `generate()` returns `{ok:false, kind:"budget"}`; **no provider call is made** |

### 12.2 Why the fallback-refinement scenario cannot happen

Two structural mechanisms, not a policy note:

1. **`direct_quote` is mandatory and non-empty.** `GENERATION_SCHEMA:140` already requires it; `isGenerateResponse` (`adapter.ts:62-70`) is tightened to require `direct_quote.trim().length > 0`. Every refinement-bearing response is therefore already a complete answer, so refusing refinement never degrades the answer.
2. **Reservation.** The answer's request is reserved before extraction runs. If the answer came from the fallback, `used` has advanced by 2 and `remaining = 0`, so refinement is refused and the fallback's `direct_quote` is delivered as final.

`buildGenerationSchema({ allowRefinement })` omits `refinement_request` when `total − used < 1` at prompt-build time, and the validator strips it if a provider returns it anyway.

### 12.3 Call-count table — every path

| # | path | extraction | answer | refinement | total | outcome if the last call fails |
|---|---|---|---|---|---|---|
| 1 | no retrieval | 1 | 2 (primary+fallback) | — | **3** | holding reply + `llm_retry` |
| 2 | retrieval, no refinement | 1 | 2 | — | **3** | holding reply |
| 3 | retrieval + refinement | 1 | 1 | 1 | **3** | holding reply |
| 4 | invalid refinement request (validator rejects) | 1 | 2 | 0 | **3** | holding reply |
| 5 | malformed initial generation (bounded retry) | 2 | 1 | 0 | **3** | holding reply |
| 6 | malformed final generation | 1 | 2 | — | **3** | holding reply |
| 7 | primary fails at extraction, fallback succeeds | 2 | 1 | 0 | **3** | holding reply |
| 8 | **answer from fallback + `refinement_request`** | 1 | 2 | **0 — refused** | **3** | fallback `direct_quote` delivered ✅ |
| 9 | refinement + final generation fails | 1 | 1 | 1 | **3** | holding reply |
| 10 | answer primary fails structurally, fallback malformed | 1 | 2 | — | **3** | holding reply |

Row 8 is the scenario from review. `remaining = 0` ⇒ the refinement request is discarded and the guaranteed non-empty `direct_quote` is returned. No fourth request exists on any path.

### 12.4 `llm_retry` — propagate, never reset

- `degradePair.ts` payload gains `generation_budget_remaining = max(0, 3 − used)`.
- `job-dispatcher` sets the retry ledger total to that value, capped at 2 (the retry path has no extraction stage).
- `remaining = 0` ⇒ **no job enqueued**; the holding reply stands.
- Absent value (legacy jobs) ⇒ default 2.

| path | original turn | retry job | turn-wide total |
|---|---|---|---|
| planner turn degrades, remaining 2 | ≤ 3 | ≤ 2 | **≤ 3** |
| planner turn degrades, remaining 1 | 3 | 1 | **3** |
| planner turn degrades, remaining 0 | 3 | not enqueued | **3** |
| non-planner turn (check-in, locked persona) | ≤ 2 | ≤ 2 | ≤ 4 — unchanged, no planner exposure |

v3's 5-request ceiling is **withdrawn**. **Owner decision B-3.**

### 12.5 PRD conflict recorded

PRD line 268 states the three-call target "excluding exceptional provider fallback behavior". The owner overrode this: the ceiling includes fallback. Rows 1, 6 and 10 therefore cap at 3 including the fallback attempt. Recorded here rather than silently reinterpreted; the PRD itself is not edited.

---

## 13. Migrations

Monotonic `0039`–`0047`; existing migrations end at `0038_wipe_coverage.sql` *[live]*. Each migration is narrow (PRD §9.4 line 866). No P0 step depends on `0044`+; no P1 step depends on `0047`. `0039`–`0043` are applied *[live]*.

| # | file | phase | content |
|---|---|---|---|
| `0039` | `0039_rag_forbidden_table_revokes.sql` | **P0** | `REVOKE ALL` from `anon`,`authenticated` on `rules`, `exemplars`, `jobs`, `trust_events`, `persona_stats`, `memory_facts`, `habits`, `journal_entries`; drop `rules_select_authenticated`, `exemplars_select_authenticated`, `trust_events_select_own`, and the three own-policies on `persona_stats`/`memory_facts`/`habits`/`journal_entries`; `CREATE OR REPLACE` old `match_rules` + `match_exemplars` with qualified bodies and `search_path=''`; `REVOKE ALL ON FUNCTION` from `PUBLIC, anon, authenticated`; `GRANT EXECUTE` to `service_role` |
| `0040` | `0040_rag_column_grants.sql` | **P0** | `REVOKE ALL` then the §7 column grants on `metrics`, `profiles`, `doings_logs`, `metric_points`, `anchor_plans`, `messages`; drop the unused insert/update policies; revoke `UPDATE (unsavable)` on `messages` and `UPDATE (display_name)` on `profiles` |
| `0041` | `0041_rag_config_hardening.sql` | **P0** | `config`: `REVOKE ALL` from `anon`,`authenticated`; `GRANT SELECT (key, value) TO authenticated`. RLS left off, documented in the migration comment (§7.1) |
| `0042` | `0042_rag_config_keys.sql` | **P0** | all `rag_*` keys; `rag_planner_enabled = false`; `rag_rules_min_similarity`/`rag_memory_min_similarity` = NULL; `rag_evidence_total_chars = 12000`; `rag_compliance_max_windows = 2000`; prompt-cache allowlist empty |
| `0043` | `0043_rag_push_tokens_upsert_select.sql` | **P0** | fix-forward for `0040`: restore `SELECT` + `push_tokens_select_own` because `ON CONFLICT DO UPDATE` requires table-level `SELECT` (§1.7). `TRUNCATE`/`REFERENCES`/`TRIGGER` stay revoked; `anon` still nothing |
| `0044` | `0044_rag_identity_and_memory.sql` | **P1** | `current_user_timezone`, `read_schedule_profile`, `list_answered_windows`, `search_facts`, `list_memory_facts`, `count_memory_facts`, `summarize_memory_facts` (7 functions) |
| `0045` | `0045_rag_match_rules_v2.sql` | **P1** | `match_rules_v2` + `notify pgrst, 'reload schema'` |
| `0046` | `0046_rag_dataset_rpcs.sql` | **P1** | the ten `query_*` functions + `notify pgrst` |
| `0047` | `0047_rag_retire_match_rules.sql` | **P3** | `DROP FUNCTION public.match_rules(vector, text, integer)`; `ALTER FUNCTION public.match_rules_v2(...) RENAME TO match_rules`; `notify pgrst` |

Function counts per migration: `0044` = 7, `0045` = 1, `0046` = 10 → **18 total** (17 DEFINER + 1 INVOKER). `0043` adds no function; it is the `push_tokens` correction and shifts every later number by one.

**Deviation from the earlier draft of this table (recorded 2026-11-15).** The split was originally
`0044` = 5 / `0046` = 12. In implementation `read_schedule_profile` and `list_answered_windows` were
written with the identity and memory functions — they share `current_user_timezone` and the same
date-range validation block, and keeping them there let `0044` be applied and verified on its own
before the ten dataset functions existed. `0044` was already applied *[live]* when the ten `query_*`
functions were written, so the split was not reshuffled afterwards. The function count, the total and
every contract are unchanged; only the file boundary moved. `0046` is therefore 10, not 12.

**Effort estimate (solo, corrected for 18 functions):**

| phase | work | estimate |
|---|---|---|
| P0 | 5 migrations (4 + 1 fix-forward) + privilege verification harness | 2.0 days |
| P1 | 18 functions + per-function tests | 4.5 days |
| P2 | registry, executor, evidence allocator, compliance module | 3.5 days |
| P3 | planner, budget ledger, prompt integration, refinement | 3.0 days |
| P4 | smoke, gates, documentation | 1.5 days |
| **total** | | **≈ 14.5 days** |

---

## 14. Tests

All blocking at their gate. "Direct invocation" = an integration test with an `anon` key, a real user JWT, and a service-role key, each asserting the Postgres SQLSTATE.

| id | gate | assertion |
|---|---|---|
| T1 | G1 | `authenticated` → old `match_rules` = `42501`; `service_role` → rows **including** `embedding` (proves the legacy `retrieveRules` path still works end to end) |
| T2 | G1 | `match_rules_v2` as `authenticated` → rows, payload has **no** `embedding`/`embed_model`; as `anon` → `42501` |
| T3 | G1 | `search_facts`/`list_memory_facts`/`count_memory_facts`/`summarize_memory_facts`: `anon` → `42501`; `service_role` → `42501`; `authenticated` → own rows only; two-user isolation (A has 3, B sees 0); a purged fact is invisible to all four |
| T4 | G1 | direct PostgREST matrix of §7 asserted row by row on body `code = 42501`, including `config` as `anon`, `metrics?select=formula`, `metrics?select=is_core`, `profiles?select=trust_score`, `profiles?select=display_name`, `rules?select=*`, `jobs` insert, `messages` insert/update/delete. `push_tokens?select=*` is an **allowance** (own rows only) — §1.7 |
| T5 | G1 | every new function: `proconfig` contains `search_path=` and `proacl` contains no `=X` (PUBLIC) entry |
| T6 | G1 | tampered profile tz → `22023 timezone_unavailable` from both `read_schedule_profile` and every timezone-derived `query_*` (`checkins`, `impulse_events`, `daily_vars`, `conversation`, `habits` when dated), with the pure-date datasets asserted to work without a zone; signature assertion that no planner RPC has a timezone parameter. The tampered-zone half runs on the local stack only — production is read-only and has no tampered profile |
| T7 | G1 | energy: `p_energy_min=0`, `p_energy_max=11`, `min > max` each → `22023`; TS rejects the same before dispatch |
| T8 | G1 | `p_min_similarity` omitted → function-not-found (no default); `0`, `-1`, `1.5` → `22023`; with `rag_*_min_similarity` NULL the executor returns `unavailable`/`threshold_uncalibrated`, never zero |
| T9 | G0 | grid parity: `windowsForLocalDay` from `loadGrid` ≡ from `read_schedule_profile` over 30 sampled days spanning 2 DST transitions |
| T10 | G0 | compliance uses the canonical grid: mock `windowsForLocalDay`, assert it is called once per requested day and that its return value alone determines the denominator; `hours_logged = answered × cadence / 60`; `checkin_window` (not `logged_at`) determines the local day; `scheduled = 0` ⇒ `rate = null` + `days_excluded_zero_scheduled` |
| T11 | G0 | `list_answered_windows` exactness: 600 answered windows in range → 600 counted (no truncation); 2001 windows → `22023 range_too_large`, never a short array |
| T12 | G0 | budget: all 10 rows of §12.3 assert `ledger.used ≤ 3`; row 8 asserts the fallback `direct_quote` is delivered and no fourth request is attempted |
| T13 | G0 | `llm_retry` budget: remaining 1 → job payload carries 1; remaining 0 → no job enqueued |
| T14 | G0 | allocator: 3 essentials that cannot fit → `bundle_incomplete`, `omitted_essential` populated, zero optional blocks retained; an essential is never dropped while a lower rank survives |
| T15 | G0 | planner: `priority` outside the enum rejects the plan; `anchor_plans` dimension `status` → `22023`; unknown argument key rejected |
| T16 | G2 | 10 real chat turns: `generation_requests ≤ 3`, `evidence_chars ≤ 12000`, no `42501` anywhere in the pipeline, legacy rule retrieval still returns rules |

---

## 15. Rollout and gates

| gate | entry condition | exit condition |
|---|---|---|
| **G0** | unit tests green (T9–T15) | planner disabled, no live traffic affected |
| **G1** | P0 + P1 migrations applied to production | T1–T8 green **on production**; if any fails, roll forward with a fix, not backward with a grant |
| **G2** | thresholds calibrated (§10) and written to `config` | `rag_planner_enabled = true` for 1 owner account; T16 green over 10 real turns |
| **G3** | G2 clean for 48 h | enable for the 5 beta users; monitor `evidence_state`, `bundle_incomplete`, `generation_requests` |

Kill switch at every stage: `rag_planner_enabled = false` restores the current behaviour exactly, because the legacy path is untouched.

**P0 status *[live]*:** `0039`–`0043` are applied to production. `scripts/rag_p0_live_check.sql` (57 assertions, run with `set role` + `request.jwt.claims`) is fully green, covering T1, T4 and T5 for the P0 surface; `scripts/verify-rag-p0.py` is the static half. One P0 defect was found and fixed forward by `0043` (§1.7) — not by re-granting in place.

**P1 status *[live]*:** `0044`, `0045` and `0046` are applied to production, each pushed and verified on its own rather than in one bulk push. Three harnesses, all green:

| harness | scope | result |
|---|---|---|
| `scripts/rag_p1_fixtures.sql` (local stack) | every operation and every branch of all 18 functions, on seeded fixtures: two-user isolation, purged-fact invisibility, the D2 clamp against a 2001-window user, the 768-dimension check, tampered-timezone failure, all argument-validation paths | **194 / 194** |
| `scripts/rag_p1_live_check.sql` (production, read-only) | privilege matrix for the ten `query_*` (`anon` / `service_role` / null `auth.uid()` → `42501`), catalog shape (DEFINER, pinned `search_path`, authenticated-only `EXECUTE`, no timezone argument), one real-user read per dataset, the non-vacuous cross-user `metric_points` probe, D4 inertness, D2 clamp | **82 / 82** |
| `scripts/verify-rag-p1.py` (static) | per-function shape, the decision text that encodes D2/D3/D5, and the cross-cutting invariants (18 functions, nothing granted to `anon`, no P0 table re-opened, no policy or `ALTER TABLE`) | **232 / 232** |

Two real defects were caught by the fixtures before the push and fixed forward: `sum(bigint)` returns `numeric`, so `sum(...)` in `query_daily_vars` needed explicit `::bigint` casts to match the declared result type; and `query_habits` fetched the profile zone only when `p_detected_from` was set, so the `detected_day` dimension silently produced NULL keys.

Gate T status, stated precisely because two rows have a TypeScript half and one has a half that cannot be asserted on production:

- **T1, T2, T3, T4, T5 green on production.**
- **T6** is green on production for the catalog half (no retrieval function takes a timezone argument) and for `read_schedule_profile` returning a usable grid; the tampered-zone half is proven locally in `rag_p1_fixtures.sql` — `22023 timezone_unavailable` from `read_schedule_profile`, `list_answered_windows`, a date-filtered memory read, and each of the five timestamp-based datasets (`query_checkins`, `query_impulse_events`, `query_daily_vars`, `query_conversation`, `query_habits`), while the four pure-date datasets (`query_anchor_plans`, `query_metric_series`, `query_quests`, `query_journal_entries`) are asserted to work without a zone. It cannot be asserted on production because the production harness is read-only and production has no tampered profile to test against. That is the strongest form T6 can take until a test project exists.
- **T7 and T8** are green on the SQL half only. Both rows name a TypeScript counterpart — the executor rejecting the same arguments before dispatch, and returning `threshold_uncalibrated` when `rag_*_min_similarity` is `NULL` — and that code is P2.

**G1 therefore closes with P2, not with P1.** T9–T15 are G0 and belong to P2; T11's SQL half (`list_answered_windows` refusing over-cap ranges with `22023 range_too_large` rather than truncating) is already green locally. T16 is G2.

**P2 status (TypeScript only, not committed to a pipeline):** six modules under
`supabase/functions/_shared/rag/` — `types`, `registry`, `executor`, `thresholds`, `compliance`,
`evidence`, `dispatch` — and six Jest suites, **120 / 120 green**. P2 closes the TypeScript halves
that P1 could not:

| row | P2 half | asserted by |
|---|---|---|
| T7 | energy `0`, `11` and `min > max` rejected before dispatch | `executor.test.ts` |
| T8 | missing embedding / NULL, `0`, `-1`, `1.5`, NaN threshold → `threshold_uncalibrated`, never zero | `executor.test.ts`, `thresholds.test.ts` |
| T9 | grid parity: the compliance denominator is `windowsForLocalDay` itself, over the same profile row | `compliance.test.ts` |
| T10 | one grid evaluation per day, `checkin_window` matching, `hours_logged = answered × cadence / 60`, zero denominator → `null` | `compliance.test.ts` |
| T14 | allocator: unplaceable essentials omit every optional, an essential is never displaced, truncation is flagged | `evidence.test.ts` |
| T15 | `priority` rank, `anchor_plans.status` rejected, unknown argument rejected | `executor.test.ts`, `evidence.test.ts` |

T11's allocator-adjacent half is `evidence.test.ts`; T11's SQL half remains `rag_p1_fixtures.sql`.
T12/T13 (provider budget and `llm_retry`) are untouched by P2 — they live in the pipeline, which is
not wired. T9/T10's "mock `windowsForLocalDay`" is asserted behaviourally instead: the test derives
the expected denominator by calling the same function over the same grid, which fails if compliance
ever stops using it. P2 adds no migration, changes no prompt, and leaves `rag_planner_enabled` at
`false`; gate G0 is met for the modules written, G1 still waits for the pipeline and the calibrated
thresholds.

**P3 status — commit A (planner, schema, prompt rendering):** three modules and one pipeline
extension, **320 / 320 green** across the sixteen `rag` + `pipeline` suites:

| piece | file | what it does |
|---|---|---|
| planner instruction | `rag/planner.ts` | the ten §5.4 rules plus a dataset catalogue generated from `registry.ts`; no provider call, because the plan rides the extraction response |
| planner schema | `rag/planner.ts` → `pipeline/extractContract.ts` | the optional `rag_plan` property, added only when the caller passes `withRagPlan` |
| plan validation | `rag/planner.ts` | `parsePlan` (D16) and `noRetrievalPlan()` |
| evidence rendering | `rag/evidencePrompt.ts` | the §7.3 classification label, the §11.1 envelope, the §11.4 flag instructions, `no_relevant_evidence` |
| prompt slot | `pipeline/generatePrompt.ts` | `evidenceContext` sits after the persona riders and before the format requirement (PRD §8.1 item 7) |

Commit A changes no provider call, touches no SQL, and leaves `rag_planner_enabled` at `false`; the
budget ledger, the refinement round and the `llm_retry` payload are commit B. T12, T13 and T15's
planner half therefore stay open until commit B lands, and G2 still waits on the calibrated
thresholds.

**P3 status — commit B (ledger, refinement, pipeline wiring):** the turn is now wired end to end
behind the same flag, and the full suite is **1,462 / 1,462 green** (97 suites; `rag` + `pipeline`
= 16 suites, 347):

| piece | file | what it does |
|---|---|---|
| ledger | `llm/budget.ts` | `total = 3` (owner decision B-3, §12.1), `reserved = 1` at turn start, `charge` refuses at the ceiling, `refinementAllowed` after the answer, `remainingAfterTurn` / `retryBudgetTotal` for the retry job |
| adapter enforcement | `llm/adapter.ts` | one charge per provider request (stub included); a refusal makes **no** network call and returns `kind: "budget"`; `isGenerateResponse` now requires a non-blank `direct_quote` |
| refinement offer | `pipeline/generatePrompt.ts` | `buildGenerationSchema` returns `GENERATION_SCHEMA` **by identity** when refinement is not offered; `REFINEMENT_INSTRUCTION` is gated on the same flag |
| refinement round | `pipeline/generate.ts`, `pipeline/runPipeline.ts` | at most one extra dispatch + one extra answer, admitted only when the ledger can pay, merged with `mergeBundles`; any failure keeps the first answer |
| turn seam | `pipeline/ragTurn.ts` | the only `rag_*` config reader: kill switch, thresholds, budget, request ceiling; plan parse → dispatch → render, with `refine()` bound to the same options |
| pipeline wiring | `pipeline/runPipeline.ts` | planner on ⇒ `match_rules` and `match_facts` are skipped and the plan is the retrieval; `evidenceContext`, `allowRefinement`, `budget` reach `generateReply`; `ragProbe` reports plan state, block counts, `generation_requests` |
| user-JWT client | `rag/userClient.ts` | the retrieval RPCs refuse `anon`/`service_role`, so `send-message` / `submit-checkin` hand the pipeline a client carrying the caller's token |
| retry inheritance | `degradePair.ts`, `replies.ts`, `job-dispatcher/index.ts` | `generation_budget_remaining` propagates the remainder (capped at 2); `0` closes the job with no provider call |

T12 and T13 are green at the unit level (`budget.test.ts` covers §12.3's ten paths and row 8's
`remaining = 0`), T15's planner half is green (`noRetrievalPlan` ⇒ `no_relevant_evidence`), and
T14 stays green. `rag_planner_enabled` is still `false`; G0 is met, G1 needs the deploy and G2 still
needs the calibrated thresholds (§10) — which remain `NULL`, so no planner turn can retrieve
semantic memory or rule text yet, by design.

---

## 16. Acceptance criteria (PRD §16)

| area | criterion | verified by |
|---|---|---|
| functional | a personal question returns evidence-backed answers for ≥ 6 of the 13 datasets | T16, G2 |
| functional | no-retrieval turns work with zero tool calls | T15 |
| data correctness | `hours_logged = answered × cadence / 60`; compliance denominator from the frozen grid; future windows excluded | T10 |
| data correctness | no dataset returns `content` where the registry forbids it; `unsavable` forced false; `formula` never returned | T4, T15 |
| security | `authenticated` cannot reach `rules`, `exemplars`, `jobs`, `memory_facts`, `habits`, `journal_entries`, `persona_stats`, `trust_events` at all | T4 |
| security | no function returns embeddings to `authenticated`; no function accepts a timezone or a user id | T2, T6 |
| security | every DEFINER function has a pinned `search_path` and no PUBLIC EXECUTE | T5 |
| reliability | ≤ 3 provider requests per turn including fallback and retry | T12, T13 |
| cost | ≤ 12,000 evidence chars; ≤ 500 rows per list; embeddings reused per turn | T12, T16 |
| tests | all of §14 green at their gate | CI |

---

## 17. Known limitations

1. **Compliance uses the current schedule** for historical days — no schedule-history table exists. Reported on every compliance block.
2. **`anchor_plans` `status` / `evidence`** are not implementable against the live `anchors` shape; `title` is projected from `label`. 0 live rows, so nothing validates a guess.
3. **`config` keeps RLS off.** Protection is column-scoped SELECT plus `anon` revocation; every key is a tunable. Enabling RLS requires enumerating client-consumed keys — a separate change.
4. **`messages` keeps table-level SELECT** because Realtime cannot honour column grants. Retrieval exclusion is enforced by `query_conversation`'s shape.
5. **`range_too_large`** on `list_answered_windows` above `rag_compliance_max_windows` (2000) — ≈142 days at 60-min cadence. Fails closed with a typed state rather than truncating.
6. **`unmatched_answered_windows`** can be non-zero after a schedule change; reported, never silently counted.
7. **`match_facts` baseline arm** is not reproduced in `search_facts` (the legacy arm is unbounded). Baseline facts remain reachable through the list/count/aggregate functions.
8. **`compare_periods`** (PRD line 464, optional) is not implemented.
9. **Pre-existing local-date defects** in `0031:38,46,115-119`, `0032:138-150`, `0033:245-306` (unvalidated `at time zone profiles.timezone`) are out of scope and unchanged.
10. **`metric_vars_daily`** keeps its `coalesce(tz,'UTC')` inner-join behaviour; the new tool does not use it as a source of truth (PRD line 603).
11. **PostgREST `text[]` encoding** for array parameters is unprobed on this project (see §19 assumption b).

---

## 18. Decision provenance

**The decisions below were approved by proceeding with P0 and P1.** They are kept for provenance,
not as open questions.

| # | decision | status | why it mattered |
|---|---|---|---|
| **B-1** | `messages` keeps table-level `SELECT`; retrieval column exclusion is enforced by the `query_conversation` RPC shape, not by privilege | **implemented in P0** | Realtime (`chatService.ts:163-165`) cannot honour column grants; the alternative is dropping Realtime for polling — a product change |
| **B-2** | refinement is requested by the **generation** call, not the planner; the first answer is already complete, and a refinement round discards it | **not yet exercised** (pipeline wiring, not P2) | follows PRD §7.6 and the fallback scenario, but a refined turn pays for a discarded draft |
| **B-3** | `llm_retry` inherits the remaining budget; `remaining = 0` ⇒ no retry job; turn-wide ceiling 3 | **not yet exercised** (pipeline wiring, not P2) | removes v3's 5-request ceiling |
| **B-4** | **no UTC fallback** for a missing/invalid timezone — date-windowed datasets become `unavailable` | **implemented in P1** | safer, but a bad profile zone silently loses all date evidence (today: 0 such profiles) |
| **B-5** | `read_schedule_profile()` returns `dialog_state`; the client column grant does not | **implemented in P1** | PRD §6.1 permits it to retrieval; `AGENTS.md` §7.7 makes it server-owned. This is the split |
| **B-6** | `anchor_plans` dimension `status` rejected; `title` projected from `label`; `evidence` a reported limitation | **implemented in P1** | the live `anchors` shape has neither `status` nor `evidence` |
| **B-7** | **18 new functions** (17 DEFINER + 1 INVOKER) across three P1 migrations | **implemented in P1** | the honest cost of a 13-dataset registry with per-dataset filters; no generic executor |
| **B-8** | revoke the two unused column grants `messages.unsavable` UPDATE and `profiles.display_name` UPDATE, both created deliberately by `0036:64,70` | **implemented in P0** | they are unused by every client path, but 0036 documented them as forward-looking; each is a one-line restoration |
| **B-9** | `config` keeps RLS off; hardening is `REVOKE ALL` from `anon` + `SELECT (key, value)` for `authenticated` | **implemented in P0** | v4 promised "enable RLS + single-row policy"; that would require enumerating every client-consumed key and risks breaking `loadConfig` |

---

## 19. Assumptions (explicitly labelled)

- **(a)** **Probed and settled (2026-11-15, local stack).** PostgREST accepts both a JSON array
  (`["app"]`) and a Postgres literal (`"{app}"`) for a `text[]` RPC parameter, and both a JSON array
  and a `"[0.01,…]"` string for a `vector` parameter. All six probes returned HTTP 200 against
  `query_checkins`, `list_answered_windows` and `match_rules_v2`. The executor sends JSON arrays for
  `text[]` and the bracketed string for `vector`; both are confirmed. The fallback (array parameters
  as JSON strings parsed in SQL) is not needed.
- **(b)** `pg_timezone_names` is the authoritative zone list (it is what `update_checkin_prefs` already validates against, `0026`), so `current_user_timezone()` uses the same test as the writer.
- **(c)** `retrieveRules.ts` and `classifyReal.ts` are the only callers of `match_rules` and `match_exemplars`; verified by grep, not by runtime tracing.
- **(d)** The 2000-window compliance cap is a starting value, not a measured limit; it is a `config` row so it can be tuned without a migration.

---

## 20. What this plan does not do

No code, no migration file, no `config` row, no PRD edit. No change to `AGENTS.md`. No new dependency, service or API key. No schema change. No alteration of the uncommitted UI work in `app/*`, `components/davos/TodayPanel.tsx` or `domain/DayContext.tsx`.

**Next action is yours:** approve or amend §18, then implementation starts at P0.
