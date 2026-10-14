# FP-01-PLAN.md — Build Plan: Application Skeleton & Operational Foundation

**Companion to:** `docs/feature-prds/FP-01.md` · governed by `AGENTS.md`
**Sizing rule:** each step = one agent session, one commit, one verifiable outcome. No step touches more than one subsystem.
**How to use:** feed the agent one step at a time, in order. The "Verify" block is the pass/fail gate — do not proceed to the next step until it passes. Steps marked **OWNER MANUAL** contain clicks only you can perform; run them alongside the agent's work.
**Conventions applying to every step:** AGENTS.md §6 change protocol (cite refs in the commit; update docs in the same change) and §9 checklist at completion.

**Progress tracker:**

| Step | Name                                              | Status |
| ---- | ------------------------------------------------- | ------ |
| 0    | Repo & docs baseline                              | ☐      |
| 1    | Expo Router bootstrap + route stubs               | ☐      |
| 2    | Supabase project + migrations 1–3                 | ☐      |
| 3    | Profiles trigger + RLS (migrations 2–3 tables)    | ☐      |
| 4    | Auth: magic link + protected routes               | ☐      |
| 5    | Auth: Google OAuth (all platforms)                | ☐      |
| 6    | Migrations 4–5: knowledge & feature tables        | ☐      |
| 7    | Jobs table + dispatcher + `smoke_test`            | ☐      |
| 8    | pg_cron tick wiring                               | ☐      |
| 9    | `health` function + keep-alive                    | ☐      |
| 10   | Realtime chat subscription                        | ☐      |
| 11   | §13 verification, doc write-backs, final AC sweep | ☐      |

---

## Step 0 — Repo & docs baseline

**Agent does:**

1. Create the exact structure: `AGENTS.md`, `docs/ULTIMATE-PRD1.md`, `docs/decisions2.md`, `docs/TECH-SPECS.md`, `docs/GLOSSARY.md`, `docs/feature-prds/FP-01.md` (contents as already authored — no edits).
2. Ensure `decisions1.md` / `decisions-review*.md` are **not** present anywhere under `docs/` (AGENTS.md §2).
3. Add `.gitignore` (Node, Expo, `.env`, `supabase/.branches`, `.temp`).

**Verify:** `ls docs/` shows exactly the four source files + `feature-prds/FP-01.md`; `grep -ri "decisions1" docs/` returns nothing; initial commit made citing FP-01 §1.

---

## Step 1 — Expo Router bootstrap + route stubs

**Agent does:**

1. `npx create-expo-app@latest davos --template tabs` → convert to TypeScript + Expo Router file-based routing; remove template cruft.
2. Create stub screens per TECH-SPECS §9 route map: `(app)/chat` (landing route — empty thread list + **disabled** input with placeholder "Davos will speak first"), `(app)/journal`, `(app)/dashboard`, `(app)/settings`, `(onboarding)/interview`. Each stub: one `<View>` + one `<Text>` with the route name.
3. React Native primitives only — no `<div>`/`<span>` anywhere (AGENTS.md §7.1).
   **Verify:** `npx expo start --web` → all five routes reachable in browser nav; `grep -rE "<div|<span" app/` returns nothing.

**Commit refs:** TECH-SPECS §9; D1.

---

## Step 2 — Supabase project + migrations 1–3

**OWNER MANUAL (before agent):** create the Supabase project (free tier, region nearest you); copy project ref + anon key; install Supabase CLI; `supabase init` + `supabase link`.

**Agent does:**

1. Migration `0001_extensions_config`: enable `pgcrypto`, `pg_cron`, `pg_net`, `vector`; create `config` table (TECH-SPECS §3.4) and seed **every** §11 key with the approved values exactly as listed.
2. Migration `0002_auth_profiles`: `profiles` (§3.2, all columns/defaults/checks) + `push_tokens` (§3.4).
3. Migration `0003_chat_doings`: `messages` + `doings_logs` (§3.2) including `messages_thread_idx`, `doings_user_time_idx`, and the `vector(768)` columns (no HNSW index yet — not needed until embeddings exist).
4. Create Supabase client in the app (`lib/supabase.ts`) reading URL + anon key from environment variables — never the service-role key (AGENTS.md §4.5).

**Verify (SQL editor):** `select * from config;` returns all §11 keys with approved values; `\dx` shows the four extensions; `select count(*) from profiles, messages, doings_logs` — all exist, zero rows; client env vars present, service-role key absent from repo (`grep -r "service_role" .` clean).

**Commit refs:** TECH-SPECS §3.5, §3.2, §3.4, §11; D23.

---

## Step 3 — Profiles trigger + RLS on migration 2–3 tables

**Agent does:**

