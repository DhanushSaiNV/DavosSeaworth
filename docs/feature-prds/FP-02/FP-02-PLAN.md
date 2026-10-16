# FP-02-PLAN.md — Build Plan: Chat Pipeline & Guardrails

**Companion to:** `docs/feature-prds/FP-02.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. "Verify" is the pass/fail gate. Steps marked **OWNER MANUAL** need your hands.
**Conventions:** AGENTS.md §6 (cite refs in commit; doc write-backs land in the same change as the introduction, not deferred) and §9 checklist at completion. Config keys introduced dev-only are still registry entries, marked `dev-only`.

**Progress tracker:**

| Step | Name                                                  | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0    | Dependency gate (FP-01 foundation)                    | ✅     |
| 1    | Provider adapter + config keys + embedding smoke      | ✅     |
| 2    | Dev-seed rules + retrieval + conflict filter          | ✅     |
| 3    | Pipeline stages 1–5 (pure) + guardrails prompt v1     | ✅     |
| 4    | `send-message` wiring + dedupe schema                 | ✅     |
| 5a   | Reply guard + repair-on-duplicate (server)            | ✅     |
| 5b   | Composer UI + thinking indicator + Realtime render    | ✅     |
| 6    | Tier routing: chips + `select-persona` + dev override | ✅     |
| 7    | Expo push: registration + server send + suppression   | ✅     |
| 8    | Sync degrade + `llm_retry` handler                    | ✅     |
| 9    | Offline queue + delivery dedupe                       | ✅     |
| 10   | `auto_adopt_successes` write path                     | ✅     |
| 11   | Timing/quota audit, doc write-backs, AC sweep         | ✅     |

**Tracker convention:** `✅` means the step's **Verify** passed, live sections included. Steps 9, 10 and 11 stayed `▶` until their live harnesses passed, and were flipped on **2026-10-16** once they did (Step 9 = `scripts/verify-step9.py` including the airplane-mode device run; Step 10 = `scripts/verify-step10.py`; Step 11 = `scripts/verify-step11.py` plus the four owner-live ACs). Source-complete and statically-checked never flips a row on its own — FP-01's review, which criticised asserted-not-elapsed evidence, is the precedent.

---

## Step 0 — Dependency gate (no commit)

**Agent does:** verify before building: (1) `docs/feature-prds/FP-01-ACCEPTANCE.md` exists and every AC is pass; (2) `select * from config` returns all §11 keys; (3) insert a `smoke_test` job → `done` within 2 min (jobs system alive); (4) deployed functions list contains `health` and `job-dispatcher`; (5) TECH-SPECS §13 items 1–3 marked verified with the Groq JSON-mode result recorded.

**Verify:** all five green. Any failure → stop, fix FP-01 first; never build the pipeline on a broken foundation.

---

## Step 1 — Provider adapter + config keys + embedding smoke

**OWNER MANUAL:** confirm Gemini (AI Studio) and Groq API keys exist; add both as Supabase Edge Function secrets: `GEMINI_API_KEY`, `GROQ_API_KEY`.

**Agent does:**

1. Migration `0010_config_fp02`: insert config keys — `sync_degrade_reply` ("Noted. Give me a second."), `malformed_fallback_reply` ([SPEC] text), `llm_stub_mode` (false), `llm_force_fail` ('none'), `dev_overrides_enabled` (true) — last three marked dev-only.
2. `supabase/functions/_shared/llm/adapter.ts`: `llm.generate({system, messages, schema, tier})` — Gemini 3.5 Flash-Lite primary with JSON Schema enforcement; Groq fallback via the path recorded in FP-01 §13 (JSON mode, or schema-in-prompt + single parse retry); `llm.embed(texts[])` → 768-dim, stamped identity `gemini-embedding-001@768`; structured log line per call (provider, model, latency, ok/fail) — this is the AC-10 quota log. Honor `llm_stub_mode` (canned schema-valid responses, zero network — for UI iteration) and `llm_force_fail` ('none'|'primary'|'both').
3. Dev-only Edge Function `dev-smoke` (service-role key auth): `?action=embed` → first vector + dimension; `?action=generate` → parsed JSON + raw, proving the §4.2 contract end-to-end.

**Verify:** `curl dev-smoke?action=embed` → 768; `?action=generate` → JSON containing both `tactical_analysis` and `direct_quote`; flip `llm_stub_mode=true` in config → instant canned response, zero provider log lines; flip back. Write-backs in this commit: TECH-SPECS §11 registry + GLOSSARY (dev-smoke, new config keys).

**Commit refs:** TECH-SPECS §4.1–4.2; D18; FP-02 FR-1, FR-2, FR-18 (partial).

---

## Step 2 — Dev-seed rules + retrieval + conflict filter

**Agent does:**

1. Placeholder rule set (8–10 rows, ≥2 domains, every row `source_figure='PLACEHOLDER-DEV'`), including one crafted conflict pair: same domain, one aggressive + one empathetic rule, priority within 15 points (e.g., 80/70) — the filter's test fixture.
2. Extend `dev-smoke`: `?action=seed-rules` (embeds rule texts via `llm.embed`, inserts rows) and `?action=clear-rules` (delete where `source_figure='PLACEHOLDER-DEV'` — the FR-9 one-step removal).
3. `supabase/functions/_shared/pipeline/retrieveRules.ts`: top-5 rules for a domain by pgvector cosine `<=>` against the message embedding; then the §5.2 conflict filter (same-domain mixed tone within 15 priority → drop the lower-priority group); returns surviving rule ids, texts, tone tags.
4. `dev-smoke ?action=retrieve&domain=…&text=…` → surviving rule ids.

**Verify:** seed → all rows carry 768-dim embeddings + dev label; retrieve in the conflict-pair domain → exactly one tone group survives, ≤5 rules, ids in the response; `clear-rules` → zero rows.

**Commit refs:** TECH-SPECS §5.2, §3.3; FP-02 FR-8, FR-9 (partial).

---

## Step 3 — Pipeline stages 1–5 (pure) + guardrails prompt v1

**Agent does:**

1. `supabase/functions/_shared/pipeline/`:
   - `extract.ts` — stage 1: `llm.generate` returning the full §4.3 contract (`intent_flags`, `openness_delta`, `topic`).
   - `classify.ts` — stage 2 stub: deterministic, emits the exact §6.3 shape; default `{domain:'Career', emotion:'determined', overall_conf:0.80}`; accepts dev override params (domain/emotion/overall_conf).
   - `persona.ts` — stage 4: effective bands = `config.confidence_bands` ± `persona_stats.band_shift` (read for the user/domain, default 0); returns route ∈ `auto | options | low_question | fallback` + persona key.
   - `generate.ts` — stage 5: builds the system prompt from route + surviving rules; calls adapter with the §4.2 schema; exactly one bounded parse retry → `malformed_fallback_reply`.
   - `runPipeline.ts` — orchestrator: stage 1 ∥ stage 2 → stage 3 (embed + retrieveRules) → stage 4 → stage 5; returns `{assistantContent, uiMetadata, tacticalAnalysis, routeInfo}` — pure w.r.t. DB writes.
2. `_shared/prompts/guardrails.ts`: relentlessly-human persona definition + few-shot bad/good exemplar pairs (`PLACEHOLDER-DEV` labeled) + the four route variants (High personas / Medium options / Low question / inquirer fallback) per D13.
3. `dev-smoke ?action=pipeline&text=…&force=high|medium|low|fallback` → full pipeline output for inspection.
4. Run each route variant once on **both** providers; record output-style diffs in a dev note (FR-13 provider-testing).

**Verify:** force=high → `direct_quote` only, no `persona_options`; medium → 2–3 options present; low → `direct_quote` is literally a question; fallback → inquirer tone, `routeInfo.domain='General'`; simulate malformed output (stub-mode canned invalid JSON) → fallback reply after exactly one retry; outputs contain zero "As an AI…" phrasing (qualitative note for AC-2 backlog).

**Commit refs:** TECH-SPECS §4.2–4.3, §5.1–5.3; D4, D13; FP-02 FR-6, FR-7, FR-10, FR-12, FR-13 (partial).

---

## Step 4 — `send-message` wiring + dedupe schema

**Agent does:**

1. Migration `0016_messages_client_id` (plan originally numbered this `0011`; renumbered to the next free slot): `messages.client_message_id uuid` + unique index `(user_id, client_message_id)`. Write back TECH-SPECS §3.2 in this commit.
2. Edge Function `send-message`: JWT auth → insert user row with `client_message_id` (`on conflict do nothing`; conflict → return existing, **skip pipeline**) → `runPipeline` (dev-force params honored only when `dev_overrides_enabled`) → insert assistant row via service role (`content = direct_quote`, `metadata = {persona, route, domain, rule_ids, persona_options?, source:'pipeline', user_message_id}`) → `console.log(tactical_analysis)` (server log only — never persisted, never returned) → return `{user_message_id, assistant_message_id, status}`. Push is deferred to Step 7 (no call site in Step 4).
3. Idempotency rule: the pipeline runs exactly once per new user message.
4. **Deferred (recorded, not built here):** the orphan-turn window (invocation dies between the two inserts) is resolved in **Step 5a** (repair-on-duplicate), not Step 8; per-stage timeouts + a total-deadline check land in Step 8/11; `dev_overrides_enabled` must be `false` in production.

**Verify (curl with a signed-in user's JWT from web devtools):** post `{content, client_message_id}` → user + assistant rows exist; DB row `metadata`/`content` contain zero `tactical_analysis` (grep the row), function logs contain it; replay the identical post → no new rows, no second reply; no auth → 401.

**Commit refs:** TECH-SPECS §5.1, §7.10; FP-02 FR-4, FR-5, FR-12. **Passes AC-1; AC-5 (single tone group in `rule_ids`).**

---

## Step 5a — Reply guard + repair-on-duplicate (server)

**Why this precedes the composer:** Step 4 left an orphan-turn window — the user row is committed before the pipeline runs, so if the invocation dies (timeout/crash) the turn is left unanswered, and a retry with the same `client_message_id` short-circuits to `duplicate` with no reply. Step 5's retry UI cannot work without this, and the PRD's idempotency NFR ("no duplicate assistant messages") needs a write-time guard.

**Agent does:**

1. Migration `0017_primary_reply_guard`: `messages.reply_to_message_id uuid` (no FK — account deletion removes parent+child in one statement); guarded uuid-shape backfill from `metadata.user_message_id` (earliest row per user message wins); partial unique index `messages_one_primary_reply` on `(reply_to_message_id) where reply_to_message_id is not null`; config key `chat_max_message_chars` (8000) so the server and composer share one cap.
2. `send-message`: on a duplicate whose turn has **no** primary reply, re-run stages 1–5 from the **stored** user text and write the primary reply (`status:'ok'`); a duplicate whose turn **is** answered returns `duplicate`. Both reply-insert paths set `reply_to_message_id`; the insert catches Postgres `23505` (another invocation won) → SELECT the winner → `duplicate`, and logs a distinct warning so wasted runs are measurable.
3. Vocab: **primary reply** (the pipeline's single answer, sets `reply_to_message_id`) vs **secondary reply** (a later re-run for the same user message — e.g. `select-persona` — which MUST leave it NULL).

**Verify (curl with a signed-in user's JWT; no UI needed):** create the orphan state the way a died invocation leaves it — a committed user row with no reply — then POST the same `client_message_id` with a _different_ body content → `status:'ok'`, exactly one assistant row carrying `reply_to_message_id`, and the reply is generated from the **stored** text (not the body). POST again on the now-answered turn → `duplicate`, same ids, still one row. Two **simultaneous** POSTs at a fresh orphan → exactly one assistant row (`ok` + `duplicate`, same `assistant_message_id`) + the race warning. `chat_max_message_chars` is read at runtime (set it to 10 → a 20-char body is rejected, 400); row `content`/`metadata` contain zero `tactical_analysis`; backfill check passes (assistant rows with `metadata ? 'user_message_id'` and `reply_to_message_id is null` = 0).

**Note — `llm_force_fail` cannot create an orphan:** stage 5 degrades to `config.malformed_fallback_reply` (§4.2) and returns `ok`, so the orphan window only opens when the invocation _dies_ after the user insert. The verify simulates that state with a direct insert.

**Commit refs:** TECH-SPECS §3.2, §5.1, §7.10, §11; FP-02 FR-5, FR-16; D23.

---

## Step 5b — Composer UI + thinking indicator + Realtime render

**Agent does:**

1. `lib/ids.ts` (`makeClientMessageId` — dependency-free RFC 4122 v4), `lib/config.ts` (memoized `config` store loaded once at the `(app)` layout; `useConfig()` hook + fail-closed `requireConfigNumber`; **no hardcoded defaults**), `lib/chat.ts` (`dedupeAssistantRows`/`visibleRows`, `unansweredUserRows`, `mergeRows`, `pruneResolvedPending`, `buildChatItems`, `nextRetryAt`, `classifyError`, `retryDelayFor`) + `lib/chat.test.ts`.
2. Migration `0018_config_chat_client`: `chat_send_timeout_ms` (90000), `chat_realtime_watchdog_ms` (8000), `chat_retry_holdoff_ms` (150000) — [SPEC] values the client reads at runtime.
3. `(app)/chat`: enable the composer; cap input at `config.chat_max_message_chars`; optimistic user bubble keyed by `client_message_id` (`client_sent_at` captured at tap, resent unchanged on retry); "Davos is thinking…" indicator; render from Realtime (replace the optimistic bubble in place; drop an assistant row only if its `id` is seen **or** its non-null `reply_to_message_id` already has a rendered reply, so `select-persona`'s secondary rows still render); 8 s watchdog re-select; failed-bubble retry (immediate on 5xx, holdoff-gated on timeout/network); auth banner on 401; refetch-last-50 on reconnect/foreground; orphan-on-reload self-heal; `keyExtractor = client_message_id ?? id`; fix the pre-existing "oldest 50" fetch to newest 50.
4. Use `llm_stub_mode=true` while iterating UI to burn zero quota; flip off for the final verify.

**Verify:** web and Expo Go: type → user bubble → thinking → assistant reply renders; **network drop mid-send** → failed bubble → Retry (holdoff-gated) → single reply, and a reload shows one user row + one reply; 401/signed-out → auth banner with no Retry button; thread > 50 shows the newest 50; double-tap Retry → one reply; `tsc --noEmit` + `jest` clean. NB: a _provider_ outage renders the §4.2 fallback reply as a normal bubble (not a client error), so the failed-bubble path is exercised through transport failure, not `llm_force_fail`.

**Commit refs:** TECH-SPECS §7.10, §9; FP-02 FR-17. **Deferred:** the "slow / unknown outcome" UI state.

---

## Step 6 — Tier routing: chips + `select-persona` + dev override

**Agent does:**

1. Settings developer section (gated by `dev_overrides_enabled` + dev build): tier forcer (none/high/medium/low/fallback) + domain forcer; stored client-side; composer attaches `dev_force` to the send payload.
2. Chips UI: render `ui_metadata.persona_options` as in-chat quick-select buttons (label + one-liner); tap → POST `select-persona {messageId, personaKey}` → new assistant row renders via Realtime; chips disabled after consumption.
3. Edge Function `select-persona`: validate `personaKey` ∈ that message's `ui_metadata.persona_options` (second tap on consumed options → no-op); re-run **stages 3–5 only** with the persona locked, using the context carried in the option message's `metadata` (`domain`, `persona_options`, `user_message_id`); write assistant row (**push deferred to Step 7**, which wires both call sites). Fetch the original user text + domain **server-side** from `user_message_id`/`metadata` — never trust the tap request body for them.
4. **Carried from Step 5a (schema constraints, decide before building):** the `select-persona` row is a **secondary reply** — it MUST leave `reply_to_message_id` NULL, or the `messages_one_primary_reply` index rejects it and the client drops it. Read the original user-message id from the option message's `reply_to_message_id` column (authoritative), not from `metadata.user_message_id`. The primary-reply guard does **not** cover secondary rows, so guard the double-tap case separately: `persona_key` records the choice and `secondary_reply_to_message_id` anchors the reply (that column, not `reply_to_message_id`, so the two guards never interact), with the partial unique index `messages_one_secondary_reply` on the anchor — one tap consumes the whole option set — plus chip-disable-after-tap.

**As built:** the locked-persona generation runs the `auto` **route variant** (the persona is already decided, so no options are re-offered), but the secondary row's `metadata.route` records `options` — the tier that produced the turn. Labelling it `auto` would make Step 10's `auto_adopt_successes` detector count a deliberate choice as an accepted suggestion (§5.4).

**Verify:** force medium → chips render → tap → reply adopts the chosen persona; second tap no-op; force low → explicit question; force fallback → inquirer reply + `metadata.route='fallback'`, domain `General`; with `dev_overrides_enabled=false`, forced params are ignored end-to-end.

**Commit refs:** TECH-SPECS §5.3, §3.2; FP-02 FR-10, FR-11. **Passes AC-3, AC-4.**

---

## Step 7 — Expo push: registration + server send + suppression

**Agent does:**

1. Client: `expo-notifications`; Android permission request on auth → token → upsert `push_tokens` (platform `android`); Web: generate VAPID pair (`npx web-push generate-vapid-keys`), public key into app config, private key as Edge Function secret, token upsert platform `web`; iOS-in-Expo-Go → graceful skip, logged (risk 1 live item).
2. Server: `_shared/push.ts` — raw `fetch` POST to `https://exp.host/--/api/v2/push/send` (Deno-safe, no SDK), collapse key `chat_{userId}`, delete tokens on invalid-token receipts; called from `send-message` and `select-persona`.
3. Client foreground suppression: notification handler returns nothing while the chat screen is focused.

