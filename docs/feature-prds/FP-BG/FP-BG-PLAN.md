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

**Status (2026-10-16):** memo filed at `docs/feature-prds/FP-BG/BG-02-domain-enum-memo.md` — recommends adopting the owner corpus's 16 domains (mind, mastery, strategy, wealth, health, character, relationships, creativity, resilience, purpose, spirituality, time, communication, learning, leadership, habits). Docs (`TECH-SPECS §3.3/§5.3`, `GLOSSARY §1/§14`), `content/validate.ts`, and the BG-01 fixtures flipped to the recommendation in the same PR — **owner pick pending PR review**; amend to the chosen option if it differs. **Superseded 2026-10-20: owner selected Option 1 (§3.3 canonical).**
**Status (2026-10-17) — BG-04 approval evidence:** the owner's exemplar review (`content/reports/FP-03-BG04-APPROVAL-RECORD.md`) corrected the BG-04 drafts to the **§3.3 canonical enum** (Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy) and approved 228/228 against it — the shipped system (rules tagging, placeholder corpus, golden set, config) runs on canonical. Record §6.1 kept BG-02 sign-off **formally open** at that time: a taxonomy-variant CSV cannot be slotted without a decisions2 entry + §3.3 write-back + rules re-tagging + golden-set re-authoring. The validator/`TECH-SPECS §3.3` carry the **§3.3 canonical** enum; `rules.csv` was re-tagged to canonical on 2026-10-20 and validation is clean.
**Status (2026-10-20) — DECIDED: Option 1.** Owner ratified the §3.3 canonical enum; the memo's Option 2 recommendation is not adopted. BG-02 is closed. BG-03's re-tag/re-home pass and 24-rule gap fill are complete (144 rows, all 16 domains ≥6, validation clean). BG-04's 228 approved exemplars already use §3.3 and are unblocked for seeding.

**Agent does:** one-page memo on the proposed 16 domains (split/merge candidates: Social↔Relationships, Mental/Emotional↔Purpose/Legacy, Creativity↔Learning), pros/cons vs rules-content fit and classifier separability, one recommendation + final enum list.
**OWNER MANUAL:** pick the enum in PR review. **Done 2026-10-20: Option 1 (§3.3 canonical).**
**Verify / write-backs:** TECH-SPECS §3.3 flips "proposed → **approved**" with the final list; GLOSSARY §1 domain entry updated — same PR. **Refs:** §3.3; FP-BG BG-02.

## BG-03 — Rules library draft content (L)

- [x] **Step 1 — Authoring scaffold.** Per-domain working files under `content/rules/`; distribution plan (≥6/domain, ≥50 distinct figures, ~105 total); a style guide (imperative, attributable, 1–2 sentences, tone + priority assignment rules). _Verify:_ scaffold + style guide committed; zero content yet. **Refs:** PRD §2; D17; AGENTS §8.4.
- [x] **Step 2 — Draft domains 1–6 (~40 rules).** Draft, run `validate.ts`, commit with counts. _Verify:_ validation clean; all rows `status=draft`.
- [x] **Step 3 — Draft domains 7–11 (~35 rules).** Same gate.
- [x] **Step 4 — Draft domains 12–16 (~30 rules).** Same gate; totals now ≥100 rules / ≥50 figures.
- [x] **Step 5 — Final sweep + approval handoff.** Full validation; summary report (per-domain/figure/tone/priority distribution, gaps flagged) to `content/reports/`; **zero rows seeded**.
      **OWNER MANUAL:** approve in batches (flip `status`); seeding happens later via BG-01 Step 3 — never in this package. **Refs:** PRD §2; FP-BG BG-03.
- **Status (2026-10-20) - APPROVED + SEEDED.** The owner approved all 144 rules for beta; `content/rules.csv` carries ?3.3 labels via `content/rules/domain-map.json` (144 rows, all APPROVED); `validate.ts` clean; all 16 domains meet the ?6 floor. The library is seeded live (144 rows, placeholder rules cleared). Reports: `content/reports/BG-03-RETAG-REPORT.md`, `BG-03-GAP-FILL-REPORT.md`, and `BG-03-RULES-APPROVAL-RECORD.md`.

## BG-04 — Exemplar set drafts (L) — BG-02 decided: Option 1 (§3.3 canonical)

- [x] **Step 1 — Domain exemplars, batch 1 (8 domains × 10).** First-person-ish user-message phrasings; each labeled. _Verify:_ validation clean; draft status.
  **Status (2026-10-17): built.** 80 rows (mind, mastery, strategy, wealth, health, character, relationships, creativity) appended to `content/exemplars.csv`; `validate.ts` clean.
- [x] **Step 2 — Domain exemplars, batch 2 (8 domains × 10).** Same gate.
  **Status (2026-10-17): built.** 80 rows (resilience, purpose, spirituality, time, communication, learning, leadership, habits) appended; `validate.ts` clean.
- [x] **Step 3 — Emotion (6 × 8) + quit/false-constraint (2 × 10).** Emotion texts are emotion-first and persona/domain-agnostic (separability requirement, D19). _Verify:_ validation clean.
  **Status (2026-10-17): built.** 48 emotion (frustrated, exhausted, anxious, proud, determined, avoidant) + 20 quit/false-constraint rows appended; `validate.ts` clean.
