# Repair Prompt

Preamble: "You are a senior software engineer. Fix the issues below in C:\dev\DavosSeaworth. Work only on required changes; no unrelated refactoring unless necessary for a fix."

## Context — base ref, target ref, conventions

- **Base**: commit `22ccb74` ("Add FP-02 Medium-tier persona chips, select-persona function, and dev tier forcer"), branch `fp02`.
- **Target**: working tree implementing FP-02 Step 7 (Expo push) — new `lib/push.ts`, `supabase/functions/_shared/push.ts`, `supabase/migrations/0020_push_config.sql`; modified `send-message`, `select-persona`, `app/(app)/chat.tsx`, `package.json`, docs.
- **Conventions**: AGENTS.md (§2 fail-closed [SPEC] in `config`; §3.1 $0 budget; §4 RLS/service-role; §6 naming + same-change doc write-backs; §9 checklist), TECH-SPEC §7.10/§8/§11, GLOSSARY, FP-02-PLAN Step 7, D23.
- **Do not redeploy** `send-message`/`select-persona` or apply migration `0020` until items 1–2 are fixed.

## Required Changes — numbered, ordered Critical→Minor

### 1. [Critical] Add missing server `getConfigBoolean` and drop unused import — File: `supabase/functions/_shared/config.ts`, `supabase/functions/_shared/push.ts:11`

**Current code** (`push.ts:11`):
```typescript
import { getConfig, getConfigBoolean, supabaseService } from "../_shared/config.ts";
```
`config.ts` exports only `getConfig`, `getConfigNumber`, `supabaseService`. The named import does not exist, so both chat functions fail module instantiation (every invocation 500s).

**Required change:**
a) Append to `supabase/functions/_shared/config.ts` (after `getConfigNumber`):
```typescript
/**
 * Read a boolean [SPEC] config flag. Fail-closed: only a real JSON `true`
 * enables the behaviour — missing or mistyped keys throw, never silently
 * enable a surface.
 */
export async function getConfigBoolean(key: string): Promise<boolean> {
  const val = await getConfig(key);
  if (val === null) {
    throw new Error(`config key "${key}" is missing`);
  }
  if (typeof val !== "boolean") {
    throw new Error(`config key "${key}" is not boolean`);
  }
  return val;
}
```
b) In `push.ts:11`, change the import to:
```typescript
import { getConfigBoolean, supabaseService } from "../_shared/config.ts";
```

**Why:** Unblocks both Edge Functions; mirrors the client's fail-closed `requireConfigBoolean`.

**Acceptance criteria:**
- `deno check supabase/functions/send-message/index.ts` exits 0.
- `deno check supabase/functions/select-persona/index.ts` exits 0.
- No other imports touched.

### 2. [Critical] Fix invalid JSON `''` in migration 0020 — File: `supabase/migrations/0020_push_config.sql:11`

**Current code:**
```sql
('vapid_public_key', '', 'VAPID public key for Web Push (from `npx web-push generate-vapid-keys`); empty = web push falls back to in-app banner');
```

