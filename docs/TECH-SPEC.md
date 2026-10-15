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

### 2.3 Job type registry

| Type | Inserted by | Cadence/trigger | Handler behavior |
|---|---|---|---|
| `watchdog_checkin` | pg_cron | every 5 min | find closed check-in windows (expected time + 10 min grace **[SPEC]**) with no `doings_logs` row → insert `intervention` job + intervention push |
| `drift_scan` | pg_cron | every 10 min | evaluate per-user drift patterns (§7.3) → conversational intervention + optional Side Quest |
| `journal_extract` | `submit-journal` (sync fn) | on journal submit | evening chain head (§7.4) |
| `journal_probe` | `journal_extract` | conditional (vague/severe) | send probe message + push |
| `anchor_plan` | `journal_extract` | after extraction | generate next-day anchor plan (§7.2) |
| `memory_extract` | send-message (sync fn) | when window boundary crossed | extract facts from aged-out messages (§7.6) |
| `purge_memory` | `flag-unsavable` (sync fn) | on late flag | delete derived facts by provenance (§7.6) |
| `metric_eval` | pg_cron | daily 00:30 user-local | evaluate all active JSONLogic formulas → `metric_points` |
| `histogram_daily` | pg_cron | daily 01:00 user-local | rebuild urge histograms (§7.8) |
| `strike_fire` | habit creation / daily check | at watch expiry (day X, 18:00 user-local **[SPEC]**) | generate Strike per Tiered Proof (§7.5) |
| `intervention` | watchdog / sync eval | on detection | generation call + high-priority push |
| `proactive` | pg_cron daily / profile-gap logic | 1–2×/day **[SPEC]** | profile-gap or companionship message |
| `llm_retry` | sync fns | on provider failure | retry call routed to fallback provider (§4.1) |
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
  metadata jsonb default '{}',                           -- persona, route, domain, rule_ids, persona_options[], source, user_message_id
  created_at timestamptz default now()
);
create index messages_thread_idx on messages (user_id, created_at desc);
create unique index messages_user_client_msg_uniq on messages (user_id, client_message_id);
create unique index messages_one_primary_reply on messages (reply_to_message_id)
  where reply_to_message_id is not null;                 -- at most one primary reply per user message

