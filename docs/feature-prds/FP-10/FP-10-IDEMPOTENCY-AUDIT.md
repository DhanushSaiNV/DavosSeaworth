# FP-10 — The Idempotency Audit

**Status:** delivered (FP-10 Step 3, 2026-10-28). **Owner:** the auditor of last resort — this
document is the register you read and challenge.
**Governing refs:** FP-10 FR-6, FR-7; AC-7; TECH-SPEC §2.2–§2.3, §3.1–§3.2, §4.1, §5.1, §5.3,
§7.1–§7.8, §11; D12, D20, D26.

## 0. What this is, and the rule that keeps it true

Nine feature passes each asserted their own idempotency slices — 15 job types with their dedups,
the eight synchronous functions with their dedupe keys and 23505 winner-returns, the cron tick
guards, three client queues with their replay keys. No pass had swept them as one register.

This is that register. Every write path in the system is one row: **the guard**, **what a replay
does**, **the verdict**, and **the evidence** that the verdict was proven rather than asserted.

**Verdict vocabulary** (exactly four, no others):

| Verdict | Meaning |
| --- | --- |
| `proven` | A guard exists, and an automated gate or a drill exercised the replay and saw the no-op. |
| `tolerated-by-design` | A duplicate is possible and harmless (dev-only surface, or a value with no consequence), and the reason is recorded. |
| `fixed-in-this-FP` | The guard did not exist before FP-10 and does now. |
| `recorded-residual` | A duplicate is possible, has a real consequence, and fixing it needs a decision outside this FP's touch set. Recorded here with the reason and the guard that bounds it. |

**Maintenance rule (binding).** Any future change that adds a write path — a job handler, an Edge
Function, a trigger, a cron tick, a client queue — appends its row to the matching table **in the
same change**, with its guard and its evidence. A row without an evidence link is not allowed;
if the evidence does not exist yet, the change writes the gate first. AGENTS.md §6.5 already
requires the GLOSSARY entry for a new identifier; this document is that rule's idempotency half.

**Path convention.** `migrations/…` is `supabase/migrations/…`. `_shared/…`, `<function>/index.ts`
and `job-dispatcher/index.ts` are under `supabase/functions/`. Everything else is repo-relative
(`scripts/…`, `lib/…`, `app/…`, `docs/…`). Every reference resolves to a file that exists —
`scripts/verify-fp10-step3.py` asserts it.

---

## 1. The as-found grant matrix (Step 0, before `0036`)

The audit starts with the surface itself: idempotency guards are worth nothing if any client can
write around them. This is what the live project actually granted on 2026-10-28 before FP-10's
migration, read from `information_schema` / `pg_attribute` rather than from the migration files.

| Surface | As found | Why it mattered | As built (`0036`) |
| --- | --- | --- | --- |
| every public table | Supabase's default `all` grant to `anon` + `authenticated` | the default is broader than any policy; RLS is the only gate | DML revoked where no client path exists |
| `config` | DML for `anon` + `authenticated`, **RLS disabled, 0 policies** | every kill switch (`dev_overrides_enabled`, `llm_stub_mode`, `llm_force_fail`) was writable with the public anon key | DML revoked for both roles; `select` kept for `authenticated` |
| `profiles` | table `update` | a hand-crafted PATCH could set `trust_score`, `onboarding_stage`, `dialog_state` | `update (display_name)` only |
| `messages` | `insert`, `update` | a raw PATCH could set `unsavable` and never enqueue the purge | `update (unsavable)` only; the trigger is the sole enqueuer |
| `trust_events` | `select` for `authenticated` | §4.7's hidden `trust_score` is derived from these rows | `select` revoked |
| `doings_logs`, `journal_entries`, `memory_facts`, `metrics`, `metric_points`, `anchor_plans`, `habits` | DML | every write is an Edge Function's job; the client never writes them | DML revoked |
| `persona_stats` | `update` | D8's counters are server-only | `update` revoked |
| `push_tokens` | `select/insert/update/delete` | the client registers and deregisters its own token | anon DML revoked; the four verbs kept for `authenticated` |
| `jobs` | DML granted, RLS on with 0 policies | client-inaccessible despite the grants | unchanged (RLS is the gate); no client path exists |

