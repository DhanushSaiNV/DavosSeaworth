# BG-04 Exemplar Cross-Set Audit — 2026-10-17

> **SUPERSEDED (2026-10-17):** this audit covers the original DRAFT set (BG-02 memo taxonomy). The owner's approval review corrected the set to the §3.3 canonical taxonomy — final content and per-row dispositions live in `content/reports/FP-03-BG04-APPROVAL-RECORD.md` (same directory). Kept as draft-state evidence.

## Summary
- Total exemplars: 228 (160 domain, 48 emotion, 20 quit_signal)
- Hard duplicate threshold (≥0.85): 0 pairs
- Cross-set leakage threshold (≥0.5): 0 pairs

## Hard Duplicates (must be zero — validator enforces ≥0.85)
NONE — validator clean.

## Cross-Set Leakage Candidates (≥0.5, different set kinds)
NONE — no cross-set leakage above threshold.

## Contrastive Watchlist (from BG-02 memo)
These domain pairs need exemplars to be well-separated in embedding space:
mind↔learning: max Jaccard = 0.29 (worst: e_domain_mind_06 ↔ e_domain_learning_05)
mastery↔strategy: max Jaccard = 0.32 (worst: e_domain_mastery_05 ↔ e_domain_strategy_05)
leadership↔strategy: max Jaccard = 0.24 (worst: e_domain_leadership_04 ↔ e_domain_strategy_02)
resilience↔purpose: max Jaccard = 0.32 (worst: e_domain_resilience_09 ↔ e_domain_purpose_08)

## Status
ALL DRAFT — zero seeding. Approval per AGENTS §8.4 (owner flips status → BG-01 Step 3 seeds).
