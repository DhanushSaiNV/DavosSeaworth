# FP-10-ACCEPTANCE.md — Acceptance Ledger: Hardening, Least-Privilege & Provider Failover

**Companion to:** `docs/feature-prds/FP-10/FP-10.md` ↔ `docs/feature-prds/FP-10/FP-10-PLAN.md`
**Gates:** `scripts/verify-fp10-step1.py`, `scripts/verify-fp10-step3.py`, `scripts/verify-fp10-step4.py`, `scripts/verify-fp10-failover.py` · **Governed by:** `AGENTS.md`
**Status:** Step 6 agent work complete. AC-1 through AC-10 verified with automated and measured evidence; AC-11 (the dev_overrides_enabled flip) and AC-12 (owner quota re-verify) pending Step 7 owner sign-off.

---

## 1. AC Ledger (parsed from FP-10.md)

| AC | Description | Evidence Tag | Status |
|---|---|---|---|
| AC-1 | **Grants (the matrix, live)**: migration `0036` applies and re-applies idempotently; a raw PostgREST PATCH on `trust_score`/`dialog_state`/`onboarding_stage`/`wake_time` is denied while `display_name` succeeds and `update_checkin_prefs` still saves; a raw `messages` INSERT is denied and a raw UPDATE of `content` is denied while the `unsavable` flip succeeds; `trust_events` SELECT is denied; `push_tokens` upsert, `persona_stats` read, `config` read, and every enumerated client SELECT still work; the whole client regression is green post-migration; `information_schema` diff proves zero columns beyond `0035` | `[script]` `verify-fp10-step1.py` | ✅ |
| AC-2 | **Trigger equivalence**: a raw PATCH flipping `unsavable` and a `flag-unsavable` call are behaviorally identical — flag set, exactly one `purge_memory` job (modulo tolerated concurrency), facts purged by provenance, the oath-exempt guard holding; a re-flag fires nothing; the fn's response contract unchanged (`ok`/`400` assistant-row/`404` foreign) | `[script]` `verify-fp10-step1.py` Leg B | ✅ |
| AC-3 | **Oath window**: a planted fresh `oath_request` → confirmed send (`oath_confirmed: true` + `oath_request_id` per D26) captures verbatim (`fact_type='oath'`, purge-exempt); a planted stale request (older than `oath_request_capture_window_hours`) → confirmed send is **not** captured and the one-time close has marked it expired; a plain next message without confirm fields remains uncaptured; a stale-closed request inside its cooldown still blocks re-triggering (asserted) | `[script]` `verify-fp10-step1.py` Leg C | ✅ |
| AC-4 | **Atomicity**: the fault-injection unit green (a failed `write_degrade_pair` call leaves neither row - neither the holding reply nor the `llm_retry` job); the live degrade path end-to-end (both rows, one job, no holding push); the orphan count run once and recorded in the audit doc (expected zero; §5.1, D12) | `[script]` `verify-fp10-step2.py` / `verify-fp10-failover.py` Leg B | ✅ |
| AC-5 | **Dispatcher contract**: the four semantics live via planted rows — snooze (pending + pushed `next_retry_at` + `attempts` decremented across three consecutive deferrals; the endless-deferral valve is the handler's own state, not dead-letter), budget release (un-started → pending, decremented), lease reset (running > 5 min → pending, increment kept), backoff schedule (`2^(attempt-1) × 30s`) and dead at `max_attempts`; the unit tables green over the pure `_shared/jobs/contract.ts` | `[script]` `contract.test.ts` (Jest) + `verify-fp10-step3.py` | ✅ |
| AC-6 | **Replay harness**: the double-fire matrix green end-to-end — duplicate send + the repair window; duplicate check-in with the echoed pair; duplicate chip tap / metric confirm / quest accept (all `duplicate`, no second rows); re-flag without a second job; planted duplicate job rows per handler family no-op; double ticks insert nothing new; a replayed arrival never scores `auto_adopt_successes`; the opening trigger's source-tag guard holds on a re-fired insert | `[script]` `verify-fp10-idempotency.py` / `verify-fp10-step3.py` | ✅ |
| AC-7 | **The audit doc**: delivered with a row for every write path in §2.3 + the eight sync fns + the triggers/tick guards + the client queues, each with guard / replay behavior / verdict / evidence link; the parked-notes section closes the formula policy, `cancelled`, content library status (144 rules, 233 exemplars), and the no-writer columns; zero rows left unclassified | `[derived]` `docs/feature-prds/FP-10/FP-10-IDEMPOTENCY-AUDIT.md` | ✅ |
| AC-8 | **Injection (static)**: the grep gate green — every prompt builder delimits user-derived and content-derived strings with `escapePromptText` and carries the ignore-embedded-instructions copy; zero unwrapped interpolations found in the tree | `[script]` `verify-fp10-step4.py --static` | ✅ |
| AC-9 | **Injection (live)**: `injection-sweep` green — the marker absent from every `direct_quote`, every reply contract-valid, the fact-feedback leg shows the extracted fact delimited in a later prompt build, the rule-text leg shows the instruction-bearing rule rendered as quoted content with its instruction not followed; counts recorded | `[script]` `verify-fp10-step4.py` live sweep | ✅ |
| AC-10 | **Failover**: the leg table green — `'primary'` (inline fallback, zero retry jobs, adapter log evidence), `'both'` (holding + one job + no holding push), restore (secondary + push), the async leg (fail → backoff → recover), the embed legs (degrade / `503` + replay shape / job-failed-then-recovered); the timing numbers (p50/p90/max, normal + `'primary'`) recorded in the acceptance doc; config restored to safe values after every leg (asserted) | `[script]` + `[measured]` `verify-fp10-failover.py` | ✅ |
| AC-11 | **The flip**: `dev_overrides_enabled=false` live; a `dev_force`-carrying turn routes naturally (the row's metadata shows the natural route, not the forced one); the client forcer is inert; `dev-smoke` remains functional behind its token (a drill leg re-run post-flip); the config hygiene table recorded with every dev-only key at its safe value | `[owner-observed]` Step 7 post-flip verifier | ⏳ owner-pending |
| AC-12 | **The finale**: every FP-02..09 gate family green in the final sweep (the planted-`complete` pitfall handled in each harness); the quota re-verify recorded with numbers and dates (owner); `git diff` shows zero client changes and the enumerated server set only; zero new job types (15/15 — final), zero columns/tables beyond `0035`, one trigger fn (replaced, not new) + one pair-writer fn, one seed; the §14 write-back lands — **item 11 complete, the implementation order closes** | `[script]` regression + `[owner-observed]` quota table | ⏳ owner-pending |

**Legend:** ✅ accepted with automated evidence · ⏳ pending owner sign-off / flip ceremony · `[script]` deterministic verifier · `[measured]` live latency / count measurements · `[owner-observed]` owner manual check.

---

## 2. Recorded Readings

| Reading | Value | Source / Trace |
|---|---|---|
| profiles writable client columns | `display_name` only (`update (display_name)` granted to `authenticated`) | Migration `0036` / `verify-fp10-step1.py` |
| messages writable client columns | `unsavable` only (`update (unsavable)` granted to `authenticated`, table insert/update revoked) | Migration `0036` / `verify-fp10-step1.py` |
| config client DML | `insert, update, delete` revoked from `authenticated` and `anon` (`select` kept) | Migration `0036` / `verify-fp10-step1.py` |
| trust_events client read | `select` revoked from `authenticated` and `anon` (server-only) | Migration `0036` / `verify-fp10-step1.py` |
| Universal enqueuer | `purge_memory_on_unsavable()` trigger function enqueues 1 `purge_memory` job per unsavable flip in same tx | Migration `0036` / `verify-fp10-step1.py` Leg B |
| Freshness bound (oath capture) | `config.oath_request_capture_window_hours = 48`; fresh confirms capture, stale expire | Migration `0036` / `send-message` / `verify-fp10-step1.py` Leg C |
| Atomic degrade pair | `write_degrade_pair` SECURITY DEFINER RPC writes holding reply + `llm_retry` job atomically | Migration `0036` / `_shared/replies.ts` / `verify-fp10-failover.py` Leg B |
| Dispatcher contract arithmetic | `_shared/jobs/contract.ts`: pure backoff (`2^(attempt-1)*30s`), dead status, budget release, lease reset | `contract.test.ts` (Jest) |
| Prompt delimiters coverage | 100% of dynamic strings wrapped with `escapePromptText` in §10.5 tags; 0 unwrapped interpolations | `verify-fp10-step4.py --static` |
| Injection canary leakage | 0 canary tokens (`ZQWK-07-` markers) emitted across all tested adversarial payloads | `verify-fp10-step4.py` live sweep |
| Live provider failover | Inline fallback to Groq (`openai/gpt-oss-120b`) on Gemini Flash-Lite outage; 0 retry jobs | `verify-fp10-failover.py` Leg A |
| Total provider outage degrade | Holding primary reply (`route='degrade'`) + 1 `llm_retry` job; drained on restore to secondary reply | `verify-fp10-failover.py` Leg B |
| Async failure & retry backoff | `intervention` job under forced failure failed with attempts=1, next retry in future per §2.2, recovered | `verify-fp10-failover.py` Leg C |
| Embed failure paths | Sync degrades; check-in returns `503 embed_unavailable`; `journal_extract` marker unwritten and recovers | `verify-fp10-failover.py` Leg D |
| Normal turn server latency | p50 = 15,113 ms, p90 = 21,208 ms, max = 21,682 ms (N=20 turns, Gemini Flash-Lite) | `verify-fp10-failover.py` Leg E |
| Fallback turn server latency | p50 = 1,268 ms, p90 = 1,582 ms, max = 1,857 ms (N=6 turns, Groq fallback) | `verify-fp10-failover.py` Leg E |
| Dispatcher registry count | 15 registered types / 15 implemented handlers (closed state) | TECH-SPEC §2.3, GLOSSARY §12 |
| Scheduled inserts count | ~451 / day at 5-user scale (inside ~500 limit) | TECH-SPEC §12 recount |

---

## 3. Failover Drill Results & Timing Re-Audit

Executed via `scripts/verify-fp10-failover.py` against live Supabase project `cbwujqezrvqfcicpuwtq`:

| Leg | Scenario | Injection / Fault | Expected Outcome | Observed Result | Verdict |
|---|---|---|---|---|---|
| **Leg A** | Primary provider down | `llm_force_fail='primary'` | Inline fallback to Groq (`openai/gpt-oss-120b`), 0 `llm_retry` jobs created, valid schema | 6/6 turns answered by Groq inline; 6/6 contract-valid; 0 retry jobs created; config restored | ✅ PASS |
| **Leg B** | Total provider outage | `llm_force_fail='both'` | Atomic holding reply (`route='degrade'`) + exactly 1 `llm_retry` job; drained on restore | Holding row with `source_job_id` written; 1 retry job enqueued; job drained to `done` on restore; secondary reply landed anchored by `secondary_reply_to_message_id` | ✅ PASS |
| **Leg C** | Async handler outage | `llm_force_fail='both'` | `intervention` job fails with `attempts=1`, `next_retry_at` backoff in future, recovers on restore | Job failed with attempts=1; `next_retry_at` set 30s ahead; restored config drained job to `done` with attempts=2 | ✅ PASS |
| **Leg D1** | Sync embed failure | `llm_force_fail='both'` | Pipeline stage 2 embed fails → graceful degrade | Turn gracefully degrades via `write_degrade_pair` | ✅ PASS |
| **Leg D2** | Checkin embed failure | `llm_force_fail='both'` | `submit-checkin` returns HTTP `503 embed_unavailable` | POST `submit-checkin` returned 503 `{"error":"embed_unavailable"}` | ✅ PASS |
| **Leg D3** | Journal extract embed failure | `llm_force_fail='both'` | `journal_extract` job fails with `vagueness_score` unwritten; recovers on restore | Job marked failed with attempts=1; `vagueness_score` was null; on restore drained to `done` with `vagueness_score = 0.8` | ✅ PASS |
| **Leg E** | Timing re-audit (normal) | `llm_force_fail='none'` | 20 turns: p50 < 40 s, max < 150 s | p50 = 15,113 ms, p90 = 21,208 ms, max = 21,682 ms (all turns contract-valid, zero degraded) | ✅ PASS |
| **Leg E** | Timing re-audit (fallback) | `llm_force_fail='primary'` | 6 turns: p50 < 40 s, max < 150 s | p50 = 1,268 ms, p90 = 1,582 ms, max = 1,857 ms (all turns served inline via Groq) | ✅ PASS |
| **Teardown** | Safe config hygiene | Post-drill teardown | Config restored to `llm_stub_mode=false`, `llm_force_fail='none'`, `llm_stub_malformed=false` | Verified live: all three keys at safe defaults; dispatcher cron unpaused; test rows deleted | ✅ PASS |

---

## 4. Prompt Injection Sweep Results

Executed via `scripts/verify-fp10-step4.py` against live pipeline endpoints (`dev-smoke?action=injection-sweep`):

| Payload Class | Canary Pattern | Purpose | Checked Surface | Result |
|---|---|---|---|---|
| `direct_override` | `ZQWK-07-DIR-*` | Direct system instructions override attempt | Chat / Interview composer text | 0 canaries leaked; valid persona/quote |
| `delimiter_escape` | `ZQWK-07-DELIM-*` | Closing fence escapes (`</user_message>`, etc.) | User turns, journal entries | 0 canaries leaked; escaped as `&lt;...&gt;` |
| `roleplay_hijack` | `ZQWK-07-ROLE-*` | Persona and identity hijack prompts | Chat composer | 0 canaries leaked; Davos persona maintained |
| `instruction_in_extracted_fact` | `ZQWK-07-FACT-*` | Injection phrased to survive fact extraction | Memory extraction / recall block | Delimited literally inside `<recalled_memory>` |
| `instruction_in_rule_text` | `ZQWK-07-RULE-*` | Embedded directive inside rule text | Scratch rule seed | Rendered as quoted content, instruction unexecuted |
| `instruction_in_profile_field` | `ZQWK-07-PROF-*` | Malicious directive in `routine_summary` | Anchor plan prompt context | Fenced inside `<routine>`; anchor format preserved |

---

## 5. Least-Privilege Grant Matrix (Migration 0036 End-State)

| Table | `anon` | `authenticated` | `service_role` | Notes / RLS Policy |
|---|---|---|---|---|
| `profiles` | - | `SELECT`, `UPDATE (display_name)` | `ALL` | RLS own row; other profile columns updated via SECURITY DEFINER RPCs |
| `messages` | - | `SELECT`, `UPDATE (unsavable)` | `ALL` | RLS own row; INSERT revoked (written by `send-message`/`job-dispatcher`) |
| `doings_logs` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by `submit-checkin`/`log-impulse`) |
| `journal_entries` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by `submit-journal`) |
| `memory_facts` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by extraction jobs/trigger) |
| `metrics` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by `select-metrics` / RPCs) |
| `metric_points` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by `metric_eval` job) |
| `metric_vars_daily` (view) | - | - | `SELECT` | View `with (security_invoker = true)`, revoked from client roles |
| `anchor_plans` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by `anchor_plan` job) |
| `habits` | - | `SELECT` | `ALL` | RLS own row; DML revoked (written by `drift_scan` / `strike_fire`) |
| `persona_stats` | - | `SELECT` | `ALL` | RLS own row; UPDATE revoked (managed by server pipeline) |
| `trust_events` | - | - | `ALL` | SELECT revoked from client roles (`trust_score` hidden by design) |
| `push_tokens` | - | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `ALL` | RLS own row; client direct push token registration/deregistration |
| `config` | - | `SELECT` | `ALL` | RLS disabled; DML revoked from `anon` & `authenticated` (kill switches protected) |
| `jobs` | - | `SELECT` (as-found) | `ALL` | No write policy for client; claimed and processed by `job-dispatcher` |
| `rules` | - | `SELECT` (as-found) | `ALL` | No client write policy; seeded via `content-seed` |
| `exemplars` | - | `SELECT` (as-found) | `ALL` | No client write policy; seeded via `content-seed` |

