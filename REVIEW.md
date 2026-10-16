# Code Review: DavosSeaworth 22ccb74..working-tree (FP-02 Step 7 — Expo push)

## Summary — what changed + overall assessment

Delta since `22ccb74` implements **FP-02 Step 7 (Expo push: registration + server send + suppression)** as working-tree changes (9 modified files + 3 new untracked files):

- **New** `lib/push.ts` (214 lines): client token registration (`registerPushToken`), foreground-suppression handler setup, notification-response listener.
- **New** `supabase/functions/_shared/push.ts` (224 lines): server push sender via raw `fetch` to `exp.host`, collapse key `chat_{userId}`, receipt-based invalid-token cleanup, AI/high-priority payload helpers.
- **New** `supabase/migrations/0020_push_config.sql`: config keys `expo_push_enabled`, `vapid_public_key`.
- **Modified** `send-message` + `select-persona`: fire-and-forget `sendPush()` after reply insert.
- **Modified** `app/(app)/chat.tsx`: installs foreground-suppression handler on mount.
- **Modified** `package.json`: adds `expo-notifications`, `expo-device`, bumps `expo-constants`.
- **Docs**: TECH-SPEC §7.10/§11, GLOSSARY, FP-02-PLAN (Steps 5b/6 ✅, Step 7 ▶), PROGRESS.md entry.

**Overall assessment:** Structure follows the plan and conventions (Deno-safe raw fetch, collapse key, best-effort send, doc write-backs in the same change). But the delta has **three Critical defects that each independently prevent Step 7's verify from passing** — a broken server import that would 500 both chat functions on deploy, a migration that cannot apply, and a registration entry point that is never called. Plus four Major correctness/data-integrity issues. The step is not mergeable as-is.

## Verdict — Request changes

## Findings

### Critical

**CR-001 — Server `push.ts` imports non-existent `getConfigBoolean`; breaks both chat functions on deploy** / Category: correctness / File: `supabase/functions/_shared/push.ts:11` / Evidence: `import { getConfig, getConfigBoolean, supabaseService } from "../_shared/config.ts";` but `supabase/functions/_shared/config.ts` (lines 1–40, full file) exports only `getConfig`, `getConfigNumber`, `supabaseService` — no `getConfigBoolean`. ESM named-import mismatch fails module instantiation, and both `send-message/index.ts` and `select-persona/index.ts` now import `../_shared/push.ts`, so **every invocation of both functions would 500** after redeploy. / Impact: total chat outage on deploy (no sends, no persona taps). / Suggested fix: add `getConfigBoolean` to `supabase/functions/_shared/config.ts` (fail-closed: only JSON `true` returns true, else throw like `getConfigNumber`): `export async function getConfigBoolean(key: string): Promise<boolean> { const val = await getConfig(key); if (val === null) throw new Error(...missing...); if (typeof val !== "boolean") throw ...not boolean...; return val; }` and in `push.ts` drop the unused `getConfig` import. / Effort: small

**CR-002 — Migration `0020` inserts invalid JSON `''` into jsonb; migration cannot apply** / Category: data integrity / File: `supabase/migrations/0020_push_config.sql:11` / Evidence: `('vapid_public_key', '', ...)` — `value` is jsonb and `''` is not valid JSON (`SELECT ''::jsonb` → `invalid input syntax for type json`). Contrast the file's own siblings: `0012` quotes strings as JSON (`'"none"'`), `0018` notes "quoted numbers are parsed as JSON numbers". An empty JSON string must be written `'"\""'`. / Impact: `0020` fails on apply; `expo_push_enabled` never seeds; deploy pipeline blocked. / Suggested fix: change the row to `('vapid_public_key', '""', ...)` (JSON empty string) and record `jsonb_typeof` expectations (`boolean`, `string`) in the verify comment. / Effort: small

