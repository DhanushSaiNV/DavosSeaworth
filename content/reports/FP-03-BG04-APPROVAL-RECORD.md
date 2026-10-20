# FP-03 / BG-04 — Exemplar Set Approval Record

**Date:** 2026-10-17
**Artifact under review:** BG-04 draft exemplar set (`exemplars.csv`, 228 rows, `status='draft'`)
**Approver:** Owner-proxy session, on the owner's explicit instruction (owner engaged on mainstream development)
**Deliverable:** `exemplars.csv` (final, 228 rows, `status='approved'`) — replaces the DRAFT stand-in content of `_shared/content/exemplars/bg04.ts` per TECH-SPEC §6.4 (FP-03 Step 7 / FR-16 / AC-8)
**Governing refs:** TECH-SPEC §3.3 (exemplars DDL + domain enum), §6.2–§6.4 (classifier, set sizes, seeding/swaps); FP-03 FR-1/FR-2/FR-3/FR-16, R-4, AC-7/AC-8/AC-9; FP-03-PLAN Step 2 authoring rules; GLOSSARY §11/§14
**Method:** `scripts/approve_bg04_exemplars.py` (mechanical draft findings + 14 compliance gates, all PASS); judgment layer documented below

---

## 1. Verdict

**APPROVED WITH CORRECTIONS — 228/228 rows approved.**

The draft's *content voice* is strong and its *structure* conforms exactly (228 rows; 160/48/20 per set; 24 `(set_kind, label)` pairs; `set_kind` values legal; emotion labels = `config.emotion_labels`; quit labels `quit`/`false_constraint`; zero length violations; zero duplicate texts). The approval could not be a rubber stamp, however, because the draft's **domain taxonomy is off-canonical** — the one defect class FP-03 R-4 names as a STOP — plus a scattering of row-level defects (quit-vocabulary leakage into the emotion set, template texts, near-duplicates, cross-label phrase collisions). All were corrected inside this approval; every disposition is itemized below.

## 2. Headline finding — domain taxonomy off-canonical (R-4)

The draft labels its 16 domain sets: `mind, mastery, strategy, wealth, health, character, relationships, creativity, resilience, purpose, spirituality, time, communication, learning, leadership, habits`.

The §3.3 canonical enum (the one the shipped system actually runs on — the `rules` table is tagged with `Career`/`Fitness`/`Discipline/Habits` today, the placeholder corpus uses §3.3 verbatim, and the golden set was authored against it) is: **Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy**.

- Exact matches (case-insensitive): 6 — communication, creativity, health, learning, relationships, spirituality
- Draft-only labels (no §3.3 counterpart string): 10 — character, habits, leadership, mastery, mind, purpose, resilience, strategy, time, wealth
- Canonical domains with **zero draft coverage**: 10 — Career, Finance, Fitness, Family, Social, Mental/Emotional, Discipline/Habits, Environment/Home, Recreation, Purpose/Legacy

Why this is a stop, not a nitpick: the classifier's domain output feeds stage-3 rule retrieval filtered by domain. A non-canonical label (`mind`) retrieves **zero rules** silently — the R-4 failure mode — and the golden gate's clear-domain cases would crater. No SoT doc sanctions the draft's taxonomy (grep across ULTIMATE-PRD1 / DECISIONS / TECH-SPEC / GLOSSARY / PROGRESS: zero hits for the draft-only labels), and the §3.3 set remained the operative enum pending the BG-02 sign-off (owner decision 2026-10-20: Option 1).

**Disposition:** re-label/re-home all retained rows to §3.3 exact strings; replace off-taxonomy content with canonical-domain content; preserve §6.4 [SPEC] sizing exactly. See §3.

## 3. Row-wise dispositions (every draft row accounted for)

Of the 228 draft rows: **162 approved as-is · 12 approved with revision · 54 dropped** (and 54 new rows authored to fill canonical slots). Check: 162+12+54 = 228.

### 3.1 Domain set (160 rows: 106 retained, 54 dropped, 54 new)

