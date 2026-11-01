# RECON.md — Davos Frontend Reconnaissance Report

**Mode:** MODE C (Audit / Reconnaissance)  
**Date:** 2026-11-01  
**Governing Documents:** `AGENTS.md`, `design/DESIGN_PRD.md`, `design/ANALYSIS.md`

---

## 1. Runtime & Package Versions

*Source: `package.json`*

- **Expo SDK Version:** `57` (`"expo": "^57.0.27"`)
- **Expo Router Version:** `57` (`"expo-router": "~57.0.25"`)
- **React Native Version:** `0.86.3` (`"react-native": "0.86.3"`)
- **React Version:** `19.2.3` (`"react": "19.2.3"`)
- **`expo-notifications` Installed:** **Yes** (`"expo-notifications": "~57.0.23"`)

---

## 2. Route Tree (`app/`)

Every route/file under `app/` and its one-line purpose:

| File Path | One-line Purpose |
| :--- | :--- |
| `app/+html.tsx` | Web HTML document template configuring viewport metadata, typography, and dark/light color-scheme styles. |
| `app/_layout.tsx` | Root layout managing Supabase authentication session state, ThemeProvider, fonts, and splash screen dismissal. |
| `app/index.tsx` | Root entry router that redirects authenticated users to `/(app)/chat` (or onboarding) and unauthenticated users to `/sign-in`. |
| `app/sign-in.tsx` | Entry authentication screen providing email OTP login ("Send Magic Link") and Google OAuth trigger. |
| `app/verify-code.tsx` | 6-digit email OTP verification screen with resend countdown timer and error state handling. |
| `app/auth/callback.tsx` | OAuth callback redirect handler that extracts token parameters, sets the session, and navigates to `/(app)/chat`. |
| `app/(app)/_layout.tsx` | Authenticated bottom tab layout that registers push tokens and triggers check-in scheduler re-arm on AppState changes. |
| `app/(app)/chat.tsx` | Main conversation thread with Davos, message history, optimistic bubbles, check-in composer mode, energy chips, and impulse logging. |
| `app/(app)/dashboard.tsx` | Legacy beta telemetry screen showing habit streaks, compliance KPIs, and momentum metric chips. |
| `app/(app)/journal.tsx` | Evening journal screen displaying daily entries, unsavable privacy toggle, and manual reflection input. |
| `app/(app)/settings.tsx` | User preferences screen configuring check-in cadence (60/120 min), active hours start/end, and timezone sync. |
| `app/(onboarding)/_layout.tsx` | Stack layout container wrapping initial onboarding routes. |
| `app/(onboarding)/interview.tsx` | Intake onboarding conversation guiding profile establishment, initial metric selection, and oath capture. |

---

## 3. Data Layer & ORCA Object Mapping

*Sources: `lib/`, `design/DESIGN_PRD.md` §3, `design/ANALYSIS.md` §1.3*

### 3.1. Thread (Object: Thread / Messages)
- **`fetchMessages`** (`app/(app)/chat.tsx`):
  - *Inputs:* `userId` (string), `limit` (number, default 50).
  - *Outputs:* `ChatMessage[]` from Supabase `messages` table ordered by `created_at desc`.
- **`sendMessage`** (`lib/chat.ts`):
  - *Inputs:* `{ clientMessageId: string, content: string, clientSentAt: string, oathConfirmed?: boolean, oathRequestId?: string | null }`.
  - *Outputs:* `{ status: 'ok' | 'duplicate', user_message_id: string, assistant_message_id: string }` via Edge Function `send-message`.
- **Realtime Message Listener** (`app/(app)/chat.tsx`):
  - *Inputs:* `supabase.channel('messages')` filtered by `user_id=eq.${userId}`.
  - *Outputs:* Stream of incoming assistant messages and secondary replies.
- **`markUnsavable`** (`lib/memoryFlag.ts`):
  - *Inputs:* `messageId: string`.
  - *Outputs:* `{ ok: boolean, status: number }` via Edge Function `flag-unsavable` (strips memory client-side and flags DB row).
- **Offline Send Queue** (`lib/sendQueue.ts`):
  - *Inputs:* Pending outgoing user messages.
  - *Outputs:* AsyncStorage backed queue (`@davos:send-queue`) with automatic sequential replay on network reconnection.