**Required change:**
```sql
('vapid_public_key', '""', 'VAPID public key for Web Push (from `npx web-push generate-vapid-keys`); empty = web push falls back to in-app banner');
```
`''` is not valid JSON and the insert into the jsonb `value` column fails; `'""'` is a JSON empty string (consistent with `0012`'s `'"none"'` string convention).

**Why:** Migration currently cannot apply, blocking `expo_push_enabled` seeding and the deploy pipeline.

**Acceptance criteria:**
- Migration applies cleanly on the linked project.
- `select key, value, jsonb_typeof(value) from config where key in ('expo_push_enabled','vapid_public_key')` returns `boolean` / `string`.

### 3. [Critical] Wire `registerPushToken` into the authenticated app lifecycle — File: `app/(app)/_layout.tsx`

**Current code:** `_layout.tsx` loads `loadConfig()` + `loadDevOverrides()` only; `registerPushToken` (defined `lib/push.ts:141`) has zero call sites.

**Required change:** import and call once per signed-in session:
```tsx
import { useRef } from 'react';
import { useAuth } from '../../lib/auth';
import { registerPushToken } from '../../lib/push';

// inside AppLayout:
const { user } = useAuth();
const registeredFor = useRef<string | null>(null);
useEffect(() => {
  if (!user || registeredFor.current === user.id) return;
  registeredFor.current = user.id;
  registerPushToken(user.id).catch((err) =>
    console.warn('[push] registration failed:', err instanceof Error ? err.message : err),
  );
}, [user]);
```
Keep it fire-and-forget (registration must never block tab render); the `registeredFor` ref prevents re-registration on every render.

**Why:** Without a call site no token ever reaches `push_tokens` and the whole E2E matrix cannot pass.

**Acceptance criteria:**
- Fresh sign-in on Android dev client inserts one `push_tokens` row (`platform='android'`).
- Second app foreground creates no duplicate row.
- iOS Expo Go logs the skip and inserts nothing.

### 4. [Major] Drive suppression by screen focus, not mount — File: `app/(app)/chat.tsx:106-117`

**Current code:**
```typescript
useEffect(() => {
  let isFocused = true;
  configureNotificationHandler(() => isFocused);
  return () => { isFocused = false; };
}, []);
```

**Required change:** use focus state so other tabs/backgrounded app still notify:
```tsx
import { useFocusEffect } from 'expo-router';
// replace the useEffect above with:
useFocusEffect(
  useCallback(() => {
    configureNotificationHandler(() => true);
    return () => configureNotificationHandler(() => false);
  }, []),
);
```
Also update the stale comment (it mentions a `thinking`-based flag that doesn't exist).

**Why:** Tabs keep ChatScreen mounted; mount-lifetime suppression silently swallows notifications while the user is elsewhere.

**Acceptance criteria:**
- Chat tab focused → OS banner suppressed, message arrives via Realtime.
- Any other tab (chat still mounted) → banner shows.
- Comment matches the implementation.

### 5. [Major] Delete only the token(s) whose receipt errored — File: `supabase/functions/_shared/push.ts:118-166`

**Current code:** `checkReceiptsAndCleanup(ticketIds, tokens.map((t) => t.token))` deletes **all** tokens when any receipt reports `InvalidCredentials`/`DeviceNotRegistered`.

**Required change:** keep a `ticketId → token` map per chunk and delete selectively:
```typescript
// at send site: const ticketToToken = new Map<string, string>();
// when pushing ticketIds: ticketToToken.set(item.id, chunk[idx].to) — restructure the
// response loop to index-based: json.data.forEach((item, i) => { if ok → map.set(item.id!, chunk[i].to) })
async function checkReceiptsAndCleanup(ticketToToken: Map<string, string>): Promise<void> {
  // ... fetch receipts ...
  for (const [ticketId, receipt] of Object.entries(json.data)) {
    if (receipt.status === "error" &&
        (receipt.details?.error === "InvalidCredentials" ||
         receipt.details?.error === "DeviceNotRegistered")) {
      const token = ticketToToken.get(ticketId);
      if (token) await deleteInvalidToken(token);
    }
  }
}
```
Remove the `break`-after-first-error and the delete-all loop.

**Why:** One stale device must not unregister every live device.

**Acceptance criteria:**
- Fixture: two tokens, one receipt errors → exactly the errored token is deleted, the other remains.
- No `break` that skips remaining errored receipts.

### 6. [Major] Await push with a bounded timeout instead of fire-and-forget — Files: `supabase/functions/send-message/index.ts:273-276`, `supabase/functions/select-persona/index.ts:259-262`

**Current code:**
```typescript
sendPush(pushPayload).catch((err) =>
  console.error("[send-message] push send failed:", err instanceof Error ? err.message : err)
);
```

**Required change (both files, adjusting the log prefix):**
```typescript
// Best-effort but guaranteed to run: bounded wait, never blocks past 5 s (150 s sync budget).
try {
  await Promise.race([
    sendPush(pushPayload),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
} catch (err) {
  console.error("[send-message] push send failed:", err instanceof Error ? err.message : err);
}
```

**Why:** Unawaited promises may never execute once the Edge Function returns its response; awaiting with a 5 s race keeps the sync path fast while guaranteeing the send is attempted.

**Acceptance criteria:**
- `deno check` passes on both functions.
- Reply latency increases by at most ~exp.host RTT (no 5 s penalty on success — the race resolves on send completion).

### 7. [Major] Create the Android notification channel before fetching the token — File: `lib/push.ts` (Android branch of `registerPushToken`)

**Required change:** after permission grant, before `getExpoPushToken()`:
```typescript
if (Platform.OS === "android") {
  await Notifications.setNotificationChannelAsync("default", {
    name: "Davos messages",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}
```
Matches the `channelId: "default"` the server already sends.

**Why:** Android 8+ requires a channel; without it the headline Android verify fails or arrives silent.

**Acceptance criteria:**
- Fresh Android registration creates the channel (no warning in logcat about missing channel).
- Backgrounded-app notification renders with sound/badge per defaults.

### 8. [Minor] Fix Expo-Go detection, platform label, upsert staleness, fail-open default — File: `lib/push.ts`, `supabase/functions/_shared/push.ts`

**Required changes:**
a) `isIOSExpoGo` → `return Platform.OS === "ios" && Constants.appOwnership === "expo";`
b) Platform label → `Platform.OS === "android" ? "android" : Platform.OS === "web" ? "web" : "ios"`.
c) Upsert: remove `ignoreDuplicates: true` (plain upsert on `(user_id, token)` conflict updates `platform`; idempotency already guaranteed by the conflict target).
d) `push.ts:49`: `.catch(() => true)` → `.catch(() => false)` with a log line, so a config outage disables push (fail-closed, AGENTS.md §2).

