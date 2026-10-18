# TECH-SPECS.md — Davos: AI-Powered Life Mentor & Coach

**Status:** v1.0 — drafted for implementation
**Requirements source of truth:** ULTIMATE-PRD1.md (amended, confirmed authoritative)
**Architecture source of truth:** decisions2.md (D1–D25; severity criteria approved)
**Rule of precedence:** PRD → decisions2.md → this document. Where this document adds unspecified values, they are marked **[SPEC]** and are tunable via the `config` table.

---

## 1. System Architecture Overview

```
┌────────────────────────── CLIENT (Expo Router: iOS / Android / Web — co-equal) ──────────────────────┐
│  Chat thread (primary UI) │ Journal editor │ Dashboard (pre-built registry) │ Onboarding interview    │
│  Local check-in notifications (rolling 24h) │ Offline send queue │ Web Push + check-in banner (web)   │
└──────────────┬───────────────────────────────────────────────────────────────────────────────────────┘
               │ HTTPS (Supabase Auth JWT)                    │ Supabase Realtime (messages table)
┌──────────────▼───────────────────── SUPABASE (all-in-one, D12) ───────────────────────────────────────┐
│ Edge Functions (Deno):                                                                              │
│   [sync]  send-message · submit-checkin · submit-journal · select-persona · flag-unsavable           │
│   [dispatch] job-dispatcher (claims jobs table)                                                      │
│   [ops]   health (keep-alive target)                                                                 │
│ Postgres: pgvector + pg_cron + pg_net  →  jobs table  →  dispatcher  →  chained step functions       │
│ External: Gemini (embeddings + 3.5 Flash-Lite gen) · Groq (fallback gen) · Expo push · cron-job.org  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Two execution paths (D2):**
- **Synchronous** — client-invoked Edge Functions run ingestion + evaluation + (conditionally) generation in the same invocation. Satisfies PRD "immediate evaluation" / "instantly triggers."
- **Asynchronous** — pg_cron inserts job rows; the dispatcher claims and processes them (backoff, dead-letter). Covers watchdog, drift, Strikes, evening journal chain, metric evaluation, histograms, memory extraction, purge, proactive engagement.

---

## 2. Jobs System (D2/D12)

### 2.1 Schema

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),      -- uuid enables idempotent inserts
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','claimed','running','done','failed','dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,                -- [SPEC]
  next_retry_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);
create index jobs_due_idx on jobs (status, next_retry_at);
```

### 2.2 Dispatcher algorithm

1. pg_cron ticks every 1 min → `net.http_post` to `job-dispatcher` (fire-and-forget is safe: jobs are rows, the tick only *enables* claiming; a missed tick costs ≤1 min latency, never data).
2. Dispatcher: `select ... from jobs where status='pending' and next_retry_at <= now() order by next_retry_at limit 10 for update skip locked` → set `claimed/running` → execute handler → `done` or `failed` with `next_retry_at = now() + 2^attempts * 30s` (exponential backoff) → `dead` at `max_attempts`.
3. Claim includes a lease timestamp; a job `running` > 5 min without completion is reset to `pending` (crash recovery **[SPEC]**).
4. Handlers must be idempotent (uuid + status checks) — double-fire is tolerated by design.
5. **Batch budget:** a tick runs under `config.job_dispatcher_budget_ms` **[SPEC]** (140 s, i.e. below the 150 s invocation limit with room to settle the batch) and stops *starting* jobs once the next handler's worst case would no longer fit. A generation-capable handler reserves `pipeline_deadline_ms` before it starts; cheap handlers are listed in the dispatcher's `FAST_JOB_TYPES` and reserve nothing, so a batch of them still drains in one tick. Claims that were never started are released back to `pending` **with `attempts` decremented** — `claim_jobs` increments it as it claims, and a job that never ran must not drift toward dead-letter. (The lease-reset path deliberately does *not* decrement: after a kill, whether the handler ran is unknowable, so the increment stays as the safety valve against a handler that reliably kills its invocation.) A job type added without touching `FAST_JOB_TYPES` is treated as generation-capable — the default fails safe.

### 2.3 Job type registry

| Type | Inserted by | Cadence/trigger | Handler behavior |
|---|---|---|---|
| `watchdog_checkin` | pg_cron | every 5 min | find closed check-in windows (expected time + 10 min grace **[SPEC]**) with no `doings_logs` row → insert `intervention` job (the `intervention` handler sends the push) — **as built (Step 6):** migration 0027 schedules the guarded cron insert; the scan is `_shared/checkin/runWatchdog.ts` (`runWatchdogScan`) over the pure `watchdog.ts` |
| `drift_scan` | pg_cron | every 10 min | evaluate per-user drift patterns (§7.3) → conversational intervention + optional Side Quest |
| `journal_extract` | `submit-journal` (sync fn) | on journal submit | evening chain head (§7.4) |
| `journal_probe` | `journal_extract` | conditional (vague/severe) | send probe message + push |
| `anchor_plan` | `journal_extract` | after extraction | generate next-day anchor plan (§7.2) |
| `memory_extract` | send-message (sync fn) | when window boundary crossed | extract facts from aged-out messages (§7.6) |
| `purge_memory` | `flag-unsavable` (sync fn) | on late flag | delete derived facts by provenance (§7.6) |
| `metric_eval` | pg_cron | daily 00:30 user-local | evaluate all active JSONLogic formulas → `metric_points` |
| `histogram_daily` | pg_cron | daily 01:00 user-local | rebuild urge histograms (§7.8) |
| `strike_fire` | habit creation / daily check | at watch expiry (day X, 18:00 user-local **[SPEC]**) | generate Strike per Tiered Proof (§7.5) |
| `intervention` | watchdog / sync eval | on detection | generation call + high-priority push — **as built (Step 6):** the payload is `{user_id, window, reason}`; the handler generates with the locked persona `config.intervention_persona` and the D7 fallback domain, then writes an **unprompted** assistant row (`reply_to_message_id` NULL, `metadata.source='watchdog_intervention'`). Deliberately **not** in `FAST_JOB_TYPES` — it reserves `pipeline_deadline_ms` |
| `proactive` | pg_cron daily / profile-gap logic | 1–2×/day **[SPEC]** | profile-gap or companionship message |
| `llm_retry` | `send-message` (sync fn) | when **every** provider fails, or the sync budget expires (§4.1) | re-run stages 3–5 for the degraded turn through the adapter (primary → fallback), then write the real answer as a **secondary reply** (§3.2) + push. Idempotent: `messages_one_secondary_reply` + a pre-insert lookup |
| `quest_expire` | quest creation | at quest deadline | archive quest metric + debrief message |
| `smoke_test` | dev / manual | on demand | **dev-only**: no-op success or forced failure for dispatcher testing |

**Daily invocation budget (5 users):** dispatcher 1,440 + scheduled inserts ~500 + feature jobs ~2,000 ≈ **< 5K/day (~150K/mo) vs 500K verified limit.** Comfortable.

---

## 3. Data Layer

### 3.1 Global conventions

- All user-scoped tables carry `user_id uuid not null references auth.users(id)` with **RLS**: `using (auth.uid() = user_id)` on select/insert/update. System-written rows (pipeline insertions) use the service role, bypassing RLS.
- **Vector config:** all embeddings use `gemini-embedding-001`, `output_dimensionality = 768` **[SPEC]**, column type `vector(768)`, HNSW index (cosine ops). Embedding model identity is frozen for beta (D5); every vectorized row stores `embed_model text default 'gemini-embedding-001@768'`. Any model change = deliberate migration job re-embedding all tables.
- Timestamps are `timestamptz` (UTC); user-local rendering uses `profiles.timezone`.

### 3.2 Core tables

```sql
create table profiles (
  id uuid primary key references auth.users(id),
  display_name text,
  timezone text default 'UTC',
  onboarding_stage text not null default 'intro'
    check (onboarding_stage in ('intro','baseline','goals','routine','metric_selection','complete')),
  checkin_cadence_minutes int not null default 60,      -- 60 or 120 (bi-hourly option)
  checkin_active_hours_start time not null default '08:00',  -- [SPEC]
  checkin_active_hours_end   time not null default '22:00',  -- [SPEC] no overnight check-ins
  wake_time time, sleep_time time,
  routine jsonb default '{}',                            -- fixed routines (D14 constraints)
  high_dopamine_activities jsonb default '[]',           -- from onboarding (D22)
  trust_score int not null default 0,                    -- D20, 0–100
  dialog_state text not null default 'OPEN' check (dialog_state in ('OPEN','LOCKDOWN')),
  lockdown_started_at timestamptz,
  latest_energy int check (latest_energy between 1 and 10),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  unsavable boolean not null default false,
  client_sent_at timestamptz,                            -- offline-queue ordering truth (D23)
  client_message_id uuid,                                -- client-generated dedupe key (FR-16); NULL on assistant rows
  reply_to_message_id uuid,                              -- PRIMARY reply only: the user message it answers; NULL otherwise (§5.1)
  persona_key text,                                      -- SECONDARY reply only: the persona chosen from the chips (§5.3)
  secondary_reply_to_message_id uuid,                    -- SECONDARY reply only: the user message it re-answers; NULL otherwise
  metadata jsonb default '{}',                           -- persona, route, domain, rule_ids, persona_options[], source, user_message_id, source_job_id
  created_at timestamptz default now()
);
create index messages_thread_idx on messages (user_id, created_at desc);
create unique index messages_user_client_msg_uniq on messages (user_id, client_message_id);
create unique index messages_one_primary_reply on messages (reply_to_message_id)
  where reply_to_message_id is not null;                 -- at most one primary reply per user message
create unique index messages_one_secondary_reply on messages (secondary_reply_to_message_id)
  where secondary_reply_to_message_id is not null;       -- one chip choice consumes the whole option set (§5.3)

create table doings_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('doing','impulse_failure')),
  content text,
  energy int check (energy between 1 and 10),
  source text not null check (source in ('checkin_reply','chat','app','quick_action')),
  logged_at timestamptz not null,                        -- when the doing happened; a check-in sets it to the canonical window close (§7.1)
  checkin_window timestamptz,                            -- which interval this answers (watchdog join key); the canonical window START
  embed_model text, embedding vector(768),
  created_at timestamptz default now()
);
create index doings_user_time_idx on doings_logs (user_id, logged_at desc);
create unique index doings_logs_one_checkin_window      -- one doing per check-in window (FP-04)
  on doings_logs (user_id, checkin_window) where checkin_window is not null;
```

**Message dedupe (FR-16, D23):** `client_message_id` is generated client-side; the unique index `(user_id, client_message_id)` makes `send-message` idempotent — a repeat send (`on conflict do nothing`) never creates a second user row. Assistant rows leave `client_message_id` NULL; Postgres treats NULLs as distinct, so they never collide.

**Primary vs secondary reply (FR-5, FR-11, §5.1):** a **primary reply** is the pipeline's single assistant answer to a user message; it sets `reply_to_message_id` and is unique per user message (`messages_one_primary_reply`). A **secondary reply** is a later re-run for the same user message (`select-persona`, D13's Medium tier) and **must leave `reply_to_message_id` NULL** so the guard never blocks it. Because it cannot use that column, a secondary reply anchors on `secondary_reply_to_message_id` (the user message it re-answers) and records its choice in `persona_key`. `messages_one_secondary_reply` makes that anchor unique: one chip tap consumes the whole option set (FR-11), so a second tap — same key or a different one — is a no-op. `reply_to_message_id` is authoritative for the user-message↔reply link; `metadata.user_message_id` is retained as a client/telemetry convenience. No FK on either column: account deletion removes a user's parent and child rows in one statement, which immediate FK enforcement can reject.

**Sync-degrade pair (§4.1):** when every provider fails, `send-message` writes the holding message as the turn's **primary** reply (`metadata.route = 'degrade'`, `metadata.source = 'sync_degrade'`) — going through the same anchor keeps "at most one reply per user message" true and lets the client's existing dedupe apply — and enqueues exactly one `llm_retry` job. The job's real answer is a **secondary** reply (`metadata.source = 'llm_retry'`, `metadata.route` = the route that produced the turn), so both rows survive dedupe and render in `created_at` order. `metadata.source_job_id` carries the job id on both rows.

**Check-in prefs write path (FR-17, D9):** `update_checkin_prefs(p_cadence int, p_start time, p_end time, p_tz text)` is the validated client path for the four check-in columns — `checkin_cadence_minutes`, `checkin_active_hours_start`, `checkin_active_hours_end`, `timezone`. `plpgsql`, `security definer`, `set search_path = public`; it takes **no user id** and filters `where id = auth.uid()` behind a null-uid guard (a definer function bypasses RLS, so `auth.uid()` is the boundary), validates cadence ∈ {60,120}, `p_start < p_end`, and `p_tz` against `pg_timezone_names`, and is granted to `authenticated` + `service_role` only. It is the validated path, **not** a lockdown: `profiles` keeps its own-row `update` grant (0005), so a hand-crafted PostgREST PATCH can bypass the validation (recorded as a live item, FP-04 Out of scope).

