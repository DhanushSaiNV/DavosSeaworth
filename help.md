# Davos FP-04: Check-in Banner Not Appearing on Android — External AI Handoff

## One-line problem

On an Android device (Realme Narzo 90x, just informing, do not assume the problem is device-specific), the hourly check-in notification (local scheduled via `expo-notifications`) **never appears as a heads-up banner**, and `adb shell dumpsys alarm` shows the alarms are being **cancelled** rather than delivered. The app is currently **not armed** (zero pending davos alarms) despite the owner having just rebuilt the APK and reloaded.

---

## Critical evidence (from `dumpsys alarm` taken 22:58 IST)

```
u0a434:com.anonymous.davos +361ms running, 5 wakeups:
  +361ms 5 wakes 5 alarms, last -1h34m27s464ms:
    *walarm*:expo.modules.notifications.NOTIFICATION_EVENT
```

**5 alarms were delivered** (wakeups), last 1h34m ago. But the history shows **14 cancellations** in the last 49 min:

```
u0a434:
  #1-#2:  cancelled 22m ago (rtc 22:36:03) — one was due +10m38s
  #3-#4:  cancelled 47m ago (rtc 22:11:20)
  #5-#10: cancelled 49m ago (rtc 22:08:52) — 10 alarms cancelled at once
```

All cancellations are `Reason=alarm_cancelled` with snapshots showing `tag=*walarm*:expo.modules.notifications.NOTIFICATION_EVENT`. **Zero pending davos alarms exist at dump time.**

The 10-at-once cancellation = `Notifications.cancelAllScheduledNotificationsAsync()` (the only API that cancels all pending check-in ids simultaneously). This happened 3× in the last hour (22:08, 22:11, 22:36). After the last cancellation (22 min ago), **nothing was rescheduled**.

---

## What I've already fixed (code is in repo, gate passes)

| Root cause                              | Fix applied                                                                                                  | File              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------- |
| Chat-focus handler suppressed check-ins | `configureNotificationHandler` short-circuits on `isCheckinNotification` before chat suppression             | `lib/push.ts`     |
| Channel `DEFAULT` cannot peek           | New channel `checkin_v2` at `AndroidImportance.HIGH` (+ `priority: HIGH` for pre-O)                          | `lib/checkins.ts` |
| Grid shifted by bad device zone         | `maybeSyncTimezone` now writes only when zone matches device wall clock (`isTrustedDeviceZone`)              | `lib/checkins.ts` |
| Silent failure if permission missing    | `armCheckins` checks `getPermissionsAsync` / `requestPermissionsAsync` and bails with warning if not granted | `lib/checkins.ts` |

Gate: `python scripts/verify-fp04-step4.py --run-jest` → **51 static PASS / 0 FAIL**, `tsc --noEmit` clean, **257 jest tests PASS**.

---

## What I suspect but haven't proven

### A. The layout effect is thrashing / racing

`app/(app)/_layout.tsx` arms check-ins in a `useEffect` with dependency `[user]` (the auth context object, not `user?.id`):

```tsx
useEffect(() => {
  if (!user) return;
  void armCheckins(user.id);
  // …
  return () => {
    sub.remove();
    void cancelCheckins();
  };
}, [user]);
```

If `useAuth()` returns a **new `user` object on every render** (or on session refresh), this effect:

1. Runs cleanup → `cancelCheckins()` → `cancelAllScheduledNotificationsAsync()`
2. Immediately re-runs → `armCheckins()` → `scheduleNotifications()`
3. The two async calls race; if the cancel resolves _after_ the schedule, **all alarms are wiped and nothing is pending**.

This perfectly explains the three 10/2/2 cancellation bursts and the current "zero pending" state.

### B. The app is not signed in on the new APK

A fresh install/update may have lost the session (Supabase auth PKCE flow is broken — magic link template missing `{{ .Token }}`). If the user is on the sign-in screen, `(app)` never mounts → no arm → no alarms. The 5 historical wakeups would be from the _old_ session.

