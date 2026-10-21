# FP-07-ACCEPTANCE.md — Acceptance Ledger: Proof-Based Life Dashboard

**Companion to:** `docs/feature-prds/FP-07/FP-07.md` → `docs/feature-prds/FP-07/FP-07-PLAN.md`
**Gates:** `scripts/verify-fp07-step1.py` · `scripts/verify-fp07-step3.py` · `scripts/verify-fp07-step4.py` · `scripts/verify-fp07-step5.py` · `scripts/verify-fp07-step6.py` → **Governed by:** `AGENTS.md`

---

## 1. AC Ledger (ids mirror FP-07.md §6)

| AC | Description | Evidence Tag | Status |
|----|-------------|--------------|--------|
| AC-1 | View: planted check-in/chat doings + journal entries → exact hand-computed variables (UTC+5:30 and the shared DST fixture); the hours math holds; a zero-activity day returns no view row and the assembly emits all-zero + the zero-data list. | `[script]` `verify-fp07-step1.py` (live temp users; UTC+5:30 and DST); `verify-fp07-step4.py` (full-day hand math) | ✅ |
| AC-2 | Gate: every non-whitelisted op/var, injection-shaped string, ±1001 literal, depth 7, node 31, arity/type error → structured `{code,path,message}` errors and `ok=false`; the boundary values (depth 6, node 30, literal ±1000) and every whitelisted op/var accept. | `[script]` `formula.test.ts` rejection/boundary tables; `npx jest --ci` | ✅ |
| AC-3 | Evaluator: every whitelisted op against a hand-computed table; var resolution; division by zero → the point is skipped with one warning and nothing written; an ungated tree throws; no `eval`/`Function`/Math.js. | `[script]` `formula.test.ts` op/non-finite/throw tables; `verify-fp07-step4.py` (live divide fixture); static scan | ✅ |
| AC-4 | Job + cron: forced window → one job per qualifying user; any-status guard blocks a second; handler writes every active metric; re-run after a late doing updates in place; kill switch stops the tick and the handler; FAST membership proven by a batch drain. | `[script]` `verify-fp07-step1.py` (guard truth table); `verify-fp07-step4.py` (live) | ✅ |
| AC-5 | Presets + seed: exactly the library rows, all `formula_status='validated'`/`is_core`; re-seed adds zero; `clear-metrics` removes exactly preset-named rows (a foreign-named metric survives); invalid formula through the create helper is refused with no row. | `[script]` `verify-fp07-step3.py` (live) | ✅ |
| AC-6 | Proposal: stub-valid → one generate call, `status='validated'`, zero rows; gate-failure force → two proposal attempts (proposal + corrected) then a third described call (`status='described'`, no formula, no row); `[metric-gate]` structured errors; malformed stub exercises the parse-retry path. | `[script]` `verify-fp07-step5.py` (live stub legs) | ✅ |
| AC-7 | Dashboard: seeded user with ≥7 point-days → cards render name, unit, latest, delta with theme tokens; TrendLineGraph default; heatmap toggle at ≥7; StatCard for a fresh metric; ProgressBar for a quest; web drill records the full render; native look-and-feel judged by the owner. | `[script]`/`[measured]` web drill + `verify-fp07-step6.py`; `[owner-observed]` native half pending | ✅ web / ⏳ native |
| AC-8 | Surface discipline: no FP-02..06 **backend** pipeline/function file touched; the only pre-existing backend edits are the dispatcher registry (one case + one FAST entry) and `dev-smoke` (new actions); the FP-05 anchor-plan gate passes **with seeded metrics present**. | `[derived]` FP-07 commit diff; `[script]` FP-05 step5/6 live with 8 metrics seeded then cleared | ✅ |
| AC-9 | Registry: TECH-SPEC §2.3 and GLOSSARY §12 still list 15 types with `metric_eval` implemented — **ten** total; §11/§16 carry the three keys; `information_schema` proves zero new tables/columns (0031 = one view + one function + one schedule + three seeds). | `[measured]` live SQL; `[script]` registry statics | ✅ |
| AC-10 | Injection: planted trees with non-whitelisted ops, var-path traversals, and string operands where a tree is expected are all rejected with zero evaluation; a markup-bearing rendered fixture is literal text. | `[script]` rejection table; `[script]` AC-11 drill markup fixture; see the recorded reading for `rationale` | ✅ |
| AC-11 | End-to-end: seed → plant one day of doings + journal → force eval → points visible → dashboard renders the day → `clear-metrics` → cards gone; zero provider calls. | `[script]` `fp07_e2e.py` local harness (2026-10-21); `[measured]` adapter counts | ✅ |

