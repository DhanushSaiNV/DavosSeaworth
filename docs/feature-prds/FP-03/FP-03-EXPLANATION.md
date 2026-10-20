Below, each step in plain terms. I've **skipped Step 0** — it's a pre-flight audit (does FP-02 exist, is the embed path alive, is the `exemplars` table right, are the migration slots free) and ships no behaviour, so it has no user story.

> **Status (2026-10-17; updated 2026-10-20).** The Step 7 mechanism gate ran **green** on 2026-10-17 - `scripts/verify-fp03-step7.py`, **87 PASS / 0 FAIL / 0 SKIP** (59 static + 28 live). FP-03's mechanism has no outstanding verification; the post-swap content gate is a separate red item. The "Not completed" notes below are updated in place: the flip is **approved**, and the run observed `classifier_mode='real'` already in place (SQL in `FP-03-BG04-SWAP-RUNBOOK.md`), the `confidence_bands` are **kept**, the forced-emotion reading is **settled as spec-literal** (the shipped behaviour), `dev_overrides_enabled` goes to **`false`**, the BG-04 content swap was executed on 2026-10-20 but its post-swap golden gate is **RED** (7/12), so the approved exemplars need revision (BG-02 Option 1), the dormant energy override is **out of scope for FP-03**, and the `FP-03.md` doc defects are fixed. Ledger of record: `FP-03-ACCEPTANCE.md`.

---

## Step 1 — `exemplars.source` + config keys (migration 0024) ✅

**(a) User perspective.** Nothing changes for the user yet — this is a dark ship. The story it enables: Davos must be able to tell its *own placeholder* example texts apart from *real approved coaching* content, so a later swap or cleanup can never delete the wrong thing. The user never sees this; it's why a future content swap can't damage their coaching.

**(b) Technical.** Adds a `source` column to `exemplars` (default `'PLACEHOLDER-DEV'`) — the mirror of `rules.source_figure` — and seeds four `config` keys (`classifier_mode='stub'`, `quit_signal_threshold`, `energy_exhausted_max`, `energy_determined_min`). No other schema change; RLS untouched. **Not completed:** the live app still runs the stub classifier, because `classifier_mode` stays `'stub'` until the flip — which the owner **approved on 2026-10-17** and scripted in the swap runbook (the SQL is given there), so the four keys sit unused only until that one write lands.

**(c) Capability added.** Provenance. Every exemplar row now declares where it came from, which is what makes seeding, clearing and the BG-04 hot swap safe and reversible.

---

## Step 2 — Placeholder exemplars + seed/clear ✅

**(a) User perspective.** Davos now has a library of ~228 worked examples of "what a Fitness message looks like", "what an exhausted message looks like". The story: the user texts *"I skipped the gym again and feel awful"* and Davos has a starting library to compare it against — while every example is clearly labelled a placeholder, never presented as real coaching content.

**(b) Technical.** `_shared/dev/placeholderExemplars.ts` (16 domains × 10, 6 emotions × 8, 10 `quit` + 10 `false_constraint`), plus `dev-smoke ?action=seed-exemplars` / `clear-exemplars`, which embed everything through the provider adapter and stamp `embed_model`. Mid-step the first live run hit Gemini's 100 RPM ceiling, so seeding was rebuilt as a **resumable, paced** window loop (80 items / 65 s). **Not completed:** the content is placeholder only - BG-04's approved set (228 rows) was seeded on 2026-10-20, but its post-swap golden gate was RED (7/12), so the swap is not accepted. A 233-row revision was prepared on owner instruction (five targeted domain rows), but the live seed is blocked at 130/233 by the daily embedding quota; `classifier_mode` is temporarily `stub` until the remaining windows can be seeded and the gate re-run. A full re-seed costs ~233 embedding units (~23% of the daily quota), so it isn't a free operation.

**(c) Capability added.** Davos can now measure "how much does this message look like this domain / this emotion" — the raw material real classification is built from.

---

## Step 3 — `match_exemplars` RPC (migration 0025) ✅

**(a) User perspective.** This is where Davos can answer, for one message: *"which of my example labels does this most look like, and how strongly?"* The story: the user writes about money stress and Davos can score it against `Finance`, `Career`, `Relationships` and pick the closest — instead of guessing from a keyword.

**(b) Technical.** One Postgres function returning per-`(set_kind, label)` max cosine similarity over the seeded vectors, one row per label (~24); `security definer`, pinned `search_path`, grants mirroring `match_rules`; `dev-smoke ?action=match-exemplars` proves the path. **Not completed:** *(closed by Steps 4–5, which wired it into the pipeline)*; the known `match_rules` `search_path`/grant drift is deliberately left untouched.

**(c) Capability added.** A real vector-similarity lookup living inside Supabase — no new service, no new job type — and it's the retrieval primitive the whole classifier rests on.

---

## Step 4 — `classifyReal` behind the §6.3 contract ✅

**(a) User perspective.** Davos now genuinely reads the message. Instead of the always-identical "Career / determined", it can decide *"this is about Sleep, and the person sounds exhausted"*. The story: the user gets coaching aimed at the right part of their life, and the app's tone branches on how sure it is.

