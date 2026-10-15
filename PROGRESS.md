# Davos — Progress Log

Append-only. Each entry records progress grounded in actual code changes, citing the governing feature PRD / plan step.

---

## 2026-10-11 — FP-01 Step 1: Expo Router bootstrap + route stubs

**Commit:** `c13ecef` — "Bootstrap Expo Router app skeleton with route stubs"
**Governing refs:** FP-01 FR-1, AC-1; FP-01PLAN.md Step 1; TECH-SPECS §9; D1.
**Status:** Step 1 complete (route stubs runnable); Step 1 verification (§ verify: all five routes reachable, no `<div>`/`<span>`) not yet recorded as run.

### What was implemented (from the diff)

- `package.json`: initialized as `davos` (v0.1.0, private) with `main: "expo-router/entry"`; scripts `start` / `android` / `ios` / `web` / `typecheck`. Dependencies added: `expo-router`, `expo`, `expo-constants`, `expo-linking`, `expo-secure-store`, `expo-status-bar`, `@expo/metro-runtime`, `@supabase/supabase-js`, `react-native-url-polyfill`, `react` / `react-dom` / `react-native`, `react-native-web`, `react-native-safe-area-context`, `react-native-screens`.
- `app/_layout.tsx`: root `Stack` with `(app)` and `(onboarding)` groups, headers hidden.
- `app/(app)/_layout.tsx`: `Tabs` navigator with four screens — Chat, Journal, Dashboard, Settings.
- Route stubs created under `app/`:
  - `(app)/chat.tsx` — landing route; empty thread list ("No messages yet. Davos will speak first.") and a **disabled** `TextInput` with placeholder "Davos will speak first" (per FP-01 §4 out-of-scope: no composer, no AI).
  - `(app)/journal.tsx`, `(app)/dashboard.tsx`, `(app)/settings.tsx` — single `<View>` + `<Text>` title stubs.
  - `(onboarding)/_layout.tsx` — `Stack` for onboarding; `(onboarding)/interview.tsx` — stub.
- All screens use React Native primitives (`View`, `Text`, `TextInput`) only — no HTML/DOM elements (AGENTS.md §7.1).
- `app.json`: plugins configured — `expo-router`, `expo-status-bar`, `expo-secure-store`.
- `tsconfig.json`: extends `expo/tsconfig.base`, `strict`, `noEmit`, `isolatedModules`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `allowSyntheticDefaultImports`, `forceConsistentCasingInFileNames`.
- `docs/feature-prds/FP-01PLAN.md`: added (build plan for FP-01, 11 steps).
- `AGENTS.md`: formatting fixes and corrected source-of-truth doc paths (`docs/adr/decisions2.md`, `docs/TECH-SPEC.md`).

### Not yet done for FP-01

- `app.json` lacks `scheme` / app identifiers / OAuth redirect config (needed for FP-01 Step 5 / FR-3).
- No `lib/supabase.ts` client yet (FP-01 Step 2).
- No `supabase/` migrations, `jobs` table, dispatcher, `health` function, or Realtime subscription (FP-01 Steps 2–10).
- `PROGRESS.md` was added empty by this commit; this entry is its first content.

---

## 2026-10-11 — FP-01 Step 2: Supabase project config, client, migrations 0001–0003

**Commit:** `f56c8f6` — "Add Supabase project config, client, and migrations 0001–0003"
**Governing refs:** FP-01 FR-2, FR-9, FR-11 (partial); FP-01PLAN.md Step 2; TECH-SPECS §3.2, §3.4, §3.5, §11; D23; `docs/ULTIMATE-PRD1.md`.
**Status:** Step 2 code complete; SQL verification (`select * from config`, `\dx`, zero-row tables, secret scan) not yet recorded as run. RLS intentionally deferred to `0005_rls_core` (per migration comments, matches plan Step 3).

### What was implemented (from the diff)

- `lib/supabase.ts`: `createClient` from `@supabase/supabase-js` reading `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (throws if missing); auth config `autoRefreshToken`, `persistSession`, `detectSessionInUrl`. Storage adapter uses `expo-secure-store` on native and `localStorage` on web; `react-native-url-polyfill/auto` imported. Anon key only — no service-role key (AGENTS.md §4.5).
- `.env.example`: public env var names only, with dashboard + local-dev guidance (AGENTS.md §4.5).
- `supabase/config.toml`: local dev config — DB `major_version = 17`, API 54321 / DB 54322 / Studio 54323, `[realtime] enabled = true`, `[storage.vector] enabled = true`, `[auth] enabled = true` (site_url `http://127.0.0.1:3000`), `[auth.email] enable_confirmations = false`, `[auth.rate_limit] email_sent = 2`.
- `0001_extensions_config.sql`: `create extension if not exists` for `pgcrypto`, `pg_cron`, `pg_net`, `vector`; `config` table (`key` PK, `value jsonb`, `description`); seeded with all §11 approved keys — `confidence_bands`, `emotion_labels`, `trust_threshold` (70), `strike_watch_days_default`, `preemptive_lead_minutes`, `habit_detection_thresholds`, `checkin_cadence_default`, `watchdog_grace_minutes`, `lockdown_circuit_breaker_hours`, `sliding_window_messages`, `sync_degrade_reply`, `malformed_fallback_reply`; `grant select on config to anon, authenticated`. (Matches TECH-SPECS §11 registry.)
- `0002_auth_profiles.sql`: `profiles` (PK = `auth.users(id)`, FR-4 defaults: `onboarding_stage='intro'`, `checkin_cadence_minutes=60`, active hours 08:00–22:00, `dialog_state='OPEN'`, `trust_score` 0–100, `latest_energy` 1–10, `routine`/`high_dopamine_activities` jsonb) and `push_tokens` (`unique (user_id, token)`, platform check, `idx_push_tokens_user_id`).
- `0003_chat_doings.sql`: `messages` (`role` user/assistant, `unsavable`, `metadata`, `messages_thread_idx (user_id, created_at desc)`) and `doings_logs` (`kind` doing/impulse_failure, `source` enum, `embedding vector(768)`, `doings_user_time_idx`, `idx_doings_logs_checkin_window`). No HNSW index yet (matches plan — not needed until embeddings exist).
- `.gitignore` rewritten for Node/Expo/Supabase (`.env*`, `.expo/`, `supabase/.branches/`, `supabase/.temp/`); `supabase/.gitignore` added. No secrets committed.
- `PROGRESS.md`: the Step 1 entry (previously appended) was committed as the build log's first content.

