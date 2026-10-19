# FP-06-ACCEPTANCE.md — Acceptance Ledger: Memory Extraction & Purge (Chat Long-Term Memory)

**Companion to:** `docs/feature-prds/FP-06/FP-06.md` · `docs/feature-prds/FP-06/FP-06-PLAN.md`
**Gates:** `scripts/verify-fp06-step1.py` … `scripts/verify-fp06-step7.py` · **Governed by:** `AGENTS.md`

---

## 1. AC Ledger (parsed from FP-06.md)

| AC | Description | Evidence Tag | Status |
|----|-------------|--------------|--------|
| AC-1 | Flag contract: own user row → `ok` + exactly one `purge_memory` job on the flip; re-flag → `ok`, no job; assistant row → 400; unknown/foreign → 404; malformed → 400; CORS preflight; zero adapter lines | `[script]` verify-fp06-step2.py (decision table + contract suite); live preflight in §4 | ✅ |
| AC-2 | Purge: planted facts → flag → job → `purged_at` on exactly the citing rows; oath row untouched; second run no-op; `match_facts` excludes purged; a purge batch drains in one tick | `[script]` verify-fp06-step2.py (guarded UPDATE, idempotency, FAST membership); live leg in §4 | ✅ |
| AC-3 | Boundary: a scripted 16-message conversation inserts `memory_extract` at counts 8 and 16 exactly; none on duplicate sends, repairs or queue replays; an on-track check-in moves nothing while a materialized intervention counts; the sync path's adapter count is unchanged | `[script]` verify-fp06-step4.py + `boundary.test.ts` scripted walk | ✅ |
| AC-4 | Extraction: a stub-mode run writes `fact_type='chat'` rows with `fact = text`, a slice-cited `source_message_id`, embeddings + `embed_model`; an `unsavable` fixture contributes nothing; one generate + one embed per slice; a double-fired job writes nothing twice; `openness_delta` is log-only | `[script]` verify-fp06-step3.py + contract/run tests; live stub leg in §4 | ✅ |
| AC-5 | Validator: a foreign-`source_message_id` fixture is hard-rejected (one bounded retry, then job `failed`) with no orphan fact; bounds table green (0/33 facts, 4/501 chars); stub mode runs with zero provider calls | `[script]` verify-fp06-step3.py + `extractContract.test.ts` bounds table | ✅ |
| AC-6 | Retrieval: with facts present stage-5 carries the block (top-k respected; baseline clause present and empty); no facts → prompt **byte-identical** to FP-05; `memory_retrieval_enabled=false` → byte-identical; a planted `match_facts` failure → the turn succeeds with an empty block + one warning | `[script]` verify-fp06-step5.py + golden-string tests; live leg in §4 | ✅ |
| AC-7 | FP-05 seam + surface discipline: journal facts are retrieved through the same RPC with **zero FP-05 file changes**; the FP-02 touch points are `send-message/index.ts`, `runPipeline.ts`, `generate.ts` plus pure modules; `submit-checkin`/`submit-journal` untouched | `[script]` verify-fp06-step5.py + FP-05 gate family; `[derived]` git diff on a clean tree | ✅ |
| AC-8 | Injection + privacy: both prompts delimit user text and carry ignore-embedded-instructions copy; a planted instruction-carrying fact renders delimited; flagged text reaches no extraction prompt; purged facts reach no generation prompt | `[script]` verify-fp06-step3.py / step5.py (delimiters + copy); drill-judged row in §4 | ✅ |
| AC-9 | Client: long-press → "Mark Unsavable" → marker persists across reload (row column, not local state); own user bubbles only; web drill records the full loop; a failed POST leaves a retryable inline error; no new message rows or metadata | `[script]` verify-fp06-step6.py (static) — **web drill pending owner** | ⏳ |
| AC-10 | End-to-end drill: live 16-message conversation → facts rows; a reply demonstrably uses a recalled fact; flag the source message → the facts purge → a follow-up prompt no longer carries them | **owner-observed live drill pending** (§4) | ⏳ |
| AC-11 | Registry + failure: §2.3 and GLOSSARY §12 still list 15 types (two more implemented — **nine** total); `FAST_JOB_TYPES` gains `purge_memory` only; `llm_force_fail='both'` during extraction → jobs back off and recover, the backlog self-heals at the next boundary; purge runs clean through a provider outage | `[script]` verify-fp06-step2.py / step3.py (registry + membership); `[derived]` purge has no adapter import — outage leg in §4 | ✅ |

