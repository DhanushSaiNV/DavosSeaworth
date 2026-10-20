# FP-03 — BG-04 Exemplar Hot-Swap Runbook

**Companion to:** `docs/feature-prds/FP-03/FP-03.md` (FR-16, AC-8) · plan `FP-03-PLAN.md` Step 7
**Proof:** `scripts/verify-fp03-step7.py` (the Step 7 drill is this runbook's mechanism proof)
**Content rule:** AGENTS.md §8.4 + the BG-01 amendment — the approved set is **owner-authored**
content; it is never agent-authored, and it is never presented as final until `status='approved'`.

**Status (2026-10-20, revision run):** The first post-swap gate was **RED** (7/12 = 0.583; report
`docs/feature-prds/FP-03/FP-03-GOLDEN-SET-2026-10-20-bg04.md`). The owner then instructed a revision.
`bg04.ts` now carries **233 approved rows** (228 + five targeted additions), `dev-smoke` is deployed,
and the live `exemplars` table currently holds **130 of 233** `BG-04` rows. The paced re-seed stopped
on Gemini's **daily embedding quota** (`HTTP 429` persisted across the retry window), so the revision's
Stage 3 has **not run**. `classifier_mode` is temporarily `stub` so a partial corpus cannot serve
degraded real classifications; resume at `offset=130` when the quota resets, run the gate, then flip
`real` back.

**History (2026-10-20, first post-swap run):** Stage 1 (load the approved set) and Stage 2 (clear
placeholders) executed with the 228-row set; the golden gate scored 7/12 and the owner initially chose
to keep that set and `classifier_mode='real'` live for beta despite the red gate. The revision above
supersedes that content state; the owner decision to treat a red gate as a content task still holds.

---

## What this swaps

The classifier matches a message embedding against the seeded `exemplars` rows (§6.2). The rows
carry a `source` tag; the tag is also the content **slot**:

| Slot | File | Tag | State |
|---|---|---|---|
| Placeholder | `supabase/functions/_shared/dev/placeholderExemplars.ts` | `PLACEHOLDER-DEV` | DRAFT, 228 items, ships with FP-03 |
| BG-04 | `supabase/functions/_shared/content/exemplars/bg04.ts` | `BG-04` | **APPROVED, 233 items (228 + 5 revision rows), live seed 130/233** |

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

- `python scripts/verify-fp03-step6.py --corpus-source BG-04 --report docs/feature-prds/FP-03/FP-03-GOLDEN-SET-2026-10-20-bg04-rev1.md`
  — clear-domain accuracy ≥ 0.90 and energy-override compliance = 100% against the *new* content.
  The gate now expects 233 BG-04 rows (`EXPECTED_TOTALS` in the script); the placeholder slot remains
  228.
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

### Revision (2026-10-20, owner instruction)

The owner instructed a revision of the approved exemplars. Five targeted domain rows were added to
`content/exemplars.csv` and regenerated into `bg04.ts`; the 228 existing texts are unchanged. The set
is now 233 rows (165 domain / 48 emotion / 20 quit_signal), with the five additions concentrated in
the domains the first gate missed:

| Domain | Added text |
|---|---|
| Health | I'm running on four hours of sleep a night and my body feels like it's breaking down. |
| Learning | I'm partway through a statistics course and the lectures still go over my head. |
| Creativity | When I sit down to write, the ideas stay stuck in my head and won't reach the page. |
| Spirituality | I've stopped praying and I no longer feel connected to my faith. |
| Discipline/Habits | I keep staying up until 2 a.m. even after promising myself I'd go to bed early. |

**Live state and blocker:** the revision was deployed and the paced seed began, but Gemini's daily
embedding quota was exhausted (`HTTP 429` across repeated retries), leaving 130 of 233 rows live.
`classifier_mode` was temporarily set to `stub` so the partial corpus cannot produce degraded real
classifications. To resume after the quota resets:

1. Resume with 20-row windows: `?action=seed-exemplars&source=BG-04&offset=130&limit=20`, then
   continue at offsets 150, 170, … 230 with the normal 65 s pacing.
2. Verify 233 `BG-04` rows, zero `PLACEHOLDER-DEV`, and no null embeddings.
3. Run the Stage 3 gate command above.
4. If green, set `classifier_mode='real'`; if red, treat it as a content signal and revise again.

The gate's corpus preflight now refuses to reset a corpus larger than its expected total
(`scripts/_fp03_corpus.py`), the failure that destroyed the first 233-row live copy during the
misconfigured 228-row expected-total run.

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