**Check-in ingestion (`submit-checkin`, FR-5–FR-8, §7.1):** the client's `windowTs` is a hint and the server canonicalizes it **before** any lookup, so `checkin_window` always holds a grid start and a shifted or replayed hint can never mint a second row. The row is inserted with `logged_at` = that window's **canonical window close** — the interval the user is reporting on has just ended, which is what the doings corpus and the drift math read, and which makes a replay after a process death record the same instant rather than a misleading later one. `energy` comes from the text's trailing integer (§7.1) and may be NULL; the chips strip supplies it later through the same function's PATCH. `profiles.latest_energy` tracks the newest known value from either path, best-effort — the doing row is already committed, so a failure there must never become a 500. The duplicate select runs **before** the embed (a repeat costs zero provider calls), and `doings_logs_one_checkin_window` is the backstop for a concurrent submit: 23505 re-selects the winner's row and returns `duplicate`.

### 3.3 Knowledge & memory tables

```sql
create table rules (                                     -- pre-seeded (D17 content deliverable)
  id uuid primary key,
  text text not null,
  domain text not null,
  source_figure text not null,
  tone text not null check (tone in ('aggressive','empathetic','neutral')),
  priority int not null default 50,                      -- conflict filter tiebreak (§5.2)
  embed_model text, embedding vector(768)
);

create table exemplars (                                 -- classifier sets (D19), seeded with rules migration
  id uuid primary key,
  set_kind text not null check (set_kind in ('domain','emotion','quit_signal')),
  label text not null,                                   -- domain name | emotion | 'quit'/'false_constraint'
  text text not null,
  source text not null default 'PLACEHOLDER-DEV',        -- provenance: 'PLACEHOLDER-DEV' | 'BG-04' (FP-03, migration 0024)
  embed_model text, embedding vector(768) not null
);

create table memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  fact text not null,
  fact_type text not null default 'chat' check (fact_type in ('chat','journal','oath','baseline')),
  source_message_id uuid references messages(id),        -- provenance (purge key, D6)
  source_journal_id uuid references journal_entries(id),
  embed_model text, embedding vector(768),
  purged_at timestamptz,                                 -- soft-delete; excluded from retrieval
  created_at timestamptz default now()
);
```

**Domain enum:** 16 domains are part of the rules-library content deliverable (D17). **Approved set (owner decision recorded in `content/reports/FP-03-BG04-APPROVAL-RECORD.md` §1–§2; BG-02 memo recommendation not adopted):** Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy. The canonical strings match the shipped system (rules tagging, placeholder corpus, golden set, config) and use `Title Case` with slashes per the operational vocabulary; the BG-02 memo set (mind, mastery, strategy, wealth, health, character, relationships, creativity, resilience, purpose, spirituality, time, communication, learning, leadership, habits) is superseded: `_shared/content.ts` `DOMAIN_ENUM` now carries the canonical set, so `rules.csv` rows still tagged with memo labels fail validation until the BG-03 re-tag pass — exemplars validate against canonical labels (not enum-checked). `General` remains the reserved D7 fallback value outside the enum (§5.3).

### 3.4 Feature tables

```sql
create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  content text not null,                                 -- post-strip permitted text only (D3)
  entry_date date not null,
  vagueness_score numeric,                               -- 0–1 from extraction
  severity text check (severity in ('S1','S2','S3')),
  probed boolean default false,
  created_at timestamptz default now()
);

create table metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  domain text,
  is_core boolean default false,                         -- onboarding-selected (D17)
  is_quest boolean default false,
  quest_status text check (quest_status in ('active','completed','expired','failed')),
  quest_deadline date,
  formula jsonb not null,                                -- validated JSONLogic (D10)
  formula_status text not null default 'proposed' check (formula_status in ('proposed','validated','rejected')),
  output_unit text,
  archived_at timestamptz,
  created_at timestamptz default now()
);

create table metric_points (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references metrics(id),
  value numeric not null,
  computed_for date not null,
  created_at timestamptz default now(),
  unique (metric_id, computed_for)
);

create table anchor_plans (                              -- D14 Layer 1
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_date date not null,
  anchors jsonb not null,                                -- [{start,end,label,kind: commitment|deadline|routine|free_block|boredom_relief}]
  created_at timestamptz default now(),
  unique (user_id, plan_date)
);

create table habits (                                    -- D24 strike lifecycle
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  description text not null,
  status text not null default 'detected'
    check (status in ('detected','confronted','watch','struck','quit_committed','cancelled')),
  detected_at timestamptz default now(),
  watch_started_at date,
  watch_days int not null default 7,
  strike_at date,                                        -- watch_started_at + watch_days
  created_at timestamptz default now()
);

create table persona_stats (                             -- D8 adaptive weighting
  user_id uuid not null,
  domain text not null,
  auto_adopt_successes int default 0,                    -- user replied within config.auto_adopt_window_minutes to an auto-adopted PRIMARY reply (§5.3) [SPEC]
  user_overrides int default 0,                          -- explicit persona correction
  band_shift numeric default 0,                          -- effective bands = config bands ± band_shift (±0.10 cap [SPEC])
  primary key (user_id, domain)
);

create table trust_events (                              -- D20 audit log (server-only; score itself hidden)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  delta int not null,
  reason text not null check (reason in ('openness','admission','streak','override')),
  created_at timestamptz default now()
);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  platform text check (platform in ('ios','android','web')),
  created_at timestamptz default now(),
  unique (user_id, token)
);

create table config (
  key text primary key,
  value jsonb not null,
  description text
);
```

### 3.5 Migration order

1. Extensions (`pgcrypto`, `pg_cron`, `pg_net`, `vector`) + `config` seed (§11).
2. Auth + `profiles` + `push_tokens`.
3. `messages`, `doings_logs` (+ vector indexes).
4. `rules`, `exemplars` (empty; content migrations follow).
5. `memory_facts`, `journal_entries`, `metrics`, `metric_points`, `anchor_plans`, `habits`, `persona_stats`, `trust_events`.
6. `jobs` + pg_cron schedules (§2).
7. Content migrations: rules library (100+ rows + embeddings), exemplar sets (domains ×~10, emotions ×~8, quit ×~10) — **gated on content authoring (D17/D19)**. Seeding runs through the `content-seed` function (BG-01): shared validation core with `content/validate.ts`, **approved rows only** (§8.4), deterministic uuid v5 ids derived from content string ids (idempotent upserts — `rules.id`/`exemplars.id` have no DB default), `embed_model='gemini-embedding-001@768'`; dry-run mode reports per-table/per-status counts and writes nothing; `clear` deletes by ids or dev label. Bearer-token gated (`CONTENT_SEED_TOKEN`, dev-smoke pattern).

---

## 4. LLM Layer

### 4.1 Provider adapter (D18)

| Slot | Provider / Model | Limits (verified) | Structured output |
|---|---|---|---|
| Primary generation | Gemini `gemini-3.5-flash-lite` | 15 RPM / 500 RPD | JSON Schema — verified |
| Fallback / overflow generation | Groq `openai/gpt-oss-120b` | 30 RPM / 1,000 RPD | JSON mode — **verified 2026-10-15** |
| Embeddings | Gemini `gemini-embedding-001` @768 | 100 RPM / 30K TPM / 1,000 RPD | n/a |

- One internal interface: `llm.generate({system, messages, schema, tier})` / `llm.embed(texts[])`. Adapter selects provider by quota headroom (async) or primary-then-retry (sync).
- The same adapter serves both the §4.2 generation contract and the §4.3 extraction contract: `generate<T>` takes a per-call structural validator, defaulting to the §4.2 anchored contract, so extraction passes its own without a second provider path.
- **Stub-shape dispatch (FP-04 Step 3a):** stub mode carries one canned §4.2 payload, which a caller's own validator (§4.3 family) would reject — the stub would answer `kind:'validation'` and could not exercise the path it exists to exercise. A contract module therefore registers its canned payload against its own validator in `_shared/llm/stubShapes.ts` (selection is by **validator identity**, the exact function the adapter applies), and the stub branch dispatches the registered payload, falling back to the §4.2 payload when none is registered. Every existing caller (a generic `generate` with no validator, the §4.3 extraction) is unchanged.
- **Sync path failure:** the adapter tries primary → fallback *inline*, so a single provider failure (a routine 429, say) is invisible to the user. Only when **both** tiers fail — or the synchronous budget `config.pipeline_deadline_ms` **[SPEC]** runs out — does the turn degrade: the user gets an immediate in-character holding message (config `sync_degrade_reply` **[SPEC]**: e.g., *"Noted. Give me a second."*), written as the turn's **primary reply**, and exactly one `llm_retry` job is enqueued to re-run stages 3–5 from the stored text and write the real answer as a **secondary reply** (§3.2), pushed when it lands. A *structural* failure is not this path: it stays on §4.2's bounded retry → `malformed_fallback_reply`, because a retry job cannot make an off-contract model contract-compliant. Never blocks ingestion; never loops.
- **Per-call timeout:** every provider fetch carries `AbortSignal.timeout(config.llm_call_timeout_ms)` **[SPEC]**, so a hung socket is a *transport* failure instead of an invocation that burns the 150 s synchronous budget; `pipeline_deadline_ms` is the backstop that degrades **before** the platform can kill the invocation (a kill would strand the turn, since the user row is already committed). The adapter reports a structured failure `kind` (`transport` | `parse` | `validation`) so the caller can tell the two paths apart.

> **As-built note (FP-02 Step 8):** the sync-failure bullet above previously read *"provider 429/5xx → insert `llm_retry` job (payload = original call, target = fallback)"* — the pre-implementation sketch, which read as if any single provider hiccup must become user-visible. The shipped rule is **both tiers failed** (or the budget expiring), as written above. Ratified in `docs/adr/decisions2.md` as **Decision 18 Update**.
- **Groq JSON-mode degrade (if unconfirmed):** schema embedded in prompt + single parse retry; a second failure → graceful fallback response (D13). No open loops.
- **Few-shot exemplars must be provider-tested** on both providers before beta (consistency requirement, D18).

### 4.2 Generation call contract (all generation calls)

```json
// response schema (enforced via responseSchema / JSON mode)
{
  "tactical_analysis": "string (internal reasoning — NEVER delivered to client)",
  "direct_quote": "string (the rendered message)",
  "persona": "enum(persona_key)",
  "ui_metadata": { "persona_options": [{"key","label","one_liner"}] }  // only on Medium-tier turns
}
```

**Server-side stripping (D13):** pipeline persists only `direct_quote` + `ui_metadata` into `messages`; `tactical_analysis` goes to Edge Function logs (never to DB, never to client). Exactly one bounded retry on structural parse failure, then config `malformed_fallback_reply` **[SPEC]**.

### 4.3 Extraction call contracts

**Per-turn sync extraction** (rides `send-message` / `submit-checkin`):
```json
{ "intent_flags": { "give_up": bool, "false_constraint": bool, "concession": bool,
                    "quit_commitment": bool, "admission": bool },
  "openness_delta": "int -5..5", "topic": "string" }
```

**Chunk memory extraction** (async, aged-out messages):
```json
{ "facts": [{"text": "string", "source_message_id": "uuid"}],
  "openness_delta": "int -5..5" }
```

**Journal extraction** (§7.4):
```json
{ "insights": [{"text": "string"}], "vagueness_score": "0..1", "severity": "S1|S2|S3",
  "openness_delta": "int -5..5", "admission_flag": bool }
```

**Check-in evaluation** (sync, gated — FP-04 §7.1 step 2):
```json
{ "deviation": bool, "intervention": bool }
```
Two booleans and nothing else — no `tactical_analysis`, because the result is decision-only and never delivered. The contract lives in `_shared/checkin/evalContract.ts` (pure: schema, validator, prompt builder, fail-open combinator) with the adapter-bound entry point `evaluateDoing` in `_shared/checkin/eval.ts`. It is gated (§7.1 step 2), and it **fails open** — after §4.2's one bounded retry on a structural failure, or immediately on a transport failure — to `{deviation:false, intervention:false}` plus one structured warning, because the doing is already ingested and there is no reply to hold (§4.1's holding-reply path does not apply to it).

---

## 5. Pipeline Contracts (D4)

### 5.1 Stage sequence (per user message / check-in submission)

```
1. Context/State Extraction      (sync, LLM-lite — §4.3 contract)
2. Classifier                    (deterministic, embedding — §6)
3. Rule Retrieval + conflict filter (deterministic, pgvector)
4. Persona Determination         (three-tier routing — §5.3)
5. Final Response Generation     (LLM, §4.2 contract)
```

Stage 1 and 2 run in parallel (independent). Stage 5 runs only after 3–4 resolve (or immediately for Medium-tier option presentation).