**CR-003 — `registerPushToken` is defined but never called; no token ever reaches `push_tokens`** / Category: correctness / File: `lib/push.ts:141` + `app/(app)/_layout.tsx:1-28` / Evidence: grep for `registerPushToken` hits only its definition (`lib/push.ts:141`) and the PROGRESS.md description. PROGRESS.md claims it is "Called once on auth completion from (app)/_layout.tsx", but `_layout.tsx` loads only `loadConfig()` + `loadDevOverrides()` — no import, no call. `configureNotificationHandler` is wired in `chat.tsx`; registration is not wired anywhere. / Impact: `push_tokens` stays empty, `sendPush` always exits at "No tokens", and the entire Step-7 E2E matrix (background notification on Android/Web) cannot pass. The feature is dead code as committed. / Suggested fix: call `registerPushToken(user.id)` once per authenticated session from `(app)/_layout.tsx` (guard with a ref so it runs once per user id, fire-and-forget with `.catch` logging; gate on `config.status === 'loaded'` is unnecessary — registration needs no [SPEC]). / Effort: small

### Major

**MAJ-001 — Foreground suppression uses mount flag, not focus; backgrounded app suppresses its own notifications** / Category: correctness / File: `app/(app)/chat.tsx:106-117` / Evidence: `let isFocused = true; configureNotificationHandler(() => isFocused);` — true for the whole mount lifetime. With Expo Router Tabs, `ChatScreen` stays mounted while the user is on Journal/Dashboard/Settings tabs or the app is backgrounded (OS keeps the JS context briefly). The comment even admits "a simple mount flag". The plan requires suppression only "when the chat screen is focused". / Impact: user on another tab (or app backgrounded with chat mounted) gets **no banner and no in-app render** — silently missed AI replies, the exact failure Step 7 exists to prevent. / Suggested fix: use `useFocusEffect` (expo-router) or `useIsFocused()` to drive the flag: set true on focus, false on blur, instead of mount/unmount. / Effort: small

**MAJ-002 — One bad receipt deletes ALL of the user's tokens** / Category: data integrity / File: `supabase/functions/_shared/push.ts:148-160` / Evidence: on any receipt with `InvalidCredentials`/`DeviceNotRegistered`, the loop `for (const token of allTokens) { await deleteInvalidToken(token); }` deletes every token, then `break`. The comment concedes "For simplicity, we check all tokens". / Impact: one expired device (e.g., old phone) silently unregisters all live devices — user stops getting pushes everywhere with no error surfaced. / Suggested fix: map ticket id → token (Expo returns tickets in request order; keep a `ticketId → token` map per chunk) and delete only the token(s) whose receipt errored. / Effort: medium

**MAJ-003 — `sendPush` is fire-and-forget from Edge Functions; the runtime may kill it before it runs** / Category: reliability / File: `supabase/functions/send-message/index.ts:273-276`, `supabase/functions/select-persona/index.ts:259-262` / Evidence: `sendPush(pushPayload).catch(...)` is not awaited before `return json(...)`. Once the response is returned the isolate may suspend; background work is not guaranteed in Supabase Edge Functions. "Best-effort, never blocks" is the right intent, but fire-and-forget-after-response is not a mechanism — it is a hope. / Impact: pushes silently never sent under load/cold-start; Step-7 verify passes locally (warm) then flakes in production. / Suggested fix: `await` the send with a bounded timeout so the sync path stays fast but guaranteed: `await Promise.race([sendPush(payload), new Promise(r => setTimeout(r, 5000))]).catch(log)` placed before the `return json(...)`. 5 s is well inside the 150 s sync budget and covers exp.host RTT. / Effort: small

**MAJ-004 — No Android notification channel; Android 8+ may silence or drop the notification** / Category: correctness / File: `lib/push.ts` (whole file — no `setNotificationChannelAsync` anywhere) / Evidence: server sends `channelId: "default"` (`_shared/push.ts:78`) but the client never creates a channel. Android 8+ requires a channel or notifications arrive silent/misgrouped depending on OEM. / Impact: the headline Android verify ("background the app → notification arrives") fails or arrives silent on most test devices. / Suggested fix: in `registerPushToken` (Android branch), call `Notifications.setNotificationChannelAsync("default", { name: "Davos messages", importance: Notifications.AndroidImportance.DEFAULT })` before fetching the token. / Effort: small

