# FP-03 — BG-04 Exemplar Hot-Swap Runbook

**Companion to:** `docs/feature-prds/FP-03/FP-03.md` (FR-16, AC-8) · plan `FP-03-PLAN.md` Step 7
**Proof:** `scripts/verify-fp03-step7.py` (the Step 7 drill is this runbook's mechanism proof)
**Content rule:** AGENTS.md §8.4 + the BG-01 amendment — the approved set is **owner-authored**
content; it is never agent-authored, and it is never presented as final until `status='approved'`.

---

## What this swaps

The classifier matches a message embedding against the seeded `exemplars` rows (§6.2). The rows
carry a `source` tag; the tag is also the content **slot**:

| Slot | File | Tag | State |
|---|---|---|---|
| Placeholder | `supabase/functions/_shared/dev/placeholderExemplars.ts` | `PLACEHOLDER-DEV` | DRAFT, 228 items, ships with FP-03 |
| BG-04 | `supabase/functions/_shared/content/exemplars/bg04.ts` | `BG-04` | DRAFT stand-in (4 items) until the owner's set lands |

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

## Stage 4 — Revert (rollback)

Revert in the reverse order, and remember the flip is separate (see below):

1. `?action=clear-exemplars&source=BG-04` — remove the approved rows.
2. `?action=seed-exemplars` (paced, 228 units) — restore the placeholder corpus.
3. Revert the content commit if the approved set must be withdrawn (it is content; no schema
   change was made, so there is nothing to roll back in the database).

The baseline is restored when the golden gate's clear-domain accuracy returns to its pre-swap
value. `scripts/verify-fp03-step7.py` proves this round-trip on the drill fixture at any time.

---

## The flip (separate, owner-only)

The `classifier_mode` flip is **not** part of the content swap:

- **Flip:** set `classifier_mode='real'` and, only if the Step 6 report proposed a band move that
  the owner accepted, `confidence_bands` — in the same action.
- **Rollback (two config writes, no redeploy):** `classifier_mode='stub'` + the previous
  `confidence_bands` values. The stub is preserved verbatim, so this restores FP-02 behaviour
  exactly (AC-6).
- Log who/when/why in `PROGRESS.md` (§9 DoD: "the flip decision logged").
