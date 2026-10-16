**Yes — but structurally different from FP-01/02-PLAN.** A linear step track would contradict FP-BG's own operating model (any order, parallel, park-on-conflict). What you actually need when mainline stalls is: open one file, pick a green package, feed its steps to an agent one-by-one without re-deriving anything. So FP-BG-PLAN.md = **dispatch rules + one run card per package**; steps inside a card are sequential (same sizing rule as before), cards are not.

One correction vs the FP-BG catalog while writing this: **BG-01 Step 3 (live embedding seed) requires FP-02 Step 1 merged** (adapter + `GEMINI_API_KEY` secret) — BG-01 Steps 1–2 have no dependency, the catalog's "—" holds only for those. Noted in the file.

---

# FP-BG-PLAN.md — Dispatch & Run Cards: Background Track

**Companion to:** `docs/feature-prds/FP-BG.md` · governed by `AGENTS.md`
**Not a linear track. Never execute top-to-bottom.**
**Sizing rule (unchanged):** one step = one agent session = one commit = one verifiable outcome.
**Trackers:** package-level status lives in FP-BG.md §3 (authoritative); step-level checkboxes live here. Update both in every BG PR.

## How to use

1. Open FP-BG.md §3 → pick any package that is `open` with green dependencies.
2. Open its card below → feed steps to the agent **in card order**, one per session. Resume point of a parked/finished package = first unchecked step.
3. Mainline merge lands mid-package → rebase. Second conflict → set package `parked` in the catalog; never edit another package's or mainline's sections to force a merge.
4. Cards respect the FP-BG §2 ownership map and the additive-only rule — agents must not be told otherwise.
5. **First BG PR executed (whichever package it belongs to) additionally carries the AGENTS.md §8.4 amendment**, quoting the approved text from FP-BG §2.1 verbatim.

---

## BG-01 — Content authoring & seeding infrastructure (M)

- [x] **Step 1 — Schemas + validation script.** `content/` with `rules.csv` + `exemplars.csv` (columns exactly per TECH-SPECS §3.3 + `status` ∈ {draft, approved}); `content/validate.ts` (Deno script): schema checks, domain ∈ enum, tone ∈ enum, priority range, non-empty `source_figure`, near-duplicate text detection. _Verify:_ 5-row hand fixture passes; planted invalid rows (bad tone, bad domain, duplicate text, missing figure) each produce a named per-row error. **Refs:** §3.3, §3.5; D17, D19; AGENTS §8.4.
- [x] **Step 2 — `content-seed` function, dry-run only.** Service-role-auth Edge Function: reads approved rows, runs validation, reports per-table/per-status counts; writes nothing in dry-run mode. _Verify:_ dry-run on the fixture reports exact counts; DB row counts unchanged. **Refs:** FP-BG BG-01 card.
      **Status (2026-10-16): built; live verify pending (no linked project/token in this environment — owner-run commands below).** `supabase/functions/content-seed/index.ts` + `config.toml` (`verify_jwt=false`, bearer `CONTENT_SEED_TOKEN`); shared validation core `supabase/functions/_shared/content.ts` now backs both this function and `content/validate.ts` (thin CLI refactor — gate behavior unchanged, verified: 120 rules + 5 exemplars rows OK). Local checks green: fixture dry-run counts, planted violations (bad tone/domain, near-dup, priority range) each rejected with a named per-row error, uuid v5 deterministic/v5-shaped. _Owner live verify:_ `supabase functions deploy content-seed && supabase secrets set CONTENT_SEED_TOKEN=<hex>`; then `POST {action:"counts"}` (baseline) and `POST {action:"seed",mode:"dry-run",table:"rules",csv:<rules.csv>}` → counts must match `validate.ts`, DB counts unchanged in both responses.