### Minor

**MIN-001 — `isIOSExpoGo` misdetects real iPhones in Expo Go** / Category: correctness / File: `lib/push.ts:39-41` / Evidence: `Platform.OS === "ios" && !Device.isDevice && __DEV__` — a physical iPhone in Expo Go has `isDevice === true`, so the guard misses and execution falls through to `requestPermissions()` (whose iOS branch returns `false`, so behavior is accidentally safe). The canonical check is `Constants.appOwnership === "expo"`. / Suggested fix: `return Platform.OS === "ios" && Constants.appOwnership === "expo";`. / Effort: small

**MIN-002 — Platform mislabel: non-Android native registers as `web`** / Category: correctness / File: `lib/push.ts:161` / Evidence: `const platform = Platform.OS === "android" ? "android" : "web";` — a future iOS native build (or any native non-Android) writes `platform='web'`. `push_tokens.platform` allows `ios`. / Suggested fix: `Platform.OS === "android" ? "android" : Platform.OS === "web" ? "web" : "ios"`. / Effort: small

**MIN-003 — `ignoreDuplicates: true` silently drops token/platform updates** / Category: correctness / File: `lib/push.ts:94-103` / Evidence: `upsert(..., { onConflict: "user_id,token", ignoreDuplicates: true })` — a re-registration that changes `platform` for an existing token is ignored. Combined with MIN-002, a corrected label would never persist. / Suggested fix: remove `ignoreDuplicates` (plain upsert updates `platform`) — the `(user_id, token)` conflict target already guarantees idempotency. / Effort: small

**MIN-004 — Master toggle fails open** / Category: reliability / File: `supabase/functions/_shared/push.ts:49` / Evidence: `await getConfigBoolean("expo_push_enabled").catch(() => true)` — a missing/misconfigured key enables pushes, contradicting the repo's fail-closed rule (AGENTS.md §2; client `requireConfigBoolean` throws on anything but JSON `true`). / Suggested fix: `.catch(() => false)` + log, so a config outage disables push rather than sending ungoverned. / Effort: small

**MIN-005 — Docs reference a VAPID secret nothing reads** / Category: docs / File: `docs/GLOSSARY.md:281-282`, `docs/TECH-SPEC.md:534` / Evidence: `EXPO_VAPID_PRIVATE_KEY` / `vapid_private_key` are registered and described ("used by `_shared/push.ts` for web tokens") but `_shared/push.ts` never reads any VAPID secret (Expo push send needs no VAPID server-side; VAPID is used at web token creation). `app.json` is also untouched — `expo.extra.vapidPublicKey` is never set, so `getVapidPublicKey()` always returns null until the owner manual step. / Suggested fix: either wire the secret (if a future web-push path needs it) or downgrade the entries to "reserved for the owner VAPID step" and note `app.json` wiring as pending owner-manual. / Effort: small

**MIN-006 — Unused import `getConfig`** / Category: style / File: `supabase/functions/_shared/push.ts:11` / Evidence: `getConfig` is imported but never referenced (only `getConfigBoolean` and `supabaseService` are used). Deno lint (`no-unused-vars`) will flag it. / Suggested fix: remove `getConfig` from the import (do in the CR-001 edit). / Effort: trivial

### Nit

**NIT-001 — Stale comment describes `thinking`-based focus that isn't implemented** / File: `app/(app)/chat.tsx:106-112` ("We track focus via the `thinking` state ... and a simple mount flag") — only the mount flag exists. Update the comment in the MAJ-001 fix.