**Evidence tags:** `[script]` = automated gate pass · `[measured]` = recorded numbers · `[owner-observed]` = manual drill judgment · `[derived]` = inferred from other evidence.

---

## 2. Recorded Readings

| Reading | Value / decision | Source |
|---------|------------------|--------|
| `hours_logged` | `distinct checkin_window` over `kind='doing'` × `profiles.checkin_cadence_minutes / 60`. Three answered 60-min windows → **3.0 h**; a 120-min cadence → **2.0 h per answered window**. Chat/app doings carry no duration and contribute zero. | 0031 view; `verify-fp07-step1.py`; `verify-fp07-step4.py` |
| Journal mention mapping | The schema has no sentiment column; severity is the only valence signal. **S3 → `journal_positive_mentions`; S1/S2 → `journal_negative_mentions`.** Provisional and recorded for refinement when a sentiment-labelled writer lands. | 0031 view; AC-11 drill (one S3 → positive 1 / negative 0) |
| `quest_completions` | Counts completed quest metrics whose `quest_deadline` equals the local day. Best-effort proxy until a completion timestamp exists; a quest with no deadline is not counted. | 0031 view |
| Compliance stays TS-side | Seven of the eight variables live in `metric_vars_daily`; `checkin_compliance_rate` is assembled in `runEval.ts` from the frozen `_shared/checkin/windows.ts` + `loadGrid.ts`. A SQL twin would be a third grid implementation; drift is a stop condition (FP-04 NFR-7). | `runEval.ts`; step4 report hand math |
| Null → 0 + zero-data list | A missing view row or a null aggregate coalesces to 0 for evaluation, but the null variable names go into `zeroData` and the `[metric-eval]` log line. `energy_avg` remains null in the view on a day with no non-null energy; the preset guards it with `doings_count`, so a zero-activity day does not read as “exhausted.” | 0031 view; `runEval.ts`; `presets.ts` |
| Non-finite skip | Division by zero produces a non-finite value; `buildMetricPoints` skips that metric with one warning and writes no point. Other metrics in the same run are unaffected. | `formula.ts`; `runEval.ts`; step4 live divide fixture |
| `formula_status` lifecycle | Only `validated` is written by FP-07. `proposed` and `rejected` remain reserved for the post-beta proposal-acceptance flows; `proposeMetric` writes no row on any path. | `create.ts`; `propose.ts`; Step 3 plan reading |
| Component rule | Quest with deadline → `ProgressBar`; otherwise ≥2 points → `TrendLineGraph`; otherwise `StatCard`; a trend with ≥7 points offers a local Trend/Heatmap toggle. Name/unit/latest/delta render in the page, not inside the registry bodies. | `lib/metricsData.ts`; `app/(app)/dashboard.tsx` |
| `ProgressBar` extension | The one deliberate prop extension beyond `{metric_id, points[]}`: the page computes the elapsed `created_at → quest_deadline` fraction and passes `progress`. The component remains presentation-only and reads no metric row; quest dates are not in `points[]`. | `components/metrics/ProgressBar.tsx`; TECH-SPEC §7.9 |
| PostgREST metrics API | The dashboard is a **read-only PostgREST surface**: select validated, non-archived `metrics`, then `metric_points` for the trailing `metric_history_days`; both under existing RLS. Zero new Edge Functions; zero client writes. | `dashboard.tsx`; TECH-SPEC §7.9.5 |
| Seed idempotency | `metrics` has no unique `(user_id, name)` constraint; `seed-metrics` skips existing names and reports `skipped`. Re-seed is therefore idempotent in effect, not by a database constraint. | `dev-smoke`; Step 3 plan reading |
| Any-status cron guard | The enqueue function dedupes on `(user_id, computed_for)` in **any** job status, so a completed or dead job is not silently reopened; recovery is the explicit `metric-drill` eval leg. | 0031; `verify-fp07-step1.py` truth table |
| Proposal bound | Proposal → one corrected re-output → described fallback, **max three generate calls**. A parse/validation failure consumes the corrected attempt. The module writes zero rows; `tactical_analysis` is logged server-side and omitted from `PublicMetricProposal`. | `propose.ts`; step5 live (1 / 3 / 3 calls) |
| AC-11 E2E variables | Planted UTC day 2026-10-20: `doings_count=2`, `hours_logged=1`, `energy_avg=7.5`, `impulse_failures=1`, `journal_positive_mentions=1`, `journal_negative_mentions=0`, `quest_completions=0`, `checkin_compliance_rate=0.125`. | E2E run (temp user; 2026-10-21) |
| AC-11 points | Momentum 2, Deep Work Hours 1, Check-in Consistency 12.5%, Energy Level 7.5, Impulse Control 0, Journal Positivity 100%, Quest Completions 0, Life Balance 3.5 — eight points, no duplicates. | E2E run |
| Zero provider calls | `seed-metrics` adapterCalls **0**; `clear-metrics` adapterCalls **0**; `metric_eval` imports no adapter and is in `FAST_JOB_TYPES`; no provider log lines in the E2E leg. | E2E response; static scan; step4 |
| Markup fixture | A metric named `<b>Markup</b>` rendered with `innerText` equal to the literal string; the DOM contained **no** `<b>` element containing “Markup.” React Native `Text` renders it as text. | E2E Chrome drill |
| `rationale` fixture | There is no `rationale` column on `metrics`, and the dashboard never renders a proposal rationale; the rendered untrusted text surfaces are metric `name` and `domain`. The markup test therefore targets `name`; the gate rejection table covers formula payloads. | `metrics` schema; `dashboard.tsx`; E2E |

