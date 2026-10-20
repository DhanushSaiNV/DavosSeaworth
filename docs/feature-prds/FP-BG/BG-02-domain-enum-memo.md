# BG-02 — 16-Domain Enum Decision Memo

| | |
| --- | --- |
| **File** | `docs/feature-prds/FP-BG/BG-02-domain-enum-memo.md` |
| **Package** | BG-02 — 16-domain enum decision memo (FP-BG §3; P0, S) |
| **Decision** | **Option 1 — keep the §3.3 canonical set** (owner, 2026-10-20; see below) |
| **Traces** | TECH-SPECS §3.3 (approved 2026-10-20 — Option 1), §5.3; PRD §2; D17, D19; GLOSSARY §1, §10 |
| **Inputs** | TECH-SPECS §3.3 proposed set · `content/rules.json` (owner corpus, 119 rules / 16 domains) |

> **Owner decision (2026-10-20): Option 1 — keep the §3.3 canonical set.**
> The memo's Option 2 recommendation is **not adopted**. The operative enum is the 16 domains in TECH-SPECS §3.3 / GLOSSARY §1: Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy. BG-02 is closed. BG-03 re-tagged its 120 draft rules to this set on 2026-10-20 (validation clean; six domains remain below the ≥6 floor pending a 24-rule content-authoring pass); BG-04's 228 approved exemplars already use it and are eligible for seeding.

## 1. The decision

PRD §2 fixes the domain count at **16** ("100+ curated rules from 50+ elite historical figures across 16 life domains"). The enum must maximize two properties:

- **Rules-content fit (D17):** domains are the buckets the rules library is authored against. An enum with no content forces thin, fabricated domains; a mismatched enum forces lossy re-bucketing of existing rules.
- **Classifier separability (D19):** the deterministic classifier nearest-matches each message against ~10 exemplars per domain. Overlapping domains produce ambiguous neighbors → wrong rule retrieval → contradictory advice (the PRD §2 ban).

## 2. Inputs

**(a) TECH-SPECS §3.3 proposed set:**
Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy.

**(b) Owner content corpus** (`content/rules.json`, staged by BG-03): **119 rules across exactly 16 owner-defined domains**:

| id | label | rules | | id | label | rules |
| --- | --- | --- | --- | --- | --- | --- |
| `mind` | Mind & Thinking | 10 | | `resilience` | Resilience & Adversity | 7 |
| `mastery` | Mastery & Work | 10 | | `purpose` | Purpose & Legacy | 5 |
| `strategy` | Strategy & Power | 9 | | `spirituality` | Spirituality & Inner Peace | 6 |
| `wealth` | Wealth & Finance | 10 | | `time` | Time & Energy Management | 6 |
| `health` | Body & Health | 7 | | `communication` | Communication & Persuasion | 6 |
| `character` | Character & Virtue | 9 | | `learning` | Learning & Education | 6 |
| `relationships` | Relationships & People | 8 | | `leadership` | Leadership & Influence | 7 |
| `creativity` | Creativity & Innovation | 7 | | `habits` | Habits & Daily Routine | 6 |

## 3. Fit analysis: proposed set vs corpus

| Proposed domain | Corpus coverage |
| --- | --- |
| Finance, Health, Learning, Creativity, Relationships, Spirituality, Communication, Purpose/Legacy | direct single-bucket matches (wealth, health, learning, creativity, relationships, spirituality, communication, purpose) |
| Career | would mash **three** distinct corpus buckets — mastery (10) + strategy (9) + leadership (7) |
| Mental/Emotional | would merge mind (10) + resilience (7) |
| Discipline/Habits | would merge habits (6) + time (6) |
| Family, Social | no corpus bucket — would split relationships (8) into thin slivers |
| **Environment/Home, Recreation** | **zero corpus rules** — domains would exist with no content |
| Fitness | corpus health already covers body/training (7) |

Naming: GLOSSARY §10 requires lowercase `snake_case` enum values. The proposed set's `Mental/Emotional`, `Discipline/Habits`, `Environment/Home`, `Purpose/Legacy` violate it; the corpus ids already comply.

## 4. Named merge/split candidates (per the package card)

**Social vs Relationships → MERGE (one domain: `relationships`).**
- *Content fit:* the corpus has a single "Relationships & People" bucket (8 rules) spanning family, friends, colleagues. Splitting yields two thin domains and forces arbitrary assignment of every interpersonal rule.
- *Separability:* at ~10 exemplars/domain, friend/colleague talk vs partner/family talk are embedding neighbors; a separate `social` set would misfire constantly, routing empathetic relationship rules into social contexts and vice versa — exactly the contradiction PRD §2 bans.
- *Verdict:* merge; family folds into relationships. A future split is a re-seed, not a logic migration.

**Mental/Emotional vs Purpose/Legacy → KEEP SEPARATE.**
- *Semantics:* orthogonal — internal state (mind, resilience: 17 corpus rules) vs meaning/direction (purpose: 5).
- *Separability:* "I'm burned out" (state) vs "what am I building toward" (identity) sit far apart in embedding space; merging would blur the state→emotion→persona link (D19/D8) with identity talk.
- *Verdict:* keep separate — in corpus terms: `mind`, `resilience`, `purpose`.