**NIT-002 — Dead client exports** / `unregisterPushToken` and `addNotificationResponseListener` are exported but never called; receipt cleanup runs server-side. Keep or remove, but don't ship unused surface without a call site — fold into the CR-003 wiring change.

## Needs Verification

- **NV-01 — `expo_push_enabled`/`vapid_public_key` jsonb types after migrate**: after fixing CR-002, confirm `select key, value, jsonb_typeof(value)` yields `boolean`/`string`. No live DB access was available in this review.
- **NV-02 — Expo Go Android token issuance**: `getExpoPushTokenAsync` in a dev client requires the EAS project id (`extra.eas.projectId` present in `app.json` — confirm) and network to `exp.host`. The Step-7 E2E matrix (background notify, foreground suppression <2 s, zero-token send, invalid-token cleanup) remains owner-manual and unrun.
- **NV-03 — Web push path**: no `web-push` dependency is added and no service-worker/push-receipt handling exists; browser behavior (Chrome vs Firefox vs Safari) is unrecorded. Acceptable per plan (fallback = in-app banner), but record the tested browser in the verify.

## Positive Notes

- Deno-safe raw `fetch` to `exp.host` with no SDK import (§3.2 constraint respected); chunked sends (100/chunk) per Expo guidance.
- Collapse key `chat_{userId}` on every message; `default` vs `high` priority split preserves the intervention semantics for later steps.
- Push send placement is after the reply insert in both functions — a push failure can never corrupt the thread or duplicate a reply.
- Token logging truncates at 20 chars (`lib/push.ts:169`, `_shared/push.ts:178`) — no secret material in logs.
- iOS-budget handling is honest: skip + log + §13 live-item trace instead of pretending support.
- Doc write-backs landed in the same change (TECH-SPEC §7.10/§11, GLOSSARY, PLAN tracker, PROGRESS) per AGENTS.md §6.

## Test Coverage — existing, gaps, recommended tests

- Existing: none for the new code — no `lib/push.test.ts`, no Deno tests for `sendPush`/receipt mapping. The plan's verify is E2E-only (owner-manual), so unit coverage is a genuine gap for pure logic (`createAiMessagePushPayload` truncation, ticket→token mapping after MAJ-002 fix, `getVapidPublicKey` null path).
- Recommended: (1) unit test payload truncation at 100 chars; (2) unit test that only errored tickets' tokens are deleted (regression guard for MAJ-002); (3) `deno check` on `send-message`/`select-persona` after CR-001 (would have caught the broken import pre-commit); (4) owner E2E matrix from PROGRESS.md unchanged.

## Risk Assessment — merge/deploy risk, rollback, affected areas

- **Deploy risk is the headline**: merging + redeploying functions as-is breaks all chat sends (CR-001 import error). Do not redeploy `send-message`/`select-persona` until CR-001 is fixed. Migration `0020` must not be applied until CR-002 is fixed.
- Rollback: migration is additive (2 config rows) once fixed; client changes are additive (one handler + deps). Function changes are 7-line insertions each — safe to revert independently.
- Affected areas: every chat send and every persona tap (both functions touched); Android manifest surface via `expo-notifications` (requires dev-client rebuild — PROGRESS.md already flags the stale-client failure mode).

## Recommended Next Steps — ordered actions

1. Fix CR-001 (add server `getConfigBoolean`, drop unused import) + run `deno check` on both functions.
2. Fix CR-002 (`'""'` for the empty VAPID key) and apply `0020` to the linked project; record `jsonb_typeof` output.
3. Fix CR-003 (call `registerPushToken` from `(app)/_layout.tsx` once per session).
4. Fix MAJ-001 (focus-driven suppression), MAJ-002 (ticket→token map), MAJ-003 (await with 5 s race), MAJ-004 (Android channel).
5. Apply MIN-001–MIN-006 + NIT-001/NIT-002 in the same repair commit.
6. Rebuild dev client (`expo-notifications` native module), redeploy both functions, run the owner E2E matrix (NV-02/NV-03).