### Still outstanding for FP-01

- No RLS policies yet (planned `0004_profiles_trigger` / `0005_rls_core`, Step 3) — AC-4/FR-11 incomplete.
- No `profiles` auto-create trigger yet (FR-4), no auth screens/Flows (Steps 4–5 / FR-3).
- No migrations 4–5 feature tables, no `jobs`/dispatcher/`health`/Realtime (Steps 6–10).

---

## 2026-10-11 — FP-01 Step 3: profiles trigger + RLS on core tables (uncommitted)

**Changes:** two new migration files present in the working tree, **untracked** (not yet committed): `supabase/migrations/0004_profiles_trigger.sql`, `supabase/migrations/0005_rls_core.sql`.
**Governing refs:** FP-01 FR-4, FR-11, AC-2, AC-4; FP-01PLAN.md Step 3; TECH-SPECS §3.1, §10.1; AGENTS.md §4.1, §4.7; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; SQL-editor verification (dashboard-created user → exactly one `profiles` row with defaults; anon-context reads/inserts rejected) not yet recorded as run.

### What was implemented (from the new files)

- `0004_profiles_trigger.sql`: `public.handle_new_user()` (`security definer`) inserts a `profiles` row on new `auth.users` with FR-4 defaults — `onboarding_stage='intro'`, `checkin_cadence_minutes=60`, active hours 08:00–22:00, `dialog_state='OPEN'`. Idempotent `drop trigger if exists on_auth_user_created` then re-creates the `after insert ... for each row` trigger; grants execute to `service_role`.
- `0005_rls_core.sql`: `enable row level security` on `profiles`, `push_tokens`, `messages`, `doings_logs`; per-table `auth.uid() = ...` policies (select/insert/update for all; delete additionally on `push_tokens`); grants `select, insert, update` (plus delete on `push_tokens`) to the `authenticated` role. Matches AGENTS.md §4.1 (`profiles` uses `id`, others `user_id`).

### Notable / outstanding

- **Both migrations are untracked** — not in the last commit (`5c11ba9`); they need to be committed to count toward Step 3/AC-4.
- `.env.example` (committed in `5c11ba9`) now contains a real `EXPO_PUBLIC_SUPABASE_URL` + anon key. The anon key is public by role, but AGENTS.md §4.5 prefers real values only in `.env` with placeholders retained in `.env.example` — sanitize before wider sharing.
- Migration numbering still leaves `0006`+ (feature tables) and `0007`+ (jobs/health) unbuilt; auth screens/flows (Steps 4–5) still absent — AC-2/AC-3/AC-4 not yet verifiable end-to-end.

---

## 2026-10-11 — FP-01 Step 4: magic-link auth + protected routes (uncommitted)

**Changes:** uncommitted working-tree edits — new `app/sign-in.tsx`, `app/auth/callback.tsx`; modified `app/_layout.tsx`, `app/(app)/settings.tsx`, `app.json`, `.env.example`, `opencode.json`. (`1284590` committed Step 3's migrations 0004–0005.)
**Governing refs:** FP-01 FR-3 (partial — magic link only), FR-4; FP-01PLAN.md Step 4; TECH-SPECS §7.11; D25; `docs/ULTIMATE-PRD1.md`.
**Status:** Step 4 code complete (magic link, guard, callback, sign-out); verify (email arrives ≤5 min → chat; refresh persists; sign out returns to sign-in) not yet recorded as run.

### What was implemented (from the diff)

- `app/sign-in.tsx`: email input + "Send Magic Link" button; `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` with loading/error states and success alert. `getRedirectUrl()` is platform-aware — web `${origin}/auth/callback`; native dev resolves the Expo LAN `hostUri` (http on LAN, https on localhost); production falls back to `Linking.createURL('auth/callback', { scheme: 'davos' })` (Expo auth proxy); optional `EXPO_PUBLIC_AUTH_REDIRECT_OVERRIDE` for LAN/Android testing. RN primitives only.
- `app/auth/callback.tsx`: reads `?code`, calls `supabase.auth.exchangeCodeForSession(code)` → `/(app)/chat`, else `/sign-in`; shows a spinner (web redirect handling per plan Step 4.5).
- `app/_layout.tsx`: session guard — `getSession()` on mount with a loading spinner; `onAuthStateChange` subscription navigates session → `/(app)/chat`, no session → `/sign-in`; single `Stack` renders `sign-in`, `auth/callback`, `(app)`, `(onboarding)`.
- `app/(app)/settings.tsx`: added "Sign Out" button (`supabase.auth.signOut()`).
- `app.json`: wrapped config in `expo` and set `"scheme": "davos"` (deep-link scheme for auth redirects).
- `.env.example`: reverted real URL/anon key back to placeholders and documented `EXPO_PUBLIC_AUTH_REDIRECT_OVERRIDE` — resolves the §4.5 anon-key-in-example concern raised in the Step 3 entry.
- `opencode.json`: added `$schema` (tooling only; not product code).

### Outstanding

- **Google OAuth / `signInWithOAuth` is not implemented** (grep clean) — Step 5 / AC-2 not met; only magic-link path exists.
- All Step 3 + Step 4 files remain untracked/uncommitted.
- No migrations 0006+ (feature tables) or `jobs`/dispatcher/`health`/Realtime yet (Steps 6–10).

---

## 2026-10-11 — FP-01 Step 5: Google OAuth on `sign-in` (uncommitted)

**Changes:** uncommitted edit to `app/sign-in.tsx` only (+117/−12). Step 4 was committed in `f5c0991` (which also committed the Step 4 PROGRESS entry).
**Governing refs:** FP-01 FR-3 (completes), AC-2; FP-01PLAN.md Step 5; TECH-SPECS §7.11; D25; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; on-device verification (Google round-trip on web / iOS Expo Go / Android; second sign-in instant) not recorded as run.

### What was implemented (from the diff)

- `handleGoogleSignIn()`: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'consent' } } })` with error handling; success relies on the deep link being handled by `app/auth/callback.tsx`.
- `getRedirectUrl(useAuthProxy = false)`: redirect logic split by auth type — OAuth always uses Expo's auth proxy (`Linking.createURL('auth/callback', { scheme: 'davos' })` on native, `${origin}/auth/callback` on web) since OAuth requires pre-registered URIs; magic links use the custom scheme directly (`davos://auth/callback`) in prod.
- Existing-session fallback (plan Step 5.3): `useEffect` on mount calls `getSession()` → `router.replace('/(app)/chat')` when a session exists; renders a spinner while `checkingSession`.
- UI: "Continue with Google" button with `or` divider; Google button/text + divider styles; removed unused `Button` import; added `useEffect`.