**Stage-2 mode branch (FP-03 Step 5, FR-11):** stage 2 reads `config.classifier_mode` (§11). `'real'` runs the embedding classifier — one `match_exemplars` round over the seeded exemplars (§6.2–§6.4), plus the turn's `energy` input on check-in turns (§6.1); `'stub'` keeps the FP-02 deterministic stub, and anything that is not exactly `'real'` runs the stub, so a malformed config row cannot break a turn. Both modes emit the identical §6.3 block, so stages 3–5 cannot tell them apart. The message embedding is the *same* single embed either way: it is awaited **before** stage 2 (the real classifier consumes it) and reused by stage 3, so a turn still issues exactly one embed — and the await moves without the failure semantics moving, because a failed embed is non-fatal at stage 2 (it yields the §6.4 D7 block, so the routing decision exists) and stage 3's throw carries it into the §4.1 hand-off below. Real mode adds one RPC round trip and zero provider calls, and emits one structured `stage: 'classify'` log line after stage 4 (`mode`, labels, confidences, `quit_signal`, route, latency) as the FR-17 evidence and Step 6's calibration feed; the line carries no `provider`/`requestId`, so the adapter's per-call log accounting is unaffected. Rollback is the config flip back to `'stub'` — no redeploy.

**Domain hand-off (stage 4 → stage 3):** stage 4 resolves the *effective* domain before stage 3's rule query, because the fallback route forces `General` (D7) and that state must retrieve no aggressive rules. The message embedding itself is independent of the domain and runs alongside stages 1–2.

**Sync-degrade hand-off (§4.1, FP-02 Step 8):** a *transport* failure in stage 3 (the message embed) or stage 5 rethrows `ProvidersUnavailableError` carrying the stage-1–4 decision. The caller writes the holding message as the turn's primary reply and enqueues exactly one `llm_retry` job; that job re-runs **stages 3–5** with the persona and domain from its payload. Stage 3 is part of the re-run precisely because the embed is one of the two things that can fail (stages 1–2 are non-fatal by design; only 3 and 5 can block a reply). Before each expensive stage the run also checks its `pipeline_deadline_ms` budget and degrades rather than letting the platform kill the invocation. The hand-off is total by construction: `determinePersona` returns a concrete persona on **every** route — the D7 fallback yields `inquirer` — so a decision payload always carries one, and the `llm_retry` handler logs and closes the job (it never generates) if `persona` or `domain` is missing. On a **Medium** turn the locked persona is stage 4's auto candidate (the emotion-mapped one), *not* the chip the user would have tapped, because the holding reply carries no chips — chips need a primary reply to anchor on (§5.3); the retry row still records the original turn's `metadata.route` (`'options'` here) because `route` must keep describing the tier that produced the turn — the D8 `auto_adopt_successes` counter is blind to secondary rows by design (§5.3). Row shape: the holding reply carries `metadata.route='degrade'`, `source='sync_degrade'`, `domain`, `source_job_id` and deliberately **no** `persona` (its text is `config.sync_degrade_reply`, not a persona-driven generation); the retry's real answer carries `persona_key` + `metadata.persona`, `domain`, `rule_ids`, `route`, `source='llm_retry'`, `source_job_id`.