**OWNER MANUAL:** Android device with Expo Go available for the background test.

**Verify:** background the Android app → send from web → notification arrives, tap → chat; chat foregrounded → no notification, message renders < 2 s via Realtime; web tab backgrounded → browser notification (browser-dependent — record which browser); a user with zero tokens → send still succeeds.

**Commit refs:** TECH-SPECS §7.10, §8; D23; FP-02 FR-15. **Passes AC-7 (Android/Web).**

---

## Step 8 — Sync degrade + `llm_retry` handler

**Agent does:**

1. **Adapter timeouts + failure kinds** (`_shared/llm/adapter.ts`): every Gemini/Groq/embed fetch carries `AbortSignal.timeout(config.llm_call_timeout_ms)` **[SPEC]**, so a hung socket is a _transport_ failure instead of an invocation that burns the 150 s limit. A thrown `fetch` (network, abort) is normalised into a result — never an unhandled rejection. Every negative result carries a structured `kind` (`transport` | `parse` | `validation`). `tier` is now honoured explicitly (`primary` / `fallback`) instead of being accepted and ignored.
2. **Generation outcome split** (`_shared/pipeline/generate.ts`): a `transport` failure is rethrown as `ProvidersUnavailableError` — the adapter already tried both tiers, so there is no second attempt to make inside the invocation. Structural failures keep the existing one-bounded-retry → `config.malformed_fallback_reply` (§4.2) and enqueue nothing.
3. **Pipeline hand-off** (`_shared/pipeline/runPipeline.ts`): the stage-3 embed failure and stage 5 both throw `ProvidersUnavailableError` carrying the stage-1–4 decision (route/persona/domain/rules), so `llm_retry` never has to re-extract. An optional `deadlineAt` (`config.pipeline_deadline_ms`) is checked before each expensive stage.
4. **`send-message` degrade path**: on `ProvidersUnavailableError` only — write `config.sync_degrade_reply` as the turn's **primary** reply (reusing `insertPrimaryReply` so the `messages_one_primary_reply` guard decides races; `metadata.route='degrade'`, `source='sync_degrade'`, `source_job_id`) and insert exactly one `llm_retry` job (`payload = user_id, user_message_id, route, persona, domain`; the job id is minted up front, used as the row id **and** written into the holding row's metadata). Return `ok`. No push for the holding reply (the sender is still in the app — see §7.10). DB errors still 500. Never blocks, never loops.
5. **Dispatcher registry**: `llm_retry` handler → reload the user text server-side from `user_message_id` (never from the payload) → `runLockedPersonaReply` (stages 3–5, persona locked, `auto` variant) → insert a **secondary** reply (`secondary_reply_to_message_id`, `metadata.source='llm_retry'` + `source_job_id`; check-before-insert + `23505` → `done`) + push → `done`; failures → standard backoff → `dead` at 5.
6. Test via `llm_force_fail`: `'both'` is the outage that degrades; `'primary'` must **not** degrade (the inline fallback answers).