- [x] **Step 3 — Live seed + clear.** _Gated on FP-02 Step 1 merged._ Embeds approved rows via `llm.embed` (adapter only — AGENTS §3.5), inserts with `embed_model='gemini-embedding-001@768'`; `content-clear` inverse (by status or dev label). _Verify:_ seed 5 approved fixture rows → rows + 768-dim embeddings present; clear → exactly those rows gone; re-seed → idempotent counts. **Refs:** §3.1, §3.5.
      **Status (2026-10-16): built; live verify pending (same owner-run step).** Live path embeds **approved rows only** (drafts reported and skipped — §8.4), chunks `llm.embed` at 50/call before any write, upserts with deterministic uuid v5 ids (re-seed = idempotent upsert), returns `dbAfter` counts; `clear` deletes by string-id list (mapped to uuids, both tables) and/or dev label (`rules.source_figure` / `exemplars.label`). Stub-mode guard: an embed count mismatch returns 409 with an explicit message (stub returns one vector). _Owner live verify (needs ≥1 approved row — an owner approval act per §8.4; a small scratch batch is enough):_ `POST {action:"seed",mode:"live",table:"rules",csv:<approved csv>}` → rows + 768-dim embeddings (`counts` shows `withEmbedding` +N); re-seed → same `seededIds`, counts stable; `POST {action:"clear",ids:[...]}` → exactly those rows gone, counts back to baseline.

## BG-02 — 16-domain enum decision memo (S) — single card

**Status (2026-10-16):** memo filed at `docs/feature-prds/FP-BG/BG-02-domain-enum-memo.md` — recommends adopting the owner corpus's 16 domains (mind, mastery, strategy, wealth, health, character, relationships, creativity, resilience, purpose, spirituality, time, communication, learning, leadership, habits). Docs (`TECH-SPECS §3.3/§5.3`, `GLOSSARY §1/§14`), `content/validate.ts`, and the BG-01 fixtures flipped to the recommendation in the same PR — **owner pick pending PR review**; amend to the chosen option if it differs.

**Agent does:** one-page memo on the proposed 16 domains (split/merge candidates: Social↔Relationships, Mental/Emotional↔Purpose/Legacy, Creativity↔Learning), pros/cons vs rules-content fit and classifier separability, one recommendation + final enum list.
**OWNER MANUAL:** pick the enum in PR review.
**Verify / write-backs:** TECH-SPECS §3.3 flips "proposed → **approved**" with the final list; GLOSSARY §1 domain entry updated — same PR. **Refs:** §3.3; FP-BG BG-02.

## BG-03 — Rules library draft content (L)

- [x] **Step 1 — Authoring scaffold.** Per-domain working files under `content/rules/`; distribution plan (≥6/domain, ≥50 distinct figures, ~105 total); a style guide (imperative, attributable, 1–2 sentences, tone + priority assignment rules). _Verify:_ scaffold + style guide committed; zero content yet. **Refs:** PRD §2; D17; AGENTS §8.4.
- [x] **Step 2 — Draft domains 1–6 (~40 rules).** Draft, run `validate.ts`, commit with counts. _Verify:_ validation clean; all rows `status=draft`.
- [x] **Step 3 — Draft domains 7–11 (~35 rules).** Same gate.
- [x] **Step 4 — Draft domains 12–16 (~30 rules).** Same gate; totals now ≥100 rules / ≥50 figures.
- [x] **Step 5 — Final sweep + approval handoff.** Full validation; summary report (per-domain/figure/tone/priority distribution, gaps flagged) to `content/reports/`; **zero rows seeded**.
      **OWNER MANUAL:** approve in batches (flip `status`); seeding happens later via BG-01 Step 3 — never in this package. **Refs:** PRD §2; FP-BG BG-03.

## BG-04 — Exemplar set drafts (L) — gated on BG-02 (approved enum)

- [ ] **Step 1 — Domain exemplars, batch 1 (8 domains × 10).** First-person-ish user-message phrasings; each labeled. _Verify:_ validation clean; draft status.
- [ ] **Step 2 — Domain exemplars, batch 2 (8 domains × 10).** Same gate.
- [ ] **Step 3 — Emotion (6 × 8) + quit/false-constraint (2 × 10).** Emotion texts are emotion-first and persona/domain-agnostic (separability requirement, D19). _Verify:_ validation clean.
- [ ] **Step 4 — Cross-set audit + handoff.** Near-duplicate check across all three set kinds (leakage — flag pairs crossing domain↔emotion); report to `content/reports/`; zero seeding. **Refs:** §6.4; D19; FP-BG BG-04.

## BG-05 — Guardrails few-shot pairs + provider bench (M) — gated on FP-02 Step 1

