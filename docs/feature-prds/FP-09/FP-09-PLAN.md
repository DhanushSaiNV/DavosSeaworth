# FP-09-PLAN.md — Build Plan: Onboarding Interview, Proactive Conversationalist & Content Migrations

**Companion to:** `docs/feature-prds/FP-09/FP-09.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **One job type implemented — the registry closes at 15 of 15**: `proactive` joins the implemented set and §2.3 + GLOSSARY §12 gain their final implemented notes. **One new sync function, zero providers** (`select-metrics`); `content-seed` exists from BG-01 and is deployed and live. **Zero schema growth beyond `0032`** — `profiles.onboarding_stage` and every field the interview writes (`wake_time`, `sleep_time`, `routine`, `high_dopamine_activities`, `timezone`) have stood since `0002`/`0007`; migration `0033` is a trigger fn + a guarded tick fn + eight seeds, nothing else. **The bounded pre-existing touch set**, each keeping its FP's gate family green: `send-message` (the stage-1 flag + block apply + the stage-4/5 interview override at the lockdown branch's read point + the advance + the skips), the §4.3 chat contract + its stub registration (one optional block), `runWatchdogScan`/`runDriftScan` (one filter line each), `lib/chat.ts` + the row renderer (the `metric_options` chip variant), the root layout/route gate, `dev-smoke` (the drill legs). **The harness pitfall, named up front:** every existing account sits at `onboarding_stage='intro'`, so after Step 3 the onboarding branch hijacks normal chat and after Step 5 the new gates silently skip the watchdog/drift drills — every FP-02..08 regression leg must run with its test user **planted `complete`** (the `onboarding-drill reset/advance` legs exist partly for this). **Content baseline & alignment:** BG-01 (`content-seed` live), BG-02 (canonical 16 domains), BG-03 (144 approved rules across all 16 domains seeded in DB), and BG-04 (228/233 approved exemplars seeded in DB) are already completed. Step 6 formalizes the BG-06 onboarding interview copy & stage prompts, and validates the library via `validate.ts`; Step 7 verifies the RAG prompt boundary (intake rules suppression vs complete chat rules retrieval).

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-08 closed + pipeline/content surfaces + the profiles-creation path) | ✅ |
| 1 | Migration 0033: opening trigger + backfill + proactive tick + eight seeds | ✅ |
| 2 | Pure modules (onboarding state, proactive gaps) + the §4.3 contract extension + suites | ✅ |
| 3 | The `send-message` onboarding branch: flag, apply, override, advance, skips | ✅ |
| 4 | `select-metrics` + client: chips, the interview route, the route gate | ✅ |
| 5 | The `proactive` job + the watchdog/drift onboarding gates | ✅ |
| 6 | Content I: BG-06 Onboarding scripts & copy + Content library validation | ✅ |
| 7 | Content II: RAG prompt boundary & live content verification | ✅ |
| 8 | Live drills, doc write-backs, AC sweep | ▶ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-08/FP-08-ACCEPTANCE.md` exists and the FP-08 tracker is closed (pending owner drill rows acceptable — FP-09 builds on the code); (2) migrations through `0032` (`0032_accountability_fp08.sql`) are applied and slot `0033` is free; (3) the job registry reads fourteen of fifteen implemented with `FAST_JOB_TYPES` = `smoke_test` + `watchdog_checkin` + `purge_memory` + `metric_eval` + `drift_scan` — `proactive` is the sole remainder and this FP's only registry addition; (4) the `intervention` handler + `runLockedPersonaReply` + the unprompted-row + bounded-push path are located — the proactive job's delivery shape is exactly this; (5) the metrics stack as FP-07/08 left it — `presets.ts` rows `{name, domain, output_unit, formula}`, `insertValidatedMetric`, `runEval`, the `metric_eval` tick's active-metric qualification (onboarding's core metrics must make a fresh user qualify), and the dashboard's rendering of a user's metrics; (6) `profiles` columns confirmed — `onboarding_stage` with the six-value check (and its `'intro'` default on all existing rows — the live-behavior flag for the owner), `wake_time`/`sleep_time` `time`, `routine` jsonb, `high_dopamine_activities` jsonb; (7) **the profiles-creation path located** — `0004_profiles_trigger.sql` on `auth.users`: the opening trigger attaches to `profiles` insert regardless of who fires it, but the Step 1 verify must be able to plant one; (8) the §4.3 chat contract module + `stubShapes.ts` registration + the FP-06 golden byte-identity suite location — the block extension edits all three; (9) `runPipeline`'s stage-4 override point (FP-08's lockdown branch) — the interview override is its sibling, same read, precedence rule; (10) `select-persona`'s 400/404/409 semantics + `lib/chat.ts` chip derivation + the `chat.tsx` chip/quest-card renderer — the `metric_options` variant's precedents; (11) the root `(app)` layout auth navigation + the scheduler's arming point + FP-04's device-TZ sync function — the route gate, the structural disarm, and the mount sync reuse them; (12) the content inventory — `content-seed` deployed with bearer gate, `content/rules.csv` (144 approved rules across all 16 canonical domains), `content/exemplars.csv` (233 approved rows), `content/validate.ts` PASS (`approved=377`), `_shared/content.ts` `DOMAIN_ENUM` canonical 16, live DB holding 144 rules and 228/233 `source='BG-04'` exemplars with zero `PLACEHOLDER-DEV` rows, the golden set + gate, `dev-smoke` `seed-exemplars`/`clear-exemplars` + `&source=`, and the BG-04 swap runbook; (13) the `0027`/`0030`/`0031`/`0032` guarded-cron SQL read as the patterns the `0033` fns mirror (tick-guard vs per-user qualification vs window+silence); (14) the FP-05 anchor-plan context read (`profiles.routine` + wake/sleep) — the interview's writes are its long-missing inputs; (15) baselines green at their post-FP-08 counts (read from the repo, not this plan): jest suites/tests (56 suites, 896 tests), `tsc --noEmit` 0, `deno check` clean on the entry points, eslint 0 errors at the standing warning baseline.

