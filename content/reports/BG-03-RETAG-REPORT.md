# BG-03 — Rules Library Canonical Re-tag Report

> **DRAFT — not owner-approved.** This report documents a mechanical taxonomy pass over DRAFT content. No rule text, attribution, tone, priority, or status was changed; no rows were seeded.

**Date:** 2026-10-20
**Artifact:** `content/rules.csv` (120 rows, all `status=draft`), `content/rules/domain-map.json`
**Governing refs:** PRD §2; D17; TECH-SPECS §3.3; AGENTS §8.4; BG-02 decision memo (Option 1, 2026-10-20); GLOSSARY §1/§14
**Method:** one-to-one semantic re-tag/re-home of the frozen corpus rule ids via `content/rules/domain-map.json`, applied at assembly by `content/assemble.ts`.

---

## 1. Verdict

**Re-tag complete — validation clean.**

- All 120 draft rules now carry a canonical §3.3 domain.
- The frozen owner corpus (`content/rules.json`) and the per-domain working files were not mutated; only the assembled `domain` column changed.
- Rule ids remain stable (`{corpusDomain}_{NN}`), so the mapping is auditable and future seeding stays idempotent.
- `content/validate.ts` passes: 120 rules OK, 228 exemplars OK, all rules `status=draft`.
- **Zero rules seeded.** Approval and seeding remain owner-gated (BG-01 Step 3).

## 2. Mapping summary

| Source (frozen corpus) | Canonical output | Rows |
| --- | --- | ---: |
| character | Mental/Emotional | 7 |
| character | Relationships | 2 |
| communication | Communication | 6 |
| creativity | Creativity | 7 |
| habits | Discipline/Habits | 5 |
| habits | Environment/Home | 1 |
| health | Fitness | 3 |
| health | Health | 4 |
| leadership | Career | 7 |
| learning | Learning | 6 |
| mastery | Discipline/Habits | 7 |
| mastery | Learning | 2 |
| mastery | Mental/Emotional | 1 |
| mind | Discipline/Habits | 2 |
| mind | Learning | 1 |
| mind | Mental/Emotional | 7 |
| purpose | Career | 1 |
| purpose | Purpose/Legacy | 5 |
| relationships | Communication | 2 |
| relationships | Relationships | 4 |
| relationships | Social | 2 |
| resilience | Career | 1 |
| resilience | Discipline/Habits | 1 |
| resilience | Finance | 1 |
| resilience | Learning | 1 |
| resilience | Mental/Emotional | 2 |
| resilience | Spirituality | 1 |
| spirituality | Spirituality | 6 |
| strategy | Career | 7 |
| strategy | Communication | 1 |
| strategy | Discipline/Habits | 1 |
| time | Discipline/Habits | 5 |
| time | Recreation | 1 |
| wealth | Finance | 8 |
| wealth | Purpose/Legacy | 1 |
| wealth | Social | 1 |
| **Total** | | **120** |

Judgment calls follow the BG-04 approval record's precedents where they exist: mastery/habits execution rules lean Discipline/Habits; mind/character/resilience core rules lean Mental/Emotional; strategy and leadership lean Career; health splits into Fitness and Health. No rule was forced into a domain solely to balance counts.

## 3. Canonical distribution and remaining gap

| Canonical domain | Rules | ≥6 target | Gap |
| --- | ---: | ---: | ---: |
| Career | 16 | 6 | — |
| Finance | 9 | 6 | — |
| Fitness | 3 | 6 | **3** |
| Health | 4 | 6 | **2** |
| Learning | 10 | 6 | — |
| Creativity | 7 | 6 | — |
| Relationships | 6 | 6 | — |
| Family | 0 | 6 | **6** |
| Social | 3 | 6 | **3** |
| Mental/Emotional | 17 | 6 | — |
| Spirituality | 7 | 6 | — |
| Discipline/Habits | 21 | 6 | — |
| Communication | 9 | 6 | — |
| Environment/Home | 1 | 6 | **5** |
| Recreation | 1 | 6 | **5** |
| Purpose/Legacy | 6 | 6 | — |
| **Total** | **120** | | **24** |

Six domains remain below the floor: Fitness (3), Health (4), Family (0), Social (3), Environment/Home (1), Recreation (1). The 24-rule gap is the content-invention cost the BG-02 memo flagged for Option 1. **No new rules were authored in this re-tag**; filling those domains is a separate DRAFT authoring pass followed by owner review.

Other distribution checks:

- 107 distinct figure names (comma-split) ≥ 50.
- 120 rows ≥ 100.
- Tones and priorities are unchanged from the approved-shape draft.
- All rows remain `status=draft`.

## 4. Verification

Commands run from the repository root:

```text
deno check content/assemble.ts
→ Check content/assemble.ts

deno run --allow-read content/assemble.ts --dry-run
→ 120 rows; canonical counts above; 107 distinct figure names

deno run --allow-read --allow-write content/assemble.ts
→ Wrote content/rules.csv (120 rows)

deno run --allow-read content/validate.ts
→ content/rules.csv: OK (120 row(s))
→ content/exemplars.csv: OK (228 row(s))
→ Validation PASSED — all rows valid (status: draft=120, approved=228)
```

Before/after comparison confirmed no changes outside the `domain` column: ids, text, source figures, tones, priorities, and statuses are byte-for-byte equivalent at the field level.

Negative-path checks on a temporary copy of `content/`:

```text
missing map key       → exit 1: domain-map.json is missing a mapping for "mind_01"
non-canonical value   → exit 1: "mind_01" has domain "Bogus" outside the BG-02 canonical enum
unused map key        → exit 1: unused mapping(s): unused_99
```

## 5. Remaining steps

1. **Author the 24-rule gap** in the six short canonical domains as `status=draft` content (Family, Fitness, Health, Social, Environment/Home, Recreation), then rerun `assemble.ts` and `validate.ts`. This is content work, not taxonomy work.
2. **Owner review/approval** of the DRAFT rules (status flip).
3. **Seed** approved rules only, via BG-01 Step 3 (`content-seed`), never inside BG-03.
