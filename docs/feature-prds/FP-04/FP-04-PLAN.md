# FP-04-PLAN.md — Build Plan: Interval Check-In Loop

**Companion to:** `docs/feature-prds/FP-04/FP-04.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. **Zero new job types** — §2.3 and GLOSSARY §12 stay at 15: FP-04 *implements* two already-registered types (`watchdog_checkin`, `intervention`); the registry text only gains an implemented note. **The only FP-02 code touched** is `send-message`'s §5.3 qualifying-row exclusion (Step 3) — no other change to that fn. Migration numbers assume the next free slots after `0025`; renumber if taken (FP-02/03 precedent) and write back. The low-energy gate **reuses** `energy_exhausted_max` — no new threshold key (D4 single-source, the FP-03 `confidence_bands` precedent). FP-04 does **not** depend on the `classifier_mode` flip (FP-03's pending owner decision): the energy-override AC runs through `runPipeline`'s dev-only classifier override, exactly like FP-03 Step 5's drills.

**Progress tracker:**

| Step | Name | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0 | Dependency gate (FP-03 + FP-02 foundation) | ⬜ |
| 1 | Window index + config keys + prefs RPC (migration 0026) | ⬜ |
| 2 | `submit-checkin`: ingestion core (POST + PATCH) | ⬜ |
| 3 | Eval call + intervention turn + §5.3 exclusion | ⬜ |
| 4 | Client scheduler + notifications + pending store | ⬜ |
| 5 | Chat check-in mode + energy chips + web banner | ⬜ |
| 6 | Watchdog schedule + dispatcher handlers (migration 0027) | ⬜ |
| 7 | Settings: cadence, active hours, permission state | ⬜ |
| 8 | Device drill, doc write-backs, AC sweep | ⬜ |

**Tracker convention:** ⬜ pending · ▶ source-complete, live verification pending · ✅ verify passed. Source-complete and statically-checked never flips a row on its own — FP-01's review is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-03/FP-03-ACCEPTANCE.md` exists with its ledger (AC-8 ⏳ pending-live is acceptable — FP-04 does not build on the flip); (2) `doings_logs` exists with the §3.2 shape — kind check covering `doing`/`impulse_failure`, source check covering `checkin_reply`/`chat`/`app`/`quick_action`, `energy` 1–10, `checkin_window timestamptz`, `embedding vector(768)` — and own-rows RLS; (3) `profiles` carries `checkin_cadence_minutes`, `checkin_active_hours_start/end`, `latest_energy`, `timezone` (§3.2); (4) the dispatcher is live — 1-min tick, claim/backoff/dead-letter proven by `smoke_test` + `llm_retry` — and `FAST_JOB_TYPES` located (§2.2); (5) the push path stands: `_shared/push.ts` `createHighPriorityPushPayload`, `expo_push_enabled` gate, an Android token registered (the FP-02 Step 7 owner setup); (6) `runPipeline` accepts the optional per-turn `energy` param (FP-03 Step 5) and `send-message`'s §5.3 qualifying-row block is located (the only FP-02 surface FP-04 touches); (7) migration slots `0026`+ are free; (8) baselines green: jest 9 suites / 101 tests, `tsc --noEmit` 0, `deno check` clean on the entry points, eslint 0 errors.

**Verify:** all eight green. Any failure → stop, fix upstream first; never build the loop on a broken dispatcher or pipeline.

---

## Step 1 — Window index + config keys + prefs RPC (migration 0026)

**Agent does:**

1. Migration `0026_checkin_loop_fp04`: (a) unique partial index on `doings_logs (user_id, checkin_window) where checkin_window is not null` — one doing per window; the watchdog's "answered" join stays unambiguous and duplicate submits dedupe at the storage layer (impulse/chat/app-sourced rows carry a null window and are unaffected). (b) Config seeds, proper jsonb (the `0014` lesson): `checkin_late_minutes` (15 — §7.1 [SPEC], the late gate) and `watchdog_lookback_minutes` (120 — [SPEC], the bounded scan; the payload dedup makes the exact value non-critical). (c) `update_checkin_prefs(p_cadence int, p_start time, p_end time, p_tz text)` — `security definer`, fully qualified names, inline `set search_path` (the `claim_jobs` hardening); updates **only** `checkin_cadence_minutes`, `checkin_active_hours_start`, `checkin_active_hours_end`, `timezone`; validates cadence ∈ {60,120}, `p_start < p_end` (no overnight check-ins, §3.2), and the tz string against `pg_timezone_names`; execute to `authenticated` + `service_role`, revoked from public — the `increment_auto_adopt_successes` precedent, so `trust_score`/`dialog_state`/`onboarding_stage` stay client-unreachable by construction.
2. Write-backs in this commit: TECH-SPEC §3.2 (index note), §11 (two keys); GLOSSARY §11 (doings row note), §16 (two keys).

