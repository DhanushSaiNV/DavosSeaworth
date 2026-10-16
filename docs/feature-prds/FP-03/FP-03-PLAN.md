# FP-03-PLAN.md — Build Plan: Real Classifier (Embedding-Similarity)

**Companion to:** `docs/feature-prds/FP-03.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. Config keys introduced dev-only are still registry entries, marked `dev-only`. No chat-model calls are added anywhere in this FP — classification is embedding-similarity only (D19).

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-02 foundation) | ⬜ |
| 1 | Exemplar store + config keys | ⬜ |
| 2 | Placeholder exemplars + seed/clear | ⬜ |
| 3 | `exemplar_embed` backfill job | ⬜ |
| 4 | Real classifier (pure) behind the §6.3 contract | ⬜ |
| 5 | Pipeline wiring: shared embed + mode branch | ⬜ |
| 6 | Golden set + eval gate + calibration | ⬜ |
| 7 | BG-04 swap drill, doc write-backs, AC sweep | ⬜ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md` exists with 12/12 pass; (2) `dev-smoke ?action=embed` returns a 768-dim vector (adapter embed path alive); (3) with `llm_force_fail='both'`, `?action=embed` fails cleanly — if embed ignores the fail flag, extending it becomes a Step 3 item (record which); (4) insert a `smoke_test` job → `done` within 2 min (jobs system alive); (5) `_shared/pipeline/classify.ts` stub emits the §6.3 shape — diff the stub's output fields against TECH-SPECS §6.3 and record the field list: it is the contract Step 4 must reproduce exactly; (6) the canonical label lists (16 domains, 6 emotions) are read from TECH-SPECS §6 / D19 when authoring content — never restated in code.

**Verify:** all six green. Any failure → stop, fix FP-02 first; never build the classifier on a broken pipeline.

---

## Step 1 — Exemplar store + config keys

**Agent does:**

1. Migration `0024_classifier_exemplars` (next free slot — renumber if taken): table `classifier_exemplars` — `set_kind` in domain|emotion|quit|false_constraint (check constraint), `label`, `text` (char_length 5–400), `source` in PLACEHOLDER-DEV|BG-04, `status` in draft|approved, `active` default true, `embedding vector(768)`, `embedded_at timestamptz`; unique `(set_kind, label, text)`; RLS enabled with **no** policies — service-role only, invisible to anon/authenticated; partial index on `(set_kind, label) where active`. No vector index at ~228 rows (revisit past ~1k).
2. Same migration, config registry: `classifier_mode` ('stub', dev-only until the Step 6 gate passes), `quit_flag_cutoff` (0.75) [SPEC], `false_constraint_cutoff` (0.75) [SPEC], `energy_exhausted_max` (3) [SPEC], `energy_determined_min` (8) [SPEC], `exemplar_embed_batch` (50) [SPEC]. Tier boundaries are **not** new keys — stage 4's existing `confidence_bands` stays the single source (D4).
3. Write-backs in this commit: TECH-SPECS §3 (table) + §11 registry (six keys, dev-only marker on `classifier_mode`).

**Verify:** migration applies clean; `pg_class.relrowsecurity` true and zero `pg_policies` rows for the table; a select via anon/authenticated key returns nothing, service role returns rows; the six keys present with `classifier_mode='stub'`.

**Commit refs:** TECH-SPECS §3, §6, §11; D19; FP-03 FR-1, FR-2 (partial).

---

## Step 2 — Placeholder exemplars + seed/clear

**Agent does:**

