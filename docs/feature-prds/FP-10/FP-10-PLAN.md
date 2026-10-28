# FP-10-PLAN.md — Build Plan: Hardening Pass — Idempotency Audit, Injection Sweep, Failover Drill & the Beyond-Beta Gate

**Companion to:** `docs/feature-prds/FP-10/FP-10.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **The final mainline FP — §14 closes here.** **Zero client diffs** (asserted at Steps 6 and 7: the drills, gates, and DDL are server-side; the client's behavior changes only in that hand-crafted API calls it never makes start failing). **Zero new job types — 15/15 is the registry's final state** (asserted, not assumed: nothing in this FP registers a dispatcher case). **Zero columns, zero tables, zero indexes** — migration `0033` is grants, one trigger fn, one seed, and two one-time SQL blocks; the number assumes the next free slot after `0032` (renumber if taken, the standing precedent). **The bounded pre-existing touch set**, each change keeping its FP's gate family green: `flag-unsavable` (drops its own enqueue — the trigger becomes the universal enqueuer), `send-message` (one predicate: the oath capture window), `writeHoldingReplyAndEnqueueRetry` in `_shared/replies.ts` (the transactional pair — both callers inherit), the dispatcher module (test-only edits unless the audit finds a live gap), `_shared/dev/` (the corpus module), `dev-smoke` (one action: `injection-sweep`), and the new `scripts/verify-fp10-*.py` family. **The DDL is written against Step 0's as-read grant matrix, never against this plan's expectation of it** — any divergence is a stop-and-report. **The drills run before the flip, always** — Steps 2–6 exercise `dev_overrides`-independent paths wherever possible, and Step 7 asserts `dev-smoke`'s token independence before flipping; the flip is the last write this FP makes. **Two acts are owner-run** (the quota re-verify afternoon; the flip sign-off) — the agent prepares the runbook, the tables, and the assertions around them.

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-09 closed + the as-read grant matrix + the client surface grep) | ⬜ |
| 1 | Migration 0033: grants, the unsavable trigger, the oath window seed, the one-time closes | ⬜ |
| 2 | The atomic holding+retry + the dispatcher-contract suite | ⬜ |
| 3 | The idempotency audit doc + the consolidated replay harness | ⬜ |
| 4 | The injection sweep: corpus, static gate, `injection-sweep`, live runner | ⬜ |
| 5 | The failover drill: force-fail legs, embed legs, timing re-audit | ⬜ |
| 6 | Full regression sweep, doc write-backs, acceptance doc | ⬜ |
| 7 | The beyond-beta gate: config hygiene, the flip, the quota re-verify (owner), §14 closes | ⬜ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-09/FP-09-ACCEPTANCE.md` exists and the FP-09 tracker is closed (pending owner drill rows acceptable — FP-10 builds on the code); (2) migrations through `0032` are applied and slot `0033` is free; (3) the registry reads fifteen of fifteen implemented — nothing in this FP may add a case (the one assert this FP makes about the dispatcher); (4) **the as-read grant matrix** — for every table in §3: `information_schema.table_privileges` + `column_privileges` for `authenticated`/`anon`/`service_role`, plus `pg_policies` (policy names, commands, roles) → written out as the audit doc's opening table; any divergence from FP-10 FR-1's expected end-state (e.g. a client INSERT path on a table this plan would revoke, an unexpected policy) is a **stop-and-report**, not an improvise; (5) **the client surface grep** — every `supabase.from(...)` call in `lib/` + `app/` with its verb (select/insert/update/upsert/delete) → the keep-set this FP must preserve (expected: `messages` select, `doings_logs` select, `journal_entries` select, `metrics`/`metric_points` select, `profiles` select, `config` select, `push_tokens` upsert; `persona_stats` expected read-only-or-absent — a found write path stops and reports); (6) the profiles-creation path located (trigger on `auth.users`, an auth hook, or a client first-write — decides whether any INSERT grant is load-bearing; the answer is recorded, `profiles` INSERT is left as-found either way); (7) the oath consumption marker located in `send-message`'s capture branch (FP-08's as-built: how "consumed" is written) — the window predicate and the one-time close both edit exactly that read/write pair; (8) `writeHoldingReplyAndEnqueueRetry` in `_shared/replies.ts` + both callers + the current write order (holding row, then job insert — the non-atomic pair this FP joins); (9) the dispatcher's four code paths located — claim/lease, backoff/dead-letter, the budget release (un-started claims), the snooze convention (`{snooze_until}`) — plus `FAST_JOB_TYPES` as-built; (10) the `llm_force_fail` / `llm_stub_mode` plumbing + the adapter's per-call log line shape (provider, kind, latency — the drill's evidence source) + `verify-step11.py`'s harness shape (the timing re-audit's template); (11) the `dev-smoke` action inventory + which legs read `dev_overrides_enabled` (the flip's blast radius — expected: the dev forcer family only; a wider radius stops and reports) + the `DEV_SMOKE_TOKEN` gate; (12) the prompt builders enumerated (every module that interpolates user-derived or content-derived text into a provider call — the static gate's target list); (13) the FP-06 golden byte-identity suite + the FP-02..09 gate families located (the final sweep's inventory) with the planted-`complete` pitfall re-confirmed in each harness; (14) baselines green at their post-FP-09 counts (read from the repo, not this plan): jest suites/tests, `tsc --noEmit` 0, `deno check` clean on the entry points, eslint 0 errors at the standing warning baseline.

**Verify:** all fourteen green. Any failure → stop, fix upstream first; never harden a misread surface.

---

## Step 1 — Migration 0033: grants, the unsavable trigger, the oath window seed, the one-time closes

**Agent does:**

1. Migration `0033_armor_audit_fp10`, written against Step 0's as-read matrix: (a) the grant end-state exactly per FR-1 — `revoke update on profiles from authenticated` + `grant update (display_name) on profiles to authenticated`; `revoke insert, update on messages from authenticated` + `grant update (unsavable) on messages to authenticated`; `revoke select on trust_events from authenticated`; `revoke insert, update, delete on doings_logs, journal_entries, memory_facts, metrics, metric_points, anchor_plans, habits from authenticated`; `revoke update on persona_stats from authenticated`; the `jobs`/`rules`/`exemplars` as-found check recorded in a comment; `push_tokens`/`config`/client SELECTs/RPC executes untouched; **the reverse DDL as a documented comment block** (the one-statement rollback per R-1); (b) `enqueue_purge_on_unsavable()` — plpgsql, `security definer`, `set search_path = public`, fully qualified names; `create trigger messages_unsavable_purge after update on messages for each row when (new.unsavable and not old.unsavable) execute function enqueue_purge_on_unsavable()`; inserts one `purge_memory` job `{message_id: new.id}` (idempotent consumer; concurrent double-flips tolerated per §2.2 clause 4); (c) the seed: `oath_request_capture_window_hours` `48` (proper jsonb + description, the 0014 lesson); (d) the one-time stale-oath close — unconsumed `oath_request` rows older than the window, if any, marked with the as-located consumption marker + `'expired'` reason (a re-run is a no-op by the marker); (e) the one-time orphan count — `messages` with `metadata->>source = 'sync_degrade'` and `reply_to_message_id is not null` whose `metadata->>source_job_id` has no `jobs` row; the count lands in a migration comment and later in the audit doc (expected 0; a nonzero count is reported, not auto-repaired — the payload is unreconstructable, §5.1's note). Nothing else: no column, no table, no index, no RLS change.
2. `flag-unsavable` drops its own explicit enqueue (the trigger is the sole enqueuer now); its validation, flip, and response contract are unchanged; the fn's tests updated to assert the job arrives via the trigger.
3. `send-message`'s oath capture predicate gains the freshness bound (the as-located marker read + `created_at > now() - oath_request_capture_window_hours`); one line, both directions tested.
4. Write-backs in this commit: TECH-SPEC §3.1–3.2 (the grant end-state + the trigger as-built), §5.4 (the capture window), §11 (the key); GLOSSARY §15 (the trigger fn), §16 (the key); PROGRESS entry.