**Verify:**

- **Degrade:** `llm_force_fail='both'` → send → exactly one holding bubble returns immediately, thread not stuck; `jobs` has one `pending`/`running` `llm_retry` row; `messages` has 1 assistant row with `metadata.route='degrade'`.
- **Recover:** set `llm_force_fail='none'` → next tick (≤ 2 min) → the job writes the real answer as a **secondary** reply: exactly 2 assistant rows in `created_at` order (holding first), job `done`, push delivered.
- **Dead-letter:** back to `'both'` → after 5 failed attempts the job is `dead` with `last_error` populated, and there is still exactly **1** assistant row (no duplicates across attempts) and **0** real replies.
- **Structural path unchanged:** `llm_stub_mode=true` + `llm_stub_malformed=true` → send → `malformed_fallback_reply` is the primary reply and **no** `llm_retry` row exists (a retry cannot fix an off-contract model).
- **Inline fallback unchanged:** `llm_force_fail='primary'` → the normal reply arrives, no holding reply, no job.
- Restore `llm_stub_mode=false`, `llm_stub_malformed=false`, `llm_force_fail='none'`.

**As-built deviations from the sketch above:** (a) the degrade trigger is _both providers failed_, not "provider 429/5xx" — a single-provider failure stays invisible to the user (TECH-SPECS §4.1 records this and it awaits a `decisions2.md` entry); (b) the deadline guard sits before the expensive stages rather than immediately before the assistant insert, because discarding an already-generated reply to write a holding message is pure loss; (c) the holding reply is not pushed; (d) the retry's real answer is a secondary reply, so it never collides with a concurrent primary reply; (e) the dispatcher now runs a tick under `job_dispatcher_budget_ms` and releases un-started claims (with `attempts` restored) instead of risking a mid-batch kill, and reserves `pipeline_deadline_ms` before a generation-capable handler (§2.2); (f) the pipeline is imported lazily inside the `llm_retry` handler so a deployment without the provider secrets fails that job type only (§13 live item 6).