- [ ] **Step 1 — Pairs draft.** `content/guardrails-pairs.json`: 8–12 bad/good pairs (bad = "As an AI…", apologetic filler, generic advice; good = in-character, opinionated, context-driven), DRAFT-labeled. **Refs:** D13; §4.1.
- [ ] **Step 2 — `dev-guardrails-bench` function.** Runs each pair against **both** providers; hard cap **40 LLM calls per run** (constant, tallied via adapter log); output: per-pair, per-provider report — banned-phrase substring occurrence (offline tooling only; the AGENTS §5.1 ban applies to pipeline output, not this tool) + tone-drift notes. _Verify:_ run completes ≤40 calls; report structure intact.
- [ ] **Step 3 — Run + file report.** Report to `content/reports/guardrails-bench-<date>.md`. **Integration into `_shared/prompts/guardrails.ts` is NOT done here** — mainline follow-up after FP-02 closes. **Refs:** FP-BG BG-05; FP-02 FR-13.

## BG-07 — JSONLogic validation gate (M)

- [ ] **Step 1 — Engine + validator.** Select one Deno-compatible JSONLogic engine (vendored; decision recorded in GLOSSARY); `_shared/formulas/validate.ts` — whitelisted ops exactly per §7.9, variable-enum restriction, literal bounds [−1000, 1000], depth ≤6, node count ≤30; pure `{valid, errors[]}`. **Refs:** D10; §7.9.
- [ ] **Step 2 — Test matrix.** Every whitelisted op accepted; each rejection class (non-whitelisted op, out-of-enum var, literal overflow, depth, size) rejected with a named error; one full valid formula passes. _Verify:_ `deno test` green. Write-back: GLOSSARY entry (engine + gate identifier).

## BG-08 — `metric_vars_daily` views + `metric_eval` handler (M) — gated on BG-07

- [ ] **Step 1 — Aggregate views.** Timestamped migration: 8 views, one per whitelisted variable, over `doings_logs` / `journal_entries` / `metrics`, per-user per-day grain. _Verify:_ SQL review against §7.9 variable definitions; view on fixture rows returns expected aggregates.
- [ ] **Step 2 — Handler + additive registry entry.** `metric_eval` handler: evaluate all `formula_status='validated'` metrics for the due date via the views + chosen engine → upsert `metric_points` (unique constraint = idempotency). **Additive-only** entry in `job-dispatcher`. _Verify:_ insert a `metric_eval` job → points written; re-insert same job → zero duplicates.
- [ ] **Step 3 — Fixture lifecycle.** Dev-labeled metrics + formula fixtures → run → values correct → cleanup leaves zero residue. **Refs:** §7.9, §2.3.

## BG-09 — Dashboard component registry (M)

- [ ] **Step 1 — Four components.** `components/registry/`: `TrendLineGraph`, `ConsistencyHeatmap`, `ProgressBar`, `StatCard`; props exactly `{metric_id, points[]}` — nothing else; RN primitives only; dev fixture screen on the `(app)/dashboard` stub (additive edit). _Verify:_ all four render from local mock points. **Refs:** D10; §7.9, §9.
- [ ] **Step 2 — Edge fixtures.** Empty points, single point, wide value range, 90-day series. _Verify:_ no crashes/clipping on web + Expo Go; visual pass noted in PR.

## BG-10 — Journal editor + client-side Unsavable strip (M)

- [ ] **Step 1 — Pure strip module.** `lib/journal/strip.ts` + unit tests: flagged blocks fully removed, unflagged preserved verbatim, empty-result case. **Refs:** D3; §7.4, §10.2.
  **Status (2026-10-16): built, uncommitted (owner hold).** `lib/journal/strip.ts` (`splitBlocks` with exact source spans; `stripUnsavable` removing flagged blocks + one adjacent separator, survivors byte-identical; `stripSummary` counts) + `strip.test.ts` (**26 tests, all green**; full suite 5 suites/52 green; one real span bug fixed via the tests) — `tsc` adds zero new errors, `eslint` clean, web export bundles.
- [ ] **Step 2 — Editor UI.** `(app)/journal`: distraction-free editor, block-level Unsavable toggle, local draft persistence. _Verify:_ draft survives app restart.
  **Status (2026-10-16): built, uncommitted (owner hold).** `app/(app)/journal.tsx` replaces the FP-01 stub: full-screen multiline `TextInput`, debounced (~300 ms) block review list with tap-to-flag, flags keyed by exact block text (owner decision), AsyncStorage draft `davos_journal_draft` (debounced save + unmount flush). **Zero network calls** — no `lib/supabase` import anywhere on this path.
