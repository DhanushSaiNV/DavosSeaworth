# FP-02 Acceptance Checklist

**Generated:** 2026-10-16
**Updated:** 2026-10-16 (AC-2, AC-7, AC-8, AC-9, AC-10 live verification complete)
**Companion to:** `docs/feature-prds/FP-02/FP-02.md` · build plan `docs/feature-prds/FP-02/FP-02-PLAN.md`
**Status:** **12/12 ACs PASS — FP-02 accepted.**

> **How to read the Evidence column.** The tag says *how* the claim was established, not just what was checked — the FP-01 review criticised evidence that asserted a result without showing it was elapsed or observed.
> **[script]** — an automated check re-runs it from the repo (`scripts/verify-step11.py` group A offline; groups B live).
> **[measured]** — a real run against the live project, with the date/commit of record.
> **[owner-observed]** — requires human eyes or a device; cannot be automated.
> **[derived]** — follows from another check rather than being checked directly.

---

## Acceptance Criteria Results

| AC | Description | Status | Evidence (how) |
|----|-------------|--------|----------------|
| **AC-1** | Send any message → user row + assistant row; `messages.metadata` and `messages.content` contain zero `tactical_analysis`; Edge Function logs contain it (both directions). | ✅ PASS | **[script]** group A: across `send-message`, `select-persona` and `job-dispatcher`, the only `tactical_analysis` occurrence is the `[send-message] tactical_analysis:` diagnostic, and every parsed `metadata: Record<string, unknown>` block is free of `tactical`. **[measured]** Steps 4/5a live runs established the row/log split in both directions (PROGRESS 2026-10-15). The Step 11 audit re-asserts "no audit row carries the string in `content`" over the rows it creates. |
| **AC-2** | 10-turn conversation shows zero "As an AI…", zero generic-apology filler, in-character tone throughout (qualitative gate, D13; prompt iteration expected — record v1 shortfall notes for the hardening pass). | ✅ PASS | **[owner-observed, 2026-10-16]** the 20-turn audit thread was read end-to-end and judged in character throughout — zero "As an AI…", zero generic-apology filler (20 ⊃ the AC's 10). Standing v1 shortfalls for the hardening pass (TECH-SPECS §14 item 11): `therapist_empath` reads more generic than `mentor_tough` (PROGRESS Step 6), and Groq's `persona_options[].key` enum drift (PROGRESS 2026-10-15). |
| **AC-3** | Dev override → Medium: message carries 2–3 `persona_options`, chips render, tap → `select-persona` → new assistant message in the chosen persona; consumed options reject re-selection. | ✅ PASS | **[measured]** Step 6 live verify (`22ccb74`; PROGRESS 2026-10-15) — a forced-Medium turn, a chip tap, and the chosen-persona reply. **[script, live]** group B3 re-checks route `options`, 2–3 options offered, the tap producing exactly one secondary reply (`persona_key` set, `reply_to_message_id` NULL, `metadata.route='options'`) and a second tap as a no-op (`duplicate`, still one row). Chip *rendering* stays owner-observed. |
| **AC-4** | Dev override → Low: explicit interaction-mode question; <0.40: inquirer-style clarifying question, domain recorded as `General`. | ✅ PASS | **[measured]** Step 6 live verify (`22ccb74`) — forced-Low question and the `General`/fallback domain. **[script, live]** group B3 re-checks `route='low_question'` with a question-shaped reply, and `dev_force={tier:'fallback'}` → `route='fallback'`, `domain='General'`, inquirer persona. |
| **AC-5** | With the seeded conflicting rule pair, retrieval passes exactly one tone group (debug field or server log of surviving rule ids). | ✅ PASS | **[measured]** Step 2 (PROGRESS) — the crafted `Discipline/Habits` fixture: aggressive 80 / empathetic 70, gap 10 ≤ `conflict_priority_window` 15, so the lower-priority group is dropped. **[script, live]** group B4 re-checks via `dev-smoke?action=retrieve`: exactly one surviving tone, `droppedTone='empathetic'`, ≤ 5 survivors, plus a `Career` control where the filter must **not** fire (needs `DEV_SMOKE_TOKEN`; without it the Step 2 evidence stands). |
| **AC-6** | Forced provider failure: immediate `sync_degrade_reply` + push; `llm_retry` completes on the fallback provider and the real reply arrives + pushes; both providers dead → dead-letter, no loop. | ✅ PASS | **[measured, 2026-10-16]** Step 8 live verify passed via `scripts/verify-step8.py`: holding reply as the primary turn, `llm_retry` answered on the fallback provider, `metadata.source_job_id` on both rows, `dead` at attempt 5 with no further attempts. |
| **AC-7** | Background the app (Android) → send from web → notification arrives (collapse key groups repeats); chat foregrounded → no notification, message renders via Realtime <2 s. | ✅ PASS | **[owner-observed, 2026-10-16]** the Android push matrix was run — background notification on a web-originated send, repeat grouped under collapse key `chat_{userId}`, foreground suppression with the Realtime render, zero-token send succeeding, invalid token deleted on receipt. Token registration was already confirmed (`[push] registered android token`). |
| **AC-8** | Airplane mode → send 2 → queue locally in order → reconnect → both delivered exactly once (row count) → pipeline runs per message. | ✅ PASS | **[script, live + owner-observed, 2026-10-16]** `scripts/verify-step9.py` live section passed (per-message pipeline, exactly-once via row count, replayed-cid dedupe), the airplane-mode device leg passed on the rebuilt dev client (NetInfo), and `verify-step11.py` group B6 re-asserted the dedupe half (`duplicate`, no second row). |
| **AC-9** | Reply within 10 min of a High-tier reply → `persona_stats.auto_adopt_successes` +1; reply after 10 min → unchanged. | ✅ PASS | **[script, live, 2026-10-16]** `scripts/verify-step10.py` passed against the migrated project — the counter deltas hold for the happy path, the `auto_adopt_window_minutes` window, route gating (`options`/`low_question`/`fallback` unchanged), the `llm_retry`-shaped secondary-row exclusion, the primary-`route='auto'` positive control, the missing-domain guard and exactly-once. |
| **AC-10** | Timing log across 20 turns: p50 < 40 s, max < 150 s; per-provider call counts within quotas. | ✅ PASS | **[script, live, 2026-10-16]** `verify-step11.py` groups B1/B2 passed on a real 20-turn conversation — every assertion in the table below. Raw numbers were not transcribed into this document; re-run the command below to reproduce them. |
| **AC-11** | Placeholder rules all carry the dev label and are removable in one step; final-content paths untouched. | ✅ PASS | **[script]** group A: the seed writes `source_figure='PLACEHOLDER-DEV'` on every row, `clear-rules` is a single `source_figure` predicate, and a repo-wide scan finds no other rule-insert path in `supabase/`. **[script, live]** group B5 round-trips labeled-count → clear → 0 → seed → back to the original count (needs `DEV_SMOKE_TOKEN`). |
| **AC-12** | Doc write-backs in the same change: `messages.client_message_id` in §3.2, §11 registry additions, any new identifiers in GLOSSARY. | ✅ PASS | **[script]** group A ledger — see "Write-back ledger" below. |

---

## Timing & quota audit (AC-10)

**Runbook (owner).** The audit is the AC-10 evidence *and* the AC-2 material, so the two are produced by one run.

```powershell
$env:SUPABASE_URL="https://cbwujqezrvqfcicpuwtq.supabase.co"
$env:SUPABASE_ANON_KEY="<anon key>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role key>"
$env:DAVOS_USER_JWT="<signed-in user JWT>"
$env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"   # enables the AC-5 / AC-11 live halves
python scripts/verify-step11.py --turns 20 --logs adapter-log.txt
```

`--logs` is optional: per-provider counts are only in the adapter's per-call log lines, because nothing persists provider or latency to a row. Without the file the section prints the extraction recipe and the arithmetic projection, and never fails. The audit runs 20 turns against the **real** providers (~60 Gemini calls, 5–13 minutes); it snapshots and restores `llm_stub_mode`, `llm_stub_malformed`, `llm_force_fail`, `auto_adopt_window_minutes` and `dev_overrides_enabled` in a `finally`, and keeps the rows (pass `--cleanup` to delete them).

| Metric | Assertion | Verdict |
|---|---|---|
| Turns completed | 20, none degraded | ✅ pass |
| Turn latency p50 (server clock) | < 40 000 ms | ✅ pass |
| Turn latency p90 (server clock) | report only | ✅ pass |
| Turn latency max (server clock) | < 150 000 ms | ✅ pass |
| Client-observed p50 / max (vs `client_sent_at`) | report only | ✅ pass |
| Audit wall-clock | report only | ✅ pass |
| Row integrity | 1 user row per turn, ≥ 1 reply, no duplicate `client_message_id`, zero `tactical_analysis` | ✅ pass |
| Gemini generate calls | ≤ 500 RPD | ✅ pass |
| Gemini embedding calls | ≤ 1 000 RPD | ✅ pass |
| Groq calls | ≤ 1 000 RPD | ✅ pass |
| Per-call latency p50 / max | report only | ✅ pass |

**Measured vs projected.** The §12 Sync-path row (typical 15–40 s, bounded worst case ≈ 120 s) is a *projection* from the stage arithmetic and the `llm_call_timeout_ms` budget. The audit's elapsed server-clock numbers stayed inside it. The raw values were not transcribed into this document (the harness prints them); re-run the command above to reproduce them, and paste them here if a point-in-time record is wanted.

**Status: PASS — owner live run, 2026-10-16** (20 real-provider turns, no degraded turn; every assertion above passed).

---

## Write-back ledger (AC-12)

Every item below is re-verified from the repo by `scripts/verify-step11.py` group A (fail-closed: a missing row or an unmarked dev-only key fails the run).

| Write-back | Location | Verified |
|---|---|---|
| `messages.client_message_id` column | TECH-SPECS §3.2 | ✅ |
| `messages_user_client_msg_uniq` unique index (dedupe) | TECH-SPECS §3.2 | ✅ |
| §11 registry holds all **30** keys — FP-01's 12 + FP-02's 18: `llm_stub_mode`, `llm_stub_malformed`, `llm_force_fail`, `dev_overrides_enabled`, `conflict_priority_window`, `chat_max_message_chars`, `chat_last_n`, `chat_send_timeout_ms`, `chat_realtime_watchdog_ms`, `chat_retry_holdoff_ms`, `chat_queue_max_items`, `expo_push_enabled`, `vapid_public_key`, `llm_call_timeout_ms`, `pipeline_deadline_ms`, `job_dispatcher_budget_ms`, `job_dispatcher_url`, `auto_adopt_window_minutes` | TECH-SPECS §11 | ✅ |
| Every dev-only key marked `(dev-only`: `llm_stub_mode`, `llm_stub_malformed`, `llm_force_fail`, `dev_overrides_enabled` | TECH-SPECS §11 | ✅ |
| `dev-smoke` function registered | GLOSSARY §13 | ✅ |
| Route enum contains `degrade` | GLOSSARY §14 | ✅ |
| `ui_metadata`, `routeInfo`, `dev_force`, `client_message_id`, `reply_to_message_id`, `secondary_reply_to_message_id`, `persona_key`, `source_job_id` | GLOSSARY §15 | ✅ |
| All 30 config keys listed | GLOSSARY §16 | ✅ |
| §13 live items extended with the three FP-02 items (iOS push budget, `dev_overrides_enabled`, Web Push deferral) | TECH-SPECS §13 | ✅ |
| §12 gains the measured-latency pointer to this document | TECH-SPECS §12 | ✅ |
| Filename mentions corrected to the file that exists | `AGENTS.md` §1, §2, §9 | ✅ |

**§9 secret scan.** No secret *value* (`eyJ…` JWT, `AIza…`, `gsk_…`, `sk-…`, `-----BEGIN`) appears anywhere in `app/`, `lib/`, `supabase/migrations/`, `app.config.js` or `app.json`; no `service_role` / `SUPABASE_SERVICE` name appears in client code. Migrations are allowed to name the *role* (`grant execute … to service_role`) — those are grants and comments, not values. 51 files scanned.

---

## Deferred / out of scope (recorded, not silently missing)

- **`band_shift` is not written.** The Step 10 `auto_adopt_successes` counter is consumed by FP-03; FP-02 adds nothing to the persona-weighting write path (FP-02 §2).
- **`user_overrides` decrement path** — owner decision to keep out of FP-02 (PROGRESS Step 6).
- **`persona_stats` remains client-writable for one's own row** via the pre-existing `0007` policies. Deliberate: self-affecting only, and a future `user_overrides` path may want a user-owned write. Recorded in `0023`'s comment, TECH-SPECS §5.3 and PROGRESS rather than "fixed".
- **Web Push** is deferred to its own step (TECH-SPECS §13 item 9); the approved web fallback is Realtime + the in-app check-in banner.
- **iOS remote push** is blocked by the $0 budget (Apple Developer Program) — TECH-SPECS §13 item 7.
- **A reconciliation sweep** for `metadata.source_job_id` values with no `jobs` row (the accepted dead-letter residual window, §5.1) is not implemented.
- **Prompt v1 hardening** — the shortfalls recorded by AC-2 feed TECH-SPECS §14 item 11: `therapist_empath` reads more generic than `mentor_tough` (PROGRESS Step 6), and Groq's `persona_options[].key` enum drift (PROGRESS 2026-10-15).

---

## Owner items & runbook

Order matters — migrations and a redeploy first, or the live halves fail their preflight.

**Run status, 2026-10-16: items 1–7 complete.** AC-7, AC-8, AC-9 and AC-10 all passed on the live project, and the AC-2 thread was read. **Item 8 (the two decisions) is the only part still open.**

1. **Apply migrations `0022` + `0023` remotely** (`supabase db push`, or the SQL editor). `verify-step11.py`'s config preflight (`auto_adopt_window_minutes`, `chat_queue_max_items`) is the check that they landed.
2. **Redeploy** `send-message`, `select-persona`, `job-dispatcher` at current code.
3. **Rebuild the dev client** (NetInfo is a new native module) — needed for AC-8's airplane-mode leg.
4. **AC-9:** `python scripts/verify-step10.py --run-jest`.
5. **AC-8:** `python scripts/verify-step9.py --run-jest`, then the airplane-mode device leg.
6. **AC-10 + AC-2:** run `verify-step11.py --turns 20 [--logs …]`, then read the thread and judge AC-2.
7. **AC-7 (Android push matrix):**
   - background the Android app → send from web → notification arrives; send twice → the second groups under collapse key `chat_{userId}` (one notification, not two);
   - with chat focused → **no** notification banner, and the message renders via Realtime in < 2 s;
   - a user with zero push tokens → the send still succeeds (push is best-effort);
   - an invalid/expired token → only that token is deleted on receipt.
8. **Two scope/budget decisions** (TECH-SPECS §13 items 7–8) — **outstanding:** record the iOS-push budget decision, and set `dev_overrides_enabled=false` before inviting anyone beyond the current tester set.

The ACs are marked, and the FP-02-PLAN tracker rows for Steps 9, 10 and 11 are flipped to ✅.

---

## Known drift (recorded, deliberately not "fixed")

- **`docs/DECISIONS.md`** is a second, stale copy of the decisions table: no `… Update` rows, not referenced by `AGENTS.md` §2, last touched by `74003fc`. It is left untouched. `docs/adr/decisions2.md` is the authority.
- **`AGENTS.md` reference label vs filename.** The prose label `TECH-SPECS §N` is the document's reference convention (`AGENTS.md` §2, "Reference convention"); the *file* is `docs/TECH-SPEC.md`. The filename mentions were corrected to the real file; the label stays.
- **`5f047bb`'s commit message** does not match its 17-file content (Step 9 plus the round-1 web-auth fix). Local-only and never pushed, so it can still be reworded for free.

---

## Sign-off

**FP-02 implementation complete. 12/12 ACs pass**, verified 2026-10-16: ten ACs are backed by live or automated runs that re-run from the repo via the per-AC harnesses (`scripts/verify-step8.py`, `verify-step9.py`, `verify-step10.py`, `verify-step11.py`), and AC-2 is backed by the owner reading the 20-turn audit thread.

Two things are recorded rather than closed, and neither blocks acceptance:

- **TECH-SPECS §13 item 8** — `dev_overrides_enabled` is still `true` in the beta project; set it `false` before anyone beyond the current tester set is invited.
- **TECH-SPECS §13 item 7** — the iOS-remote-push budget decision ($99/yr Apple Developer Program) is still open and gates any later FP whose acceptance depends on iOS push.

Known drift is listed above. The next feature's dependency gate can proceed.
