# FP-05-PLAN.md — Build Plan: Evening Journal Chain, Anchor Plans & JIT Assignment

**Companion to:** `docs/feature-prds/FP-05/FP-05.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **Zero new job types** — §2.3 and GLOSSARY §12 stay at 15: FP-05 *implements* three already-registered types (`journal_extract`, `journal_probe`, `anchor_plan`), bringing the implemented count to seven; the registry text only gains implemented notes. **Zero schema changes** — `journal_entries`, `anchor_plans`, `memory_facts` and `messages` already carry every column FP-05 needs (migration 0007); migration `0028` is four config seeds and nothing else. **The only FP-02 code touched** is the stage-5 prompt context assembly across `_shared/pipeline/runPipeline.ts` and `_shared/pipeline/generate.ts` (Step 6) — `send-message` and `submit-checkin` are untouched and inherit the riders; turns without a plan must build a byte-identical prompt. The content cap **reuses** `chat_max_message_chars` (the FP-04 FR-5 precedent — a journal-specific key is a config-only add if beta outgrows it). Each new contract registers its stub shape **in the same commit** as its validator (the FP-04 Step 3a lesson: selection is by validator identity in `_shared/llm/stubShapes.ts`). Doc write-backs must keep every earlier FP's gate assertions green — re-run the FP-02/03/04 static legs after any TECH-SPEC/GLOSSARY edit (the baseline-fix lesson). FP-05 does **not** depend on `classifier_mode`: the evening generations ride the locked-persona + D7-fallback surface and JIT is prompt context, so both modes behave identically. Migration numbers assume the next free slot after `0027`; renumber if taken (FP-02/03/04 precedent) and write back.

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-04 + BG-10 + dispatcher foundation) | ✅ |
| 1 | Four config keys (migration 0028 — no schema) | ✅ |
| 2 | `submit-journal`: sync ingestion + chain kickoff | ✅ |
| 3 | `journal_extract` handler: contract, facts, gates | ✅ |
| 4 | `journal_probe` handler: targeted follow-up + push | ⬜ |
| 5 | `anchor_plan` handler: plan generation, validation, summary | ⬜ |
| 6 | JIT + day-plan riders in `runPipeline` | ⬜ |
| 7 | Client submit wiring on the journal screen | ⬜ |
| 8 | Live drill, doc write-backs, AC sweep | ⬜ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-04/FP-04-ACCEPTANCE.md` exists and the FP-04 tracker is closed (pending owner drill rows are acceptable — FP-05 builds on the code, not the drill); (2) the 0007 feature tables stand with the §3.4 shapes — `journal_entries` (content, entry_date, vagueness_score numeric, severity S1/S2/S3 check, probed boolean), `anchor_plans` (plan_date, anchors jsonb, unique (user_id, plan_date)), `memory_facts` (fact_type check incl. `journal`, `source_journal_id` FK) — all with own-rows RLS; (3) BG-10 landed on `main`: `lib/journal/strip.ts` (splitBlocks / stripUnsavable / stripSummary) + the journal screen, with the strip suite green; (4) `runPipeline` accepts the optional `energy` param and its stage-5 context assembly is located (the shared surface FP-05 touches); (5) the unprompted-message path is located — `runLockedPersonaReply`, the unprompted-row writer, and the bounded push helper (the `runWatchdog.ts` / `_shared/replies.ts` as-built); (6) `toEvalAnchors` in `_shared/checkin/evalContract.ts` is located — it is the existing consumer whose tolerant input shape FP-05's anchor writer must satisfy; (7) the stub-shape registration mechanism (`_shared/llm/stubShapes.ts`, selection by validator identity) is located; (8) the dispatcher registry and `FAST_JOB_TYPES` are located (§2.2); (9) migration slot `0028` is free; (10) baselines green: jest 21 suites / 326 tests, `tsc --noEmit` 0, `deno check` clean on the entry points, eslint 0 errors (77-warning baseline).

**Verify:** all ten green. Any failure → stop, fix upstream first; never build the chain on a broken dispatcher or a missing strip.

---

## Step 1 — Four config keys (migration 0028 — no schema)

**Agent does:**