| Final label (§3.3) | Retained from draft | New | Notes |
|---|---|---|---|
| Career | strategy_01, 08, 09 · leadership_01, 02, 05, 09, 10 | 2 | strategy+leadership collapse into Career (20 candidates, 10 slots); 2 new classic-career texts |
| Finance | wealth_01–05, 07–10 | 1 | wealth→Finance re-label; wealth_06 replaced (two-label item) |
| Fitness | health_01, 04, 06, 08, 10 | 5 | health set split Fitness/Health per the §3.3 vocabulary gloss (Fitness = training; Health = sleep/nutrition/medical/stress) |
| Health | health_02, 03, 05, 07, 09 | 5 | — |
| Learning | learning_01–07, 09, 10 | 1 | learning_08 replaced (near-dupe of 06) |
| Creativity | creativity_01–10 | 0 | clean re-label |
| Relationships | relationships_01, 03–08 | 3 | 02/09/10 re-homed to Social (circle/loneliness/inner-circle are Social facets) |
| Family | — | 10 | no draft coverage; all new |
| Social | relationships_02, 09, 10 | 7 | — |
| Mental/Emotional | mind_01, 02, 04, 10 · character_03, 04, 05, 07, 09 · resilience_08 | 0 | mind trimmed to M/E core; character/resilience texts with clear M/E fit salvaged |
| Spirituality | spirituality_01–10 | 0 | clean re-label (09 revised) |
| Discipline/Habits | habits_01–04, 06 · strategy_04 · mastery_01, 02, 05, 10 | 0 | mastery+habits collapse into D/H (20 candidates, 10 slots); strategy_04 (goals→systems) is the most canonical D/H text in the draft |
| Communication | communication_01–08, 10 | 1 | 05 and 07 revised; 09 replaced (near-dupe of 03) |
| Environment/Home | — | 10 | no draft coverage; all new, space-pure texts |
| Recreation | time_04 (revised) | 9 | no draft coverage; time_04 re-homed+reframed |
| Purpose/Legacy | purpose_01–10 | 0 | purpose→Purpose/Legacy string normalization (06 revised) |

Final ids are re-slugged to the canonical labels (`e_domain_career_01` … `e_domain_purpose_legacy_10`); emotion/quit ids are unchanged from the draft.

### 3.2 The 12 revised rows (text fixed in place)

| Draft id | Issue | Final text |
|---|---|---|
| e_emotion_frustrated_04 | "I've tried everything…" shares a 4-gram with quit_05 → false `quit_signal` risk on frustrated venting | I've been at this for weeks and I'm still stuck in the same spot — it's maddening. |
| e_emotion_frustrated_06 | "— I'm done." is verbatim quit_01 language (mechanically flagged) | Every step forward feels like two steps back — I'm at the end of my rope. |
| e_emotion_proud_07 | "I didn't quit." carries the `quit` token in negation — embeddings handle negation poorly | I saw it through when it got hard — that's something to be proud of. |
| e_quit_false_constraint_04 | slash-menu template ("resources/money/connections") | I don't have the money or connections to make this work. |
| e_quit_false_constraint_06 | bracket placeholder ("[external factor]") | I would, but my situation at home makes it impossible. |
| e_domain_communication_05 | opener collided with relationships_01 ("I talk too much") | I fill every silence with words — how do I learn to use quiet as a tool? |
| e_domain_communication_07 | Comm/Learning near-dupe of learning_01 (both Feynman test-understanding); reframed audience-facing | My explanations lose people halfway — how do I make complex ideas land? |
| e_domain_learning_01 | "can't explain it" shared with communication's six-year-old text | I think I understand something until I try to teach it — how do I use teaching to expose the gaps? |
| e_domain_spirituality_09 | "look like in practice" shared with communication_10; "the inner world" shared with spirituality_06 | Everyone says my inner world shapes my outer one — how do I actually live that? |
| e_domain_strategy_08 | "walk away" is quit-set vocabulary | How do I choose which battles are worth fighting and which to let go of? |
| e_domain_purpose_06 | garbled grammar ("the work obsession outlasts") | What would I still do unpaid — how do I find the work I'd keep doing even without a paycheck? |
| e_domain_time_04 (→ Recreation) | re-homed from Time; reframed from productivity to leisure/restoration | Rest feels like laziness — how do I give myself permission to actually recharge? |