**Commit refs:** TECH-SPECS §4.1, §2.2, §2.3, §3.2, §5.1, §7.10, §11, §12, §13; GLOSSARY §6, §12, §14, §15, §16; FP-02 FR-3, FR-4. **AC-6 verified live 2026-10-16 (owner-run against the deployed functions; runbook above passed, config restored).** Tracker row ✅. Note: `send-message` was deployed *after* migrations `0020` + `0021` were applied — the functions read the new keys with `getConfigNumber` and throw if a key is absent.

---

## Step 9 — Offline queue + delivery dedupe

**Agent does:**

1. Client queue module (`lib/sendQueue.ts`, AsyncStorage): enqueue on send failure or offline (NetInfo), pending bubbles in the thread, ordered replay on reconnect, remove on success; each queued item carries client uuid + `client_sent_at`. Wired into `app/(app)/chat.tsx` (send path, replay walk, triggers), with `lib/chat.ts` gaining the `queued` pending state.
2. New `[SPEC]` cap `chat_queue_max_items` through migration `0022_chat_queue_config.sql` — the bound is a burst limiter (one pipeline run per replayed item), so it belongs in the `config` registry, not the bundle.
3. Server dedupe already exists (Step 4 unique index) — verify it, don't rebuild it.

**Verify:** airplane mode → send 2 → both queued locally in order → reconnect → both delivered **exactly once** (row count check), pipeline ran per message, order preserved; curl-replay an already-delivered uuid → no duplicates.

