# FP-03 Acceptance Checklist

**Generated:** 2026-10-17
**Companion to:** `docs/feature-prds/FP-03/FP-03.md` · build plan `docs/feature-prds/FP-03/FP-03-PLAN.md`
**Status:** **9/10 ACs PASS; AC-8 is ⏳ pending the Step 7 live drill** (the gate is written and its static half is green — the drill needs the `dev-smoke` redeploy). Nothing here is asserted before it is elapsed.

> **How to read the Evidence column.** The tag says *how* the claim was established, not just what was checked.
> **[script]** — an automated check re-runs it from the repo (`scripts/verify-fp03-stepN.py`, `bands.test.ts`, `classify.test.ts`, `goldenSet.test.ts`).
> **[measured]** — a real run against the live project, with the date/commit of record.
> **[owner-observed]** — requires human eyes or a device; cannot be automated.
> **[derived]** — follows from another check rather than being checked directly.
>
> **Status:** ✅ PASS = the evidence has elapsed · ⏳ OWNER = waiting on an owner-side action or a live run.

---

## Acceptance Criteria Results

| AC | Description | Status | Evidence (how) |
|----|-------------|--------|----------------|
| **AC-1** | Real mode: a clearly non-Career message classifies to its own domain, stage 3 retrieves that domain's rules, and the route follows the real confidence; the §6.3 contract test passes unchanged | ✅ PASS | **[script]** `verify-fp03-step5.py` live route drill — with `classifier_mode='real'`, probe texts return the embedding domain (≠ the stub's `Career`), `retrieveRules` runs against that domain, and the route is re-derived from the live `confidence_bands`. **[measured]** 2026-10-17, Step 5 gate. |
| **AC-2** | Tier boundaries: 0.75 / 0.749 / 0.55 / 0.549 / 0.40 / 0.399 → auto / options / options / low_question / low_question / fallback (unit-level; live drill proves each route end-to-end) | ✅ PASS | **[script]** `bands.test.ts` (jest, FP-03 Step 7) asserts the six edges, inclusive boundaries, the range ends, and that `medium_high`/`low_high`/`fallback` gate nothing. **[script]** `verify-fp03-step5.py` proves all four routes live via `dev_force`. This closes the Step 5 gap where the sub-edge numerics had no automated test. |
| **AC-3** | Energy override: energy 2 → `exhausted`, 9 → `determined`, regardless of the embedding argmax; 100% of the golden-set energy subset complies | ✅ PASS | **[script]** `classify.test.ts` (unit: override wins over a higher-confidence argmax). **[measured]** Step 6 golden run — energy subset 8/8 compliant (`FP-03-GOLDEN-SET-2026-10-17.md` §5). |
| **AC-4** | `quit_signal`: a quit-phrased fixture → true at ≥ threshold; a neutral fixture → false | ✅ PASS | **[script]** `classify.test.ts` (unit) + `verify-fp03-step4.py` (live `match-exemplars`). **[measured]** Step 6 — `quit_signal` armed 12/12 on the quit set. |
| **AC-5** | Non-fatal fallback: with exemplars cleared, classify returns the D7 block and a full pipeline turn still generates an inquirer reply | ✅ PASS | **[script]** `verify-fp03-step5.py` live leg (empty corpus → D7 `General`/`inquirer`, turn still generated). Recorded under the FR-12 (D7 block) / FR-13 (embed-failure path) reading. |
| **AC-6** | Rollback: `classifier_mode='stub'` restores FP-02 behaviour with no redeploy | ✅ PASS | **[script]** `verify-fp03-step5.py` flipped to `stub` mid-gate and re-ran the FP-02 tier drill unchanged. The Step 7 gate re-checks the same flip through the pipeline's §6.3 block and runs `verify-step11.py --turns 6 --cleanup` under both modes (live run pending). Two config writes, no redeploy — see the runbook. |
| **AC-7** | Seed idempotency: seed → 228 rows, all embedded + `embed_model` stamped; re-seed → still 228; clear → 0 | ✅ PASS | **[script]** `verify-fp03-step2.py` (live seed / idempotent re-seed / clear → 0, `embed_model` stamped on every row). |
| **AC-8** | BG-04 drill: a mini approved set (2 labels × 2 texts, `source='BG-04'`) changes classification for those labels with no code change; revert restores baseline | ⏳ OWNER | **[script]** `verify-fp03-step7.py` (static half green, 58/0/0) asserts the slot's shape/status/disjointness, the `&source=` whitelist and default on both actions, the named-source reset predicate, and that the slot is reachable only from `dev-smoke`. **[measured]** *pending* — the live round-trip is the Step 7 drill: classify → `seed-exemplars&source=BG-04` (4 rows) → the drill label wins at ≥ 0.99 and beats the baseline → `clear-exemplars&source=BG-04` → the pre-seed label/confidence returns exactly, with 0 `BG-04` rows left. Mechanism + revert documented in `FP-03-BG04-SWAP-RUNBOOK.md`. |
| **AC-9** | Golden gate: clear-domain accuracy ≥ 0.90; report archived at `docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<date>.md` | ✅ PASS | **[measured]** 2026-10-17 (`FP-03-GOLDEN-SET-2026-10-17.md`) — clear-domain **11/12 = 0.917** ≥ 0.90, energy compliance **8/8 = 100%**, ambiguous in-pair 8/8, two identical runs (NFR-3). The one miss is `Discipline/Habits` → `Health` (0.877) — a placeholder-content signal (R-2), not a code bug. **[script]** `verify-fp03-step6.py` re-runs it. |
| **AC-10** | Dev forcer: all four tiers forceable in real mode, non-prod only | ✅ PASS | **[script]** `verify-fp03-step5.py` (`dev_force={tier}` × 4 in real mode) + the gate's assertion that `dev_force` is inert unless `dev_overrides_enabled` is true (a dev-only config key). |