### Outstanding

- The change is **uncommitted**.
- `EXPO_USERNAME` is hardcoded as `'dansai'` for the Expo auth-proxy URL — fine for dev, should be config-driven before release.
- No migrations 0006+ (feature tables) or `jobs`/dispatcher/`health`/Realtime yet (Steps 6–10).

---

## 2026-10-11 — FP-01 Step 6: knowledge & feature tables (migrations 0006–0007, uncommitted)

**Changes:** two new untracked files — `supabase/migrations/0006_knowledge.sql`, `supabase/migrations/0007_features.sql`. (`b9038d2` committed the Step 5 Google OAuth work.)
**Governing refs:** FP-01 FR-11 (completes); FP-01PLAN.md Step 6; TECH-SPECS §3.3, §3.4, §10.1; AGENTS.md §4.1, §4.7, §4.8, §8.4; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; SQL-editor verification (all 11 tables exist, a policy per table, zero rows, `rules`/`exemplars` empty) not recorded as run.

### What was implemented (from the new files)

- `0006_knowledge.sql`: `rules` (domain/source_figure/`tone` check/priority/`vector(768)`), `exemplars` (`set_kind` check domain/emotion/quit_signal, `embedding` not null), `memory_facts` (`fact_type` check chat/journal/oath/baseline, `source_message_id` FK, `purged_at`). RLS enabled on all three; `rules`/`exemplars` read-only for authenticated (system-owned content), `memory_facts` user-scoped select/insert/update. **No seed rows** (content-gated, AGENTS.md §8.4). Indexes on domain/set_kind/user_id/purged (partial)/fact_type/source FKs.
- `0007_features.sql`: `journal_entries` (`severity` S1/S2/S3, `vagueness_score`, `probed`), `metrics` (`formula` jsonb, `formula_status` check, quest fields), `metric_points` (`unique (metric_id, computed_for)`), `anchor_plans` (`unique (user_id, plan_date)`), `habits` (`status` + Strike fields), `persona_stats` (PK `(user_id, domain)`, D8 counters), `trust_events` (`reason` check openness/admission/streak/override). Adds the deferred `memory_facts.source_journal_id` FK to `journal_entries`. RLS enabled on all seven with `auth.uid()` policies (metric_points via `exists` join to `metrics`; metrics has delete; others select/insert/update) + grants. Satisfies FP-01 FR-11 across all user-scoped tables.

### Notable / outstanding

- **Both migrations are untracked** (not committed).
- `trust_events` is specced as a server-only audit log, but the migration grants `select` to `authenticated` with an own-row policy (comment says "no client access") — inconsistent with §4.7 intent; reconcile before it's consumed.
- No `jobs` table/dispatcher/pg_cron tick, `health` function, or Realtime subscription yet (Steps 7–10); HNSW index for embeddings still absent (deferred).

---

## 2026-10-11 — FP-01 Step 7: jobs table + dispatcher + `smoke_test` (uncommitted)