1. Migration `0004_profiles_trigger`: `on_auth_user_created` trigger → insert `profiles` row with FR-4 defaults (`onboarding_stage='intro'`, `checkin_cadence_minutes=60`, active hours 08:00–22:00, `dialog_state='OPEN'`).
2. Migration `0005_rls_core`: RLS enable + policy `auth.uid() = user_id` (select/insert/update) on `profiles`, `push_tokens`, `messages`, `doings_logs` (AGENTS.md §4.1 — a violation here is always a bug).

**Verify (SQL editor + dashboard):**

1. Dashboard → Authentication → Add user (any email) → `select * from profiles;` shows exactly one row with the defaults.
2. Run with anon key context (`supabase.auth` not signed in): `select * from messages;` → 0 rows; insert into `messages` → rejected.

**Commit refs:** FP-01 FR-4, FR-11; TECH-SPECS §3.1, §10.1.

---

## Step 4 — Auth: magic link + protected routes

**Agent does:**

1. Auth screens: `sign-in` (email input + "Send magic link" button) per D25; loading/error states.
2. `supabase.auth.signInWithOtp({ email })` on submit; on session, navigate to `(app)/chat`.
3. Root layout guard: no session → redirect to `sign-in`; session → `(app)/chat`.
4. Session persistence + `onAuthStateChange` listener; sign-out button in `(app)/settings`.
5. Web redirect handling (`?code` exchange) in the root effect.

**Verify:** enter your email on the web app → magic-link email arrives (record arrival time — feeds Step 11 / §13 check 3) → click → chat screen renders; refresh persists the session; Settings → sign out → back at `sign-in`.

**Commit refs:** D25; TECH-SPECS §7.11; FP-01 FR-3 (partial — Google in Step 5), FR-4.

---

## Step 5 — Auth: Google OAuth (all platforms)

