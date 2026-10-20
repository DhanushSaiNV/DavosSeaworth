# BG-03 — Rules Library Approval Record

**Date:** 2026-10-20
**Artifact under review:** `content/rules.csv` (144 rows, all `status=draft`)
**Approver:** Owner
**Owner instruction (verbatim):** "APPROVED. ALL RULES ARE GOOD TO GO FOR BETA. DO WHAT NEEDS TO BE DONE."
**Deliverable:** `content/rules.csv` (144 rows, all `status=approved`) — the seedable rules library.
**Governing refs:** PRD §2; D17; TECH-SPECS §3.3; AGENTS.md §8.4; FP-BG BG-03; GLOSSARY §1/§14; BG-02 decision memo (Option 1).

---

## 1. Verdict

**APPROVED — 144/144 rules approved.**

- All 144 rows are now `status=approved`; no rule text, attribution, tone, priority, id, or canonical domain changed at approval.
- The owner approved the full library, including the 24 rules added on 2026-10-20 to close the six-domain gap.
- The two editorial corrections requested during review remain in force: Health #1 is the preventive-care phrasing and Recreation #4 is the weekly-rest rule. Family #3 remains `aggressive` per the earlier owner instruction.
- `content/validate.ts` passes with `approved=144` rules and `approved=228` exemplars.

## 2. Approved library shape

| Measure | Value |
| --- | ---: |
| Rules | 144 |
| Canonical domains | 16 |
| Minimum rules per domain | 6 |
| Distinct source figures (comma-split) | 146 |
| Status | `approved=144` |

Per-domain counts:

| Domain | Count |
| --- | ---: |
| Career | 16 |
| Finance | 9 |
| Fitness | 6 |
| Health | 6 |
| Learning | 10 |
| Creativity | 7 |
| Relationships | 6 |
| Family | 6 |
| Social | 6 |
| Mental/Emotional | 17 |
| Spirituality | 7 |
| Discipline/Habits | 21 |
| Communication | 9 |
| Environment/Home | 6 |
| Recreation | 6 |
| Purpose/Legacy | 6 |
| **Total** | **144** |

## 3. Seeding evidence (BG-01 Step 3)

The approved library was seeded through the BG-01 `content-seed` function, with embeddings from the provider adapter and the frozen `gemini-embedding-001@768` identity.

- `content-seed` was deployed with gateway JWT verification off and in-function bearer-token enforcement; `CONTENT_SEED_TOKEN` was set as an Edge Function secret.
- Full-CSV dry run: `total=144`, `approved=144`, `draft=0`, nothing written.
- Live seed was paced in three batches under the Gemini per-minute item quota: `50 + 50 + 44` rows. Every batch returned `HTTP 200`; all inserted rows carry embeddings.
- The 9 `source_figure='PLACEHOLDER-DEV'` rules were removed with `dev-smoke ?action=clear-rules` after the real rows landed.
- Final live state: **144 rules, 144 with embeddings, zero `PLACEHOLDER-DEV` rules.**

## 4. Rollback

The seed is idempotent by deterministic UUID v5 ids derived from the CSV ids. A rollback is `content-seed` `clear` by ids, or the owner may restore the placeholder rules with `dev-smoke ?action=seed-rules` (9 rows, dev-only). The approved CSV remains the source of truth.

## 5. Boundary

This record covers the BG-03 rules library only. The BG-04 exemplar set (228 rows) has its own approval record at `content/reports/FP-03-BG04-APPROVAL-RECORD.md`; its activation is recorded separately.
