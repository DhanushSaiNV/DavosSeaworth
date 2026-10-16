# FP-BG — Background & Parallel Track (Work-Package Catalog)

|                |                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**       | `docs/feature-prds/FP-BG.md`                                                                                                                                                                                     |
| **Status**     | Approved for background execution                                                                                                                                                                                |
| **Nature**     | Not a linear milestone. A c atalog of independent work packages (BG-01…BG-17) runnable in any order, in parallel, by separate agent sessions — precisely for the case where mainline FP work is blocked or slow. |
| **Implements** | Per-package traces (§4) — every package cites PRD § / D# / TECH-SPECS § / AGENTS §. No package invents unspecced scope (AGENTS §2).                                                                              |
| **Depends on** | FP-01 closed. Two packages additionally depend on FP-02 Step 1+ only (noted per package). Nothing else in mainline blocks this track.                                                                            |
| **Budget**     | $0 (hard constraint, AGENTS §3.1)                                                                                                                                                                                |
| **Estimate**   | Per package: S ≤ 1 session · M 1–2 · L 2–3                                                                                                                                                                       |

## 1. Operating model

1. **One package = one agent session = one PR.** Never run two packages that own overlapping file paths concurrently (ownership map, §2.2).
2. Pick any package whose "Depends on" column is green. Order within the track is free; the priority column exists because content packages (Group A) are the longest-lead items gating FP-03 and beyond.
3. A package is complete only when its acceptance criteria pass, its doc write-backs are in the same PR, and the AGENTS §9 checklist ran.
4. **BG never blocks mainline.** If a package becomes required by a mainline FP (e.g., exemplar content for FP-03 acceptance), it is promoted into that FP's dependency list — otherwise mainline proceeds regardless of BG state.
5. Track state lives in the catalog table below; update it in every BG PR.

## 2. Concurrency contract (binding for all BG packages)

**2.1 AGENTS.md §8.4 amendment** (approved with this FP — quote into AGENTS.md in the first BG PR):

> "Agents may draft owner-content (rules, exemplars, few-shot pairs, onboarding scripts) only in `content/`, with `status=draft` and a visible DRAFT label. Only owner-approved content (`status=approved`) may be seeded via content migrations. Placeholders remain labeled and are never presented as final content."

**2.2 File ownership map:**