**Evidence:** `scripts/verify-fp10-step1.py` — the live grant matrix legs (table + column
privileges per role, trigger definition, function ACLs, zero columns beyond `0035`) and the
behaviour legs (denied PATCHes, kept SELECTs, `update_checkin_prefs`, `push_tokens`, both
unsavable doors). End-state prose: TECH-SPEC §3.1; GLOSSARY §15's `0036` row.

**Consequence for this audit:** every `proven` verdict below assumes the surface above. A guard
that a client can bypass is not a guard — that was FP-10 FR-1's whole point, and it is why the
matrix opens the register instead of sitting in an appendix.

---

## 2. The write-path matrix

### 2.1 The 15 job handlers

`claim_jobs` gives at-most-once *execution* per claim (`for update skip locked`, `status='running'`),
and the lease reset re-delivers a killed invocation. So the question for each handler is: **what
does a second run of the same row write?** The dispatcher's doc comments state the guard; the
handler bodies and their owning gates prove it.

| # | Handler | Guard | Replay behaviour | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `smoke_test` | none — it writes nothing | a second run completes; the `fail` and `snooze_until` payload keys are drill-only | `tolerated-by-design` | `job-dispatcher/index.ts:275`; `scripts/verify-fp10-step2.py` (dead-letter + snooze legs) |
| 2 | `llm_retry` | reply lookup first, then `messages_one_secondary_reply` | second run finds the reply and closes without a second message | `proven` | `job-dispatcher/index.ts:137,168,250`; `migrations/0019_chat_secondary_reply.sql:23`; `scripts/verify-fp02-step8.py` |
| 3 | `watchdog_checkin` | any-status dedupe: one `intervention` row per missed window, ever | a re-scan finds the existing row and enqueues nothing | `proven` | `_shared/checkin/runWatchdog.ts:151`; `scripts/verify-fp04-step6.py` |
| 4 | `intervention` | window key re-checked before generating and again on a re-claim | second run writes nothing | `proven` | `_shared/checkin/runWatchdog.ts:284,311`; `scripts/verify-fp04-step6.py` |
| 5 | `proactive` | the job id is the idempotency key; the written row is looked up | a re-claim after a lease timeout closes without a second message | `proven` | `_shared/proactive/runProactive.ts:274`; `scripts/verify-fp09-step5.py` |
| 6 | `journal_extract` | marker-first (`vagueness_score`) + facts-presence check | second run skips extraction and the facts write | `proven` | `_shared/journal/runChain.ts:32,57`; `scripts/verify-fp05-step4.py` |
| 7 | `anchor_plan` | `metadata.source='anchor_plan'` + `entry_id` row guard; upsert on `(user_id, plan_date)` | second run rewrites the same plan row, no second message | `proven` | `_shared/journal/runChain.ts:205`; `scripts/verify-fp05-step5.py` |
| 8 | `journal_probe` | `metadata.source='journal_probe'` + `entry_id` row guard; `probed=true` | second run writes nothing | `proven` | `_shared/journal/runChain.ts:359`; `scripts/verify-fp05-step5.py` |
| 9 | `purge_memory` | `purged_at is null` filter | second run purges nothing | `proven` | `_shared/memory/purge.ts:33`; `scripts/verify-fp06-step2.py` |
| 10 | `memory_extract` | per-message provenance marker written before the facts | second run extracts only the remainder | `proven` | `_shared/memory/runExtract.ts:141,146`; `scripts/verify-fp06-step4.py` |
| 11 | `metric_eval` | upsert on the table's `unique (metric_id, computed_for)` | second run overwrites the same point, never a second one | `proven` | `_shared/metrics/runEval.ts:359`; `migrations/0007_features.sql:46`; `scripts/verify-fp07-step5.py` |
| 12 | `drift_scan` | streak +2 once per local day; pattern job deduped on `(user, reason, local_day)` any status; habit live-description guard | a doubled 10-minute tick and a retry are both no-ops | `proven` | `_shared/accountability/runDriftScan.ts:8`; `scripts/verify-fp08-step5.py` |
| 13 | `quest_expire` | conditional update on `metrics.archived_at` | only one runner archives; the second finds it archived | `proven` | `_shared/accountability/runQuestExpire.ts:97`; `scripts/verify-fp08-step6.py` |
| 14 | `strike_fire` | the message lookup is the dedupe key; a status guard no-ops a settled strike | a re-claim that finds the row repairs the status flip and returns `duplicate` | `proven` | `_shared/accountability/runStrike.ts:15`; `scripts/verify-fp08-step7.py` |
| 15 | `histogram_daily` | rebuild deduped on `(user, leg, computed_for, bucket_hour)` any status; fire leg looks up the written row | a doubled tick writes no second bucket and sends no second push | `proven` | `_shared/accountability/runHistogram.ts:18`; `scripts/verify-fp08-step8.py` |

