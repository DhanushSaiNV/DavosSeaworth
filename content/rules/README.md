# BG-03 — Rules Library Working Directory

**Status:** DRAFT rules library — 120 assembled rows, canonical re-tag complete (2026-10-20). · **Package:** FP-BG BG-03 · **Governing refs:** PRD §2 (100+ rules, 50+ figures, 16 domains); D17; TECH-SPECS §3.3; AGENTS §8.4; BG-02 decision memo (Option 1).

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
- `added[]` — agent-authored rules (BG-03 Step 5 backfills the `purpose` gap), each `{text, source_figure, tone, priority}`
- `status` — file-level batch status (`draft` until owner approval)

`domain-map.json` is the re-tag layer: each frozen-corpus rule id maps to one canonical §3.3 domain. `assemble.ts` hard-fails if a row is unmapped, if a mapped value is outside the canonical enum, or (on a full assembly) if the map contains an unused id. This keeps the owner corpus immutable while making `rules.csv` canonical.

Ids stay stable: `{corpusDomain}_{NN}` (e.g., `mind_01`), continuing through `added[]`. Re-tagging changes only the output `domain` column; it preserves seed idempotency and makes the mapping auditable.

## Canonical distribution (after 2026-10-20 re-tag)

| # | Canonical domain | Rules | ≥6 target | Gap |
| --- | --- | ---: | ---: | ---: |
| 1 | Career | 16 | 6 | — |
| 2 | Finance | 9 | 6 | — |
| 3 | Fitness | 3 | 6 | **3** |
| 4 | Health | 4 | 6 | **2** |
| 5 | Learning | 10 | 6 | — |
| 6 | Creativity | 7 | 6 | — |
| 7 | Relationships | 6 | 6 | — |
| 8 | Family | 0 | 6 | **6** |
| 9 | Social | 3 | 6 | **3** |
| 10 | Mental/Emotional | 17 | 6 | — |
| 11 | Spirituality | 7 | 6 | — |
| 12 | Discipline/Habits | 21 | 6 | — |
| 13 | Communication | 9 | 6 | — |
| 14 | Environment/Home | 1 | 6 | **5** |
| 15 | Recreation | 1 | 6 | **5** |
| 16 | Purpose/Legacy | 6 | 6 | — |
| | **Total** | **120** | | **24** |

- 107 distinct figure names (comma-split) ≥ 50 ✓.
- Six domains remain below the ≥6 floor: Fitness (3), Health (4), Family (0), Social (3), Environment/Home (1), Recreation (1). Closing the 24-rule gap is a **content-authoring pass**, not a mechanical re-tag; no new rules were invented in the re-tag.
- The canonical domains Family, Social, Environment/Home, and Recreation had no dedicated corpus bucket; the re-tag re-homed a few adjacent rules (Family remains empty) rather than manufacturing coverage.

## Assembly gates (per batch)

1. `deno run --allow-read --allow-write content/assemble.ts` → writes `content/rules.csv`; domain-map coverage is asserted.
2. `deno run --allow-read content/validate.ts` → must be clean.
3. Commit with per-domain counts in the message; **zero rows seeded** (seeding is BG-01 Step 3, owner-gated).
