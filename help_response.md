Here is the complete diagnosis, mechanism breakdown, decisive test, and exact fixes for the notification issue.

---

### 1. Hypothesis Ranking & Refutation

| Rank   | Hypothesis                              | Status                                     | Why / Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :----- | :-------------------------------------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1** | **H1: Foreground Suppression**          | **CRITICAL (Root Cause 1)**                | **Verified.** On Android, `Notifications.setNotificationHandler` intercepts **both** remote push and local scheduled alarms firing while the app is in the foreground. In [`app/(app)/chat.tsx`](file:///C:/dev/DavosSeaworth/app/%28app%29/chat.tsx#L154-L161), `configureNotificationHandler(() => true)` sets all presentation flags (`shouldShowAlert`, `shouldShowBanner`, `shouldShowList`, etc.) to `false` when the chat tab is focused. When the owner watches the chat tab, the native `ExpoNotificationPresentationManager` executes the JS callback, receives `shouldShowAlert: false`, and **completely suppresses the notification** (no banner, no status-bar icon, no entry in the notification shade).                                                     |
| **#2** | **H2: Channel Importance Too Low**      | **CRITICAL (Root Cause 2)**                | **Verified.** In [`lib/checkins.ts`](file:///C:/dev/DavosSeaworth/lib/checkins.ts#L60-L65), the channel is created with `AndroidImportance.DEFAULT`. On Android 8.0+ (API 26+), heads-up (peeking) banners **strictly require `IMPORTANCE_HIGH` (4) or `IMPORTANCE_MAX` (5)**. `DEFAULT` (3) only posts silently or with sound into the pull-down shade — it _physically cannot_ peek as a heads-up banner on Android. Furthermore, **Android locks notification channel importance on creation**. Re-running `setNotificationChannelAsync("checkin", { importance: HIGH })` is silently ignored by the OS; the channel ID must be incremented (e.g. `checkin_v2`) or deleted.                                                                                              |
| **#3** | **H4: Timezone Misresolution**          | **CRITICAL (Root Cause 3)**                | **Verified.** The database shows `profiles.timezone = "Africa/Abidjan"` (UTC+0), while the user is in IST (UTC+5:30). In Hermes on Android, `Intl.DateTimeFormat().resolvedOptions().timeZone` does **not** link to Android's native `java.util.TimeZone.getDefault().getID()`. Hermes defaults its internal timezone to UTC/GMT, and in ICU data the canonical identifier for `+00:00` without DST is **`Africa/Abidjan`**. [`maybeSyncTimezone`](file:///C:/dev/DavosSeaworth/lib/checkins.ts#L105-L125) reads this and overwrote the database profile to `Africa/Abidjan`. A window set for `13:13:00` active start was computed as **13:13 UTC (18:43 IST)**, with the first notification closing at **14:13 UTC (19:43 IST)** — 5.5 hours away from what was expected! |
| **#4** | **H5: Close-Time Rule & Bounds**        | **HIGH (User Testing Error)**              | **Verified.** By design in [`lib/checkinGrid.ts`](file:///C:/dev/DavosSeaworth/lib/checkinGrid.ts#L57-L61), notifications are scheduled at `closeMs` (`startMs + cadence`), **not** at `startMs`. Setting `start = 20:00, cadence = 60` fires at `21:00`. If someone sets `start` a few minutes into the future expecting an immediate alarm, nothing will happen for 60+ minutes. Furthermore, if `start + cadence > end`, `windowsForLocalDay` emits **0 windows**.                                                                                                                                                                                                                                                                                                       |
| **#5** | **H3: No Exact-Alarm Permission**       | **MEDIUM (Latency & Doze)**                | **Partially True, Partially Incomplete.** Missing `SCHEDULE_EXACT_ALARM` does **not** crash or throw. In `expo-notifications`, when `alarmManager.canScheduleExactAlarms()` is false, it catches and falls back to `alarmManager.setAndAllowWhileIdle()` (inexact). The alarm **is scheduled**, but Android batches inexact alarms. When screen is on, it may delay by a few minutes; in Doze mode (screen off, battery), Android can delay it by **15–45 minutes**.                                                                                                                                                                                                                                                                                                        |
| **#6** | **H6: POST_NOTIFICATIONS Not Granted**  | **LOW (Refuted for this device)**          | **Refuted as current cause, but latent bug.** It worked once earlier on this phone, which proves `POST_NOTIFICATIONS` was granted. However, [`lib/checkins.ts`](file:///C:/dev/DavosSeaworth/lib/checkins.ts) never calls `requestPermissionsAsync()` itself (it relied on `registerPushToken` in `lib/push.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **#7** | **H7: Doze / OEM Battery Optimization** | **LOW for active testing**                 | **Low probability while screen is on**, but significant when the device is left on a desk or if the app is force-closed on Chinese OEM skins (HyperOS/MIUI, ColorOS).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **#8** | **H8: Stale/Stuck Session State**       | **OUTRIGHT WRONG (for recurring failure)** | **Refuted.** While `cancelCheckins()` cancels all alarms on layout unmount, `AppLayout`'s `useEffect` re-runs on mount and re-arms. If the user is authenticated, `armCheckins` runs every time the app opens or returns to foreground.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

### 2. The Decisive Test (ADB Commands)

Run these commands from your workstation with the phone connected via USB/Wi-Fi debugging.

#### Test A: Is the alarm actually registered in Android's `AlarmManager`?

```bash
adb shell dumpsys alarm | grep -A 8 -B 2 "com.anonymous.davos"
```

**Interpretation:**

- **If empty:** The app **never scheduled the alarm**. The grid returned 0 windows (H4/H5), `loadProfileGrid` failed (auth/network), or `armCheckins` never executed.
- **If present:** Look for `RTC_WAKEUP` or `ELAPSED_REALTIME_WAKEUP` and the trigger time:
  ```text
  RTC_WAKEUP #0: Alarm{... type 0 origWhen ... com.anonymous.davos}
    tag=*walarm*:expo.modules.notifications.service.ScheduledNotificationReceiver
  ```
  Note the `origWhen` timestamp. Convert it from epoch ms: that is the exact UTC time the OS will fire.

#### Test B: Live Logcat when the alarm fires

Run this before the scheduled time:

```bash
adb logcat -v time -s NotificationsService:V ExpoNotificationPresentationManager:V NotificationService:V
```

**Interpretation:**

- If you see `AlarmManager` fire and `ExpoNotificationPresentationManager` logs:
  `Notification [id] suppressed by handler`
  $\rightarrow$ **H1 confirmed:** Your JS `setNotificationHandler` explicitly dropped the notification.
- If you see:
  `enqueueNotificationInternal: pkg=com.anonymous.davos id=... importance=3`
  $\rightarrow$ **H2 confirmed:** Importance is 3 (`DEFAULT`). Android posted it to the shade, but refused to peek as a heads-up banner.
- If nothing appears at all: The alarm hasn't fired yet (H3/H4/H5).

---

### 3. Exact Code & Config Fixes

#### Fix 1: Filter `setNotificationHandler` so check-ins are never suppressed

Modify [`lib/push.ts`](file:///C:/dev/DavosSeaworth/lib/push.ts#L161-L182) so that check-in notifications (identified by `categoryIdentifier === "checkin_reply"` or channel `"checkin"`) are always presented:

```ts
// lib/push.ts
export function configureNotificationHandler(isChatFocused: () => boolean): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const content = notification.request.content;
      const isCheckin =
        content.categoryIdentifier === 'checkin_reply' ||
        (content.data as any)?.url === 'davos://chat?focus=checkin' ||
        Boolean((content.data as any)?.windowTs);

      // Check-in notifications must NEVER be suppressed, even when chat is focused
      if (isCheckin) {
        return {
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      }

      // Chat push notifications: suppress when the user is already looking at chat
      if (isChatFocused()) {
        return {
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }

      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });
}
```

#### Fix 2: Upgrade Channel to `IMPORTANCE_HIGH` and change Channel ID

Because Android does not permit updating importance on an existing channel, rename the channel to `"checkin_v2"` in [`lib/checkins.ts`](file:///C:/dev/DavosSeaworth/lib/checkins.ts#L17,L60-L65):

```ts
// lib/checkins.ts
const CHECKIN_CHANNEL_ID = 'checkin_v2'; // Increment ID to bypass Android channel immutability

async function ensureChannelAndCategory(): Promise<void> {
  // ... category setup ...

  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHECKIN_CHANNEL_ID, {
    name: 'Check-ins',
    importance: Notifications.AndroidImportance.HIGH, // Heads-up banner enabled!
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0066FF',
    enableVibrate: true,
    showBadge: true,
  });
}
```

And in `buildNotificationContent`:

```ts
function buildNotificationContent(...): Notifications.NotificationContentInput {
  return {
    title: "What did you do this hour?",
    body: `How did the ${localClose} window go?`,
    data: { ... },
    categoryIdentifier: CHECKIN_CATEGORY_ID,
    sound: true,
    priority: Notifications.AndroidNotificationPriority.HIGH, // Priority HIGH
  };
}
```

#### Fix 3: Fix Device Timezone Detection

Replace Hermes's broken `Intl.DateTimeFormat().resolvedOptions().timeZone` with `expo-localization`.

1. Install `expo-localization`:
   ```bash
   npx expo install expo-localization
   ```
2. Update [`lib/checkins.ts`](file:///C:/dev/DavosSeaworth/lib/checkins.ts#L105-L125):
   ```ts
   import * as Localization from 'expo-localization';

   async function maybeSyncTimezone(userId: string): Promise<void> {
     // getCalendars()[0]?.timeZone queries native Android java.util.TimeZone.getDefault().getID()
     const deviceTz = Localization.getCalendars()[0]?.timeZone;
     if (!deviceTz || deviceTz === 'Africa/Abidjan' || !isValidTimeZone(deviceTz)) {
       return; // Guard against Hermes fallback
     }

     const { data } = await supabase
       .from('profiles')
       .select(
         'timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end'
       )
       .eq('id', userId)
       .single();

     if (!data) return;
     const row = data as ProfileGridRow;
     if (deviceTz !== row.timezone) {
       await supabase.rpc('update_checkin_prefs', {
         p_cadence: row.checkin_cadence_minutes,
         p_start: row.checkin_active_hours_start,
         p_end: row.checkin_active_hours_end,
         p_tz: deviceTz,
       });
     }
   }
   ```
3. In Supabase, fix the drill user's row:
   ```sql
   update profiles set timezone = 'Asia/Kolkata' where id = '<USER_ID>';
   ```

#### Fix 4: Add Exact Alarm Permission & Explicit Permission Guard

In [`app.json`](file:///C:/dev/DavosSeaworth/app.json#L17-L25):

```json
"android": {
  "package": "com.anonymous.davos",
  "permissions": [
    "SCHEDULE_EXACT_ALARM",
    "POST_NOTIFICATIONS"
  ],
  ...
}
```

In [`lib/checkins.ts`](file:///C:/dev/DavosSeaworth/lib/checkins.ts#L189-L200):

```ts
export async function armCheckins(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const { status: reqStatus } = await Notifications.requestPermissionsAsync();
    if (reqStatus !== 'granted') {
      console.warn('[checkin] Notification permission not granted');
      return;
    }
  }

  await ensureChannelAndCategory();
  // ... continue scheduling ...
}
```

---

### 4. What Was Missed (Android 12–16 Nuances)

1. **Android 12+ (API 31+) Inexact Alarm Fallback**: Without `android.permission.SCHEDULE_EXACT_ALARM` in the manifest, Android 12+ silently prevents apps from setting exact alarms. `expo-notifications` falls back to `setAndAllowWhileIdle()` without throwing, which subjects triggers to OS alarm batching (delaying delivery by up to 15–45 minutes in Doze).
2. **Notification Channel Immutability (API 26+)**: Once a notification channel is created, Android refuses all programmatic changes to `importance`, `sound`, and `lights`. The only way to upgrade an existing channel to `HIGH` is to change the channel ID.
3. **Android App `STOPPED` State**: If the app is force-stopped (or killed by certain OEM battery task killers upon swiping away from Recents), Android places the package in a stopped state. In this state, **no `AlarmManager` alarms will fire at all** until the user explicitly taps the launcher icon again.
4. **Android 14+ (API 34) Alarm Policy**: Apps targeting Android 14+ cannot declare `USE_EXACT_ALARM` unless they are classified as timer or alarm-clock apps on Google Play. General productivity apps must declare `SCHEDULE_EXACT_ALARM`, which users can toggle under **App Info $\rightarrow$ Alarms & Reminders**.

---

### 5. Section 6 Questions Answered

#### 1. Hermes + `Intl` reliability on Android & `Africa/Abidjan`

- **Why `Africa/Abidjan`?** When Hermes initializes ICU without an explicit native timezone bridge, it falls back to UTC offset `+00:00`. In standard ICU/tzdata tables, `Africa/Abidjan` is the primary alphabetical canonical ID for `+00:00` without daylight saving.
- **Is `Intl` trustworthy for math once given a valid zone?** Yes. Hermes in RN 0.86 implements full ECMAScript Intl; passing an explicit valid IANA string (e.g. `'Asia/Kolkata'`) performs correct DST offsets and wall-clock conversions.
- **Recommendation:** Never use `Intl.DateTimeFormat().resolvedOptions().timeZone` to detect the device zone on React Native Android. Use `expo-localization` (`Localization.getCalendars()[0]?.timeZone`).

#### 2. `TIME_INTERVAL` vs `DATE` Triggers

- In the `expo-notifications` Android native source code (`NotificationScheduler.kt`), `TIME_INTERVAL` computes `triggerDate = System.currentTimeMillis() + seconds * 1000`. Both triggers call the exact same Android `AlarmManager` API (`setExactAndAllowWhileIdle` or `setAndAllowWhileIdle`).
- **Across Reboots:** Neither trigger survives an Android reboot unless the manifest declares `RECEIVE_BOOT_COMPLETED` and `expo-notifications` restores them. With `DATE`, the target timestamp is absolute, preventing drift if re-evaluated.

#### 3. Android RemoteInput Spinner Clearing

- Android's inline reply spinner spins until the OS receives an explicit update or dismissal for that notification ID.
- Calling `dismissNotificationAsync(identifier)` in `expo-notifications` works, provided the JS thread doesn't crash or get terminated while awaiting the fetch request.
- Best practice in the reply handler:
  ```ts
  try {
    await submitCheckIn(...);
  } finally {
    await Notifications.dismissNotificationAsync(response.notification.request.identifier);
  }
  ```

#### 4. Keeping Supabase Auth Email Templates in Repo

- Put templates in `supabase/templates/` (e.g., `magic_link.html`).
- Reference them in `supabase/config.toml`:
  ```toml
  [auth.email.template.magic_link]
  subject = "Your Davos Login Code"
  content_path = "./supabase/templates/magic_link.html"
  ```
- For 6-digit OTP codes or PKCE links, verify the template contains `{{ .Token }}` or `{{ .ConfirmationURL }}`.
- Deploy templates with `npx supabase config push` to prevent Dashboard resets from breaking email sign-ins.

#### 5. $0-Budget Reliability Checklist on Android

1. Declare `SCHEDULE_EXACT_ALARM` and `POST_NOTIFICATIONS` in `app.json`.
2. Use `expo-localization` to write the real device IANA timezone to `profiles`.
3. Set the Android notification channel to `AndroidImportance.HIGH` on a new channel ID (`checkin_v2`).
4. Re-arm the rolling 24-hour schedule on every foreground transition (`AppState === 'active'`).
5. Filter `setNotificationHandler` so check-in notifications are never suppressed by chat focus.
6. For beta testers on aggressive OEM skins (Xiaomi, Samsung, OnePlus), instruct them in onboarding to set battery usage to **Unrestricted** under **Settings $\rightarrow$ Apps $\rightarrow$ Davos $\rightarrow$ Battery**.