---

## 3. Write-Back Ledger

| Commit | Doc | Sections updated |
|--------|-----|------------------|
| `802c5ac` | migration only | `0031_metrics_fp07.sql` (view + guarded cron + three config seeds); docs deferred to Step 7 |
| `0fc33a7` | code/tests | `_shared/metrics/formula.ts` + rejection/op tables |
| `36089eb` | code/tests/dev-smoke | `presets.ts`, `create.ts`, `seed-metrics`/`clear-metrics` |
| `0e397ca` | code/tests/dispatcher | `runEval.ts`, `metric_eval` handler + FAST entry; `metric-drill` eval/report |
| `15b51a3` | code/tests/dev-smoke | `propose.ts`, `metric-drill` propose |
| `437e4ec` | client | dashboard, four registry components, `lib/metricsData.ts` (owner-authored sweep; initial Step 6) |
| `662c189` | client/tests/script | heatmap sizing to measured width, testIDs, Step 6 verification |
| *this* | TECH-SPEC.md | §7.9.1–§7.9.5 as-built; §2.3 ten implemented; §3.4 view note; §11 keys verified (already present) |
| *this* | GLOSSARY.md | §1 dashboard as-built; §4 metric-surface pointer (see note); §6 gate/view/module rows; §12 `metric_eval` handler note; §13 `seed-metrics`/`clear-metrics`/`metric-drill`; §15 identifiers; §16 keys verified (already present) |
| *this* | `FP-07-ACCEPTANCE.md` | Created |
| *this* | verification scripts | Baseline count/auth fixes only (see §4.4); no feature code |

**Plan-reference corrections recorded here (not silently changed):**

- The plan's write-back says “GLOSSARY §4 (dashboard/metric terms)”. In the actual GLOSSARY, §4 is memory/permission scope; the dashboard term is §1 and the formula/variable/evaluator terms are §6. A short pointer was added at the end of §4 so the plan reference resolves, but no memory/permission term was invented.
- The plan says “the four `_shared/metrics/` modules”. As built there are **five** executable modules: `formula.ts`, `presets.ts`, `create.ts`, `runEval.ts`, `propose.ts`. All five are in the §15 identifier ledger.

---

## 4. Live Evidence (2026-10-21)

Project: `cbwujqezrvqfcicpuwtq`. All live users below are throwaway users; the owner test user was used only for the FP-05 gate family and was cleaned up (metrics cleared, audit messages/plans/jobs deleted).

