# FP-07-PLAN.md — Build Plan: Dashboard, Formula Validation Gate & Metric Eval

**Companion to:** `docs/feature-prds/FP-07/FP-07.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **Zero new job types** — §2.3 and GLOSSARY §12 stay at 15: FP-07 *implements* the already-registered `metric_eval`, bringing the implemented count to ten; the registry text only gains an implemented note. **No new tables or columns** — `metrics` and `metric_points` stand since `0007` with the columns and RLS FP-07 needs; migration `0030` is one view, one guarded cron function + schedule, and three config seeds. **Zero FP-02..06 file edits** — a first since FP-01: no pipeline, no `send-message`/`submit-*` surface, no FP-06 module is touched; the only pre-existing files that grow are the dispatcher registry (one handler case + one `FAST_JOB_TYPES` entry) and `dev-smoke` (new actions), both the standing per-FP growth points. Both proposal contracts register their stub shapes **in the same commit** as their validators (the FP-04 Step 3a lesson: selection is by validator identity in `_shared/llm/stubShapes.ts`). **The gate is the whole injection surface** (§10.4): model output is parsed and gated, never string-evaluated, and `insertValidatedMetric` is the only write path so no stored formula ever failed the gate. Doc write-backs must keep every earlier FP's gate assertions green — re-run the FP-02..06 static legs after any TECH-SPEC/GLOSSARY edit (the baseline-fix lesson), and re-run the FP-05 gates **with seeded metrics present**, because `anchor_plan` reads non-archived metrics and now finds some (the new-data regression). FP-07 adds **zero push surface** (nothing notifies — no §13 amendment) and **zero client dependencies** (RN primitives only). Migration numbers assume the next free slot after `0029`; renumber if taken (the FP-02..06 precedent) and write back.

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-06 + metrics tables + grid + client stub) | ⬜ |
| 1 | Migration 0030: `metric_vars_daily` view, guarded cron, three config keys | ⬜ |
| 2 | The D10 gate + evaluator: `_shared/metrics/formula.ts` | ⬜ |
| 3 | Presets + create helper + `seed-metrics`/`clear-metrics` | ⬜ |
| 4 | `runEval` + the `metric_eval` handler + drill legs | ⬜ |
| 5 | The proposal chain: `_shared/metrics/propose.ts` | ⬜ |
| 6 | Client dashboard: data layer + registry components | ⬜ |
| 7 | Live drill, doc write-backs, AC sweep | ⬜ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-06/FP-06-ACCEPTANCE.md` exists and the FP-06 tracker is closed (pending owner drill rows are acceptable — FP-07 builds on the code, not the drill); (2) migrations through `0029` are applied and slot `0030` is free; (3) `metrics` and `metric_points` stand with the `0007` shape — `formula` jsonb, the `formula_status` check (`proposed`/`validated`/`rejected`), quest fields (`is_quest`, `quest_status`, `quest_deadline`), `archived_at`, the unique `(metric_id, computed_for)` — **and** their live RLS is verified (own-rows select on `metrics`, exists-join select on `metric_points`, delete on `metrics`); (4) the dashboard stub route `app/(app)/dashboard.tsx` exists behind the `(app)` tabs navigator and reads the fail-closed `lib/config.ts` pattern used by the other screens; (5) the frozen server grid is located — `_shared/checkin/windows.ts`, `_shared/checkin/loadGrid.ts`, the shared `windows.fixture.ts` (the compliance computation and the DST/UTC+5:30 fixtures ride these; nothing in FP-07 may re-implement grid math); (6) `anchor_plan`'s non-archived-metrics read is located — the one existing `metrics` consumer FP-07 must not disturb; (7) the dispatcher registry and `FAST_JOB_TYPES` are located, with `watchdog_checkin` and `purge_memory` as the cheap-handler precedents; (8) the `dev-smoke` action family is located — the seed/clear precedent (`seed-exemplars`/`clear-exemplars`), the drill precedent (`journal-drill`, `memory-drill`), the `DEV_SMOKE_TOKEN` gate; (9) the stub-shape registration mechanism is located; (10) the BG-15 dark identity tokens are located in the client theme (plate `#1a1a1a`, ink `#ede8dd`); (11) migration `0027`'s guarded-cron-insert SQL is read as the pattern the `0030` fn mirrors (schedule, guard shape, definer + pinned `search_path`); (12) baselines green at their post-FP-06 counts (read from the repo, not this plan): jest suites/tests, `tsc --noEmit` 0, `deno check` clean on the entry points, eslint 0 errors at the standing warning baseline.

