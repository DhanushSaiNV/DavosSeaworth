# FP-03-PLAN.md — Build Plan: Real Classifier (Embedding-Similarity)

**Companion to:** `docs/feature-prds/FP-03/FP-03.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **Zero new job types anywhere in this FP** — the §2.3 registry and GLOSSARY §12 stay untouched: classification is one embedding (already on the turn's critical path for stage 3) plus one deterministic RPC, and seeding embeds inline (the seed-rules precedent). Migration numbers assume the next free slots after `0023`; renumber if taken (FP-02 precedent) and write back.

**Verification is automated.** Every step's live Verify is a re-runnable script — `scripts/verify-fp03-stepN.py`, the `verify-step8/9/10/11.py` pattern: env `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DAVOS_USER_JWT` / `DEV_SMOKE_TOKEN`, config snapshot + restore in a `finally`, and `--static-only` where a live leg is separable. The only non-automatable gates in this FP are the two **OWNER MANUAL** judgement calls (Steps 6 and 7). Applying the migrations and redeploying the functions stay owner-side; the scripts assert the post-conditions.

**Progress tracker:**

| Step | Name                                              | Status |
| ---- | ------------------------------------------------- | ------ |
| 0    | Dependency gate (FP-02 foundation)                | ✅     |
| 1    | `exemplars.source` + config keys (migration 0024) | ✅     |
| 2    | Placeholder exemplars + seed/clear                | ✅     |
| 3    | `match_exemplars` RPC (migration 0025)            | ✅     |
| 4    | `classifyReal` behind the §6.3 contract           | ✅     |
| 5    | Pipeline wiring: mode branch + embed await point  | ⬜     |
| 6    | Golden set + eval gate + calibration              | ⬜     |
| 7    | BG-04 swap drill, doc write-backs, AC sweep       | ⬜     |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

**Revision note (pre-build):** corrections applied after a review of this plan against the tree, before Step 1. Each is reflected in the step it affects; nothing here changes FP-03's intent, only how it is built and gated.

- **Step 5 — the embed's await point moves, but its failure semantics must not.** In real mode the embed is awaited _before_ classification, so a Gemini embed outage would fire before any routing decision exists; `degradeToHoldingReply` would then enqueue an `llm_retry` whose `persona`/`domain` are null, and `job-dispatcher`'s `llm_retry` handler (which requires both) would close the job without generating — stranding _every_ turn of a real-mode outage. `classifyReal` now consumes the embed _result_ and returns the D7 block on `!ok` (stage 2 is already non-fatal, §5.1), so the decision exists (fallback / `inquirer` / `General`) and stage 3's untouched `await` still throws with context. Zero new job types; no handler change.
- **Step 4 — unit tests are jest.** The file is `_shared/pipeline/classify.test.ts`; jest's default `testMatch` is `*.(spec|test).ts`, so the Deno-style `classify_test.ts` would never run, and `npx jest` already discovers tests project-wide. Only the **pure** composer is unit-tested — jest cannot load `_shared/config.ts` (it reads `Deno.env` at import), so the RPC leg is covered by the automated Step 4 script.
- **Step 4 — the stub is not renamed.** It stays exported as `classify` (only `runPipeline.ts` imports it); `classifyStub` in this plan means that same function.
- **Steps 6–7 — `confidence_bands` moves are in scope**, but they are _proposed_ at Step 6 and _applied_ at Step 7 together with the mode flip: the bands are shared with the stub, so moving them is not dark. The decisions2 D4-amendment entry records old→new as the rollback pair.
- **Steps 4/6 — forced-emotion confidence ships spec-literal** (the forced label's own best similarity). Step 6 prints the energy subset's tier histogram; if it skews, switching to the authoritative reading (`emotion_conf = 1.0`) is a one-line follow-up there.
- **Step 2 — label parity** is exemplars == the §3.3 16-string list, and `rules`' domains ⊆ exemplars' domains. Today `rules` holds 3 of the 16, so equality with `rules` was unsatisfiable.
- **Step 5 — the classify log line** is emitted _after_ stage 4 (only then is `route` known) and omits `provider`/`requestId`, so `verify-step11.py`'s `requestId === "embed"` parse is unaffected.
- **Doc target:** `classifier_mode` is a config key → GLOSSARY **§16**, not §15. The feature PRD's §9 DoD still says §15; the owner should correct it there — this plan does not edit `FP-03.md`.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md` exists with 12/12 pass; (2) `dev-smoke ?action=embed` returns a 768-dim vector with `llm_stub_mode=false` (adapter embed path alive); (3) the `exemplars` table exists from migration `0006` with zero rows, its `set_kind` check covering domain/emotion/quit_signal, and RLS read-only for authenticated (writes service-role only); (4) diff the stub classifier's output fields against TECH-SPECS §6.3 and record the exact field list — it is the contract Step 4 must reproduce; (5) source the label lists for Step 2 authoring: the §3.3 proposed 16-domain set (exact strings, slashes included), the six `config.emotion_labels` values, and the quit labels `quit` / `false_constraint`; (6) migration slots `0024`+ are free; (7) record the domains present in `rules` — 3 of the 16 (`Career`, `Fitness`, `Discipline/Habits`) — as the Step 2 parity baseline; (8) record the embed/`llm_retry` coupling that Step 5 must preserve: today the embed is _awaited_ after `determinePersona` (stage 3), and the `llm_retry` handler requires non-null `persona` **and** `domain`.

