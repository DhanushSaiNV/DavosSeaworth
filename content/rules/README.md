# BG-03 — Rules Library Working Directory

**Status:** DRAFT rules library — 144 assembled rows, canonical re-tag + 24-rule gap fill complete (2026-10-20). · **Package:** FP-BG BG-03 · **Governing refs:** PRD §2 (100+ rules, 50+ figures, 16 domains); D17; TECH-SPECS §3.3; AGENTS §8.4; BG-02 decision memo (Option 1).

## What lives here

| File | Role |
| --- | --- |
| `STYLE-GUIDE.md` | Authoring rules: voice, attribution, tone rubric, priority bands, DRAFT discipline |
| `{domain}.json` ×16 | Per-domain working files — authoring **decisions only** (tone, priority, status) + agent-authored `added[]` rules, keyed to the frozen corpus taxonomy |
| `domain-map.json` | BG-03 canonical re-tag map — stable rule id → §3.3 canonical domain (DRAFT) |
| `../assemble.ts` | Joins decisions + canonical map → `content/rules.csv` (§3.3 schema) |
| `../validate.ts` | Hard validation gate (BG-01 Step 1) — schema, enums, priority range, near-duplicate detection |

## Transform design (why decisions-only files)

The owner corpus `content/rules.json` is **frozen** (committed 8d04f2c). Rule `text`/`source`/`detail` are read **verbatim** from it at assembly time — never hand-copied — so authoring cannot introduce transcription drift into owner content. Each `{domain}.json` carries:

- `decisions[i]` — `{tone, priority}` (optional per-rule `status`) for corpus rule `i` **in corpus order** (index-joined; `assemble.ts` asserts count + label match)
- `added[]` — agent-authored rules (`purpose_06` plus the 24 gap-fill rules in the `health`, `relationships`, `habits`, and `time` files), each `{text, source_figure, tone, priority}`
- `status` — file-level batch status (`draft` until owner approval)

`domain-map.json` is the re-tag layer: each assembled rule id (frozen corpus + `added[]`) maps to one canonical §3.3 domain. `assemble.ts` hard-fails if a row is unmapped, if a mapped value is outside the canonical enum, or (on a full assembly) if the map contains an unused id. This keeps the owner corpus immutable while making `rules.csv` canonical.

Ids stay stable: `{corpusDomain}_{NN}` (e.g., `mind_01`), continuing through `added[]`. Re-tagging changes only the output `domain` column; it preserves seed idempotency and makes the mapping auditable.

## Canonical distribution (after 2026-10-20 gap fill)

| # | Canonical domain | Rules | ≥6 target | Gap |
| --- | --- | ---: | ---: | ---: |
| 1 | Career | 16 | 6 | — |
| 2 | Finance | 9 | 6 | — |
| 3 | Fitness | 6 | 6 | — |
| 4 | Health | 6 | 6 | — |
| 5 | Learning | 10 | 6 | — |
| 6 | Creativity | 7 | 6 | — |
| 7 | Relationships | 6 | 6 | — |
| 8 | Family | 6 | 6 | — |
| 9 | Social | 6 | 6 | — |
| 10 | Mental/Emotional | 17 | 6 | — |
| 11 | Spirituality | 7 | 6 | — |
| 12 | Discipline/Habits | 21 | 6 | — |
| 13 | Communication | 9 | 6 | — |
| 14 | Environment/Home | 6 | 6 | — |
| 15 | Recreation | 6 | 6 | — |
| 16 | Purpose/Legacy | 6 | 6 | — |
| | **Total** | **144** | | **0** |

- 146 distinct figure names (comma-split) ≥ 50 ✓.
- All 16 domains meet the ≥6 floor. The 24-rule gap was filled on 2026-10-20 by DRAFT additions: Fitness 3, Health 2, Family 6, Social 3, Environment/Home 5, Recreation 5.
- Two editorial corrections were applied to the generated set before assembly: the preventive-care rule no longer overclaims that most conditions are caught only by routine checks, and the duplicated unstructured-time recreation rule was replaced with a weekly-rest rule. The Family work-boundary rule remains `aggressive` per owner instruction.
- The canonical domains Family, Social, Environment/Home, and Recreation had no dedicated corpus bucket; the re-tag re-homed adjacent rules and the gap fill attached new DRAFT rules to adjacent working files, then mapped them through `domain-map.json` rather than manufacturing coverage in the frozen corpus.

## Assembly gates (per batch)

1. `deno run --allow-read --allow-write content/assemble.ts` → writes `content/rules.csv`; domain-map coverage is asserted.
2. `deno run --allow-read content/validate.ts` → must be clean.
3. Commit with per-domain counts in the message; **zero rows seeded** (seeding is BG-01 Step 3, owner-gated).