**Verify:** all fifteen green. Any failure → stop, fix upstream first; never build the front door onto a misread pipeline or an unverified content state.

---

## Step 1 — Migration 0033: opening trigger + backfill + proactive tick + eight seeds

**Agent does:**

1. Migration `0033_front_door_fp09`: (a) `create_opening_message()` — plpgsql, `security definer`, `set search_path = public`, fully qualified names; fires `after insert on profiles`; reads `config.onboarding_opening_text`; inserts the first assistant row (`user_id = NEW.id`, `content` = the config text, `metadata` `{"source":"onboarding_opening","onboarding_stage":"intro"}`, `persona_key` NULL — non-generated copy, the degrade-holding precedent); idempotent by the source tag (a re-fired insert finds the row and skips); (b) the one-time backfill in the same migration — for every profile with `onboarding_stage <> 'complete'` and no `onboarding_opening` row, insert one (existing threads keep their history; the row lands at `now()`); (c) `proactive_tick()` — the `0030`/`0032` per-user pattern: `security definer`, pinned `search_path`, optional `p_now`; reads `proactive_enabled` (no-op when false); per user — `onboarding_stage='complete'`, local time (from `profiles.timezone`) inside `[slot, slot+30min)` for exactly one `proactive_windows` entry, newest `messages` user row older than `proactive_min_silence_minutes`, no `proactive` job for that `(user_id, slot, local-day)` in any status; kind resolved in-fn (the gap vector is SQL-checkable: null `wake_time`, null `sleep_time`, empty `routine`, empty `high_dopamine_activities`, baseline-facts count < `proactive_gap_min_baseline_facts` — first missing wins, else `companionship`); inserts `{user_id, slot, kind, gap_key?}`; pg_cron every 30 min; (d) eight seed writes (proper jsonb, the 0014 lesson, each with a description): `onboarding_stage_questions` `{"intro":1,"baseline":3,"goals":3,"routine":4,"metric_selection":0}`, `onboarding_persona` `"mentor_tough"`, `onboarding_opening_text` (the deterministic opening copy — the intro stage's single question folded into the greeting), `proactive_enabled` `true`, `proactive_windows` `["10:00","19:30"]`, `proactive_persona` `"mentor_tough"`, `proactive_min_silence_minutes` `120`, `proactive_gap_min_baseline_facts` `5`. Nothing else: no column, no table, no index, no RLS change.
2. Write-backs in this commit: TECH-SPEC §7.7 (the trigger + tick as-built), §11 (the keys), §12 (the scheduled-insert recount: 288 + 144 + ~4 + ~5 + ~10 ≈ 451 vs the ~500 line); GLOSSARY §16 (the keys), §15 (the new identifiers).

**Verify:** migration applies clean and re-applies idempotently (seeds are `on conflict do update`; the trigger and backfill guards re-run as no-ops); a planted `profiles` insert fires the trigger exactly once and a second fire adds nothing; the backfill plants exactly one row per qualifying existing profile; the tick's truth table via direct calls with backdated `p_now` (per-slot window hit/miss, the silence boundary, the onboarding gate, the any-status dedup, the kill switch, the gap-vector → kind resolution); `information_schema` diff proves zero columns beyond `0032`; the FP-02..08 static legs still green after the doc edits.

**Commit refs:** TECH-SPEC §3.4, §7.7, §2.2–2.3, §11, §12; D12, D17; FP-09 FR-1, FR-6, FR-13 (SQL halves). **Feeds AC-1, AC-7.**

---

## Step 2 — Pure modules + the §4.3 contract extension + suites

**Agent does:**

1. `_shared/onboarding/state.ts` — pure, imports nothing, jest-loadable (the `windows.ts` pattern): `stagePlan(stage, config)` (the question count and the stage's diagnostic-goal prompt fragment); `nextAction(stage, answeredInStage, config)` → `{kind:'question', n}` | `{kind:'advance'}` | `{kind:'propose'}` | `{kind:'reoffer'}` (the `metric_selection` free-text rule — no clock, the only exit is `select-metrics`); `selectPresets(domainCounts, presets)` — top-3 by classified-domain frequency over the preset `domain` tags, catalog-order fallback, deterministic; `chipPayload(presets)` → `metric_options` shape; `advanceTarget(stage)` (the compare-and-set pair, `metric_selection` excluded — `select-metrics` owns that flip); `overridePrecedence(onboardingStage, dialogState)` — interview wins while `≠ complete`.
2. `_shared/proactive/gaps.ts` — pure: `gapVector(profile, baselineFactCount, config)` → the first-missing key or `null` (fixed order: wake → sleep → routine → activities → facts-count); `companionshipContext(silenceHours, journalGapDays, latestMetric)` shape.
3. The §4.3 chat contract extension: the optional `onboarding` block (`profile_updates{wake_time?, sleep_time?, routine_summary?, high_dopamine_activities?}` + `baseline_facts?`) — present only when the caller flags the turn; validator with per-field fail-open (a malformed `HH:mm` / an oversized item / a short fact each skip with one structured warning); prompt text documenting each field's intent; **stub shape re-registered in the same commit** (validator identity — the FP-04 3a / FP-08 `habit_flag` lessons; the stub must emit a populated block when flagged, and the un-flagged prompt must be byte-identical).
4. Jest suites — the decision tables: stage-advance (each stage at its count; the boundary answer; resume-after-close by re-count; replay idempotence — the same count derives the same action); preset selection (domain match, frequency ordering, the empty-match fallback, determinism across shuffles); the chip payload shape; precedence (OPEN+complete vs LOCKDOWN+complete vs LOCKDOWN+intro); the block's per-field fail-open table; the gap vector incl. all-present; `baseline_facts` bounds.

**Verify:** suites green; `tsc --noEmit` + `deno check` + `jest --ci` clean; every module imports nothing (jest loads them with zero Deno shims); the un-flagged prompt build asserted byte-identical at the unit level.

**Commit refs:** TECH-SPEC §4.3, §7.7, §7.9; D6, D14, D17, D22; FP-09 FR-2, FR-3, FR-13 (pure halves). **Passes the table halves of AC-2, AC-3, AC-7.**

---

## Step 3 — The `send-message` onboarding branch: flag, apply, override, advance, skips

**Agent does:**

1. The stage-1 flag: when `profiles.onboarding_stage <> 'complete'`, the turn's extraction call passes the onboarding flag (the block rides the call stage 1 already makes — zero added provider calls); the apply — `profiles` field writes (validated per-field, `routine` as `{"summary": string}`), baseline facts to `memory_facts` (`fact_type='baseline'`, `source_message_id` = the user row, the turn's embed reused — the oath-capture precedent; a facts-presence guard on the source id makes the §5.1 repair replay idempotent); the turn's row stamps `metadata.source='onboarding'` + `metadata.onboarding_stage`.
2. The stage-4/5 interview override (at the lockdown branch's read point, precedence per `state.ts`): persona `onboarding_persona`; **no rules block in the interview prompt** (the interview asks, it does not preach — and the interview prompt stays independent of the live rules library); memory retrieval as-is (baseline facts the interview itself wrote may surface — that is the product); the generation instruction from `nextAction` (ask question N+1 / acknowledge-and-transition / propose / re-offer); the reply is a normal primary reply (push, Realtime, dedupe — all standing).
3. The stage advance: after the reply row lands, the compare-and-set `profiles.onboarding_stage` current→next (idempotent — a replayed turn re-derives the same count and the same target); the transition reply for a stage's boundary answer acknowledges and moves on.
4. The skips: the FP-08 rider call site and the `autoAdopt` walk both ignore rows carrying `metadata.source='onboarding'` (the check-in-skip precedent's shape — one predicate each, unit-tested in both directions).
5. `dev-smoke ?action=onboarding-drill` legs `advance` (force a transition — the dead-state valve) and `reset` (plant a user back to `'intro'` with a fresh opening row — re-runnable drills and the regression pitfall's fix). GLOSSARY §13 write-back.
6. `scripts/verify-fp09-step3.py`: plant a fresh user at `'intro'` → the opening row exists → answer through `intro` → the advance to `baseline` fires once (a replayed send does not double it) → a `wake at 6:30` answer in `routine` writes `wake_time` and a baseline fact with the turn's provenance → a malformed time answer skips the field with a warning and the turn still replies → close mid-stage, send the next answer, the count resumes → a `metric_selection` free-text turn re-offers the identical chip list → **zero** `trust_events`/`persona_stats` writes across the whole intake, then one post-`complete` turn applies the rider normally → a **complete** user's prompts byte-identical to the FP-08 baseline (golden suite + log parse) → the FP-04/05/07/08 gate families green **with the test user planted `complete`** (the named pitfall).

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — the interview prompt build contains no rules block and no `habit`/`watch` symbols (grep gate), the rider and auto-adopt predicates present, the un-flagged branch provably the old code path (branch coverage in the prompt-builder tests).

**Commit refs:** TECH-SPEC §5.1, §5.3, §7.7, §7.6, §4.3; D17, D20, D21, D8; FP-09 FR-4, FR-5 (wiring halves). **Passes AC-2, AC-3; feeds AC-12.**

---

## Step 4 — `select-metrics` + client: chips, the interview route, the route gate

**Agent does:**

1. `supabase/functions/select-metrics` (sync, zero providers): `POST {message_id, keys}` — the 400/404 table per FR-7 (malformed body / not 1–2 unique strings; unknown or foreign message; no `metric_options` on it; keys ⊄ its options — server state only, the `select-persona` discipline); on success `insertValidatedMetric` per key (`is_core=true` — the gate re-runs on the stored formula), then the compare-and-set `metric_selection → complete`; response `{status:'ok', metric_ids}`; a call at `complete` → `{status:'duplicate', metric_ids}` (the existing rows); the metric rows land before the flip (a crash between leaves a re-confirmable state).
2. Client chips: the row renderer's `metadata.metric_options` variant — multi-toggle chips + Confirm (disabled in flight, settled from the response with the chosen names shown); the pure state module jest-pinned; `lib/chat.ts` derives the state from the rows alone.
3. The `(onboarding)/interview` route: the thread reused whole (Realtime, composer, optimistic bubbles, the offline queue — a queued intake answer replays as any turn), no tab bar, the five-step stage indicator, the device-TZ sync on mount (the FP-04 reuse), no check-in mode / energy chips / impulse button / journal link; redirect to `(app)/chat` on completion (from the `select-metrics` response or a focus-time profile re-read).
4. The root route gate: post-auth and deep-link entry read `profiles.onboarding_stage`; `≠ complete` → the interview; a test asserts the scheduler never arms during intake (the `(app)` layout never mounts).
5. `scripts/verify-fp09-step4.py`: the full happy path — a user driven to `metric_selection` (Step 3's legs) → the proposal row carries 3 deterministic chips (domain-matched, asserted against the user's classified turns) → confirm 2 → two `is_core` rows through the gate, stage `complete`, `{status:'ok'}` → **the dashboard renders both with zero FP-07 file diffs (the git-diff assert)** → the next `metric_eval` tick qualifies the user and points land (forced eval leg) → a second confirm → `duplicate` → the 400/404 table → free-text re-offer → the routing table (fresh auth, complete auth, the deep-link bounce) → the scheduler disarm assert → `profiles.timezone` equals the device TZ post-mount.

**Verify:** the script green; web drill recorded (chips, indicator, redirect); static asserts — no metric insert outside `insertValidatedMetric`, `package.json` unchanged, the enumerated touch set is the whole client diff.

**Commit refs:** TECH-SPEC §7.7, §7.9, §5.3, §9; D10, D17; PRD §3.5, §4.1; FP-09 FR-7 … FR-10. **Passes AC-4, AC-5; feeds AC-12.**

---

## Step 5 — The `proactive` job + the watchdog/drift onboarding gates

**Agent does:**

1. `_shared/proactive/runProactive.ts` + the dispatcher case (**not** in `FAST_JOB_TYPES` — one generate, the fail-safe default): the silence re-check first (newest user row newer than `proactive_min_silence_minutes` → `done`, no row — the race guard); `proactive_enabled` re-check; gap kind — the missing field's ask composed under `proactive_persona` with §10.5 delimiters ("ask conversationally — no forms"); companionship kind — the light context (silence hours, days since last journal, latest core metric name + direction), no challenge content; `runLockedPersonaReply` → unprompted row `metadata.source='proactive'` + slot + kind + default-priority push (collapse `chat_{userId}`, `davos://chat` — §8's row, the §13-item-7 iOS fallback stands); one `[proactive]` log line; `tactical_analysis` server-log only.
2. The server gates: `runWatchdogScan` and `runDriftScan` filter `onboarding_stage = 'complete'` — one line each, both directions tested (an `'intro'` user with planted missed windows and late starts receives nothing; the same plants on a complete user fire exactly as before).
3. `dev-smoke` `onboarding-drill` legs `proactive` (force the tick's qualification + fire both kinds for a user) and `gaps` (dump the gap vector). GLOSSARY §13 + §15 write-backs.
4. `scripts/verify-fp09-step5.py`: the tick's live qualification table (both windows once per local day, never a third; silence boundary; onboarding gate; any-status dedup; kill switch off → the tick inserts nothing and a planted job no-ops); gap → companionship transition (empty `high_dopamine_activities` → the ask; filled → the next window's ping is companionship); the race guard (a user row planted between tick and fire → `done`, no row); the unprompted row + push payload asserted (source, slot, kind, collapse key, deep link); **static assert: no habit/watch/impulse symbol in any proactive prompt build**; the dispatcher registry lists **15 of 15**; the FP-04/FP-08 gate families green with the test user planted `complete`.

**Verify:** the script green; static asserts — no provider import outside the generate path, the two gate lines are the only `runWatchdog`/`runDriftScan` changes, `FAST_JOB_TYPES` unchanged.

**Commit refs:** TECH-SPEC §2.3, §8, §7.1, §7.3, §7.5, §10.5; D17, D22; PRD §3.0, §3.4; FP-09 FR-11, FR-12 (wiring halves). **Passes AC-6, AC-7; feeds AC-12.**

---

## Step 6 — Content I: BG-06 Onboarding scripts & copy + Content library validation

**Agent does:**

1. `_shared/content.ts` `DOMAIN_ENUM` re-checked: confirmed on canonical 16 domains (Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy per BG-02 Option 1 decision).
2. Content library validation: run `deno run --allow-read content/validate.ts` — assert PASS across all 144 approved rules in `content/rules.csv` (all 16 domains ≥ 6 rules) and 233 approved exemplars in `content/exemplars.csv` (`status: approved=377`).
3. BG-06 onboarding interview copy & stage prompts: finalize the opening text (`onboarding_opening_text` in config / `content/ui-copy/`) and the per-stage diagnostic goals prompt fragments in `_shared/onboarding/state.ts`. The opening message folds the greeting and first question conversationally (PRD §4.1; D17).
4. Verify that `rules.csv` and `exemplars.csv` integrity is preserved; doc write-backs to `content/reports/` as needed.

**Verify:** `validate.ts` PASS with 377 approved rows; `DOMAIN_ENUM` is canonical 16; opening copy and stage diagnostic prompts authored without sterile forms; static check clean.

**OWNER MANUAL:** review and tune the opening greeting (`onboarding_opening_text`) and stage questions pacing. **Feeds AC-8.**

**Commit refs:** TECH-SPEC §3.3, §7.7; D17; FP-BG BG-06; FP-09 FR-14. **Passes AC-8.**

---

## Step 7 — Content II: RAG prompt boundary & live content verification

**Agent does:**

1. RAG boundary verification:
   - Intake turns: assert that turns with `metadata.source='onboarding'` generate with **0 rules** injected into the prompt (the interview asks and listens; it does not preach).
   - Post-intake turns: assert that complete user turns (`onboarding_stage='complete'`) actively retrieve matching rules from the 144-rule library via `match_rules` and stage 3 retrieval.
   - Proactive turns: assert that proactive prompt builds contain zero habit/watch/impulse context (§7.5 structural resolution) and zero rules block.
2. Conflict filter verification: spot-check §5.2 conflict filter behavior against live rule pairs (an aggressive and empathetic rule pair in the same domain within `conflict_priority_window` drops the lower-priority group — asserted from a prompt build).
3. Security & injection check: assert that user text delimiters (§10.5) wrap all intake answers, baseline facts, and companionship contexts so prompt-injection attempts remain inert.
4. Rollback rehearsal & seeder check: confirm `content-seed` endpoint readiness and verify documented rollback procedures.
5. `scripts/verify-fp09-step7.py`: agent-runnable verification of prompt builds (intake suppression assert, complete-turn rules retrieval assert, conflict filter drop assert, delimiters assert).

**Verify:** script green; static asserts pass; RAG boundary strictly respected.

**Commit refs:** TECH-SPEC §3.4 item 7, §6.4, §5.2, §10.5, §13; D5, D17; FP-09 FR-15 … FR-18. **Passes AC-9, AC-11.**

---

## Step 8 — Live drills, doc write-backs, AC sweep

**Agent does:**

1. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §7.7 (the interview as-built: the trigger, the clock, the block, the override, the chips, the route), §2.3 (**15 of 15 — the registry closes**; the `proactive` row's implemented note), §7.1 (the onboarding gate landed — the parked note resolves), §7.5 (the suppression resolution: no habit context in proactive prompts, structural), §3.3 (content library as-built), §6.4 (the seeded corpus state), §11 (eight keys), §12 (the ~451/day recount), §13 (the iOS amendment extended to the proactive push; the BG-01 live item closed), §14 (item 10 complete; item 11 next); GLOSSARY §2/§4 (terms as-built), §12 (15/15), §13 (`select-metrics`, `onboarding-drill` legs), §14 (the `metric_options` metadata key), §15 (new identifiers: the `_shared/onboarding/` + `_shared/proactive/` modules, the function, the trigger/tick fns, the drill payloads, the metadata sources), §16 (the keys). Re-run every earlier FP's static leg after the edits (the baseline-fix lesson) — **with test users planted `complete`** where the legs touch user state (the named pitfall, documented in each harness).
2. `docs/feature-prds/FP-09/FP-09-ACCEPTANCE.md`: the AC ledger (ids parsed from `FP-09.md` so the two cannot drift), evidence tags (`[script]` / `[measured]` / `[owner-observed]` / `[derived]`), the recorded-readings section (every **[recorded reading]** from the FRs: the block-rides-stage-1 design and turn-embed reuse, the stage clock and its stamps, the routine-as-prose shape, the device-TZ reading, the precedence rule, the skips, the no-rules interview prompt and its decoupling win, the preset selection rule and any-row consumability, the structural scheduler disarm, the silence re-check, the §7.5 structural suppression, the source stamp, the collision-safe order, the hand-PATCH live item), the write-back ledger, and a re-run recipe.
3. Regression legs all green: `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, the FP-04/05/06/07/08 families (the golden byte-identity floor, the FP-05/07/08 new-data regressions, all with the pitfall handled), plus the FP-09 family. Secret scan + AGENTS.md §9 checklist (no new table / RLS / dependency / paid service / job type / `[SPEC]` hardcoded; zero new columns beyond `0032`; one new function; the enumerated touch set is the whole `git diff`; the registry's final count asserted at 15/15).

**Verify:** every AC marked with evidence (drill-judged rows may sit at ⏳ pending the owner drill — FP-03's AC-8 precedent); write-back diffs present; all regression legs green; repo clean.

**OWNER MANUAL (three drills, then flip the pending rows):** **(1) The interview drill — this one gates the tracker.** Run it on your own account, backfilled opening and all: read the opening message (is the voice right from the first line? the text is config — tune it, not the code), answer through every stage and judge the pacing and the follow-through (does the next question actually build on what you said?), close the app mid-stage and confirm the resume, then take the chips and finish — and the next evening, read the anchor plan that consumed your stated routine and wake/sleep (the FP-05 loop closing on real inputs). Retune `onboarding_stage_questions` and the stage prompts until the front door reads right. **Any platform**: the chip multi-select, the stage indicator, the redirect, the dashboard's first core metrics. **(2) The proactive cadence drill**: with a planted gap, receive the ask; fill it; receive the next window's companionship ping; judge voice and frequency together — a mentor checking in, not a notification farm. `proactive_enabled` off stops everything (verify cold). **(3) The content observation**: a turn in a populated domain before and after the rules seed (does the Greats' voice land?), and the classification smoke's labels read against your own phrasing. Record observations in the acceptance doc, then re-check the standing `dev_overrides_enabled` plan — FP-09's drill legs join its "done" set; the flip to `false` before real beta users is item 11's closing act.
