# BG-02 — 16-Domain Enum Decision Memo

| | |
| --- | --- |
| **File** | `docs/feature-prds/FP-BG/BG-02-domain-enum-memo.md` |
| **Package** | BG-02 — 16-domain enum decision memo (FP-BG §3; P0, S) |
| **Decision required** | Owner picks the final 16-domain enum in PR review |
| **Traces** | TECH-SPECS §3.3 (proposed set — "requires content sign-off"), §5.3; PRD §2; D17, D19; GLOSSARY §1, §10 |
| **Inputs** | TECH-SPECS §3.3 proposed set · `content/rules.json` (owner corpus, 119 rules / 16 domains) |

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

**Option 1 — keep the §3.3 proposed set.**
- *Pros:* zero doc churn; conventional dashboard taxonomy (Career/Finance).
- *Cons:* Environment/Home, Recreation, Family, Social start with **zero rules** — BG-03 would have to invent ≥24 rules for domains with no owner material (content invention, the exact failure AGENTS §8.4 guards against); `career` mashes three distinct corpus buckets (hurting rule-retrieval precision); re-bucketing 119 rules is lossy manual work; violates GLOSSARY §10 naming; exemplar seeds for empty domains are guesswork.

**Option 2 — adopt the corpus's 16 domains verbatim (recommended).**
- *Pros:* perfect content fit — all 119 rules stay in their authored buckets; ids already lowercase `snake_case` (§10); domains are behaviorally concrete → clean exemplar sets; zero re-bucketing; BG-04 can start immediately.
- *Cons:* dashboard labels less conventional (`wealth` instead of Finance) — cosmetic; adjacent pairs (`mind`↔`learning`, `mastery`↔`strategy`↔`leadership`) need contrastive exemplar curation (BG-04 watchlist); downstream string literals referencing old names need syncing (§7 impact).

**Option 3 — hybrid (rename/merge best-of-both).**
- *Pros:* could polish labels (e.g., `wealth` → Finance) while keeping most content.
- *Cons:* still re-buckets rules, adds churn, and delays the P0 longest-lead items (BG-03/04) for cosmetic gain; every merge/split breaks the 16-count balance the corpus was authored against.

## 6. Recommendation

**Option 2 — adopt the corpus domains as the approved enum:**

```
mind, mastery, strategy, wealth, health, character, relationships,
creativity, resilience, purpose, spirituality, time, communication,
learning, leadership, habits
```

Display labels (user-facing): Mind & Thinking · Mastery & Work · Strategy & Power · Wealth & Finance · Body & Health · Character & Virtue · Relationships & People · Creativity & Innovation · Resilience & Adversity · Purpose & Legacy · Spirituality & Inner Peace · Time & Energy Management · Communication & Persuasion · Learning & Education · Leadership & Influence · Habits & Daily Routine.

Content deltas for BG-03: `purpose` has **5 rules** (< 6/domain target) — the Step 5 sweep adds ≥1; corpus total 119 ≥ 100 ✓; the ≥50-distinct-figures check runs at the same sweep. BG-03 also transforms `rules.json` (text/source/detail shape) into the §3.3 row schema (tone, priority, per-row `status`).

## 7. Impact notes

1. **This PR:** TECH-SPECS §3.3 flips proposed → approved with the list above; §5.3 lockdown accountability-domain examples become (Strategy, Habits + PRD-selected); GLOSSARY §1 + §14 updated; `content/validate.ts` `DOMAIN_ENUM` synced; BG-01 5-row fixtures remapped to approved ids.
2. **Not this PR (ownership):** `_shared/pipeline/classify.ts` `DEFAULT_DOMAIN = "Career"` (mainline FP-03 rewrites the stub anyway); `_shared/dev/placeholderRules.ts` and the `dev-smoke` fixture domains (FP-02-owned, additive-only rule). None break: these are dev fixtures, not approved-enum logic.
3. **D7 fallback:** `General` remains the reserved out-of-enum fallback value (§5.3) — unchanged.
4. **BG-04:** exemplar counts unchanged (16 domains × 10 = 160). Contrastive-exemplar watchlist: `mind`↔`learning`, `mastery`↔`strategy`, `leadership`↔`strategy`, `resilience`↔`purpose`.
5. **Metrics/dashboard (PRD §3.5):** domain→metric mapping unaffected; DECISIONS D17's chip examples ("Finance/Fitness/Career…") remain illustrative decision text, not code.

## 8. Owner action

Pick **Option 1 / 2 / 3** in PR review. Docs in this PR are flipped to Option 2 (the recommendation) and will be amended to whatever the owner picks. On ratification, BG-03/04's dependency turns green.