---

## Definition of Done (§9)

| Item | Status | Evidence |
|---|---|---|
| All ACs verified with evidence in `FP-03-ACCEPTANCE.md` | ⏳ OWNER | 9/10 marked; AC-8 waits on the Step 7 live drill (redeploy + gate run). |
| Golden-set report archived; accuracy ≥ 0.90 | ✅ | `FP-03-GOLDEN-SET-2026-10-17.md` — clear-domain 11/12 = 0.917 (one placeholder-content miss: `Discipline/Habits` → `Health`), energy compliance 8/8 = 100%. |
| Merged to `main` via the FP branch flow | ⏳ OWNER | Owner-side (`fp/03-real-classifier`). |
| `classifier_mode` flip decision logged (who/when/why) | ⏳ OWNER | Open — see "Owner-pending" below. The default stays `stub` until the owner decides. |
| BG-04 hot-swap runbook committed (the Step 7 drill is its proof) | ⏳ OWNER | `FP-03-BG04-SWAP-RUNBOOK.md` is committed; its proof — the Step 7 live drill — is pending the redeploy. |
| FP-02 test suite green under both modes (stub preserved verbatim as rollback) | ⏳ OWNER | The stub path is untouched (`bands.ts` is a pure extraction of stage 4's comparison, re-exported by `persona.ts`) and `verify-fp03-step5.py` re-ran the FP-02 tier drill under `stub` live; the Step 7 gate's `verify-step11.py --turns 6 --cleanup` run under each mode is pending. |
| Write-backs landed: TECH-SPEC §3.3, §6.2 (as-built), §11; GLOSSARY §5, §13, §15, §16 | ✅ | §3.3 `source` column + §11 four keys (Step 1); §6.1/§6.2 as-built readings + §6.4 swap paragraph (Step 7); GLOSSARY §5 classifier terms (already present), §13 `dev-smoke` row incl. `&source=`, §15 `classifierMode` + log line (Step 5), §16 keys (Step 1). GLOSSARY §14 additionally gained the missing `exemplars.source` enum row (AGENTS.md §6.6). |
| Confirmed zero new job types — §2.3 registry and GLOSSARY §12 untouched | ✅ | **[script]** Step 7 gate asserts both registries still hold exactly 15 types; nothing in FP-03 inserts a job. |

---

## Owner-pending (not ACs, but they gate the flip)

1. **Forced-emotion confidence** — shipped as the spec-literal reading (the forced label carries its own best similarity). Switching to the authoritative `emotion_conf = 1.0` is a recorded open decision (`FP-03-GOLDEN-SET-2026-10-17.md` §7.1).
2. **`confidence_bands`** — the Step 6 report proposed **nothing** (the derived bands were not strictly ordered), so the default is to keep the current values; keeping them means no D4 amendment row.
3. **The flip** — approve or reject `classifier_mode='real'` on this evidence. Until it is approved the shipped mode stays `stub`.
4. **FP-02 §13 item 8** — `dev_overrides_enabled=true` must be set to `false` before real beta users (after Step 7's forcing is no longer needed).
5. **BG-04 content** — the approved set does not exist yet (gated on the BG-02 enum sign-off); FP-03 ships the labelled `PLACEHOLDER-DEV` corpus and the `BG-04` DRAFT stand-in.

## How to re-run

```powershell
$env:SUPABASE_URL="https://<project>.supabase.co"
$env:SUPABASE_ANON_KEY="<anon-key>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
$env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
$env:DAVOS_USER_JWT="<signed-in-user-jwt>"   # only for the FP-02 harness leg
python scripts/verify-fp03-step7.py          # --static-only for the offline half
                                             # --no-fp02 to skip the two verify-step11.py runs
```

The live half snapshots and restores `classifier_mode`, `llm_stub_mode` and `llm_force_fail` in a
`finally`, and asserts zero `BG-04` rows remain.

**When it is green:** flip AC-8 and the DoD rows above to ✅ (and `FP-03-PLAN.md` tracker row 7
▶→✅). If it fails, the row stays ⏳ — the gate's failure text is the evidence to fix, not to
explain away. The gate deliberately does **not** re-run `verify-fp03-step6.py`'s live half: that
would overwrite `FP-03-GOLDEN-SET-2026-10-17.md`, which is still the owner's unjudged input.