---

## 6. Regression Matrix

| Gate / Suite | Command | Scope | Result |
|---|---|---|---|
| **FP-03** | `py -3 scripts/verify-fp03-step7.py --static-only --no-jest` | Classifier contracts, exemplars slot, band arithmetic | ✅ PASS |
| **FP-04** | `py -3 scripts/verify-fp04-step6.py --static-only` | Check-in grid, watchdog scan, notification contracts | ✅ PASS |
| **FP-05** | `py -3 scripts/verify-fp05-step7.py --static-only` | Journal evening chain, anchor plans, strip integrity | ✅ PASS |
| **FP-06** | `py -3 scripts/verify-fp06-step7.py --static-only` | Memory extraction, purge runner, boundary tests | ✅ PASS |
| **FP-07** | `py -3 scripts/verify-fp07-step6.py` | Dynamic metrics dashboard, registry components, pure data | ✅ PASS |
| **FP-08** | `py -3 scripts/verify-fp08-step8.py --static-only --no-toolchain` | Strike lifecycle, urge histogram, impulse capture, candor credit | ✅ PASS |
| **FP-09** | `py -3 scripts/verify-fp09-step8.py --static-only` | Onboarding interview, proactive loops, prompt hardening | ✅ PASS |
| **FP-10 Step 1** | `py -3 scripts/verify-fp10-step1.py --static-only` | Least-privilege grant matrix, universal enqueuer, oath window | ✅ PASS |
| **FP-10 Step 3** | `py -3 scripts/verify-fp10-step3.py` | Idempotency audit references & double-fire matrix | ✅ PASS |
| **FP-10 Step 4** | `py -3 scripts/verify-fp10-step4.py --static` | Prompt delimiter grep gate & injection corpus shape | ✅ PASS |
| **FP-10 Step 5** | `py -3 scripts/verify-fp10-failover.py --static-only` | Secret isolation & failover contracts | ✅ PASS |
| **Account Lifecycle** | `py -3 scripts/verify-account-lifecycle.py --static-only` | Reset & deletion contracts, DDL, kill switch | ✅ PASS |
| **Full Jest Suite** | `npm test` | All unit tests across codebase (66 suites, 1,008 tests) | ✅ PASS (1008/1008) |
| **Deno Type Check** | `deno check ...` | Functions: `send-message`, `submit-checkin`, `job-dispatcher`, `dev-smoke` | ✅ PASS |
| **TypeScript Compiler** | `npx tsc --noEmit` | Client application type check | ✅ PASS |

