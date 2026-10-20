# FP-06-PLAN.md — Build Plan: Memory Extraction & Purge (Chat Long-Term Memory)

**Companion to:** `docs/feature-prds/FP-06/FP-06.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **Zero new job types** — §2.3 and GLOSSARY §12 stay at 15: FP-06 *implements* two already-registered types (`memory_extract`, `purge_memory`), bringing the implemented count to nine; the registry text only gains implemented notes. **No new tables or columns** — `memory_facts` (0006/0007) and `messages.unsavable` (0003) already carry everything FP-06 needs; migration `0029` adds one RPC (`match_facts`), one new HNSW cosine index `idx_memory_facts_embedding` with an idempotent check on `idx_memory_facts_source_message_id`, and two config seeds. **Existing FP-02 touch points** — `send-message`'s fresh-insert branch gains the boundary hook (Step 4) and stage-5 prompt/pipeline wiring (`runPipeline.ts` and `generate.ts`) gains the memory block (Step 5); `submit-checkin`, `submit-journal` and every unprompted-generation path are untouched, and a turn with no facts (or the kill switch off) must build a **byte-identical prompt** to FP-05's. The chunk contract registers its stub shape **in the same commit** as its validator (the FP-04 Step 3a lesson: selection is by validator identity in `_shared/llm/stubShapes.ts`). Purge integrity rests on the validator's provenance rule — a fact whose `source_message_id` is not one of the slice's message ids is a hard reject, never a rewrite. Doc write-backs must keep every earlier FP's gate assertions green — re-run the FP-02/03/04/05 static legs after any TECH-SPEC/GLOSSARY edit (the baseline-fix lesson). FP-06 adds **zero push surface** (nothing notifies), so no §13 amendment is expected. Migration numbers assume the next free slot after `0028` (`0029_memory_fp06.sql`).

**Post-plan addendum (0030, 2026-10-20):** the live security/lifecycle hardening adds `messages.memory_extracted_at` plus three triggers (sync purge on an `unsavable` flip, fact-birth guard, and the backfill); it changes no job type and leaves `0029` as the Step 1 migration. See `FP-06-ACCEPTANCE.md` §6 item 5 and `TECH-SPEC §3.2–3.3/§7.6`.

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-05 + memory_facts + FP-02 surfaces) | ▶ |
| 1 | Migration 0029: `match_facts` RPC, indexes, two config keys | ▶ |
| 2 | The purge loop: `flag-unsavable` fn + `purge_memory` handler | ▶ |
| 3 | `memory_extract` handler: contract, backlog, slices | ▶ |
| 4 | Boundary trigger in `send-message` | ▶ |
| 5 | Retrieval wiring in `runPipeline` | ▶ |
| 6 | Client flag UX in chat | ▶ |
| 7 | Live drill, doc write-backs, AC sweep | ▶ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-05/FP-05-ACCEPTANCE.md` exists and the FP-05 tracker is closed (pending owner drill rows are acceptable — FP-06 builds on the code, not the drill); (2) `memory_facts` stands with the §3.3 shape — `fact` text, `fact_type` check including `chat`, `source_message_id` FK, `source_journal_id` FK, `purged_at`, own-rows RLS — **and** its live index set is read from schema `0006_knowledge.sql` (0006 already seeded `idx_memory_facts_user_id`, `idx_memory_facts_purged_at`, `idx_memory_facts_fact_type`, `idx_memory_facts_source_message_id`, `idx_memory_facts_source_journal_id`; Step 1 adds the deferred HNSW cosine index `idx_memory_facts_embedding` and verifies `source_message_id` b-tree idempotently); (3) `messages.unsavable` and `messages_thread_idx (user_id, created_at desc)` stand; (4) sliding window configuration and context assembly are understood — `config.sliding_window_messages` stands at 8, `generateReply` currently passes active turn's `userText`, and `runExtract.ts` will query the newest `sliding_window_messages` rows (`order by created_at desc limit :sliding_window_messages`) to establish the window cutoff timestamp; (5) `send-message`'s fresh-insert branch is located — the auto-adopt recorder call site is the boundary hook's neighbor, and its dedupe clauses (duplicate/repair/replay/check-in transparency) are read; (6) the `match_exemplars` RPC from migration `0025` is located (security definer, pinned `search_path = public`, grants to `authenticated` + `service_role`, revoked from `public, anon` — the pattern `match_facts` mirrors); (7) the stub-shape registration mechanism (`_shared/llm/stubShapes.ts`, selection by validator identity) is located; (8) the dispatcher registry and `FAST_JOB_TYPES` are located, with `watchdog_checkin`'s membership as the cheap-handler precedent; (9) the shared-run pattern (`_shared/journal/runChain.ts`, `_shared/checkin/runWatchdog.ts`) is located — `memory_extract`'s run module follows it; (10) migration slot `0029` is free; (11) baselines green at their post-FP-05 counts (read from repo): 28 jest suites / 537 tests green, `tsc --noEmit` 0, `deno check` clean on entry points, eslint 0 errors at standing warning baseline.