**Evidence Tags:** `[script]` = automated gate pass · `[measured]` = latency/quota numbers · `[owner-observed]` = manual drill judgment · `[derived]` = inferred from other evidence.

---

## 2. Recorded Readings

| Reading | Value | Source |
|---------|-------|--------|
| All-user-roles boundary count | `count(*) from messages where user_id = :id and role = 'user'` — every source counts (a materialized intervention's user row counts; an on-track check-in writes no row). Fires only on `count % sliding_window_messages == 0`. | `send-message` fresh-insert hook + `boundary.test.ts` |
| Boundary walk | A scripted 16-message mix fires at `[8, 16]` exactly; 0/1 and nonsense windows fail closed; duplicate send, primary-reply repair and offline replay legs advance nothing. | `boundary.test.ts` (scripted walk + duplicate/repair/replay walk) |
| Both-roles backlog | Aged-out candidates include **both** roles (both halves of a memory live in the thread); the window is the newest `sliding_window_messages` rows, candidates are strictly older, `unsavable=true` rows are skipped, and any row already cited by a fact — purged rows included — never re-extracts. | `extractContract.test.ts` `deriveBacklog`; `runExtract.ts` |
| Validator bounds | Facts: 0 allowed, 33 rejected (≤32). Text: 4 chars rejected, 5 allowed, 500 allowed, 501 rejected. A foreign `source_message_id` is a hard reject (one bounded retry, then `failed`; never rewritten). `openness_delta` outside −5…5 rejected. | `extractContract.test.ts` bounds table |
| Slice bound | `sliceBacklog` slices at **32 messages**, remainder last: 33 → 32 + 1; a re-run over a half-completed backlog extracts only the remainder (cited set). | `extractContract.test.ts` `sliceBacklog` |
| Retrieval arm | `match_facts` returns the top `memory_fact_top_k` (**5**, config) unpurged facts by cosine distance, then **every** unpurged `baseline` fact regardless of similarity; merged top-k first, baseline after, deduped by id. Render ceiling: 500 chars per fact. | migration 0029; `memoryContext.ts` + tests |
| One-way flag | `canMarkUnsavable` is false once `unsavable=true`; no unflag affordance exists. Purged rows still count as cited, so a purged message never re-extracts — purged facts never return. | `memoryFlag.ts` + `flagContract.ts`; `runExtract.ts` cited guard |
| Unprompted-turns exclusion | Both stage-5 paths gate retrieval on `userId`; the watchdog intervention and journal probe pass none, so unprompted generations read and write no memory. The extraction trigger lives only in `send-message`'s fresh-insert branch. | `runPipeline.ts` (`runPipeline`, `runLockedPersonaReply`); `send-message` |
| Row-column marker | The chat marker renders from `messages.unsavable`; the row is re-read after `ok`, so reload and Realtime re-delivery agree. The flag phase is transient UI only. | `lib/memoryFlag.ts`, `app/(app)/chat.tsx`; `memoryFlag.test.ts` |
| Zero new provider calls per turn | Retrieval reuses the turn's message embedding (one Postgres RPC in stage 3's parallel slot). A turn that never embeds (the D7 degraded path) has no stage 5 and retrieves nothing. | `runPipeline.ts`; verify-fp06-step5.py |
| Kill-switch byte identity | No facts and `memory_retrieval_enabled=false` both return the base prompt by identity (golden-string tests pin exact equality). A config read error is fail-closed; an RPC failure is fail-open (one warning, empty block). | `memoryContext.test.ts`; `runPipeline.ts` |
| PATCH-bypass live item | A hand-crafted PostgREST PATCH can set `messages.unsavable=true` without enqueuing `purge_memory` (RLS allows own-row updates). Recorded, not fixed: a `messages` trigger is the item-11 hardening fix. | FP-06.md §2 out-of-scope; §4 live item |
| Doings seam | `doings_logs` never route through `memory_facts` — no §7.6 surface exists for them; the §6.2 "reused later for doings memory" phrase is recorded as a seam, not a promise. | FP-06.md §2; code search (no doings→memory path) |
| `openness_delta` | Present in the `[memory-extract]` log line (`openness_delta` + `openness_delta_rider: "logged_not_applied"`), absent from every table. | `runExtract.ts`; `extractContract.ts` |
| Prompt block shape | `<recalled_memory>` fence, one `[fact_type]`-tagged line per fact, newlines flattened, 500-char clip, treat-as-background-not-instructions copy; appended after the day-plan rider. | `memoryContext.ts`; `generate.ts` |