create table doings_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('doing','impulse_failure')),
  content text,
  energy int check (energy between 1 and 10),
  source text not null check (source in ('checkin_reply','chat','app','quick_action')),
  logged_at timestamptz not null,                        -- when the doing happened
  checkin_window timestamptz,                            -- which interval this answers (watchdog join key)
  embed_model text, embedding vector(768),
  created_at timestamptz default now()
);
create index doings_user_time_idx on doings_logs (user_id, logged_at desc);
```

**Message dedupe (FR-16, D23):** `client_message_id` is generated client-side; the unique index `(user_id, client_message_id)` makes `send-message` idempotent — a repeat send (`on conflict do nothing`) never creates a second user row. Assistant rows leave `client_message_id` NULL; Postgres treats NULLs as distinct, so they never collide.

**Primary vs secondary reply (FR-5, §5.1):** a **primary reply** is the pipeline's single assistant answer to a user message; it sets `reply_to_message_id` and is unique per user message (`messages_one_primary_reply`). A **secondary reply** is a later re-run for the same user message (e.g. `select-persona` in D13's Medium tier) and **must leave `reply_to_message_id` NULL** so the guard never blocks it. `reply_to_message_id` is authoritative for the user-message↔reply link; `metadata.user_message_id` is retained as a client/telemetry convenience. No FK on the column: account deletion removes a user's parent and child rows in one statement, which immediate FK enforcement can reject.

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

**Domain enum:** 16 domains are part of the rules-library content deliverable (D17). Proposed set **[SPEC, requires content sign-off]**: Career, Finance, Fitness, Health, Learning, Creativity, Relationships, Family, Social, Mental/Emotional, Spirituality, Discipline/Habits, Communication, Environment/Home, Recreation, Purpose/Legacy.

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
  auto_adopt_successes int default 0,                    -- user engaged (replied within 10 min) after auto-persona [SPEC]
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
7. Content migrations: rules library (100+ rows + embeddings), exemplar sets (domains ×~10, emotions ×~8, quit ×~10) — **gated on content authoring (D17/D19)**.

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
- **Sync path failure:** provider 429/5xx → insert `llm_retry` job (payload = original call, target = fallback) → user gets an immediate in-character holding message (config `sync_degrade_reply` **[SPEC]**: e.g., *"Noted. Give me a second."*) + the real response arrives via push. Never blocks ingestion; never loops.
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

**Domain hand-off (stage 4 → stage 3):** stage 4 resolves the *effective* domain before stage 3's rule query, because the fallback route forces `General` (D7) and that state must retrieve no aggressive rules. The message embedding itself is independent of the domain and runs alongside stages 1–2.

**Repair-on-duplicate (§7.10):** if a `send-message` retry arrives for a user message that has **no primary reply** — the window opens when the invocation *dies* after the user row is written (a provider failure instead degrades to `malformed_fallback_reply` per §4.2 and still returns a reply) — the whole sequence above is re-run from the **stored** user text and the primary reply is written. Under concurrency (retry-vs-retry, or original-vs-repair) the `messages_one_primary_reply` index guarantees a single reply: the losing invocation catches Postgres `23505` and returns the winner's id.

### 5.2 Rule retrieval + conflict filter (deterministic)

1. `select * from rules where domain = :domain order by embedding <=> :msg_embedding limit 5`.
2. Conflict filter: group by `tone`; if aggressive and empathetic rules are both present in the same domain AND their group-max priorities are within `config.conflict_priority_window` points **[SPEC]**, drop the lower-priority group (tie keeps aggressive) — enforces PRD §2 "no contradictory advice."
3. Pass surviving rule texts + tone tags to generation as context.

### 5.3 Persona Determination (three-tier, PRD §2)

Confidence source: classifier `overall_conf` (§6.3), adjusted by `persona_stats.band_shift` (D8). Effective bands (defaults §11):

| Effective confidence | Behavior |
|---|---|
| ≥ High band (0.75) | Auto-adopt persona matching detected emotion; increment `auto_adopt_successes` if user replies within 10 min (D8 input) |
| Medium band (0.55–0.74) | Generation emits `ui_metadata.persona_options` (2–3 options, in-chat quick-select chips per §3.0); client renders chips; user tap → `select-persona` fn → **re-run stages 3–5 only**, persona locked for the turn |
| Low band (0.40–0.54) | Davos explicitly asks in-thread how to proceed (direct_quote is the question itself) |
| < 0.40 / no match | D7 fallback: domain = `General`, persona = `inquirer`; next message re-routes normally |

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

### 6.2 Process (deterministic, no LLM)

1. Embed message text (single Gemini embedding call, reused later for doings memory).
2. pgvector cosine nearest-match, independently against three exemplar sets: `domain`, `emotion`, `quit_signal`.
3. Check-in turns: energy ≤ 3 → emotion forced `exhausted`; energy ≥ 8 → forced `determined` (overrides embedding match).

### 6.3 Outputs

```json
{ "domain": "label|null", "domain_conf": "0..1", "emotion": "label|null",
  "emotion_conf": "0..1", "quit_signal": "bool", "overall_conf": "0..1" }