**Verify:** all eight green. Any failure → stop, fix FP-02 / FP-01 first; never build the classifier on a broken pipeline.

---

## Step 1 — `exemplars.source` + config keys (migration 0024)

**Agent does:**

1. Migration `0024_exemplars_source_fp03`: `alter table exemplars add column source text not null default 'PLACEHOLDER-DEV'` — the rules' `source_figure` pattern, so seed/clear/swap are explicit and the BG-04 swap (Step 7) never deletes content it cannot name. No other schema change: the table, its `set_kind` check, `embedding not null`, and RLS policies are exactly as `0006` built them.
2. Same migration, config registry seeds — `classifier_mode` (`'stub'`; the dark-ship flag and prod rollback switch, not dev-only), `quit_signal_threshold` (0.75, §6.3 [SPEC]), `energy_exhausted_max` (3, §6.2), `energy_determined_min` (8, §6.2). Seed values as proper jsonb (the `0014` lesson: quoted strings / `to_jsonb`, never bare literals that fail the cast). Tier boundaries are **not** new keys — stage 4's existing `confidence_bands` stays the single source (D4).
3. Write-backs in this commit: TECH-SPEC §3.3 (`source` column in the exemplars DDL) + §11 (four keys); GLOSSARY §11 (exemplars row) + §16 (four keys).

**Verify:** migration applies clean; `\d exemplars` shows `source` with the right default and the `0006` constraints untouched; `select * from config` returns the four new keys with `classifier_mode='stub'`; an authenticated-key read of `exemplars` still works and an authenticated-key write still fails (RLS unchanged); zero `pg_policies` delta.

**Commit refs:** TECH-SPEC §3.3, §11; D19; FP-03 FR-1, FR-11 (partial).

---

## Step 2 — Placeholder exemplars + seed/clear

**Agent does:**

1. Author `_shared/dev/placeholderExemplars.ts` — ~228 items, all `source='PLACEHOLDER-DEV'`: 16 domains × 10 (labels = the §3.3 exact strings), 6 emotions × 8 (labels = `config.emotion_labels`), `quit_signal` set with 10 `quit` + 10 `false_constraint` (§6.4 sizing). Authoring rules: first-person user voice; one idea per item; no item that plausibly belongs to two labels (ambiguity is the golden set's job, Step 6); varied length/register within each label; emotion texts emotion-forward with minimal domain-specific nouns (D19's conflation trade-off); texts kept disjoint from the golden set as an authoring rule; no text duplicated from the placeholder rules module.
2. Extend `dev-smoke`: `?action=seed-exemplars` (delete where `source='PLACEHOLDER-DEV'` → embed every text in one batched `llm.embed` call → insert rows stamped `embed_model='gemini-embedding-001@768'`; assert vectors.length === texts.length so stub mode fails loudly, the seed-rules precedent; idempotent by delete-then-insert) and `?action=clear-exemplars` (delete where `source='PLACEHOLDER-DEV'`).

**Verify** (`scripts/verify-fp03-step2.py`, automated): with `llm_stub_mode=false`: seed → 228 rows; per-set counts 160 / 48 / 20; every row `embedding` not null + `embed_model` stamped; distinct emotion labels exactly match the live `config.emotion_labels`; distinct domain labels exactly match the §3.3 16-string list, **and** the domains present in `rules` are a subset of them (the R-4 parity check — `rules` holds only 3 of the 16 today, so equality with `rules` is not the test; any mismatch against the canonical list is a stop, not a warning); adapter logs show the batched embed as ≤ ~3 requests; re-seed → still 228 (no duplicates); clear → 0; re-seed → 228 again.

