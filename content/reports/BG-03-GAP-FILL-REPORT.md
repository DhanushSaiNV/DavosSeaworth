# BG-03 — Rules Library 24-Rule Gap Fill Report

> **APPROVED — owner-approved 2026-10-20.** The owner approved all 144 rules for beta, and the library was seeded through BG-01 `content-seed`. See `content/reports/BG-03-RULES-APPROVAL-RECORD.md`.

**Date:** 2026-10-20
**Artifact:** `content/rules.csv` (144 rows, all `status=approved`), `content/rules/domain-map.json` (144 entries), the `added[]` arrays in `content/rules/{health,relationships,habits,time}.json`
**Governing refs:** PRD §2; D17; TECH-SPECS §3.3; AGENTS §8.4; BG-02 decision memo (Option 1); FP-BG BG-03; GLOSSARY §1/§14
**Method:** owner-provided LLM-generated set of 24 rules, integrated as DRAFT `added[]` content, re-homed through `domain-map.json`, and assembled with the existing library. Two editorial corrections were applied before integration; the Family work-boundary rule remains `aggressive` per owner instruction.

---

## 1. Verdict

**24-rule gap filled — validation clean.**

- Added **24 rules**: Fitness 3, Health 2, Family 6, Social 3, Environment/Home 5, Recreation 5.
- Total library is now **144 rows**, all `status=approved`; all **16 canonical domains meet the ≥6 floor**.
- **146 distinct figure names** (comma-split) ≥ 50.
- `content/validate.ts` passes: 144 rules OK, 228 approved exemplars OK.
- **Owner approved all 144 rules on 2026-10-20**, and the approved library was seeded via BG-01 `content-seed` (144 rows with embeddings); the 9 placeholder rules were then cleared.
- The existing 120 rows were not rewritten; the 24 additions are new stable ids continuing each source file's `added[]` sequence.

## 2. Added rows by canonical domain

| Canonical domain | Source working file | New ids | Count |
| --- | --- | --- | ---: |
| Fitness | `health.json` | `health_08`–`health_10` | 3 |
| Health | `health.json` | `health_11`–`health_12` | 2 |
| Family | `relationships.json` | `relationships_09`–`relationships_14` | 6 |
| Social | `relationships.json` | `relationships_15`–`relationships_17` | 3 |
| Environment/Home | `habits.json` | `habits_07`–`habits_11` | 5 |
| Recreation | `time.json` | `time_07`–`time_11` | 5 |
| **Total** | | | **24** |

The source working files stay keyed to the frozen corpus taxonomy; `domain-map.json` is the canonical re-home layer, so the frozen `content/rules.json` corpus was not edited.

## 3. Editorial corrections to the generated set

1. **Health #1 — removed an overclaim.** The generated text said "Most major conditions are caught only by routine checks." It now reads: **"See a doctor for preventive care, not just when something breaks. Early detection expands your options."** Source, tone, and priority are unchanged (`William Osler`, `neutral`, 83).
2. **Recreation #4 — removed a semantic duplicate.** The generated "Protect time that has no agenda..." rule repeated the "not every hour needs a return/accounted for" idea already carried by Recreation #1. It was replaced with: **"Keep one full day each week free of work. Unbroken rest is a discipline, not a reward."** Source `Abraham Joshua Heschel, Seneca`; tone `neutral`; priority 58.
3. **Family #3 — tone retained.** "Set hard limits on work that bleeds into family time..." remains `aggressive` (`Theodore Roosevelt, Dwight Eisenhower`, 74). This is a deliberate owner instruction; it is the one Family rule outside the prompt's empathetic/neutral guidance.

The validator's Jaccard ≥0.85 check would not have caught the Recreation semantic overlap; it was corrected by review, not by the gate.

## 4. Distribution

New 24-row batch:

- Tones: **11 neutral · 9 empathetic · 4 aggressive**
- Priority bands: **2** at 80–90 · **8** at 70–79 · **11** at 55–69 · **3** at 40–54
- Distinct figures in the batch: **45**

Full 144-row library:

- Tones: **90 neutral · 34 aggressive · 20 empathetic**
- Priority bands: **5** at 90–100 · **43** at 75–89 · **86** at 55–74 · **10** at 35–54
- All rows `status=approved`; the library is seeded and live.

## 5. Verification

Commands run from the repository root:

```text
deno check content/assemble.ts
→ clean

deno run --allow-read content/assemble.ts --dry-run
→ 144 rows; all 16 canonical domains ≥6; 146 distinct figure names; approved=144

deno run --allow-read --allow-write content/assemble.ts
→ Wrote content/rules.csv (144 rows)

deno run --allow-read content/validate.ts
→ content/rules.csv: OK (144 row(s))
→ content/exemplars.csv: OK (228 row(s))
→ Validation PASSED — all rows valid (status: approved=144, approved=228)
```

`domain-map.json` coverage: **144 entries for 144 assembled rows** (no unused ids). The diff against the re-tag commit adds the 24 rows and the map entries; it does not modify the existing 120 rule texts.

## 6. Completion status

1. **Owner approval:** complete 2026-10-20 ? all 144 rules approved for beta.
2. **Seeding:** complete ? the approved library was seeded through BG-01 Step 3 `content-seed`; the 9 placeholder rules were cleared.
3. **BG-04 remains separate:** its 228 approved exemplars have their own approval record and activation path.