### C. My new permission gate is bailing

If `POST_NOTIFICATIONS` is not granted (new APK = fresh install → runtime prompt, owner may have tapped "Don't allow"), `armCheckins` logs `[checkin] notification permission not granted — nothing scheduled` and returns early. The alarm history wouldn't show new cancellations from this run (since `cancelCheckins` only runs on unmount), but it would explain "no new alarms."

### D. ColorOS aggressive battery management

OPPO/ColorOS defers inexact alarms (`setAndAllowWhileIdle`) in Doze unless the app is "Unrestricted." The deferred `SCHEDULE_EXACT_ALARM` permission is missing from the manifest — expo falls back to inexact, and ColorOS may defer 15–45 min. But: the alarm history shows _cancellations_, not deferred fires, so this is secondary.

---

## What I need the external AI to help with

1. **Is the `[user]` effect thrash a real bug, or am I misreading `useAuth`'s memoization?** (I can share `lib/auth.tsx` if needed.)
2. **Given the evidence, what's the highest-probability root cause?** (Not-armed due to thrash? Not signed in? Permission? Silent throw in `armCheckins`?)
3. **What's the minimal, definitive next diagnostic step that doesn't require a rebuild?** (I've done adb alarm dumps; the gap is "is the JS running and what does it log?")
4. **Should I fix the effect dependency to `[user?.id]` now, or is there a deeper auth hydration issue?**
5. **Is there any other Android-specific mechanism I'm missing that would cancel 10 alarms at once without a corresponding `cancelAll` call?** (e.g., package update auto-cancel — but the owner rebuilt 49 min ago, matching the first 10-cancellation burst; the later bursts at 22:11 and 22:36 don't align with rebuilds.)

---

## Repo context (minimal)

- **Stack**: Expo Router (SDK 57), React Native 0.86, Hermes, `expo-notifications` 57.0.23
- **Backend**: Supabase (Edge Functions, PostgREST, pg_cron) — no other servers
- **Constraints**: $0 budget, 5 beta users, no paid services, no new native deps without rebuild
- **Key files**:
  - `lib/checkins.ts` — scheduler, channel, zone guard, permission gate
  - `lib/push.ts` — notification handler with check-in short-circuit
  - `app/(app)/_layout.tsx` — arm/cancel wiring
  - `scripts/verify-fp04-step4.py` — static/type/unit gate

---

## Commands the owner can run (if you need more data)

```powershell
# 1. Is POST_NOTIFICATIONS granted?
adb shell dumpsys package com.anonymous.davos | Select-String "POST_NOTIFICATIONS"

# 2. Is DND on?
adb shell settings get global zen_mode

# 3. Any davos notification record posted?
adb shell dumpsys notification --noredact > "$env:TEMP\notif.txt"
Select-String -Path "$env:TEMP\notif.txt" -Pattern "What did you do this hour" -Context 6,6

# 4. Is the app process alive?
adb shell pidof com.anonymous.davos

# 5. Logcat for JS errors (works in release for ReactNativeJS tag)
adb logcat -c
# foreground app, wait 10s
adb logcat -d | Select-String "checkin|davos|ReactNativeJS|armCheckins" | Select-Object -Last 50
```

---

## What I'm _not_ asking for

- "Add `SCHEDULE_EXACT_ALARM`" — deferred, needs rebuild + user toggle, not the immediate blocker.
- "Install `expo-localization`" — deferred, needs rebuild.
- "Fix the auth PKCE flow" — separate tracked item; the 6-digit OTP path works if the user gets the email.
- Rewrite the scheduler — it's gate-green and the math is verified.

---

## The specific ask

**Given the alarm history (delivered → cancelled in bursts → zero pending), the code I've shared, and the constraint that I cannot spend another day on this: what is the single most likely reason the app is not armed right now, and what is the one command or code change that will definitively prove or fix it?**

Please be ruthless: if I've missed something obvious in the native/Android layer, the effect dependency, or the expo-notifications lifecycle, call it out directly.