- [ ] **Step 3 — Post-strip preview.** UI affordance showing exactly what would be transmitted. **Zero network calls** — `submit-journal` must not be invented. _Verify:_ preview matches strip unit-test output for the same fixture.
  **Status (2026-10-16): built, uncommitted (owner hold).** Collapsible preview panel renders `stripSummary` output verbatim + "N of M blocks" count line; the screen drives the same pure function the unit tests pin (fixture-equivalence test in `strip.test.ts`).

## BG-11 — Settings implementation (S) — single card

**Agent does:** cadence segmented control (60/120) → RLS update of `profiles.checkin_cadence_minutes`; timezone display; sign-out restyled in place.
**Verify:** value persists across restart; SQL attempt to update another user's row via anon/auth context → rejected. **Refs:** §3.2, §11; FP-BG BG-11.

## BG-12 — CI enforcement gates (M)

- [ ] **Step 1 — Secret + reasoning-leak gates.** GitHub Actions: (a) secret scan (service-role patterns, `sk-`, `GROQ_API_KEY` literal) across repo; (b) `grep tactical_analysis app/` = zero. _Verify:_ each gate red on a planted violation (scratch branch), green on main.
- [ ] **Step 2 — Eval ban.** Ban `mathjs` imports, `eval(`, `new Function` in `app/` + `supabase/functions/`, **path-filtering the vendored JSONLogic engine directory**. _Verify:_ planted violation red; engine path green.
- [ ] **Step 3 — RLS static assertion.** Migration-file analysis: every `create table` with a `user_id` column must have RLS enable + `auth.uid()` policy (same or later migration). _Verify:_ planted unguarded-table migration red; current tree green. **Refs:** AGENTS §3–§5, §9; FP-BG BG-12.

## BG-13 — Test harness + lint/format + TS strict (S) — single card

**Agent does:** `deno test` wiring for `_shared`; ESLint flat config + Prettier; TS strict; additive CI wiring (extends BG-12 if present).
**Verify:** existing BG-07 unit tests run through the harness; lint clean or violations fixed in the same PR. **Refs:** AGENTS §6/§9.

## BG-14 — Web deploy pipeline (S) — single card

**OWNER MANUAL:** pick the free host (Netlify / Vercel / Cloudflare Pages).
**Agent does:** GH Action on main: `expo export --platform web` → deploy; Supabase URL/anon key injected as env (never secrets).
**Verify:** main auto-deploys; deployed web signs in against the live project. **Refs:** FP-01 §5; FP-BG BG-14.

## BG-15 — App identity (S) — single card

**Agent does:** icons, splash, theme tokens, PWA manifest (name, colors, maskable icon) — applied on all three platforms.
**Verify:** web installable (Lighthouse/install prompt); identity visible on Expo Go + web. **Refs:** §9, §8/D1.

## BG-16 — Agent-tooling bridges + nested AGENTS.md (S) — single card

**Agent does:** `CLAUDE.md` containing `@AGENTS.md`; Gemini config (or `GEMINI.md` bridge); nested `supabase/functions/AGENTS.md` (Deno rules, idempotency pattern, secrets access, additive-registry rule) and `app/AGENTS.md` (route map, RN primitives, platform capability matrix, offline-queue rules) — content per FP-BG BG-16.
**Verify:** Claude Code session in repo root loads AGENTS.md rules (spot-check one §3 constraint); nested files never contradict the root file.

## BG-17 — Ops runbook (S) — single card

**Agent does:** `docs/ops/RUNBOOK.md` — keep-alive parameters + alerting, day-8 auto-pause observation procedure, quota re-verification calendar (triggers: user #6, pre-launch, quarterly — §13 live item 4), provider-key rotation steps, incident-notes template.
**OWNER MANUAL:** create the calendar events.
**Verify:** runbook covers every §13 live item + the keep-alive dependency; a new contributor could execute the day-8 procedure from the doc alone. **Refs:** D12, §13.

---

**Rules recap for every card:** commit cites its traces · write-backs land with the introducing PR · AGENTS §9 checklist at completion · update FP-BG §3 catalog + this file's checkboxes in the same PR · parked packages resume at their first unchecked step after rebase.

Mainline is unaffected: **FP-03 (Real Classifier)** remains the next mainstream PRD on request — BG-04's approved exemplars are its ideal input, but FP-03 ships with placeholder exemplars if BG lags (per FP-BG §1.4, BG never blocks mainline).