**Verify:** migration applies clean and re-applies idempotently (revokes/grants are naturally idempotent; the seed is `on conflict do update`; the stale-close re-runs as a no-op; the trigger uses `create or replace` + a guarded `create trigger`); **the live grant matrix per AC-1** — raw PATCH `trust_score` denied / `display_name` ok / `update_checkin_prefs` ok; raw `messages` INSERT denied / `content` UPDATE denied / `unsavable` flip ok **and followed by exactly one `purge_memory` job with the facts purged** (AC-2's equivalence, both doors); `trust_events` SELECT denied; `push_tokens` upsert ok; the client regression legs green (thread + chips + quest cards, journal editor, dashboard, settings save, unsavable long-press, a planted `intro` user's interview); the oath window table (fresh → captured; stale → not captured; cooldown still occupied); the FP-02..09 static legs green after the doc edits; `information_schema` diff proves zero columns beyond `0032`.

**Commit refs:** TECH-SPEC §3.1–3.4, §5.4, §7.6, §10, §11; D3, D6, D20; FP-10 FR-1, FR-2, FR-3. **Passes AC-1, AC-2, AC-3.**

---

## Step 2 — The atomic holding+retry + the dispatcher-contract suite

**Agent does:**

1. `writeHoldingReplyAndEnqueueRetry` becomes transactional — the holding-row insert and the `llm_retry` job insert inside one `supabase` client transaction; both callers (`send-message`, `submit-checkin`'s intervention turn) inherit with zero caller changes; the failure semantics are unchanged from the caller's view (a transaction failure surfaces exactly as today's job-insert failure would).
2. The fault-injection unit: a jest suite feeding the helper a client whose job insert throws → asserts the holding row did not land (the rollback) and the error propagates as before; a companion case asserts the happy path writes both.
3. The dispatcher-contract suite: unit tables over the dispatcher module — claim (`for update skip locked`, limit 10, due-order), backoff (`next_retry_at = now() + 2^attempts × 30s`), dead at `max_attempts`, snooze (`{snooze_until}` → pending + pushed retry + `attempts` decremented; **five consecutive snoozes still dead-letter** — the valve), budget release (un-started claims → pending, decremented), lease reset (running > 5 min → pending, increment kept) — plus one live planted-row drill: a snoozing `strike_fire`-shaped row driven through three snoozes, a lease-expired `running` row reclaimed, and a `smoke_test`-family row walked to `dead` (the one job type built for exactly this).
4. `scripts/verify-fp10-step2.py`: the live legs — a `'both'`-degraded turn (via the Step 5 lever early or `dev-smoke ?action=pipeline` under a forced outage) shows both rows + exactly one job; a killed-invocation simulation is NOT attempted live (the platform cannot kill on demand) — the structural argument + the fault-injection unit + the orphan count stand as the evidence, recorded as such.
5. Write-backs: TECH-SPEC §2.2 (the four semantics as audited), §5.1 (the residual closed — the structural argument, the one-time count), §4.1 (the atomic pair note).

**Verify:** the fault-injection unit + the dispatcher unit tables green; the live planted-row drill green (snooze ×3, lease reclaim, dead-letter); the degrade path end-to-end green if the lever is used, else deferred to Step 5 with the dependency noted; the orphan count recorded; `tsc` + `deno check` + `jest` clean; the FP-02..08 degrade-path gates (the Step 8/9 families) still green — the transactional pair must not change any observable row shape.

**Commit refs:** TECH-SPEC §2.2, §4.1, §5.1; D2, D12, D18; FP-10 FR-4, FR-5. **Passes AC-4, AC-5.**

---

## Step 3 — The idempotency audit doc + the consolidated replay harness

**Agent does:**

1. `docs/feature-prds/FP-10/FP-10-IDEMPOTENCY-AUDIT.md`: (a) the as-found grant matrix from Step 0 (the opening table — what was true before `0033`); (b) the write-path matrix — one row per path: the 15 job handlers (each's guard: payload dedup, marker-first writes, source-tag lookups, status guards, any-status dedups, provenance guards), the 8 sync fns (client dedupe keys, canonicalization, 23505 winner-returns, compare-and-set consumes, flip-only enqueues), the triggers/tick guards (the opening trigger's source tag, the cron guards, the new unsavable trigger), and the client queues (offline queue verbatim replay, pending check-in store, the re-arm idempotence) — each row: guard, replay behavior, verdict (`proven` / `tolerated-by-design` / `fixed-in-this-FP` / `recorded-residual`), evidence link (the owning FP's gate or a Step 3–5 leg); (c) the parked-notes section — the formula-edit policy closed (forward-only; no code writer; owner DB act + runbook), `cancelled` (reserved, post-beta), the 5 empty domains (owner batch), the no-writer columns, and the orphan count's number; (d) a maintenance rule: any future write path appends a row in the same change.
2. `scripts/verify-fp10-idempotency.py` — the double-fire matrix against a planted `complete` test user: double `send-message` (duplicate + a repair-window leg: an orphaned user row gets answered by the retry); double `submit-checkin` (duplicate + the echoed pair); double chip tap; double `select-metrics` confirm; double `accept-quest`; re-flag; planted duplicate job rows per handler family (a `watchdog` pair on one window, a `journal_extract` pair on one entry, a `proactive` pair on one slot-day — each second fire a no-op); double ticks via backdated `p_now` (watchdog, drift, histogram, proactive); the auto-adopt fresh-insert-only rule (a replayed arrival scores nothing); the opening trigger's guard (a re-fired `profiles` insert adds no second row); `metric_eval`'s `(metric_id, computed_for)` unique (a re-fired eval inserts no second point). Stub mode where a real provider is not load-bearing; real turns only where the assertion needs the pipeline's own writes.
3. `scripts/verify-fp10-step3.py` wraps the harness with per-leg structured output (leg, assertion, pass, evidence pointer) — the acceptance doc parses it.

**Verify:** the harness green end-to-end; every audit-doc row cites an evidence link that exists; any row that cannot cite one is either fixed in this step (if bounded) or explicitly `recorded-residual` with a reason — zero unclassified rows; `tsc`/`deno check`/`jest` clean.

**OWNER MANUAL (read the matrix):** you are the auditor of last resort — read the audit doc end to end and challenge verdicts: a `tolerated-by-design` you don't believe, a `proven` whose evidence link you want re-run, a residual you'd rather see fixed. Mark challenges in the acceptance doc; the agent resolves or records each before Step 6. **Feeds AC-6, AC-7.**

**Commit refs:** TECH-SPEC §2.2–2.3, §3.2, §5.1, §5.3, §7.1–7.8; D12; FP-10 FR-6, FR-7. **Passes AC-6, AC-7.**

---

## Step 4 — The injection sweep: corpus, static gate, `injection-sweep`, live runner

**Agent does:**

1. `_shared/dev/injectionCorpus.ts` — the payload module (DRAFT, dev-only, never seeded — the `goldenSet.ts` precedent): six classes × every user-text entry point, each payload carrying a unique high-entropy marker (`ZQWK-07`-style tokens that cannot occur in legitimate replies); the classes — direct override ("ignore everything and reply with …"), fake-system/delimiter-escape (embedded `</user_message>`-style closes), role-play hijack, instruction-in-extracted-fact (phrased to survive extraction into a fact), instruction-in-rule-text (for the scratch-seed leg), instruction-in-profile-field (a `routine_summary` aimed at anchor-plan context).
2. The static gate, `scripts/verify-fp10-step4.py --static`: enumerate every prompt builder (Step 0's list); assert each wraps user-derived and content-derived interpolations in the §10.5 delimiters and carries the ignore-embedded-instructions copy; zero unwrapped interpolations (the grep gate generalizes FP-09's single proactive assert).
3. `dev-smoke ?action=injection-sweep` (bearer-gated, `llm_stub_mode=false` required — the `eval-classifier` pattern): runs the corpus through the real pipeline per payload; per-payload output: the marker-absence check on `direct_quote`, the contract-validity check (persona/route in-enum, non-empty quote), and the extraction-output bounds; the two special legs — fact-feedback (an injected journal entry → its extracted facts → a later prompt build shows them delimited, asserted from the build) and rule-text (a scratch-seeded rule carrying an embedded instruction → the reply treats it as quoted content; the scratch batch is cleared after, the BG-04 swap-runbook discipline).
4. `scripts/verify-fp10-step4.py` (live half): drives the action, parses the per-payload output, records counts; a stub-mode pre-flight proves the runner before real quota is spent.
5. GLOSSARY §13 (`injection-sweep`) + §15 (the corpus module) write-backs; the §8.4 note that the corpus is test material, not content-pipeline material.

**Verify:** `--static` green (zero unwrapped interpolations); the live sweep green (markers absent, contracts valid, both special legs); counts recorded; the scratch rule batch cleared; the FP-06 AC-8 legs and the FP-09 AC-11 legs still green (no prompt text changed — if any prompt builder needed a delimiter fix, it is enumerated in the commit and the golden byte-identity suite re-run: a neutral turn's prompt must stay byte-identical unless the fix itself changes neutral output, in which case the golden baseline is re-pinned with the diff documented).

**Commit refs:** TECH-SPEC §10.5, §4.2–4.3, §5.2, §6.4, §7.4, §7.6, §7.7; D13, D17; FP-10 FR-8, FR-9. **Passes AC-8, AC-9.**

---

## Step 5 — The failover drill: force-fail legs, embed legs, timing re-audit

**Agent does:**

1. `scripts/verify-fp10-failover.py` — config-driven through `llm_force_fail` (each leg sets, runs, restores; the restore is asserted after every leg): **leg A `'primary'`** — N=6 sync turns via `dev-smoke ?action=pipeline`: every turn answers (the fallback served inline — the adapter's per-call log lines parsed for provider + kind), zero `llm_retry` jobs created, every reply contract-valid; **leg B `'both'`** — a turn degrades: the holding reply lands as primary (`route='degrade'`, no push — asserted from the push log's silence), exactly one `llm_retry` job exists, `source_job_id` pairs both rows; restore → the job drains on its backoff and the secondary lands with its push; **leg C async under `'both'`** — a planted `intervention` job fails with `attempts` incremented and `next_retry_at` per the §2.2 schedule, then recovers on restore; **leg D embed legs** — a failed embed (the lever or a planted refusal): sync → the §4.1 degrade; check-in → `503 embed_unavailable` (the pending-store replay shape asserted client-side or from the store's contract); `journal_extract` → job failed with the marker unwritten, recovery re-runs it clean; **leg E timing re-audit** — the `verify-step11` harness shape: 20 real turns under normal and 6 under `'primary'`, p50/p90/max recorded server-clock, per-provider counts parsed from the adapter logs, compared against §12's rows.
2. The secrets-shape static assert: the pipeline import stays lazy inside the `llm_retry` handler alone (§13 item 6 — a grep gate over the dispatcher's import graph).
3. Write-backs: TECH-SPEC §4.1 (the drill's as-built + the measured timing addendum), §12 (the timing table's measured rows + the ~451/day confirmation), §13 (item 6 re-verified); the acceptance doc's leg table.

**Verify:** every leg green with its restore asserted; the timing numbers recorded; the per-provider counts inside §12's quotas (a breach is a finding, recorded per R-4 — not silently re-baselined); config ends at safe values (`llm_force_fail` none, `llm_stub_mode` false, `llm_stub_malformed` false — asserted by the script's final act); `tsc`/`deno check`/`jest` clean; zero server code changed unless a leg found a live gap (any fix enumerated + its FP's gate re-run).

**Commit refs:** TECH-SPEC §4.1, §2.2, §7.10, §12, §13; D18, D13; FP-10 FR-10. **Passes AC-10.**

---

## Step 6 — Full regression sweep, doc write-backs, acceptance doc

**Agent does:**

1. The final full regression: every FP-02..09 gate family re-run — `verify-step11.py --turns 6 --cleanup`, `verify-fp03-step7.py --static-only`, the FP-04/05/06/07/08/09 families (the golden byte-identity floor, the new-data regressions, the check-in/journal/onboarding/proactive/content legs) — **all with test users planted `complete`** where the legs touch user state (the named pitfall, documented in each harness), plus the FP-10 family (Steps 1–5's scripts).
2. `docs/feature-prds/FP-10/FP-10-ACCEPTANCE.md`: the AC ledger (ids parsed from `FP-10.md` so the two cannot drift), evidence tags (`[script]` / `[measured]` / `[owner-observed]` / `[derived]`), the recorded-readings section (every **[recorded reading]** from the FRs: `display_name` as the sole client-writable profiles column, the universal-enqueuer design, the oath freshness bound, atomicity-over-sweep, the forward-only formula policy, the kept SELECT surfaces, the corpus-as-test-material, the drills-before-flip ordering), the failover leg table + timing numbers, the injection counts, the grant matrix's end-state, the write-back ledger, and a re-run recipe.
3. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §2.2 (the four semantics as audited), §3.1–3.2 (the grant end-state + the trigger + the closed live items), §5.1 (the residual closed), §7.6 (the universal enqueuer), §10 (the hardening as-built — the grant matrix, the sweep results, the delimiters' universal coverage), §11 (one key), §12 (the recount stands + the measured timing addendum), §13 (the bypass live items closed; items 4 and 8 pending only their owner acts); GLOSSARY §7 (the dispatcher-contract terms), §13 (`injection-sweep`), §15 (the new identifiers), §16 (the key). §14's closure write-back is deliberately **held for Step 7** — item 11 completes with the flip, not before.
4. Secret scan + AGENTS.md §9 checklist: no new table / RLS policy / dependency / paid service / job type / `[SPEC]` hardcoded; zero columns; zero client diffs (the `git diff` assert); the enumerated touch set is the whole server diff.

**Verify:** every AC marked with evidence except the owner-gated rows (AC-11's flip + AC-12's quota half sit ⏳ pending Step 7 — the FP-03 AC-8 precedent); all regression legs green; write-back diffs present; repo clean.

**Commit refs:** TECH-SPEC §2.2–§14 passim; FP-10 FR-6..FR-12. **Passes AC-1..AC-10 fully; feeds AC-11, AC-12.**

---

## Step 7 — The beyond-beta gate: config hygiene, the flip, the quota re-verify (owner), §14 closes

**Agent does:**

1. The pre-flip asserts: the config hygiene table (`llm_stub_mode` false, `llm_force_fail` none, `llm_stub_malformed` false — read live, any drill-moved key already restored by its script); `dev-smoke`'s independence from `dev_overrides_enabled` proven (one token-gated leg re-run with the flag still true, its behavior flag-independent — the blast-radius check R-5 rests on).
2. **The flip** (after the owner's sign-off below): `update config set value = 'false' where key = 'dev_overrides_enabled'` — one write, no redeploy; then the post-flip verification: a `dev_force`-carrying `send-message` turn routes naturally (the row's `metadata.route`/persona show the natural decision, not the forced one); the client forcer is inert in a dev build (its own double gate); a `dev-smoke` drill leg re-runs clean behind its token.
3. The quota re-verify runbook (prepared by the agent, run by the owner — the command list + expected-output table + a results table to fill): every §12 row against the providers' current published terms — Gemini Flash-Lite generation (15 RPM / 500 RPD), Groq fallback (30 RPM / 1,000 RPD), Gemini embeddings (100 RPM / 30K TPM / 1,000 RPD), Edge invocations (500K/mo, 150 s), Realtime (200 peak), cron-job.org still pinging `health`, the Supabase free-tier pause policy, and the APNs standing note (membership unfunded — the iOS fallback remains the amendment of record). Results + dates into the acceptance doc; any tightened tier recorded against §12's headroom column per R-8.
4. The final write-backs: TECH-SPEC §13 (items 4 and 8 discharged — with dates; the flip recorded; the amendment chain intact), **§14 (item 11 complete — the implementation order closes: all eleven items, FP-01 through FP-10)**; GLOSSARY maintenance pass; the audit doc's closing note (the register stands, the maintenance rule lives).
5. `scripts/verify-fp10-step7.py`: the post-flip assertions in script form (the natural-route turn, the inert forcer shape, the token-gated drill leg, the hygiene table) so the gate is re-provable at any time.

**Verify:** the post-flip script green; the owner's quota table filled and recorded; the §13/§14 write-backs landed; every earlier FP's static leg re-run green after the doc edits (the baseline-fix lesson, one last time); the tracker closes — **⬜ → ✅ across the board, with the owner-observed rows tagged**.

**OWNER MANUAL (the closing afternoon, then the list is done):** **(1) The quota re-verify** — run the prepared checklist against each provider's current terms (fifteen minutes of console reading; fill the table with numbers and dates). If a tier tightened, record it against §12's headroom and decide then whether the 5-user boundary holds — that is §13 item 4's escalation, a budget decision, never a code change. **(2) The flip sign-off** — confirm the Step 3 challenges are resolved and the drills are recorded, then tell the agent to flip: `dev_overrides_enabled` goes false, and with it the last scope-leakage surface closes. Watch the post-flip verification run: a forced turn routing naturally is the whole proof. **(3) Read the audit doc one last time as the beyond-beta checklist** — every row proven or honestly parked; this plus the quota table is the dated gate record for inviting user #6. When the tracker closes, §14 is done: eleven items, ten FPs, one machine — armored, audited, and beyond-beta ready.