```

`overall_conf = min(domain_conf, emotion_conf)` **[SPEC]**. `quit_signal = true` when quit-set top similarity ≥ 0.75 **[SPEC]** → arms D21 alongside extraction `intent_flags` (redundant signals, either triggers).

### 6.4 Fallback

`overall_conf < 0.40` OR either label null → D7 route (`General` + `inquirer`).

**Exemplar set sizes [SPEC]:** ~10 examples per domain (160), 8 per emotion (48), 10 per quit label (20). Content deliverable alongside rules library.

---

## 7. Feature Specifications

### 7.1 Interval check-in loop (D9)

**Client scheduling:** rolling 24 h window of local notifications, deterministic ids `checkin_{userId}_{epochHour}`; scheduled at app open + after each submission; cadence from `profiles.checkin_cadence_minutes`; suppressed outside active hours (§3.2). One missed reply never affects future notifications (pre-scheduled by design).

**Notification payload:** title "What did you do this hour?", actions: [Reply (text input)], tap → deep link `davos://chat?focus=checkin` (web: `/chat?focus=checkin`).

**Capture:**
- Direct reply → background task posts to `submit-checkin` `{content, windowTs}`.
- Energy parse (server): trailing standalone integer 1–10 (`/\b(10|[1-9])\s*$/`); absent/malformed → `energy=null`, Davos asks for energy next turn.
- Deep link path → chat input focused; after send, client renders quick-tap energy chips 1–10 (and emoji map 😴…🔥); selection PATCHes the doing's energy.
- Web: persistent in-app check-in banner + Web Push tap → chat + chips.

**Sync evaluation (`submit-checkin`, deterministic-first):**
1. Insert `doings_logs` (kind=doing, `checkin_window`, energy, embedding).
2. Deterministic gates: energy ≤ 3, or window answered > 15 min late **[SPEC]** → run LLM evaluation call comparing doing vs current anchor (D14): output `{deviation: bool, intervention: bool}`.
3. Intervention → generation (pipeline §5) + high-priority Expo push. On-track → no action (next check-in already scheduled).

**Watchdog:** `watchdog_checkin` job (§2.3): windows closed > 10 min grace without submission → `intervention` job + push (PRD §4.3 ignored-check-in intervention).

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
- Send contract: `POST send-message {content, client_message_id, client_sent_at?}` → `{user_message_id, assistant_message_id, status: 'ok' | 'duplicate'}`. A repeat send whose turn is already answered returns `duplicate`; a repeat send whose turn was never answered **repairs** it (§5.1) and returns `ok`. `content` length is capped by `config.chat_max_message_chars` **[SPEC]**. `assistant_message_id` is null only when a `duplicate` turn has no reply (pre-5a rows).
- AI response: pipeline inserts assistant row → Realtime delivers to foregrounded clients; Expo push sent for every AI message with collapse key `chat_{userId}`, **suppressed client-side when the chat screen is focused** (message arrives via Realtime instead).
- Offline queue: unsent user messages stored locally (SQLite/AsyncStorage) with `client_sent_at`; retried on reconnect in order; server uses `client_sent_at` for ordering truth and dedupe by client-generated message uuid **[SPEC]**.
- Web push: Expo web push where browser-supported; otherwise in-app banner on next open.

### 7.11 Auth (D25)

Supabase Auth: email OTP code (6-digit) + Google OAuth. JWT scopes every Edge Function call to `auth.uid()`; RLS enforces row isolation across the 5 beta users. Google setup: OAuth client + redirect URIs (iOS/Android deep links, web origin). Email flow: `sign-in` collects email → `supabase.auth.signInWithOtp({ email })` sends 6-digit code → `verify-code` collects code → `supabase.auth.verifyOtp({ email, token, type: 'email' })` creates session → navigate to `(app)/chat`. Non-blocking live item: built-in SMTP deliverability for OTP codes — confirm at setup.

### 7.12 Email Verification Flow

`app/verify-code.tsx` implements the second half of the OTP flow. It accepts `email` via route param (`/verify-code?email=...`) with AsyncStorage fallback (`davos_pending_email`) for navigation recovery. It validates `OTP_CODE_LENGTH = 6`, calls `verifyOtp`, clears the stored email on success, and navigates to `(app)/chat`. It supports resend via `signInWithOtp`. Code expiry follows `[auth.email] otp_expiry = 3600s` (60 minutes).

---

## 8. Notification & Push Map