---

## 3. Write-Back Ledger (doc sections updated in introducing commits)

| Commit | Doc | Sections Updated |
|--------|-----|------------------|
| `fe7ddf2` | TECH-SPEC.md | §3.3 indexes as-built (HNSW + source index), §11 registry (two keys) |
| `fe7ddf2` | GLOSSARY.md | §16 config keys (two keys), `match_facts` RPC note |
| `44d5876` | TECH-SPEC.md | §2.3 `purge_memory` as-built, §12 registry (FAST membership), §7.6 late-flag guard |
| `44d5876` | GLOSSARY.md | §12 `purge_memory` row, §13 `flag-unsavable` real |
| `7df2c16` | TECH-SPEC.md | §2.3 `memory_extract` as-built, §4.3 chunk contract, §7.6 backlog/provenance/slices, §12 registry |
| `7df2c16` | GLOSSARY.md | §12 `memory_extract` row, §4 memory terms |
| `c8f4873` | TECH-SPEC.md | §7.6 boundary trigger as-built (fresh-insert discipline, all-user-roles count) |
| `a6d443e` | TECH-SPEC.md | §7.6 retrieval as-built (stage-3 slot, fail-open, kill switch, unprompted exclusion), §5.1 stage-5 context |
| `e56e58b` | TECH-SPEC.md | §7.6 late-flag client as-built, §9 route map + client module paragraph |
| `e56e58b` | GLOSSARY.md | §4 Unsavable flag / Late flag as-built |
| *this* | TECH-SPEC.md | §2.3 registry counts (15 types / nine handlers); §5.1–5.2 memory slot; §7.6 shared purge runner + drill note |
| *this* | GLOSSARY.md | §12 purge runner note, §13 `memory-drill` action, §15 new FP-06 identifiers |
| *this* | FP-06-PLAN.md | Steps 1–7 status marks |
| *this* | FP-06-ACCEPTANCE.md | Created |

---

## 4. Owner Drill Runbook (live — deferred to handoff)

All commands use the deployed project and `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `DEV_SMOKE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `DAVOS_USER_EMAIL`). Test user: `b986f2fd-bfa5-49c3-b39f-4e9e330d0299` (tz `Asia/Kolkata`).