**Why:** (a) physical iPhones in Expo Go have `isDevice === true`, so the current check misses; (b) future iOS native would be stored as `web`; (c) label corrections can never persist otherwise; (d) fail-open contradicts repo policy.

**Acceptance criteria:**
- iPhone Expo Go → skip path; Android → `android`; web → `web`.
- Re-registration updates a changed `platform`.
- Missing `expo_push_enabled` key → push skipped + error logged.

### 9. [Minor] Correct the phantom VAPID-secret docs — Files: `docs/GLOSSARY.md:281-282`, `docs/TECH-SPEC.md:534`

**Required change:** reword both entries to state that `EXPO_VAPID_PRIVATE_KEY` is **reserved, not yet consumed** (no server code reads it; VAPID is used at web token creation), and note `app.json → expo.extra.vapidPublicKey` wiring as pending owner-manual. Do not invent a server consumer.

**Why:** Docs currently claim `_shared/push.ts` uses the secret for web tokens; it does not.

**Acceptance criteria:**
- No doc sentence asserts a code path that doesn't exist.
- Owner-manual VAPID step (`generate-vapid-keys` → `app.json` → secret) recorded as pending.

## Tests to Run

```bash
# Edge functions typecheck (would have caught item 1 pre-commit)
deno check supabase/functions/send-message/index.ts
deno check supabase/functions/select-persona/index.ts

# Client typecheck + lint + unit tests
npx tsc --noEmit
npx eslint lib/push.ts "app/(app)/_layout.tsx" "app/(app)/chat.tsx"
npx jest --ci
```

Owner-manual E2E (unchanged from PROGRESS.md): backgrounded Android app → web send → notification + tap opens chat; foregrounded chat → no banner, Realtime < 2 s; backgrounded web tab → browser notification (record browser); zero-token user → send succeeds; invalid token → only that token deleted.

## Constraints — no public API changes unless explicitly required; minimal focused diffs; update tests/docs if required; follow project style

- No `send-message`/`select-persona` response-shape changes (push stays out of the contract).
- Keep raw-`fetch` (no Expo server SDK — Deno constraint); keep collapse key `chat_{userId}`; keep best-effort semantics via the 5 s race.
- No new paid services, devices, or infra (§3.1); no secrets in client/migrations/docs (§4.5).
- Update PROGRESS.md Step 7 entry: correct the "`(app)/_layout.tsx`" call-site claim once item 3 lands; record E2E results.

## Definition of Done — all changes applied; tests pass; no new lint/type errors; summary of changes + test results provided

- [ ] Items 1–9 applied; `deno check` × 2, `tsc`, `eslint`, `jest` all green.
- [ ] Migration `0020` applied; `jsonb_typeof` output recorded.
- [ ] Dev client rebuilt (`expo-notifications` native module); both functions redeployed.
- [ ] Owner E2E matrix run with results in PROGRESS.md; review verdict re-evaluated.
