# BG-03 — Rules Library Working Directory

**Status:** DRAFT scaffold (zero content — Step 1) · **Package:** FP-BG BG-03 · **Governing refs:** PRD §2 (100+ rules, 50+ figures, 16 domains); D17; TECH-SPECS §3.3; AGENTS §8.4; BG-02 decision memo (approved enum).

## What lives here

| File | Role |
| --- | --- |
| `STYLE-GUIDE.md` | Authoring rules: voice, attribution, tone rubric, priority bands, DRAFT discipline |
| `{domain}.json` ×16 | Per-domain working files — authoring **decisions only** (tone, priority, status) + agent-authored `added[]` rules |
| `../assemble.ts` | Joins decisions with the frozen corpus → `content/rules.csv` (§3.3 schema) |
| `../validate.ts` | Hard validation gate (BG-01 Step 1) — schema, enums, priority range, near-duplicate detection |

## Transform design (why decisions-only files)

The owner corpus `content/rules.json` is **frozen** (committed 8d04f2c). Rule `text`/`source`/`detail` are read **verbatim** from it at assembly time — never hand-copied — so authoring cannot introduce transcription drift into owner content. Each `{domain}.json` carries:

- `decisions[i]` — `{tone, priority}` (optional per-rule `status`) for corpus rule `i` **in corpus order** (index-joined; `assemble.ts` asserts count + label match)
- `added[]` — agent-authored rules (BG-03 Step 5 backfills the `purpose` gap), each `{text, source_figure, tone, priority}`
- `status` — file-level batch status (`draft` until owner approval)

Ids are assigned by assembly: `r_{domain}_{NN}` in enum-then-corpus order, continuing through `added[]`.

## Distribution plan (corpus + 1 addition = 120 rules)

| # | Domain | Corpus | Added | Target | Batch |
| --- | --- | --- | --- | --- | --- |
| 1 | mind | 10 | — | 10 | Step 2 |
| 2 | mastery | 10 | — | 10 | Step 2 |
| 3 | strategy | 9 | — | 9 | Step 2 |
| 4 | wealth | 10 | — | 10 | Step 2 |
| 5 | health | 7 | — | 7 | Step 2 |
| 6 | character | 9 | — | 9 | Step 2 |
| 7 | relationships | 8 | — | 8 | Step 3 |
| 8 | creativity | 7 | — | 7 | Step 3 |
| 9 | resilience | 7 | — | 7 | Step 3 |
| 10 | purpose | 5 | **+1** | 6 | Step 3 |
| 11 | spirituality | 6 | — | 6 | Step 3 |
| 12 | time | 6 | — | 6 | Step 3 |
| 13 | communication | 6 | — | 6 | Step 4 |
| 14 | learning | 6 | — | 6 | Step 4 |
| 15 | leadership | 7 | — | 7 | Step 4 |
| 16 | habits | 6 | — | 6 | Step 4 |
| | **Total** | **119** | **+1** | **120** | |

- Every domain ≥ 6 rules ✓ (the `purpose` gap is closed by one agent-authored DRAFT rule in Step 3; flagged in the BG-02 memo).
- ≥ 50 distinct figures: verified at the Step 5 sweep (corpus sources are multi-figure; the sweep counts comma-split names and flags generic non-figure entries).
- **Deviation from plan sizing:** FP-BG-PLAN sized batches ~40/35/30 for original authoring; with the frozen corpus the batches chunk the transform in approved-enum order (55 / 40 / 25). Counts, not batch sizes, are the binding targets.

## Assembly gates (per batch)

1. `deno run --allow-read --allow-write content/assemble.ts` → writes `content/rules.csv`
2. `deno run --allow-read content/validate.ts` → must be clean
3. Commit with per-domain counts in the message; **zero rows seeded** (seeding is BG-01 Step 3, owner-gated)