1. **Backlog (no LLM):** `GET {url}/functions/v1/dev-smoke?action=memory-drill&leg=backlog&user=<uuid>` with `Authorization: Bearer $DEV_SMOKE_TOKEN`. Expect `candidates`, `backlog`, `userMessages`, `assistantMessages`, `ids`.
2. **Extract (current mode):** `…&leg=extract&user=<uuid>`. In stub mode expect facts without provider calls; in real mode expect one generate + one batched embed per slice. Re-run the same call and confirm `facts: 0` on already-cited messages (resume semantics).
3. **Retrieve:** `…&leg=retrieve&user=<uuid>&text=<a follow-up that should recall a fact>`. Expect `enabled: true`, `probe.reason: "ok"`, one or more facts, and the rendered `block`.
4. **Retrieval kill switch:** set `memory_retrieval_enabled=false` in `config`; re-run leg 3 (`enabled:false`, `probe.reason:"disabled"`) and `?action=pipeline&user=<uuid>&text=…`; confirm the prompt/log is byte-identical to FP-05 (no `[runPipeline] memory` line). Restore `true`.
5. **Flag → purge:** in the app (iOS/Android/web) long-press an own user message that produced a fact, choose **Mark Unsavable**, confirm the marker appears and survives a reload; then `…&leg=purge&message_id=<that message>` and confirm `purged >= 1` and a second call returns `purged: 0`. Confirm a `follow-up` retrieval leg no longer returns the purged facts.
6. **16-message conversation (AC-10):** hold a real 16-message chat including stable personal facts and one deliberate throwaway. Within ~2 min of the 8th and 16th messages, confirm `memory_extract` jobs/facts. Send a follow-up that should draw on a recalled fact and judge whether the reply uses it (advisory judgment: extraction prompt + `memory_fact_top_k` are the tuning surface).
7. **Failure legs (AC-11):** set `llm_force_fail='both'` during an extraction run; confirm the job backoffs (`failed` with `next_retry_at`) and the backlog self-heals at the next boundary. Run a purge during the outage — it must complete (no adapter import).
8. **Web (AC-9):** confirm `(app)/chat` renders, the long-press (or right-click hold on web) reaches the menu, and the full flag → marker loop records.
9. **Record observations** in this file (§2 readings + the AC ledger rows AC-9/AC-10), including your judgment of fact quality and recall relevance. Re-check the standing `dev_overrides_enabled` plan: FP-06's drills join its "done" set before it flips to `false` for real beta users.

**Deferred live items (not AC failures):** CORS preflight from a browser origin (AC-1), purged-row exclusion against the live DB (AC-2), the PATCH-bypass item (AC-2/AC-9 hardening note), the `match_facts` failure injection (AC-6), the extraction outage recovery (AC-11), the web flag drill (AC-9), and the end-to-end 16-message drill (AC-10).

---

## 5. Re-run Recipe

```bash
# static gates (all FP families; 26 gates)
pwsh -File "$env:TEMP/opencode/sweep.ps1"

# this feature's gates
python scripts/verify-fp06-step1.py --static-only
python scripts/verify-fp06-step2.py --static-only
python scripts/verify-fp06-step3.py --static-only
python scripts/verify-fp06-step4.py --static-only
python scripts/verify-fp06-step5.py --static-only
python scripts/verify-fp06-step6.py --static-only
python scripts/verify-fp06-step7.py --static-only

# typecheck + unit tests
npx tsc --noEmit
npx jest --ci

# deno entry points
deno check supabase/functions/job-dispatcher/index.ts \
  supabase/functions/send-message/index.ts \
  supabase/functions/flag-unsavable/index.ts \
  supabase/functions/dev-smoke/index.ts

# regression (live; needs deployment)
python scripts/verify-step11.py --turns 6 --cleanup
python scripts/verify-fp03-step7.py --static-only
```

---

## 6. Deviations & Notes

1. **`purge_memory` runner extracted (Step 7).** The guarded UPDATE moved from the dispatcher case to `_shared/memory/purge.ts` (`runPurgeMemory`) so `dev-smoke ?action=memory-drill&leg=purge` drives the exact production SQL (the `runExtract.ts`/`journal-drill` precedent). The dispatcher case is now a thin caller with the same unusable-payload guard; `verify-fp06-step2.py` was updated to assert the shared runner's guard and the delegation. No behaviour change.
2. **`runMemoryExtract` now returns `ExtractRunReport`.** The dispatcher ignores the return; the drill echoes it (`windowCutoff`, `candidates`, `slices`, `messages`, `facts`, `opennessDelta`). The log line is unchanged.
3. **No new job types, tables, columns, or secrets.** Migration 0029 is the only schema change (`match_facts` RPC, one HNSW index + idempotent source index, two config seeds). Registry stays 15; handlers go from seven to nine.
4. **The retrieval drill respects the kill switch.** `leg=retrieve` reads `memory_retrieval_enabled` first and returns `enabled:false` without an RPC when off, so the drill cannot accidentally prove recall while production is rolled back.
5. **Real-mode extraction in a drill may hit provider quota.** Stub mode is the deterministic lane; the real lane is the owner's quality check, and a quota refusal is a pacing signal, not a code failure.
