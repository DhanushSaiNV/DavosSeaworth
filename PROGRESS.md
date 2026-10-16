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

---

## 2026-10-15 — FP-02 Step 4: `send-message` wiring + message dedupe schema (staged)

**Changes:** staged (`A`/`M`) — new `supabase/functions/send-message/index.ts`, `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/dev/overrides.ts`, `supabase/migrations/0016_messages_client_id.sql`; modified `dev-smoke/index.ts`, `docs/TECH-SPEC.md`, `docs/GLOSSARY.md`, `docs/feature-prds/FP-02/FP-02-PLAN.md`. (`5e03547` committed Step 3; `c00f1f8` committed REVIEW.md; `904ae69` the progress write-back.)
**Governing refs:** FP-02 FR-4, FR-5, FR-12, FR-16; FP-02-PLAN Step 4; TECH-SPECS §3.2, §5.1, §7.10, §7.11; D23; AGENTS.md §2, §4.1, §4.3.
**Status:** handler + dedupe schema authored; the Step-4 curl verification (round-trip rows, duplicate replay = no second reply, no-auth 401) not recorded.

### What was implemented

- **`send-message` Edge Function** (new, user-scoped): resolves the user via `resolveUserId`, validates input (`content` non-empty ≤ `MAX_CONTENT_LENGTH`=8000, `client_message_id` uuid, optional ISO `client_sent_at`), then `upsert(userRow, {onConflict:'user_id,client_message_id', ignoreDuplicates:true}).select('id')`; zero rows returned = duplicate → locate the existing user row, find its assistant reply via `metadata->>user_message_id`, return `{status:'duplicate'}` and **skip the pipeline**. Otherwise runs `runPipeline`, logs `tactical_analysis` server-side only, inserts the assistant row via service role (`content = direct_quote`, `metadata = {persona, route, domain, rule_ids, persona_options?, source:'pipeline', user_message_id}`), returns `{user_message_id, assistant_message_id, status:'ok'}`. Dev overrides are honored only when `config.dev_overrides_enabled === true`.
- **`_shared/auth.ts`** (new): `resolveUserId(req)` — reads the bearer token and re-verifies it through an anon-client `auth.getUser(jwt)`; returns typed `AuthOutcome` (401 missing/invalid, 500 unconfigured). Defense-in-depth for a function deployed `--no-verify-jwt`.
- **`_shared/dev/overrides.ts`** (new): extracts `forceToConf`/`overridesFromForce` from `dev-smoke` so `send-message` (and Step 6) share one dev-override path; thresholds derive from live `confidence_bands`.
- **`0016_messages_client_id.sql`**: adds `messages.client_message_id uuid` (NULL on assistant rows) + plain unique index `(user_id, client_message_id)` (deliberately not partial, so PostgREST's `on_conflict` inference is unambiguous; NULLs are distinct so assistant rows never collide).
- **Docs**: TECH-SPECS §3.2 schema + a "Message dedupe (FR-16, D23)" note; GLOSSARY `messages` row, `ui_metadata`, and new `client_message_id` entry; FP-02-PLAN Step 3 ✅ / Step 4 ▶, migration renumbered `0011`→`0016`, and the Step-4 deferred list recorded (orphan window → Step 8; per-stage timeouts/deadline → Step 8/11; `dev_overrides_enabled=false` in prod; push deferred to Step 7). Step 6 text now requires `select-persona` to fetch the original text/domain server-side from `user_message_id`.

### Notable / outstanding

- **All staged, not committed.**
- **Orphan-turn window is explicit and deferred**: if the invocation dies between the user insert and the assistant insert, a retry is classified `duplicate` and the turn is never auto-repaired; the code comment and the plan hand this to Step 8.
- `send-message` ships **no `config.toml`**, so it relies on the deploy-default `verify_jwt=true` (only `dev-smoke` and `health` carry config.toml). Correct today, but it means the JWT gate lives in deployment defaults, not in-repo.
- `MAX_CONTENT_LENGTH = 8000` is hardcoded — it is not a `[SPEC]` key and no doc governs it, so it isn't a config-§2 violation, but the limit is unregistered and undocumented.
- `console.log(tactical_analysis)` is unconditional (intended: server log only, never persisted/returned per §4.3).
- The duplicate branch finds the reply via a JSON-path `.eq('metadata->>user_message_id', …)` filter; assistant rows carry `user_message_id` in metadata (documented in GLOSSARY).

---

## 2026-10-15 — FP-02 Step 5a: primary-reply guard + repair-on-duplicate (staged)

**Commit:** (pending)
**Governing refs:** FP-02 FR-5, FR-16; FP-02-PLAN Step 5a; TECH-SPECS §3.2, §5.1, §7.10, §11; D23; AGENTS.md §2, §4.1, §4.3.
**Status:** implemented, migration applied, function deployed, verification run (all gates green).

### What was implemented

- **`0017_primary_reply_guard.sql`**: `messages.reply_to_message_id uuid` (deliberately **no FK** — account deletion removes a user's parent and child rows in one statement, which immediate FK enforcement can reject); a guarded backfill from `metadata.user_message_id` that **shape-checks the uuid and takes only the earliest assistant row per user message** (so the unique index always builds); partial unique index `messages_one_primary_reply on messages (reply_to_message_id) where reply_to_message_id is not null` (no `user_id` — the indexed value is a user row's globally-unique pk); config key `chat_max_message_chars` (8000).
- **`send-message`**: duplicate branch now looks up the primary reply by `reply_to_message_id`. Found → `{status:'duplicate', assistant_message_id}`. Not found → **repair**: re-run stages 1–5 from the **stored** user row content (never the request body) and insert with `reply_to_message_id` set → `{status:'ok'}`. Both insert paths go through `insertPrimaryReply`, which catches Postgres **`23505`** (a concurrent invocation won) → SELECT the winner → `duplicate` + a distinct `console.warn` so wasted pipeline runs are measurable. `content` length cap now read from `config.chat_max_message_chars` (the old hardcoded `MAX_CONTENT_LENGTH` is gone). Deliberately a plain INSERT, not PostgREST `on_conflict` (which targets a column list and does not reliably target an expression/partial index).
- **Docs**: TECH-SPECS §3.2 adds the column + index + a "primary vs secondary reply" note; §5.1 adds the repair-on-duplicate paragraph; §7.10 adds the send contract; §11 registers `chat_max_message_chars`; GLOSSARY §6 adds Primary/Secondary reply + Repair-on-duplicate, §11 updates `messages`, §15 adds `reply_to_message_id`, §16 adds the config key; FP-02-PLAN splits Step 5 into 5a/5b (Step 4 ✅), rewrites both verifies, moves the orphan-turn sentence out of Step 8 into 5a, and records the Step 6 secondary-reply schema obligations; PROGRESS.md (this entry).

### Verification (against the linked project, throwaway JWT user, deleted after)

- Duplicate on an answered turn → `status:'duplicate'`, same `assistant_message_id`, still one assistant row (pipeline skipped).
- **Repair**: orphan user row inserted directly (the state a died invocation leaves), POSTed with a **different** body content → `status:'ok'`, exactly one assistant row with `reply_to_message_id` set, and the reply's text corresponds to the **stored** content, not the body.
- **Race**: two simultaneous POSTs at a fresh orphan → exactly one assistant row; one `ok`, one `duplicate`; **both returned the same `assistant_message_id`**.
- `chat_max_message_chars` read at runtime: set to 10 → a 20-char body rejected 400 ("content exceeds 10 characters") → restored to 8000 → a 9000-char body rejected 400 ("content exceeds 8000 characters").
- `tactical_analysis` leak check = 0 rows (content or metadata); backfill check = 0 assistant rows with `metadata ? 'user_message_id'` and `reply_to_message_id is null`; index present with the exact partial definition.
- Test user deleted; cascade verified (0 rows).

### Notable / outstanding

- **Resolves the Step-4 note on the unregistered limit**: the cap is now `config.chat_max_message_chars` (documented in TECH-SPECS §11 / GLOSSARY §16).
- **Resolves the Step-4 orphan-turn note**: the window is repaired at write time; the code comment claiming it was Step 8's problem is gone.
- **`llm_force_fail` cannot produce a server error**: stage 5 degrades to `config.malformed_fallback_reply` (§4.2 bounded-retry fallback) and still returns `ok`, so the orphan window only opens when the invocation dies after the user insert. Recorded in the plan's 5a verify note. **Step 8 impact:** the degrade path must distinguish "structural parse fallback after the bounded retry" from "adapter/provider failure" — today both surface as `degraded: true` with no reason field, so an adapter outage silently renders the malformed fallback reply instead of `sync_degrade_reply` + an `llm_retry` job.
- Leftover `smoketest@example.com` test user (4 messages) remains in the DB from earlier verification — pre-existing, not created by this step; its pre-0017 assistant rows are the real-data proof that the backfill works.
- `supabase/functions/_shared/llm/adapter.ts:245` unused `const messages` remains (pre-existing Deno lint warning, untouched).

---

## 2026-10-15 — FP-02 Step 5b: composer + Realtime render + client thread logic (staged)

**Commit:** (pending)
**Governing refs:** FP-02 FR-5, FR-16, FR-17; FP-02-PLAN Step 5b; TECH-SPECS §3.2, §7.10, §9, §11; D1, D23; AGENTS.md §2, §7.1.
**Status:** implemented; `tsc --noEmit` clean; jest 4 suites / 26 tests pass; migration applied; the client config path verified over REST. Repair pass applied (see the close of this entry).

### What was implemented

- **`0018_config_chat_client.sql`**: `chat_send_timeout_ms` (90000), `chat_realtime_watchdog_ms` (8000), `chat_retry_holdoff_ms` (150000), `chat_last_n` (50) — the client's [SPEC] values (quoted → jsonb numbers).
- **`lib/ids.ts`** (new): `makeClientMessageId()` — RFC 4122 v4 over `expo-crypto`'s `getRandomValues` (native CSPRNG on device, Web Crypto on web). No `Math.random` fallback; `expo-crypto ~57.0.4` is a new dependency (native module → the dev client must be rebuilt).
- **`lib/config.ts`** (new): memoized `config` reader. `loadConfig()` fetches `select key, value` once (idempotent; a transient failure is retried 3× with 1 s/2 s/4 s backoff before the snapshot becomes `error`); `useConfig()` exposes `{status, error}` through `useSyncExternalStore`; `requireConfigNumber`/`requireConfigString` **throw** instead of defaulting. `parseConfigRows`/`coerceConfigNumber` are exported as pure helpers.
- **`lib/chat.ts`** (new; no React or React Native imports, so it is unit-testable): `Message` (now carries `client_message_id` + `reply_to_message_id`), `sortMessagesAsc` (ordering truth = `client_sent_at ?? created_at`), `dedupeAssistantRows`/`visibleRows` (primary-reply dedupe; secondary replies always render), `unansweredUserRows` (orphan detection that excludes turns still in flight), `mergeRows` (Realtime insert / watchdog / refetch merge — idempotent), `pruneResolvedPending`, `buildChatItems` (visible server rows + optimistic bubbles, with holdoff-gated `canRetry`), `nextRetryAt`, `classifyError` (401→auth, 4xx→client, 5xx→server, no status→network), `retryDelayFor`.
- **`lib/chat.test.ts`** (new): 7 tests — error buckets + retry delay, ordering truth, primary/secondary dedupe, idempotent merge, optimistic→durable transition, orphan holdoff gating, uuid shape/uniqueness.
- **`app/(app)/_layout.tsx`**: kicks off `loadConfig()` once for the whole signed-in app.
- **`app/(app)/chat.tsx`**: composer enabled; optimistic bubble keyed by `client_message_id`; `client_sent_at` captured at the Send tap and resent unchanged on Retry; "Davos is thinking…"; renders from Realtime with the primary/secondary dedupe and `keyExtractor = client_message_id ?? id`; watchdog re-select by `assistant_message_id`; failed bubble with holdoff-gated Retry (no Retry on auth); auth and config banners (config banner offers Retry); refetch the newest `chat_last_n` rows on connect/reconnect/`CHANNEL_ERROR`/foreground; orphan-on-reload self-heal; input capped by `chat_max_message_chars`.
- **Fixed a pre-existing bug in `fetchMessages`**: it took the **OLDEST** 50 (`.order('created_at', ascending: true).limit(50)`), so a thread longer than 50 silently dropped the newest messages. Now newest-first, then ordered ascending for render.
- **Docs**: TECH-SPECS §7.10 (client render / client config / failure handling), §9 (runtime config), §11 (five keys); GLOSSARY §8 (optimistic bubble, primary/secondary dedupe, watchdog re-select, retry holdoff) + §16 key list; FP-02-PLAN Step 5b ▶ and module names aligned with the code.

### Verification

- `npx tsc --noEmit` → exit 0.
- `npx jest --ci` → 4 suites, 26 tests passed (12 pre-existing + 7 chat + 7 config).
- `npx eslint lib app` → 0 errors (warnings only, all pre-existing patterns).
- `npx expo export --platform web` → bundled OK (dist deleted afterwards).
- Migration `0018` applied; all five `chat_*` keys are jsonb **numbers** (50 / 8000 / 8000 / 150000 / 90000).
- Client config path exercised over REST with the **anon** key: `GET /rest/v1/config?select=key,value&key=eq.chat_last_n` → 200 `[{"key":"chat_last_n","value":50}]` (migration 0001 grants `select` on `config` to `anon, authenticated`; `config` has no RLS).

### Notable / outstanding

- **On-device verification is the owner's** (`npx expo start`): type → bubble → thinking → reply; network drop mid-send → failed bubble → Retry after the holdoff → single reply; reload shows one user row + one reply; a thread longer than `chat_last_n` shows the newest `chat_last_n`.
- One in-flight send per device (the `thinking` state gates the Send button). A second device can still hold its own in-flight send; `messages_one_primary_reply` keeps exactly one primary reply.
- The "slow / unknown outcome" UI state was deliberately not built (out of scope for 5b).
- `retryDelayFor` gives 4xx a fixed 3 s anti-spam holdoff rather than 0. The bubble still offers Retry, which is harmless because the same `client_message_id` is reused and the server dedupes.

### Repair pass (review findings)

- **MIN-001** — `lib/ids.ts` now uses `expo-crypto`'s `getRandomValues`; the `Math.random` fallback is gone. New dependency `expo-crypto ~57.0.4`; it is a native module, so a dev-client rebuild is required (`npx expo run:android` / EAS) before native runs pick it up.
- **MIN-002** — `loadConfig()` retries 3× with 1 s/2 s/4 s backoff before reporting `error`.
- **MIN-003** — `retryDelayFor("client", …)` = 3000 ms.
- **MIN-004** — `CHAT_LAST_N` removed; the page size is the new `chat_last_n` [SPEC] key. `fetchMessages` needs `limits`, so the subscription effect re-runs once config resolves; a config failure clears the spinner so the banner stays reachable.
- **MIN-005** — the BG-01 content-drafting rule is now quoted into AGENTS.md §8.4.
- **NIT-004** — `lib/config.test.ts` (new, 7 tests) covers `parseConfigRows` / `coerceConfigNumber`.
- `lib/chat.test.ts` mocks `expo-crypto` (the jest preset stubs native modules to constants) so the uuid uniqueness assertion stays meaningful.
- **NIT-002/NIT-003**: `REVIEWER.md` kept (it is the reusable review-tool template, not a project artifact); `.expo/devices.json` untracked (`git rm --cached`), leaving `.expo/README.md` tracked.
- 0018 was already recorded as applied remotely, so `chat_last_n` was inserted against the linked DB by hand; a fresh `db reset`/remote replays it from the migration.

---

## 2026-10-15 — FP-02 hotfix: `send-message` CORS preflight (staged)

**Governing refs:** FP-02 FR-4, FR-5; TECH-SPECS §7.10; D23; AGENTS.md §4.1.
**Symptom (web):** `Request header field x-client-info is not allowed by Access-Control-Allow-Headers in preflight response` → `net::ERR_FAILED`; the send never reached the function.

### Cause

`send-message`'s `Access-Control-Allow-Headers` listed only `Content-Type, Authorization, apikey`. `supabase-js` attaches `X-Client-Info: supabase-js/<version>; runtime=web` to every request through its global headers, so the browser rejected the preflight. Native skips the preflight, which is why this only ever showed up on web.

### Fix

`supabase/functions/send-message/index.ts`: add `x-client-info` to `Access-Control-Allow-Headers`.

### Verification

- Preflight sent exactly as the browser sends it (`Origin: http://localhost:8081`, `Access-Control-Request-Headers: authorization,apikey,content-type,x-client-info`) → `204` with `access-control-allow-headers: Content-Type, Authorization, apikey, x-client-info`.
- Real `POST` carrying that `Origin` and `x-client-info` with a fresh user JWT → `200 {"user_message_id": …, "assistant_message_id": …, "status":"ok"}`, CORS headers present on the response.
- Both rows inspected: the assistant row's `reply_to_message_id` points at the user row (§5.1 primary-reply guard) and the user row carries `client_message_id`. The test turn was then deleted, leaving that user's thread empty.
- `npx tsc --noEmit` / `npx jest --ci` / `npx eslint .` unaffected (Deno code sits outside the TS project and the eslint config).

### Follow-up

- `health` and `dev-smoke` also omit `x-client-info`. Neither is invoked from the browser (a cron ping and curl respectively), so they were left unchanged.
- TECH-SPECS §7.10 now records the required allow-headers.
- **Owner action still open:** rotate the project `service_role` key; it was read from the project's API keys during this verification and has not been rotated since it was first exposed.

---

## 2026-10-15 — FP-02 Step 6: tier-routing chips + `select-persona` + dev forcer (staged)

**Commit:** (pending)
**Governing refs:** FP-02 FR-7, FR-10, FR-11; FP-02-PLAN Step 6; TECH-SPECS §3.2, §5.1, §5.3, §7.10, §11; D13, D23; AGENTS.md §2 (§[SPEC] from `config`), §4.1 (service-role writes in Edge Functions only), §4.3 (`tactical_analysis` server-only), §5.1 (no regex on LLM output).
**Status:** implemented and verified against the linked project; `tsc --noEmit` clean; jest 5 suites / 35 tests pass; eslint 0 errors; migration `0019` applied; `select-persona` deployed.

### What was implemented

- **`0019_chat_secondary_reply.sql`** (new): `messages.persona_key` + `messages.secondary_reply_to_message_id`, plus `messages_one_secondary_reply` — a partial unique index on the anchor. A secondary reply must leave `reply_to_message_id` NULL (§3.2), so it cannot reuse the primary guard; the index makes one chip tap consume the whole option set (FR-11).
- **`_shared/pipeline/runPipeline.ts`**: `runLockedPersonaReply()` — stages 3–5 for an already-chosen persona (embed → retrieve for the decided domain → generate). Stages 1–2 and stage 4 are skipped: the user's choice *is* the routing decision. Generation runs the **`auto`** route variant, so the turn answers directly and never offers options again. Pure w.r.t. DB writes, like `runPipeline`.
- **`select-persona/index.ts`** (new): JWT-scoped; body `{message_id, persona_key}` (ids only). Validates the key against **that** message's own `persona_options` *and* the persona-key enum — Groq JSON mode does not enforce the response's `key` enum (§4.1, AGENTS.md §8.1). Reads the user's text and the domain from **server state** (`reply_to_message_id` → the user row; `metadata.domain`), never from the body. Writes the secondary reply with `reply_to_message_id` NULL, `persona_key`, `secondary_reply_to_message_id`, and `metadata.source = 'pipeline_secondary'`; Postgres `23505` → `duplicate` with the winner's id. CORS allow-headers include `x-client-info` (the Step-5b hotfix lesson).
- **`lib/chat.ts`**: `Message` gains `persona_key` / `secondary_reply_to_message_id` (optional, so pre-0019 rows and fixtures stay valid); new `personaOptionsOf()` (shape-checked chips) and `personaChoices()` (user-message id → chosen key); `buildChatItems` now attaches `personaOptions` + `chosenPersonaKey` to assistant items.
- **`app/(app)/chat.tsx`**: chips render under the assistant bubble; the whole set disables while a tap is in flight and permanently once consumed, with the chosen chip highlighted. The tap posts to `select-persona` and re-uses the existing watchdog re-select; `thinking` now also covers an in-flight chip tap.
- **`lib/devOverrides.ts`** (new) + **`app/(app)/settings.tsx`**: device-local tier (`none|high|medium|low|fallback`) + free-text domain forcer, behind two independent gates — a dev build and `dev_overrides_enabled` (the server re-checks the flag itself). Attached to `send-message` as `dev_force` only when something is actually pinned.
- **`lib/config.ts`**: `coerceConfigBoolean` / `requireConfigBoolean` — a boolean flag reader that fails closed (only a real JSON `true` enables the surface).
- **Docs**: TECH-SPECS §3.2 (new columns, the secondary guard, primary/secondary paragraph), §5.3 (chip re-run contract), §7.10 (`select-persona` contract, client chips, dev forcer, CORS now covering both functions); GLOSSARY §6, §8 (persona chips, dev forcer), §11, §13, §14 (persona key enum), §15; FP-02-PLAN Step 6 ▶.

### Verification

- Gates: `npx tsc --noEmit` → exit 0; `npx jest --ci` → 5 suites / 35 tests (26 + 9 new: 2 chips, 2 config boolean, 5 dev-override); `npx eslint .` → 0 errors.
- Migration `0019` applied; both columns and `messages_one_secondary_reply` confirmed present on the linked project.
- `select-persona` deployed. Preflight sent exactly as the browser sends it → `204` with `access-control-allow-headers: Content-Type, Authorization, apikey, x-client-info`.
- **End-to-end** (throwaway JWT): forced **Medium** → the reply carried 2 chips (`mentor_tough`, `therapist_empath`). Tapping `therapist_empath` → `200 {"status":"ok"}`; the secondary row has `reply_to_message_id` **NULL**, `persona_key = therapist_empath`, `secondary_reply_to_message_id` = the user message, `metadata.route = options`, `metadata.source = pipeline_secondary`, and content written in the chosen voice.
- **Consumption / idempotency**: repeat of the same key → `duplicate`; a **different** key → `duplicate` (the set is spent, so the whole set disables); key not offered → `400`; a user-message id → `400`; no bearer token → `401`.
- **AC-4 routes**: force `fallback` → `route=fallback`, `domain=General`, `persona=inquirer`, reply is the clarifying question; force `low` → `route=low_question`, reply is the explicit interaction-mode question. Neither carries `persona_options`.
- **Flag gate**: with `dev_overrides_enabled=false`, a forced `fallback` produced `route=auto` / `Career` / `mentor_tough` — the override was ignored end-to-end. The flag was restored to `true` immediately afterwards (verified).
- Test turns deleted (that user's thread is back to 0 rows). Guard checks: 0 rows with `persona_key` on a non-assistant row; 0 rows carrying both anchors.

### Notable / outstanding

- **Push is deliberately not wired here** — `select-persona` writes the row and Realtime renders it. FR-15/Step 7 adds the `_shared/push.ts` call to both `send-message` and `select-persona` (Step 7 already names both call sites).
- **`metadata.route = 'options'`** on the secondary reply, not `auto`: generation ran the `auto` *variant* because the persona was locked, but the **tier** that produced the turn is Medium. Recording `auto` would make Step 10's `auto_adopt_successes` detector count a deliberate chip choice as an accepted suggestion (§5.4), which is backwards.
- The `user_overrides` decrement path stays out of scope (FP-02 §2: owner decision) — Step 6 records the choice but does not touch `persona_stats`.
- No new `[SPEC]` config keys, so GLOSSARY §16 is unchanged.
- On-device verification is the owner's: chips render under the question, the tapped chip highlights, the set disables, the reply lands in that persona, and a second tap does nothing.
- The `therapist_empath` sample reply read noticeably more generic than the `mentor_tough` one — that is AC-2 persona-voice quality (prompt v1, owner sign-off still pending), not a Step 6 defect.
- Pre-existing owner items are unchanged: emotion→persona map sign-off, the `runPipeline` stage-4-before-3 ordering deviation, and the `service_role` key rotation.

---

## 2026-10-15 — FP-02 Step 7: Expo push — registration + server send + suppression

**Commit:** (pending)
**Governing refs:** FP-02 FR-15; FP-02-PLAN Step 7; TECH-SPECS §7.10, §8, §11; D23; AGENTS.md §2, §3.1, §4.1.
**Status:** implemented; Android E2E blocked on owner FCM credential setup (below).

### What was implemented

- **`lib/push.ts`** (new): client token registration. **Android only in beta** — `registerPushToken(userId)` requests permission → creates Android channel `default` → gets the Expo push token → upserts to `push_tokens` (platform `android`). iOS and Web log and skip: iOS remote push needs the Apple Developer Program ($99/yr — $0 budget, TECH-SPECS §13), and Expo's push service does not support web (on web `getDevicePushTokenAsync` returns a Web-Push subscription, not an `ExpoPushToken`). `configureNotificationHandler(isChatFocused)` installs foreground suppression.
- **`supabase/functions/_shared/push.ts`** (new): server-side push sender. Raw `fetch` POST to `https://exp.host/--/api/v2/push/send` (Deno-safe, no SDK). Collapse key `chat_{userId}` groups AI messages per conversation. Priority `default` for AI replies; `high` reserved for interventions/Strikes. Deep link `davos://chat`. Receipt handling: async check on `InvalidCredentials` / `DeviceNotRegistered` → delete **only the errored token** via ticketId→token map. Helpers `createAiMessagePushPayload` / `createHighPriorityPushPayload`.
- **`send-message/index.ts`**: imports `sendPush` + `createAiMessagePushPayload`; awaits push with 5 s bounded timeout after primary reply insert.
- **`select-persona/index.ts`**: same push wiring after secondary reply insert.
- **`app/(app)/chat.tsx`**: imports `configureNotificationHandler`; `useFocusEffect` sets up the handler that suppresses OS banner/sound/badge **only while the chat tab is focused** (Realtime delivers instead). Other tabs still notify.
- **`app/(app)/_layout.tsx`**: calls `registerPushToken(user.id)` once per authenticated session.
- **`app.config.js`** (new): extends `app.json`, declaring `android.googleServicesFile` **only when `google-services.json` exists** (a bare reference with a missing file makes `@expo/config-plugins` throw during prebuild). Warns loudly when absent. `app.json` gained the `expo-notifications` config plugin and dropped the unused `extra.vapidPublicKey`.
- **`supabase/migrations/0020_push_config.sql`** (new): config keys `expo_push_enabled` (boolean, default `true`) and `vapid_public_key` (JSON `""`, reserved for a future Web Push step).
- **`supabase/functions/_shared/config.ts`**: added `getConfigBoolean` (fail-closed, mirrors client `requireConfigBoolean`).
- **`.gitignore`**: ignores the FCM v1 service-account key (`*service-account*.json`, `*firebase-adminsdk*.json`); `google-services.json` is public identifiers and is committable.
- **Docs**: TECH-SPECS §7.10 (Android-only scope + FCM requirement + web deferral), §9 platform matrix (Expo remote push row), §11 config registry; GLOSSARY (`google-services.json`, FCM v1 service-account key; VAPID entries re-marked reserved).

### Owner setup required before Android E2E (root cause of "no notification")

The dev build logged `Unable to get Firebase Messaging instance … configure googleServicesFile` — no FCM credentials, so **no token was ever obtained** and the server always exited at "No tokens". Also note Expo Go cannot test push on Android from SDK 53.

1. **Firebase console** (Spark/free, no card): create a project → add Android app `com.anonymous.davos` (skip SHA-1) → download `google-services.json` to the repo root. Project settings → Service accounts → **Generate new private key** → save the JSON **outside the repo**.
2. **Upload the FCM v1 key to Expo** (one-time, works for local builds): `eas login` then `eas credentials -p android` → Google Service Account · FCM V1 · Upload a new service account key. `exp.host` does the sending, so this is required even though we never run `eas build`.
3. **Rebuild**: `npx expo prebuild --clean` then `npx expo run:android` on a **physical** device (`google-services.json` must exist first).

### Verification

- Gates: `npx tsc --noEmit` ✅, `npx jest --ci` ✅ (35 tests), `npx eslint .` ✅ (0 errors).
- Migration `0020` to be applied (fixed JSON `""` for the reserved VAPID key; `jsonb_typeof` → `boolean`/`string`).
- Edge Functions `send-message` and `select-persona` to be redeployed (fixed `getConfigBoolean` import, bounded await, ticket→token receipt map).
- E2E matrix (Android-only):
  - App backgrounded → send from web → notification arrives; tap → app opens.
  - Chat focused → no banner; message renders < 2 s via Realtime.
  - Zero `push_tokens` → send still succeeds.
  - Invalid token → **only that token** deleted on receipt; subsequent sends work.
  - Direct check: `POST https://exp.host/--/api/v2/push/send` with a captured `ExponentPushToken[…]`, then `POST /push/getReceipts` ~15 min later (`InvalidCredentials` = FCM key missing/wrong).

### Notable / outstanding

- **Native rebuild required** before native runs (Step 6 added `expo-crypto ~57.0.4`; stale dev client fails like the AsyncStorage error).
- **iOS remote push blocked by $0** (Apple Developer Program) — TECH-SPECS §13 live item; iOS degrades to Realtime.
- **Web push deferred to its own step**: Expo push does not support web; real Web Push needs a service worker + VAPID JWT + aes128gcm sender. Web uses Realtime + the in-app banner (`vapid_public_key` / `EXPO_VAPID_PRIVATE_KEY` stay reserved).
- Step 7 passes AC-7 (Android). AC-7 iOS is deferred (budget decision pending).
- Fixed review findings CR-001, CR-002, CR-003, MAJ-001, MAJ-002, MAJ-003, MAJ-004, MIN-001–006.

---

## 2026-10-16 — FP-02 Step 5b follow-up: Realtime `CHANNEL_ERROR` noise (diagnosed)

**Commit:** (pending)
**Governing refs:** FP-02 FR-17; TECH-SPECS §7.10 (D23), §9; AGENTS.md §2, §3.4.
**Status:** diagnosed against installed source; logging corrected. **Not an app bug.**

### Finding

The Android dev build logs `[chat] Realtime channel error`. Traced through the installed `@supabase/realtime-js` + `@supabase/phoenix` sources: the reported stack (`onConnError` → `triggerChanError`) is the **socket** error/close path, not a join rejection — `onConnClose` and `onConnError` each fan an error out to *every* joined channel, which the JS layer then reports as `CHANNEL_ERROR`. A dropped WebSocket (network flap, backgrounding, heartbeat lapse) is therefore expected on mobile, and supabase-js reconnects and rejoins on its own — which is why messaging kept working throughout.

Three defects in *our* handling:

1. `console.error` made a recoverable transport event render as a red error in the RN dev overlay.
2. The subscribe callback's `err` argument was discarded, so the reason was never recorded — `normalizeChannelError` would have produced `socket closed: <code>` or `channel error: connection lost`.
3. `TIMED_OUT` (join/heartbeat timeout) was not handled at all — no log, no reconcile.

### Change

- **`app/(app)/chat.tsx`**: subscribe callback now takes `(status, err)`; `CHANNEL_ERROR` and `TIMED_OUT` log via `console.warn` with `err.message` + raw `err.cause`, then reconcile via `fetchMessages()`, exactly as `SUBSCRIBED` does. No manual resubscribe — supabase-js owns reconnect.
- **`docs/TECH-SPEC.md` §7.10**: new **Realtime reconnect** bullet recording the contract; corrected the stale "Web push: Expo web push where browser-supported" line to match the Step 7 scope decision (Expo push has no web support).

### Notable

- The companion `Cannot connect to Expo CLI … URL: 10.82.132.253:8081` error is the dev-server/LAN connection dropping, not app code — consistent with the same interruption that dropped the Realtime socket.
- `[push] registered android token for user …: ExponentPushToken[sa…]` confirms the Step 7 FCM credential fix works end-to-end on Android.

---

## 2026-10-16 — FP-02 Step 8: sync degrade + `llm_retry` handler (staged)

**Commit:** (pending)
**Governing refs:** FP-02 FR-3, FR-4, AC-6; FP-02-PLAN Step 8; TECH-SPECS §2.3, §3.2, §4.1, §4.2, §5.1, §7.10, §11, §12; GLOSSARY §6, §12, §14, §15, §16; D12, D18; AGENTS.md §2, §3.2, §4.3, §7.1, §9.
**Status:** implemented; `deno check` clean on all 8 touched server modules; `tsc --noEmit` / `jest --ci` (5 suites, 35 tests) / `eslint .` (0 errors) green. **Live verification run and passed 2026-10-16 (owner-run)** — migrations `0020` + `0021` applied, `send-message` + `job-dispatcher` redeployed, the runbook below executed, config restored.

### Decision recorded before coding

The plan's sketch said a *single* provider failure degrades ("provider 429/5xx → `llm_retry`, target = fallback"). Owner decision: **keep the adapter's inline primary→fallback, and degrade only when both tiers fail** (or the budget runs out) — a routine Gemini 429 must stay invisible to the user, and the retry job is a safety net for a genuine outage, not a load balancer. Rejected: the spec-literal primary-only degrade, and "retry the primary" hybrid. `TECH-SPECS §4.1` now documents the as-built rule with an explicit note that the earlier sentence is superseded and **awaits a `decisions2.md` entry** (owner action — a new D-number is not the agent's to author).

### What was implemented

- **`_shared/llm/errors.ts`** (new): `ProvidersUnavailableError` (carrying `kind` + the optional `PipelineContext`), `isProvidersUnavailable`, and `FailureKind = transport | parse | validation`.
- **`_shared/llm/adapter.ts`**: `postJson()` wraps every provider fetch with `AbortSignal.timeout(config.llm_call_timeout_ms)` and normalises a **thrown** fetch (DNS/TLS/abort) into a result. This closes a real hole: previously a network error rejected out of `generate()`, through `runPipeline`, into `send-message`'s catch → `500` + a stranded turn. Every negative result now carries `kind` (HTTP/network/timeout/envelope → `transport`; bad JSON → `parse`; failed validator → `validation`). `tier` is now honoured (`primary` / `fallback`) instead of accepted-and-ignored. Also removed a dead `const messages` in `callGroq` and guarded `res.json()` (a non-JSON body used to throw).
- **`_shared/pipeline/generate.ts`**: `transport` → `throw new ProvidersUnavailableError(...)` **after one attempt** (the adapter already tried both tiers; a second in-invocation round trip only pushes toward the 150 s limit). Structural → unchanged one-bounded-retry → `config.malformed_fallback_reply`, nothing enqueued (§4.2 vs §4.1).
- **`_shared/pipeline/runPipeline.ts`**: stage-3 embed failure (previously a bare `throw new Error` → 500, and unrecoverable because no job existed) is now a `ProvidersUnavailableError`; both stage-3 and stage-5 failures carry the stage-1–4 decision so `llm_retry` never re-extracts. New optional `deadlineAt` (`config.pipeline_deadline_ms`) checked before each expensive stage in both `runPipeline` and `runLockedPersonaReply`.
- **`send-message/index.ts`**: new `degradeToHoldingReply()`. Order is deliberate — (1) write `config.sync_degrade_reply` as the turn's **primary** reply through the existing `insertPrimaryReply`, so `messages_one_primary_reply` decides a concurrent race and a loser enqueues nothing; (2) only if that won, insert exactly one `llm_retry` job whose id was minted up front and used as the row id **and** written into the holding row's metadata (`metadata.route='degrade'`, `source='sync_degrade'`, `source_job_id`); (3) return `ok` with the holding reply's id, so the client's normal path resolves the bubble. Only `ProvidersUnavailableError` degrades — every other error still 500s. `pipeline_deadline_ms` is read at request start with the other `[SPEC]` keys and the budget is measured on the **server** clock (never `client_sent_at`, and never the user row's `created_at` — a repair run reuses an older row and would degrade instantly).
- **`job-dispatcher/index.ts`**: handler registry signature extended to `(payload, job)`; new `llm_retry` handler — reload the user text **server-side** from `user_message_id` (the payload carries ids only), `runLockedPersonaReply` (stages 3–5, persona locked, `auto` variant), insert the real answer as a **secondary** reply (`secondary_reply_to_message_id`, `persona_key`, `metadata.source='llm_retry'` + `source_job_id` + the original `route`), bounded best-effort push, `done`. Idempotent (§2.2.4): check-before-insert then Postgres `23505` → `done`; a re-delivered job is a no-op. Throwing (a still-down provider) → standard backoff → `dead` at 5. `tactical_analysis` is logged, never persisted (§4.3).
- **`0021_llm_retry_config.sql`** (new): `llm_call_timeout_ms` (30000) + `pipeline_deadline_ms` (120000) + `job_dispatcher_budget_ms` (140000), all jsonb numbers.
- **Docs**: TECH-SPECS §4.1 (both-fail rule + per-call timeout + the as-built note, now ratified), §2.2 (dispatcher batch budget + claim release), §2.3 (`llm_retry` row — the old text was wrong), §3.2 (metadata list + a sync-degrade-pair note), §5.1 (hand-off incl. the persona/metadata shape + the residual repair window), §7.10 (send contract, push wiring, client render, failure handling, Realtime reconnect evidence), §11 (3 keys), §12 (bounded worst-case latency, corrected), §13 (live item 6 — the dispatcher's secret dependency is now scoped to `llm_retry`); GLOSSARY §6 (sync degrade reply, transport failure, structural failure, pipeline deadline), §7/§12 (job-type count → 15), §12 (`llm_retry`), §14 (`degrade` in `metadata.route`), §15 (`source` / `source_job_id`), §16 (3 keys); `docs/adr/decisions2.md` (Decision 18 Update — both-tiers-fail ratified); FP-02-PLAN Step 8 body + verify rewritten with the as-built deviations listed and the tracker marked ▶.

### Verification

- `deno check` (all 8 touched modules) → exit 0. `npx tsc --noEmit` → 0. `npx jest --ci` → 5 suites / 35 tests pass. `npx eslint .` → 0 errors (30 pre-existing `no-console` warnings).
- Reasoning for the bounded worst case (§12), **corrected after review**: the stage-1 extraction call is itself a `generate` call, so it also pays both tiers — 2 × 30 s — while running in parallel with the 30 s embed → 60 s; stage 5 adds 2 × 30 s → **≈ 120 s**, not 90 s. That equals `pipeline_deadline_ms`, so the deadline guard (not the arithmetic) is the operative bound on a bad turn; the earlier "comfortable" verdict was wrong and is corrected in §12, which also notes that lowering `llm_call_timeout_ms` is the config knob for real headroom.

### Owner runbook (live verify — run 2026-10-16, passed)

1. Apply migrations `0020` (push config) and `0021`, **then** redeploy `select-persona`, `send-message` and `job-dispatcher`. Order matters: `send-message` reads `llm_call_timeout_ms` / `pipeline_deadline_ms`, and the dispatcher reads `job_dispatcher_budget_ms` / `pipeline_deadline_ms`, all through `getConfigNumber`, which throws on a missing key — deploying the functions first fails every send and every tick. The dispatcher needs `GEMINI_API_KEY`/`GROQ_API_KEY` present for `llm_retry` to work (it imports the adapter lazily, so a missing secret fails that job type only, with backoff and a recorded `last_error`, instead of the whole invocation at module load).
2. `update config set value='"both"'::jsonb where key='llm_force_fail'` → send → exactly one holding bubble, one `llm_retry` row, 1 assistant row with `metadata.route='degrade'`.
3. `llm_force_fail='"none"'` → next dispatcher tick (≤ 2 min, or invoke `job-dispatcher` directly) → a **secondary** reply lands; 2 assistant rows in `created_at` order, job `done`, push received.
4. `llm_force_fail='"both"'` → 5 attempts → job `dead` with `last_error`; still exactly 1 assistant row and 0 real replies.
5. `llm_stub_mode=true` + `llm_stub_malformed=true` → send → `malformed_fallback_reply` as the primary reply and **no** `llm_retry` row (the structural path must not degrade). Restore `llm_stub_mode`/`llm_stub_malformed` and `llm_force_fail='"none"'`.

### Notable / outstanding

- **Deliberate deviations from the Step 8 sketch**, all listed in the plan: the degrade trigger is *both tiers failed*; the deadline guard sits before the expensive stages (discarding an already-generated reply to write a holding message would be pure loss); the holding reply is **not** pushed (the sender is still in the app, and "give me a second" + the real answer would be two notifications for one turn); the real answer is a **secondary** reply, so it can never collide with a concurrent primary reply.
- A degraded Medium-tier turn is answered **without chips** on the retry: chips belong to a primary reply and the client's tap resolves its anchor from `reply_to_message_id`. Making secondary rows tappable would need `select-persona` to accept `secondary_reply_to_message_id` as the anchor — out of scope here, recorded for §14 step 11.
- **Accepted residual risk:** if the retry job dead-letters, the turn keeps only the holding bubble with no automatic recovery (repair-on-duplicate never fires on an answered turn). A "reply never arrived" affordance is later scope. A second, narrower window sits beside it (documented in §5.1 after review): if the invocation is killed or the `jobs` insert itself fails **after** the holding row lands, the turn is answered with no retry job and no repair path, and the client does not auto-retry (`200 ok` is not a retry condition) — same outcome, same later fix (a reconciliation sweep for `metadata.source_job_id` values with no `jobs` row).
- **Persona on a degraded turn are never null** (review item 6): `determinePersona` returns a concrete persona on every route — the D7 fallback yields `inquirer` — so the payload always carries one, and `handleLlmRetry` logs and closes the job rather than generating if `persona`/`domain` is missing. A degraded **Medium** turn locks stage 4's auto candidate (the emotion-mapped persona), *not* the chip the user would have tapped, because the holding reply carries no chips; the retry row still records `metadata.route='options'`. The holding row deliberately carries **no** `persona` — its text is `config.sync_degrade_reply`.
- `TECH-SPECS §4.1`'s superseded wording is now **ratified in `docs/adr/decisions2.md` as "Decision 18 Update"** (review item 2) — recorded at the owner's request rather than authored as a new D-number.
- Step 8's tracker row is ✅ — the runbook above was run by the owner on 2026-10-16 and passed (this entry's "verification pending" status was corrected in place on that date; the run itself is recorded in the FP-02-PLAN Step 8 body).
- Pre-existing owner items unchanged: emotion→persona map sign-off, the `runPipeline` stage-4-before-3 ordering deviation, the `service_role` key rotation, the FCM roster / web-push scope decision. FP-02-PLAN's `5a` row read ▶ although 5a was committed (`2432497`) — **fixed on review** (now ✅).
- Uncommitted at the end of this step: the Realtime `CHANNEL_ERROR` follow-up (`app/(app)/chat.tsx`) and this Step 8 change. Steps 5a–7 are committed (`2432497`, `8ae5ab6`, `22ccb74`, `6d1ed9c`, `f063065`).

---

## 2026-10-16 — FP-02 Step 8 review response (`REVIEW_REPORT.md`)

**Commit:** (pending, with Step 8)
**Governing refs:** the owner's `REVIEW_REPORT.md` (items 1–16); TECH-SPECS §2.2, §4.1, §5.1, §7.10, §11, §12, §13; GLOSSARY §6, §7, §12, §16; `docs/adr/decisions2.md` (Decision 18 Update); AGENTS.md §2, §9.
**Status:** all 16 items dispositioned — 3 code changes, 1 migration seed, 1 ADR entry, 9 doc corrections, and **3 items were false positives of the review tooling**, evidenced below rather than "fixed".

### Code

- **Dispatcher batch budget (item 3, Major).** Two `llm_retry` jobs at the §11 envelope (up to 120 s each) or ten at typical 15–40 s would run past the 150 s invocation limit; a kill is worse than a slow tick, because `claim_jobs` has already incremented `attempts` for the whole batch and a killed invocation cannot hand back the rows it never reached — so outage-clustered jobs could dead-letter without ever executing. `job-dispatcher` now reads `job_dispatcher_budget_ms` **before claiming** (a missing `[SPEC]` key fails the tick with the queue untouched instead of burning an attempt per row), stops starting jobs once the next handler's worst case would not fit, and **releases the un-started claims to `pending` with `attempts` decremented**. A generation-capable handler reserves `pipeline_deadline_ms`; cheap handlers opt out via `FAST_JOB_TYPES` (currently `smoke_test`), and a *new* handler type defaults to generation-capable — the fail-safe direction. The response now returns `{processed, released}`. Documented in TECH-SPECS §2.2 (new item 5) + §11, GLOSSARY §16, and migration `0021` (`job_dispatcher_budget_ms` = 140000, 10 s of settle headroom).
- **Lazy pipeline import (item 4, Major).** The dispatcher no longer imports `_shared/pipeline/runPipeline.ts` at module load; `handleLlmRetry` loads it on demand. A deployment without `GEMINI_API_KEY`/`GROQ_API_KEY` now fails `llm_retry` alone — as a normal job failure with backoff and a recorded `last_error` — instead of throwing at module load and stalling lease recovery and every other handler. TECH-SPECS §13 live item 6 rewritten accordingly.
- **Realtime failure escalation (item 15, Suggestion).** `app/(app)/chat.tsx` counts consecutive `CHANNEL_ERROR`/`TIMED_OUT` events with no intervening `SUBSCRIBED`; from the third it logs at **error** level with the count and says what to check (publication/RLS), and a later `SUBSCRIBED` resets the count. A permanently broken subscription is now distinguishable from routine mobile transport noise. Log distinction only — no user-visible state, so §7.10's "no error bubble" contract is untouched.

### Docs & ADR

- **Item 2 (Major):** the both-tiers-fail divergence is **ratified in `docs/adr/decisions2.md` as "Decision 18 Update"** — options, as-built choice, rationale, trade-offs, and the "what would change our mind" clause. `TECH-SPEC §4.1`'s as-built note now points at it as ratified rather than pending.
- **Item 6 (Major):** answered by code, then documented in §5.1. `determinePersona` returns a concrete persona on **every** route (D7 fallback → `inquirer`), so a decision payload always carries one; `handleLlmRetry` logs and closes the job — never generates — if `persona`/`domain` is missing, so null can never reach generation. A degraded **Medium** turn locks stage 4's auto candidate (the emotion-mapped persona), not the chip the user would have tapped, since the holding reply carries no chips; the retry row still records `metadata.route='options'` for the Step 10 counter. Documented the exact row shape, including that the holding row deliberately carries **no** `persona`.
- **Item 7 (Minor):** the "an outage now **always** … enqueues `llm_retry`" overreach is corrected, and the new window is recorded in §5.1 beside the accepted dead-letter risk: death or a failed `jobs` insert **after** the holding row lands leaves an answered turn with no retry job and no repair (the client sees `200 ok`, which is not a retry condition). Reconciliation sweep noted as the eventual fix, explicitly not implemented.
- **Item 8 (Minor):** §12's latency row corrected — the review was right that stage 1's extraction is itself a `generate` call, so its transport worst case is 2 × 30 s, making the true bound **≈ 120 s** (= `pipeline_deadline_ms`), not 90 s. The verdict drops from "comfortable" to "at the limit; the deadline guard is the operative bound", and the row notes `llm_call_timeout_ms` is the config knob for real headroom. The Step 8 progress reasoning is corrected in place.
- **Items 9, 10, 11, 12 (Minor):** GLOSSARY job-type count 14 → 15 (two places, `smoke_test` made it 15); GLOSSARY §6 now states the concrete kind mapping (network/timeout/HTTP/envelope-shape → `transport`; the *model's own text* not parsing → `parse`; validator → `validation`); FP-02-PLAN's "Passes AC-6" is now conditional on the live verify; its `5a` tracker row → ✅ (`2432497`).
- **Item 16 (Suggestion):** recorded as an **owner decision required before Step 10**, in both places the review named — TECH-SPECS §5.3 (beside the `options`-not-`auto` rationale) and the FP-02-PLAN Step 10 body: whether an `llm_retry`/secondary row with `metadata.route='auto'` counts toward D8's `auto_adopt_successes`, since a late answer the user had stopped waiting for may not be engagement. The counter is not to be built until the rule exists.
- Docs touched: TECH-SPECS §2.2, §4.1, §5.1, §5.3, §7.10, §11, §12, §13; GLOSSARY §6, §7, §12, §16; FP-02-PLAN (tracker, Step 8, Step 10); `decisions2.md`; this file.

### False positives — evidenced, not changed

- **Item 1 (Blocker, "diff truncated / missing files"):** the artifacts are complete. `CHANGE-DOC.md` — the review's own generated diff, 1,519 lines / 102 KB — contains every file the report calls absent: `_shared/llm/errors.ts` (L757), `pipeline/generate.ts` (L827), `pipeline/runPipeline.ts` (L885), `job-dispatcher/index.ts` (L1079), `send-message/index.ts` (L1310), `migrations/0021_llm_retry_config.sql` (L1482), and the adapter hunks continue past the imports (L373+). The report appears to have read the first ~370 of 1,519 lines. Re-verified independently: `deno check` on all 8 touched modules, `tsc --noEmit`, `jest --ci`, `eslint .`.
- **Item 13 (Minor, "TIMED_OUT auto-rejoin asserted but not evidenced"):** verified against the installed pinned sources, and it does auto-rejoin. `@supabase/realtime-js` `RealtimeChannel.subscribe()` delegates to `channelAdapter.subscribe(timeout)` → phoenix `Channel.join()`; in `@supabase/phoenix` `assets/js/phoenix/channel.js` the constructor's `joinPush.receive("timeout", …)` handler (L78–85) sets `state = errored` **and calls `rejoinTimer.scheduleTimeout()`** when the socket is connected, whose callback re-joins (`rejoin()` → `joinPush.resend`); `socket.onOpen` also re-joins while errored (L50–53). So the code comment and the §7.10 bullet were already correct; §7.10 now cites the mechanism instead of asserting it, and the `TIMED_OUT` branch gained the item-15 escalation.
- **Item 14 (Minor, "mojibake in added lines"):** the working tree is clean UTF-8. Byte-level check of all 16 touched files: zero occurrences of U+00C2/U+00C3/U+00E2/U+FFFD, and every non-ASCII character is a real typographic one (`— – § → ≤ ✅ ▶`). The double-encoding damage is in the **review's own** `CHANGE-DOC.md` and `REVIEW_REPORT.md` — their only non-ASCII characters are runs like U+0393 U+00C7 U+00F6, i.e. the UTF-8 bytes of an em dash read as CP-437 — so the mangling came from the console/encoding path that produced those two files, the same path that made item 1's diff look truncated. No file needed re-saving (`docs/adr/decisions2.md`'s appended row was written through a UTF-8-without-BOM byte path and re-verified).

### Verification

- `deno check` on the 8 touched server modules → 0. `npx tsc --noEmit` → 0. `npx jest --ci` → 5 suites / 35 tests. `npx eslint .` → 0 errors (31 `no-console` warnings: 30 pre-existing + the 1 new escalation site in `chat.tsx`, which is the price of logging at error level instead of reusing the warning path).

---

## 2026-10-16 — FP-02 Step 9: offline send queue + delivery dedupe

**Commit:** (pending — this change)
**Governing refs:** FP-02 FR-16, AC-8; FP-02-PLAN Step 9; TECH-SPECS §7.10, §11, §12; GLOSSARY §8, §14, §15, §16; D23; AGENTS.md §2, §3.4, §4.1, §9.
**Status:** implemented and unit-verified; the live half of the Step 9 verify (airplane-mode toggle on a device) is owner-run and still outstanding, so the tracker row is ▶. Owner decisions answered before coding: **D1(a)** real connectivity signal via NetInfo, **D2** yes — new `[SPEC]` key + migration `0022`, **D3** chat-scoped replay is fine for beta, **D4** Step 8 was already committed (`1d6684e`) and verified.

### What was implemented

- **`lib/sendQueue.ts`** (new): the device offline queue. Storage is AsyncStorage, one key per user (`davos.send_queue.v1.<user_id>`, `storageKeyFor`) — per-user is load-bearing, because a replay authenticates with the *current* session, so one shared key would send user A's text as user B. An entry is `{client_message_id, content, client_sent_at, retryAt, attempts, reason}`. The module performs **no** network I/O and imports no HTTP client or backend handle, so it is unit-testable without React — `chat.tsx` keeps `send()` and the triggers.
  - Pure helpers, all exported and tested: `parseQueuedSend`, `parseQueue` (validates uuid shape against the server's own regex so a corrupt entry can never be replayed into a permanent 400; coerces an unusable `client_sent_at` to the epoch rather than discarding the user's text, and truncates a stale oversized blob to the **newest** items), `sortQueueAsc` (oldest `client_sent_at` first, id-tiebroken so the order is total), `enqueueInto` (replace-or-append; **refuses** a new item at the cap instead of evicting the oldest), `removeFrom`, `dueItems`, `nextDueAt`.
  - Store: `loadSendQueue` (called once the `[SPEC]` cap is known; clears a blob that does not read back as an array, so the device can never be stuck failing to start on its own queue), `enqueueSend` (false when full or before load), `removeSend`, `markQueueAttempt`, `useSendQueue` via `useSyncExternalStore`.
- **`lib/chat.ts`**: `PendingState` gains `"queued"`; `PendingSend`/`ChatItem` carry an optional `reason`; `canRetry` now covers `queued` on the same terms as `failed` (immediately, or once the gate opens), and `nextRetryAt` includes queued items so the screen wakes to unlock "Send now".
- **`app/(app)/chat.tsx`**: `send(args, origin)` — a **network** failure (`kind === 'network'`, i.e. no HTTP status) is persisted to the queue instead of becoming an in-memory failure; every other failure keeps the §7.10 policy (4xx must not be replayed verbatim, 5xx stays immediately retryable, 401 is a banner). `reason` is `offline` when NetInfo reports no link (nothing was transmitted → `retryAt = 0`, and the request is skipped entirely so the bubble reads "queued" at once rather than waiting out the 90 s send timeout) and `unknown` otherwise (the request went out → `retryAt = now + chat_retry_holdoff_ms`, so a resend cannot overlap a possibly-live pipeline run). `flushQueue` walks `dueItems(getSendQueue())` sequentially behind a `flushingRef` guard, stops at the first item that does not leave the queue, and reuses `clientMessageId`/`clientSentAt` verbatim. Triggers: NetInfo `isConnected` false→true, Realtime `SUBSCRIBED`, AppState `active`, queue load at mount, chat focus, and the manual "Send now". Rendering merges the store into the thread (`pending` wins for an id, so an in-flight replay shows "Sending…" while the item is still stored — a crash mid-attempt therefore cannot lose it) and a server row removes its queued counterpart, because a lost *response* does not mean a lost request.
- **`supabase/migrations/0022_chat_queue_config.sql`** (new): `chat_queue_max_items` = `20`. The cap doubles as the reconnect replay-burst limiter (one pipeline run per item), which is why it lives in the registry (§12) rather than the bundle.
- **`package.json`**: `@react-native-community/netinfo` `12.0.1` (expo-pinned) — a native module, so a dev-client rebuild is required. `isConnected === false` is authoritative; `true`/`null` is only a hint (captive portal, dead DNS, downed server), which is why the send path queues whatever actually fails instead of trusting the probe.
- **Tests**: `lib/sendQueue.test.ts` (new, mocked device storage) covers the validators, ordering, refusal at the cap, the corrupt-blob path, per-user keying and the store's persist/remove/re-gate behaviour; `lib/chat.test.ts` gains three cases for the `queued` state (replayable-offline, holdoff-gated-unknown + wake-up, gives way to the server row and is retired once resolved).
- **Docs**: TECH-SPECS §7.10 (failure routing + a full offline-queue subsection: storage, replay gate, bound, triggers, exactly-once, connectivity signal, what is deliberately not queued), §11 (`chat_queue_max_items`), §12 (replay-burst note); GLOSSARY §8 (offline queue redefined; new queue reason / queue replay terms; retry holdoff cross-ref), §14 (client pending state, queue reason), §15 (queued-send entry shape), §16 (the key); FP-02-PLAN (Step 9 body + as-built deviations, tracker ▶).

### As-built deviations from the Step 9 sketch

All recorded in the plan body: (a) NetInfo added (native rebuild) per D1(a); (b) the cap is a config key, not a constant; (c) the queue holds only turns the server never **acknowledged** — a server row retires an item even before its reply lands; (d) only network failures are queued; (e) replay is **trigger-driven only** — the holdoff wake-up timer re-renders to unlock the button but never sends, so an `unknown` item cannot auto-retry in a loop (the sketch's "due-item timer" trigger is deliberately dropped: §3.4's no-polling rule and the 150 s holdoff would otherwise amount to unattended periodic retries); (f) a full queue refuses the incoming message rather than silently evicting the oldest; (g) `select-persona` taps are not queued — accepted gap, the banner shows and the chips stay enabled.

### Verification

- `npx jest --ci` → **6 suites / 59 tests** pass. `npx tsc --noEmit` → 0. `npx eslint .` → 0 errors, 38 warnings (31 pre-existing + 4 `no-console` in `lib/sendQueue.ts` and 1 in `chat.tsx`'s replay catch, plus the 2 `import/first` warnings that are inherent to the jest-mock-at-top test pattern).
- `scripts/verify-step9.py` (owner-authored harness): every **static** check passes against this implementation as written — the checked export names, the per-user key, "no network I/O in the queue module", the `clientSentAt: next.clientSentAt` verbatim-replay substring and the `for (;;)`/`dueItems(getSendQueue()` sequential-walk substrings.
- **Still required, in order:** (1) apply migration `0022` — the client's `requireConfigNumber('chat_queue_max_items')` throws without it, which fails the composer closed and fails the harness's `config chat_queue_max_items present` check; (2) rebuild the dev client for the new native NetInfo module; (3) run the harness's live section (ordered double-send, `client_sent_at` verbatim, replay duplicates, simultaneous double-send race); (4) run the manual airplane-mode section on a device and record stub-vs-live + device in the commit message. Row stays ▶ until (4).

---

## 2026-10-16 — FP-02 Step 10: `auto_adopt_successes` write path

**Commit:** (pending — this change)
**Governing refs:** FP-02 FR-14, AC-9; FP-02-PLAN Step 10; TECH-SPECS §3.4, §4.1, §5.3, §5.4, §11; GLOSSARY §5, §16; `docs/adr/decisions2.md` (Decision 8 Update); D8; AGENTS.md §2, §4.1, §9.
**Status:** implemented and statically verified — `deno check` on the touched server module → 0, `npx tsc --noEmit` → 0, `npx jest --ci` → 6 suites / 59 tests, `npx eslint .` → 0 errors (38 warnings, baseline unchanged). Live verification is owner-run and outstanding: it needs migrations `0022` (still open from Step 9) + `0023` applied and `send-message` redeployed — the RPC does not exist until `0023` lands — so the tracker row is ▶.

### Decisions recorded before coding (they close the Step 8 review's item 16)

The counting rule was the blocking owner decision, and two smaller questions travelled with it. **D-A — narrow:** only the **sync pipeline's own primary reply** counts (`reply_to_message_id IS NOT NULL` AND `metadata.route='auto'`), so the Step 8 `llm_retry` secondary row — which carries the *original* turn's route by design (§3.2) — never scores. **D-B — one success per auto-adopted reply:** the qualifying row must be the row *immediately* preceding the new user message, so three follow-ups at one suggestion score one engagement (the plan sketch's "last assistant row" would triple-count and walk `band_shift` to its +0.10 cap on one chat). **D-C — server clock:** `now - reply.created_at`, never `client_sent_at` (§5.1, untrusted input), so a Step 9 replay delivered late loses a count but can never produce a wrong one. Recorded in TECH-SPECS §5.3 (plus the §3.4 column comment and the §4.1 retry-row rationale, which no longer cites the counter) and ratified in `docs/adr/decisions2.md` as **"Decision 8 Update"**, alongside the Decision 18 Update.

### What was implemented

- **`supabase/migrations/0023_auto_adopt_config.sql`** (new): the `[SPEC]` key `auto_adopt_window_minutes` (10) — §3.4 marks the window `[SPEC]`, so hardcoding it would break AGENTS.md §2 — plus `increment_auto_adopt_successes(user_id, domain)`: an atomic insert-on-conflict increment. It is a function rather than a read-modify-write because PostgREST cannot express `col = col + 1`, and a read-modify-write would lose an update to the retry-vs-original race Step 5a proved real (`persona_stats` has no write-time guard of its own). Hardened like `claim_jobs` (`0008`): `SECURITY DEFINER` with a pinned `search_path`, execute revoked from public/anon/authenticated and granted to `service_role` only, so the increment is not client-callable. NB `persona_stats` is nonetheless client-writable for one's **own** row by the pre-existing `0007` policies — a self-affecting surface only (a user can fudge their own weighting), unchanged here and deliberately not hardened, because a future `user_overrides` path may want it.
- **`supabase/functions/send-message/index.ts`**: `recordAutoAdoptSuccess()`, called from the **fresh-insert branch only** — a duplicate send, a §5.1 repair run and a Step 9 offline replay all take the other branch, so one arrival can never be scored twice — and **before** the pipeline, because the signal is the user's *arrival*: a turn that then degrades still counts. It reads the single row immediately preceding the new user message (`created_at` order, server clock), applies the four clauses of §5.3, and calls the RPC with that row's `metadata.domain` (a missing domain skips the count rather than inventing a `persona_stats` row). Wrapped in `try/catch` + `console.error`: the user row is already committed, so a stats failure is logged and the turn proceeds — a 500 would strand it, because Step 9 does not queue 5xx. The user-row upsert now selects `id, created_at` so the window boundary is that row's own server timestamp.
- **`scripts/verify-step10.py`** (new): automates the Step 10 verify against the linked project. Static section: the migration's key/RPC/grant and the detector's shape (fresh-insert branch only, primary-only, `route` gate, domain guard, server clock, `[SPEC]` window read at runtime, non-fatal failure, no hardcoded minutes). Live section, asserted as `persona_stats` **deltas** so a rerun stays meaningful: happy path (+1 for the right `(user, domain)`), the window (set to 0 → unchanged, restored), route gating (`options` / `low_question` / `fallback` each → unchanged), the **item-16 scenario** (a simulated `llm_retry`-shaped secondary row with `route='auto'` → unchanged), a positive control (a simulated *primary* `route='auto'` row with a domain → +1 for that domain), domain safety (a primary `route='auto'` row with no domain → no count, no error), exactly-once (re-POST of a delivered `client_message_id` → duplicate, unchanged), and the RPC rejecting the anon key. Config is snapshotted and restored in a `finally`; the message rows it creates are deleted, `persona_stats` is left as the evidence.
- **No client change**, no new job type, no new Edge Function. **`band_shift` is deliberately not written** — the §5.4 successes→shift rider is FP-02's OUT list — so the counter stays write-only until FP-03 consumes it.

### Verification

- `deno check supabase/functions/send-message/index.ts` → 0. `npx tsc --noEmit` → 0. `npx jest --ci` → 6 suites / 59 tests (unchanged — Step 10 adds no client code). `npx eslint .` → 0 errors, 38 warnings (unchanged baseline).
- `scripts/verify-step10.py` static section: **18/18 pass**, including the structural check that the counter call sits between the fresh-insert branch and the repeat-send branch; `--run-jest` green.
- **Still required (owner), in order:** (1) apply migrations `0022` and `0023` (a missing key fails the harness's `auto_adopt_window_minutes present` check; a missing RPC fails the happy path); (2) redeploy `send-message`; (3) `$env:DAVOS_USER_JWT="…"; python scripts/verify-step10.py --run-jest`; (4) optionally run the printed end-to-end section (`llm_force_fail='both'` → holding reply + `llm_retry` → restore → reply to the retry row → still unchanged) to confirm the real retry row, not just the simulation. Row stays ▶ until (3).

### Notable / outstanding

- **The counter is write-only in FP-02**, so a mis-implemented rule would stay invisible for a whole feature — hence the verify script asserts every clause, including the retry-row exclusion, and `decisions2.md`'s Decision 8 Update records the reasoning plus the "what would change our mind" clause.
- The window test uses `auto_adopt_window_minutes=0` rather than backdating `created_at` (the plan sketch's method): backdating the reply alone inverts the thread order, and the config route additionally proves the `[SPEC]` key is read at runtime. `0` disables the window arithmetically (`now - created_at > 0`) with no special case in code.
- Step 9's row stays ▶ until its device check. Step 10 does not depend on it, but both need `0022`, so the migration backlog (`0022` + `0023`) is one pass. AC-9's formal marking belongs to Step 11's AC sweep.
- **AGENTS.md §9 checklist:** no new table (no RLS work) and no new secret; no new paid service; **no new LLM/embedding call at all** — the counter is two Postgres statements (one indexed `select … limit 1` on `messages`, one single-row upsert) per **new** turn, never on a duplicate/repair/replay, so the §12 projection is unchanged (a quota check that needed no table edit); no regex on LLM output; no HTML/DOM change; `tactical_analysis` and `trust_score` untouched; no new job type; new term + key registered in GLOSSARY §5/§16; the `[SPEC]` window read from `config`; docs updated in the same change; refs cited in the migration, the helper and here.
- Pre-existing owner items unchanged: emotion→persona map sign-off, the `runPipeline` stage-4-before-3 deviation, the `service_role` key rotation, iOS remote push ($0), the web-push scope, and a `decisions2.md` row for the Step 9 NetInfo dependency if still wanted.

---

## 2026-10-16 — FP-02 Step 11: timing/quota audit, doc write-backs, AC sweep (staged)

**Commit:** (pending — this change)
**Governing refs:** FP-02 FR-14 and AC-1–AC-12 (esp. AC-10, AC-11, AC-12); FP-02-PLAN Step 11; TECH-SPEC §3.2, §11, §12, §13, §14 item 11; GLOSSARY §13–§16; `docs/adr/decisions2.md` (Decision 8 Update, Decision 18 Update); D4, D13, D18, D23; AGENTS.md §2, §3.1, §4.3, §7.4, §9.
**Status:** Phase 1 complete and statically verified. This step is the sweep, not a feature — **no application code changed**. Every AC is now marked: 7 PASS (AC-1/3/4/5/6/11/12), 4 OWNER-PENDING (AC-2/7/8/9), AC-10 pending its live run. The write-back diffs are in place and the repo is clean, so Step 11's own Verify reads *every AC marked; write-back diffs present; repo clean* → satisfied, but the tracker row stays ▶ until the owner runs Phase 2, because three of those ACs gate FP-02 acceptance rather than merely the audit.

### What was implemented

- **`scripts/verify-step11.py`** (new): the Step 11 harness. **Static half (offline, no network)** — AC-12 ledger (§3.2 `client_message_id` + `messages_user_client_msg_uniq`, the full 30-key §11 registry with every dev-only key marked, GLOSSARY §13/§14/§15/§16 identifiers), AC-1's source shape (across the three assistant-row writers, `tactical_analysis` occurs only in the `console.log` diagnostic and in **no** parsed `metadata` block), AC-11's shape (the seed writes the label on every row; `clear-rules` is one `source_figure` predicate; a repo-wide scan finds no other rule-insert path), the §9 secret scan (51 files: no secret *value* anywhere, no `service_role`/`SUPABASE_SERVICE` name in client code — migrations may name the *role*, those are grants and comments, not values), the existence of the per-AC harnesses, and the two doc-identity assertions. **Live half** (needs the four env vars; `DEV_SMOKE_TOKEN` optionally unlocks AC-5/AC-11): **AC-10** — 20 real-provider turns (stub off, `llm_force_fail='none'`, no `dev_force`), per-turn latency on the **server** clock (p50/p90/max) with the client-observed delta reported alongside, row integrity, a hard fail on any degraded turn (the audit must not pass on holding replies), and per-provider counts parsed from the adapter's bare JSON lines (`{ts, provider, model, latencyMs, ok, requestId}`; `requestId === "embed"` marks the embedding call) asserted against §12 — without `--logs` that section is advisory and never fails; **AC-3/AC-4** — route `options` + 2–3 chips + a real `select-persona` tap (exactly one secondary reply, `persona_key` set, `reply_to_message_id` NULL, `route='options'`) + a second tap as a no-op, and `low_question` + `fallback` → `General`; **AC-5** — one surviving tone group with `droppedTone='empathetic'` plus a `Career` control where the filter must not fire; **AC-11** — labeled-count → clear → 0 → seed → original count; **AC-8's server half** — a replayed `client_message_id` returns `duplicate` with no second row. Config is snapshotted and restored in a `finally`; the audit rows are **kept** by default because they are the AC-2 material (`--cleanup` deletes them). The four owner-live ACs are printed as a runbook at the end.
- **`docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md`** (new): mirrors `FP-01-ACCEPTANCE.md`, with a *how-verified* tag on every row (`[script]` / `[measured]` / `[owner-observed]` / `[derived]`) because the FP-01 review criticised evidence that asserted a result without showing it was observed. Holds the AC table, the AC-10 audit table (assertions and a "pending" cell per metric, plus the measured-vs-projected note), the AC-12 write-back ledger and the §9 secret-scan result, the deferred/out-of-scope list, the ordered owner runbook, a known-drift section, and a sign-off that explicitly does **not** claim acceptance while AC-2/7/8/9 are open. **Acceptance-doc path corrected:** the plan's flat `docs/feature-prds/FP-02-ACCEPTANCE.md` is stale — the repo keeps one folder per FP (`FP-01/FP-01-ACCEPTANCE.md` is the precedent).
- **`docs/TECH-SPEC.md`**: §13 gains the three FP-02 live items — **7** iOS remote push blocked by the $0 budget (APNs needs the $99/yr Apple Developer Program; escalation before any iOS-push-dependent FP is judged done), **8** `dev_overrides_enabled` must be `false` before real beta users (currently `true` in the beta project; while true a client can force its own `tier`/`domain` — recorded as **scope leakage, not privilege escalation**, since `send-message` re-reads the flag per request, `dev_force` never authorises, and RLS still scopes every row), **9** Web Push deferred to its own step (`vapid_public_key` is registered but has no consumer). §12 gains a pointer paragraph: the Sync-path row is the *projection*, the Step 11 audit supplies the *measured* numbers in the acceptance doc, and the log parse is the only source for per-provider counts because nothing persists provider/latency to a row.
- **`docs/feature-prds/FP-02/FP-02-PLAN.md`**: tracker row 11 ☐→▶ plus a **tracker-convention** footnote (✅ means Verify passed *including* live sections — Steps 9/10/11 stay ▶ until their harnesses pass; FP-01's asserted-not-elapsed review is the precedent); Step 11 body gains **as-built notes** — the acceptance-doc path correction, the audit's mechanics and its owner-run/kept-rows policy, the log-only counts, the `persona_stats` decision, "`band_shift` is not written", the four OWNER-PENDING ACs, and the doc-identity drift.
- **`AGENTS.md`**: the filename mentions were corrected to the file that exists — `docs/TECH-SPECS.md` → `docs/TECH-SPEC.md` in §1 (read-before-first-task), §2 (the precedence list) and §2's **[SPEC]** bullet. The `TECH-SPECS §N` **reference label** is left alone: §2's own "Reference convention" defines the label, and the §2 table already pointed at `docs/TECH-SPEC.md`, so the mention was the bug, not the label.

### Verification

- `python -m py_compile scripts/verify-step11.py` → 0. Static section → **25/25 pass**, 0 fail (includes the two doc-identity assertions that failed before the `AGENTS.md`/plan edits).
- `npx tsc --noEmit` → 0. `npx jest --ci` → 6 suites / 59 tests (unchanged — no client code). `npx eslint .` → 0 errors, 38 warnings (baseline unchanged).
- Docs byte-checked UTF-8 without BOM; `supabase/migrations/*` and `scripts/*` remain LF.

### Phase 2 — owner runbook (in order, or the live halves fail their preflight)

1. **Apply migrations `0022` + `0023`** remotely. The harness's config preflight (`auto_adopt_window_minutes`, `chat_queue_max_items`) is the check that they landed.
2. **Redeploy** `send-message`, `select-persona`, `job-dispatcher` at current code.
3. **Rebuild the dev client** — NetInfo is a new native module (AC-8's airplane-mode leg needs it).
4. **AC-9:** `python scripts/verify-step10.py --run-jest` → the tracker row 10 evidence.
5. **AC-8:** `python scripts/verify-step9.py --run-jest`, then the airplane-mode device leg.
6. **AC-10 + AC-2:** `$env:DAVOS_USER_JWT="…"; $env:DEV_SMOKE_TOKEN="…"; python scripts/verify-step11.py --turns 20 [--logs <file>]`, then **read the thread** and judge the tone (AC-2). AC-2's shortfall notes feed TECH-SPEC §14 item 11.
7. **AC-7:** the Android push matrix (background → notification + collapse key `chat_{userId}`; foreground → no banner, Realtime < 2 s; zero tokens → send still ok; invalid token → deleted on receipt).
8. **Two decisions:** the iOS-push budget question, and set `dev_overrides_enabled=false` before real beta users.
9. **Phase 3 (next session):** paste the audit numbers into the acceptance table, mark AC-2/7/8/9, flip tracker rows 9/10/11, commit.

### Notable / outstanding

- **The audit and the AC-2 material are the same run**, which is why the rows are kept by default: 20 turns ⊃ AC-2's 10, and deleting them would force a second real-provider conversation (and a second quota spend) just to read the tone.
- **Measured vs projected is kept explicit.** §12's 15–40 s / ≈120 s bound stays labelled a projection; the acceptance doc carries both the assertion and a pending cell per metric until the live run, so no number is asserted before it is elapsed.
- **Per-provider counts cannot be automated from the app side** — `messages.metadata` is `{persona, route, domain, rule_ids, source, user_message_id, persona_options?}` by design, and provider/latency is log-only. `--logs` is therefore a paste step, and without it the section degrades to advisory rather than failing (it must never FAIL on an unprovided artefact).
- **Known drift, recorded rather than "fixed":** `docs/DECISIONS.md` is a stale second copy of the decisions table (no `… Update` rows, unreferenced by AGENTS.md §2, last touched by `74003fc`) — left untouched; `docs/adr/decisions2.md` is the authority. `5f047bb`'s message still does not match its 17-file content (Step 9 + the round-1 web-auth fix); local-only and never pushed, so it is still free to reword.
- **AGENTS.md §9 checklist:** no new table (no RLS work) and no new secret; no new paid service (§3.1 — the iOS-push item *records* the refusal, it does not buy anything); **no new LLM/embedding call** (the harness's live section spends real provider calls, but only when the owner runs it — no production path changed), so the §12 projection stands until the audit replaces it; no regex on LLM output; no HTML/DOM change; `tactical_analysis` and `trust_score` untouched; no new job type; every doc touched updated in the same change; refs cited here and in the plan's as-built notes.
- Outstanding owner items unchanged: emotion→persona map sign-off, the `runPipeline` stage-4-before-3 deviation, the `service_role` key rotation, the Step 9 NetInfo `decisions2.md` row (if still wanted), and the demo/test-message seed data used by the verify harnesses.