### 3.2. Check-in (Object: Check-in)
- **`submitCheckIn`** (`lib/checkins.ts`, `app/(app)/chat.tsx`):
  - *Inputs:* `{ content: string, capture: 'reply' | 'chat', windowTs: string | number }`.
  - *Outputs:* `{ status: 'ok' | 'duplicate', doing_id: string, energy: number | null, eval_ran: boolean, intervention: boolean, user_message_id?: string, assistant_message_id?: string }` via Edge Function `submit-checkin`.
- **`patchEnergy`** (`app/(app)/chat.tsx`):
  - *Inputs:* `{ doing_id: string, energy: number }`.
  - *Outputs:* `{ status: 'ok', doing_id: string, energy: number }` via `PATCH /functions/v1/submit-checkin`.
- **`armCheckins` / `scheduleNotifications`** (`lib/checkins.ts`):
  - *Inputs:* `userId: string`.
  - *Outputs:* Pre-schedules deterministic 24-hour rolling local notifications via `expo-notifications` at window close instants; cancels answered windows.
- **`onCheckinTap`** (`lib/checkins.ts`):
  - *Inputs:* Callback listener `(windowTs: number) => void`.
  - *Outputs:* Unsubscribe function; delivers live or cold-start notification tap timestamps to the composer.
- **`resolveCheckInWindowTs`** (`lib/checkinUi.ts`):
  - *Inputs:* `{ payloadWindowTs?: number | null, grid: Grid | null, nowMs: number, userId: string }`.
  - *Outputs:* Canonical grid window timestamp (`number | null`).
- **`checkinQueue`** (`lib/checkinQueue.ts`):
  - *Inputs:* Failed or offline check-in answers (`{ content, windowTs, retryAt, attempts }`).
  - *Outputs:* AsyncStorage backed queue (`checkin_queue_${userId}`) drained sequentially on NetInfo, Realtime reconnect, or AppState `active`.

### 3.3. Doing (Object: Doing)
- **Read Doings** (`app/(app)/chat.tsx`):
  - *Inputs:* `userId: string`.
  - *Outputs:* Reads `doings_logs` rows needing energy rating (`is('energy', null)`).
- **Write Doing**:
  - *Outputs:* Generated server-side during `submitCheckIn` (`kind='doing'`, `source='chat' | 'checkin_reply'`).
- **`logImpulse`** (`lib/impulse.ts`):
  - *Inputs:* `source: 'app' | 'action'`.
  - *Outputs:* `{ ok: boolean, id?: string }` via Edge Function `log-impulse` or direct insert into `doings_logs` (`kind='impulse_failure'`).
- **Doing Correction (PRD A16)**:
  - **MISSING**: No hook, service, or RPC exists to update or correct a logged Doing while preserving original content in an audit trail.

### 3.4. Plan (Object: Plan / Plan Items)
- **Daily Plan Items & Reordering**:
  - **MISSING**: The backend database table `anchor_plans` exists, but the client data layer has zero hooks or API services to load, add, edit, reorder (up/down), or update status (`pending`, `done`, `partly`, `missed`) for individual Plan items.

### 3.5. Reflection (Object: Reflection)
- **Daily Journal Rows** (`app/(app)/journal.tsx`):
  - *Inputs:* `{ content: string, entry_date: string }`.
  - *Outputs:* CRUD operations against `journal_entries` table.
- **Davos Reflection Summary**:
  - **MISSING**: No hook or backend service returns Davos's one-line summary attached to a structured evening Reflection object.

### 3.6. Oath (Object: Oath)
- **`parseOathOffer`** (`lib/oathCard.ts`):
  - *Inputs:* Message content string and metadata.
  - *Outputs:* `{ hasOffer: boolean, oathText?: string, reqId?: string }`.
- **Oath Binding** (`lib/chat.ts`, `app/(app)/chat.tsx`):
  - *Inputs:* `oathConfirmed: true` flag in `sendMessage`.
  - *Outputs:* Saved as an immutable, non-purgeable fact in `memory_facts` (`fact_type='oath'`).