1. Migration `0028_journal_chain_fp05`: four config seed inserts (proper jsonb, the 0014 lesson), each with a description: `journal_probe_vagueness_threshold` (0.6 — §7.4 [SPEC], the probe trigger), `journal_probe_persona_severe` (`therapist_empath` — S1/S2 probing tone), `journal_probe_persona_vague` (`mentor_tough` — the PRD §3.4 "aggressive editor" reading for a vague S3), `anchor_plan_persona` (`mentor_tough` — the `intervention_persona` precedent for the unprompted summary row). Nothing else: no table, no column, no index, no RLS, no grant.
2. Write-backs in this commit: TECH-SPEC §11 (four keys); GLOSSARY §16 (four keys).

**Verify:** migration applies clean and re-applies idempotently; `select * from config` returns all four with jsonb values; the two persona values match the §5.3 persona-key enum exactly (gate assert); `information_schema` diff proves zero schema change; the FP-02/03/04 static legs still green after the doc edits.

**Commit refs:** TECH-SPEC §11, §7.4; D14, D16; FP-05 FR-7 (partial), FR-15. **Feeds AC-3, AC-4.**

---

## Step 2 — `submit-journal`: sync ingestion + chain kickoff

**Agent does:**

1. `supabase/functions/submit-journal/` (`index.ts` only — no `config.toml`, `verify_jwt` defaults to true). POST handler: JWT → `auth.uid()`; body validation — `content` a non-empty (post-trim) string capped by `chat_max_message_chars` (fail-closed config read, **key reuse**); `entry_date` when present must parse as a date and is treated as an advisory hint only. The server reads `profiles.timezone` for `auth.uid()` (defaulting to `'UTC'` if null/missing) and canonicalizes the entry date to the **user-local calendar date at submit** via `localDate(timezone, Date.now())` returning canonical `YYYY-MM-DD` (the windowTs-hint precedent — a shifted or replayed hint can never mint a foreign date). Insert `journal_entries` (`user_id`, content verbatim as received — the server never re-strips, D3; canonical `entry_date`); insert one `journal_extract` job (payload `{entry_id}`); respond `{status:'ok', entry_id}`. **Zero provider calls anywhere in the fn** — no embed, no generate (the entry itself is never embedded; §3.4 has no column for it). CORS preflight mirrors `send-message` exactly (ACAO `*` plus `Content-Type, Authorization, apikey, x-client-info` — the FP-02 hotfix; `POST, OPTIONS`).
2. Pure module `_shared/journal/submitValidate.ts` (jest-loadable): cap check, trim-emptiness, date-hint parse, and the local-date canonicalization math (UTC+5:30-safe, the checkinGrid precedent of computing user-local dates from the tz string).
3. Unit tests: the validation table (empty, whitespace-only, oversized, bad date hint, tz edge cases — a 23:30 UTC submit for a UTC+5:30 user lands on tomorrow's local date).
4. `scripts/verify-fp05-step2.py` (the `verify-step11` pattern, `DAVOS_USER_JWT`-gated): submit under any mode → the row (content verbatim, canonical date), the job row (type + payload), `{status:'ok', entry_id}`, **zero** adapter log lines, sub-second latency; oversized → 400; empty → 400; the web preflight returns the CORS headers.

**Verify:** the script green; `tsc --noEmit` + `deno check` + `jest --ci` clean; `git diff` proves `send-message`, `submit-checkin` and the pipeline untouched.

**Commit refs:** TECH-SPEC §7.4, §3.4, §7.10 (CORS), §10.2; D3, D16; FP-05 FR-1, FR-2, FR-3. **Passes AC-1.**

---

## Step 3 — `journal_extract` handler: contract, facts, gates

**Agent does:**

1. `_shared/journal/extractContract.ts` — pure (jest-loadable, the `evalContract` pattern): the §4.3 journal response schema `{insights: [{text}], vagueness_score 0–1, severity S1|S2|S3, openness_delta −5..5, admission_flag}`, its per-call structural validator (bounds: 1–10 insights, 5–500 chars each — [SPEC readings]), and the prompt builder (entry text delimited per §10.5, ignore-embedded-instructions copy, severity criteria from §11 inlined as the judging rubric).
2. `_shared/journal/extract.ts` — the adapter-bound entry through `llm.generate` with that validator (§4.1 — no second provider path); one bounded parse retry (§4.2). Register the canned stub shape in `_shared/llm/stubShapes.ts` **in this commit** (validator identity).
3. `_shared/journal/runChain.ts` — the impure half the dispatcher handler and `dev-smoke` both drive (the `runWatchdog.ts` pattern): load entry + profile; **guard 1** — `vagueness_score is not null` → extraction already ran, skip to the enqueue tail; run the extraction; write `vagueness_score` + `severity` onto the entry **first** (the re-run marker); **guard 2** — facts-presence check on `source_journal_id` → skip the facts write on re-run; else insert one `memory_facts` row per insight (`fact: insight.text`, `fact_type: 'journal'`, `source_journal_id: entry.id`, one batched `llm.embed` over the insight texts, `embed_model` stamp); one structured `[journal-extract]` log line carrying vagueness, severity, insight count, and the **rider fields logged-not-applied** (FR-6 — `trust_score` stays untouched, exactly as every chat-turn extraction has behaved since FP-02); then the gate decisions — probe (FR-7: vagueness ≥ `journal_probe_vagueness_threshold` OR severity ≠ S3 → insert one `journal_probe` job, payload-deduped on `{entry_id}`) and always `anchor_plan` (FR-9, payload-deduped on `{entry_id}`). Failure semantics: a structural failure exhausts its bounded retry inside the call; the handler then fails the job with `last_error` (dispatcher backoff gives fresh attempts — a new sample may conform); a dead job leaves the entry un-extracted (vagueness null) and visible.
4. The `journal_extract` case in the `job-dispatcher` registry — thin: lazy import + delegate to `runChain` (the `llm_retry` precedent for secret isolation). Deliberately **not** added to `FAST_JOB_TYPES` (generation-capable — §2.2's fail-safe default).
5. Unit tests: validator table (each bound, each severity), gate truth table (vague/severe/clear × threshold), guard ordering (marker before facts).
6. `scripts/verify-fp05-step3.py`: stub mode, three fixtures — a vague one (probe job + anchor job), a severe S2 one (probe job + anchor job), a clear S3 one (anchor job, **no** probe job); entry updated (vagueness + severity); facts rows with `fact_type='journal'`, `source_journal_id`, embeddings + `embed_model`; exactly one embed line and one generate line per run; the rider fields present in the `[journal-extract]` log and absent from every table; double-fire (re-claim simulation) writes nothing twice; `llm_force_fail='both'` → job `failed` with attempts incremented, recovers on `'none'`; zero adapter calls on the skip path.

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — no `trust_score`/`trust_events` write anywhere in the diff, `FAST_JOB_TYPES` unchanged, §2.3 and GLOSSARY §12 still at 15 types.

**Commit refs:** TECH-SPEC §7.4, §4.1–4.3, §3.3, §2.2–2.3, §10.5, §11; D5, D16, D20 (logged reading); FP-05 FR-4, FR-5, FR-6, FR-7 (gate half), FR-9 (insert half), FR-16 (extraction shape), FR-17. **Passes AC-2; feeds AC-3, AC-8, AC-9, AC-11.**

---

## Step 4 — `journal_probe` handler: targeted follow-up + push

**Agent does:**

1. `_shared/journal/probeContext.ts` — pure: builds the probe's generation context (entry text delimited, vagueness, severity, the targeted-follow-up instruction keyed to the §11 criteria — S1/S2 supportive and gentle, S3-vague the sharp editor demanding specifics) and selects the persona from config (S1/S2 → `journal_probe_persona_severe`, vague S3 → `journal_probe_persona_vague`).
2. The `journal_probe` case in the dispatcher registry, delegating to `_shared/journal/runChain.ts`'s probe leg (the shared-run pattern): **existing-row pre-check** (an unprompted assistant row in `messages` already carrying `metadata.source='journal_probe'` + `metadata.entry_id=entryId` → done, set `probed=true` on the entry if not already set, write nothing — the `llm_retry` pre-insert lookup precedent); generate the follow-up on the locked-persona + D7-fallback surface (`runLockedPersonaReply` path, General domain — no aggressive rules by construction); write the unprompted assistant row (`reply_to_message_id` NULL, `persona_key: result.persona`, `metadata: { source: 'journal_probe', entry_id: entryId, severity: entry.severity, persona: result.persona, domain: result.domain, rule_ids: result.ruleIds, source_job_id: job.id }` — the `watchdog_window` audit pattern); one **default-priority** Expo push (`expo_push_enabled` gate, 5s bounded await race, deep link `davos://chat` — §8's row; via `sendPush(createAiMessagePushPayload(userId, result.assistantContent, "davos://chat"))`); then update `journal_entries set probed=true where id=entryId` (order matters: the flag lands only after the row exists, so a crash between the two re-runs into the pre-check, never into a skipped probe); one `[journal-probe]` log line. Not in `FAST_JOB_TYPES`.
3. Unit tests: persona selection table; context shape; the ordering invariant (flag after row).
4. `scripts/verify-fp05-step4.py`: vague fixture → persona `journal_probe_persona_vague`; S2 fixture → `journal_probe_persona_severe`; exactly one unprompted row per entry with the right metadata; exactly one default-priority push attempt logged (and none when `expo_push_enabled=false`); `probed` set; a re-claim of the same job writes nothing (pre-check); the probe's generation carries no chips/options (an unprompted row is not a Medium turn — §5.3).

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static assert — no high-priority payload builder on this path (default only, R-3's mitigation).

**Commit refs:** TECH-SPEC §7.4, §8, §11, §5.3 (D7 surface); PRD §3.4; D16; FP-05 FR-7 (handler half), FR-8, FR-17. **Passes AC-3; feeds AC-8, AC-10, AC-11.**

---

## Step 5 — `anchor_plan` handler: plan generation, validation, summary

**Agent does:**

1. `_shared/journal/anchorContract.ts` — pure: the §4.2-anchored schema extended with the plan — `{tactical_analysis, direct_quote, persona, anchors: [{start, end, label, kind}]}`; the deterministic validator (1–12 anchors, kind ∈ the §3.4 five, `start`/`end` as `HH:mm` 24 h user-local with start < end, no pairwise overlaps, label ≤ 80 chars — errors returned as a list the retry prompt can carry); pure calendar-safe date helper `nextDayDate(entryDateStr)` using UTC date math (`Date.UTC(y, m - 1, d + 1)`) so month and year boundaries wrap cleanly without timezone drift; the prompt builder — input = entry content (delimited), extraction output (insights, vagueness, severity), `profiles.routine`, wake/sleep, active habits (status not in cancelled/quit_committed — empty is valid), non-archived metrics (goals — empty is valid), timezone, and tomorrow's date; instructions: hard commitments, deadlines and routines become anchors; free blocks and boredom-relief items are **scheduled by the plan itself** (PRD §3.1); the summary is `direct_quote` in Davos's voice, concise, referencing the anchors; ignore-embedded-instructions copy (§10.5).
2. `_shared/journal/anchor.ts` — adapter-bound: one generate; on validator failure, **one corrected re-output** with the error list in the retry prompt (the §7.9 formula-gate pattern); a second failure → fail-soft: no plan row, one `[anchor-plan]` warning, done. Register the canned stub shape in the same commit.
3. The `anchor_plan` case in the dispatcher registry, delegating to `runChain`'s plan leg: payload dedup; `plan_date = nextDayDate(entry.entry_date)`; **existing-row pre-check** on `messages` (`metadata.source='anchor_plan'` + `metadata.entry_id=entryId` → skip row write); **upsert** `anchor_plans` via `.upsert({ user_id: userId, plan_date: planDate, anchors: plan.anchors }, { onConflict: 'user_id,plan_date' })` — the latest evening's plan wins (a re-journaled night replaces, never duplicates); write the unprompted summary row (`reply_to_message_id` NULL, `persona_key: planPersona`, `metadata: { source: 'anchor_plan', plan_date: planDate, entry_id: entryId, persona: planPersona, source_job_id: job.id }`, persona locked via `anchor_plan_persona`); **no push** (absent from the §8 map — Realtime/next-open delivery); `tactical_analysis` to the `[anchor-plan]` log line only (which also carries the corrected-re-output count); not in `FAST_JOB_TYPES`.
4. Unit tests: the validator table (each kind, boundary times, overlap pairs, count bound, label bound); the corrected-re-output state machine; upsert semantics.
5. `scripts/verify-fp05-step5.py`: a good fixture → plan row for entry_date + 1 with anchors passing the validator, plus the summary row (no push log); a planted malformed-anchors stub → the corrected re-output is consumed (log count 1); a twice-malformed stub → no plan row + warning + job `done`; a second evening for the same plan_date replaces the row (count still 1); `tactical_analysis` in no row; **cross-FP fixture** — feed the written anchors through `toEvalAnchors` and assert a clean mapping (AC-7's seam, proven at the shape level).

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — no push call on this path, no `anchor_plans` writer outside `runChain`.

**Commit refs:** TECH-SPEC §7.2, §3.4, §4.2, §7.9 (gate pattern), §8; PRD §3.1/§4.4; D14, D16; FP-05 FR-9 (handler half), FR-10, FR-11, FR-16 (anchor shape), FR-17. **Passes AC-4; feeds AC-7, AC-8, AC-9.**

---

## Step 6 — JIT + day-plan riders in `runPipeline`

**Agent does:**

1. `_shared/pipeline/dayPlan.ts` — pure (jest-loadable): the tolerant anchors mapper twin (aligned with `toEvalAnchors`' tolerance); `resolveCurrentFreeBlock(anchors, nowMs, timezone)` → converts `nowMs` to user-local time, matches containment in `[toMinutes(start), toMinutes(end))` with start inclusive and end exclusive, and returns the containing anchor of kind `free_block` or `boredom_relief`, else null; and `renderDayPlanPromptContext({ anchors, currentFreeBlock, energy })` → renders the compact anchors block (one line per anchor: time, label, kind), the rescheduling instruction (moves require conversational approval, persona-dependent tone; the plan is authoritative — no calendar mutation exists), and inside a free block, the JIT energy-band instruction (energy 1–3 → low-cognitive task or boredom-relief item; 8–10 → heavy task).
2. The `runPipeline` + `generateReply` integration (touching `_shared/pipeline/runPipeline.ts` and `_shared/pipeline/generate.ts`): when `userId` is present, `runPipeline` queries `profiles` for `(timezone, latest_energy)` (`select timezone, latest_energy from profiles where id = userId`; `opts.energy` takes precedence if passed by caller). If `userId` is absent (dev probe), day-plan loading is skipped. Compute user-local today via `localDate(timezone ?? 'UTC', nowMs)` and query `anchor_plans` for `(user_id, plan_date) = (userId, today)`. If a plan row exists, call `renderDayPlanPromptContext` and pass the resulting string as `dayPlanContext` to `generateReply({ ..., dayPlanContext })`. In `_shared/pipeline/generate.ts`, `GenerateStageInput` accepts optional `dayPlanContext?: string`, and `buildSystemPrompt` appends it when present. Crucially: **no plan → the prompt is byte-identical to FP-04's** (the riders are gated, not reformatted). Both `send-message` and intervention check-in turns inherit this through the shared pipeline — zero changes to either caller (FR-14).
3. Unit tests: resolver table (boundaries, first/last block, non-free kinds ignored, tolerant shapes, overnight-adjacent times); rider gating — a no-plan fixture produces the exact FP-04 prompt string (golden-string test); rider presence/absence per plan/block combination.
4. `scripts/verify-fp05-step6.py`: seed a plan row (service role) → a chat message inside a free block → the stage-5 log/prompt evidence carries `current_free_block` + `latest_energy`; the same message with the plan removed → prompt identical to the FP-04 control turn (assert equality); energy 2 vs 9 fixtures select the right instruction band; the `anchor_plans` row is untouched by every turn (runtime assert); regression legs — `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, and the FP-04 static gate family (all green; the riders changed shared prompt assembly, so all three FPs' evidence must hold).

**Verify:** the script and all three regression legs green; `tsc` + `deno check` + `jest` clean; `git diff` shows exactly two FP-02 files touched (`_shared/pipeline/runPipeline.ts` and `_shared/pipeline/generate.ts`) plus the new pure module.

**Commit refs:** TECH-SPEC §7.2, §5.1; PRD §3.1; D14; FP-05 FR-12, FR-13, FR-14. **Passes AC-5, AC-6 (runtime half), AC-7 (git-diff half).**

---

## Step 7 — Client submit wiring on the journal screen

**Agent does:**

1. `app/(app)/journal.tsx` (BG-10's screen gains its network half): a Submit action — disabled when the editor is empty **or** `stripSummary` reports zero sent blocks (all-flagged → nothing to submit, the preview already shows why); on submit: run BG-10's `stripUnsavable` (unchanged), POST `submit-journal {content: sent text, entry_date: today (hint)}` single-flight (in-flight disables the action — R-4's client half); on `ok` → clear the AsyncStorage draft (`davos_journal_draft`), show the confirmation state (blocks sent, from `stripSummary` — "Davos received N of M blocks; he'll read it tonight and come back with a plan"), and leave the editor clean for tomorrow; on failure → keep the draft, surface the error with a Retry that re-runs the same single-flight path. **No offline queue** — the draft is the store, and a submit is a deliberate action (the sendQueue pattern is deliberately not copied; recorded reading). React Native primitives only (AGENTS §7.1).
2. `lib/journal/submitState.ts` — pure state machine (idle / in-flight / confirmed / failed) + the payload builder, jest-loadable.
3. Unit tests: the state machine (ack clears draft, failure keeps it, all-flagged disables), payload equals `stripSummary`'s sent text (fixture-equivalence — the BG-10 preview test extended to the wire shape, AC-10's client half).
4. Web check: the route renders, the submit posts through the Step 2 CORS surface, the confirmation state shows (a manual or script-assisted web drill; native look-and-feel waits for the Step 8 drill).

**Verify:** `tsc` + jest clean; the web drill records a full submit; static asserts — no `send-message`/`sendQueue` import on the journal path, the strip module untouched (`git diff`).

**Commit refs:** TECH-SPEC §7.4, §9, §10.2; D3; FP-05 FR-18. **Passes AC-10 (payload half), AC-11 (web half).**

---

## Step 8 — Live drill, doc write-backs, AC sweep

**Agent does:**

1. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §7.4 (as-built: chain order, the three guards, the rider-fields-logged-not-applied reading, the cap reuse, the no-dedupe trade-off, fail semantics), §7.2 (as-built: the anchor contract, validation + corrected re-output, upsert semantics, the no-push summary, the JIT riders and their no-plan gating, the rescheduling instruction), §2.3 (three handlers implemented — registry count unchanged at 15), §4.2/§4.3 (the anchor contract's `anchors[]` extension noted beside the eval precedent), §5.1 (stage-5 day-plan riders), §11 (four keys), §13 (the probe push's iOS fallback acknowledgment under item 7); GLOSSARY §2 (evening-chain terms as-built), §13 (`submit-journal` real + the `journal-drill` action), §14 (`journal_probe` / `anchor_plan` join the metadata-source enum), §15 (new identifiers: the contract modules, the resolver, the entry-id metadata anchor), §16 (four keys). Re-run every earlier FP's static leg after the edits (the baseline-fix lesson — a write-back in a later FP is still subject to the earlier FP's gates).
2. `dev-smoke ?action=journal-drill&entry_id=<uuid>` — the fast deterministic drill driving `runChain`'s legs directly (the `watchdog-scan` precedent; dev-gated, never used by prod paths). GLOSSARY §13 write-back.
3. `docs/feature-prds/FP-05/FP-05-ACCEPTANCE.md`: the AC ledger (ids parsed from `FP-05.md` so the two cannot drift), evidence tags (`[script]` / `[measured]` / `[owner-observed]` / `[derived]`), the recorded-readings section (entry-date canonicalization, cap reuse, no server dedupe, rider-fields-logged, anchor `HH:mm` format, no-push summary, default-priority probe push with `davos://chat`, the empty-routine thin-plan acceptance), the write-back ledger, and a re-run recipe.
4. Regression legs all green: `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, the FP-04 static family, plus the FP-05 gate family. Secret scan + AGENTS.md §9 checklist (no new table / RLS / secret / dependency / paid service / job type / `[SPEC]` hardcoded; `trust_score` untouched; RN primitives only on the client half).

**Verify:** every AC marked with evidence (drill-judged rows may sit at ⏳ pending the owner drill — FP-03's AC-8 precedent); write-back diffs present; all regression legs green; repo clean.

**OWNER MANUAL:** the evening drill, then flip the pending rows. **Any platform**: journal a real evening entry (include one deliberately vague block and one deliberately heavy block) → within ~2 min observe the chain: the probe in chat with the right tone per block, the plan row + summary, the facts rows. Then, inside a scheduled free block, send a chat message (and separately answer a check-in) → judge the JIT assignment against the current energy; try to move an anchor → the reply must demand conversational approval. **Web**: the submit + confirmation states. **iOS**: acknowledge the probe's in-thread fallback (no remote push — §13 item 7; fund the program or accept the fallback, a budget decision outside this FP). Record observations in the acceptance doc, including your judgment of probe tone and plan quality (the golden-set precedent: the report is advisory, the config keys are the tuning surface). Also re-check the standing `dev_overrides_enabled` plan — FP-05's drills join its "done" set before it flips to `false` for real beta users.