**As-built deviations from the sketch above:** (a) `@react-native-community/netinfo` was added (a native module — needs a dev-client rebuild) for a real link signal, per owner decision D1(a); `isConnected === false` is authoritative — the send is queued without attempting the request, so the bubble reads "queued" instantly instead of waiting out `chat_send_timeout_ms` — while `true`/`null` is only a hint, so the send path still queues whatever actually fails rather than trusting the probe. (b) The cap is the new `[SPEC]` key `chat_queue_max_items` (20), not a constant. (c) The queue holds only turns the server never **acknowledged**: the server row is proof of acceptance, so an item is dropped whenever its row appears in `messages`, not only on the send response — a request whose response was lost may still have been delivered. (d) Only _network_ failures are queued; a 4xx must not be replayed verbatim, a 5xx failed fast and stays retryable at once, and a 401 is a session problem. (e) Replay is **trigger-driven only** — NetInfo connect, Realtime `SUBSCRIBED`, AppState active, mount/chat focus, manual "Send now" — and the holdoff wake-up timer merely unlocks the button; it never sends, so an `unknown` item cannot auto-retry in a loop (the sketch's "due-item timer" trigger is deliberately dropped). (f) A full queue **refuses** the incoming message (the bubble stays on screen as an actionable failure) instead of evicting the oldest, which would silently discard a message the user believes is waiting. (g) `select-persona` chip taps are not queued — an accepted gap: a failed tap shows the banner and leaves the chips enabled.

**Commit refs:** TECH-SPECS §7.10, §11, §12; GLOSSARY §8, §14, §15, §16; D23; FP-02 FR-16; AGENTS.md §2 (config-driven `[SPEC]` values). **Passes AC-8.** Live check (owner/device) still required; the dedupe half is already proven by the Step 4 index + Step 5a repair.

---

## Step 10 — `auto_adopt_successes` write path

**Agent does:** in `send-message`, after the user insert: if the last assistant row preceding this user message has `metadata.route='auto'` and `created_at` within 10 min → upsert `persona_stats (user_id, domain)` incrementing `auto_adopt_successes` (insert-on-conflict; domain from that row's metadata).

**Owner decision (2026-10-16) — closes the Step 8 review question.** The rule is the **narrow** one: the counter is restricted to replies the **sync pipeline** wrote as a *primary* reply, so the `llm_retry` secondary row (which carries the original turn's `metadata.route`) never scores. D8's signal is "the user engaged with a persona the system picked" — a late answer the user had stopped waiting for is not that. Two decisions taken with it: **one success per auto-adopted reply**, and the window measured on the **server clock** (`client_sent_at` is untrusted input, §5.1). Recorded in TECH-SPECS §5.3.

**As built — deviations from the sketch above:** (a) **primary replies only** — `reply_to_message_id IS NOT NULL AND metadata.route='auto'`; the sketch's bare `route='auto'` would score the Step 8 retry row. (b) **One success per auto-adopted reply** — the qualifying row is the row *immediately* preceding the new user message, so a user firing three follow-ups at one suggestion scores one engagement, not three (the sketch's "last assistant row" triple-counts and would walk `band_shift` to its +0.10 cap on one chat). (c) **Server clock**, not `client_sent_at`: a Step 9 replay delivered late can lose a count, never produce a wrong one. (d) The 10-minute window is the new `[SPEC]` key `auto_adopt_window_minutes`, not a literal (AGENTS.md §2). (e) The increment is an RPC, not an upsert: PostgREST cannot express `col = col + 1`, and a read-modify-write would lose an update to the retry-vs-original race Step 5a proved real.

**Agent does:**

1. Migration `0023_auto_adopt_config`: the window key + `increment_auto_adopt_successes(user_id, domain)` — atomic insert-on-conflict, `SECURITY DEFINER` with a pinned `search_path`, execute revoked from public/anon/authenticated and granted to `service_role` only (the `claim_jobs` pattern, `0008`).
2. `send-message/index.ts`: `recordAutoAdoptSuccess()`, called from the **fresh-insert branch only** (a duplicate send, a repair run and an offline replay must not score the same arrival twice) and **before** the pipeline (the signal is the user's *arrival*, so a turn that then degrades still counts). It reads the single row immediately preceding the new user message, applies the four clauses (§5.3), and calls the RPC with that row's `metadata.domain`. Wrapped in `try/catch` — the user row is already committed, so a stats failure is logged and the turn proceeds (a 500 would strand it; Step 9 does not queue 5xx).
3. No client change, no new job type, no new Edge Function. `band_shift` is **not** written here — the §5.4 successes→shift rider is FP-02's OUT list — so the counter stays write-only until FP-03 consumes it.

**Verify:** reply quickly after a high-tier auto reply → `auto_adopt_successes` +1 for the right `(user, domain)` (SQL); set `auto_adopt_window_minutes=0` → reply → unchanged (also proves the key is read at runtime), restore to 10; medium/low/fallback routes → no increment; a simulated `llm_retry`-shaped secondary row (`route='auto'`, `reply_to_message_id` NULL) followed by a reply → unchanged; a primary `route='auto'` row with empty `metadata` → no count, no error, HTTP 200; re-POST the same `client_message_id` → unchanged (exactly-once); the RPC rejects the anon key. `scripts/verify-step10.py` automates all of it; the live run needs migrations `0022` + `0023` applied and `send-message` redeployed.

**Commit refs:** TECH-SPECS §3.4, §4.1, §5.3, §11; GLOSSARY §5, §16; FP-02 FR-14; D8. **Passes AC-9.**

---

## Step 11 — Timing/quota audit, doc write-backs, AC sweep

**Agent does:**

1. Timing + quota audit: 20-turn conversation (stub mode off); extract p50/max latency and per-provider call counts from adapter logs; record against §12 quotas (AC-10).
2. Write-back sweep — confirm all landed with their introducing commits and complete the remainder: TECH-SPECS §3.2 (`client_message_id`), §11 registry (5 new keys, dev-only flags marked), GLOSSARY (`dev-smoke`, new config keys, `client_message_id`, route metadata fields), and **TECH-SPECS §13 live item: iOS remote push blocked by $0 (Apple Developer Program) — escalation required before any intervention-dependent FP is judged done**.
3. `docs/feature-prds/FP-02-ACCEPTANCE.md`: AC-1–AC-12 pass/fail each; AC-2 qualitative notes → hardening-pass backlog (prompt v1 shortfalls, §14 step 11); AC-11 placeholder-removal re-verified.
4. Secret scan + AGENTS.md §9 checklist; final PR cites TECH-SPECS §4, §5.1–5.3, §7.10, §2.3, §4.2–4.3; D4, D13, D18, D23 (FP-02 §9).

**OWNER MANUAL:** judge AC-2 qualitatively (is Davos in character?); decide the iOS-push budget question and record the decision — it gates several later FPs.

**Verify:** every AC marked; write-back diffs present; repo clean.

**As-built notes (implementation order of record — the body above is the sketch):**

- **Acceptance-doc path corrected.** The sketch's `docs/feature-prds/FP-02-ACCEPTANCE.md` is stale: the repo keeps one folder per FP (`docs/feature-prds/FP-01/FP-01-ACCEPTANCE.md` is the precedent). The deliverable is **`docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md`**.
- **The audit is the AC-10 evidence, and it is owner-run.** `scripts/verify-step11.py` does the static half offline and, given `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DAVOS_USER_JWT` (+ optional `DEV_SMOKE_TOKEN`, `--logs`, `--turns`), runs the live half: 20 real-provider turns (stub off, `llm_force_fail='none'`, `dev_force` absent), per-turn latency p50/p90/max on the **server** clock with the client-observed delta reported alongside, row integrity, no degraded turn, a tier regression re-check (AC-3 tap + second-tap no-op, AC-4 low/fallback), the AC-5 conflict-filter re-check, the AC-11 seed/clear/seed round-trip and the AC-8 dedupe half. It snapshots and restores `llm_stub_mode`, `llm_stub_malformed`, `llm_force_fail`, `auto_adopt_window_minutes` and `dev_overrides_enabled` in a `finally`, and **keeps** the audit rows by default because they are the AC-2 material (`--cleanup` deletes them).
- **Per-provider counts come from the adapter's log lines.** Provider/latency is log-only by design — `messages.metadata` never carries it — so the counts are parsed from the bare JSON lines `logCall` emits (`{ts, provider, model, latencyMs, ok, requestId}`; `requestId === "embed"` marks the embedding call). Without `--logs` the section is advisory (a printed recipe plus the arithmetic projection) and never fails.
- **`persona_stats` stays client-writable for one's own row.** Migration `0007` lets a user write their own `persona_stats` row. That is deliberate and is **not** hardened here: a future `user_overrides` path may legitimately want a user-owned write, and the table holds no privileged data. Recorded in `0023`'s comment, TECH-SPECS §5.3, and PROGRESS rather than "fixed".
- **`band_shift` is not written.** The Step 10 counter is consumed by FP-03; Step 11 adds nothing to the write path.
- **Four ACs were owner-live and were marked OWNER-PENDING rather than waited on** — AC-2 (judge the audit thread's tone), AC-7 (Android push matrix), AC-8 (`verify-step9.py` live + the airplane-mode device run) and AC-9 (`verify-step10.py` live). All four passed on **2026-10-16**, alongside AC-10's live audit; AC-1/3/4/5/6/11/12 were already settled. FP-02 is accepted 12/12 (`docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md`).
- **Doc-identity drift, recorded rather than fixed.** `AGENTS.md` §1/§2/§9 referred to `docs/TECH-SPECS.md` while the file on disk (and the §2 table) is `docs/TECH-SPEC.md`; the filename mentions were corrected to the file that exists, while the `TECH-SPECS §N` **reference label** stays as §2's own reference convention defines it. `docs/DECISIONS.md` is a second, stale copy of the decisions table (no `… Update` rows, unreferenced by AGENTS.md §2, last touched by `74003fc`); it is left untouched and recorded as known drift.