1. Author `content/classifier-exemplars/placeholder.json` — DRAFT content per AGENTS.md §8.4: ~228 items (16 domains × 10, 6 emotions × 8, quit × 10, false-constraint × 10). Labels copied verbatim from the §6 canonical lists. First-person user voice; one idea per item; no item that plausibly belongs to two labels (ambiguity is the golden set's job, Step 6); varied length and register within each label; texts kept disjoint from the golden set as an authoring rule, not an afterthought.
2. Extend `dev-smoke`: `?action=seed-exemplars` (reads the content file, upserts on `(set_kind, label, text)`; rows land `source='PLACEHOLDER-DEV'`, `status='draft'`, `embedding` NULL) and `?action=clear-exemplars` (delete `where source='PLACEHOLDER-DEV'` — the one-step removal, rules precedent).

**Verify:** seed → per-set counts 160/48/10/10, all embeddings NULL; seed again → row count unchanged (idempotent); clear → 0 rows; re-seed → 228; anon key reads nothing.

**Commit refs:** TECH-SPECS §6; AGENTS.md §8.4; FP-03 FR-3.

---

## Step 3 — `exemplar_embed` backfill job

**Agent does:**

1. Dispatcher registry (the `llm_retry` pattern): `exemplar_embed` handler — select up to `exemplar_embed_batch` rows (`active`, `embedding is null`, oldest first); embed via `llm.embed` — the same call turn messages use, so exemplars and messages share one model identity and one setting by construction (FR-5); write vectors + `embedded_at` back in one update; unembedded rows remain → handler re-enqueues per the dispatcher's loop semantics, else `done`. Zero eligible rows → `done` immediately (idempotent drain — a second enqueue is a no-op).
2. If Step 0 found embed ignores `llm_force_fail`: extend the adapter so embed honors it with normalized failure kinds like the chat path. Otherwise nothing.
3. Write-backs: TECH-SPECS §2.3 (job type) + GLOSSARY (`exemplar_embed`).

**Verify:** enqueue one job → within 2 ticks zero eligible rows remain (228/228 embedded); adapter logs show ~5 embed calls (batch 50 — quota arithmetic recorded in the worklog); enqueue again → immediate `done`, zero new embed log lines; with `llm_force_fail='both'` and fresh unembedded rows → attempts back off, `dead` at 5, `last_error` populated, embedded count unchanged; restore fail mode, enqueue fresh → completes.

**Commit refs:** TECH-SPECS §2.2–2.3, §4.1; D2, D18; FP-03 FR-4, FR-5. **Passes AC-7.**

---

## Step 4 — Real classifier (pure) behind the §6.3 contract

**Agent does:**

1. `_shared/pipeline/classify.ts`: add `classifyReal({ text, embedding, extraction })` — pure w.r.t. writes. One SQL read: max cosine similarity (`1 - (embedding <=> $vec)`) per `(set_kind, label)` over active embedded exemplars, grouped; then in TS: argmax domain; argmax emotion; energy override from stage 1 (`energy ≤ energy_exhausted_max` → `exhausted`, `≥ energy_determined_min` → `determined`, with a forced marker); `overall_conf = min(domain_conf, emotion_conf)`; `quit_conf`/`false_constraint_conf` vs their cutoffs; return the §6.3 block with the exact field list recorded at Step 0 — anything §6.3 lacks (e.g. the forced-emotion marker) is written back to §6.3 in this commit, never invented silently. Labels are data: no domain/emotion lists in code.
2. Leave `classifyStub` untouched, byte-for-byte — it is the rollback.
3. `dev-smoke ?action=classify&text=…&energy=…` → the real block over the seeded exemplars (real adapter); `&mode=stub` → the stub block, for shape diffing.

**Verify:** a work-domain text and a clearly different-domain text classify differently (qualitative, recorded); `energy=2` → `exhausted` + forced marker regardless of the similarity argmax; `energy=9` → `determined`; a crafted fixture with divergent domain/emotion confidence → `overall_conf` = min; a quit-phrased text → `quit_flag` true; a neutral text → false; stub vs real JSON diff → identical field sets, only values differ.

**Commit refs:** TECH-SPECS §6, §6.3; D4, D19; FP-03 FR-6–FR-10. **Passes AC-3, AC-4 (unit level).**

---

## Step 5 — Pipeline wiring: shared embed + mode branch

**Agent does:**

1. `runPipeline.ts`: hoist the message embedding into stage 1's parallel slot (extract ∥ embed); stage 2 moves after stage 1 — the real classifier consumes `extraction.energy` for the override; stage 3 reuses the same embedding and drops its internal embed call. One embed per turn in both modes — real mode adds zero embed calls vs FP-02.
2. Stage-2 branch: `classifier_mode='real'` → `classifyReal`; `'stub'` → `classifyStub` (untouched). Dev `dev_force` params (domain/emotion/overall_conf) honored in real mode too, gated by `dev_overrides_enabled` (non-prod only).
3. Embed failure → the existing `ProvidersUnavailableError` turn-degrade (FP-02 Step 8), unchanged — no new degrade path. Record the FR-13 reading for the acceptance doc: a classifier-local degraded block is unreachable in practice because stage 3 needs the same embedding, so the turn degrades as a whole and `llm_retry` answers later.
4. Stages 3–4 already consume `classification.domain` / `overall_conf` (FP-02 contract) — no changes beyond the real feed.
5. Structured log line per real classification — `{ts, stage:'classify', mode, domain, emotion, overall_conf, route, latencyMs}`, the `logCall` pattern; it is the FR-17 evidence and the Step 6 calibration feed.

**Verify:** `classifier_mode='real'` + `dev-smoke ?action=pipeline` on a clearly non-Career text → domain ≠ the stub default `'Career'`, rules retrieved for the classified domain, route follows the real confidence; adapter logs show exactly one embed line per turn; boundary drill via dev override — overall_conf 0.75 / 0.749 / 0.55 / 0.549 / 0.40 / 0.399 → auto / options / options / low_question / low_question / fallback; `llm_force_fail='both'` → the FP-02 degrade behaves identically (holding reply + one `llm_retry` job); flip `classifier_mode='stub'` → FP-02 Step 3's force=high/medium/low/fallback verify passes unchanged — rollback proven, no redeploy; `tsc --noEmit` + `jest` clean.

**Commit refs:** TECH-SPECS §5.1, §4.1; D4, D13; FP-03 FR-11–FR-15 (FR-13 as read here), FR-17. **Passes AC-1, AC-2, AC-5 (via the FP-02 degrade path), AC-6, AC-10.**

---

## Step 6 — Golden set + eval gate + calibration

**Agent does:**

1. `content/classifier-exemplars/golden-set.json`: 40 items — 12 clear-domain (distinct domains), 8 ambiguous (two plausible domains each), 8 energy-override (4 low, 4 high), 6 quit, 6 false-constraint. Item = `{id, text, case, expect}`. Texts disjoint from `placeholder.json` — grep-verified, not assumed.
2. `dev-smoke ?action=eval-classifier` (new): runs `classifyReal` over the golden set (real adapter), returns per-case results + summary.
3. `scripts/verify-step6.py`: drives the eval action and gates it — clear-domain accuracy ≥ 0.90; energy-override compliance = 100%; quit / false-constraint precision-recall recorded; tier distribution + per-label confidence histogram printed as calibration evidence. Snapshots and restores `classifier_mode` in a `finally` (the verify-step11 pattern).
4. Archive the report to `docs/eval-reports/FP-03-golden-set-<date>.md`.

**Verify:** `python scripts/verify-step6.py` → gates green (or a documented deviation with a fix plan); leakage grep → zero golden texts present in `classifier_exemplars`; the report file exists with the histogram.

**OWNER MANUAL:** judge the report — sane tier distribution? which labels are weak? Fix exemplars (data) first; a `confidence_bands` move is a D4 product-semantics change and needs a decisions2 entry. Then approve or reject the flip to `'real'`.

**Commit refs:** FP-03 NFR-6. **Passes AC-3 (full), AC-9.**

---

## Step 7 — BG-04 swap drill, doc write-backs, AC sweep

**Agent does:**

1. BG-04 hot-swap drill — proves the swap is data-only, zero code: upsert a mini approved set (2 labels × 2 texts, `source='BG-04'`, `status='approved'`); deactivate the PLACEHOLDER rows for those labels; enqueue `exemplar_embed`; verify via `dev-smoke ?action=classify` that those labels now classify per the new set; reactivate placeholders and delete the drill rows → baseline restored. Record the drill as the runbook's proof.
2. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPECS §3 (table), §6.3 (Step 4 field additions), §2.3 (job type), §11 (six keys), GLOSSARY (exemplar sets, `exemplar_embed`, `classifier_mode`, `classifyReal`), §12 quota note (backfill ~5 embed calls one-time; runtime zero additional).
3. `docs/feature-prds/FP-03/FP-03-ACCEPTANCE.md`: AC-1–AC-10 pass/fail each, with evidence links; AC-5 recorded under the Step 5 FR-13 reading; AC-8 via the drill.
4. Secret scan + AGENTS.md §9 checklist; final PR cites TECH-SPECS §2.3, §3, §5.1, §6, §6.3, §11; D2, D4, D13, D18, D19 (FP-03 §9).

**Verify:** every AC marked with evidence; write-back diffs present; FP-02 suite green under both modes; repo clean.

**OWNER MANUAL:** the flip decision — set `classifier_mode='real'` in dev, exercise live traffic, then prod; record who/when/why (DoD item). Rollback at any time afterward = flip back to `'stub'`, no redeploy.