- **Proof View of Oath Standing**:
  - **MISSING**: No hook or service reads the bound Oath statement, standing facts, or derived doings evidence for Proof (S3).

---

## 4. Token Inventory

*Source: `theme/tokens/`*

### 4.1. Colors (`theme/tokens/colors.ts`)
- **Light and Dark Variants Both Exist:** Exported as `lightColors: ThemeColors` and `darkColors: ThemeColors`.
- **Exported OKLCH Ramps:** `neutralRamp`, `amberRamp`, `successRamp`, `warningRamp`, `dangerRamp`, `infoRamp`.
- **Exact Exported Token Keys (`ThemeColors`):**
  - *Base surfaces:* `background`, `surface`, `surfaceRaised`, `surfaceSubtle`.
  - *Text & content:* `textPrimary`, `textSecondary`, `textTertiary`, `textInverse`.
  - *Structural boundaries:* `border`, `borderSubtle`, `borderFocus`.
  - *Actions & brand:* `accent`, `onAccent`, `accentSubtle`, `lantern`, `lanternSurface`.
  - *Status & feedback:* `success`, `successSurface`, `successText`, `warning`, `warningSurface`, `warningText`, `danger`, `dangerSurface`, `dangerText`, `info`, `infoSurface`, `infoText`.
  - *Overlay & utilities:* `overlay`, `transparent`.

### 4.2. Typography (`theme/tokens/typography.ts`)
- **Exported `typography` scale roles:** `display`, `title`, `heading`, `body`, `bodyMedium`, `bodyStrong`, `label`, `caption`, `mono`.
- **Exported utilities:** `tabularNums` (`{ fontVariant: ['tabular-nums'] }`).
- **Exported type:** `TypographyRole = keyof typeof typography`.

### 4.3. Spacing & Radius (`theme/tokens/spacing.ts`)
- **Exported `spacing` scale:** `none` (0), `xxs` (4), `xs` (8), `sm` (16), `md` (24), `lg` (32), `xl` (40), `xxl` (48), `huge` (64).
- **Exported `opticalOverrides`:** `xxs` (4), `compact` (12), `iconPlayNudgeX` (1.5), `rowGapTightTweak` (2.0), `iconNudgeY` (1.0).
- **Exported `radius` scale:** `sm` (6), `md` (12), `lg` (16), `full` (9999).
- **Exported `touchTarget` boundaries:** `minHeight` (48), `minWidth` (48), `minTargetIos` (44), `minTargetAndroid` (48), `hitSlop` (8).

