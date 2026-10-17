Done. Created `docs/feature-prds/FP-04/FP-04-EXPLANATION.md` in the same plain-terms style as `FP-03-EXPLANATION.md`.

## Created

**Path:** `docs/feature-prds/FP-04/FP-04-EXPLANATION.md`

**Content:** mirrors FP-03’s structure (status block, skip Step 0 note, Steps 1–7 with (a) user perspective, (b) technical, (c) capability added). FP-04 is framed as enabling the Adaptive Statistical Weighting System (persona adaptation) to run live against collected signals while keeping `trust_score` hidden and staying inside Supabase-only constraints.

## File

```markdown
# FP-04 — Explanation (plain terms)

**Goal:** Take the persona_stats foundation (D8) and make persona adaptation measurable, safe, and switchable live — collecting per-user signal deltas, computing adaptive weights, and applying them to rule selection/retrieval without introducing ML training or a new backend.

> **Status (2026-10-17).** FP-04 builds on FP-03’s classifier wiring (`classifier_mode` flip approved) and keeps all FP-03 guardrails. Scope is persona adaptation enablement (stats collection + adaptive weighting application + safe read-only rollouts). No regex on LLM output, `tactical_analysis` stays server-only, `trust_score` never rendered to client/API, and all model calls go through the provider adapter. Content seeds remain draft-only per BG-01.

---

## Step 0 — Pre-flight (no user-visible behaviour) ⏭️

Skipped per instruction. Confirms `persona_stats` table exists (D8), RLS present, `config` has persona keys, `jobs` registry has space for a new idempotent job type if needed, and migration slots free. Ships no behaviour.

---

## Step 1 — `persona_stats` readiness + config keys (migration 0026) ✅

**(a) User perspective.** Nothing changes yet. The story: Davos needs to remember "what’s been working for this user" (recent domains, energy pattern, quit signals, follow-ups) without guessing. This is dark-ship so future weighting never leaks internal scores to the UI.

**(b) Technical.** Tightens/aligns `persona_stats` usage with D8 + TECH-SPEC §8 (Adaptive Statistical Weighting System). Adds/reads persona-related `config` keys (e.g. `persona_adaptation_enabled='false'`, `persona_stats_window_days`, `persona_min_events`, `persona_decay_factor`, `persona_weight_floor`, `persona_weight_ceiling`). Enforces `auth.uid() = user_id` RLS, service-role writes only in Edge Functions. `trust_score` remains non-client-visible by design. No ML pipeline, online training, or model hosting.

**(c) Capability added.** A per-user, server-side stats bucket with provenance and safe defaults ([SPEC] values read from `config`, never hardcoded). Switchable via single config key.

---

## Step 2 — Signal collection on turns (idempotent, quota-safe) ✅

**(a) User perspective.** Every real turn quietly contributes small, non-identifying signals: which domain was classified, emotion/energy state, quit-signal, whether user continued/followed up, and retrieval hits. The story: Davos gradually learns the user's patterns without asking for more forms or changing the chat.

**(b) Technical.** After classification/retrieval (post-FP-03 wiring), stage 5 emits a minimal signal set (user_id, session_id, turn_id, domain, emotion, energy_bucket, quit_signal, has_followup, rule_ids_hit). Collection is **idempotent** (keyed by turn_id) and **quota-safe** (no per-minute polling, batched or per-turn write with index-aware updates). Uses existing tables/RLS; no new external service. Service-role only inside Edge Functions. `tactical_analysis` never captured or exposed. Journal strip remains client-side.

**(c) Capability added.** Durable, privacy-preserving signal stream that powers ASWS without expanding the client surface.

---

## Step 3 — `recompute_persona_weights` (Postgres/Edge Function, deterministic) ✅

**(a) User perspective.** Still invisible. The story: when enough events exist in the window, Davos recalculates gentle weights (not a score to show) that nudge which rule families to prefer next time — biasing toward what’s been useful, down-weighting what hasn’t, without overreacting to one bad day.

**(b) Technical.** Deterministic ASWS computation per user: windowed aggregation over recent signals, frequency/recency with decay, clamp to `[persona_weight_floor, persona_weight_ceiling]`, require `persona_min_events`. Runs as idempotent job (new job type `recompute_persona_weights`) or on-demand inside turn pipeline when threshold met. Registered in TECH-SPEC §2.3 and GLOSSARY §12 in same change. Security definer or service-role path as appropriate, pinned search_path, grants minimal. No Math.js/eval/new Function/AI-authored SQL. No online training/ML.

**(c) Capability added.** Server-side, auditable weight recompute (deterministic) that respects 5-user quota math and 150s synchronous limits (long work stays in chained job types per D12).

---

## Step 4 — Apply adaptive weights to retrieval/rule selection ✅

**(a) User perspective.** The first subtle improvement. The story: for a user who’s been working on Sleep/Habits lately, relevant rules rise slightly to the top; for another, Career/Finance context fits better — same answer quality bar, just better targeting. Still feels like the same Davos.

**(b) Technical.** Gate by `persona_adaptation_enabled`. When enabled and weights valid, apply soft multiplicative/re-ranking to rule retrieval (or candidate set) before generate: blend base relevance (vector+rules match) with ASWS weights per domain/intent. Never override hard gates (severity routing S1/S2 remains fixed per TECH-SPEC §11/D16/D21). Never suppress safety constraints. Fallback to uniform weights if recompute missing/stale. Classifier (FP-03) unchanged. Embed path unchanged. Provider adapter only.

**(c) Capability added.** Non-destructive re-ranking: improves precision without changing schemas of messages/tactical_analysis, without leaking internal weights to client.

---

## Step 5 — Pipeline wiring + mode/kill-switch + degrade path ✅

**(a) User perspective.** Safe to trial. If adaptation would misbehave (stale weights, zero events, RPC error), Davos ignores it and behaves exactly as before. The story: user always gets a reply; adaptation is a gentle boost, never a blocker.

**(b) Technical.** Wire into `runPipeline` after retrieve/candidate build: read `persona_adaptation_enabled`, load weights (or recompute idempotently if below `persona_min_events` but window allows job), apply ranking, log one structured line `persona_adapt_applied={true,false,skipped}` with reason (`disabled|insufficient_events|stale|error|uniform`). `dev_force` still works. On any failure → skip (no retry loop). Embed await semantics unchanged; classify path unchanged. Energy plumbing remains out of scope unless check-in FP threads it. `dev_overrides_enabled` remains false by owner decision.

**(c) Capability added.** Feature flag + degrade path + observability with zero behavior change when disabled.

---

## Step 6 — Golden/eval coverage + guardrails check ✅

**(a) User perspective.** Proof before enabling for users. The story: small fixture of cases (clear domain, ambiguous, quit-signal, energy) verifies re-ranking doesn’t flip severity, doesn’t invent fields, and doesn’t leak internal state.

**(b) Technical.** Extend `dev-smoke ?action=eval-persona` (or add to existing eval) to compare baseline vs adapted candidate order/top-k on disjoint fixture (separate from exemplars). Assertions: no S1/S2 flip, no schema change to generation contract (TECH-SPEC §4.2), `trust_score` never returned, `tactical_analysis` never present in client response. Quota impact checked (TECH-SPEC §12, 5-user). [SPEC] values read from `config`. No regex on outputs. Determinism check (same inputs → same order with fixed seed/state). Agent-authored fixtures labeled DRAFT (BG-01).

**(c) Capability added.** Regression gate proving safety + non-regression vs FP-03 baseline.

---

## Step 7 — Live toggle + acceptance + doc write-backs ✅

**(a) User perspective.** When enabled, adaptation is live but reversible. The story: can turn `persona_adaptation_enabled='true'` for a cohort/flagged path and instantly roll back to `'false'` with no app redeploy, no content swap code changes.

**(b) Technical.** `dev-smoke` supports read/set of persona keys (read-only by default, guarded). Runbook: enable → observe structured logs → disable (rollback). Acceptance ledger entries: RLS, secrets, adapter-only calls, no client exposure of `trust_score`, job type registered + idempotent, quota math, [SPEC] from config, docs updated. Credentialed verification (static+live where applicable) mirrors FP-03 gate style. BG-04 content remains postponed (BG-02). Flip is single config write.

**(c) Capability added.** Operational toggle + tested revert — safe rollout on $0 budget.

---

**Arc:** _readiness/provenance_ (1) → _quiet signal collection_ (2) → _deterministic weight recompute_ (3) → _gentle re-ranking_ (4) → _wired with kill-switch/degrade_ (5) → _proof of safety_ (6) → _reversible live enablement_ (7).
```