**Creativity vs Learning → KEEP SEPARATE.**
- *Content fit:* the corpus has both (creativity 7, learning 6); merging only frees a slot that must be refilled by splitting something else.
- *Separability:* making things vs acquiring knowledge — distinct verbs/objects in exemplar space ("ship my side project" vs "finally learn calculus"). Weakest pair on the watchlist, but curable with contrastive exemplars (BG-04).
- *Verdict:* keep separate; flagged as a BG-04 contrastive-exemplar pair.

## 5. Options

**Option 1 — keep the §3.3 proposed set. (SELECTED 2026-10-20.)**
- *Pros:* zero doc churn; conventional dashboard taxonomy (Career/Finance).
- *Cons:* Environment/Home, Recreation, Family, Social start with **zero rules** — BG-03 would have to invent ≥24 rules for domains with no owner material (content invention, the exact failure AGENTS §8.4 guards against); `career` mashes three distinct corpus buckets (hurting rule-retrieval precision); re-bucketing 119 rules is lossy manual work; violates GLOSSARY §10 naming; exemplar seeds for empty domains are guesswork.

**Option 2 — adopt the corpus's 16 domains verbatim (memo recommendation; not adopted).**
- *Pros:* perfect content fit — all 119 rules stay in their authored buckets; ids already lowercase `snake_case` (§10); domains are behaviorally concrete → clean exemplar sets; zero re-bucketing; BG-04 can start immediately.
- *Cons:* dashboard labels less conventional (`wealth` instead of Finance) — cosmetic; adjacent pairs (`mind`↔`learning`, `mastery`↔`strategy`↔`leadership`) need contrastive exemplar curation (BG-04 watchlist); downstream string literals referencing old names need syncing (§7 impact).

**Option 3 — hybrid (rename/merge best-of-both).**
- *Pros:* could polish labels (e.g., `wealth` → Finance) while keeping most content.
- *Cons:* still re-buckets rules, adds churn, and delays the P0 longest-lead items (BG-03/04) for cosmetic gain; every merge/split breaks the 16-count balance the corpus was authored against.

## 6. Recommendation (not adopted)

The memo recommended Option 2. The owner selected **Option 1** on 2026-10-20; this section is retained as the analysis behind the rejected option.

**Option 2 — adopt the corpus domains as the approved enum:**

```
mind, mastery, strategy, wealth, health, character, relationships,
creativity, resilience, purpose, spirituality, time, communication,
learning, leadership, habits
```

Display labels (user-facing): Mind & Thinking · Mastery & Work · Strategy & Power · Wealth & Finance · Body & Health · Character & Virtue · Relationships & People · Creativity & Innovation · Resilience & Adversity · Purpose & Legacy · Spirituality & Inner Peace · Time & Energy Management · Communication & Persuasion · Learning & Education · Leadership & Influence · Habits & Daily Routine.

Content deltas for BG-03: `purpose` has **5 rules** (< 6/domain target) — the Step 5 sweep adds ≥1; corpus total 119 ≥ 100 ✓; the ≥50-distinct-figures check runs at the same sweep. BG-03 also transforms `rules.json` (text/source/detail shape) into the §3.3 row schema (tone, priority, per-row `status`).

## 7. Impact notes (Option 1 as built)

1. **Decision record:** TECH-SPECS §3.3 records the owner's Option 1 pick (2026-10-20) and the canonical list above; GLOSSARY §1/§14 reference the same decision. `_shared/content.ts` `DOMAIN_ENUM` already carries the canonical set.
2. **BG-03 (separate package):** `content/rules.csv` now carries canonical §3.3 labels via `content/rules/domain-map.json` (re-tag completed 2026-10-20; 120 rows, validation clean). Six canonical domains remain below the ≥6 floor — Fitness 3, Health 4, Family 0, Social 3, Environment/Home 1, Recreation 1 — a 24-rule content-authoring gap. Career, Mental/Emotional, and Discipline/Habits each consolidate multiple memo buckets. Owner review/approval is still pending.
3. **D7 fallback:** `General` remains the reserved out-of-enum fallback value (§5.3) — unchanged.
4. **BG-04:** the 228 approved exemplars already use the §3.3 canonical labels, so no re-labeling is needed. Seeding remains BG-01 Step 3 (owner-run). The memo's contrastive pairs remap into the canonical domains (e.g. mastery/strategy/leadership → Career; mind/resilience → Mental/Emotional; habits/time → Discipline/Habits).
5. **Metrics/dashboard (PRD §3.5):** domain→metric mapping unaffected; D17's chip examples ("Finance/Fitness/Career…") remain illustrative decision text, not code.

## 8. Owner action

**Resolved 2026-10-20 — Option 1.** The owner selected the §3.3 canonical set. BG-02 is closed; the Option 2 recommendation above is not adopted. BG-03's re-tag/re-home pass is complete (120 rows, validation clean); the remaining BG-03 step is the 24-rule content gap in six domains plus owner approval. BG-04's 228 approved exemplars are already canonical and are unblocked for seeding.
