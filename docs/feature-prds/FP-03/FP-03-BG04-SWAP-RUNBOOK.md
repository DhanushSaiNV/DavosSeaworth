# FP-03 — BG-04 Exemplar Hot-Swap Runbook

**Companion to:** `docs/feature-prds/FP-03/FP-03.md` (FR-16, AC-8) · plan `FP-03-PLAN.md` Step 7
**Proof:** `scripts/verify-fp03-step7.py` (the Step 7 drill is this runbook's mechanism proof)
**Content rule:** AGENTS.md §8.4 + the BG-01 amendment — the approved set is **owner-authored**
content; it is never agent-authored, and it is never presented as final until `status='approved'`.

**Status (2026-10-20, post-approval run):** Stage 1 (load the approved set) and Stage 2 (clear
placeholders) are **executed**: `bg04.ts` carries the 228 approved rows, `dev-smoke` is deployed,
and the live `exemplars` table holds 228 `BG-04` rows with zero `PLACEHOLDER-DEV` rows. **Stage 3 is
RED:** the golden gate scored **7/12 = 0.583** clear-domain accuracy (threshold 0.90); the report is
`docs/feature-prds/FP-03/FP-03-GOLDEN-SET-2026-10-20-bg04.md`. Per R-2 this is a content signal - the
approved exemplars need revision before the swap can be called accepted. `classifier_mode` is already
`real` (it was already live before this run); the flip remains a separate one-write action.

---

## What this swaps

The classifier matches a message embedding against the seeded `exemplars` rows (§6.2). The rows
carry a `source` tag; the tag is also the content **slot**:

| Slot | File | Tag | State |
|---|---|---|---|
| Placeholder | `supabase/functions/_shared/dev/placeholderExemplars.ts` | `PLACEHOLDER-DEV` | DRAFT, 228 items, ships with FP-03 |
| BG-04 | `supabase/functions/_shared/content/exemplars/bg04.ts` | `BG-04` | **APPROVED, 228 items, seeded live 2026-10-20** |

**Why the slot lives under `supabase/functions/`:** an Edge Function is bundled from the
`supabase/functions` tree only, and this project deploys API-side (no local Docker), so a
repo-root `content/` import would pass every local gate and then fail `supabase functions deploy`.
The BG-01 labelling rule (draft + visible DRAFT label) is what governs the file; its directory is
what makes it deployable.

**Why no code change is needed:** `seed-exemplars` and `clear-exemplars` already accept `&source=`
(Step 7, FR-16), restricted to the two tags above. Replacing the *content* of the `BG-04` file is a
content edit — no classifier, pipeline, RPC or schema code changes, and no migration.

---

## Stage 1 — Load the approved set

1. The owner's approved exemplar content replaces the content of
   `supabase/functions/_shared/content/exemplars/bg04.ts`:
   - `BG04_STATUS = "approved"` (was `"draft"`),
   - the DRAFT label removed,
   - the item array replaced with the signed-off set (sized to §6.4: ~10/domain, 8/emotion,
     10/quit label).
2. Land it as **content** (the BG-01 path): a content migration / content commit, cited in the
   commit message as content, not code (§14 item 10, "content migrations (rules/exemplars)").
3. Redeploy `dev-smoke` (the module is imported by the function, so the bundle changes):
   `supabase functions deploy dev-smoke`.
4. Seed the slot — this embeds every item through the adapter, so it costs one embedding unit per
   item and must be paced exactly like the placeholder seed:
   - `?action=seed-exemplars&source=BG-04` (a bare call seeds one window and clears the slot's
     previous rows first; drive it with `scripts/_fp03_corpus.py`'s pacing pattern for large sets),
   - `?action=seed-exemplars&source=PLACEHOLDER-DEV` must **not** be re-run blindly — see Stage 2.

## Stage 2 — Clear the placeholders

- `?action=clear-exemplars` (defaults to `PLACEHOLDER-DEV`) removes the placeholder rows.
- A re-seed never crosses slots: `seed-exemplars&source=BG-04` deletes only `BG-04` rows and
  `seed-exemplars` deletes only `PLACEHOLDER-DEV` rows.
- Sanity check before the gate: `exemplars` holds the approved set's row count and zero
  `PLACEHOLDER-DEV` rows.
- **Keep `source='PLACEHOLDER-DEV'` recoverable** — the file is still in the repo, so the revert
  below can re-seed it (228 embedding units, ~23% of one day's RPD).

## Stage 3 — Re-run the golden gate

- `python scripts/verify-fp03-step6.py` — clear-domain accuracy ≥ 0.90 and energy-override
  compliance = 100% against the *new* content.
- **Archive the previous report first.** The gate writes
  `docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<local date>.md`, so a re-run on the same date
  overwrites the earlier report — commit or rename it before re-running, or pass `--report`.
- A red gate here is a **content** signal (R-2): fix the exemplars, not the code. A red gate means
  the swap is not done; do not proceed to the flip.

**Gate result (2026-10-20):** **RED - 7/12 (0.583)** clear-domain, **8/8** energy-override,
**5/8** ambiguous in-pair. The five misses were Health -> Mental/Emotional, Learning ->
Discipline/Habits, Creativity -> Communication, Spirituality -> Mental/Emotional, and
Discipline/Habits -> Mental/Emotional. The approved set is live for inspection but the swap is
**not accepted**; revise the exemplar content (owner-approved content change) and re-run the gate
before treating the real classifier as beta-final.

## Stage 4 — Revert (rollback)

Revert in the reverse order, and remember the flip is separate (see below):

1. `?action=clear-exemplars&source=BG-04` — remove the approved rows.
2. `?action=seed-exemplars` (paced, 228 units) — restore the placeholder corpus.
3. Revert the content commit if the approved set must be withdrawn (it is content; no schema
   change was made, so there is nothing to roll back in the database).

The baseline is restored when the golden gate's clear-domain accuracy returns to its pre-swap
value. `scripts/verify-fp03-step7.py` proves this round-trip on the drill fixture at any time.

---

## The flip (separate, owner-only) — approved 2026-10-17

The `classifier_mode` flip is **not** part of the content swap.

**Decision (owner, 2026-10-17): the flip is approved, and the current `confidence_bands` values are
kept.** The Step 6 report proposed no band move (the derived bands were not strictly ordered), so
there is no D4 product change and no `decisions2.md` row. Because the bands did not move, the flip is
**one config write** and the rollback is **one config write** — the plan's "two config writes" pair
described the case where a band move was accepted alongside the flip.

**Order:** run `python scripts/verify-fp03-step7.py` **green before the flip**. The flip puts the real
classifier in front of live traffic; the acceptance gate is what proves the mechanism, and it
snapshots and restores whatever mode it finds, so it is safe either way — but turning the real
classifier on before its gate has ever run green is the wrong sequence.

**Flip — one config write, no redeploy:**

```sql
-- Supabase SQL editor (service role). `value` is jsonb, so the quoted literal is the JSON string.
update config set value = '"real"' where key = 'classifier_mode';

-- verify (expect: real, string):
select key, value, jsonb_typeof(value) from config where key = 'classifier_mode';
```

**Rollback — one config write, no redeploy** (`classifier_mode='stub'`):

```sql
update config set value = '"stub"' where key = 'classifier_mode';
```

The stub is preserved verbatim, so the rollback restores FP-02 behaviour exactly (AC-6). If a band
move is ever accepted later, the same pair applies with a second
`update config set value = '<the new bands JSON>' where key = 'confidence_bands'`, and the previous
JSON is the rollback record (a D4 change with a `decisions2.md` row).

**Log who/when/why** in `PROGRESS.md` (§9 DoD: "the flip decision logged"). The 2026-10-17 decision
is recorded in the acceptance ledger's "Owner decisions" table.