**Repair-on-duplicate (§7.10):** if a `send-message` retry arrives for a user message that has **no primary reply** — the window opens when the invocation *dies* after the user row is written; a provider outage no longer opens it on its own, since a transport outage returns the holding reply and a structural failure returns `malformed_fallback_reply` (§4.2) — the whole sequence above is re-run from the **stored** user text and the primary reply is written. One residual transport window does remain, and it is accepted rather than repaired: if the invocation is killed or the `jobs` insert itself fails **after** the holding row lands, the turn is answered, there is no `llm_retry` job, and no repair fires — the retry path sees a primary reply and returns `duplicate`, and the client does not auto-retry (a `200 ok` is not one of §7.10's retry conditions). The turn keeps the holding bubble only. This sits beside the accepted dead-letter residual risk (§4.1, PROGRESS); a reconciliation sweep for `metadata.source_job_id` values with no `jobs` row is the eventual fix and is **not** implemented. Under concurrency (retry-vs-retry, or original-vs-repair) the `messages_one_primary_reply` index guarantees a single reply: the losing invocation catches Postgres `23505` and returns the winner's id.

### 5.2 Rule retrieval + conflict filter (deterministic)

1. `select * from rules where domain = :domain order by embedding <=> :msg_embedding limit 5`.
2. Conflict filter: group by `tone`; if aggressive and empathetic rules are both present in the same domain AND their group-max priorities are within `config.conflict_priority_window` points **[SPEC]**, drop the lower-priority group (tie keeps aggressive) — enforces PRD §2 "no contradictory advice."
3. Pass surviving rule texts + tone tags to generation as context.

### 5.3 Persona Determination (three-tier, PRD §2)

Confidence source: classifier `overall_conf` (§6.3), adjusted by `persona_stats.band_shift` (D8). Effective bands (defaults §11):

| Effective confidence | Behavior |
|---|---|
| ≥ High band (0.75) | Auto-adopt persona matching detected emotion; increment `auto_adopt_successes` when the next user message arrives within `config.auto_adopt_window_minutes` (D8 input — the exact counting rule is recorded below) |
| Medium band (0.55–0.74) | Generation emits `ui_metadata.persona_options` (2–3 options, in-chat quick-select chips per §3.0); client renders chips; user tap → `select-persona` fn → **re-run stages 3–5 only**, persona locked for the turn |
| Low band (0.40–0.54) | Davos explicitly asks in-thread how to proceed (direct_quote is the question itself) |
| < 0.40 / no match | D7 fallback: domain = `General`, persona = `inquirer`; next message re-routes normally |

**Chip re-run (`select-persona`, FR-10/FR-11):** each chip carries `key`, `label` and `one_liner` (§4.2). A tap posts `{ message_id, persona_key }` to `select-persona`, which validates the key against **that** message's own `persona_options` *and* the persona-key enum below — Groq JSON mode does not enforce the response's `key` enum, so the chip key is never trusted from the model (§4.1). The user's text and the domain are then read from server state (`reply_to_message_id` → the user row; `metadata.domain` on the option message), never from the request body, and stages 3–5 are re-run (embed → retrieve → generate) with the persona **locked**. Generation uses the `auto` route variant: the persona is already decided, so the turn must answer directly and must not offer options again.

The result is a **secondary reply** (§3.2): `reply_to_message_id` NULL, `persona_key` = the chosen key, `secondary_reply_to_message_id` = the user message, `metadata.source = 'pipeline_secondary'`. `metadata.route` records the tier that produced the reply (`options`), **not** `auto`, so the D8 `auto_adopt_successes` counter can never mistake a deliberate choice for an accepted suggestion (§5.4). One tap consumes the whole option set: `messages_one_secondary_reply` permits one secondary reply per user message, so a further tap (same key or another) returns `duplicate` and writes nothing.

**`auto_adopt_successes` write path (Step 10).** *Decided 2026-10-16, closing the review question Step 8 raised here.* `send-message` records a success from the **fresh-insert branch only** — a duplicate send, a §5.1 repair run and a Step 9 offline replay must never score the same arrival twice — and **before** the pipeline runs, because the signal is the user's arrival: a turn that then degrades still counts. A success is recorded when all four clauses hold:

1. **Primary only.** The preceding row must be a *primary* reply (`reply_to_message_id IS NOT NULL`). The Step 8 `llm_retry` secondary row carries the **original** turn's `metadata.route` by design (§3.2), so without this clause a High-tier turn degraded by an outage and answered minutes later would read exactly like an accepted auto-adoption. D8's signal is engagement with a persona the system picked for the user, and an answer the user had stopped waiting for is not that. `reply_to_message_id` is the structural test for "the sync pipeline's own reply" — the only other primary writer, the degrade holding reply, carries `route='degrade'`.
2. **`metadata.route = 'auto'`.** This excludes the `options`-route retry row and the `pipeline_secondary` chip re-run (a deliberate choice is not an accepted suggestion), as well as low/fallback turns.
3. **One per auto-adopted reply.** The qualifying row must be the row *immediately* preceding the new user message, so a user firing three follow-ups at one suggestion scores one engagement, not three. An intervening user row means the auto reply was not the turn being answered.
4. **Inside `config.auto_adopt_window_minutes`, measured on the server clock** — never `client_sent_at` (§5.1, untrusted input). An offline reply delivered late by the Step 9 queue can therefore miss the window: a lost count, never a wrong one.

The write is the atomic `increment_auto_adopt_successes(user_id, domain)` insert-on-conflict (migration `0023`) with the domain taken from the qualifying row's `metadata`; a missing domain skips the count rather than inventing a `persona_stats` row. Execute is granted to `service_role` only, so the increment is not client-callable; the table's own `persona_stats_*_own` policies (`0007`) remain the only client-writable path, which can only ever affect the calling user's own weighting. The call is **non-fatal**: the user row is already committed, so a stats failure is logged, never a 500 that strands the turn. Nothing consumes the counter yet — `band_shift` is written by the §5.4 rider, which FP-02 leaves out of scope — so the column stays write-only until FP-03.

5. **Check-in turns are transparent** (FP-04 Step 3b, FR-10). A materialized check-in turn puts a user row (`metadata.source='checkin'`) *and* a primary reply (`source='pipeline'`, `reply_to_message_id` set) between the auto-adopted reply and the user's next message, so clause 3's literal reading would stop the walk on a row the user never typed: any check-in followed by a real reply would silently forfeit the success. The counter therefore walks the recent slice **through** a check-in turn — a user row carrying `metadata.source='checkin'`, or a reply whose anchor row carries it, is skipped — and the first row that is neither ends the walk. Clause 2 still excludes the check-in's own reply from scoring, and the anchor lookup happens in code because `messages.reply_to_message_id` carries no FK (PostgREST cannot embed that row). When a reply's anchor is not in the slice the answer is *unknown*, and unknown stops the walk exactly like a foreign row: a lost count, never a wrong one (§5.1). The rule is one pure module, `_shared/pipeline/autoAdopt.ts` (`decideAutoAdopt`), unit-tested against AC-7 in both directions and against the "check-in then reply" and "reply then check-in" orders; `submit-checkin` itself never calls the recorder — parsing a check-in is not engaging with a persona, and a replayed check-in must not score twice.

**Lockdown override (D21):** if `profiles.dialog_state = 'LOCKDOWN'`, stages 4–5 are forced: persona = `confrontation`, rule retrieval filtered to accountability domains (Career, Discipline/Habits + PRD-selected), off-topic messages (classifier domain mismatch ≥ Medium) are redirected in-response. Exit: `concession` intent flag → `dialog_state='OPEN'`; circuit breaker: auto-exit after 24 h **[SPEC]**; severity override: S1/S2 journal or extraction severity → immediate exit + empathetic persona (§11 severity criteria).

**Persona keys [SPEC]:** `mentor_tough`, `therapist_empath`, `trainer`, `financial_consultant`, `brother`, `inquirer`, `confrontation`.

### 5.4 Trust/Openness rider (D20)

On every extraction result: `trust_score += openness_delta` (clamped 0–100) + `trust_events` row; `admission_flag` → +10; `quit_commitment` → habit cancellation (§7.5). Check-in compliance: daily job appends +2 per streak ≥ 3 days **[SPEC]**, logged as `streak`. User persona override → `persona_stats.user_overrides++`, `band_shift -= 0.02` (floor −0.10) **[SPEC]**; successes → `band_shift += 0.01` (cap +0.10).

**Oath trigger:** `admission_flag` AND `trust_score ≥ 70` → generation call (persona = `mentor_tough`, context includes the admission) demanding the Oath; user's oath message → `memory_facts (fact_type='oath', source_message_id)` — never purgeable by flag (binding by design **[SPEC]**; revisit if requested).

**Breakdown trigger:** classifier emotion ∈ {exhausted, anxious, avoidant} with confidence ≥ High on a user message while `trust_score ≥ 70` **[SPEC]** → intervention job: deterministic SQL aggregates (day-1→now: check-in count/compliance, metric deltas, streaks) + one LLM narrative wrap + re-present oath text; delivered via push + chat.

---

## 6. Classifier Contract (D19)

### 6.1 Inputs

`message text`, `profiles.latest_energy` (check-in turns only), `dialog_state` (context flag).

**As built (FP-03 Step 7):** `energy` reaches stage 2 as an optional *turn* parameter on the pipeline entry, not as a profile read inside the classifier. **No chat-turn caller passes** one, so the §6.2 override was dormant. **Superseded by FP-04 Step 3b:** FP-04 supplies the caller — an intervention check-in turn invokes `runPipeline(text, energy)` with the energy the submit parsed (AC-4's "pipeline **with energy**"), which is what makes the override live: energy ≤ 3 forces `exhausted`, energy ≥ 8 forces `determined` (§6.2 step 3). Chat turns still pass none, so the override stays scoped to check-in turns.

### 6.2 Process (deterministic, no LLM)

1. Embed message text (single Gemini embedding call, reused later for doings memory).
2. pgvector cosine nearest-match, independently against three exemplar sets: `domain`, `emotion`, `quit_signal`. One `match_exemplars(query_embedding)` RPC covers all three: it returns one row per `(set_kind, label)` with the max cosine similarity over the seeded rows (~24 rows at full seed; no limit — the classifier argmaxes per label), `security definer` with a pinned `search_path` and execute granted to `authenticated` + `service_role` (migration `0025`).
3. Check-in turns: energy ≤ 3 → emotion forced `exhausted`; energy ≥ 8 → forced `determined` (overrides embedding match).

**As built (FP-03 Step 7):** the forced-emotion confidence is the **spec-literal** reading — a forced label carries *its own* best similarity as `emotion_conf`; the override changes the label, never the number. Because `overall_conf = min(domain_conf, emotion_conf)` (§6.3), that means a check-in turn whose wording does not read "exhausted" can be pulled *down* by the forced label's own low similarity even though the user typed the energy score. The two readings are: **(a) spec-literal** (shipped) — the emotion must still be corroborated by the text, so a terse turn is treated as low-confidence; or **(b) authoritative** — a forced label carries `emotion_conf = 1.0`, because the typed score is ground truth, so energy can then only ever *raise* confidence. **The Step 6 fixture cannot separate them:** all 8 energy items reached `auto` under spec-literal, and their forced-label similarities ran 0.80–0.88 (the binding `min` on most of them) against a `high` band of 0.75, so both readings put every item in the same tier. **Decided (owner, 2026-10-17): keep this reading.** The authoritative alternative would make the typed energy value load-bearing — the check-in flow would have to *always* collect a score for the confidence basis to be sound — whereas spec-literal keeps the message text as the single basis of confidence in every mode. It stays a one-line change in `classifyReal` plus a Step 6 re-run — **not** a `config` value — so the decision is reversible if the check-in FP's own evidence ever argues otherwise. A failed message embed does not throw out of stage 2 — the D7 block is returned; the await ordering that keeps stage 3's throw in the FP-02 hand-off is §5.1's stage-2 branch note.

### 6.3 Outputs

```json
{ "domain": "label|null", "domain_conf": "0..1", "emotion": "label|null",
  "emotion_conf": "0..1", "quit_signal": "bool", "overall_conf": "0..1" }
```

`overall_conf = min(domain_conf, emotion_conf)` **[SPEC]**. `quit_signal = true` when quit-set top similarity ≥ 0.75 **[SPEC]** → arms D21 alongside extraction `intent_flags` (redundant signals, either triggers).

### 6.4 Fallback

`overall_conf < 0.40` OR either label null → D7 route (`General` + `inquirer`).

**Exemplar set sizes [SPEC]:** ~10 examples per domain (160), 8 per emotion (48), 10 per quit label (20). Content deliverable alongside rules library.

**Seeding:** until BG-04 content lands, the classifier ships labelled placeholders — `_shared/dev/placeholderExemplars.ts` (`source='PLACEHOLDER-DEV'`, sized to the counts above), seeded and removed by `dev-smoke ?action=seed-exemplars` / `?action=clear-exemplars` (real embeddings through `llm.embed`; `seed-exemplars` requires `llm_stub_mode=false`). **The seed is resumable and paced** (FP-03 Step 6 amendment): Gemini counts *every item* of a `batchEmbedContents` call against the embedding quota (§12: 100 RPM / 1,000 RPD — measured at 140/100 RPM in the Cloud console during the first Step 6 run), while one Edge invocation is capped at 150 s, so a 228-item seed can never complete in one call. `?action=seed-exemplars` therefore accepts `&offset=`/`&limit=` (window ≤ 100 items, default 80), clears the prior placeholder rows only for `offset=0` (a bare call stays idempotent; a resumed window appends instead of restarting), always returns `next`/`done`, and answers a quota refusal with HTTP 429 rather than a 500. Callers pace the windows through `scripts/_fp03_corpus.py` (`seed_corpus`: 65 s between windows → 80 items/min, 429 retried with a backoff, a complete corpus left alone), which is what the step gates use. A full re-seed costs 228 embedding units (~23% of the daily RPD), so a seeded corpus is reused rather than rebuilt.

**BG-04 swap (FP-03 Step 7, FR-16/AC-8):** the exemplar `source` tag is also the content *slot*. `?action=seed-exemplars` and `?action=clear-exemplars` both accept `&source=`, restricted to the two FR-1 values, with `PLACEHOLDER-DEV` as the default so every pre-Step-7 caller is unchanged; a re-seed clears only the named source's rows, so placeholders and BG-04 rows never delete each other. The `BG-04` slot is `_shared/content/exemplars/bg04.ts` — inside the functions tree because an Edge Function is bundled from `supabase/functions` only — and currently holds a DRAFT 2-label × 2-text stand-in (`status='draft'`, AGENTS.md §8.4) which `scripts/verify-fp03-step7.py` seeds, classifies against, and clears to prove the swap is data-only. The owner-approved set replaces that file's content (`status='approved'`); the real swap is then a content edit plus `seed-exemplars&source=BG-04` + `clear-exemplars`, with no classifier, pipeline or schema code change. The runbook is `docs/feature-prds/FP-03/FP-03-BG04-SWAP-RUNBOOK.md`.

**Evaluation gate (FP-03 Step 6):** the classifier is evaluated by a 40-item golden set — `_shared/dev/goldenSet.ts`, DRAFT content (12 clear-domain / 8 ambiguous / 8 energy / 6 quit / 6 false-constraint), disjoint from the seeded exemplars and never seeded itself — driven by `dev-smoke ?action=eval-classifier` (one batched embed, then `classifyReal` per item; requires `llm_stub_mode=false`). `scripts/verify-fp03-step6.py` gates clear-domain accuracy ≥ 0.90 and energy-override compliance = 100%, records the quit / false-constraint confusion matrix, and archives the calibration evidence plus the **proposed** `confidence_bands` at `docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<date>.md`. That proposal is advisory: the bands are shared with the stub, so a move is a D4 decision applied at the Step 7 flip.

---

## 7. Feature Specifications

### 7.1 Interval check-in loop (D9)

**Client scheduling:** rolling 24 h window of local notifications, deterministic ids `checkin_{userId}_{epochHour}`; scheduled at app open, after each submission, and after a settings save (the three FR-1/AC-9 re-arm triggers); cadence from `profiles.checkin_cadence_minutes`; suppressed outside active hours (§3.2). One missed reply never affects future notifications (pre-scheduled by design).

**Notification payload:** title "What did you do this hour?", actions: [Reply (text input)], tap → deep link `davos://chat?focus=checkin&windowTs={start-epoch-ms}` (web: `/chat?focus=checkin`). The window start rides along so a tap seconds *after* the window closed still answers the interval the notification asked about, not the hour that has just opened (§7.1 capture, FR-4).

**Client modules (FP-04 Step 4).** The client half is three modules: `lib/checkinGrid.ts` — pure window math (zero value imports, so jest loads it) that mirrors the server grid exactly; `lib/checkins.ts` — the scheduler (arm/cancel, the Android `checkin_v2` channel and `checkin_reply` category, the direct-reply hook, the TZ sync, the queue triggers); and `lib/checkinQueue.ts` — the pending store. Re-arm is idempotent through the deterministic id: ids the rolling set no longer covers are cancelled and only the missing ones are scheduled. Android uses channel `checkin_v2` — **HIGH** importance, because only `HIGH` or above peeks as a heads-up banner, and the id is versioned because Android freezes a channel's importance at creation (so the earlier DEFAULT `checkin` channel could never be raised) — distinct from push's `default`; a check-in is **never** suppressed by §7.10's chat-focus foreground handler, which short-circuits on a check-in before the focus test (a fully-false behavior makes `ExpoPresentationDelegate` drop the notification outright — no banner, no shade entry, no sound); iOS/Web schedule nothing; the web branch returns before any scheduling but still loads and publishes the grid, because the Step 5 banner is web's only check-in surface and its predicate reads that cached grid. A direct reply that fails to POST persists to the per-user key `checkin_queue_{userId}` as `{content, windowTs, retryAt, attempts}`, replayed oldest-first on the same trigger-driven walk as §7.10's offline queue (NetInfo connect, Realtime `SUBSCRIBED`, AppState active, focus/manual) — **never** a timer, so it cannot poll or spin; window-index dedupe makes the replay idempotent end-to-end. A consumed reply dismisses its notification (clearing Android's RemoteInput send spinner) and a reply held across process death is drained from the launch response at arm (FR-3); the pending store retries a transient failure with backoff but **drops** a permanent (4xx) rejection, so a stale window cannot wedge the queue head.

**Client check-in UI (FP-04 Step 5).** The composer's check-in half is one further pure module, `lib/checkinUi.ts` (jest-loadable — the same split as `checkinGrid.ts`), plus the screen wiring in `app/(app)/chat.tsx`. `resolveCheckInWindowTs` carries the pending window: **the notification's own window first** (the link's `&windowTs`, else the launch/live notification response), and only when the open carried none at all (a web banner tap) the currently-open grid window stands in. A check-in-mode send POSTs `submit-checkin` and never `send-message` (FR-4), and resolves off the HTTP response — on-track → the **`logged` terminal state** (FR-9 writes no `messages` row, so `pruneResolvedPending` drops the bubble: never a retry, never an orphan failure); intervention → the normal `awaiting-reply` flow, whose user row reconciles through the existing `client_message_id` machinery. A check-in the server did not accept goes to the **check-in** pending store, never the chat offline queue (§7.10) — that queue replays through `send-message`, which would file the text as a chat turn; a retry re-sends through `submit-checkin` with the original window.

**Energy chips (FR-6, FR-14).** The strip is offered after a check-in send whose text carried no trailing integer, and on chat open for the newest null-energy doing (own rows through `doings_logs`' RLS select — no API change). One tap PATCHes `submit-checkin {doing_id, energy}`, disabling the whole strip while in flight, settling on success (`Energy: 7 😊`) and re-enabling with an inline error on failure. The map is `lib/checkinUi.ts`'s `ENERGY_EMOJI` — 1 😴 · 2 😫 · 3 😰 · 4 😕 · 5 😐 · 6 🙂 · 7 😊 · 8 😄 · 9 🤩 · 10 🔥: §7.1 fixes only the ends of the scale, so this is the as-built per-value reading.

**Web check-in banner (FR-4, AC-10).** `shouldShowCheckinBanner` gates a persistent in-app banner on web only, inside an open window, and **not already answered for that window** (the pending store's `checkin_last_answered_{userId}` stamp). It is answered from the cached grid plus the device store with no server round-trip, and the screen ticks a local clock so the banner appears and retires with its window; native never shows it (the OS notification is its surface). Tap → the composer in check-in mode.

**Client settings (FP-04 Step 7, FR-17).** `app/(app)/settings.tsx` owns the four `profiles` check-in columns: a cadence picker over the schema enum (`60 | 120` — the column CHECK and the RPC's own guard, so it is a schema constant and not a `[SPEC]` value read from `config`), start/end active-hours **steppers** in 30-minute steps clamped with no wrap (the grid contract emits no overnight window, so a wrapped value could only be rejected), a **read-only** timezone (`maybeSyncTimezone` remains its only writer; the loaded zone is passed straight back as `p_tz`), and the notification-permission state. The pure half is `lib/checkinSettings.ts`: `CADENCE_OPTIONS`, `formatClockLabel`/`shiftClock`, `prefsFromGrid`/`gridFromPrefs`, and `validateCheckinPrefs` — the client **mirror** of the RPC's `cadence ∈ {60,120}` and `start < end` guards, which the RPC still enforces independently, so the mirror is a form-level convenience and never the enforcement point. Save → `lib/checkins.ts`'s `saveCheckinPrefs` → `update_checkin_prefs` → **re-arm**: `armCheckins` re-reads the profile, republishes the grid (what chat's check-in mode and the web banner read — on web the same call is the banner's window source) and cancels/schedules the id delta. The permission row reads `getCheckinPermissionState()` on mount and on every foreground return (the "open system settings" path leaves the app, so a cached reading would defeat the row), offering `requestCheckinPermission()` while the OS still allows asking and `Linking.openSettings()` once it does not; a settled denial renders the R-4 warning, and web reads `unsupported` and shows the banner note instead because it schedules nothing (D1). The settings copy is a DRAFT owner-content file, `content/ui-copy/checkin-settings.json` (AGENTS.md §8.4 amendment), referenced rather than inlined. No server action is needed for a change to reach the watchdog: the scan reads `profiles` at each run.

**Device-zone sync (`maybeSyncTimezone`).** The reported device zone is written to `profiles.timezone` only when it also describes the device's own wall clock. Hermes/ICU can fail to resolve the zone and silently report a canonical +00:00 id (`Africa/Abidjan` on Android) — writing that moves the whole grid to UTC (the 2026-10-17 drill: an IST phone whose profile read `Africa/Abidjan`, so every window closed 5.5 h away from what the user expected and no banner was ever due when they were watching). An untrusted read is skipped, leaving the stored zone alone; a native zone read (`expo-localization`) is the tracked durable fix.

**Capture:**
- Direct reply → background task posts to `submit-checkin` `{content, windowTs, capture:'reply', client_message_id?}`. A consumed reply dismisses its own notification (Android's RemoteInput send button otherwise spins indefinitely), and a reply the OS held while the process was dead replays from the launch response at arm with its original hint (FR-3).
- `windowTs` is a client **hint** (the window the notification was for): the server **canonicalizes** it to the grid window — the nearest grid start within ±cadence/2, from `profiles.timezone`, `checkin_active_hours_start/end` and `checkin_cadence_minutes` — and rejects a future, >24 h-old, or off-grid-beyond-tolerance hint with 400. The canonical wire form is an ISO-8601 string; a numeric epoch-ms hint is accepted as well (the reply client's natural form), so a type skew between the twins cannot surface as a silent `window_malformed`. `doings_logs.checkin_window` stores the **canonical window start** (the `epochHour` in the notification id), which is also the dedupe key (FR-8) and the watchdog join key. The **grid contract** is frozen in FP-04 Step 1 and shared by the client grid and the server grid (drift between them is a stop condition, FR-1/NFR-7): windows step from `checkin_active_hours_start` by the cadence **in profile-local time**; a window is emitted only when its close (start + cadence) is ≤ `checkin_active_hours_end` (no overnight windows); a window's notification fires at its **close**; the client sends the notification's window start, never `now`; a null `profiles.timezone` reads as `'UTC'`; and the snap tolerance is inclusive (`|hint − start| ≤ cadence/2`). Twin case table (Step 2's Deno test and Step 4's jest test each encode it; the Step 6/8 gate re-runs both): cadence 60/120 × active starts 08:00 / 05:30 / 23:00 · UTC+5:30 · a DST-crossing date · hint shifts (±5 min, off-grid, future, >24 h).
- Energy parse (server): trailing standalone integer 1–10 (`/\b(10|[1-9])\s*$/`); absent/malformed → `energy=null`, Davos asks for energy next turn.
- Deep link path → chat input focused in check-in mode; posts `{content, windowTs, capture:'chat', client_message_id?}`. The pending window is the notification's own (its `&windowTs`, else the launch response), falling back to the open grid window; a check-in send resolves to the `logged` terminal state on-track (no `messages` row, FR-9) or reconciles as a normal turn on an intervention. After send, the client renders the quick-tap energy chips 1–10 + the §7.1 emoji map; a selection PATCHes the doing's energy and the strip settles — a failed PATCH re-enables it with an inline error.
- Web: the persistent in-app check-in banner replaces notifications → chat + chips. The banner shows only while a window is open and unanswered (`shouldShowCheckinBanner`, client-local state, no round-trip). Web Push is deferred to its own step (§13 item 9), so the banner is web's only check-in surface in beta.

**Endpoint and ingestion contract (`submit-checkin`, Step 2; GLOSSARY §13):**

- `POST {content, windowTs, capture:'reply'|'chat', client_message_id?}` → `{status:'ok'|'duplicate', doing_id, energy, eval_ran, intervention}`. Those five keys are **frozen by this section** — Step 3 *adds* `user_message_id`/`assistant_message_id` when an intervention turn is written, and nothing is ever renamed. `content` is capped by `config.chat_max_message_chars`; `capture` selects `doings_logs.source` (`reply` → `checkin_reply`, `chat` → `chat`); `client_message_id` is validated as a uuid but unused until Step 3b's intervention turn anchors the user row on it.
- **The server grid is two modules, split by testability:** the arithmetic is `_shared/checkin/windows.ts` — pure, imports nothing, so the jest suite can load it (the `bands.ts` / `persona.ts` precedent) — and the four-column `profiles` read is `_shared/checkin/loadGrid.ts`. Both consumers share the loader: `submit-checkin` canonicalizes a hint with it, and the `watchdog_checkin` handler (§2.3, Step 6) scans with it. The frozen case table lives in **one** shared fixture, `_shared/checkin/windows.fixture.ts`, imported by the Step 2 server suite and the Step 4 client suite — one file is what makes "drift between the twins is a stop condition" (NFR-7) a failing test instead of a promise. The client test imports only the fixture, never `windows.ts`.
- **Canonicalization order** (FR-5). Each rejection is a `400` carrying a **named** `error` the client branches on, rather than a bare 400: `window_malformed` (unparseable) → `window_future` (`hint > now`) → `window_stale` (`now − hint > 24 h`) → `window_off_grid` (no emitted start within the inclusive `±cadence/2`) → `window_future` **again** when the *resolved* start is still ahead (a hint 31 min before the next start snaps forward onto a window that has not opened). A tie at exactly `cadence/2` resolves to the **earlier** start. Both the hint's bounds and the resolved start's bounds are enforced, so the trailing-24 h rule applies to the stored window, not merely to the hint.
- **Daylight saving.** A local wall-clock label maps to an instant with a two-pass offset correction. A label that does not exist (the spring-forward gap) is **skipped** — the clock reads 03:00 next, so that day simply has no 02:00 window; a repeated label (the fall-back hour) resolves to its **earlier** instant. A window's close is the next emitted start, else its own start + cadence, which is the wall-clock close in every case: across a transition the instant gap varies, never the label.
- **One embed, and only for a genuinely new doing.** The duplicate select runs **before** `llm.embed`, so a repeat submit costs zero provider calls (FR-8). `embed_model` is stamped from the adapter's own response — `gemini-embedding-001@768`, the frozen identity (D5). An embed failure stores **nothing** and answers `503 {error:'embed_unavailable'}` so the client's pending-check-in store replays the same window: losing a doing the user logged is worse than a retried request, and a vectorless row would be frozen in place forever by the duplicate check. On-track writes **no** `messages` row (FR-9).
- `PATCH {doing_id, energy 1–10}` → `{ok, doing_id, energy}` on **own rows only**; a foreign or unknown id is `404`, never `403` (a 403 would confirm the row exists). Both verbs update `profiles.latest_energy` best-effort.
- One structured log line per submit and per patch (`[submit-checkin]`, JSON: capture, window, energy, outcome, `snappedMs`, latency), which is also what the Step 2 gate's `--logs` leg counts to prove one embed per stored doing and none for a duplicate.

**Sync evaluation (`submit-checkin`, deterministic-first):**
1. Insert `doings_logs` (kind=doing, `checkin_window`, energy, embedding).
2. Deterministic gates: energy ≤ `energy_exhausted_max` **[SPEC]** (3 — key **reuse**: one low-energy threshold drives both the eval gate and the §6.2 emotion override, D4's single-source precedent), or a window answered later than `checkin_late_minutes` **[SPEC]** (15) after its close → run the LLM evaluation call comparing the doing against today's anchor (D14): output `{deviation: bool, intervention: bool}` — the §4.3-family per-call contract. The call is `_shared/checkin/eval.ts` (`evaluateDoing`) over the pure `_shared/checkin/evalContract.ts`; `anchor_plans` is empty until the journal FP, so its input is forward-compatible by construction. It **fails open**: a structural failure (§4.2's one bounded retry) or a transport failure yields `{deviation:false, intervention:false}` plus one structured `[checkin-eval]` warning — the doing is already ingested, there is no reply to hold, and a check-in must never 500 on the eval. Stub mode dispatches a registered eval shape (§4.1), so `llm_stub_mode=true` exercises the path instead of failing it. Dev-only `dev_force.eval_intervention`, re-checked server-side against `dev_overrides_enabled`, forces `intervention=true` for drills.
3. Intervention → generation (pipeline §5) + high-priority Expo push. On-track → no action (next check-in already scheduled).

**The intervention turn (`submit-checkin`, Step 3b — FR-9, FR-13).** An intervention is not a new kind of message: it is a normal pipeline turn whose prompt is the check-in text, written by the **same** `_shared/replies.ts` helpers `send-message` uses (`writeInterventionTurn` owns the whole turn). Order: (a) the **user row** — `role:'user'`, `content`, `metadata:{source:'checkin', doing_id}` — which is the reply's §3.2 anchor and the only record linking a doing to the turn it produced; `client_message_id` is written **only** for the `capture:'chat'` path (the notification-reply path has no optimistic bubble to reconcile, so a stray id there is ignored, not written), and a `23505` on it re-selects the row that already exists rather than failing the submit; (b) `runPipeline({text, userId, energy, deadlineAt})` — the check-in's own `energy` goes live here (the §6.2 override is what makes a drained check-in read as drained *on the turn it produced*), with the deadline derived from `config.pipeline_deadline_ms`; (c) the **primary reply** (`source:'pipeline'`, the §3.2 anchor pair, `user_message_id`, `metadata.route`/`persona`/`domain`/`rule_ids`). Then one high-priority Expo push (`createHighPriorityPushPayload`, deep link `davos://chat`) behind a bounded await — the turn is already committed, so a push failure is not a submit failure. `tactical_analysis` is logged server-side only (§4.3, tag `[submit-checkin] tactical_analysis:`) and never reaches a row, the client or the response. A **transport** failure inside (b) degrades through the unchanged §4.1 hand-off (holding reply + exactly one `llm_retry` job), so an intervention turn is just a turn — including the rule that the holding reply, never a real answer, is what the submit returns.

**Replay contract (FR-8, FR-9).** A repeat submit is resolved by the duplicate check **before** any provider call and answers `status:'duplicate'` with the same `doing_id`; when that doing already has a turn, the response also echoes its pair — `metadata->>doing_id` finds the user row and the §3.2 anchor finds the reply — with `eval_ran`/`intervention` true, so a retried submit reports the intervention it already ran instead of implying none happened. A user row with no reply (the process died between the two writes) is **reported, not repaired**: `assistant_message_id` is omitted, and the §7.10 residual precedent applies — the eval has already run once, and re-running the pipeline on a replay could answer the turn differently from the one the gates approved. A replay never scores D8 (§5.3) and writes nothing.

**Watchdog (Step 6, as built).** `watchdog_checkin` (migration 0027 schedules `cron.schedule('watchdog-checkin', '*/5 * * * *', …)`; the tick only **inserts** a job row, guarded by `not exists (… status in ('pending','claimed','running'))` so a tick that lands mid-scan adds nothing — the guard is an optimization, never the correctness mechanism, because the handler is idempotent and the `intervention` payload dedup absorbs a double-insert).

The scan itself is `_shared/checkin/runWatchdog.ts` (`runWatchdogScan`); the decisions are the pure `_shared/checkin/watchdog.ts` (`selectMissedWindows` + `buildInterventionContext`), unit-tested by `watchdog.test.ts`. Per profile, the candidate set is `windowsClosedBetween(grid, now − watchdog_lookback_minutes **[SPEC]** (120), now − watchdog_grace_minutes **[SPEC]** (10))` — the **same** server grid `submit-checkin` canonicalizes with, never a second twin (§7.1's two-module split; `windows.ts` / `loadGrid.ts`). Two pieces of evidence then remove candidates: a `doings_logs` row whose **canonical** `checkin_window` equals the window start (the answered join — the same key Step 2 stores), and an existing `intervention` job whose `payload->>window` equals it. That second filter deliberately ignores `status`: **one job row per missed window, ever**. Narrowing it to the in-flight statuses would re-arm the window the moment its job completed — one no-op claim every 5 min for the rest of the lookback's life — and re-arming a `dead` job would spend ~40 provider attempts re-losing the same nudge, so bounded load wins over a best-effort re-delivery guarantee. Survivors are inserted as `intervention {user_id, window, reason:'missed_checkin'}`; FR-18's evidence is one structured `[watchdog] scan` line (`now`, `profiles`, `considered`, `alerts`, `skipped`, with `queued=` / `skippedDetail=` appended when the run is non-trivial).

A profile whose grid cannot be read is **skipped, not fatal** (the opposite of `submit-checkin`'s fail-closed 500): a batch job's failure mode is the row, not the batch. `watchdog_checkin` is cheap (SQL + inserts, no model call) and therefore **is** in `FAST_JOB_TYPES`; the scan walks every profile (the onboarding-stage gate lands with the onboarding FP) and the AC-8 drill narrows it with `dev-smoke ?action=watchdog-scan&now=<iso>&user=<uuid>` — the *same* function the cron reaches, so the drill cannot drift from production.

**The intervention.** One missed window → one unlocked-persona generation: the context is the reason, the missed window (local labels + instants + how long ago it closed) and the last `sliding_window_messages` **[SPEC]** (8) savable thread rows, composed by the pure `buildInterventionContext` and handed to `runLockedPersonaReply` as `text` — so it is wrapped in the `<user_message>` delimiters under the §10.5 injection guard exactly like a real turn's text. The persona is the **[SPEC]** `intervention_persona` (`mentor_tough`, FR-16's reading) and the domain is the D7 fallback domain (`General`, §5.3/§6.4) — the turn is unclassified by construction, because the watchdog fires precisely when there is no user text to classify. The pipeline import is **lazy**, the `llm_retry` precedent: the adapter throws at module load when the provider secrets are absent, and this module is loaded by the function that runs every job type, so a deployment missing those secrets must break `intervention` alone. `tactical_analysis` is logged server-side only (tag `[intervention] tactical_analysis`), never written to a row and never returned. Then the row: `role:'assistant'`, `reply_to_message_id` **NULL** (unprompted — there is no user row to answer), `persona_key`, and `metadata {persona, domain, rule_ids, source:'watchdog_intervention', watchdog_window, source_job_id}` — `watchdog_window` is both the audit trail and the dedup key. One high-priority Expo push follows behind a bounded await (§7.10), with `davos://chat` as the deep link; a push failure is not a job failure, because the row is already committed.

**Idempotency (FR-16, §2.2.4).** `messages_one_primary_reply` does not apply to an unprompted row, so the guard is explicit: the handler looks up `metadata->>source='watchdog_intervention' AND metadata->>watchdog_window=<window>` **before** generating, which makes a re-claimed (or lease-reset) job a cheap no-op rather than a second nudge. A **transport** failure propagates instead: no client waits on an async job, so the honest outcome is a failed job with backoff, not a holding reply.

### 7.2 Day planning (D14)

**Evening anchor plan** (job `anchor_plan`): input = journal extraction output + routine + active habits/goals; output anchors array (schema §3.4) persisted to `anchor_plans` for tomorrow; Davos summarizes anchors in chat (satisfies PRD §4.4 "deadline-bound plan for the next day").

**JIT assignment:** when user messages during a free block, or on check-in submission inside one: generation stage receives `{current_free_block, latest_energy}` → task assigned in `direct_quote`; energy 1–3 → low-cognitive task or boredom-relief item; 8–10 → heavy task. Boredom-relief/free time is scheduled as anchors by the plan itself (PRD §3.1).

**Rescheduling:** any user attempt to move an anchor or assigned task → generation must require conversational approval (persona-dependent tone); no calendar mutation API exists — plan is authoritative.

### 7.3 Drift detection & Side Quests (D15)

`drift_scan` job evaluates per-user patterns over trailing 3 days **[SPEC]**:

| Pattern | Trigger |
|---|---|
| Late starts | 3 consecutive days: first doing logged after 10:00 local **[SPEC]** |
| Compliance drop | check-in compliance < 60% over 3 days **[SPEC]** |
| Energy slide | avg energy < 4 over 3 days **[SPEC]** |
| Impulse cluster | ≥ 3 impulse failures / week (shared with D22/D24) |

Trigger → intervention message + optional Side Quest: Davos proposes quest (e.g., "6 AM Challenge", deadline-bound) → on user acceptance, create `metrics` row (is_quest, quest_status=active, formula per D10, quest_deadline) → dashboard renders via pre-built registry. Lifecycle: `quest_expire` job at deadline → archive (`archived_at`, evaluation stops, component removed) + chat debrief (completed/expired/failed).

### 7.4 Evening journal chain (D16)

`submit-journal` (sync): client-side **Unsavable strip** (flagged blocks removed client-side; server never receives them) → insert `journal_entries` → insert `journal_extract` job → immediate ack (no blocking).

`journal_extract` (async):
1. Extraction call (§4.3 contract) → insights → `memory_facts` (fact_type=journal, provenance=entry id) + embeddings; vagueness/severity stored on entry.
2. `vagueness_score ≥ 0.6` OR severity ≠ S3 → `journal_probe` job: targeted follow-up question via chat + Expo push (if app closed). Probing tone gated by severity (S1/S2 → empathetic; S3-vague → aggressive editor persona per PRD §3.4).
3. → `anchor_plan` job (§7.2) regardless of probe.

### 7.5 The Strike (D24/D11)

**Habit surfacing (daily, rides `drift_scan`):** impulse failures ≥ 3/week OR ≥ 3 journal extraction flags for a recurring negative behavior → insert `habits (status='detected')` + Davos confronts conversationally (proactive message).

**Refusal confirmation:** extraction `intent_flags` register habit acknowledgment without `quit_commitment` → status `watch`, `watch_started_at=today`, `strike_at = +watch_days`.

**Silent window:** evidence accumulation only (async scans append to job payload); proactive engagement suppressed **only for that habit's topic** (classifier-domain scoping) — Davos stays active elsewhere.

**Day X (`strike_fire`):** Tiered Proof generation — context = (1) logged ground truth aggregates (hours, missed check-ins, impulse logs), (2) verified goals from memory_facts if extraction-confirmed, else (3) unverified mode: behavioral trend + probabilistic framing, hard-banned from asserting unverified constraints (prompt-injected rule + post-generation deterministic check: response must not contain memory-fact-absent numeric deadline claims **[SPEC]**). Delivery: high-priority push + chat.

**Cancellation:** `quit_commitment` extracted mid-window → status `quit_committed`, watch void. No escalation ladder in beta.

### 7.6 Memory management (D6)

- Immediate context: last 8 messages **[SPEC]** passed raw to generation.
- Window boundary crossing (user message count % 8 == 0 **[SPEC]**) → `memory_extract` job on the aged-out chunk: skip messages where `unsavable=true`; facts → `memory_facts` + embeddings, provenance = message ids.
- **Late flag:** `flag-unsavable` fn sets `messages.unsavable=true` → `purge_memory` job: `update memory_facts set purged_at=now() where source_message_id=:id` (soft delete; retrieval excludes `purged_at is not null`; embeddings left stale-but-excluded). Oath facts exempt (§5.4).
- Retrieval into generation: pgvector top-5 unpurged facts vs current message, plus all `fact_type='baseline'` (onboarding profile).

### 7.7 Onboarding (D17)

State machine on `profiles.onboarding_stage`: `intro → baseline → goals → routine → metric_selection → complete`. Davos sends the opening message (first assistant message created at signup by a trigger fn **[SPEC]**). Each stage: 2–4 diagnostic questions; extraction pass writes `memory_facts (fact_type='baseline')` + `profiles` fields (wake/sleep, routine, timezone, high_dopamine_activities). Mid-interview close → stage persisted; on return, Davos resumes the current stage's questioning. Metric selection: Davos proposes core metrics as `ui_metadata.persona_options`-style chips → user taps 1–2 → `metrics (is_core=true, formula=preset)` — zero forms (reconciles §3.5/§4.1).

### 7.8 Impulse interception (D22)

**Logging:** persistent-notification quick-action "Impulse lost" + in-app button → `doings_logs (kind='impulse_failure')` (no energy required **[SPEC]**).

**Histograms (`histogram_daily`):** bucket failures by hour-of-day over trailing 14 days **[SPEC]**; bucket count ≥ 3 **[SPEC]** → schedule daily preemptive Expo push at `bucket_start − 15 min` (config T), carrying a rotating item from `high_dopamine_activities`. Cold start: predictions activate only after ≥ 3 logged failures.

### 7.9 Dashboard (D10/D15 rendering)

**Pre-built component registry [SPEC]:** `TrendLineGraph`, `ConsistencyHeatmap`, `ProgressBar`, `StatCard`. Components consume `{metric_id, points[]}` only — no runtime UI code generation.

**Formula validation gate (server, deterministic):**
1. Parse JSONLogic; reject non-whitelisted ops. Whitelist: `["var","+","-","*","/","%",">","<",">=","<=","==","!=","if","and","or","not","min","max"]` **[SPEC]**.
2. Variables must resolve against the allowed field enum: `{doings_count, hours_logged, checkin_compliance_rate, energy_avg, impulse_failures, journal_positive_mentions, journal_negative_mentions, quest_completions}` (per-day granularity **[SPEC]**).
3. Bounds: numeric literals ∈ [−1000, 1000]; tree depth ≤ 6; node count ≤ 30.
4. Fail → errors returned to generation stage for exactly one corrected re-output; second failure → human-readable fallback proposal (AI outputs a described metric; owner validates manually in beta).
5. `metric_eval` job evaluates daily: variables computed via SQL aggregate views (`metric_vars_daily`) **[SPEC]** → JSONLogic eval → `metric_points`.

### 7.10 Chat transport (D23)

- Send: `send-message` (sync pipeline §5) → row insert → Realtime broadcast → client render.
- CORS: `send-message` and `select-persona` answer the preflight with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: Content-Type, Authorization, apikey, x-client-info`. `submit-checkin` answers identically but lists `POST, PATCH, OPTIONS` — this function's contract has two verbs, and a preflight that omitted `PATCH` would block a web client's energy-chip tap before it was ever sent. `x-client-info` is injected by `supabase-js` on every request, so omitting it makes the browser block the call before it is sent (web only — native has no preflight).
- Send contract: `POST send-message {content, client_message_id, client_sent_at?}` → `{user_message_id, assistant_message_id, status: 'ok' | 'duplicate'}`. A repeat send whose turn is already answered returns `duplicate`; a repeat send whose turn was never answered **repairs** it (§5.1) and returns `ok`. `content` length is capped by `config.chat_max_message_chars` **[SPEC]**. `assistant_message_id` is null only when a `duplicate` turn has no reply (pre-5a rows). A provider outage is **not** an error status: the request still returns `ok`, with `assistant_message_id` pointing at the holding reply (§4.1).
- Persona-chip contract: `POST select-persona {message_id, persona_key}` → `{assistant_message_id, status: 'ok' | 'duplicate'}`, taking ids only — the text and domain come from server state (§5.3). `400` when the body is malformed, the id is not an assistant reply, the message carries no `persona_options`, or the key is not one of that message's options (or not a real persona key); `404` for an unknown/foreign message; `409` when the turn it belongs to has no user row. A `duplicate` is a normal no-op that returns the already-written reply's id, so a double tap can never produce a second reply.
- AI response: pipeline inserts assistant row → Realtime delivers to foregrounded clients; Expo push sent for every AI message with collapse key `chat_{userId}`, **suppressed client-side when the chat screen is focused** (message arrives via Realtime instead).
- **Expo push implementation (Step 7) — Android only in beta:**
  - **Token registration** (`lib/push.ts`): on auth completion the client requests permission → creates Android channel `default` → gets the Expo push token → upserts to `push_tokens` (platform `android`). iOS and Web log and skip (scope below).
  - **Android credentials are mandatory for dev builds**: Expo Go cannot test push from SDK 53. The client needs `google-services.json` (Firebase Spark — free) referenced as `android.googleServicesFile`; `app.config.js` declares it **only when the file exists**, so a missing file degrades to a runtime token error instead of a prebuild failure. The **sending** side separately needs the FCM v1 service-account key uploaded to the Expo project (`eas credentials -p android` → FCM V1) — `exp.host` sends over FCM v1 regardless of where the APK was built; local builds need no `eas build`. Missing credentials surface as `InvalidCredentials` in the receipt (`Unable to retrieve the FCM server key`). The service-account key is a secret (never committed); `google-services.json` is public identifiers.
  - **Web push is out of scope**: Expo's push service does not support web — `getDevicePushTokenAsync` on web returns a Web-Push subscription (`{endpoint, keys}`), not an `ExpoPushToken`, so `exp.host` cannot deliver it. Real Web Push (service worker + VAPID JWT + aes128gcm) is deferred to its own step; web uses Realtime + the in-app banner. `config.vapid_public_key` and secret `EXPO_VAPID_PRIVATE_KEY` stay **reserved** for that step (its client config will be `notification.vapidPublicKey` + `notification.serviceWorkerPath` — note: **not** `extra.vapidPublicKey`, which nothing reads).
  - **Server send** (`_shared/push.ts`): raw `fetch` POST to `https://exp.host/--/api/v2/push/send` (Deno-safe, no SDK). Collapse key `chat_{userId}` groups AI messages per conversation. Priority `default` for AI replies; `high` reserved for interventions/Strikes. Deep link `davos://chat`.
  - **Receipt handling**: async check of receipts; on `InvalidCredentials` / `DeviceNotRegistered` → delete **only the errored token** (ticket id → token map).
  - **Wired into**: `send-message` (primary reply) and `select-persona` (secondary reply), plus the `llm_retry` handler in `job-dispatcher` (the degraded turn's real answer, §4.1). Bounded best-effort — a push failure logs and never blocks or corrupts the response. The sync-degrade *holding* reply is deliberately not pushed: the sender is still in the app, so Realtime already showed it, and a "give me a second" notification followed seconds later by the real one is two alerts for one turn.
  - **Foreground suppression**: `Notifications.setNotificationHandler` in `chat.tsx` returns `shouldShowAlert: false` while the chat screen is focused; Realtime delivers instead. Driven by `useFocusEffect`, so other tabs still notify.
- Client render: the thread is the Realtime rows (with the §3.2 primary/secondary reply dedupe) merged with a single optimistic bubble keyed by `client_message_id`. A composer row left unanswered — the invocation died before the reply landed — renders as a failed bubble whose Retry resends the **same** `client_message_id` and the **original** `client_sent_at`, so the server repairs the turn (§5.1) rather than duplicating it. A degraded turn renders as two normal assistant bubbles in `created_at` order: the holding reply (a primary reply) and, once the `llm_retry` job lands, the real answer (a secondary reply). No client change is needed — neither row is filtered by the primary-reply dedupe.
- Realtime reconnect: a dropped socket (network flap, backgrounding, lapsed heartbeat) reports `CHANNEL_ERROR`/`TIMED_OUT` for *every* joined channel, and supabase-js reconnects and rejoins on its own. Both statuses are in fact self-healing by construction: the realtime client reconnects the socket, and after a **join** timeout the phoenix channel reschedules the join itself (`@supabase/phoenix` `joinPush.receive('timeout')` → `rejoinTimer` → `rejoin()`, and again on socket reopen while errored). The client therefore treats both as recoverable transport events, never failures: it warns with the underlying reason (`normalizeChannelError` → `socket closed: <code>`, `channel error: connection lost`) plus the raw cause, and reconciles from the server — the same path as `SUBSCRIBED`. No manual resubscribe, no error bubble. The client counts consecutive failures and, from the third with no intervening `SUBSCRIBED`, logs the event at error level with the count — so a subscription that is not recovering (a publication or RLS regression looks identical otherwise) is distinguishable from routine noise. It is a log distinction only; no user-visible state.
- Client chips (FR-11): an assistant row carrying `metadata.persona_options` renders each option as an in-chat quick-select chip, disabled **as a whole set** while a tap is in flight and permanently once a secondary reply for that user message exists (`lib/chat.ts` derives both from the rows alone). The secondary reply always renders — it is a normal thread row, never filtered by the primary-reply dedupe.
- Client check-in render (FR-4, FR-9, FR-14): the composer's check-in mode targets `submit-checkin` whatever the send button does elsewhere, and its optimistic bubble is keyed by `client_message_id` like any other. It takes one of three terminal outcomes: `logged` (on-track — the server wrote no `messages` row, so `pruneResolvedPending` drops the bubble at once: never a retry, never an orphan failure), `awaiting-reply` (intervention — the user row arrives over Realtime and reconciles through the existing machinery), or `failed`. A failed check-in's Retry re-sends through `submit-checkin` with its original window, never the chat offline queue (which replays through `send-message` and would file the text as a chat turn); a check-in that cannot be transmitted at all goes to the check-in pending store instead. The energy-chip strip renders above the composer and settles once the PATCH is confirmed. The web banner (above) is the platform's only check-in surface.
- Dev forcer (FR-7, FR-10, dev-only): `lib/devOverrides.ts` keeps a device-local tier (`none|high|medium|low|fallback`) and free-text domain that the composer attaches to `send-message` as `dev_force` — only when a dev build (`__DEV__`) **and** `config.dev_overrides_enabled` are both true, and only when something is actually pinned. The server re-checks the flag, so the client gate is convenience, not enforcement.
- Client config: `lib/config.ts` loads the `config` table once at the `(app)` layout (retrying with 1 s/2 s/4 s backoff before reporting an error) and **fails closed** — a missing key disables the composer instead of falling back to a default (AGENTS.md §2). The composer is capped by `chat_max_message_chars`, the thread loads the newest `chat_last_n` rows, a send times out at `chat_send_timeout_ms`, and a reply Realtime has not delivered within `chat_realtime_watchdog_ms` is re-selected directly by id.
- Failure handling: 401 → auth banner (no per-bubble retry); 4xx → client error, Retry after a fixed 3 s anti-spam holdoff (`lib/chat.ts`); 5xx → retry immediately; fetch error/abort/timeout → persisted to the device **offline queue** and replayed when the link returns (below), gated by `chat_retry_holdoff_ms` (150 s) when the request *was* sent, so an unknown outcome never starts a second pipeline run while the first may still be alive. There is no "slow/unknown" UI state. A provider outage is no longer any of these: since Step 8 `send-message` answers the turn with the holding reply and returns `ok` (§4.1), so the bubble resolves and the real answer arrives on its own.
- Offline queue (FR-16, AC-8; `lib/sendQueue.ts` + `app/(app)/chat.tsx`): a composer message the server never accepted is persisted to the device and replayed, oldest `client_sent_at` first, so an offline tap, a killed app or a failed request cannot lose it. It is deliberately **not** a retry of an accepted turn: `messages` owns those, and an unanswered one already renders as an orphan whose Retry repairs it (§5.1).
  - **Storage**: AsyncStorage, one key per user (`davos.send_queue.v1.<user_id>`). Per-user is load-bearing — a replay authenticates with the *current* session, so one shared key would send user A's text as user B. An entry is `{client_message_id, content, client_sent_at, retryAt, attempts, reason}`. A blob that does not read back as an array (or throws) is discarded and its key cleared, so the device can never be stuck failing to start on its own queue.
  - **Replay gate** (`reason`): `offline` — NetInfo reports no link, so nothing is transmitted (the send is queued without attempting the request, so the bubble reads "queued" at once instead of waiting out `chat_send_timeout_ms`) and `retryAt = 0` (replay at once). `unknown` — the request went out and its outcome is unknown (fetch error, abort, `chat_send_timeout_ms`), so `retryAt = now + chat_retry_holdoff_ms`. A reconnect signal therefore cannot replay a possibly-accepted turn early: the gate, not the trigger, decides.
  - **Bound**: `chat_queue_max_items`. A full queue **refuses** the incoming message — the caller keeps it on screen as an actionable failure — rather than silently evicting one the user believes is waiting; a stale oversized blob is truncated to the newest items on load.
  - **Triggers** (no polling): NetInfo `isConnected` false→true, Realtime `SUBSCRIBED` (the first connect and every rejoin), AppState `active`, queue load at mount/chat focus, and a manual "Send now". The walk is sequential (`flushingRef` guard) and stops at the first item that does not leave the queue, so it neither fans out LLM calls against the §12 budget nor spins. The holdoff wake-up timer only re-renders to unlock "Send now" — it never sends, so `unknown` items cannot auto-retry in a loop.
  - **Exactly-once**: a replay reuses `client_message_id` and `client_sent_at` verbatim, so the `(user_id, client_message_id)` unique index makes a duplicate replay a no-op or a repair, never a second row (§3.2, §5.1). A turn leaves the queue on a server acknowledgement (`ok`/`duplicate`) **and** whenever its row appears in `messages` — a request whose response was lost may still have been delivered, and the row is proof of acceptance.
  - **Connectivity signal**: `@react-native-community/netinfo` (a native module — a dev-client rebuild is required). `isConnected === false` is authoritative; `true`/`null` is only a hint (captive portal, dead DNS, downed server), which is why the send path queues whatever actually fails instead of trusting the probe.
  - **Deliberately not queued**: `select-persona` chip taps (a failed tap shows the banner and leaves the chips enabled) and every non-network failure.
- Web push: out of scope for beta — Expo's push service does not support web (§7.10 scope above). Web falls back to Realtime + the in-app banner on next open.

### 7.11 Auth (D25)

Supabase Auth: email OTP code (6-digit) + Google OAuth. JWT scopes every Edge Function call to `auth.uid()`; RLS enforces row isolation across the 5 beta users. Google setup: OAuth client + redirect URIs (iOS/Android deep links, web origin). Email flow: `sign-in` collects email → `supabase.auth.signInWithOtp({ email })` sends 6-digit code → `verify-code` collects code → `supabase.auth.verifyOtp({ email, token, type: 'email' })` creates session → navigate to `(app)/chat`. Non-blocking live item: built-in SMTP deliverability for OTP codes — confirm at setup.

Google OAuth flow: `sign-in` requests the provider URL → **web** redirects the whole page (`signInWithOAuth` without `skipBrowserRedirect`), **native** opens `WebBrowser.openAuthSessionAsync` with `skipBrowserRedirect: true` → `app/auth/callback.tsx` finishes the sign-in. The PKCE code exchange is owned by exactly one party per platform, because the verifier is single-use: on web the client is created with `detectSessionInUrl` (`lib/supabase.ts`), so supabase-js exchanges the code itself while initialising — in the same tab, where the verifier lives — and the callback screen only reads the resulting session; on native nothing auto-exchanges, so the warm return (sign-in handler) and the cold-start deep link (callback screen) call `exchangeCodeForSession`. Never exchange a URL `code` on web, and never drive this flow through an expo-web-browser popup: the second exchange throws `AuthPKCECodeVerifierMissingError`, and a popup's own client would spend the verifier before the opener could. A failed return never bounces to sign-in silently: the callback screen hands over an `auth_error` reason (`cancelled` when the consent screen was closed, `failed` otherwise) and sign-in renders it in its existing error banner.

### 7.12 Email Verification Flow

`app/verify-code.tsx` implements the second half of the OTP flow. It accepts `email` via route param (`/verify-code?email=...`) with AsyncStorage fallback (`davos_pending_email`) for navigation recovery. It validates `OTP_CODE_LENGTH = 6`, calls `verifyOtp`, clears the stored email on success, and navigates to `(app)/chat`. It supports resend via `signInWithOtp`. Code expiry follows `[auth.email] otp_expiry = 3600s` (60 minutes).

---

## 8. Notification & Push Map

| Notification | Type | Trigger source | Priority | Deep link |
|---|---|---|---|---|
| Interval check-in | Local (rolling 24 h) | client scheduler | default | `davos://chat?focus=checkin&windowTs={start}` |
| Impulse quick-action | Local (persistent) | client | default | n/a (action button) |
| Intervention | Expo remote | sync eval / watchdog | high | `davos://chat` |
| Journal probe | Expo remote | evening chain | default | `davos://chat` / journal |
| Preemptive urge block | Expo remote | histogram job | high **[SPEC]** | `davos://chat?focus=alternative` |
| Proactive message | Expo remote | `proactive` job | default, collapse `chat_{userId}` | `davos://chat` |
| Strike | Expo remote | `strike_fire` | high | `davos://chat` |
| Oath request | Expo remote | trust trigger | high | `davos://chat` |

Keep-alive: cron-job.org pings `health` endpoint every 6 h **[SPEC]** (mandatory, D12 — free projects pause after 7 days inactivity).

---

## 9. Client Architecture (D1)

**Stack:** Expo Router (TypeScript), React Native primitives; web via the same routes.

**Runtime config:** every [SPEC] value lives in the `config` table and is read at runtime through `lib/config.ts` — memoized, loaded once per session at the `(app)` layout, and fail-closed (no hardcoded defaults).

**Route map [SPEC]:**
```
(app)/chat            — primary UI, Realtime subscription, check-in mode + energy chips, persona chips, offline queue
(app)/journal         — distraction-free editor + Unsavable block flagging
(app)/dashboard       — registry components consuming metrics API
(app)/settings        — check-in cadence, active hours, notification permission state
(onboarding)/interview — chat-based state machine
```

**Client modules for the check-in loop (FP-04 Steps 4–7, §7.1):** `lib/checkinGrid.ts` (pure grid math — the client twin of `_shared/checkin/windows.ts`), `lib/checkins.ts` (the scheduler, the Android channel/category, the direct-reply hook, the TZ sync, the flush triggers, and the Step 7 settings save + permission reads), `lib/checkinQueue.ts` (the per-user pending store), `lib/checkinUi.ts` (the pure Step 5 predicates — the energy emoji map, `resolveCheckInWindowTs`, `shouldShowCheckinBanner`) and `lib/checkinSettings.ts` (the pure Step 7 model — the cadence options, the active-hours clamp and the RPC-validation mirror). The scheduler is armed from the `(app)` layout on auth and on `AppState` active, after each check-in submission and after a settings save — the three FR-1/AC-9 triggers — and cancelled on logout; web schedules nothing.

**Platform capability matrix:**

| Capability | iOS | Android | Web |
|---|---|---|---|
| Local scheduled notifications | ✅ | ✅ (OEM battery risk → D9 fallback) | ❌ → in-app banner + Web Push |
| OS direct reply | ✅ | ✅ | ❌ → deep link into chat |
| Expo remote push | ❌ ($0 — Apple Dev Program; degrades to Realtime) | ✅ (needs FCM credentials) | ❌ → Realtime + in-app banner |
| Home-screen widgets | deferred post-beta (native modules) | deferred | n/a |
| Realtime sync | ✅ | ✅ | ✅ |

**Widgets:** explicitly out of beta (D1). PRD's "notification or widget" is satisfied by notifications.

---

## 10. Security & Permission Enforcement

1. **RLS everywhere** (§3.1); service-role writes only from Edge Functions.
2. **Journal permission boundary:** client-side strip before transmission (server never receives flagged text) — D3.
3. **Chat permission boundary:** messages stored as sent; `unsavable` column gates extraction; late flags purge derived facts (§7.6).
4. **Formula injection surface:** JSONLogic whitelist gate (§7.9) — the only evaluable code path in the system.
5. **Prompt-injection hardening [SPEC]:** user text is wrapped in delimiters in every prompt; extraction/generation prompts instruct ignoring instructions embedded in user content.
6. **API keys:** Gemini/Groq/Expo keys only in Supabase Edge Function secrets — never in the client bundle.

---

## 11. Config Registry (approved values)

| Key | Value |
|---|---|
| `confidence_bands` | High ≥ 0.75 · Medium 0.55–0.74 · Low 0.40–0.54 · fallback < 0.40 |
| `auto_adopt_window_minutes` | 10 (D8: a user message within this many minutes of an auto-adopted **primary** reply counts as one `auto_adopt_successes`; measured on the server clock, §5.3) |
| `emotion_labels` | frustrated, exhausted, anxious, proud, determined, avoidant |
| `classifier_mode` | `stub` (FP-02 deterministic) or `real` (FP-03 embedding-similarity §6) — the dark-ship + rollback switch; not dev-only |
| `quit_signal_threshold` | 0.75 (**[SPEC]** §6.3: quit-set top cosine similarity ≥ this ⇒ `quit_signal` true) |
| `energy_exhausted_max` | 3 (**[SPEC]** §6.2: check-in energy ≤ this forces emotion `exhausted`) |
| `energy_determined_min` | 8 (**[SPEC]** §6.2: check-in energy ≥ this forces emotion `determined`) |
| `trust_threshold` | 70 (scale 0–100; admission +10; deltas ±5; streak +2/day ≥3-day streak) |
| `strike_watch_days_default` | 7 (per-habit configurable) |
| `preemptive_lead_minutes` | 15 |
| `habit_detection_thresholds` | ≥3 impulse failures/week OR ≥3 journal flags |
| `checkin_cadence_default` | 60 min (bi-hourly option) — the **seed** value; the per-user source of truth is `profiles.checkin_cadence_minutes` (§7.1), read per turn (this key is not consulted at runtime) |
| `checkin_late_minutes` | 15 (**[SPEC]** §7.1: a check-in answered later than this many minutes after its window closes triggers the evaluation call) |
| `watchdog_grace_minutes` | 10 |
| `watchdog_lookback_minutes` | 120 (**[SPEC]** §7.1: the watchdog only considers windows closed within this many minutes; the `intervention` payload dedup makes the exact value non-critical) |
| `intervention_persona` | `mentor_tough` (**[SPEC]** §7.1/FR-16: the locked persona the missed-check-in intervention generates with; seeded by migration 0027 and read per intervention, never inlined) |
| `lockdown_circuit_breaker_hours` | 24 |
| `sliding_window_messages` | 8 |
| `conflict_priority_window` | 15 (same-domain aggressive+empathetic rule groups within this priority gap → drop the lower-priority group; §5.2) |
| `sync_degrade_reply` | "Noted. Give me a second." |
| `malformed_fallback_reply` | "Something went wrong. Let me try again." |
| `llm_call_timeout_ms` | 30000 (per-provider-call `AbortSignal` timeout for every LLM/embedding fetch; a timeout counts as a *transport* failure → §4.1 degrade) |
| `pipeline_deadline_ms` | 120000 (total synchronous pipeline budget from invocation start; the run degrades rather than risk the 150 s invocation limit) |
| `llm_stub_mode` | false (dev-only: canned schema-valid responses, zero network) |
| `llm_force_fail` | none (dev-only: "none"|"primary"|"both") |
| `llm_stub_malformed` | false (dev-only: stub mode returns invalid JSON to exercise the §4.2 bounded parse retry) |
| `dev_overrides_enabled` | true (dev-only: enable forced persona/route params) |
| `job_dispatcher_url` | "https://<project>.supabase.co/functions/v1/job-dispatcher" |
| `job_dispatcher_budget_ms` | 140000 (wall-clock budget for one dispatcher tick; it stops starting jobs once the next handler's worst case no longer fits and releases the un-started claims — §2.2) |
| `chat_max_message_chars` | 8000 (max user message length; enforced by `send-message` and the composer) |
| `chat_last_n` | 50 (number of recent messages the chat thread loads; newest first) |
| `chat_send_timeout_ms` | 90000 (client timeout for the `send-message` invocation; below the 150 s sync limit) |
| `chat_realtime_watchdog_ms` | 8000 (delay before the client re-selects an assistant row Realtime has not delivered) |
| `chat_retry_holdoff_ms` | 150000 (minimum delay before retrying a send with an unknown outcome; matches the 150 s sync limit) |
| `chat_queue_max_items` | 20 (device offline-queue cap; also caps the reconnect replay burst, which is one full pipeline run per item — §12) |
| `expo_push_enabled` | true (master toggle for Expo push sends; AI messages, interventions, etc.) |
| `vapid_public_key` | "" (reserved for a future Web Push step; unused in beta — Expo push does not support web, §7.10) |

**Severity criteria (approved, gates D16 probing tone + D21 safety override):**
- **S1 — Crisis:** self-harm/suicidal ideation/intent to harm others → exit lockdown; empathetic persona; supportive probing; no confrontation or Strike content this turn.
- **S2 — Severe distress:** sustained hopelessness/withdrawal; substance-abuse admission; acute loss events → empathetic persona for the thread; gentle probing; confrontation suspended while active.
- **S3 — Standard:** all other entries → normal logic.

---

## 12. Capacity Plan (5 beta users, verified limits)

| Resource | Projected peak (5 users) | Verified limit | Headroom |
|---|---|---|---|
| Gemini generation (Flash-Lite) | ~80 calls/day | 500 RPD | 6× |
| Groq fallback | ~40 calls/day (spillover) | 1,000 RPD | 25× |
| Embeddings | ~250/day (turns + chunks + journals) | 1,000 RPD / 100 RPM | 4× |
| Edge invocations | ~5K/day ≈ 150K/mo | 500K/mo, 150 s each | 3× |
| Realtime connections | 5–15 (multi-device) | 200 peak | >10× |
| Sync-path latency | typical 15–40 s. Bounded worst case ≈ 120 s: stage 1's extraction is itself a `generate` call, so an outage of *both* tiers costs 2 × `llm_call_timeout_ms` (30 s) there — in parallel with the 30 s embed → 60 s — and stage 5 adds another 2 × 30 s → 120 s. That is exactly `pipeline_deadline_ms`, so the deadline guard, not the arithmetic, is what keeps a bad turn answering: it trips before each expensive stage and returns the holding reply + `llm_retry` (§4.1). Raising the margin is a config change, not a code change — e.g. `llm_call_timeout_ms` 20000 → ≈ 80 s | 150 s | at the limit; the 120 s deadline guard is the operative bound |

**Offline-queue replay burst (§7.10).** A reconnect releases at most `chat_queue_max_items` (20) queued turns, and each one is a full pipeline run, so the cap doubles as a burst limiter rather than only a storage bound. The walk is sequential — one turn at a time — so a 20-item replay costs 20 generation + 20 embedding calls per user, ≤ 100 of each across 5 users after a total outage: inside the Gemini 500 RPD and 1,000 RPD embedding headroom above. There is no timer-driven replay, so a queue cannot poll a provider while it waits.

**Measured turn latency (FP-02 Step 11, AC-10).** The Sync-path row above is the pre-audit *projection*. The Step 11 audit replays it as a **measured** 20-turn real-provider conversation and records p50/p90/max (server clock, `assistant.created_at − user.created_at`), the client-observed delta, and the per-provider call counts parsed from the adapter's per-call JSON log lines. The numbers live in `docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md` → "Timing & quota audit"; nothing persists provider or latency to a row (`messages.metadata` is `{persona, route, domain, rule_ids, source, user_message_id, persona_options?}` only), so the log parse is the only source for the per-provider counts. `scripts/verify-step11.py` is the harness. **Result 2026-10-16: all AC-10 assertions passed** (20 turns, none degraded; p50 < 40 s, max < 150 s; counts inside the quotas above), so the projection held. The raw values were not transcribed into the acceptance doc — re-run the harness to reproduce them.

---

## 13. Blocking Assumptions & Live Items

**Blocking before implementation start (setup-day checks, ~30 min):**
1. **VERIFIED 2026-10-15**: Groq JSON mode / structured output on the pinned fallback model `openai/gpt-oss-120b` — **available** (`response_format: {type:"json_object"}` returns valid JSON). Note: JSON mode guarantees syntactically valid JSON only, not schema conformance (observed `persona_options` emitted as a string array rather than objects), so the schema-in-prompt guidance remains. Prior 2026-10-11 finding (`not available`) applied to the now-decommissioned `llama-3.1-70b-versatile`.
2. **VERIFIED 2026-10-11**: Realtime message allowance on free tier — 200 peak connections verified; message quota observed near-zero at 5-user scale during Step 10 testing; no spikes observed.
3. **VERIFIED 2026-10-11**: Supabase built-in SMTP OTP code deliverability — 6-digit code email arrival within 2–5 minutes observed during Step 4 testing; meets ≤5 min target. (Magic links replaced by OTP codes per G-01 resolution; §7.11 auth flow updated.)

**Live items (non-blocking, tracked):**
4. Re-verify all Section A quotas before any user beyond the 5 beta users (free tiers shift without notice).
5. Content deliverables gating features: rules library (100+), exemplar sets (~230), proposed 16-domain enum sign-off (§3.3), few-shot exemplar pairs provider-tested (§4.1).
6. **Provider secrets are a `job-dispatcher` dependency, but only for `llm_retry`** (FP-02 Step 8, updated by review): `_shared/llm/adapter.ts` throws at module load when `GEMINI_API_KEY`/`GROQ_API_KEY` are absent, and those secrets are project-wide. The dispatcher therefore imports the pipeline **lazily inside the `llm_retry` handler**, so a deployment missing them fails that job type only (a normal job failure, with backoff and a recorded `last_error`) while lease recovery and every other handler keep working. Re-costed at deploy time; keep the secrets present anyway, since the only job that uses them is the one that saves a degraded turn.
7. **iOS remote push is blocked by the $0 budget** (FP-02 Step 11): remote notifications on iOS need an Apple Developer Program membership ($99/yr) to mint the APNs key, which is a new paid service and therefore barred by §3.1. Not acquired. iOS runs the Realtime + in-app fallback path (§7.10) and the app must **not** register for remote push on iOS; the local-notification path stands. **Escalation:** before any FP whose acceptance depends on iOS remote push (notification-driven interventions, watchdog prompts) can be judged done, the owner must either fund the membership or amend that FP's AC to the iOS fallback. **Amendment recorded — FP-04 (2026-10-18):** FP-04's push AC is amended to the fallback rather than the membership funded — local notifications only, an intervention rendering in-thread on the next app open. The row's evidence and the drill are in `docs/feature-prds/FP-04/FP-04-ACCEPTANCE.md` and `docs/feature-prds/FP-04/FP-04-DRILL.md` (§J). The escalation clause stays live for any later FP.
8. **`dev_overrides_enabled` must be `false` before real beta users** (FP-02 Step 11): the key ships `true` in the beta project so Step 6's tier forcing is exercisable. While it is `true` a client can force `tier`/`domain` on its own turns (`dev_force`) — **scope leakage, not privilege escalation**: `send-message` reads the key per request and ignores `dev_force` when it is false, `dev_force` is never consulted for authorisation, and RLS still scopes every row to `auth.uid()`. Flip it to `false` before inviting any user beyond the current tester set. It is a `config` read, so no redeploy is needed.
9. **Web Push is deferred to its own step** (FP-02 Step 11): the approved web fallback for AC-7 is the in-chat Realtime render plus the in-app check-in banner (D1, §7.4). True Web Push — a VAPID keypair, a service worker, and a `web-push` send path — needs its own PRD section and D# before implementation. `vapid_public_key` is registered in §11 but has no consumer yet.

---

## 14. Implementation Order

1. Migrations 1–3 + Auth + health endpoint + keep-alive (unblocks nothing else dying silently).
2. Jobs infra (migration 6) + dispatcher + one test job type.
3. `send-message` + pipeline stages 1–5 + guardrails prompt v1 + Realtime.
4. Classifier + exemplar placeholder seeds → persona tiers live.
5. Check-in loop (client scheduler + `submit-checkin` + watchdog).
6. Journal evening chain + anchor plans + JIT.
7. Memory extraction + purge.
8. Dashboard + validation gate + metric eval.
9. Drift/quests → habits/Strike → trust/Oath → lockdown → interception (each rides existing machinery).
10. Onboarding flow + content migrations (rules/exemplars) — parallel from step 4.
11. Hardening pass: idempotency audit, prompt-injection tests, provider failover drill.

---

**Document status:** TECH-SPECS.md v1.0 complete — every PRD requirement maps to a decision (D1–D25) and a spec section. Open items are exclusively the three setup-day checks (§13) and content authoring; no architectural questions remain.