**Verify:** migration applies clean; a second doing for the same (user, window) is rejected with `23505` while null-window rows insert freely; `select * from config` returns both keys with jsonb numbers; the RPC round-trips the four columns and a direct client `update` of `trust_score` still fails; invalid cadence / start ≥ end / bogus tz each error; anon cannot execute the RPC.

**Commit refs:** TECH-SPEC §3.2, §11; D9; FP-04 FR-8, FR-11 (partial), FR-17 (partial).

---

## Step 2 — `submit-checkin`: ingestion core (POST + PATCH)

**Agent does:**

1. `supabase/functions/submit-checkin/` (`index.ts` + `config.toml`, `verify_jwt` true). POST handler: JWT → `auth.uid()`; body validation — `content` string capped by `chat_max_message_chars` (fail-closed config read), `windowTs` within the trailing 24 h and not future, `capture` ∈ {`reply`,`chat`}. **Duplicate check precedes every provider call**: select the existing doing for (user, window) → hit → return `{status:'duplicate', doing_id, energy…}` with zero embeds (FR-8). Otherwise: energy parse via a new pure module `_shared/checkin/parseEnergy.ts` (the §7.1 trailing-integer regex); one `llm.embed([content])`; insert `doings_logs` (kind `doing`, source `checkin_reply` \| `chat` by capture, `checkin_window=windowTs`, energy, embedding + `embed_model` stamp — the seed stamp pattern); on `23505` (a racing duplicate) re-select and return duplicate. Update `profiles.latest_energy` when energy parsed. Response: `{status:'ok', doing_id, energy, eval_ran:false, intervention:false}`. CORS preflight mirrors `send-message` exactly — ACAO `*` plus `Content-Type, Authorization, apikey, x-client-info` (the FP-02 hotfix: `supabase-js` injects `x-client-info`, and web calls this fn).
2. PATCH handler on the same fn: `{doing_id, energy 1–10}` → own-row check (`user_id = auth.uid()`) → update `doings_logs.energy` + `profiles.latest_energy` → `{ok, doing_id, energy}`; foreign id → 404.
3. Unit tests (`_shared/checkin/parseEnergy_test.ts`): the AC-2 table — "finished the report, drained 4" → 4; "worked 10 hrs" → null; "energy 10" → 10; "level 0" / "score 11" → null; boundaries 1 and 10; whitespace tolerance. Plus capture→source mapping and windowTs bounds.
4. `scripts/verify-fp04-step2.py` (the `verify-step11` pattern; `DAVOS_USER_JWT`-gated, config snapshotted/restored in a `finally`): submit an on-track check-in under `llm_stub_mode=true` → assert the row (kind/source/window/energy/embedding stamped), `latest_energy`, **zero** generate log lines, exactly one embed line; duplicate → same `doing_id`, zero new embeds; PATCH → both columns; malformed windowTs / oversized content → 400; foreign PATCH → 404.

**Verify:** the script green; `tsc --noEmit` + `deno check` + `jest --ci` clean; `git diff` proves `send-message` untouched.

**Commit refs:** TECH-SPEC §7.1, §3.2, §7.10 (CORS); D9; FP-04 FR-3 (partial), FR-5, FR-6, FR-7, FR-8. **Passes AC-1, AC-2, AC-6 (ingestion half).**

---

## Step 3 — Eval call + intervention turn + §5.3 exclusion

**Agent does:**