- [x] **Step 4 — Cross-set audit + handoff.** Near-duplicate check across all three set kinds (leakage — flag pairs crossing domain↔emotion); report to `content/reports/`; zero seeding. **Refs:** §6.4; D19; FP-BG BG-04.
  **Status (2026-10-17): complete.** `content/reports/exemplars-audit-2026-10-17.md`: 228 exemplars (160 domain + 48 emotion + 20 quit); hard dups = 0 (≥0.85); cross-set leakage = 0 (≥0.5); contrastive watchlist pairs well-separated (0.24–0.32). ALL DRAFT — zero seeding.
  **Status (2026-10-17) — APPROVED WITH CORRECTIONS (owner review).** 228/228 approved. Draft set corrected to the §3.3 canonical taxonomy: 162 rows as-is · 12 revised · 54 dropped + 54 new; ids re-slugged `e_domain_career_01`…`e_domain_purpose_legacy_10` (emotion/quit ids unchanged). `content/exemplars.csv` now carries the approved set (`status=approved`); `validate.ts` PASS (228 approved exemplars + 120 draft rules). Full dispositions: `content/reports/FP-03-BG04-APPROVAL-RECORD.md`. Zero rows seeded — seeding is BG-01 Step 3 (owner-run); FP-03 swap steps (bg04.ts stand-in, golden gate, classifier flip) land in the mainline workspace per record §5.

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

- [x] **Step 1 — Pure strip module.** `lib/journal/strip.ts` + unit tests: flagged blocks fully removed, unflagged preserved verbatim, empty-result case. **Refs:** D3; §7.4, §10.2.
  **Status (2026-10-16): complete; committed (`e0a2770`).** `lib/journal/strip.ts` (`splitBlocks` with exact source spans; `stripUnsavable` removing flagged blocks + one adjacent separator, survivors byte-identical; `stripSummary` counts) + `strip.test.ts` (**26 tests, all green**; full suite 5 suites/52 green; one real span bug fixed via the tests) — `tsc` adds zero new errors, `eslint` clean, web export bundles.
- [x] **Step 2 — Editor UI.** `(app)/journal`: distraction-free editor, block-level Unsavable toggle, local draft persistence. _Verify:_ draft survives app restart.
  **Status (2026-10-16): complete; committed (`e0a2770`).** `app/(app)/journal.tsx` replaces the FP-01 stub: full-screen multiline `TextInput`, debounced (~300 ms) block review list with tap-to-flag, flags keyed by exact block text (owner decision), AsyncStorage draft `davos_journal_draft` (debounced save + unmount flush). **Zero network calls** — no `lib/supabase` import anywhere on this path.
- [x] **Step 3 — Post-strip preview.** UI affordance showing exactly what would be transmitted. **Zero network calls** — `submit-journal` must not be invented. _Verify:_ preview matches strip unit-test output for the same fixture.
  **Status (2026-10-16): complete; committed (`e0a2770`).** Collapsible preview panel renders `stripSummary` output verbatim + "N of M blocks" count line; the screen drives the same pure function the unit tests pin (fixture-equivalence test in `strip.test.ts`).

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

- [x] **Built** — the owner-supplied brand mark (amber circle beside a tall rounded stem; `#E2A63B` / `#0F1B2D` / `#F9F9FB`) on all three platforms: app icon (1024², full-bleed navy `#0F1B2D`, **no alpha**), Android adaptive foreground + `#0F1B2D` plate + Android-13 monochrome layer, notification small icon (96², white, transparent), light/dark splash (`#F9F9FB` / `#08090B`), web/PWA set + `manifest.json` with `#0F1B2D` theme/background and a `maskable` entry. Theme tokens already existed (`theme/`).
- [x] **Agent-verifiable half** — `expo export --platform web` ships the identity `<head>` + manifest and every referenced icon resolves; `scripts/`-free regeneration from `assets/davos_logo/` is documented in TECH-SPECS §9. Also found and recorded that `app/+html.tsx` is inert under single-page web output (the shell is `public/index.html`) — TECH-SPECS §9.
- [x] **Owner-directed follow-on — the mark in motion** — every `ActivityIndicator` in the app is replaced by one of two wait states derived from the mark: **`LoadingMark`** (the amber dot orbits the stem on a 2.4 s linear cycle, passing behind it) for the full-screen/section waits, and **`LoadingDot`** (the same orbit reduced to 0.9 s) for buttons, `IconButton` and the chat per-bubble send state — 9 call sites in all. Both are `react-native-svg` + `Animated` (Expo-pinned `15.15.4`, free), so the mark stays crisp and a logo change is one edit to `components/brand/brandArtwork.ts`. The Reduce Motion branch holds the static mark (or dot) and pulses at 1.6 s to `0.55`. **Agent-verifiable half:** `npm run typecheck` clean · 0 ESLint errors · the full jest suite passes (including 7 orbit-geometry tests) · `npx expo export --platform web` bundles the paths, the brand ink and `react-native-svg` · both loading components mount and animate in the web export · no `ActivityIndicator` remains anywhere under `app/` or `components/`.
- [ ] **Owner half (loading mark)** — confirm on a device/emulator that the orbit reads well and that the mark is legible at the small sizes (in-button, per-bubble); those are per-call-site numbers, trivial to retune. Note `react-native-svg` is a native module: this change needs a rebuild (`npx expo run:android` / `ios`), not just a JS reload.
- [ ] **Owner half** — Lighthouse/install prompt on the deployed origin (BG-14); confirm the dark identity on the home screen (switching variants is a re-derivation from `assets/davos_logo/`, per TECH-SPECS §9 — not a toggle).

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