**Commit refs:** TECH-SPEC §6.4, §3.3; AGENTS.md §8.4; D5, D19; FP-03 FR-2, FR-3, FR-4, FR-5. **Passes AC-7.**

---

## Step 3 — `match_exemplars` RPC (migration 0025)

**Agent does:**

1. Migration `0025_match_exemplars`: function `match_exemplars(query_embedding vector(768))` returning `(set_kind text, label text, sim double precision)` — per-`(set_kind, label)` max cosine similarity (`1 - (embedding <=> query_embedding)`) over all seeded rows, one row per label (~24 rows at full seed). `security definer`, fully qualified names, inline `set search_path` — the `claim_jobs` hardening, deliberately not repeating the known `match_rules` gap (which stays recorded, untouched). Grants mirror `match_rules`: execute to `authenticated` and `service_role`, revoked from public/anon.
2. Extend `dev-smoke`: `?action=match-exemplars&text=…` → embed the text via `llm.embed`, call the RPC, return the per-label rows sorted by set then similarity — proves the path end-to-end and is Step 6's debugging tool.

**Verify** (`scripts/verify-fp03-step3.py`, automated): with exemplars seeded, the action returns 24 rows with sims in a sane cosine range and the expected domain of a domain-flavored text among its set's top rows; an **anon**-key RPC call is rejected while an authenticated-key call and a service_role call both succeed (the `revoke … from public, anon` is asserted, not assumed — note `match_rules` never revoked its default PUBLIC grant, the other half of the recorded drift); with exemplars cleared, the action returns zero rows (the Step 4 fallback trigger, proven at the source); `tsc --noEmit` clean.

**Commit refs:** TECH-SPEC §6.2; migration `0013` + `0008`-follow-up precedents; FP-03 FR-6.

---

## Step 4 — `classifyReal` behind the §6.3 contract

**Agent does:**

1. `_shared/pipeline/classify.ts`: add `classifyReal` alongside the stub — pure w.r.t. writes. **Split pure from impure, the `retrieveRules.ts` precedent.** Export a pure `composeClassification(rows, energy, thresholds)` — `rows` are `(set_kind, label, sim)` triples, no I/O, type-only imports, unit-testable — which does: argmax domain over the domain rows, argmax emotion over the emotion rows → energy override (energy ≤ `energy_exhausted_max` → emotion `exhausted`; ≥ `energy_determined_min` → `determined`; the forced label's own best sim is `emotion_conf` — reading recorded, written back in Step 7) → `overall_conf = min(domain_conf, emotion_conf)` → `quit_signal` = quit-set top sim ≥ `quit_signal_threshold` → the §6.3 block with the exact Step 0 field list. `classifyReal({ embedding, energy? })` is the thin impure wrapper: read the thresholds from `config`, call `match_exemplars` (service-role client, the `retrieveRules` pattern), hand the rows to `composeClassification`. Also export `D7Fallback()` — the §6.4 block (labels null, confidences 0, `quit_signal` false). Zero rows or an RPC error → `D7Fallback()` plus a structured warning; the caller (Step 5's orchestrator, and `dev-smoke`) returns `D7Fallback()` when the embed result is `!ok`. Stage 2 never throws (§5.1: stages 1–2 non-fatal). The stub — exported as `classify`, **not** renamed to `classifyStub` — stays byte-for-byte: it is the rollback.
2. Unit tests (`_shared/pipeline/classify.test.ts` — jest, run by the existing `npx jest` gate): the pure `composeClassification` only — argmax per set; min-composition; energy override both directions including when the argmax disagrees, and the forced-label conf rule; `quit_signal` at/around the threshold; zero rows → D7 block; boundary confs through the composed path. Not `classify_test.ts`: jest's default `testMatch` is `*.(spec|test).ts`, so that name would never run. The RPC/error legs are covered live by the Step 4 script — jest cannot load `_shared/config.ts` (`Deno.env` at import).
3. `dev-smoke ?action=classify&text=…&energy=…` → the real block over the seeded exemplars; `&mode=stub` → the stub block, for shape diffing.

**Verify** (`scripts/verify-fp03-step4.py`, automated, plus `npx jest`): a domain-flavored text and a clearly different-domain text classify to different domains (recorded); `energy=2` → `exhausted` regardless of the argmax, `energy=9` → `determined`, no energy → argmax stands; crafted divergent confs → `overall_conf` = min; a quit-phrased text → `quit_signal` true, a neutral one → false; after `clear-exemplars`, classify returns the D7 block (null labels, zero confs); stub vs real JSON diff → identical field sets, values only; `tsc --noEmit` + `jest` (the new suite actually executes) clean.

