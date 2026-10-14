# FP-01 Acceptance Checklist

**Generated:** 2026-10-11
**Updated:** 2026-10-14 (per FP-01-REVIEW.md gaps G-01, G-02)
**Updated:** 2026-10-14 (gaps G-01, G-02 resolved)
**Status:** 11/11 ACs passed — all gaps resolved

---

## Acceptance Criteria Results

| AC | Description | Status | Evidence |
|----|-------------|--------|----------|
| **AC-1** | `npx expo start` serves web; Expo Go opens app on iOS; Android build installs. All five routes reachable; chat is landing route. | ✅ PASS | Web server runs on port 8081; routes `(app)/chat`, `(app)/journal`, `(app)/dashboard`, `(app)/settings`, `(onboarding)/interview` accessible; chat is first tab |
| **AC-2** | Google sign-in and OTP code sign-in succeed on all three platforms; each creates `auth.users` + exactly one `profiles` row with FR-4 defaults. | ✅ PASS | OTP code tested on web ✅; Google OAuth tested on web ✅; iOS Expo Go + Google OAuth tested ✅; Android dev build + Google OAuth tested ✅; Android dev build + OTP code tested ✅; each creates `profiles` with `onboarding_stage='intro'`, `checkin_cadence_minutes=60`, `checkin_active_hours_start='08:00'`, `checkin_active_hours_end='22:00'`, `dialog_state='OPEN'` |
| **AC-3** | OTP code email arrives within 5 minutes (SMTP check result recorded per FR-10c). | ✅ PASS | 6-digit OTP code emails observed arriving within 2–5 minutes during Step 4 testing; code expiry 60 min (otp_expiry=3600s) |
| **AC-4** | Two-account RLS test: account A sees zero rows of account B in `messages`, `doings_logs`, `profiles`; anonymous API access returns zero rows. | ✅ PASS | RLS policies on all user-scoped tables enforce `auth.uid() = user_id`; tested with two Supabase auth users |
| **AC-5** | `health` returns 200 from public URL; cron-job.org dashboard shows successful pings over 24 h. | ✅ PASS | `curl https://<project>.supabase.co/functions/v1/health` → `200 {"ok":true,"timestamp":"..."}` ✅; cron-job.org job configured every 6h ✅; 24h green streak confirmed on cron-job.org dashboard; Day-8 calendar reminder set |
| **AC-6** | Insert `smoke_test` job → within 2 min status transitions `pending → running → done`. Insert with `{"fail":true}` → observe `attempts` incrementing with backoff intervals → status `dead` at 5. | ✅ PASS | Dispatcher processes jobs via pg_cron tick; `smoke_test` handler: no-op → `done`; `{"fail":true}` → exponential backoff (30s, 60s, 120s, 240s) → `dead` at attempt 5 |
| **AC-7** | Service-role insert of test row into `messages` for signed-in user renders in open chat screen within 2 s via Realtime; row for different user does not render. | ✅ PASS | Realtime subscription on `messages` with `filter: user_id=eq.{user.id}`; verified cross-user isolation |
| **AC-8** | `select * from config` returns every §11 key with approved values. | ✅ PASS | 12 config keys seeded in migration 0001: `confidence_bands`, `emotion_labels`, `trust_threshold`, `strike_watch_days_default`, `preemptive_lead_minutes`, `habit_detection_thresholds`, `checkin_cadence_default`, `watchdog_grace_minutes`, `lockdown_circuit_breaker_hours`, `sliding_window_messages`, `sync_degrade_reply`, `malformed_fallback_reply` |
| **AC-9** | TECH-SPECS §13 items 1–3 updated to "verified" with dated results; `smoke_test` registered in §2.3 + GLOSSARY §12. | ✅ PASS | All three §13 items marked VERIFIED 2026-10-11; `smoke_test` added to TECH-SPECS §2.3 (15th row, dev-only) and GLOSSARY §12 |
| **AC-10** | Secret scan of client bundle and migrations: clean. | ✅ PASS | `grep -rE "service_role|SUPABASE_SERVICE|sk-" --include="*.{ts,tsx,json,sql}" app lib supabase` → no matches; client bundle contains only URL + anon key |
| **AC-11** | Kill dispatcher mid-job (deploy sleep variant) → after 5 min job resets to `pending` and re-executes (lease recovery, §2.2.3). | ✅ PASS | Lease recovery tested: deployed handler with 60s sleep, started job, redeployed normal handler → after 5 min stale `running` row reset to `pending` and completed on next tick |

## Updated Acceptance Criteria Results

| AC | Description | Status |
|----|-------------|--------|
| **AC-1** | Expo Router app on all 5 routes | ✅ PASS |
| **AC-2** | Auth round-trips on iOS/Android/Web (Google OAuth + OTP code) | ✅ PASS |
| **AC-3** | OTP code email ≤5 min | ✅ PASS |
| **AC-4** | Two-account RLS isolation | ✅ PASS |
| **AC-5** | Health + 24h cron-job.org green | ✅ PASS |
| **AC-6** | smoke_test job success/backoff/dead | ✅ PASS |
| **AC-7** | Realtime chat own/cross-user | ✅ PASS |
| **AC-8** | Config table all §11 keys | ✅ PASS |
| **AC-9** | §13 verified + smoke_test in docs | ✅ PASS |
| **AC-10** | Secret scan clean | ✅ PASS |
| **AC-11** | Lease recovery works | ✅ PASS |

---

## Additional Verification

### Code Quality
- ✅ TypeScript compiles cleanly (`npx tsc --noEmit`)
- ✅ No HTML/DOM elements in app code (React Native primitives only)
- ✅ No regex post-processing of LLM output (no LLM calls in FP-01)
- ✅ No unbounded retry loops
- ✅ All RLS policies present on user-scoped tables

### Documentation Updates (Same Commit)
- ✅ TECH-SPECS §2.3: Added `smoke_test` as 15th row (dev-only)
- ✅ GLOSSARY §12: Added `smoke_test` entry
- ✅ TECH-SPECS §13: Items 1–3 marked VERIFIED with dated results

### Secrets & Security
- ✅ No `service_role` key in client code or migrations
- ✅ `verify_jwt = false` only on `health` function (public endpoint)
- ✅ `claim_jobs()` function restricted to `service_role` only
- ✅ Edge Functions use `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` internally

---

## Owner Manual Items

- ✅ Supabase project created (free tier)
- ✅ Google OAuth client configured (web, Expo Go, Android)
- ✅ Supabase Auth: OTP code + Google provider enabled
- ✅ cron-job.org account created, job scheduled for `health` endpoint every 6h
- ✅ **G-01**: Native auth round-trips completed (iOS Expo Go + Android dev build: Google OAuth + OTP code)
- ✅ **G-02**: 24h cron-job.org green streak confirmed + Day-8 calendar reminder set

---

## Sign-off

**FP-01 implementation complete.** 11/11 ACs pass. All gaps resolved.

Per FP-01-REVIEW.md: G-01 and G-02 resolved. FP-02 build can proceed.