**Verify:** all eleven green. Any failure → stop, fix upstream first; never build memory on a broken dispatcher or a misread window.

---

## Step 1 — Migration 0029: `match_facts` RPC, indexes, two config keys

**Agent does:**

1. Migration `0029_memory_fp06.sql`: (a) `match_facts(p_user_id uuid, p_query_embedding vector(768), p_top_k int)` — `security definer`, `set search_path = public`, returning table `(id uuid, fact text, fact_type text, similarity double precision)` containing the top-`p_top_k` rows of `memory_facts` for the user with `purged_at is null and embedding is not null` ordered by `embedding <=> p_query_embedding` (all fact types compete, `similarity = 1 - (embedding <=> p_query_embedding)`), **unioned with** every unpurged `fact_type='baseline'` row for the user (similarity-irrelevant, similarity set to 1.0 or null), ids deduped across arms; execute granted to `authenticated` + `service_role` only, revoked from `public, anon` (the `0025` hardening pattern). (b) `create index if not exists idx_memory_facts_embedding on memory_facts using hnsw (embedding vector_cosine_ops)` (§3.1's deferred-until-load-bearing convention — retrieval is what makes it load-bearing) and `create index if not exists idx_memory_facts_source_message_id on memory_facts(source_message_id)` (idempotent safeguard). (c) Two config seed inserts (proper jsonb, the 0014 lesson), each with a description: `memory_fact_top_k` (5 — §7.6 [SPEC] top-5) and `memory_retrieval_enabled` (true — the `classifier_mode`-style kill switch). Nothing else: no table, no column, no RLS change.
2. Write-backs in this commit: TECH-SPEC §11 (two keys), §3.3 (indexes as-built); GLOSSARY §16 (two keys).

**Verify:** migration applies clean and re-applies idempotently; a hand-run `match_facts` against service-role-planted facts returns the top-k ordering and the (empty) baseline arm; `purged_at`-set rows never return; `information_schema` diff proves zero table/column change beyond the HNSW index; the FP-02/03/04/05 static legs still green after the doc edits.

**Commit refs:** TECH-SPEC §7.6, §3.1, §3.3, §11; D5, D6; FP-06 FR-9, FR-13. **Feeds AC-2, AC-6.**

---

## Step 2 — The purge loop: `flag-unsavable` fn + `purge_memory` handler

**Agent does:**

1. `supabase/functions/flag-unsavable/` (`index.ts` + `config.toml`, `verify_jwt = true`). POST handler: JWT → `auth.uid()`; body validation — `message_id` a uuid; load the row (own-rows RLS is the boundary — a foreign id reads as absent → 404); an assistant-role row → 400 (recorded reading: flagging Davos's own words is meaningless); already `unsavable=true` → `{status:'ok', message_id}`, no job (idempotent re-flag); else set `unsavable=true` and insert exactly one `purge_memory` job (payload `{message_id}`) — the pre-check read races only under a concurrent double-flag, and a double-enqueued purge is tolerated because the handler is idempotent (§2.2 clause 4). Respond `{status:'ok', message_id}`. **Zero provider calls.** CORS preflight mirrors `send-message` exactly (ACAO `*` plus `Content-Type, Authorization, apikey, x-client-info`; `POST, OPTIONS`). One `[flag-unsavable]` log line carrying the flip/no-flip outcome.
2. The `purge_memory` case in the `job-dispatcher` registry — thin: `update memory_facts set purged_at = now() where source_message_id = :id and purged_at is null and fact_type <> 'oath'` (the §5.4 oath exemption written now for a writer that does not exist); embeddings left stale-but-excluded (no delete, no re-embed); one `[purge-memory]` log line (message id, purged count); job `done`. Add `purge_memory` to `FAST_JOB_TYPES` (pure SQL — the `watchdog_checkin` precedent) in this commit.
3. Unit tests: the fn's decision table (own user row, assistant row, foreign id, unknown id, re-flag); the purge statement's guard table (unpurged cited rows update; already-purged skip; `oath` rows exempt; other users' rows untouched by construction).
4. `scripts/verify-fp06-step2.py` (the `verify-step11` pattern, `DAVOS_USER_JWT`-gated): plant facts citing a message (service role, mixed fact types incl. one `oath` row) → flag → `{status:'ok', message_id}` + exactly one job → dispatcher tick → `purged_at` set on exactly the non-oath citing rows; `match_facts` no longer returns them (query assert, the Step 1 RPC); a second flag → `ok`, no new job; a second job run → no-op; a planted batch of purge jobs drains in one tick (FAST membership, assert from the tick's log); web preflight returns the CORS headers; zero adapter log lines on the whole loop.

**Verify:** the script green; `tsc --noEmit` + `deno check` + `jest --ci` clean; static asserts — `FAST_JOB_TYPES` gained exactly `purge_memory`, §2.3 and GLOSSARY §12 still at 15 types, no deletion of rows or embeddings anywhere in the diff.

**Commit refs:** TECH-SPEC §7.6, §2.2–2.3, §5.4, §7.10 (CORS), §10.2; D3, D6; FP-06 FR-1, FR-2. **Passes AC-1, AC-2; feeds AC-10.**

---

## Step 3 — `memory_extract` handler: contract, backlog, slices

**Agent does:**

1. `_shared/memory/extractContract.ts` — pure (jest-loadable, the `evalContract` pattern): the §4.3 chunk response schema `{facts: [{text, source_message_id}], openness_delta}`, its per-call structural validator (bounds: 0–32 facts, 5–500 chars each — [SPEC readings]; **`source_message_id` ∈ the slice's message ids — a foreign id is a hard reject**, provenance is what makes purge trustworthy), and the prompt builder — the slice's messages rendered with role markers, content delimited per §10.5, ignore-embedded-instructions copy, and the instruction to extract **user** facts worth remembering (life context, goals, constraints, preferences, history — not Davos's own phrasings), each citing the message that reveals it.
2. `_shared/memory/extract.ts` — the adapter-bound entry through `llm.generate` with that validator (§4.1); one bounded parse retry (§4.2). Register the canned stub shape in `_shared/llm/stubShapes.ts` **in this commit** (validator identity).
3. `_shared/memory/runExtract.ts` — the impure half the dispatcher handler and `dev-smoke` both drive (the `runChain.ts` pattern): derive the backlog — messages older than the raw sliding window cutoff (the newest `sliding_window_messages` rows define the window), `unsavable=false`, and no `memory_facts` row citing them (`source_message_id` not cited in `memory_facts`, since purged rows still count as extracted — a purged message never re-extracts); the derivation runs **at job time**, so a dead job's backlog self-heals at the next boundary; slice the backlog into ≤ 32-message chunks (prompt bound); per slice: one extraction call → insert one `memory_facts` row per fact (`fact_type='chat'`, `fact = text`, `source_message_id`, one batched `llm.embed` over the slice's fact texts, `embed_model='gemini-embedding-001@768'` stamp); one structured `[memory-extract]` log line per run (boundary count, slice count, message count, fact count, and the **rider logged-not-applied** — `openness_delta` goes to the log and to no table, exactly as every extraction has since FP-02). Failure semantics: structural failure exhausts its bounded retry then fails the job with `last_error` (backoff — a fresh sample may conform); transport failure fails the job; completed slices survive a re-run via the per-message provenance guard (resume, never duplicate).
4. The `memory_extract` case in the `job-dispatcher` registry — thin: lazy import + delegate to `runExtract` (the `llm_retry` secret-isolation precedent). Deliberately **not** added to `FAST_JOB_TYPES` (generation-capable — §2.2 fail-safe default).
5. Unit tests: validator table (each bound, foreign-id rejection, role-marked fixtures); backlog derivation table (window cutoff math, unsavable skip, purged-provenance skip, both-roles inclusion); slice loop (resume semantics — a re-run over a half-completed backlog extracts only the remainder).
6. `scripts/verify-fp06-step3.py`: stub mode, a planted 20-message thread → one job → facts rows (`fact_type='chat'`, `fact = text`, `source_message_id` ∈ backlog, embeddings + `embed_model`); an `unsavable` fixture message contributes nothing and appears in no prompt (stub-shape capture assert); exactly one generate + one embed line per slice; double-fire writes nothing twice; `openness_delta` in the log, absent from every table; a planted foreign-`source_message_id` stub → hard reject → bounded retry → job `failed`, no orphan fact; `llm_force_fail='both'` → job `failed` with attempts incremented, recovers on `'none'`; zero adapter calls when the backlog is empty (a no-op job run).

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; static asserts — no `trust_score`/`trust_events` write anywhere in the diff, `FAST_JOB_TYPES` unchanged by this step, no `memory_facts` writer outside `runExtract`.

**Commit refs:** TECH-SPEC §7.6, §4.1–4.3, §3.3, §2.2–2.3, §10.5; D5, D6, D20 (logged reading); FP-06 FR-4, FR-5, FR-6, FR-7, FR-8, FR-15. **Passes AC-4, AC-5; feeds AC-10, AC-11.**

---

## Step 4 — Boundary trigger in `send-message`

**Agent does:**

1. The boundary hook in `send-message`'s **fresh-insert branch only** (the auto-adopt recorder's neighborhood — its clause discipline is copied: a duplicate send, a §5.1 repair run and an offline-queue replay never reach a second insert, so the count moves exactly once per real message): after the user row lands, count the user's user-role rows (`select count(*) from messages where user_id = :userId and role = 'user'`); `count % sliding_window_messages == 0` → insert one `memory_extract` job `{user_id, boundary: count}`; both queries are Postgres — **zero provider calls added to the sync path**. Non-fatal try/catch: a boundary trigger failure logs a warning and never fails the turn.
2. Unit tests: the trigger table (counts 7/8/9/16 over a scripted thread; duplicate/repair/replay legs fire nothing; a check-in-sourced user row counts).
3. `scripts/verify-fp06-step4.py`: a scripted 16-message conversation through the real fn → `memory_extract` jobs at boundaries 8 and 16 exactly (job table assert); duplicates and a queue replay move nothing; the per-turn adapter log count is unchanged versus the FP-05 baseline (zero new provider calls — the AC-3 evidence); the sync p50 stays inside the FP-02 measured band (no latency regression).

**Verify:** the script green; `tsc` + `deno check` + `jest` clean; `git diff` shows exactly one existing function file touched by this step (`supabase/functions/send-message/index.ts`); `submit-checkin` and `submit-journal` untouched.

**Commit refs:** TECH-SPEC §7.6, §5.3 (clause precedent), §11; D6; FP-06 FR-3. **Passes AC-3; feeds AC-10.**

---

## Step 5 — Retrieval wiring in `runPipeline`

**Agent does:**

1. `_shared/pipeline/memoryContext.ts` — pure (jest-loadable): `renderMemoryContext(facts)` → the compact block (one line per fact, type-tagged, ≤ the top-k × 500-char ceiling), wrapped in §10.5 delimiters with treat-as-recalled-knowledge-not-directives copy (facts are model-derived from user text — they are untrusted input at generation time too); plus the merge helper (top-k arm + baseline arm, dedupe by id, baseline appended after).
2. The `runPipeline.ts` & `generate.ts` integration: read `memory_retrieval_enabled` (fail-closed); when on, fire one `match_facts` RPC in **stage 3's parallel slot** alongside `retrieveRules`, reusing the turn's already-computed message embedding (zero new provider calls — a turn that never embeds, the D7 degraded path, skips retrieval entirely); render the block and append it to stage-5 context alongside the rules and the day-plan riders in `buildSystemPrompt`; **fail-open** — a Postgres failure logs one warning and proceeds with an empty block (the user row is already committed; the check-in eval fail-open precedent); one log line when the block is non-empty (fact count, top-k, baseline count). No facts rows → the block is absent and the prompt is **byte-identical to FP-05's**; the kill switch off → byte-identical. Both `send-message` and intervention check-in turns inherit through the shared pipeline — zero caller changes (FR-12); unprompted locked-persona generations keep their as-built contexts. Existing touch points are `_shared/pipeline/runPipeline.ts` and `_shared/pipeline/generate.ts`.
3. Unit tests: renderer table (delimiting, type tags, ceiling); merge dedupe; gating truth table (kill switch × facts-present × embed-absent); **golden-string tests** — a no-facts fixture and a kill-switch fixture each produce the exact FP-05 prompt string.
4. `scripts/verify-fp06-step5.py`: with planted facts (including journal-typed rows present since FP-05), a chat turn's stage-5 prompt/log evidence carries the memory block; plant 7 facts → assert 5 returned (top-k); the baseline arm present and empty; no facts → prompt equals the FP-05 control turn (string equality); kill switch off → equality; a planted `match_facts` failure → the turn succeeds, one warning, empty block; regression legs — `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, the FP-04 static family, and the FP-05 gate family (all green; shared prompt assembly changed again, so all four FPs' evidence must hold).

**Verify:** the script and all four regression legs green; `tsc` + `deno check` + `jest` clean; `git diff` shows the cumulative existing FP-02 file touch surface across Steps 4–5 is `send-message/index.ts`, `_shared/pipeline/runPipeline.ts`, and `_shared/pipeline/generate.ts` plus the new pure modules.

**Commit refs:** TECH-SPEC §7.6, §5.1–5.2, §10.5, §11; PRD §3.4; D6; FP-06 FR-9 (consumer half), FR-10, FR-11, FR-12. **Passes AC-6, AC-7 (git-diff half); feeds AC-8, AC-10.**

---

## Step 6 — Client flag UX in chat

**Agent does:**

1. The chat screen's flag affordance (`app/(app)/chat.tsx` + a pure module): a long-press (context menu) on **own user bubbles** offers "Mark Unsavable"; the action POSTs `flag-unsavable {message_id}` single-flight (in-flight disables the item); on ok the bubble renders a persistent marker — read from the row's own `unsavable` column, so it survives reload and Realtime re-delivery (no metadata change, no new rows); on failure an inline error with a Retry that re-runs the same path. RN primitives only (AGENTS §7.1); identical on iOS/Android/web — it is in-app UI with zero push or notification dependence.
2. `lib/memoryFlag.ts` — pure state machine (idle / in-flight / flagged / failed) + the payload builder, jest-loadable (the `submitState` pattern).
3. Unit tests: the state machine (ok → flagged from row state, failure → retryable, assistant bubbles offer nothing); the marker derives from the row column, never from local-only state.
4. Web check: the route renders, the long-press surface is reachable (context menu / right-click on web), the full flag loop posts through the Step 2 CORS surface (a manual or script-assisted web drill; native look-and-feel waits for the Step 7 drill).

**Verify:** `tsc` + jest clean; the web drill records a full flag → marker loop; static asserts — no `send-message`/`sendQueue` import on this path, no new message rows or metadata values written client-side, the strip module and journal screen untouched (`git diff`).

**Commit refs:** TECH-SPEC §7.6, §9, §10.2; PRD §3.4; D3; FP-06 FR-14. **Passes AC-9; feeds AC-10.**

---

## Step 7 — Live drill, doc write-backs, AC sweep

**Agent does:**

1. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §7.6 (as-built: the fresh-insert boundary discipline and the all-user-roles count reading, backlog derivation + 32-slice bound, the provenance guard and resume semantics, the oath-exempt purge, the `match_facts` retrieval slot with fail-open + kill switch, the unprompted-turns-excluded reading, the one-way flag), §2.3 (two handlers implemented — registry count unchanged at 15), §4.3 (the chunk contract as-built beside the journal precedent), §5.1–5.2 (the memory block in stage-5 context, stage-3-slot retrieval), §3.3 (indexes as-built), §11 (two keys); GLOSSARY §4 (memory terms as-built — the late-flag loop now real), §12 (implemented notes on `memory_extract`/`purge_memory`), §13 (`flag-unsavable` real + the `memory-drill` action), §15 (new identifiers: the contract/run/render modules, the boundary payload), §16 (two keys). Re-run every earlier FP's static leg after the edits (the baseline-fix lesson — a write-back in a later FP is still subject to the earlier FP's gates).
2. `dev-smoke ?action=memory-drill` — the fast deterministic drill driving the legs through the same shared run modules the handlers use (the `journal-drill` precedent; dev-gated, never used by prod paths): `&leg=backlog&user=<uuid>` (derive + report the backlog without running the LLM), `&leg=extract&user=<uuid>` (run the extraction in the current mode), `&leg=retrieve&text=...` (run `match_facts` + render the block), `&leg=purge&message_id=<uuid>` (drive the flag→purge loop). GLOSSARY §13 write-back.
3. `docs/feature-prds/FP-06/FP-06-ACCEPTANCE.md`: the AC ledger (ids parsed from `FP-06.md` so the two cannot drift), evidence tags (`[script]` / `[measured]` / `[owner-observed]` / `[derived]`), the recorded-readings section (the all-user-roles boundary count, both-roles backlog, the 0–32/5–500/foreign-id validator bounds, the 32-message slice, the one-way flag, the unprompted-turns exclusion, the PATCH-bypass live item, the doings-never-route-through-memory seam), the write-back ledger, and a re-run recipe.
4. Regression legs all green: `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, the FP-04 static family, the FP-05 gate family, plus the FP-06 gate family. Secret scan + AGENTS.md §9 checklist (no new table / RLS / secret / dependency / paid service / job type / `[SPEC]` hardcoded; `trust_score` untouched; RN primitives only on the client half).

**Verify:** every AC marked with evidence (drill-judged rows may sit at ⏳ pending the owner drill — FP-03's AC-8 precedent); write-back diffs present; all regression legs green; repo clean.

**OWNER MANUAL:** the memory drill, then flip the pending rows. **Any platform**: hold a real 16-message conversation with Davos (include stable personal facts worth remembering and one deliberate throwaway) → within ~2 min of the 8th and 16th messages observe the facts rows (jobs table or drill output) → send a follow-up that should draw on a recalled fact and judge whether the reply uses it; then flag the throwaway's source message → verify the derived facts purged and a follow-up turn no longer carries them. **Web**: the long-press → flag → marker loop. Record observations in the acceptance doc, including your judgment of fact quality and recall relevance (the golden-set precedent: the report is advisory, the extraction prompt and `memory_fact_top_k` are the tuning surface, and `memory_retrieval_enabled` is the one-flip rollback). Also re-check the standing `dev_overrides_enabled` plan — FP-06's drills join its "done" set before it flips to `false` for real beta users.