**Changes:** untracked `supabase/migrations/0008_jobs.sql` and `supabase/functions/job-dispatcher/index.ts`; modified `tsconfig.json` (excludes `supabase/functions` from the app's `tsc`). (`ac7d8c8` committed Step 6 migrations 0006–0007.)
**Governing refs:** FP-01 FR-6, FR-7, AC-6, AC-11; FP-01PLAN.md Step 7; TECH-SPECS §2.1, §2.2, §2.3; D2, D12; AGENTS.md §3.8, §6.4; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; curl verification (pending→running→done; `{"fail":true}` backoff/dead; lease reset) not recorded as run. pg_cron tick is Step 8 — dispatcher is invoked manually for now.

### What was implemented (from the new files)

- `0008_jobs.sql`: `jobs` table per §2.1 — `status` check covering all six states (`pending/claimed/running/done/failed/dead`), `payload jsonb`, `attempts`, `max_attempts` default 5, `next_retry_at`, `last_error`, `completed_at`; `jobs_due_idx (status, next_retry_at)`.
  - `claim_jobs(batch_size=10, lease_minutes=5)` (`security definer`): selects `pending` with `next_retry_at <= now()` ordered by `next_retry_at`, `for update skip locked`, sets `running` and increments `attempts`, returns the batch.
  - RLS enabled with **no policies** and no `authenticated` grants → client cannot touch `jobs` (service role only).
- `supabase/functions/job-dispatcher/index.ts`: Deno `Deno.serve` dispatcher per §2.2 — creates a service-role client, resets stale `running` rows (`updated_at < now − 5 min`) to `pending`, claims a batch of 10 via `claim_jobs` RPC, executes each job sequentially; success → `done` + `completed_at`; failure → `failed` with `next_retry_at = now + 2^attempts × 30s`, `dead` at `max_attempts`. Handler registry contains exactly one entry: `smoke_test` (`{}` → no-op `done`; `{"fail":true}` → throws). Unknown job types are marked `dead` immediately (guards against unhandled types).
- `tsconfig.json`: `supabase/functions` excluded so Deno edge code isn't type-checked by the Expo app config.

### Notable / outstanding

- **Untracked** — needs committing.
- §2.3 / GLOSSARY §12 registration of `smoke_test` is deferred to Step 11 (per plan); handler registry is in-code only for now.
- `claim_jobs` sets `running` directly (no intermediate `claimed` state) and its declared `lease_until` variable is unused; `markJobFailed` uses `2^attempts` with `attempts` already incremented at claim — verify the observed backoff intervals (plan expects ≈30/60/120/240 s) against this off-by-one.
- No pg_cron tick yet (Step 8); `health` + Realtime still absent (Steps 9–10).

---

## 2026-10-12 — FP-01 Step 7 follow-up: `claim_jobs` retry/search-path fix (uncommitted)

**Changes:** uncommitted edits to `supabase/migrations/0008_jobs.sql` and `.vscode/settings.json`. Step 7 itself was committed in `d878779`.
**Governing refs:** FP-01 FR-6, AC-6; FP-01PLAN.md Step 7; TECH-SPECS §2.2, §3.5; AGENTS.md §4.1; `docs/ULTIMATE-PRD1.md`.
**Status:** migration edited after being committed; re-apply/verify not recorded as run.

### What was implemented (from the diff)

- `claim_jobs` retry fix: claim predicate changed from `status = 'pending'` to `status in ('pending', 'failed')`, so `failed` rows are re-claimed once `next_retry_at` is due — without this, backoff retries from `markJobFailed` would never resume (prior version only ever re-claimed `pending`).
- `search_path` hardening: function fully qualified (`public.claim_jobs`, `returns setof public.jobs`, `public.jobs%rowtype`), inline `set search_path = public`, and the trailing `alter function … set search_path = ''` statement removed.
- Removed the unused `lease_until` local variable (declared but never used).
- `.vscode/settings.json`: adds `"[sql]": { "editor.defaultFormatter": "denoland.vscode-deno" }` (editor tooling only).

### Notable / outstanding

- **Editing an already-committed migration (`0008`)**: if it has been pushed to any environment, the local file now diverges from applied state — per TECH-SPECS §3.5, prefer a new migration over mutating history. Both files are uncommitted.
- Retry path not yet exercised end-to-end; `{"fail":true}` backoff/dead verification and the pg_cron tick (Step 8) remain.

---

## 2026-10-12 — FP-01 Step 8: pg_cron tick wiring (migrations 0009–0010, uncommitted)

**Changes:** two new untracked files — `supabase/migrations/0009_cron.sql`, `supabase/migrations/0010_cron_auth.sql`. (`42ce58a` committed the Step 7 follow-up.)
**Governing refs:** FP-01 FR-6, AC-6; FP-01PLAN.md Step 8; TECH-SPECS §2.2 (algorithm 1), §11; AGENTS.md §4.5; D12; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; verification (smoke_test job → `done` within ≤2 min with no curl; `{"fail":true}` → automatic backoff → `dead`; `cron.job` + `net._http_response` rows) not recorded as run. Requires the `job_dispatcher_url` config value and a Vault secret to be set first.

### What was implemented (from the new files)

- `0009_cron.sql`: `cron.schedule('job-dispatcher-tick', '* * * * *', …)` running every minute; the command calls `net.http_post(url := (select value #>> '{}' from config where key = 'job_dispatcher_url'), …)` with `Content-Type: application/json` and no auth header. Includes the idempotence-by-design note (ticks only *enable* claiming; `for update skip locked` prevents double-claim).
- `0010_cron_auth.sql`: supersedes 0009 — guarded `cron.unschedule('job-dispatcher-tick')` then re-`schedule` with an added `Authorization: Bearer` header read at call time from `vault.decrypted_secrets` (`name = 'job_dispatcher_auth'`), because the deployed function enforces `verify_jwt`. Keeps the key out of `config` (readable by anon/authenticated) and out of the migration (AGENTS.md §4.5); documents the owner action `vault.create_secret('<service_role_key>', 'job_dispatcher_auth', …)`.

### Notable / outstanding

- **Both migrations untracked.** Also, 0009 is created and then wholly replaced by 0010 in the same change — redundant, though harmless (0010 unschedules first). Consider collapsing into one before applying.
- Introduces a new `config` key `job_dispatcher_url` that is **not** in the §11 registry seeded by `0001` (set out-of-band; `config` is anon-readable, so keep the URL non-secret) — register it per GLOSSARY §11 / AGENTS.md §6.6 before relying on it.
- Depends on an owner Vault secret (`job_dispatcher_auth`); the tick is inert until both it and `job_dispatcher_url` are set. No `health` function or Realtime subscription yet (Steps 9–10).

---

## 2026-10-12 — FP-01 Step 9: `health` Edge Function (uncommitted)

**Changes:** two new untracked files — `supabase/functions/health/index.ts`, `supabase/functions/health/config.toml`. (`61b73e5` committed Step 8 migrations 0009–0010.)
**Governing refs:** FP-01 FR-5, AC-5; FP-01PLAN.md Step 9; TECH-SPECS §8 keep-alive (line 528), §2 (function map); D12; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; `curl …/functions/v1/health` → 200 `{"ok":true}` and cron-job.org scheduling/24 h green streak (AC-5) not recorded as run.

### What was implemented (from the new files)

- `supabase/functions/health/index.ts`: Deno `Deno.serve` health endpoint — GET returns `200 {"ok":true,"timestamp":…}`, or `503` `{ok:false}` on failure; `405` for non-GET; `204` for CORS `OPTIONS`. Cron-job-friendly CORS headers (`Access-Control-Allow-Origin: *`). Adds a lightweight DB connectivity probe (`config` select limit 1) using a service-role client.
- `supabase/functions/health/config.toml`: `verify_jwt = false` so the endpoint is reachable without auth (with an in-code comment noting the bypass as a fallback for CLI versions where `verify_jwt` doesn't apply).

### Notable / outstanding

- **Untracked** — needs committing.
- Deviation from plan Step 9.1 ("touches nothing else"): the function opens a service-role client and queries `config`; harmless but broader than specced.
- Dead code: the `isServiceRole` value is computed but never used (the "manual auth bypass" comment describes logic that isn't actually gated).
- Plan Step 9.2 (README ops section documenting the URL + cron-job.org parameters: GET, every 6 h, failure alerting) is **not** present — no ops README added.
- Realtime chat subscription still absent (Step 10); the AGENTS.md §9 secret scan and doc write-backs remain for Step 11.

---

## 2026-10-12 — FP-01 Step 10: Realtime chat subscription (uncommitted)

**Changes:** new untracked `lib/auth.tsx`, `supabase/migrations/0011_realtime_messages.sql`; modified `app/(app)/chat.tsx`, `app/_layout.tsx`. (`6056db9` committed the Step 9 `health` function.)
**Governing refs:** FP-01 FR-8, AC-7; FP-01PLAN.md Step 10; TECH-SPECS §7.10, §3.2; D23; `docs/ULTIMATE-PRD1.md`.
**Status:** code written; verification (service-role insert renders within 2 s; a different user's row does not; reconnect refetch) not recorded as run.

### What was implemented (from the diff / new files)

- `lib/auth.tsx`: `AuthProvider` context exposing `{ user, loading }` — initial `getSession()` plus `onAuthStateChange` subscription; `useAuth()` hook.
- `app/_layout.tsx`: wraps the root `Stack` in `AuthProvider` (adds a second session listener alongside the existing guard).
- `app/(app)/chat.tsx`: loads last 50 `messages` for `user.id` (`order created_at desc`, then reversed to oldest-to-newest); subscribes to `postgres_changes` `INSERT` on `public.messages` filtered `user_id=eq.${user.id}`; dedups by id; refetches on channel `SUBSCRIBED` (reconnect/history); `removeChannel` on unmount; pull-to-refresh via `RefreshControl`; renders read-only rows with user/assistant alignment + timestamps. Composer still disabled with the "Davos will speak first" placeholder (no `send-message`; AGENTS.md §2).
- `supabase/migrations/0011_realtime_messages.sql`: idempotently adds `messages` to the `supabase_realtime` publication (creates the publication if absent) — required for `postgres_changes` to fire.

### Notable / outstanding

- **All four changes uncommitted** (one migration + one new module are untracked).
- `lib/auth.tsx` `useAuth` `if (!context) throw` is unreachable (the context has a non-null default); also duplicates the root layout's own session tracking — consolidate.
- Still pending: §13 blocking checks (FR-10), `smoke_test` registration in TECH-SPECS §2.3 + GLOSSARY §12, the `FP-01-ACCEPTANCE.md` sweep and secret scan (Step 11).

---

## 2026-10-12 — FP-01 Step 11: doc write-backs + AC sweep (uncommitted)

**Changes:** new untracked `docs/feature-prds/FP-01-ACCEPTANCE.md`; modified `docs/GLOSSARY.md`, `docs/TECH-SPEC.md`. (`e4fc54a` committed the Step 10 auth context + Realtime thread.)
**Governing refs:** FP-01 FR-7, FR-10, AC-9, AC-10; FP-01PLAN.md Step 11; TECH-SPECS §2.3, §13; GLOSSARY §12; AGENTS.md §6.4, §6.6, §9; `docs/ULTIMATE-PRD1.md`.
**Status:** doc write-backs and the acceptance artifact are present; content rests on owner-reported verification (not independently reproducible from the diff).

### What was implemented (from the diff / new file)

- `docs/TECH-SPEC.md` §2.3: added `smoke_test` row (dev/manual; no-op success or forced failure) as the 15th job type.
- `docs/TECH-SPEC.md` §13: blocking assumptions 1–3 marked **VERIFIED 2026-10-11** with results — (1) Groq structured output **not** available on free tier → §4.1 degrade path (schema-in-prompt + single parse retry) becomes the FP-02+ path; (2) Realtime allowance — 200 peak connections, message quota near-zero at 5-user scale; (3) built-in SMTP magic-link arrival within 2–5 min (meets ≤5 min).
- `docs/GLOSSARY.md` §12: added `smoke_test` job-type entry.
- `docs/feature-prds/FP-01-ACCEPTANCE.md`: checklist marking **AC-1 … AC-11 all PASS** with evidence, plus code-quality/security notes, owner-manual items, and sign-off.

### Notable / outstanding

- **All three files uncommitted.**
- `docs/GLOSSARY.md` §12 header still reads "The complete **14**-type registry" while a 15th row was just added — header now stale (AGENTS.md §6.6 doc-consistency).
- AC-5 is marked PASS citing "initial pings successful", but its criterion requires a **24 h** cron-job.org green streak; the artifact is dated 2026-10-11, so the 24 h observation appears asserted rather than elapsed. Similarly AC-2/AC-4/AC-7/AC-11 evidence is owner-reported and not provable from the repo.
- §13 "VERIFIED 2026-10-11" dates are one day before this run (2026-10-12) — confirm the recorded dates match actual testing. FP-01's realtime/secret-scan completion otherwise looks consistent with the code now in the tree.

---

## 2026-10-14 — Auth rework (OTP code + dev-build OAuth), EAS config, docs restructure, FP-02 scoping (uncommitted)

**Changes:** uncommitted — modified `app/sign-in.tsx`, `lib/supabase.ts`, `app.json`, `package.json`, `package-lock.json`, `.gitignore`, `.expo/devices.json`; new `app/verify-code.tsx`, `eas.json`; docs restructured (old `docs/feature-prds/FP-01*.md` deleted → new `docs/feature-prds/FP-01/` + `docs/feature-prds/FP-02/`); new `PLAN.md`, `buffer.md`, `docs/GOOGLE_OAUTH_ANDROID_EXPO_GO_ISSUE.md`. (`2eed9d8` committed the Step 11 write-backs.)
**Governing refs:** FP-01 FR-3, AC-2, AC-3 (D25, TECH-SPECS §7.11); FP-02 scoping; AGENTS.md §2, §3.1, §6.6.
**Status:** refactor authored; no native round-trip verification recorded (this work targets the open FP-01 review gap G-01).

### What was implemented

- **Magic link → 6-digit OTP code.** `app/sign-in.tsx` now calls `signInWithOtp({ email, options: { shouldCreateUser: true } })` with **no `emailRedirectTo`** and pushes to a new `app/verify-code.tsx`, which calls `verifyOtp({ email, token, type: 'email' })` → `/(app)/chat` (plus resend). Removes the LAN/Expo-proxy/custom-scheme redirect machinery, the hardcoded `EXPO_USERNAME`, and `EXPO_PUBLIC_AUTH_REDIRECT_OVERRIDE`.
- **Google OAuth via dev build.** `signInWithOAuth({ provider:'google', options:{ redirectTo, skipBrowserRedirect:true } })` then `WebBrowser.openAuthSessionAsync(data.url, redirectTo)` → extract `code` → `exchangeCodeForSession(code)`; `redirectTo = makeRedirectUri({ scheme:'davos', path:'auth/callback' })` on native, `${origin}/auth/callback` on web. Adds `expo-web-browser` plugin.
- **Supabase client.** `lib/supabase.ts`: `flowType: 'pkce'`; `detectSessionInUrl: Platform.OS === 'web'` (false on native).
- **Build tooling.** `eas.json` added (development/preview/production profiles, `appVersionSource: remote`); `app.json` gains `android.package: com.anonymous.davos` and `extra.eas.projectId`; `package.json` android/ios scripts switched to `expo run:*` and adds `expo-auth-session`, `expo-dev-client`, `expo-web-browser`; `.gitignore` adds `android/`.
- **Docs.** `FP-01.md`/`FP-01PLAN.md`/`FP-01-ACCEPTANCE.md` moved into `docs/feature-prds/FP-01/` (content unchanged); new `FP-01/FP-01-REVIEW.md` records gaps **G-01** (native sign-in round-trips not evidenced; blocks FP-02) and **G-02** (24 h keep-alive not observed); new `FP-02/FP-02-PLAN.md` (11-step Chat Pipeline & Guardrails plan) + FP-02 PRD; `docs/GOOGLE_OAUTH_ANDROID_EXPO_GO_ISSUE.md` explains the Expo-proxy/custom-scheme failure and the dev-build fix; `PLAN.md`/`buffer.md` are working notes.

### Notable / outstanding

- **All changes uncommitted**; the old FP-01 paths show as deletions rather than staged renames.
- **FP-02 PRD is misnamed**: the file is `docs/feature-prds/FP-02/FP-01.md`, but its own header/`File` field say `docs/feature-prds/FP-02.md` — path/name mismatch.
- **Migration numbering collision**: FP-02-PLAN Step 1/4 propose `0010_config_fp02` and `0011_messages_client_id`, but `0010_cron_auth` and `0011_realtime_messages` already exist.
- G-01 is only *addressed* by this refactor, not verified (no iOS-Expo-Go/Android round-trip evidence yet); G-02 still open. Google Console redirect must be `<project>.supabase.co/auth/v1/callback`, with `davos://**` in the Supabase allowlist (owner manual).
- `.expo/devices.json` is tracked despite `.expo/` being gitignored — incidental local state.

---

## 2026-10-15 — FP-02 Step 1 (+ part of Step 2): provider adapter, config keys, `dev-smoke`, retrieval; tooling/tests (staged, uncommitted)

**Changes:** staged (`A`/`M` in index) — new `supabase/functions/_shared/llm/adapter.ts`, `supabase/functions/dev-smoke/{index.ts,config.toml}`, `supabase/migrations/0012_config_fp02.sql`, `0013_match_rules.sql`, `.prettierrc`, `eslint.config.js`, `app/__tests__/{SignInScreen,VerifyCodeScreen}.test.tsx`; modified `app/sign-in.tsx`, `app/verify-code.tsx`, `docs/GLOSSARY.md`, `docs/TECH-SPEC.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `PLAN.md`. (`87a5732` committed the auth rework.)
**Governing refs:** FP-02 FR-1, FR-2, FR-8, FR-9, FR-18 (partial); FP-02-PLAN Steps 0–2; TECH-SPECS §4.1–4.2, §5.2, §3.3, §11, §13; D5, D18; `docs/ULTIMATE-PRD1.md`.
**Status:** adapter/smoke authored; `dev-smoke` verification (embed=768, generate contains `tactical_analysis`+`direct_quote`, stub/force flags) not recorded as run. Pipeline stage (Step 3) not started.

### What was implemented

- **Provider adapter** `_shared/llm/adapter.ts`: `generate({system,messages,schema,tier})` → Gemini `gemini-3.5-flash-lite` primary (JSON Schema via `responseSchema`, `responseMimeType: application/json`, required-field validation) with Groq `openai/gpt-oss-120b` fallback (`response_format:{type:"json_object"}` + schema-in-system-prompt); `embed(texts[])` → `gemini-embedding-001` @768 (stamps `gemini-embedding-001@768`, D5). Reads `config` at runtime; honors `llm_stub_mode` (canned schema-valid response, zero network) and `llm_force_fail` (`none`/`primary`/`both`); structured per-call JSON log (provider, model, latency, ok, requestId).
- **Config** `0012_config_fp02.sql`: seeds three dev-only keys — `llm_stub_mode=false`, `llm_force_fail="none"`, `dev_overrides_enabled=true`.
- **Retrieval** `0013_match_rules.sql`: `match_rules(query_embedding vector(768), match_domain, match_count=5)` RPC (pgvector `<=>` order, granted to authenticated/service_role).
- **`dev-smoke` Edge Function** (`verify_jwt=false`, bearer-gated by `DEV_SMOKE_TOKEN`): actions `embed`, `generate`, `models` (lists Gemini/Groq models), `seed-rules`/`clear-rules` (`source_figure='PLACEHOLDER-DEV'`, one aggressive+empathetic pair at priority 80/70 in `Discipline/Habits`), `retrieve` (implements the §5.2 conflict filter inline — same-domain mixed tone within 15 priority → drop lower group), `pipeline` (**stub**, Step 3 pending).
- **Auth refinements**: `verify-code` stores/reads a pending email in AsyncStorage (`davos_pending_email`) as a fallback to the `?email=` param and clears it on success; `OTP_CODE_LENGTH = 6` constant; `sign-in` gates its log behind `__DEV__`.
- **Tooling/tests**: `.prettierrc`; `eslint.config.js` (`eslint-config-expo` flat, `no-console: warn`, ignores `supabase/functions/`); `package.json` scripts `test`/`lint`/`format` + `jest` config (`jest-expo`) and devDeps (`jest`, `jest-expo`, `eslint`, `prettier`, `@types/jest`); `tsconfig.json` `types: ["jest","node"]`; two screen test files.
- **Docs**: TECH-SPECS §4.1 pins both models by name; §7.11 auth now email-OTP; new §7.12 email-verification-flow; §11 registry adds `sync_degrade_reply`, `malformed_fallback_reply`, `llm_stub_mode`, `llm_force_fail`, `dev_overrides_enabled`, `job_dispatcher_url`; §13 item 1 re-VERIFIED **2026-10-15** (Groq JSON mode available on `openai/gpt-oss-120b`; JSON valid ≠ schema-conformant). GLOSSARY adds the `dev-smoke` function and the new config keys.

### Notable / outstanding

- **Everything is staged, not committed**; docs write-backs are included in the same change (good), but no verification results are recorded.
- **`seed-rules` deviates from FP-02-PLAN Step 2**: it writes synthetic `Math.sin(...+Math.random())` vectors instead of embedding via `llm.embed`, and `upsert`s fresh UUIDs so each call inserts new rows (no idempotent re-seed).
- **Retrieval placement deviates**: the plan's `_shared/pipeline/retrieveRules.ts` module wasn't created — retrieval + conflict filter live inside `dev-smoke` (client of the new `match_rules` RPC).
- `match_rules` is `security definer` without `set search_path` — same hardening gap previously fixed on `claim_jobs`.
- adapter nits: `embed()` stub mode returns a single vector regardless of `texts.length`; `callGroq` declares an unused `messages` const; adapter throws at import when `GEMINI_API_KEY`/`GROQ_API_KEY` are absent.
- **Tests don't render the screens** — they mock `supabase` and re-implement the logic (incl. a local `isValidCode`), so they assert against mocks rather than exercising `SignInScreen`/`VerifyCodeScreen`.
- Migration numbering now uses `0012`/`0013`, avoiding the `0010`/`0011` collision noted in the FP-02 plan.

---

## 2026-10-15 — FP-02 Step 2: retrieval module, placeholder rules, conflict-window config (uncommitted)

**Changes:** untracked `supabase/functions/_shared/config.ts`, `_shared/dev/placeholderRules.ts`, `_shared/pipeline/retrieveRules.ts`, `supabase/migrations/0014_conflict_priority_window.sql`; modified `supabase/functions/dev-smoke/index.ts`, `docs/TECH-SPEC.md`, `docs/GLOSSARY.md`, `docs/feature-prds/FP-02/FP-02-PLAN.md`. (`c71d648` committed Step 1; `7b7bbe8` committed the Step 1 PROGRESS entry.)
**Governing refs:** FP-02 FR-8, FR-9, AC-5; FP-02-PLAN Step 2; TECH-SPECS §5.2, §2.3, §11; AGENTS.md §2, §8.4; `docs/ULTIMATE-PRD1.md`.
**Status:** implements the Step 1 leftovers flagged earlier; seed→retrieve→filter verification (conflict domain yields one tone group, `clear-rules` empties) not recorded as run.

### What was implemented

- `_shared/config.ts` (new shared helper): exports `supabaseService` (service-role client) plus `getConfig(key)` and `getConfigNumber(key)` — the latter throws when a `[SPEC]` key is missing/non-numeric rather than defaulting in code (AGENTS.md §2).
- `_shared/pipeline/retrieveRules.ts` (new — resolves the earlier placement deviation): pure `applyConflictFilter(rules, window)` (group by tone; both aggressive+empathetic present and group-max priorities within `window` → drop lower group, tie keeps aggressive) and `retrieveRules({domain, messageEmbedding, matchCount})` which reads `conflict_priority_window` via `getConfigNumber`, calls the `match_rules` RPC, maps to a lean shape (drops the 768-float embedding), and applies the filter.
- `_shared/dev/placeholderRules.ts` (new): 9 `PLACEHOLDER-DEV`-labeled rules across `Discipline/Habits` (the crafted conflict fixture: aggressive 80 / empathetic 70, gap 10 ≤ window), `Career`, and `Fitness` (all other tone gaps > 15 so the filter must not fire); `PLACEHOLDER_SOURCE_FIGURE`/`PLACEHOLDER_EMBED_MODEL` constants.
- `dev-smoke` `seed-rules` rewritten: deletes prior placeholder rows first (idempotent re-seed) then embeds all rule texts in one batched `llm.embed` call and inserts — replacing the earlier synthetic `Math.sin(+random)` vectors and non-idempotent upserts. `retrieve` now delegates to `retrieveRules` and returns `window`/`droppedTone`.
- `0014_conflict_priority_window.sql`: seeds config key `conflict_priority_window = 15` (§5.2 `[SPEC]`).
- Docs: TECH-SPECS §5.2 + §11 registry now express the window as a config key; GLOSSARY "Conflict filter" definition and the §16 config-key list updated; FP-02-PLAN tracker marks Steps 0/1 ✅ and Step 2 ▶ (in progress).

### Notable / outstanding

- **Uncommitted** (one migration + three modules untracked).
- Adapter interaction: with `llm_stub_mode=true`, `embed()` returns a single vector, and `seed-rules` now asserts `vectors.length === rules.length` → seeding fails in stub mode (stub mode is intended for generate/UI iteration, not retrieval).
- `applyConflictFilter` is pure and unit-testable but no tests were added for it (AC-5 relies on live `dev-smoke` verification).
- `match_rules` still lacks `set search_path` (unchanged from 0013); Step 2 marked in-progress, Step 3 (pipeline stages + guardrails prompt) not started.

---

## 2026-10-15 — FP-02 Step 3: full 5-stage pipeline + guardrails prompt v1; Step 2 review fixes (staged)

**Changes:** staged (`A`/`M` in index) — new `_shared/pipeline/{extract,classify,persona,generate,runPipeline}.ts`, `_shared/prompts/guardrails.ts`, `_shared/types/pipeline.ts`, `supabase/migrations/0015_llm_stub_malformed.sql`; modified `_shared/llm/adapter.ts`, `_shared/pipeline/retrieveRules.ts`, `_shared/config.ts`, `_shared/dev/placeholderRules.ts`, `dev-smoke/index.ts`, `migrations/0014_conflict_priority_window.sql`, `docs/{TECH-SPEC,GLOSSARY}.md`, `docs/feature-prds/FP-02/FP-02-PLAN.md`; untracked `REVIEW.md`, `repair_prompt.md`, `docs/feature-prds/FP-02/STEP3-PROVIDER-DIFFS.md`. (`1f4acae` committed Step 2.)
**Governing refs:** FP-02 FR-3, FR-7, FR-12, FR-13, AC-1, AC-2; FP-02-PLAN Steps 2–3; TECH-SPECS §4.1–4.3, §5.1–5.4, §6.3, §13.1; D7, D8, D13, D18, D21; PRD §3.0; AGENTS.md §2, §4.6, §5.1–5.3, §8.4.
**Status:** stages 1–5 implemented and dev-smoke runnable; `STEP3-PROVIDER-DIFFS.md` records an 8-run provider test (PASS on both providers). Pipeline not yet wired to a user-facing endpoint (Step 4 pending).

### What was implemented

- **Stage 1 extraction** (`extract.ts`): the full §4.3 contract (`intent_flags`, `openness_delta` −5..5, `topic`) via `generate<ExtractionResult>` with its own `isExtractionResult` validator; failure is non-fatal. Fields are carried but not consumed in FP-02.
- **Stage 2 classifier** (`classify.ts`): deterministic stub (FR-7) emitting the §6.3 shape (`domain`, `domain_conf`, `emotion`, `emotion_conf`, `quit_signal=false`, `overall_conf=min`) — no LLM/embedding; FP-03 swaps it in place. Dev-only `ClassifyOverrides`.
- **Stage 4 persona** (`persona.ts`): three-tier routing off `config.confidence_bands` shifted by `persona_stats.band_shift` (D8), clamped ±0.10; D7 fallback (`domain=General`, persona `inquirer`) when a label is missing or below the low band; `EMOTION_PERSONA` marked **PLACEHOLDER-DEV** (no emotion→persona mapping exists in any source doc). LOCKDOWN (D21) deliberately not implemented.
- **Stage 3 retrieval** (`retrieveRules.ts`): delegates to `match_rules`, drops the 768-float embedding, applies the pure `applyConflictFilter`; types moved to `_shared/types/pipeline.ts` (resolves review MIN-001).
- **Stage 5 generation** (`generate.ts` + `prompts/guardrails.ts`): builds the system prompt (persona definition, injection guard, route variant, rules, few-shot exemplars), calls the adapter with `GENERATION_SCHEMA`, applies **exactly one** bounded retry then `config.malformed_fallback_reply`; `ui_metadata.persona_options` is structurally dropped on every non-`options` route. `guardrails.ts` holds the relentlessly-human persona definition, `INJECTION_GUARD`, three **PLACEHOLDER-DEV** few-shot pairs, the four `ROUTE_VARIANTS`, `PERSONA_KEYS`/voices, and the anchored schema.
- **Orchestrator** (`runPipeline.ts`): stage 1 ∥ stage 2 (message embed kicked off concurrently) → stage 4 → stage 3 → stage 5; PURE w.r.t. DB writes (persistence deferred to Step 4). Documents and implements the deliberate **stage-4-before-stage-3** order so the D7 `General` fallback retrieves no aggressive rules.
- **Adapter** (`adapter.ts`): `generate<T>({...,validate})` generic with per-call validator (defaults to `isGenerateResponse`); new `llm_stub_malformed` path makes stub mode return invalid JSON to exercise the §4.2 retry; stub mode rejects a payload its caller's validator refuses.
- **`dev-smoke`**: `pipeline` action now real (routes through `runPipeline`; `force` maps to `overall_conf` from live `confidence_bands`, `domain`/`emotion` overrides); added `models` action.
- **Step 2 review fixes folded in**: `getConfigNumber` now throws on a `null` value (CR-001); `0014` documented that `'15'` parses as JSON number 15 (bare `15` fails the jsonb cast) (CR-002); `retrieveRules` keeps the service-role client with a comment justifying it (`match_rules` is `security definer`, `anon` holds no grant) (MAJ-001); shared types extracted (MIN-001).
- **Docs/artifacts**: TECH-SPECS §4.1 (generic adapter), §5.1 (stage-4→3 domain hand-off), §11 (`llm_stub_malformed`); GLOSSARY route-variant + `routeInfo` + persona-route enum + config-key list; FP-02-PLAN Steps 0–2 ✅ / Step 3 ▶; `STEP3-PROVIDER-DIFFS.md` (0 "As an AI"/filler across 8 runs; fallback retrieved 0 rules on both providers); user-supplied `REVIEW.md` + `repair_prompt.md` at repo root.

### Notable / outstanding

- **All staged, not committed**; the Step 2 review fixes are squashed into this Step 3 changeset rather than a separate repair commit.
- **Groq JSON-mode enum drift** (`STEP3-PROVIDER-DIFFS.md` finding 2): Groq returned `persona_options[].key` values outside `PERSONA_KEYS`; `select-persona` (Step 6) would be unable to map such chips. Logged for the §14 step-11 hardening pass — not resolved.
- AC-2 remains a qualitative gate (8 runs is a small sample; the 10-turn conversation check is deferred).
- `runPipeline` embed failure throws (no degrade path) — acceptable pre-Step-4; stage 5 degrade covers parse failures only.
- `REVIEW.md`/`repair_prompt.md` sit at the repo root (not under `docs/`) — likely transient working artifacts.
- Still open from earlier: `match_rules` lacks `set search_path`; `dev-smoke` `seed-rules` can't run under `llm_stub_mode`.