### 4.4. Elevation (`theme/tokens/elevation.ts`)
- **Exported function:** `getElevation(colorScheme: 'light' | 'dark')` returning `{ none, raised, overlay }`.  
  *(Note: PRD §14 Do-not #1 explicitly bans elevation shadows in favor of hairlines and type scale).*

---

## 5. Existing UI Mapping to PRD §0

| PRD Place ID | PRD Place Name | PRD Form & Zone | Existing Screen in `app/` | Counterpart Status |
| :--- | :--- | :--- | :--- | :--- |
| **S1** | **Thread** (Davos) | Compact: tab, full screen. Regular/wide: centre column (Core Job) | `app/(app)/chat.tsx` | Direct counterpart (needs visual reset to PRD) |
| **S2** | **Today** | Compact/regular: tab. Wide: docked beside S1 (Core Job) | None | **NO COUNTERPART** |
| **S3** | **Proof** | Tab (with Oath section first) (Core Job) | None | **NO COUNTERPART** |
| **S4** | **Oath ceremony** | Full-screen modal, 2 steps (Draft, then Read-back) (Core Job) | None | **NO COUNTERPART** (only inline card widget in `chat.tsx`) |
| **S5** | **Settings** | Overflow screen (Standard Shell) | `app/(app)/settings.tsx` | Direct counterpart |
| **S6** | **Sign-in** | Screen (Standard Shell) | `app/sign-in.tsx`, `app/verify-code.tsx` | Direct counterpart (split OTP credentials flow) |

### Candidates for Removal (Do NOT remove yet):
1. **`app/(app)/dashboard.tsx`**: Has no place in PRD §0; violates PRD §14 Do-not #4 and #5 (bans KPI card rows, streak art, points, badges). Replaced by S3 Proof.
2. **`app/(app)/journal.tsx`**: Has no place in PRD §0 as a distinct screen (PRD §0 specifies evening session and reflection are inline within S1 and S2, not a separate screen).
3. **`app/(onboarding)/interview.tsx` & `app/(onboarding)/_layout.tsx`**: Has no place in PRD §0 as a distinct route (onboarding intake conversation belongs in Thread S1 or Oath ceremony S4).

---

## 6. Offline Sync Queues

1. **Chat Turn Queue (`lib/sendQueue.ts`):**
   - **Storage Engine:** `@react-native-async-storage/async-storage` under key `@davos:send-queue`.
   - **Operations Queued:** Outgoing chat turns `{ clientMessageId, content, clientSentAt, retryAt, attempts }`.
   - **Replay Mechanism:** Sequential replay via `flushQueue` triggered on network reconnection. Drops permanent 4xx errors; retries on transport errors with backoff holdoff.
2. **Check-in Response Queue (`lib/checkinQueue.ts`):**
   - **Storage Engine:** `@react-native-async-storage/async-storage` under key `checkin_queue_${userId}`.
   - **Operations Queued:** Check-in responses `{ content, windowTs, retryAt, attempts }`.
   - **Replay Mechanism:** Triggered by NetInfo online transitions, Supabase Realtime channel reconnect, and AppState returning to `active`. Permanently dropped if server returns 4xx (`permanent: true`).
3. **Unqueued Operations (No offline queue):**
   - Energy chip PATCH (`PATCH /functions/v1/submit-checkin`): Direct fetch, fails if offline.
   - Impulse logging (`lib/impulse.ts`): Direct REST fetch/insert; fails if offline.
   - Memory privacy flag (`lib/memoryFlag.ts`): Direct REST fetch to `flag-unsavable`.
   - Journal entries: Direct Supabase REST inserts.

---

## 7. Data Layer Gaps (PRD Requirements Unsupported by Backend/Data Layer)

1. **F2 Delayed Urge Follow-Up:**
   - *Requirement:* User taps Urge; Davos replies immediately and starts a 10-minute timer. Davos performs an inline check-back after 10 minutes.
   - *Data Layer Gap:* The Supabase backend has no delayed urge check-in job type, pg_cron trigger, or scheduled push mechanism for urges. `AGENTS.md` explicitly forbids adding backend compute, new tables, or new job types. This must be managed client-side via local timers/notifications.
2. **F3 Plan Items Granular Operations & Reordering:**
   - *Requirement:* PRD §3 and §7 specify an editable list of Plan items with status (`pending`, `done`, `partly`, `missed`) and up/down reordering.
   - *Data Layer Gap:* The backend schema only contains an unindexed JSONB `anchors` column on `anchor_plans`. There are no granular APIs, status transition checks, or RPCs for individual plan items or their ordering.
3. **F3 Davos Reflection Summary:**
   - *Requirement:* PRD §3 specifies a Reflection object with Davos's one-line summary.
   - *Data Layer Gap:* No backend service or pipeline step summarizes evening reflection text into a structured summary attribute.
4. **F4 Oath Ceremony Drafts & Standing Derivation:**
   - *Requirement:* PRD §3/§7 specifies draft editing, draft discard, 5-second read-back delay, and standing facts derived from doings evidence.
   - *Data Layer Gap:* The backend stores finalized oaths as immutable `memory_facts` rows (`fact_type='oath'`) but provides no draft storage, draft history, or standing calculation endpoint.
5. **F5 Doing Correction with Original Audit Trail (A16):**
   - *Requirement:* PRD §3 specifies a "corrected" marker with the original value kept.
   - *Data Layer Gap:* `doings_logs` table schema has only `content: text` without revision columns (`original_content`, `corrected_at`). Direct updates overwrite historical data.
6. **Structured Check-in Response Row (DR2):**
   - *Requirement:* PRD §3/F1 specifies structured response options (*Did it / Partly / Didn't / Something else*).
   - *Data Layer Gap:* `submit-checkin` accepts only free-form `content: string`. There is no structured status enum column stored in `doings_logs`.