### 4.1 FP-07 gates

| Gate | Result | Highlights |
|------|--------|------------|
| `verify-fp07-step1.py` | PASS | UTC+5:30 and DST hand math; 00:46 inserts nothing; 00:31 inserts one; dedupe; payload `{user_id,computed_for}`; kill switch; view is a `VIEW`; `security_invoker`; 13/5 columns; service-role grant only; definer + pinned `search_path`; `*/15 * * * *`; exact config values |
| `verify-fp07-step3.py` | PASS | seed 8 / 0 adapter calls; all validated + core; re-seed inserts 0, skips 8; clear deletes 8; foreign row survives; invalid formula refused with no row |
| `verify-fp07-step4.py` | PASS | 10 metrics, 9 points, divide metric skipped; eight variables exactly; re-run stays 9 rows and refreshes values; kill switch blocks insert and handler; 10-job batch drains in one tick; ten handlers / FAST membership |
| `verify-fp07-step5.py` | PASS | normal 1 call; force 3 calls + 2 gate rejections + described; malformed 3 calls; zero rows every leg; tactical stripped; invalid domain rejected pre-adapter |
| `verify-fp07-step6.py --run-jest --web-export` | PASS | 17/17 `metricsData` tests; web export compiles; package.json/lock unchanged; no DOM imports |
| `fp07_e2e.py` (AC-11 local harness) | PASS | seed 8 → plant day → eval 8 points → dashboard renders → markup literal → clear 8 → empty state; seed/clear adapterCalls 0 |

### 4.2 Web drill (AC-7 web half)

Headless Chrome `156.0.8078.47` against the exported web bundle at 1280×1600:

- Seeded dashboard rendered `Momentum` **8 doings**, `+3 vs prior day`, and the local Trend/Heatmap toggle.
- `Check-in Consistency` **100 %**, `+50 vs prior day`.
- `Energy Level` **7 /10**; `Beta Launch` quest **37 % elapsed** via `ProgressBar`.
- The heatmap toggle replaced the trend with **7 measured cells** (16–36 px, responsive to grid width) and toggled back.
- The empty-state user rendered **“No metrics yet”**, no error screen.
- Screenshots (local temp, not committed): `fp07-dashboard-seeded.png`, `fp07-dashboard-heatmap.png`, `fp07-dashboard-empty.png`, `fp07-e2e-dashboard.png`, `fp07-e2e-empty.png`.

### 4.3 AC-11 end-to-end drill

1. Created a throwaway user, profile `UTC`, cadence 60, active 09:00–17:00.
2. `seed-metrics` → 8 presets, adapterCalls 0.
3. Planted one day (2026-10-20 UTC): one check-in doing at 09:00Z, one chat doing at 12:00Z, one impulse at 13:00Z, one S3 journal entry.
4. `metric-drill&leg=eval&date=2026-10-20` → 8 metrics, 8 points, `disabled:false`.
5. Points matched the hand math in §2; dashboard rendered the eight cards with name/unit/latest.
6. Added `<b>Markup</b>` as a metric name → dashboard `innerText` contained the literal string; no `<b>` element.
7. Deleted the hand-authored markup row, then `clear-metrics` → 8 deleted, adapterCalls 0.
8. Reloaded: **“No metrics yet”**; dashboard cards gone.
9. Deleted the throwaway user (cascade).

### 4.4 Regression legs