1. `_shared/checkin/eval.ts` — `evaluateDoing({text, energy, anchors})` through `llm.generate` with the new `{deviation: bool, intervention: bool}` schema and per-call structural validator (§4.3-family; `generate<T>` takes its own validator — no second provider path). Input carries today's `anchor_plans` row for the user — empty until the journal FP, forward-compatible by construction. Bounded parse retry (§4.2); structural **or** transport failure → `{deviation:false, intervention:false}` + a structured warning — **fail-open**: the doing is already ingested, there is no reply to hold, and the check-in must never 500 on the eval. Adapter stub table gains the shape (canned `{deviation:false, intervention:false}`); `dev_force.eval_intervention` (gated by `dev_overrides_enabled`, re-checked server-side — the `dev_force` precedent) short-circuits the result for drills.
2. `submit-checkin` gates, after the insert: energy ≤ `energy_exhausted_max` OR now > window close + `checkin_late_minutes` (window close = windowTs + the profile's cadence) → `evaluateDoing`. `intervention=true` → write the user row (`role='user'`, the check-in text, `metadata.source='checkin'`, doing id, `client_message_id` when the chat path supplied one) → `runPipeline(text, {energy})` — the dormant FP-03 param goes live — → primary reply anchored on the row (the `insertPrimaryReply` path) + one high-priority push (`createHighPriorityPushPayload`, `expo_push_enabled` gate, bounded await). A transport failure inside the pipeline degrades through the **unchanged** §4.1 machinery (holding reply + exactly one `llm_retry` job) — an intervention turn is just a turn. `deviation=true` alone → structured log, nothing else. Response now carries `eval_ran`, `intervention`, `user_message_id`, `assistant_message_id`; a duplicate replay of an interventioned window returns the existing ids.
3. `send-message` — the single FP-02 touch: the §5.3 qualifying-row test skips `metadata.source='checkin'` rows both as the arrival and as the intervening row (FR-10). Unit tests for both directions ride the existing §5.3 suite.
4. Structured submit log line (FR-18): capture, window, energy, gates, eval outcome, intervention, latency.

**Verify:** `scripts/verify-fp04-step3.py` — stub mode with `dev_force.eval_intervention` + energy 2: user row + primary reply + one high-push attempt logged; `&classifier=real` dev override on the same turn → classifyReal returns emotion `exhausted` (the §6.2 override exercised under either prod mode — AC-4's real half); energy 6 on-time → `eval_ran:false`, exactly one embed line, zero generate lines; backdated windowTs → `eval_ran:true`; `llm_force_fail='both'` on a forced-intervention submit → holding reply + one `llm_retry` row, recover on `'none'` (AC-11); §5.3 units green; `python scripts/verify-step11.py --turns 6 --cleanup` (the `send-message` regression leg, the FP-03 Step 7 precedent); `tsc` + `deno check` + `jest` clean.

**Commit refs:** TECH-SPEC §7.1, §4.1, §4.2, §4.3, §5.1, §5.3, §6.1–6.2, §7.10, §11; D4, D8, D9, D19; FP-04 FR-9, FR-10, FR-11, FR-12, FR-13, FR-18. **Passes AC-4, AC-5, AC-7, AC-11.**

---

## Step 4 — Client scheduler + notifications + pending store

**Agent does:**

1. `lib/checkinGrid.ts` — pure window math (jest-loadable, zero value imports): windows step from `checkin_active_hours_start` by cadence within active hours, computed in `profiles.timezone`, anchored on **local active-start** (not epoch hour — a UTC+5:30 profile must still get 08:00-local windows); id = `checkin_{userId}_{epochHour-of-window-start}`; a window's notification fires at its **close**; exports the rolling next-24 h set and the "currently open window" for the composer/banner. The exported vectors are the shared fixture: Step 6's server scan must reproduce them exactly (NFR-7 — drift between the twins is a stop condition).
2. `lib/checkins.ts` — the scheduler: arm/cancel via `expo-notifications` (deterministic ids make re-arm idempotent — cancel ids not in the new set, schedule the rest); armed at the `(app)` layout on auth + `AppState` active, after each submission (Step 5 calls in), and after settings saves (Step 7); permission denied → no scheduling, state surfaced, no crash; `Platform.OS === 'web'` → no scheduling (the banner is Step 5's). Android channel `checkin` (separate from push `default`); category registration with the **Reply text-input action** and the tap → `davos://chat?focus=checkin` deep link.
3. Direct-reply handling: the notification-response hook POSTs `submit-checkin {content, windowTs-from-id, capture:'reply'}` when the process is alive; a response delivered at app open after process death posts with the **original** windowTs. A failed POST persists to `lib/checkinQueue.ts` — the `sendQueue` pattern verbatim: AsyncStorage per-user key, entries `{content, windowTs, retryAt, attempts}`, sequential flush on the same triggers (NetInfo, Realtime `SUBSCRIBED`, AppState, focus, manual), stops at the first non-draining item; idempotent end-to-end via the window index.
4. TZ sync: on arm, if device TZ ≠ `profiles.timezone` → `update_checkin_prefs(…, tz)` (keeps the watchdog grid aligned with what the device actually fired — R-5's mitigation).
5. Unit tests: grid math (cadence 60/120, active-hours edges, UTC+5:30 anchoring, id determinism, one-missed-never-affects), queue flush gating.

**Verify:** jest grid suite green (including the shared vectors); `tsc --noEmit` clean; static asserts: scheduler wired at the `(app)` layout, no web scheduling (platform gate), channel/category registered once; the real notification firing needs hardware and waits for the Step 8 device drill (FP-03 AC-8's measured-vs-asserted rule).

**Commit refs:** TECH-SPEC §7.1, §8, §9; D1, D9; FP-04 FR-1, FR-2, FR-3 (client half). **Passes AC-9 (unit half).**

---

## Step 5 — Chat check-in mode + energy chips + web banner

**Agent does:**

1. `app/(app)/chat.tsx`: `focus=checkin` (deep link on native, `?focus=checkin` on web) → composer check-in mode carrying the pending window (the notification's window when the link came from one, else the currently-open window from the grid). A check-in-mode send POSTs `submit-checkin` with a fresh `client_message_id` — never `send-message`. The optimistic bubble resolves on the HTTP response: `intervention=false` → a **`logged` terminal state** (client-only — on-track turns write no rows by design, so the orphan-failure heuristic must not fire); `intervention=true` → the user row arrives via Realtime and reconciles through the existing `client_message_id` machinery, reply following normally.
2. Energy chips: after a check-in send (response `doing_id`), and on chat open for the newest null-energy doing (own-rows select through RLS — no API change), render quick-tap chips 1–10 + the §7.1 emoji map; tap → PATCH → local state settles; server value wins on reload; strip dismisses once energy is set.
3. Web banner: visible when in active hours with the current window unanswered (client-local state: the queue + the last response); tap → composer check-in mode (same path as the deep link). No Web Push (§13 item 9 — reserved keys stay unused).
4. Unit tests: mode routing (focus param → check-in send target), the `logged` terminal transition, chip state machine, banner visibility predicate (active hours, answered suppression, platform).

**Verify:** `tsc` + jest clean; a web manual drill (agent or owner, stub mode is fine): banner → send → chips → PATCH → doing row + `latest_energy` (AC-10); on native the composer flow is exercised again in the Step 8 device drill.

**Commit refs:** TECH-SPEC §7.1, §7.10 (client render), §9; D9; FP-04 FR-4, FR-9 (client half), FR-14. **Passes AC-3, AC-10.**

---

## Step 6 — Watchdog schedule + dispatcher handlers (migration 0027)

**Agent does:**

1. Migration `0027_watchdog_cron_fp04`: `cron.schedule('watchdog-checkin', '*/5 * * * *', …)` running a **guarded** `insert into jobs (type, payload) values ('watchdog_checkin', '{}')` — only when no pending/claimed/running watchdog row exists; the 1-min dispatcher tick stays the sole claimer (§2.2; a double-insert is tolerated anyway — the handler is idempotent).
2. `_shared/checkin/windows.ts` (Deno twin of Step 4's grid) + the `watchdog_checkin` handler in `job-dispatcher` (registry signature `(payload, job)`): per profile, windows from the twin grid closed between `watchdog_grace_minutes` and `watchdog_lookback_minutes` ago, within active hours, minus answered doings (`checkin_window` join), minus windows that already have an intervention job (payload `window` dedup) → insert `intervention {userId, window, reason:'missed_checkin'}`; one structured scan log line. `watchdog_checkin` joins `FAST_JOB_TYPES` (cheap — SQL + inserts); **`intervention` deliberately does not** (generation-capable, reserves `pipeline_deadline_ms` — §2.2's fail-safe default).
3. The `intervention` handler: lazy pipeline/adapter import (the `llm_retry` precedent — a missing provider secret fails this job type only); dedup check-before-generate on the window key; generation with persona `mentor_tough` [SPEC reading] and context = the missed window + a recent-thread summary; write the **unprompted** assistant row (`reply_to` NULL, `metadata.source='watchdog_intervention'`, window in metadata) + high-priority push; `done`. Idempotent on re-claim (a second run of the same job writes nothing).
4. `dev-smoke ?action=watchdog-scan&now=<iso>` — dev-gated backdated scan for the drill (the `eval-classifier` precedent of dev-only drill actions). GLOSSARY §13 write-back.

**Verify:** `scripts/verify-fp04-step6.py` — with a synthetic unanswered window (backdated `now`): scan → `intervention` job inserted; dispatcher claim → exactly one unprompted assistant row + one high-push log; re-scan → no second job (dedup); an answered window and an overnight window → no alert; `FAST_JOB_TYPES` contains `watchdog_checkin` and not `intervention` (static assert); §2.3 and GLOSSARY §12 still list 15 types (static assert — zero new job types); the twin-grid vectors from Step 4 reproduce on the server (fixture assert); `tsc` + `deno check` + `jest` clean.

**Commit refs:** TECH-SPEC §2.2–2.3, §7.1, §8, §11; D2, D9, D12; FP-04 FR-15, FR-16. **Passes AC-8.**

---

## Step 7 — Settings: cadence, active hours, permission state

**Agent does:**

1. `app/(app)/settings.tsx` (the FP-01 stub becomes real, scoped to check-ins only): cadence picker (Hourly 60 / Bi-hourly 120), active-hours pickers, read-only timezone display (synced by the scheduler), notification-permission state with a re-prompt path and the R-4 warning copy (check-ins and accountability depend on notifications). Save → `update_checkin_prefs` → scheduler re-arm (FR-17). Client-side validation mirrors the RPC's (cadence set, start < end).
2. Unit tests: validation mirroring; the re-arm input (a profile change produces a new id set).

**Verify:** change cadence 60 → 120 → `profiles` row updated and the next arm's computed ids reflect the new grid (unit: arm consumes the updated profile); invalid combos blocked client-side **and** server-side (the Step 1 RPC errors); permission-denied state renders the warning; `tsc` + jest clean.

**Commit refs:** TECH-SPEC §9 (route map), §3.1, §3.2; D9; FP-04 FR-17. (No dedicated AC — supports AC-9.)

---

## Step 8 — Device drill, doc write-backs, AC sweep

**Agent does:**

1. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPEC §7.1 (as-built readings: the materialization rule, capture-path sources, the eval contract and its fail-open semantics, the energy-key reuse, `latest_energy` writer, grid/window semantics, watchdog dedup), §2.3 (both handlers implemented — registry count unchanged), §3.2 (window index), §4.3 (the eval contract joins the extraction contracts), §5.1 (check-in turn shape + §5.3 exclusion), §6.1 (energy threaded — the dormant note superseded), §11 (two keys), §13 (the iOS amendment acknowledgment, live item 7); GLOSSARY §2 (check-in terms as-built: pending store, `logged` terminal), §8 (direct-reply delivery reading), §13 (`submit-checkin` real + the `watchdog-scan` action), §14 (`metadata.source` additions: `checkin`, `watchdog_intervention`), §16 (two keys); explicitly record that §2.3 / GLOSSARY §12 are untouched at 15 types.
2. `docs/feature-prds/FP-04/FP-04-ACCEPTANCE.md`: the AC ledger, evidence tags (`[script]` / `[measured]` / `[owner-observed]` / `[derived]` — the FP-02/03 convention), the §13 item 7 iOS amendment, and a re-run recipe. AC ids parsed from `FP-04.md` so the two cannot drift.
3. Device drill checklist authored for the owner (below); secret scan + AGENTS.md §9 checklist; final PR cites TECH-SPEC §2.2–2.3, §3.2, §4.1–4.3, §5.1, §5.3, §6.1–6.2, §7.1, §7.10, §8, §9, §11, §13; D2, D4, D8, D9, D12, D19; FP-04 §9.
4. Regression legs: `verify-step11.py --turns 6 --cleanup` (FP-02, `send-message` touched) and `verify-fp03-step7.py --static-only` (FP-03).

**Verify:** every AC marked with evidence (device rows may sit at ⏳ pending the owner drill — FP-03's AC-8 precedent); write-back diffs present; both regression legs green; repo clean.

**OWNER MANUAL:** the device drill, then flip the pending rows — **Android**: a check-in notification fires at window close; a background direct reply posts (row lands, no app open); tap deep-links into the focused composer; chips PATCH; a gated check-in delivers the high-priority push. **iOS**: the local notification fires and taps into chat; an intervention renders in-thread on next open (no remote push — the amended AC; acknowledge it here or fund the program, which is a budget decision outside this FP). **Web**: banner → check-in → chips. Record observations in the acceptance doc. Also re-check the standing `dev_overrides_enabled` plan: FP-04's drills are now part of its "done" set before it flips to `false` for real beta users.