**Verify:** all twelve green. Any failure → stop, fix upstream first; never build the metric plane on a misread grid or a broken dispatcher.

---

## Step 1 — Migration 0030: `metric_vars_daily` view, guarded cron, three config keys

**Agent does:**

1. Migration `0030_metrics_fp07`: (a) the `metric_vars_daily` view — one row per `(user_id, local day)`, doings bucketed by `(logged_at AT TIME ZONE profiles.timezone)::date` with `profiles` joined for timezone + cadence, journal rows by canonical `entry_date`; columns exactly the seven SQL-native variables — `doings_count` (kind `'doing'`), `hours_logged` (distinct `checkin_window` count over kind `'doing'` × `checkin_cadence_minutes` ÷ 60), `energy_avg` (avg of non-null energy), `impulse_failures` (kind `'impulse_failure'`), `journal_positive_mentions` (severity `'S3'`), `journal_negative_mentions` (severity `'S1'`/`'S2'`), `quest_completions` (is_quest, `quest_status='completed'`, `quest_deadline = day` — the recorded proxy); `WITH (security_invoker = true)`; **granted to `service_role` only, never `authenticated`** (the handler is the sole reader; the invoker flag is defense-in-depth so a future accidental grant still meets RLS). (b) The guarded insert function (plpgsql, `security definer`, `set search_path = public`, optional `p_now timestamptz` defaulting to `clock_timestamp()` for direct testability) + the pg_cron schedule every 15 min: a user qualifies when their local time is inside [00:30, 00:45), they hold ≥ 1 metric with `formula_status='validated'` and `archived_at` null, and no `metric_eval` job exists for that `(user_id, computed_for)` in **any** status (the watchdog's one-job-row-per-target-ever pattern); `computed_for` = the local date minus one day; the fn reads `config.metric_eval_enabled` and no-ops when false; payload `{user_id, computed_for}`. (c) Three config seed inserts (proper jsonb, the 0014 lesson), each with a description: `metric_formula_bounds` (`{"max_depth":6,"max_nodes":30,"literal_abs_max":1000}`), `metric_eval_enabled` (`true`), `metric_history_days` (`30`). Nothing else: no table, no column, no RLS change, no index.
2. Write-backs in this commit: TECH-SPEC §7.9 (the view as-built, incl. the seven-of-eight reading and the severity/proxy mappings), §11 (three keys), §2.3 (the `metric_eval` schedule note); GLOSSARY §16 (three keys), §6 (the view's variable definitions as-built).

**Verify:** migration applies clean and re-applies idempotently; hand-planted doings + journal rows → spot-check three variable values against hand math (one UTC+5:30 bucket, the DST date from the shared fixture, the 120-min cadence hours math); the guard's truth table via direct fn calls with backdated `p_now` (in-window/out-of-window, no-metrics, already-jobed, kill-switch-off); `information_schema` diff proves zero table/column change beyond the view + function; the FP-02..06 static legs still green after the doc edits.

**Commit refs:** TECH-SPEC §7.9, §3.4, §11, §2.3; D10, D12; FP-07 FR-1 (partial), FR-7, FR-8. **Feeds AC-1, AC-4, AC-9.**

---

## Step 2 — The D10 gate + evaluator: `_shared/metrics/formula.ts`

**Agent does:**

1. `_shared/metrics/formula.ts` — pure, imports nothing, jest-loadable (the `windows.ts` pattern): `validateFormula(tree, bounds)` — the 18-op whitelist exactly as §7.9.1 lists it, the 8-variable whitelist exactly as §7.9.2 lists it (a `var` operand must be a bare string naming one legal variable — dotted paths and injection-shaped strings reject), numeric-literal bounds, tree depth ≤ `max_depth`, node count ≤ `max_nodes`, arity/type checks (binary arities, `if`'s ternary shape, numeric operands where numeric is required, boolean operands where boolean is required); the return is a structured result — `ok` plus an error list of `{code, path, message}` entries, never a thrown error and never a bare boolean (the list is the corrected-re-output feed and the `[metric-gate]` log payload). `evaluateFormula(tree, vars)` — a hand-written recursive interpreter implementing every whitelisted op; it **re-validates defensively and throws on an invalid tree rather than evaluating it** (§10.4: the only evaluable code path in the system); a non-finite result returns NaN for the caller to skip. Bounds arrive as parameters; the §11 config values are read only at the call sites.
2. Unit suites: the **rejection table** — every non-whitelisted op (incl. `reduce`, `cat`, `while`, a missing operator key, an operator smuggled inside a var string), every non-whitelisted var, literals at ±1000 (accept) and ±1001 (reject), depth 6 (accept) and 7 (reject), node count 30 (accept) and 31 (reject), each arity/type error — every rejection carries a structured error, and the boundary cases accept; the **op table** — every whitelisted op evaluated against hand-computed fixtures, var resolution included; the **non-finite table** — division by zero → NaN; the **throw table** — an ungated tree passed to the evaluator throws. A fixture test asserts the exported whitelist constants equal the §7.9 lists character-for-character, so a spec edit cannot drift silently.
3. Static asserts inside the suite: no `eval`, no `Function(`, no `new Function`, no string-to-code anywhere in the module.

**Verify:** suites green; `tsc --noEmit` + `deno check` + `jest --ci` clean; the module imports nothing (a test imports it from jest with zero Deno shims).

**Commit refs:** TECH-SPEC §7.9.1–7.9.4, §10.4, §11; D10; FP-07 FR-4, FR-5, FR-18. **Passes AC-2, AC-3, AC-10 (gate half).**

---

## Step 3 — Presets + create helper + `seed-metrics`/`clear-metrics`

**Agent does:**

1. `_shared/metrics/presets.ts` — pure: the core-metric preset library, ~8 entries `{name, domain, output_unit, formula}` — behavioral formulas over the eight variables only (momentum from `doings_count`, deep-work hours from `hours_logged`, consistency from `checkin_compliance_rate`, energy level from `energy_avg` guarded by `doings_count` (the R-1 mitigation), impulse control from `impulse_failures`, journal positivity from the mention pair, quest completions, one composite), domains from the canonical 16 (§3.3). A unit test runs **every** preset through `validateFormula` and fails on any miss — the library cannot ship unvalidated.
2. `_shared/metrics/create.ts` — `insertValidatedMetric`: the gate-before-persist helper; validates the formula (bounds from config at the call site), refuses the insert on failure with the structured errors, inserts with `formula_status='validated'` (the `'proposed'`/`'rejected'` states are reserved for the item-9/10 acceptance flows — recorded reading); service-role only. Every metric write in FP-07 — and every future writer — goes through this one helper.
3. `dev-smoke` actions: `seed-metrics` (`&user=<uuid>` — plants the library through the create helper; idempotent by `(user_id, name)`: existing names skip, because `metrics` carries no unique constraint — recorded reading) and `clear-metrics` (`&user=<uuid>` — deletes exactly the user's rows whose name is a preset name; a hand-authored or foreign-named metric survives, the `clear-exemplars` scoping precedent). Bearer-token gated like every action; one log line each. GLOSSARY §13 write-back.
4. Unit tests: presets-pass-gate (the build-fail test); the create helper's rejection table (a planted invalid formula → no row, errors returned); seed idempotency table (skip-existing by name).
5. `scripts/verify-fp07-step3.py` (the `verify-step11` pattern, `DAVOS_USER_JWT`-gated): seed → exactly the library rows, all validated + `is_core`; re-seed → zero new rows; plant a hand-authored foreign-named metric → clear-metrics → the foreign row survives and every preset row is gone; a direct create-helper call with a planted invalid formula → refused, no row; zero adapter log lines on every leg.

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — no metric insert anywhere in the diff outside the create helper, `metrics` RLS untouched.

**Commit refs:** TECH-SPEC §7.7, §7.9, §3.4; D10, D17; FP-07 FR-9, FR-10, FR-13 (seed/clear half). **Passes AC-5; feeds AC-11.**

---

## Step 4 — `runEval` + the `metric_eval` handler + drill legs

**Agent does:**

1. `_shared/metrics/runEval.ts` — the impure run module the dispatcher handler and `dev-smoke` both drive (the `runChain` pattern): load the user's active metrics (`formula_status='validated'`, `archived_at` null — core and quest alike); read the `metric_vars_daily` row for `(user_id, computed_for)`; compute `checkin_compliance_rate` through the same `loadGrid` + `windows.ts` the watchdog uses — expected windows for the local day vs answered doings joined on the canonical `checkin_window` (the watchdog's evidence rule; **no SQL twin, ever** — the recorded deviation from §7.9.5's "via SQL aggregate views", seven of eight); coalesce all eight keys (a missing view row or null aggregate → 0) and collect the zero-data list; evaluate each formula; upsert `metric_points` on conflict `(metric_id, computed_for)` **do update** (a re-run after late-arriving doings refreshes the day — latest evaluation wins); skip non-finite results with one warning per metric; one structured `[metric-eval]` log line (user, date, metrics evaluated, points written, zero-data variables, skipped count). Read `metric_eval_enabled` fail-closed and no-op when false.
2. The `metric_eval` case in the `job-dispatcher` registry — thin: lazy import + delegate to `runEval` (the secret-isolation precedent). Add `metric_eval` to `FAST_JOB_TYPES` **in this commit** (pure Postgres + TypeScript, zero providers — the `watchdog_checkin` precedent).
3. `dev-smoke ?action=metric-drill` legs (the `journal-drill`/`memory-drill` precedent; dev-gated, never used by prod paths): `&leg=eval&user=<uuid>&date=<yyyy-mm-dd>` (force-run the evaluation through the same run module — the dead-job recovery valve, the `watchdog-scan` precedent), `&leg=report&user=<uuid>` (dump the view row, the computed compliance, and the trailing points). GLOSSARY §13 write-back.
4. Unit tests: the assembly table (view row + compliance merge; the no-row day → all-zero + zero-data list; the kill switch); upsert semantics (a re-run with changed inputs updates the value); non-finite skip.
5. `scripts/verify-fp07-step4.py`: plant a day of doings (mixed check-in- and chat-sourced) + a journal entry → drill eval → points assert against hand-computed values (the hours math, the severity mapping, the compliance denominator); re-run after planting one late doing → the value updates (do-update); a planted division-by-zero formula (via a temp hand-authored metric through the create helper) → skipped with a warning, other metrics unaffected; kill switch off → the Step 1 fn inserts nothing and a planted job no-ops; a planted batch of eval jobs drains in one dispatcher tick (FAST membership, asserted from the tick's log); registry statics — §2.3/GLOSSARY §12 at 15 types, `metric_eval` implemented, **ten** in total.

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — `FAST_JOB_TYPES` gained exactly `metric_eval`, no `trust_score`/`trust_events` write anywhere in the diff, no grid math re-implemented outside `windows.ts` (a grep for the grid's arithmetic in new modules comes back empty).

**Commit refs:** TECH-SPEC §7.9.5, §2.2–2.3, §7.1 (compliance source), §3.4, §11; D10, D12; FP-07 FR-2, FR-3, FR-6, FR-13 (drill half). **Passes AC-1, AC-4; feeds AC-11.**

---

## Step 5 — The proposal chain: `_shared/metrics/propose.ts`

**Agent does:**

1. The pure contract half (the `evalContract` pattern): the proposal schema `{tactical_analysis, name, domain, formula, output_unit, rationale}` with its per-call structural validator (name 1–80 chars, domain ∈ canonical 16 + `General`, `formula` a JSON object, `output_unit` ≤ 16 chars, rationale ≤ 200 chars — [SPEC readings]) and the prompt builder — the eight variables documented **with their zero-data semantics**, the op/variable whitelists and bounds stated as hard rules, one worked few-shot example (a legal formula + its rationale), and the instruction that the formula must be a single JSONLogic object over exactly those variables. The described-fallback schema `{name, domain, description}` with its own validator (description ≤ 500 chars). Both stub shapes registered in `_shared/llm/stubShapes.ts` **in this commit** (validator identity — the FP-04 Step 3a lesson).
2. The adapter-bound half (`proposeMetric`): one `llm.generate` call with the proposal validator; the gate runs on the parsed formula; on failure the structured errors append to the prompt for **exactly one** corrected re-output (§7.9.4); a second failure runs the fallback contract as a third bounded call and returns `status='described'` with its fields — **no row written on any path** (the owner validates manually in beta; row creation belongs to the item-9/10 callers — recorded reading). `tactical_analysis` logged server-side only. One `[metric-gate]` line per rejection (the structured errors) and one `[metric-propose]` line per run (attempts, outcome).
3. `dev-smoke` grows the `metric-drill` leg `&leg=propose&user=<uuid>&domain=<d>` — runs the real chain in the current mode; a `&force=gate-fail` parameter plants a deliberately invalid tree as the first attempt so the corrected-re-output and fallback legs are exercisable live (re-checked server-side against `dev_overrides_enabled` — the `dev_force.eval_intervention` precedent). GLOSSARY §13 write-back.
4. Unit tests: the validator bounds for both contracts; the chain's state table (first-pass valid → `validated` at one call; retry valid → `validated` at two; both fail → `described` at three) with a mocked adapter; the prompt carries the variable documentation and the delimiter wrapper per house rule.
5. `scripts/verify-fp07-step5.py`: stub mode — a valid registered shape → one generate line, `status='validated'`, **zero rows written** (table count assert); `&force=gate-fail` → exactly two generate lines then the fallback (`status='described'`, no formula); `llm_stub_malformed=true` → the parse-retry path (§4.2) then the chain proceeds; the `[metric-gate]` lines carry the structured errors; `metrics`/`metric_points` row counts unchanged across every leg.

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — no database write anywhere in `propose.ts`, both stub registrations present in the same commit as the validators.

**Commit refs:** TECH-SPEC §7.9.4, §4.1–4.3, §10.5; D10, D13 (bounded retry); FP-07 FR-11, FR-12, FR-17. **Passes AC-6; feeds AC-10.**

---

## Step 6 — Client dashboard: data layer + registry components

**Agent does:**

1. `lib/metricsData.ts` — pure, jest-loadable (the `checkinUi` pattern): series assembly (own non-archived validated metrics + each metric's trailing `metric_history_days` points → `{metric_id, points[]}` in ascending day order), the deterministic component rule (0–1 points → `StatCard`; ≥ 2 → `TrendLineGraph`; quest + deadline → `ProgressBar` over the elapsed fraction of the `created_at` → `quest_deadline` window; ≥ 7 points → the heatmap toggle becomes available), the latest-value + day-over-day-delta math, the trend normalization (min/max over the window), the heatmap intensity mapping, and the progress fraction — all numeric logic lives here so the components stay layout-only.
2. `components/metrics/` — the four registry components (`TrendLineGraph`, `ConsistencyHeatmap`, `ProgressBar`, `StatCard`): pure, consuming `{metric_id, points[]}` (plus the toggle's local state) and **nothing else** — the D10 closed contract; name/unit/delta headers render in the page, outside the registry. RN primitives only, **zero new dependencies** — the trend renders as a normalized point/column strip built from positioned `View`s (`react-native-svg` deliberately not added — recorded reading); the heatmap is a weekday × week grid of intensity cells; dark identity tokens (plate `#1a1a1a`, ink `#ede8dd`, BG-15).
3. `app/(app)/dashboard.tsx` — the real screen replacing the stub: fail-closed config read (`metric_history_days`); the two supabase-js queries (metrics, then points per metric) under the RLS that already stands — **zero new Edge Functions** (the PostgREST surface is the metrics API — the messages-thread precedent, recorded reading); cards composed from headers + registry bodies; refresh on focus (`useFocusEffect`) + a manual refresh control; an empty state ("No metrics yet") that is a state, never an error screen.
4. Jest: the metricsData tables — component-rule boundaries (0/1/2/7 points; quest-with/without deadline), delta sign, normalization edge cases (flat series, single-point min=max), progress fraction (deadline past → 1, not-created → 0).
5. Web check: the route renders with seeded data (the Step 3 seed + planted points or a forced eval), the toggle switches, the empty state renders on a metrics-less user; native look-and-feel waits for the Step 7 drill.

**Verify:** `tsc` + jest clean; the web drill recorded; static asserts — `package.json` unchanged (zero new deps), no SVG/library import, `app/(app)/dashboard.tsx` is the only pre-existing app file changed (plus new `lib/`/`components/` files), no client-side metric writes anywhere (read-only surface).

**Commit refs:** TECH-SPEC §7.9, §9, §3.1/§3.4 (RLS reads); D1, D10, D15; BG-15; PRD §3.5, §4.5; FP-07 FR-14, FR-15, FR-16. **Passes AC-7 (web half); feeds AC-10, AC-11.**

---

## Step 7 — Live drill, doc write-backs, AC sweep

**Agent does:**

1. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §7.9 (as-built: the view + the seven-of-eight compliance reading and why, the gate/evaluator modules, the cron guard + drill valve, the presets, the proposal chain with its three-call bound and no-write contract, the component rule, the PostgREST metrics-API reading), §2.3 (`metric_eval` implemented — registry unchanged at 15, ten implemented), §3.4 (the view beside the tables), §11 (three keys); GLOSSARY §4 (dashboard/metric terms as-built), §12 (implemented note), §13 (`seed-metrics`/`clear-metrics`/`metric-drill`), §15 (new identifiers: the four `_shared/metrics/` modules, the cron fn, the drill payloads), §16 (three keys). Re-run every earlier FP's static leg after the edits (the baseline-fix lesson) — **including the FP-05 gates with seeded metrics present** (the new-data regression: `anchor_plan`'s generation input now finds metrics; its gates must hold) and the FP-06 byte-identity golden tests (chat-prompt-scoped, unaffected by metric rows — assert they still pass to prove it).
2. `docs/feature-prds/FP-07/FP-07-ACCEPTANCE.md`: the AC ledger (ids parsed from `FP-07.md` so the two cannot drift), evidence tags (`[script]` / `[measured]` / `[owner-observed]` / `[derived]`), the recorded-readings section (the hours_logged derivation, the severity mention mapping, the quest_completions proxy, compliance-stays-TS-side, the null→0 coalesce + zero-data log, the non-finite skip, the formula_status lifecycle, the component rule, the PostgREST metrics-API reading, seed idempotency by name, the any-status cron guard, the proposal's three-call bound and no-write contract), the write-back ledger, and a re-run recipe.
3. Regression legs all green: `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, the FP-04 static family, the FP-05 gate family (with seeded metrics), the FP-06 gate family, plus the FP-07 gate family. Secret scan + AGENTS.md §9 checklist (no new table / RLS / secret / dependency / paid service / job type / `[SPEC]` hardcoded; `trust_score` untouched; RN primitives only on the client half; zero FP-02..06 file edits — the `git diff` assert).

**Verify:** every AC marked with evidence (drill-judged rows may sit at ⏳ pending the owner drill — FP-03's AC-8 precedent); write-back diffs present; all regression legs green; repo clean.

**OWNER MANUAL:** the dashboard drill, then flip the pending rows. **Any platform**: run `seed-metrics` for your own user → let a real day accumulate (or force it with the `metric-drill` eval leg) → open the dashboard and judge: are the charts legible at a glance, do the latest values and deltas match what you actually did that day, does the heatmap toggle earn its place, and does each preset's number *mean* something (advisory — the golden-set precedent: the preset library and the proposal prompt are the tuning surface; a preset that reads meaningless gets retuned in-code, not shipped). **Web**: the full render + toggle + empty-state pass. Then run the `metric-drill` propose leg once in real mode and judge the formula it invents against the gate's rules. Record observations in the acceptance doc. Also re-check the standing `dev_overrides_enabled` plan — FP-07's drills join its "done" set before it flips to `false` for real beta users.