**OWNER MANUAL (before agent):** Google Cloud Console → OAuth client (Web application) with authorized origins/redirects: web origin, Expo Go redirect (`https://auth.expo.io/@your-username/davos`), Android redirect (SHA-key based) — budget one session for this (FP-01 §8 risk #1). Copy client ID into Supabase → Authentication → Providers → Google, enable.

**Agent does:**

1. `supabase.auth.signInWithOAuth({ provider: 'google' })` button on `sign-in`.
2. Expo app scheme in `app.json` + deep-link handler resuming the OAuth session on native; `redirectTo` per platform (web origin / Expo Go URL / custom scheme).
3. Existing session-fallback in `sign-in` when deep link is dropped (get existing session on mount).

**Verify:** Google button works on web (popup → chat screen); **iOS via Expo Go** completes round-trip and lands on chat; Android build completes round-trip. Second sign-in is instant (existing session).

**Commit refs:** D25; TECH-SPECS §7.11; FP-01 FR-3 complete. **Passes AC-2, AC-3.**

---

## Step 6 — Migrations 4–5: knowledge & feature tables

**Agent does:**

1. Migration `0006_knowledge`: `rules`, `exemplars`, `memory_facts` (§3.3) — columns/checks exactly as specced; `vector(768)` columns; **no seed rows** (content is migration 7, content-gated — AGENTS.md §8.4).
2. Migration `0007_features`: `journal_entries`, `metrics`, `metric_points`, `anchor_plans`, `habits`, `persona_stats`, `trust_events` (§3.4) with all enums/checks/constraints (`unique (metric_id, computed_for)`, `unique (user_id, plan_date)`, PK `(user_id, domain)` on `persona_stats`).
3. RLS enable + `auth.uid() = user_id` policy on every table in both migrations.

**Verify (SQL editor):** all 11 tables from §3.3–3.4 exist; `select relname, polname from pg_policy` lists a policy for each; zero rows everywhere; `rules`/`exemplars` empty (no placeholder content).

**Commit refs:** TECH-SPECS §3.3, §3.4, §10.1; FP-01 FR-11 complete.

---

## Step 7 — Jobs table + dispatcher + `smoke_test`

**Agent does:**

1. Migration `0008_jobs`: `jobs` table exactly per §2.1 (status check incl. all six states, `max_attempts` default 5, `jobs_due_idx`).
2. Edge Function `job-dispatcher` implementing §2.2 exactly: claim batch of 10 with `for update skip locked`, set `claimed/running`, execute handler, `done` or `failed` with `next_retry_at = now() + 2^attempts × 30s`, `dead` at `max_attempts`, 5-minute lease reset of stale `running` rows to `pending`.
3. Handler registry inside the dispatcher with exactly one entry: job type `smoke_test` — payload `{}` → immediate `done`; payload `{"fail":true}` → always throws (backoff/dead-letter test vehicle).
4. Dispatcher reads only via service role; never trusts payload SQL/identifiers beyond the registry key.

**Verify (curl, no scheduler yet):**

1. Insert `smoke_test` job (`insert into jobs (type) values ('smoke_test')`) → invoke dispatcher once via `curl` → row shows `pending → running → done` with `completed_at` set.
2. Insert with `{"fail":true}` → invoke dispatcher 5 times, checking `attempts`, `next_retry_at` (interval ≈ 30 s, 60 s, 120 s, 240 s) → after 5th attempt status `dead`, `last_error` populated.
3. Lease test: temporarily deploy a handler variant that sleeps > 60 s, start it, redeploy the normal one → after 5 min the stale `running` row resets to `pending` and completes on the next invoke. Revert the sleep variant before committing.

**Commit refs:** TECH-SPECS §2.1, §2.2, §2.3 (registration happens in Step 11); D2, D12; FP-01 FR-6, FR-7.

---

## Step 8 — pg_cron tick wiring

**Agent does:**

1. In the dispatcher migration (or a new `0009_cron`): `select cron.schedule('job-dispatcher-tick', '* * * * *', $$ select net.http_post(...) $$);` — POSTs to the deployed `job-dispatcher` URL with the service-role auth header, every 1 minute.
2. Store the dispatcher URL as an Edge Function secret or a locked `config` row — not inline plaintext in the migration.
3. Confirm the tick is idempotent-safe by design (§2.2 note: ticks only _enable_ claiming; a missed or doubled tick cannot corrupt state — document this in a migration comment).

**Verify:** insert a `smoke_test` job → **do nothing** → within ≤ 2 min status is `done` (automated, no curl). Insert a `{"fail":true}` job → observe backoff happening automatically across minutes → `dead`. `select * from cron.job;` shows the schedule; pg_net response rows exist in `net._http_response`.

**Commit refs:** TECH-SPECS §2.2 (algorithm 1); D12. **Passes AC-6.**

---

## Step 9 — `health` function + keep-alive

**Agent does:**

1. Edge Function `health` (ops class, GLOSSARY §13): returns `200 {"ok":true}` + timestamp; no auth required; touches nothing else.
2. Document the URL in a README ops section alongside the cron-job.org job parameters (every 6 h, GET, failure alerting on).

**OWNER MANUAL:** create cron-job.org account → job: GET your deployed `health` URL every 6 hours → enable email alerts on failure.

**Verify:** `curl https://<project>.supabase.co/functions/v1/health` → 200 `{"ok":true}`; cron-job.org dashboard shows the job scheduled (first pings green within 6 h; the 24 h green streak is the AC-5 gate — check next day).

**Commit refs:** TECH-SPECS §8 keep-alive; D12; FP-01 FR-5.

---

## Step 10 — Realtime chat subscription

**Agent does:**

1. In `(app)/chat`: subscribe to `messages` via the Supabase client Realtime channel, filtered to the authenticated user's rows; render incoming rows as simple read-only thread items (user vs. assistant alignment only — no composer functionality).
2. Unsubscribe on screen unmount; handle reconnect (channel `SUBSCRIBED` state → refetch last 50 rows so late joiners see history).
3. Input remains disabled with the FP-01 placeholder ("Davos will speak first") — no `send-message` function exists yet and none may be invented (AGENTS.md §2).

**Verify:**

1. Signed in on web with chat open → SQL editor: service-role insert into `messages` for your `user_id` → row renders within 2 s.
2. Insert a row for a _different_ `user_id` (create a second dashboard user) → nothing renders.
3. Kill wifi briefly → reconnect → channel resubscribes and history refetch renders.

**Commit refs:** TECH-SPECS §7.10, §3.2; D23. **Passes AC-7.**

---

## Step 11 — §13 verification, doc write-backs, final AC sweep

**Agent does (doc write-backs — same change, one commit):**

1. TECH-SPECS §2.3: add `smoke_test` as the 15th row (dev-only, marked clearly).
2. GLOSSARY §12: add `smoke_test` entry.
3. TECH-SPECS §13 items 1–3 → "verified" with dated results (see below).

**OWNER MANUAL (verification inputs):**

1. **Groq JSON mode:** check console.groq.com docs for the chosen model tier's structured-output support → record yes/no. If no: §4.1 degrade path (schema-in-prompt + single parse retry) becomes the recorded implementation path for FP-02.
2. **Realtime message quota:** record observed usage from Step 10 (near-zero at this scale) + current pricing-page reading.
3. **SMTP deliverability:** arrival time recorded in Step 4 (target ≤ 5 min).

**Agent does (final sweep):** 4. Run FP-01 §6 acceptance criteria AC-1 through AC-11 end-to-end; produce a checklist file `docs/feature-prds/FP-01-ACCEPTANCE.md` with pass/fail per AC (AC-5 completes after the 24 h keep-alive observation). 5. Secret scan: `grep -rE "service_role|SUPABASE_SERVICE|sk-" --include="*.{ts,tsx,json,sql}" app supabase` → clean; client bundle contains only URL + anon key. 6. AGENTS.md §9 checklist run; final PR cites TECH-SPECS §14.1–2, §2, §3.5, §9; D12, D23, D25 (FP-01 §9).

**Verify:** every AC line marked pass; TECH-SPECS/GLOSSARY diffs present in the same PR; repo clean of secrets.

--