**Commit refs:** TECH-SPEC §6.1–6.4, §5.1; D7, D19; FP-03 FR-7, FR-8, FR-9, FR-10, FR-12. **Passes AC-3, AC-4 (unit level), AC-5 (classify level).**

---

## Step 5 — Pipeline wiring: mode branch + embed await point

**Agent does:**

1. `runPipeline.ts`: the orchestrator becomes `[extract ∥ embed]` → classify → persona → retrieve → generate (§5.1's stage-4-before-stage-3 order unchanged). Stage 2 branches on `classifier_mode`: `'real'` → `classifyReal({ embedding, energy })`; `'stub'` → the stub (`classify`) (in stub mode the instant classify simply serializes after the embed — behaviorally identical, and the FP-02 verifies must still pass). **The embed's await point moves before classify; its failure semantics must not.** Await the embed promise once at the top of the sequence; on `!ok` stage 2 returns `D7Fallback()`, so a decision exists (fallback / `inquirer` / `General`), and stage 3's `await embedPromise` + `throw new ProvidersUnavailableError(..., { context })` stays exactly as FP-02 wrote it. That keeps §5.1's "hand-off is total by construction" true in real mode: the degrade path writes a non-null `domain` and the `llm_retry` payload carries a non-null `persona`/`domain`, so the job re-runs stages 3–5 and generates instead of being closed as unusable (FR-13: no new path, no new job type). Awaiting an already-settled `AdapterResult` twice is safe — the adapter returns result objects and never rejects.
2. Energy plumbing: `runPipeline` accepts an optional per-turn `energy` input and passes it to `classifyReal`. No caller passes one yet — §6.1 scopes the energy input to check-in turns, and chat turns carry none; the check-in FP (§7.1) threads the captured score through this param later. Record the reading; write back in Step 7.
3. Dev overrides: `dev_force` (tier / domain / emotion) applies post-classification in real mode too, through the existing `_shared/dev/overrides.ts`, gated by `dev_overrides_enabled` — the FP-02 drill keeps working in both modes.
4. Structured log line per real classification — `{ts, stage:'classify', mode, domain, emotion, overall_conf, quit_signal, route, latencyMs}`, the `logCall` shape. Emitted **after stage 4**, because only then is `route` known, and deliberately without `provider`/`requestId` so `verify-step11.py`'s `requestId === "embed"` log parse is unaffected. It is the FR-17 evidence and Step 6's calibration feed.
5. `dev-smoke ?action=pipeline` follows `classifier_mode` (optional dev-gated `&classifier=` override for drills).

**Verify** (`scripts/verify-fp03-step5.py`, automated): with `classifier_mode='real'` and a clearly non-Career text: domain ≠ the stub default `'Career'`, stage 3 retrieved the classified domain's rules, route follows the real confidence; adapter logs show exactly **one** embed line per turn (no new embed); live route drill via `dev_force` → all four routes (auto / options / low_question / fallback) produced end-to-end (exact numeric edges are unit-tested in Step 4); **the embed-failure gate** (the regression this revision targets): snapshot `llm_call_timeout_ms`, set it to `1` so the Gemini embed aborts as a transport failure, POST once through `send-message`, and assert the user row + a holding reply (`metadata.route='degrade'`, **non-null `domain`**) + **exactly one `llm_retry` job whose payload has non-null `persona` and `domain`** — then restore the timeout in a `finally` and confirm the retry produces the real reply; `llm_force_fail='both'` → the FP-02 degrade behaves identically (holding reply + one `llm_retry` job, recover on `'none'`); flip `classifier_mode='stub'` → the FP-02 Step-3 force=high/medium/low/fallback verify passes unchanged — rollback proven, no redeploy; `tsc --noEmit` + `jest` clean.

**Commit refs:** TECH-SPEC §5.1, §5.3, §4.1, §11; D4, D19; FP-03 FR-11, FR-13, FR-14, FR-15, FR-17. **Passes AC-1, AC-2 (live drill half), AC-6, AC-10.**

---

## Step 6 — Golden set + eval gate + calibration

**Agent does:**

1. Author `_shared/dev/goldenSet.ts` — 40 items: 12 clear-domain (distinct domains, no overlap), 8 ambiguous (two plausible domains each), 8 energy-override (4 low, 4 high), 6 quit, 6 false-constraint. Item = `{id, text, case, expect}`. Texts disjoint from `placeholderExemplars` — grep-verified, not assumed.
2. `dev-smoke ?action=eval-classifier` (new): batch-embed the golden texts, run `classifyReal` per item (energy passed for the override cases), return per-case results + summary. Requires `llm_stub_mode=false`; refuses to run otherwise.
3. `scripts/verify-fp03-step6.py` (automated; FP-02 owns the unqualified `verify-stepN.py` numbers): drives the eval action via `DEV_SMOKE_TOKEN`, gates it — clear-domain accuracy ≥ 0.90; energy-override compliance = 100%; quit / false-constraint precision-recall recorded; tier distribution + per-label confidence histograms **plus the energy subset's tier histogram** printed as calibration evidence, alongside **proposed** `confidence_bands` values (a proposal only — nothing is applied at this step; the bands are shared with the stub, so a move is applied at the Step 7 flip). Snapshots and restores `classifier_mode`, `llm_stub_mode`, `llm_force_fail` in a `finally` (the verify-step11 pattern).
4. Archive the report to `docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<date>.md`.

**Verify:** `python scripts/verify-fp03-step6.py` → gates green (or a documented deviation with a fix plan); leakage grep → zero golden texts present in `exemplars`; the report file exists with the histograms and the proposed bands; config restored (post-check).

**OWNER MANUAL:** judge the report — sane tier distribution? which labels are weak? Fix exemplars (data) first. Decide the two readings on the evidence: (a) the forced-emotion confidence — keep the spec-literal reading, or switch to authoritative (`emotion_conf = 1.0`) and re-run; (b) the **proposed** `confidence_bands` — accept them (applied at Step 7 as a D4 product-semantics change with a decisions2 entry) or keep the current values. Then approve or reject the flip to `'real'`.

**Commit refs:** FP-03 NFR-4; D19. **Passes AC-3 (full), AC-9.**

---

## Step 7 — BG-04 swap drill, doc write-backs, AC sweep

**Agent does:**

1. BG-04 hot-swap drill — proves the swap is data-only, zero code: seed a mini approved set (2 labels × 2 texts, `source='BG-04'`) via `seed-exemplars` extended with a `&source=` param reading a `_shared/dev/bg04Drill.ts` fixture → verify via `?action=classify` that those labels now classify per the new texts → `clear-exemplars&source='BG-04'` + re-seed placeholders → baseline restored. The fixture is a stand-in: BG-04's real approved set is owner-authored content that arrives via a content migration (AGENTS.md §8.4 / BG-01), and the runbook must say so — FP-03 ships the mechanism and the `source='BG-04'` label, not the content. Record the drill as the runbook's proof; the runbook itself (load BG-04's approved file → clear placeholders → re-run the golden gate → revert recipe) lands in this FP's folder, and the drill is asserted by `scripts/verify-fp03-step7.py`.
2. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §3.3 (`source` column), §6.2 (as-built readings: forced-emotion conf semantics; energy = turn input, chat turns pass none; the stage-2 D7-on-embed-failure ordering), §11 (four keys, **and the new `confidence_bands` values if the calibration moved them**); GLOSSARY §11 (exemplars row), §13 (dev-smoke action list + `seed-exemplars` / `clear-exemplars` / `match-exemplars` / `classify` / `eval-classifier`), **§16** (`classifier_mode` and the other three keys — §16 is the config-key registry; §15 is field/output identifiers), and a one-line `docs/adr/decisions2.md` **D4 amendment** recording the band move (old → new) as the rollback pair; explicitly record that §2.3 / GLOSSARY §12 are untouched — FP-03 adds zero job types.
3. `docs/feature-prds/FP-03/FP-03-ACCEPTANCE.md`: AC-1–AC-10 pass/fail each, with evidence links; AC-5 recorded under the FR-12/FR-13 reading; AC-8 via the drill.
4. Secret scan + AGENTS.md §9 checklist; final PR cites TECH-SPEC §3.3, §5.1, §6.1–6.4, §11; D5, D7, D19; FP-03 §9.

**Verify** (`scripts/verify-fp03-step7.py`, automated): every AC marked with evidence; the BG-04 drill round-trips (baseline → `source='BG-04'` shifts those labels' classification → clear + re-seed → baseline restored); write-back diffs present; FP-02 suite green under both modes; repo clean.

**OWNER MANUAL:** the flip decision — set `classifier_mode='real'` **and apply the approved `confidence_bands` in the same action** (they are one coupled config change; the previous values are the rollback record), exercise live traffic across domains, then prod; record who/when/why (DoD item). **Rollback = flip `classifier_mode` back to `'stub'` and restore both previous band values** — two config writes, no redeploy.