| Leg | Result | Notes |
|-----|--------|-------|
| `verify-step11.py --turns 6 --cleanup` | PASS | Ran against a throwaway audit user. AC-5 conflict-filter fixture **skipped** because the live rules library has 144 non-placeholder owner rules; the fixture was authored for the placeholder-only set. AC-11 now scopes its round-trip to `source_figure='PLACEHOLDER-DEV'`. Static secret scan: 86 files, no hits. |
| `verify-fp03-step7.py --static-only` | PASS | — |
| FP-04 static family (`step1`, `step2`, `step3`, `step4`, `step6`) | PASS | — |
| FP-05 gate family (`verify-fp05-step5.py`, `verify-fp05-step6.py`) | PASS | Test user `b986…` seeded with 8 metrics first; anchor-plan generation saw them and its gates held; pipeline day-plan probe energy 5/2/9 correct; metrics cleared and test artifacts removed afterward. |
| FP-06 static family (`step1`–`step7`, `hardening`) | PASS | Full jest includes the FP-06 byte-identity golden suites; metrics rows do not change chat prompt construction. |
| FP-07 gate family | PASS | Step 1, 3, 4, 5 live; Step 6 static/jest/web export; E2E. |
| `npx tsc --noEmit` | PASS | exit 0 |
| `npx jest --ci --runInBand` | PASS | **43 suites / 699 tests** |
| `deno check` (five metrics modules + dispatcher + dev-smoke) | PASS | exit 0 (PowerShell may print the check lines on stderr; `$LASTEXITCODE` is 0) |
| Secret scan (tracked files, exact `.env` values) | PASS | 411 files scanned; 0 hits; FP-07 pattern scan 0 |

**Verification-tooling fixes made in this step (scripts only, no feature code):**

- FP-04/05/06 scripts pinned the old handler/FAST counts; updated to ten handlers and four FAST members.
- FP-05 Step 5/6 scripts had stale `_mint_dev_jwt` positional arguments, a `req(jwt=…)` call without the parameter, one-arg `info()` calls, a `str.length` Python bug, and Step 5 drove `journal-drill` on the dispatcher instead of `dev-smoke`. These were gate-harness bugs, not product changes.
- `verify-step11.py` counted all rules rows instead of placeholder rows; scoped to `PLACEHOLDER-DEV`, and skipped the AC-5 conflict fixture when owner-authored rules are present (with a visible PASS/skip line).
- `tzdata` was installed in the local Python environment for `zoneinfo` on Windows; it is not a project dependency.

---

## 5. Owner Manual Drill (remaining rows)

Everything except the native look-and-feel pass was run live on 2026-10-21; readings below.

**AC-7 native (only open row).** On an iOS and an Android build, sign in as a user with ≥7 point-days and open Dashboard. Judge: latest/delta match the day; trend/heatmap legible and the toggle earns its place; StatCard/ProgressBar read correctly; light/dark hold up. Record platform + commit and a one-line verdict here, then flip AC-7 to ✅.

**Proposal (observed live).** `POST {url}/functions/v1/dev-smoke?action=metric-drill&leg=propose&user=<uuid>&domain=Career&text=<goal>` with `Authorization: Bearer $DEV_SMOKE_TOKEN`. The chain is correct — bounded at three calls, zero rows written, `tactical_analysis` stripped — but real-mode formula hit-rate is low: **1 of 4 valid prompts validated; 3 fell to `described`** after two gate rejections (`invalid_operator: formula must have exactly one operator key`). A prompt-tightening pass produced the same 1 of 4, so the remaining fix is schema-level, not prompt-level. `[owner-observed]` judgment of the fallback quality is still pending.

**Before beta.** Set `dev_overrides_enabled=false` once the drills are done; confirm `metric_eval_enabled=true` and the `metric-eval-daily` schedule is active.

---

## 6. Re-run Recipe

```powershell
# Load .env without printing secrets
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($matches[1])" -Value $matches[2].Trim().Trim('"').Trim("'")
  }
}
$env:SUPABASE_URL = $env:EXPO_PUBLIC_SUPABASE_URL
$env:SUPABASE_ANON_KEY = $env:EXPO_PUBLIC_SUPABASE_ANON_KEY

# FP-07 gates
python scripts/verify-fp07-step1.py
python scripts/verify-fp07-step3.py
python scripts/verify-fp07-step4.py
python scripts/verify-fp07-step5.py
python scripts/verify-fp07-step6.py --run-jest --web-export

# Baselines
npx tsc --noEmit
npx jest --ci --runInBand
deno check supabase/functions/_shared/metrics/formula.ts `
  supabase/functions/_shared/metrics/presets.ts `
  supabase/functions/_shared/metrics/create.ts `
  supabase/functions/_shared/metrics/runEval.ts `
  supabase/functions/_shared/metrics/propose.ts `
  supabase/functions/job-dispatcher/index.ts `
  supabase/functions/dev-smoke/index.ts

# Earlier-FP regression legs
python scripts/verify-step11.py --turns 6 --cleanup
python scripts/verify-fp03-step7.py --static-only
python scripts/verify-fp04-step1.py --static-only
python scripts/verify-fp04-step2.py --static-only
python scripts/verify-fp04-step3.py --static-only
python scripts/verify-fp04-step4.py --static-only
python scripts/verify-fp04-step6.py --static-only
python scripts/verify-fp06-step1.py --static-only
python scripts/verify-fp06-step2.py --static-only
python scripts/verify-fp06-step3.py --static-only
python scripts/verify-fp06-step4.py --static-only
python scripts/verify-fp06-step5.py --static-only
python scripts/verify-fp06-step6.py --static-only
python scripts/verify-fp06-step7.py --static-only
python scripts/verify-fp06-hardening.py --static-only
```