**Reading note — the dedupes are lookups, not constraints.** `jobs` carries no unique index (its
only index is `jobs_due_idx`), so every "payload dedupe" above is a `select` inside the handler.
That is safe for the shipping topology — one dispatcher invocation at a time, `for update skip
locked` inside the claim, handlers run sequentially in the batch — and it is *not* safe against two
overlapping invocations writing the same logical payload. The accepted bound: the every-minute tick
plus `job_dispatcher_budget_ms` means overlap requires a tick that outlives 140 s, which the
budget is designed to prevent (TECH-SPEC §2.2.5). Recorded here so a future "run the dispatcher
twice in parallel" idea starts from the constraint instead of discovering it.

### 2.2 The synchronous functions

The eight client-facing functions of the FR-6 register, plus the later additions (FP-09's
`delete-account`, the two token-gated tools, and `health`). The question for each is: **what does a
replayed HTTP request write?**

| # | Function | Guard | Replay behaviour | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `send-message` | `messages_user_client_msg_uniq` + `upsert(onConflict: user_id,client_message_id, ignoreDuplicates)`; an answered turn returns `duplicate`, an unanswered one is repaired; the reply's `23505` returns the winner; the oath claim is a CAS | verbatim replay (same `client_message_id`) writes no second user row and no second reply | `proven` | `send-message/index.ts:445,508,517,604`; `migrations/0016_messages_client_id.sql:15`; `scripts/verify-step8.py`, `verify-fp10-idempotency.py` |
| 2 | `submit-checkin` | hint canonicalized before any lookup; pre-embed duplicate select; `doings_logs_one_checkin_window` + 23505 re-select; the intervention user row's 23505 re-select | a replay of the same window returns `duplicate` with the echoed pair and costs zero provider calls | `proven` | `submit-checkin/index.ts:419,503`; `migrations/0026_checkin_loop_fp04.sql:34`; `scripts/verify-fp04-step2.py`, `verify-fp10-idempotency.py` |
| 3 | `submit-journal` | **none** — unconditional insert; `journal_entries` has no unique key | a replay (the UI's explicit Retry after a lost response) writes a **second entry** and a second `journal_extract` job | `recorded-residual` | `submit-journal/index.ts:98,117`; `migrations/0007_features.sql:6`; bounded by `lib/journal/submitState.ts` (Retry exists only from `failed`) |
| 4 | `select-persona` | pre-check `findSecondaryReply`; `messages_one_secondary_reply` + 23505 winner | a double tap returns `duplicate` with the same reply id | `proven` | `select-persona/index.ts:194,257`; `migrations/0019_chat_secondary_reply.sql:23`; `scripts/verify-fp03-step3.py` |
| 5 | `select-metrics` | stage compare-and-set; preset rows reused by name; a lost race re-reads as `duplicate` | a double confirm writes no second metric and no second advance | `proven` | `select-metrics/index.ts:206,257`; `_shared/onboarding/apply.ts:383`; `scripts/verify-fp09-step4.py` |
| 6 | `accept-quest` | consumed-offer short-circuit; decline CAS on `quest_consumed is null`; accept runs `accept_quest()` under a per-user advisory lock and re-checks | a replay returns `duplicate` and writes nothing | `proven` | `accept-quest/index.ts:144,153`; `migrations/0032_accountability_fp08.sql:216,232`; `scripts/verify-fp08-step1.py` |
| 7 | `flag-unsavable` | pre-read `already_flagged` answers `ok` without the UPDATE, so the trigger never fires; the trigger predicate is `old.unsavable is not true and new.unsavable is true` | a re-flag enqueues nothing and purges nothing twice | `fixed-in-this-FP` | `flag-unsavable/index.ts:83`; `migrations/0036_armor_audit_fp10.sql:117,136`; `scripts/verify-fp10-step1.py` (AC-2 legs) |
| 8 | `log-impulse` | **none** — an impulse has no natural key; the client disables the button while in flight | a replay writes a second impulse row | `tolerated-by-design` | `log-impulse/index.ts:8,83` |
| 9 | `delete-account` | both modes run the delete-based `purge_user_data` (per-user advisory lock); a 404 from `admin.deleteUser` is success | a retry after a lost response deletes nothing and returns ok | `proven` | `delete-account/index.ts:98`; `migrations/0034_account_lifecycle.sql:34`; `scripts/verify-account-lifecycle.py` |
| 10 | `content-seed` | deterministic `uuidV5` ids + `upsert(onConflict: id)` | a re-seed upserts the same rows | `proven` | `content-seed/index.ts:147,162` |
| 11 | `dev-smoke` | seed actions delete-first or skip-existing; the insert paths mint random ids | a re-run of `seed-rules`/`seed-exemplars` is clean; a re-run of the other actions is not | `tolerated-by-design` | `dev-smoke/index.ts:561,641,753`; token-gated, dev-only |
| 12 | `health` | writes nothing (one `config` select) | no-op | `proven` | `health/index.ts:43` |
| 13 | `job-dispatcher` | `claim_jobs` CAS + lease reset + settle/snooze/release CAS on `status='running'` | a doubled tick claims disjoint rows and can never settle another invocation's claim | `proven` | `job-dispatcher/index.ts:614,644,657`; `migrations/0008_jobs.sql:42`; `scripts/verify-fp10-step2.py` |

**Reading note — residual 3 (`submit-journal`).** The honest shape of the hole: the client's Retry
is only reachable from the `failed` state, so the duplicate needs a response lost *after* the
server committed. The consequence is a second journal entry (and a second evening chain), not a
corrupted one. Two fixes exist and both are outside this FP: a `client_entry_id` column + unique
index (a schema change, and FP-10 ships zero columns), or `unique (user_id, entry_date)` (which
forbids two entries in one day — a product change that needs the PRD, not an audit). Recorded,
bounded, and named so it can be scheduled rather than rediscovered.

### 2.3 Triggers and cron ticks

Every one of these is a *re-fire* question, because the platform retries ticks and a migration can
be re-applied.

| # | Path | Guard | Re-fire behaviour | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `on_auth_user_created` (`after insert on auth.users`) | the trigger event plus `profiles.id` as the PK | cannot re-fire for the same auth user; a manual duplicate insert raises rather than silently skipping (no `on conflict`) | `proven` | `migrations/0004_profiles_trigger.sql:10,26`; `migrations/0002_auth_profiles.sql:6` |
| 2 | `messages_purge_memory_on_unsavable` | `when (old.unsavable is not true and new.unsavable is true)` + `purged_at is null` + `fact_type <> 'oath'` | a re-flag fires nothing; a concurrent double-flip can double-enqueue, and the handler is idempotent | `fixed-in-this-FP` | `migrations/0036_armor_audit_fp10.sql:117,136`; `scripts/verify-fp10-step1.py` |
| 3 | `memory_facts_purge_unsavable_source` (before insert/update) | `new.purged_at := coalesce(new.purged_at, now())`, oath facts excluded | stamps only; a re-fire changes nothing and inserts nothing | `proven` | `migrations/0030_memory_hardening_fp06.sql:169,179`; `scripts/verify-fp06-hardening.py` |
| 4 | `on_profile_created` (the opening message) | source-tag lookup on `metadata->>'source' = 'onboarding_opening'` | a re-fired profile insert adds no second row | `proven` | `migrations/0033_front_door_fp09.sql:73,105`; `scripts/verify-fp09-step1.py` |
| 5 | `job-dispatcher-tick` (`* * * * *`) | `for update skip locked` claim + lease reset + CAS settles | a doubled tick claims disjoint rows | `proven` | `migrations/0010_cron_auth.sql:22`; `migrations/0008_jobs.sql:42`; `scripts/verify-fp10-step2.py` |
| 6 | `watchdog-checkin` (`*/5`) | not-exists on an in-flight `watchdog_checkin` job (an optimisation) + the handler's any-status dedupe | a re-fire enqueues nothing; correctness rests on the handler | `proven` | `migrations/0027_watchdog_cron_fp04.sql:14,29`; `scripts/verify-fp04-step6.py` |
| 7 | `metric-eval-daily` (`*/15`) | not-exists on `(user_id, computed_for)`; the kill switch fails closed first | a re-fire enqueues nothing | `proven` | `migrations/0031_metrics_fp07.sql:107,132`; `scripts/verify-fp07-step5.py` |
| 8 | `drift-scan-every-10m` | a `drift_scan` row newer than 10 minutes short-circuits; the handler dedupes every write | a re-fire enqueues nothing | `proven` | `migrations/0032_accountability_fp08.sql:66,72`; `scripts/verify-fp08-step5.py` |
| 9 | `histogram-daily-every-15m` | not-exists on `(user_id, computed_for)`; config bounds fail closed | a re-fire enqueues nothing | `proven` | `migrations/0032_accountability_fp08.sql:126,157`; `scripts/verify-fp08-step8.py` |
| 10 | `proactive-tick` (`*/30`) | any-status dedupe on `(user, slot, local day)` behind the kill switch, the single-window test and the silence test | a re-fire (and a backdated `p_now` replay) enqueues nothing | `proven` | `migrations/0033_front_door_fp09.sql:211,281,297`; `scripts/verify-fp09-step5.py` |

**Reading note — backdated `p_now`.** The four ticks that take a clock parameter accept it so a
drill can replay a tick's window without waiting. The replay is the *same* dedupe as a real
re-fire — that is the point of the parameter, and it is why the harness uses it rather than
waiting for a schedule.

### 2.4 Client queues and replay keys

The client is where a duplicate request is *born*: a queue that replays must replay something the
server can recognise.

| # | Path | Replay key | Server side | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `lib/sendQueue.ts` (offline chat queue) | the stored `clientMessageId`, replayed verbatim | `messages_user_client_msg_uniq` + the `upsert` ignore → `duplicate` or a repair | `proven` | `lib/sendQueue.ts:17,154`; `app/(app)/chat.tsx:1085`; `scripts/verify-fp03-step6.py` |
| 2 | `lib/checkinQueue.ts` (pending check-in store) | the stored `windowTs` (no client id — a check-in's natural key is its window) | canonicalization + pre-embed duplicate select + the window unique index | `proven` | `lib/checkinQueue.ts:9,62`; `submit-checkin/index.ts:419`; `scripts/verify-fp04-step2.py` |
| 3 | `lib/checkins.ts` (notification re-arm) | deterministic ids `checkin_<user>_<epochHour>`; cancel only ids outside the new set; the dev drill uses `dev_*` | no server write; the schedule converges | `proven` | `lib/checkinGrid.ts:161`; `lib/checkins.ts:210,237`; `scripts/verify-fp04-step6.py` |
| 4 | `lib/checkins.ts` (cold-start reply replay) | `getLastNotificationResponse()` then `clearLastNotificationResponse()` | the cleared response cannot be handled twice | `proven` | `lib/checkins.ts:310,426`; `scripts/verify-fp04-step6.py` |
| 5 | `lib/chat.ts` (pending/optimistic state) | items keyed `client_message_id ?? id`; pending pruned once the row has a primary reply | no write of its own; the key is the server's dedupe key | `proven` | `lib/chat.ts:246,275,319`; `lib/chat.test.ts` |

---

## 3. Parked notes (closed)

Each of these was parked by an earlier pass with "FP-10's audit records it". This is that record.

| Note | Disposition | Evidence |
| --- | --- | --- |
| **Formula editing / history re-evaluation** (FP-07's parked note) | **Closed as a policy, not a feature.** No code path updates `metrics.formula`; the only writers are `insertValidatedMetric` and the dev seed, both `formula_status='validated'` at insert. A deliberate edit is an **owner DB act recorded in the runbook**, and evaluation stays forward from each night — the audit is the whole act. A formula-edit surface would be its own FP | `_shared/metrics/create.ts:34,71,86`; `dev-smoke/index.ts:367`; TECH-SPEC §7.5 |
| **`habits.status = 'cancelled'`** | **Reserved, post-beta.** In the CHECK constraint, written by no path; `quit_committed` is the used terminal state. No writer means no replay surface | `_shared/accountability/habits.ts:8`; `migrations/0007_features.sql:65`; `docs/feature-prds/FP-08/FP-08-ACCEPTANCE.md:60` |
| **Content library** | **Populated and live.** 144 rules across all 16 canonical domains, 233 exemplars, zero unembedded rows (read live 2026-10-28). Placeholder seeds are gone; the library is owner content, so the audit only records its state | live read: `select count(*), count(distinct domain) from rules` = 144/16; `exemplars` = 233; 0 null embeddings |
| **No-writer columns** | **Enumerated.** `metrics.formula_status ∈ {proposed, rejected}` (only `validated` is written); `habits.status='cancelled'`; `config.vapid_public_key` (reserved for a future Web Push step). Each is a value with no writer, so it has no idempotency surface; each is recorded so a future writer knows it is starting from zero | `migrations/0007_features.sql:33,65`; `TECH-SPEC.md` §11 (`vapid_public_key`) |
| **`sync_degrade` orphans** | **Zero, by construction.** The holding reply and its `llm_retry` job are one `write_degrade_pair` transaction (FP-10 Steps 1–2), so the count is zero for a structural reason rather than by sweeping. Re-read at every gate | `scripts/verify-fp10-step1.py`, `scripts/verify-fp10-step2.py` (orphan legs); TECH-SPEC §5.1 |
| **`oath_request` rows** | **Bounded.** The capture window (`oath_request_capture_window_hours = 48`) plus 0036's one-time close of pre-existing stale rows; an unconsumed request older than the window can no longer enshrine an unrelated later message as an oath | `migrations/0036_armor_audit_fp10.sql`; `scripts/verify-fp10-step1.py` (AC-3 legs) |

---

## 4. The verdict ledger

| Verdict | Job handlers | Sync functions | Triggers/ticks | Client queues | Total |
| --- | --- | --- | --- | --- | --- |
| `proven` | 14 | 10 | 9 | 5 | **38** |
| `tolerated-by-design` | 1 | 2 | 0 | 0 | **3** |
| `fixed-in-this-FP` | 0 | 1 | 1 | 0 | **2** |
| `recorded-residual` | 0 | 1 | 0 | 0 | **1** |
| **Total rows** | **15** | **14** | **10** | **5** | **44** |

The one residual is `submit-journal` (§2.2 row 3). Zero rows are unclassified, and every row
carries an evidence link that resolves to a file that exists — the harness in
`scripts/verify-fp10-idempotency.py` re-runs the live half of the register.

---

## 5. How to challenge a verdict

1. Pick a row. Follow its evidence link; run the gate it names.
2. If the gate does not exercise the replay the row claims, the row is wrong — mark it in
   `FP-10-ACCEPTANCE.md` and the agent re-runs or repairs.
3. If you disagree with a `tolerated-by-design`, the question is always "what does the duplicate
   cost the user?" — if the answer is anything but nothing, it belongs in `recorded-residual` with
   a reason, not in `tolerated`.
4. A `recorded-residual` is a scheduling decision, not an acceptance: it names the fix and what
   blocks it, so a later pass starts from the note instead of the discovery.