**(b) Technical.** `_shared/pipeline/classify.ts` gains `classifyReal`, split into a pure `composeClassification(rows, energy, thresholds)` (argmax per set → energy override → `overall_conf = min(...)` → quit-signal threshold → the exact §6.3 block) and a thin I/O wrapper; `D7Fallback()` when there are zero rows or an RPC error; a jest suite for the pure half; `dev-smoke ?action=classify`. **Not completed:** it **is** wired into the turn now (Step 5); the forced-emotion confidence ships *spec-literal*, which the owner **confirmed on 2026-10-17** (the authoritative reading would make the typed energy number load-bearing, so the check-in flow would have to always collect it — rationale in TECH-SPEC §6.2); the energy override is dormant and **out of scope for FP-03** (the check-in FP threads it); jest structurally cannot cover the RPC/config legs (it can't load `_shared/config.ts`).

**(c) Capability added.** The actual intelligence — a domain, an emotion, a confidence and a quit-signal read out of the user's own words.

---

## Step 5 — Pipeline wiring: mode branch + embed await point ✅

**(a) User perspective.** The classifier becomes part of every real chat turn. The story: the user sends a message and Davos's reply is built from the correct domain's rules in the right tone — and if the embedding service is down, the user still gets a reply instead of silence, and the retry still delivers the real answer.

**(b) Technical.** `runPipeline` becomes `[extract ∥ embed] → classify → persona → retrieve → generate`, choosing `classifyReal` or the stub from `classifier_mode`; the embed's *await point* moves before classification but its *failure semantics* don't (stage 2 returns `D7Fallback()` on `!ok`, so the degrade path carries a non-null `persona`/`domain` and `llm_retry` can still generate); `dev_force` works in both modes; one structured classify log line after stage 4. **Not completed:** the live project's `classifier_mode` is already `'real'` — the flip is **approved** (owner, 2026-10-17), with the SQL in the swap runbook; the energy plumbing has no caller and is **out of scope for FP-03** (the check-in FP threads it); `dev_overrides_enabled` is now set to **`false`** by owner decision.

**(c) Capability added.** The real classifier can be switched on and off with a single config write — and the whole turn degrades safely, which is what makes it safe to ship at all.

---

## Step 6 — Golden set + eval gate + calibration ✅

**(a) User perspective.** Somebody has to check Davos is actually right. The story: 40 real-sounding user messages with known answers — "this is clearly Health", "this could be Career or Finance", "this person is quitting" — are run through the classifier, so we find out before users do.

**(b) Technical.** `_shared/dev/goldenSet.ts` (12 clear / 8 ambiguous / 8 energy / 6 quit / 6 false-constraint, text-disjoint from the exemplars), `dev-smoke ?action=eval-classifier`, and `scripts/verify-fp03-step6.py` gating clear-domain accuracy ≥ 0.90 and energy compliance = 100%, with an archived report. Measured on the 2026-10-17 placeholder corpus: **11/12 clear** (one `Discipline/Habits` → `Health` miss), energy **8/8**. Post-swap (2026-10-20) the approved BG-04 set scored **7/12 clear**; the gate is RED and the exemplars need revision. **Not completed:** the golden set is an agent-authored **DRAFT fixture**, not owner content; the report's `confidence_bands` proposal was **nothing** and the owner **kept the current values** (2026-10-17); all three judgements are now decided — the bands kept, the flip approved, and the forced-emotion reading confirmed as spec-literal; quit metrics are recorded, not gated (by design).

**(c) Capability added.** A regression gate and a measurement loop: accuracy is now a number with a date and a script, and a red gate means "fix the example content", not "guess".

---

## Step 7 - BG-04 swap drill, doc write-backs, AC sweep - *mechanism green; post-swap content gate RED*

**(a) User perspective.** The promise behind all of it: when BG-04's real approved content eventually arrives, Davos can be upgraded to it without shipping a new app or touching code. The story: the examples Davos learns from get better, so the user's answers get better — with a proven way back if they don't.

**(b) Technical.** `&source=` on both seed/clear actions (map whitelist, named-source reset predicate, unknown tag → 400); the `_shared/content/exemplars/bg04.ts` slot; the additive drill (seed 4 `BG-04` rows → the label wins → clear → baseline restored exactly); the `bands.ts` extraction plus its unit suite; the runbook, the acceptance ledger, and the write-backs. **Not completed:** the post-swap content gate is RED (7/12), so the approved exemplars need revision — the credentialed gate ran green on 2026-10-17 (87/0/0), so **AC-8 is ✅** and the tracker row 7 is ✅; the real swap is approved-content-only and BG-04's content was seeded on 2026-10-20 but its post-swap golden gate is **RED** (7/12), so the swap is not accepted; the flip to `'real'` is **approved**, and its rollback is **one** config write because the bands were kept.

**(c) Capability added.** A swappable knowledge base with a tested revert — the operational capability that makes "our coaching content improves over time" safe on a $0 budget.

---

**The arc:** *provenance* (1) → *a library to compare against* (2) → *a similarity lookup* (3) → *a decision* (4) → *that decision inside every live turn* (5) → *proof it's right* (6) → *a safe way to replace the knowledge* (7).