### 3.3 The 54 dropped rows (grouped reasons)

- **No canonical home (23):** resilience_01–07, 09, 10 (no §3.3 Resilience domain; _08 salvaged to M/E) · time_01–03, 05–10 (no Time domain; _04 salvaged to Recreation; _08 additionally collided with habits_03 via "win the morning") · character_01, 02, 06, 08, 10 (no Character domain; _06 also a Social/Relationships two-label risk)
- **Draft-label collapse surplus (22):** strategy_02, 03, 05, 06, 07, 10 and leadership_03, 04, 06, 07, 08 (20 candidates for Career's 10 slots; leadership_06 was additionally a near-dupe of leadership_10) · habits_05, 07, 08, 09, 10 and mastery_03, 04, 06, 07, 08, 09 (20 candidates for Discipline/Habits' 10 slots; 05≈10 and 06≈09 were internal near-dupes)
- **Replaced for two-label/near-dupe defects (3):** wealth_06 (Relationships vocabulary in a Finance slot) · learning_08 (near-dupe of learning_06) · communication_09 (near-dupe of communication_03)
- **Mind set trimmed to M/E core (6):** mind_03, 05, 07, 08, 09 (Learning-borderline cognition texts) and mind_06 (retention — cross-label with learning_07)

### 3.4 The 54 new rows (authored in the draft's voice, first-person, one idea each)

- **Career (2):** stuck-in-a-draining-role / proving readiness for more responsibility
- **Finance (1):** lifestyle creep absorbing raises
- **Fitness (5):** gym-membership consistency / starting strength training / cardio from zero / recovery & rest days / judging progress
- **Health (5):** preventive care / afternoon energy crashes / constant sickness / sleep hygiene vs screens / rebuilding basic eating
- **Learning (1):** cramming vs spaced practice
- **Relationships (3):** same-fight loop / rebuilding trust / roommates-closeness
- **Family (10):** parenting presence · aging parents · family boundaries · sibling conflict · work vs family time · inherited patterns · parenting alignment · distance & guilt · draining gatherings · screens at home
- **Social (7):** adult friendships · small talk · canceling plans/isolation · keeping friendships alive · belonging · surface friendships · rebuilding in a new city
- **Communication (1):** feedback that lands without defensiveness
- **Environment/Home (10):** decluttering overwhelm · bed/office separation · deep-work corner · phone home screen · home-as-support · renting investment · re-cluttering cycle · energy-draining home · personal space in a shared home · home vs storage
- **Recreation (9):** return of play · weekend screens · hobby revival without professionalizing · vacation protection · no hobby at all · taking fun seriously · energizing vs numbing free time · recovering joy · "someday" procrastination

### 3.5 Emotion (48) and quit_signal (20) sets

- **Emotion, 6 × 8:** 45 approved as-is; 3 revised (§3.2). The set already follows the emotion-forward / minimal-domain-nouns rule well.
- **quit, 10:** all approved as-is — short, direct, varied resignation phrasings.
- **false_constraint, 10:** 8 as-is; 2 revised (templates, §3.2).

## 4. Compliance evidence (script-verified, 14/14 PASS)

1. Total rows = 228; set sizes 160/48/20 (§6.4 [SPEC])
2. 16 domain labels are the §3.3 exact strings (slashes included); 10 per domain
3. 6 emotion labels = `config.emotion_labels`; 8 per emotion
4. quit 10 + false_constraint 10; 24 `(set_kind, label)` pairs — the `match_exemplars` full-seed shape
5. 228 distinct texts; all 20–112 chars (within 5–400)
6. No bracket/slash template text; all rows `status='approved'`
7. Quit vocabulary confined to the quit_signal set (no false-`quit_signal` lexical leakage)
8. **Zero** cross-label distinctive-3-gram collisions within any set (scaffold phrases like "how do I" excluded; only content-bearing phrases count — the check that caught "win the morning", "tried everything and", "people endure anything" in the draft)