The AC-11 live drill was run by a local harness (create throwaway user → `seed-metrics` → plant a UTC day → `metric-drill&leg=eval` → query points → web dashboard → markup fixture → `clear-metrics` → reload empty state → delete user). It is intentionally not committed because it launches a headless Chrome/CDP session; the server half is reproducible from `verify-fp07-step3.py` + `verify-fp07-step4.py`, and the browser half from `verify-fp07-step6.py`'s web-export plus the owner drill.

---

## 7. AGENTS.md §9 Checklist

| Check | Result |
|-------|--------|
| RLS on every new table | No new table; `metric_vars_daily` is a service-role-only view; `metrics`/`metric_points` RLS untouched |
| No secrets in client code or migrations | 411 tracked files scanned against exact `.env` values: 0 hits; FP-07 pattern scan 0 |
| No new paid service/server/orchestrator | None; all compute inside Supabase (pg_cron + Edge Functions) |
| All model/embedding calls through the adapter | `runEval`/metrics modules import no adapter; `propose.ts` uses the adapter lazily (allowed); no direct SDK import |
| No regex on LLM output; bounded retry | Proposal uses validators, not output regex; max three generate calls; no regeneration loop |
| React Native primitives only | No `<div>`/`<span>`/HTML tags in `components/metrics/*`; Expo web renders the same tree |
| `tactical_analysis` stripped server-side | `PublicMetricProposal = Omit<…,'tactical_analysis'>`; live step5 asserts absent |
| `trust_score` never rendered | No UI/API surface; only negative tests name it |
| Client logging uses `logger` | Dashboard uses `logger` with `app`; zero raw `console.*` in metrics client files |
| Job types registered/idempotent | No new type; `metric_eval` already registered, now implemented; handler idempotent via do-update + any-status dedupe |
| New terms/identifiers in GLOSSARY | §1, §4 pointer, §6, §12, §13, §15 |
| Quota checked (5 users) | 15-min SQL tick + zero-provider eval; no per-minute LLM; no new fan-out |
| `[SPEC]` values from `config` | `metric_formula_bounds`, `metric_eval_enabled`, `metric_history_days` read at runtime |
| Journal strip stays client-side | No journal path touched by FP-07 |
| Docs updated in the same change | TECH-SPEC §2.3/§3.4/§7.9/§11; GLOSSARY §1/§4/§6/§12/§13/§15/§16; this file |
| Governing references cited | Commit message + §3 ledger |

---

## 8. Open Items / Environment Notes

- **AC-7 native** remains `⏳` for owner-observed iOS/Android judgment; the web half is complete.
- **AC-5 conflict-filter fixture** is skipped on this project because the rules library contains 144 owner-authored rows in addition to the 9 placeholders. The skip is explicit in `verify-step11.py`; it is not an FP-07 regression.
- **`rationale`** is not persisted or rendered by design in FP-07; the markup proof covers the rendered untrusted fields (`name`, `domain`).
- **ProgressBar** receives a page-computed `progress` scalar in addition to `{metric_id, points[]}`; recorded in TECH-SPEC and §2.
- An unrelated owner edit in `docs/TECH-SPEC.md` §7.8 (Android notification icon line) was present in the working tree during Step 7; it is not part of FP-07 and must not be staged with this change.
- Background FP-03 BG-04 (`130/233` embedding rows, Gemini `HTTP 429`, `classifier_mode='stub'`) and FP-06 owner drills remain out of scope; FP-07 does not touch them.