| Notification | Type | Trigger source | Priority | Deep link |
|---|---|---|---|---|
| Interval check-in | Local (rolling 24 h) | client scheduler | default | `davos://chat?focus=checkin` |
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

**Route map [SPEC]:**
```
(app)/chat            — primary UI, Realtime subscription, energy chips, persona chips, offline queue
(app)/journal         — distraction-free editor + Unsavable block flagging
(app)/dashboard       — registry components consuming metrics API
(app)/settings        — cadence, notification prefs
(onboarding)/interview — chat-based state machine
```

**Platform capability matrix:**

| Capability | iOS | Android | Web |
|---|---|---|---|
| Local scheduled notifications | ✅ | ✅ (OEM battery risk → D9 fallback) | ❌ → in-app banner + Web Push |
| OS direct reply | ✅ | ✅ | ❌ → deep link into chat |
| Expo remote push | ✅ | ✅ | browser-dependent |
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
| `emotion_labels` | frustrated, exhausted, anxious, proud, determined, avoidant |
| `trust_threshold` | 70 (scale 0–100; admission +10; deltas ±5; streak +2/day ≥3-day streak) |
| `strike_watch_days_default` | 7 (per-habit configurable) |
| `preemptive_lead_minutes` | 15 |
| `habit_detection_thresholds` | ≥3 impulse failures/week OR ≥3 journal flags |
| `checkin_cadence_default` | 60 min (bi-hourly option) |
| `watchdog_grace_minutes` | 10 |
| `lockdown_circuit_breaker_hours` | 24 |
| `sliding_window_messages` | 8 |
| `conflict_priority_window` | 15 (same-domain aggressive+empathetic rule groups within this priority gap → drop the lower-priority group; §5.2) |
| `sync_degrade_reply` | "Noted. Give me a second." |
| `malformed_fallback_reply` | "Something went wrong. Let me try again." |
| `llm_stub_mode` | false (dev-only: canned schema-valid responses, zero network) |
| `llm_force_fail` | none (dev-only: "none"|"primary"|"both") |
| `llm_stub_malformed` | false (dev-only: stub mode returns invalid JSON to exercise the §4.2 bounded parse retry) |
| `dev_overrides_enabled` | true (dev-only: enable forced persona/route params) |
| `job_dispatcher_url` | "https://<project>.supabase.co/functions/v1/job-dispatcher" |
| `chat_max_message_chars` | 8000 (max user message length; enforced by `send-message` and the composer) |

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
| Sync-path latency | pipeline 3–4 LLM-lite calls ≈ 15–40 s | 150 s | comfortable |

---

## 13. Blocking Assumptions & Live Items

**Blocking before implementation start (setup-day checks, ~30 min):**
1. **VERIFIED 2026-10-15**: Groq JSON mode / structured output on the pinned fallback model `openai/gpt-oss-120b` — **available** (`response_format: {type:"json_object"}` returns valid JSON). Note: JSON mode guarantees syntactically valid JSON only, not schema conformance (observed `persona_options` emitted as a string array rather than objects), so the schema-in-prompt guidance remains. Prior 2026-10-11 finding (`not available`) applied to the now-decommissioned `llama-3.1-70b-versatile`.
2. **VERIFIED 2026-10-11**: Realtime message allowance on free tier — 200 peak connections verified; message quota observed near-zero at 5-user scale during Step 10 testing; no spikes observed.
3. **VERIFIED 2026-10-11**: Supabase built-in SMTP OTP code deliverability — 6-digit code email arrival within 2–5 minutes observed during Step 4 testing; meets ≤5 min target. (Magic links replaced by OTP codes per G-01 resolution; §7.11 auth flow updated.)

**Live items (non-blocking, tracked):**
4. Re-verify all Section A quotas before any user beyond the 5 beta users (free tiers shift without notice).
5. Content deliverables gating features: rules library (100+), exemplar sets (~230), proposed 16-domain enum sign-off (§3.3), few-shot exemplar pairs provider-tested (§4.1).

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