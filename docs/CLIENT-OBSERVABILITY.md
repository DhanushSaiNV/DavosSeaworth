# Client-Side Observability & Diagnostics Guide

> **Audience:** AI agents, contributors, and engineers implementing features in Davos.  
> **Authority:** `AGENTS.md §7.8`, `TECH-SPECS §4.1`, `decisions2.md D1`.

---

## 1. Overview & Constraints

Davos is built under a **$0 infrastructure budget** with **all compute running inside Supabase** (`AGENTS.md §3.1–3.2`). Traditional paid APM services, remote error monitoring platforms (e.g. Sentry, Datadog), and external OpenTelemetry collectors are strictly out of scope.

However, mobile client debugging on physical devices or standalone builds (where Metro terminal logs are detached) requires instant, structured visibility into:
1. Async network calls to Supabase Edge Functions.
2. Device push token and notification permission latches.
3. Offline message and check-in queues.
4. Uncaught render errors and unhandled promise rejections.

To satisfy these requirements without external servers or paid dependencies, Davos provides a **centralized, zero-dependency client observability subsystem** (`lib/logger.ts`, `lib/observability.ts`, and `components/ui/DiagnosticsModal.tsx`).

---

## 2. Core Rules for AI Coding Agents

When implementing or modifying any client-side code (`app/` or `lib/`), all AI agents must follow these binding rules:

### Rule 1: Never Use Raw `console.*`
* **Banned:** `console.log(...)`, `console.warn(...)`, `console.error(...)`, `console.info(...)`.
* **Required:** Always import and use `logger` from `lib/logger`:
  ```typescript
  import { logger } from '../lib/logger'; // or '../../lib/logger'
  ```
* **Why:** Raw `console.*` calls trigger ESLint `no-console` warnings, produce unformatted string noise, and vanish when testing on physical devices without an active debugger.

### Rule 2: Always Specify a Valid Subsystem Tag
Every logger method requires a `Subsystem` as its first parameter:
```typescript
export type Subsystem =
  | 'app'      // Root shell, navigation, global lifecycle, unhandled errors
  | 'auth'     // Authentication, session recovery, OAuth callback, OTP verification
  | 'chat'     // Messaging, send queue, optimistic bubbles, Realtime channel
  | 'checkin'  // Hourly check-in scheduler, notification response, energy rating
  | 'push'     // Expo push token registration, Android notification channels
  | 'journal'  // Evening reflection workspace, client-side unsavable strip
  | 'net'      // Connectivity transitions (NetInfo), offline detection
  | 'dev';     // Developer overrides, test triggers, mock simulators
```

### Rule 3: Use the Appropriate Severity Level
* `logger.debug(subsystem, message, data?)`: High-frequency diagnostic events (e.g. queue checks, render cycles).
* `logger.info(subsystem, message, data?)`: Normal operational milestones (e.g. session established, push token registered, network connected).
* `logger.warn(subsystem, message, data?, error?)`: Recoverable anomalies or expected degrade paths (e.g. offline queueing, notification permission denied, cache miss).
* `logger.error(subsystem, message, data?, error?)`: Unexpected failures or contract violations (e.g. Edge Function 500, unhandled render error, unparsable storage).

### Rule 4: Strictly Respect Privacy & Security Boundaries
`logger` automatically runs `sanitizeData` on all metadata objects to redact sensitive keys:
* Redacted keys: `password`, `token`, `secret`, `api_key`, `authorization`, `access_token`, `refresh_token`, `tactical_analysis`, `unsavable`.
* **Agent Requirement:** Even with automatic sanitization, **never** pass raw user journal text, secret credentials, or server-only `tactical_analysis` into logging calls (`AGENTS.md §4.2, §4.3`).

### Rule 5: Trace Network Calls with `traceNetworkCall`
For asynchronous network operations (such as calling Supabase Edge Functions or REST endpoints), wrap the call with `traceNetworkCall` from `lib/observability`:
```typescript
import { traceNetworkCall } from '../lib/observability';

const response = await traceNetworkCall(
  'chat',
  'invokeSendMessage',
  () => fetch(url, options),
  { clientMessageId: item.clientMessageId }
);
```
`traceNetworkCall` will automatically:
1. Log `[trace:start]`.
2. Measure execution duration in milliseconds.
3. Log `[trace:ok] (Xms)` on success or `[trace:fail] (Xms)` with error details on rejection.
4. Re-throw the original error without altering control flow.

---

## 3. How to Use in Feature Implementation

### Example 1: Standard Operational Event
```typescript
import { logger } from '../lib/logger';

// User completed onboarding step
logger.info('auth', 'Onboarding interview finished', {
  selectedDomainsCount: domains.length,
});
```

### Example 2: Catching and Logging a Recoverable Error
```typescript
import { logger } from '../lib/logger';

try {
  await AsyncStorage.setItem(key, value);
} catch (err) {
  logger.warn('dev', 'Failed to cache developer overrides', { key }, err);
}
```

### Example 3: Wrapping an API Call with Network Tracing
```typescript
import { traceNetworkCall } from '../lib/observability';

try {
  const result = await traceNetworkCall(
    'checkin',
    'submitCheckIn',
    async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-checkin`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
    { windowTs }
  );
} catch (err) {
  // Handled cleanly; traceNetworkCall already recorded duration and failure
}
```

---

## 4. In-App Diagnostics & Device Debugging

The in-app diagnostics tool is available without external dependencies or developer builds:

* **Entry Point:** Settings (`app/(app)/settings.tsx`) → **Diagnostics & Logs** card → tap **Open System Diagnostics**.
* **Error Boundary:** If a component encounters an unhandled render error, the root `ErrorBoundary` in `app/_layout.tsx` catches it, logs the stack to `logger.error('app', ...)`, and presents a recovery screen with a **View Diagnostics & Logs** button.
* **Capabilities for Beta Testers & Developers:**
  * Real-time list of the last 150 structured log events.
  * Instant filter chips for `Errors`, `Warnings`, and subsystems (`Chat`, `Checkin`, `Net`, etc.).
  * Expandable rows displaying sanitized JSON data and full stack traces.
  * **Raw Text View / Copy All:** One-tap export to clipboard or selectable text for attaching to GitHub issues or chat.

---

## 5. Verification Checklist for Agents

Before completing any task touching client code, verify:
- [ ] Zero raw `console.log`, `console.warn`, or `console.error` in the modified files.
- [ ] All logs import and use `logger` with an explicit `Subsystem`.
- [ ] No sensitive keys or private user journal text are logged.
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run lint` passes with 0 errors.