| Path                                                                                                                                        | Owner                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app/(app)/chat`, `supabase/functions/send-message`, `select-persona`, `_shared/pipeline/`, `_shared/prompts/guardrails.ts`, `_shared/llm/` | MAINLINE (FP-02 while in flight; FP-03 next) — BG does not touch                                                  |
| `app/(app)/journal`, `lib/journal/`                                                                                                         | BG-10                                                                                                             |
| `app/(app)/dashboard`, `components/registry/`                                                                                               | BG-09                                                                                                             |
| `app/(app)/settings`                                                                                                                        | BG-11                                                                                                             |
| `content/**`                                                                                                                                | BG-01/03/04/05/06                                                                                                 |
| `supabase/migrations/**`                                                                                                                    | Shared — BG uses CLI-generated **timestamp** migration names (never sequential `00xx`); one migration per package |
| Merged stable files (`job-dispatcher` registry, `config` table, `dev-smoke`)                                                                | **Additive-only**: BG may add registry entries / config rows / actions; never modify existing entries             |
| `docs/TECH-SPECS.md`, `docs/GLOSSARY.md`                                                                                                    | Shared — each package's write-back lands in its own PR, in its own sections                                       |

**2.3 Rebase rule:** after every mainline merge, in-flight BG packages rebase. A package that conflicts a second time is parked (catalog status `parked`) — never resolved by editing another package's or mainline's sections in-flight.

## 3. Package catalog

| ID    | Package                                           | Size | Priority | Unblocks                              | Depends on   | Status |
| ----- | ------------------------------------------------- | ---- | -------- | ------------------------------------- | ------------ | ------ |
| BG-01 | Content authoring & seeding infrastructure        | M    | **P0**   | BG-03/04/06; FP-03; every RAG feature | —            | Step 1 done · Steps 2–3 open |
| BG-02 | 16-domain enum decision memo                      | S    | **P0**   | BG-03/04 final content                | —            | memo filed — owner pick pending (PR review) |
| BG-03 | Rules library draft content (100+)                | L    | **P0**   | Rules Engine; FP-03; evening chain    | BG-01, BG-02 | corpus staged (`content/rules.json`, 119 rules) — schema transform pending |
| BG-04 | Exemplar set drafts (~228)                        | L    | **P0**   | FP-03 (the real classifier)           | BG-01, BG-02 | open |
| BG-05 | Guardrails few-shot pairs + provider bench        | M    | P1       | §14 step-11 hardening; D13 finality   | FP-02 Step 1 | open |
| BG-06 | Onboarding interview script drafts                | S    | P1       | Onboarding FP (scripts only)          | —            | open |
| BG-07 | JSONLogic validation gate                         | M    | P1       | Dashboard/formula FP                  | —            | open |
| BG-08 | `metric_vars_daily` views + `metric_eval` handler | M    | P1       | Dashboard FP                          | BG-07        | open |
| BG-09 | Dashboard component registry (4 components)       | M    | P1       | Dashboard FP                          | —            | open |
| BG-10 | Journal editor + client-side Unsavable strip      | M    | P1       | Journal/evening-chain FP              | —            | open |
| BG-11 | Settings implementation                           | S    | P2       | Check-in FP (cadence storage)         | —            | open |
| BG-12 | CI enforcement gates                              | M    | P2       | All future PRs                        | —            | open |
| BG-13 | Test harness + lint/format + TS strict            | S    | P2       | BG-12 polish                          | —            | open |
| BG-14 | Web deploy pipeline (free static host)            | S    | P2       | Beta distribution                     | —            | open |
| BG-15 | App identity: icons, splash, theme, PWA manifest  | S    | P2       | Web install/push UX (§8, D1)          | —            | open |
| BG-16 | Agent-tooling bridges + nested AGENTS.md          | S    | P2       | Parallel-agent ergonomics             | —            | open |
| BG-17 | Ops runbook + quota re-verification calendar      | S    | P2       | §13 live-item discipline              | —            | open |

*BG-06 row added for catalog completeness (the §4 card states no size/priority); values provisional. Status column added per FP-BG §1.5 — every BG PR updates it.*

## 4. Package cards

### Group A — Content supply chain (longest lead; start immediately)

**BG-01 — Content authoring & seeding infrastructure**

- **Trace:** TECH-SPECS §3.5 (migration 7), §3.3; D17, D19; AGENTS §8.4 (amended).
- **Agent does:** (1) `content/` directory with CSV/JSON schemas for `rules` and `exemplars` (columns exactly per §3.3 tables + `status` ∈ {draft, approved}); (2) validation script — schema, domain ∈ enum, tone/priority ranges, non-empty figures, near-duplicate text detection; (3) seeding pipeline (Edge Function `content-seed`, service-role auth): reads approved rows → `llm.embed` → insert with `embed_model='gemini-embedding-001@768'`; dry-run mode reports counts only; (4) `content-clear` inverse (delete by `status` or dev label).
- **Owner does:** nothing yet (approval comes per BG-03/04).
- **AC:** dry-run on a 5-row hand fixture reports 5 valid; seeding writes 5 rows with embeddings + status preserved; clear removes exactly those; invalid fixture rows (bad tone, dup text) rejected with per-row errors.

**BG-02 — 16-domain enum decision memo**

- **Trace:** TECH-SPECS §3.3 (proposed list marked "requires content sign-off").
- **Agent does:** one-page memo comparing the proposed 16 domains (merge/split candidates: Social vs Relationships; Mental/Emotional vs Purpose/Legacy; Creativity vs Learning), each with pros/cons vs rules-content fit and classifier separability; a recommendation; exact final enum list.
- **Owner does:** pick the enum; record in the PR review.
- **AC:** TECH-SPECS §3.3 updated from "proposed" to "approved" with the final list; GLOSSARY §1 domain entry updated; same PR.

**BG-03 — Rules library draft content**

- **Trace:** PRD §2 (100+ rules, 50+ figures, 16 domains); D17; AGENTS §8.4 (amended).
- **Agent does:** draft 100+ rules in the BG-01 schema, `status=draft` — ≥6 per domain, ≥50 distinct source figures, tone and priority assigned; every row DRAFT-labeled; run BG-01 validation clean.
- **Owner does:** review/approve (flip rows or batches to `approved`) — the only path to seeding.
- **AC:** ≥100 validated draft rows; validation report clean; zero rows seeded (seeding is a separate owner-gated act via BG-01 pipeline); no content merges unlabeled.

**BG-04 — Exemplar set drafts**

- **Trace:** TECH-SPECS §6.4 (~10/domain, 8/emotion, 10/quit-label); D19.
- **Agent does:** draft ~228 exemplars — 16×10 domain, 6×8 emotion (using the approved §11 six labels), 2×10 quit/false-constraint; leakage check: emotion exemplars must not double as domain exemplars (flag near-duplicates across sets); validation clean.
- **Owner does:** approve batches.
- **AC:** set counts hit targets; cross-set duplicate check reports zero; all rows `status=draft`.

**BG-05 — Guardrails few-shot pairs + provider bench**

- **Trace:** D13; TECH-SPECS §4.1 (provider-tested requirement); FP-02 FR-13.
- **Depends on:** FP-02 Step 1 merged (adapter + secrets exist). Owns zero mainline files: creates `content/guardrails-pairs.json` + Edge Function `dev-guardrails-bench`.
- **Agent does:** (1) candidate bad/good few-shot pairs (DRAFT); (2) bench function: runs each pair's prompt against **both** providers, ≤40 LLM calls per run (quota cap, tallied in the adapter log), outputs a report — banned-phrase occurrence ("As an AI…" family via substring check — allowed in offline tooling; the AGENTS §5.1 ban applies to product pipeline output only), tone drift notes, provider diffs.
- **AC:** bench produces a per-pair, per-provider report; call count ≤40; report filed in `content/reports/`; integration into `_shared/prompts/guardrails.ts` is **not** done here (mainline follow-up after FP-02 closes).

**BG-06 — Onboarding interview script drafts**

- **Trace:** TECH-SPECS §7.7 (stage machine, extraction targets); D17.
- **Agent does:** per-stage question scripts (intro → baseline → goals → routine → metric_selection) with the extraction target of each question and the proposed chips for metric selection; the high-dopamine-alternatives question wording (§7.8 consumer).
- **AC:** scripts cover all six stages; each question maps to a profile field or memory target per §3.2/§3.3; DRAFT-labeled.

### Group B — Deterministic backend components (no LLM)

**BG-07 — JSONLogic validation gate**

- **Trace:** D10; TECH-SPECS §7.9 (whitelist, variable enum, bounds, depth/size).
- **Agent does:** `_shared/formulas/validate.ts` — pure function `{valid, errors[]}`; select one Deno-compatible JSONLogic engine (decision recorded in GLOSSARY); unit-test matrix: every whitelisted op accepted; non-whitelisted op, out-of-enum var, literal >1000, depth >6, nodes >30 → rejected with named errors; a full valid formula accepted.
- **AC:** test matrix green; write-back: GLOSSARY entry for the chosen engine + gate identifier.

**BG-08 — `metric_vars_daily` views + `metric_eval` handler**

- **Trace:** TECH-SPECS §7.9 (`metric_vars_daily` [SPEC]), §2.3 (`metric_eval` job).
- **Depends on:** BG-07 (shared evaluator choice).
- **Agent does:** (1) timestamped migration creating the 8 aggregate views (one per whitelisted variable) over `doings_logs`/`journal_entries`/`metrics`; (2) `metric_eval` handler module + **additive** registry entry in `job-dispatcher`: evaluate all `formula_status='validated'` metrics for the due date → upsert `metric_points` (unique constraint = idempotency); (3) fixture test with dev-labeled rows, then cleanup.
- **AC:** fixture formulas produce correct points; re-run of the same job inserts zero duplicates; view SQL reviewed against §7.9 variable definitions.

**BG-09 — Dashboard component registry**

- **Trace:** D10; TECH-SPECS §7.9 (registry), §9.
- **Agent does:** `components/registry/` — `TrendLineGraph`, `ConsistencyHeatmap`, `ProgressBar`, `StatCard`; props exactly `{metric_id, points[]}` (no runtime UI generation, no formula awareness); a dev fixture screen on the existing `(app)/dashboard` stub (additive edit) rendering all four from local mock data.
- **AC:** four components render from mock points; no component accepts anything but the specced props; RN primitives only.

**BG-10 — Journal editor + client-side Unsavable strip**

- **Trace:** D3; TECH-SPECS §7.4, §10.2.
- **Agent does:** (1) `(app)/journal`: distraction-free editor, block-level Unsavable flags (select block → toggle), local draft persistence; (2) `lib/journal/strip.ts` — pure `stripUnsavable(blocks)` with unit tests: flagged blocks fully removed, unflagged preserved verbatim, empty result handled; (3) **zero network calls** — `submit-journal` does not exist yet and must not be invented.
- **AC:** strip unit tests green; draft survives app restart; a UI affordance shows exactly what will be sent (post-strip preview).

### Group C — Client surfaces

**BG-11 — Settings implementation:** cadence segmented control (60/120) writing `profiles.checkin_cadence_minutes` via RLS update; timezone display; restyle around existing sign-out. Trace: §3.2, §11. **AC:** value persists across restart; RLS blocks updating another user's row.

### Group D — Engineering chores & enforcement

**BG-12 — CI enforcement gates** (GitHub Actions): (a) secret scan (service-role patterns, `sk-` keys) across repo; (b) import/call ban — `mathjs`, `eval(`, `new Function` in `app/` + `supabase/functions/` excluding the vendored JSONLogic engine path; (c) RLS assertion — every user-scoped table in §3.2–3.4 has a policy; (d) `grep tactical_analysis app/` = zero. Trace: AGENTS §3–§5, §9. **AC:** each gate demonstrably red on a planted violation, green on main.

**BG-13 — Test harness:** `deno test` for `_shared`, ESLint flat config + Prettier, TS strict; wired into CI (additive to BG-12 if it exists). Chore trace: AGENTS §6/§9.

**BG-14 — Web deploy pipeline:** `expo export --platform web` → free static host (owner picks: Netlify/Vercel/Cloudflare Pages — all $0) via GitHub Action on main; env-injected Supabase URL/anon key. Trace: FP-01 §5. **AC:** main branch auto-deploys; deployed web signs in against the live project.

**BG-15 — App identity:** icons, splash, theme tokens, PWA manifest (name/colors/maskable icon). Trace: §9, §8/D1 web. **AC:** web is installable; identity applied on all three platforms.

**BG-16 — Agent-tooling bridges:** `CLAUDE.md` containing `@AGENTS.md`; Gemini config or `GEMINI.md`; nested `supabase/functions/AGENTS.md` (Deno rules, idempotency pattern, secrets access, additive-registry rule) and `app/AGENTS.md` (route map, RN primitives, platform capability matrix, offline-queue rules).

**BG-17 — Ops runbook:** `docs/ops/RUNBOOK.md` — keep-alive job parameters + alerting; day-8 auto-pause observation procedure; **quota re-verification calendar** (trigger events: any user beyond the 5 beta users, before public launch, quarterly — §13 live item 4); provider-key rotation; incident-notes template. Trace: D12, §13.

## 5. Explicitly out of scope (anti-invention list for agents)

Memory extraction/purge · `flag-unsavable` endpoint · check-in loop/watchdog · `submit-journal`/evening chain/anchor plans · habits/Strike · trust/Oath · lockdown · onboarding _logic_ (state machine — only scripts in BG-06) · real classifier (FP-03) · urge histograms · prompt-injection test suite (§14 step-11 hardening — needs pipeline outputs) · iOS remote push (blocked by $0; owner budget decision pending, TECH-SPECS §13 live item).

## 6. Risks

| Risk                                            | Mitigation                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Parallel merge conflicts with mainline          | §2 ownership map + additive-only rule + rebase-then-park                    |
| Agent-drafted content quality                   | DRAFT label + validation script + owner approval as the only seeding path   |
| BG-05 bench burns provider quota                | Hard cap 40 calls/run, tallied in the adapter log; stub-mode where possible |
| CI false positives (JSONLogic engine internals) | Path-filter the ban gate to first-party code                                |
| Scope invention on quiet packages               | Every PR cites traces; reviewer enforces AGENTS §2                          |

## 7. Definition of done

**Per package:** ACs pass · traces cited in the PR · doc write-backs in the same PR · AGENTS §9 checklist run · catalog status updated.
**Track-level:** never — the catalog persists; packages complete or park individually.

---

Per-package step-by-step PLAN breakdowns (like FP-01/FP-02 plans) are available on request — BG-03, BG-04, and BG-01 are the ones that benefit most (multi-session, L-size). Mainline continues with FP-03 whenever you ask, independent of this track's state.