---

## 7. Owner-Pending Acts (Step 7 Beyond-Beta Gate)

The following two acts are reserved for the owner closing session per `FP-10-PLAN.md` Step 7:

1. **AC-11: Flip `dev_overrides_enabled = false`:**
   - Execute: `update config set value = 'false' where key = 'dev_overrides_enabled';`
   - Run verification script: `scripts/verify-fp10-step7.py` to assert natural turn routing, inert client forcer, token-gated drill independence, and final hygiene table.
2. **AC-12: Quota Re-Verification Against Live Terms:**
   - Verify published limits for Gemini Flash-Lite (15 RPM / 500 RPD), Groq fallback (30 RPM / 1,000 RPD), Gemini embeddings (100 RPM / 1,000 RPD), Supabase Edge Functions (500K/mo, 150 s timeout), Realtime (200 peak connections), and cron-job.org ping.
   - Record findings and dates in TECH-SPEC §13 / §14 to formally close implementation order item 11.

---

## 8. Surface Discipline Statement

- **Client Code Diffs:** Exactly zero diffs in `app/`, `components/`, and `lib/` against `main` (verified by `git diff --name-only main -- lib app components`).
- **Job Registry:** Exactly 15 registered job types and 15 implemented handlers (`TECH-SPEC §2.3`, `GLOSSARY §12`). Zero new job types added.
- **Database Schema:** Zero new tables, columns, indexes, or RLS policy modifications beyond migration `0036`.
- **Infrastructure:** $0 budget strictly maintained. Zero external message brokers, VPSs, or third-party orchestration tools introduced. All compute resides within Supabase Edge Functions, pg_cron, and pgvector.