Advisories (accepted, not defects): 3 within-label shared-vocabulary pairs (Family/Environment texts sharing their own domain's signature nouns — harmless, argmax is per label); 12 rows in user-plausible impersonal register ("Every day feels like climbing a mountain with no summit.") — deliberate variety per the Step-2 "varied length/register" rule.

## 5. Swap-time checks (repo-side — run when landing, not runnable in this workspace)

1. **Disjointness greps:** final texts vs `_shared/dev/goldenSet.ts` and `_shared/dev/placeholderExemplars.ts` (authoring rule; the verify-step6 leakage grep covers this).
2. **Land the set:** replace `_shared/content/exemplars/bg04.ts` content with this CSV's rows (`source='BG-04'`, `status='approved'`), then follow `docs/feature-prds/FP-03/FP-03-BG04-SWAP-RUNBOOK.md`: clear placeholder rows → `seed-exemplars&source=BG-04` (paced windows via `scripts/_fp03_corpus.py`, ~23% of daily embedding quota) → verify 233 embedded rows after the 2026-10-20 revision (228 before it).
3. **Re-run the golden gate** (`scripts/verify-fp03-step6.py --corpus-source BG-04`): clear-domain ≥ 0.90 now evaluates the approved set; the calibration histograms are the flip's evidence base.
4. **Classifier flip** (`classifier_mode='real'`) remains the Step-7 OWNER MANUAL decision, unchanged.

## 6. Owner decisions and open items (recorded, not assumed)

1. **BG-02 enum sign-off: decided 2026-10-20 — Option 1.** The owner ratified §3.3 canonical; the memo's Option 2 recommendation is not adopted. This approval's §3.3 treatment is final. BG-03's re-tag/re-home pass and 24-rule gap fill completed 2026-10-20 (144 rows, all 16 domains ≥6, validation clean), and owner approval of the rules library is still pending. The 106 retained draft texts are itemized above (§3.1) so the rejected variant remains recoverable.
2. **Career coverage skews leadership/strategy** (draft-derived). A future content pass adding promotion/career-change/boss-management facets is a data-only swap — cheap to do once BG-04 iterates.
3. **Re-run `scripts/approve_bg04_exemplars.py` on any future BG-04 iteration** — the quit-vocabulary and collision gates catch in seconds what took this review hours.

## 7. Revision of 2026-10-20 (owner instruction)

The first post-swap golden gate scored **7/12** clear-domain. The owner instructed: *"revise the
approved exemplars."* The revision is additive and preserves all 228 previously approved texts:

| id | label | added text | why |
|---|---|---|---|
| `e_domain_health_11` | Health | I'm running on four hours of sleep a night and my body feels like it's breaking down. | The clear Health case was losing to Mental/Emotional (0.8284 vs 0.8128). |
| `e_domain_learning_11` | Learning | I'm partway through a statistics course and the lectures still go over my head. | The clear Learning case was losing to Discipline/Habits (0.7946 vs 0.7755). |
| `e_domain_creativity_11` | Creativity | When I sit down to write, the ideas stay stuck in my head and won't reach the page. | The clear Creativity case was losing to Communication (0.8537 vs 0.8247). |
| `e_domain_spirituality_11` | Spirituality | I've stopped praying and I no longer feel connected to my faith. | The clear Spirituality case was losing to Mental/Emotional. |
| `e_domain_discipline_habits_11` | Discipline/Habits | I keep staying up until 2 a.m. even after promising myself I'd go to bed early. | The clear Discipline/Habits case was losing to Mental/Emotional. |

**Set size:** 233 rows — 165 domain (16 × 10 + five targeted), 48 emotion, 20 quit_signal. All rows
remain `status='approved'`; `content/validate.ts` passes 233/233; `bg04.ts` was regenerated from the
CSV with no other text changes.

**Validation status:** the revision is deployed in `dev-smoke`, but the live paced seed stopped at
**130/233** when Gemini's daily embedding quota returned HTTP 429 across the retry window. The
`classifier_mode='stub'` safety rollback is active until the remaining windows can be seeded. The
revision's golden gate is therefore **not yet run**; resume at `offset=130` in 20-row windows (150, 170, … 230)
when the quota resets, verify 233 rows, and run the Stage 3 gate before treating the revision as accepted.
