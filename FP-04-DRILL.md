# FP-04 Pre-Launch Drill Guide

## "Is the check-in loop working?" — Steps 1–4 only

**Scope:** Everything committed through `3cf4c3c` (Step 4). Steps 5–8 (chat UI check-in mode, energy chips, watchdog, settings) are **not built yet** — this drill does not test them.

**Purpose:** Verify the entire server + client check-in path works on your real device before you start Step 5. Find issues now, not after 4 more steps of code on top.

**Time required:** ~30 min on the device, ~5 min on the workstation, ~5 min reading the DB.

**Prerequisites:**

- Android device connected via USB with `adb` working (`adb devices` shows it)
- App built and running as a **dev build** (not Expo Go)
- Signed in (magic link or Google OAuth — the `(app)` tab layout must be mounted)
- Your `DAVOS_USER_JWT` env var set (used by workstation scripts)
- Metro running (`npx expo start`)

---

## Before You Start — The `[user]` Thrash Fix

The fix applied to `app/(app)/_layout.tsx` (dependency `[user]` → `[user?.id]`) is in the **working tree but not yet committed**. Metro hot-reload picks it up automatically — you do not need a rebuild. Confirm it is active:

```powershell
adb logcat -c
# open the app, wait 10 s, then:
adb logcat -d | Select-String "checkin" | Select-Object -Last 20
```

You should see `[checkin] armCheckins` exactly **once** after launch. If you see it fire 2–3 times in rapid succession the old object was still in the bundle — shake the device → Reload JS.

---

## Section A — Workstation Static Checks (run first, ~3 min)

These are fast and catch anything that regressed since the last commit.

```powershell
# From the repo root
npx jest --ci 2>&1 | Select-String "Tests:|Suites:|FAIL"
npx tsc --noEmit
```

**Expected:**

- Jest: `Test Suites: 17 passed` (17 suites, 257 tests — the baseline after Step 4)
- TypeScript: no output (zero errors)

> [!IMPORTANT]
> If either fails, **stop here** and fix before the device drill. A type error in the scheduler or queue means the device drill results cannot be trusted.

---

## Section B — Confirm the App Is Armed (Device, ~2 min)

This is the single most important check. Without alarms registered in Android's AlarmManager, nothing else matters.

**Step B1 — Confirm sign-in**

On the device, the Chat tab should be visible. If you are on the sign-in screen the `(app)` layout never mounts and nothing is scheduled.

```powershell
adb shell pidof com.anonymous.davos
```

Any non-empty output means the process is alive.

**Step B2 — Check alarms are registered**

```powershell
adb shell dumpsys alarm | Select-String "davos" | Select-Object -First 30
```

**What you must see:**

```
*walarm*:expo.modules.notifications.NOTIFICATION_EVENT
```

with 1–24 entries (one per upcoming window). Note the trigger time of the soonest one — that is when the next banner will fire.

**What means failure:**

| Output                                                 | Diagnosis                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Zero `davos` lines                                     | The arm failed — check logcat (Step B3)                                                        |
| `alarm_cancelled` entries with no new alarms following | The old `[user]` thrash is still active; confirm the hot-reload picked up the `[user?.id]` fix |
| Alarms present but all far in the future               | Grid math: active-hours start is too late — fix in Section C                                   |

**Step B3 — Logcat arm confirmation**

```powershell
adb logcat -d | Select-String "checkin|arm|cancel|permission" | Select-Object -Last 30
```

You want exactly **one** arm sequence:

```
[checkin] getPermissionsAsync → granted
[checkin] armCheckins start for user <uuid>
[checkin] scheduleNotifications: N windows scheduled
```

If you see `notification permission not granted` → go to Settings → Apps → Davos → Notifications → enable.
If you see `loadProfileGrid returned null` → the Supabase profile read failed; check your `.env` URL.

---

## Section C — Grid Math Check (Workstation, ~3 min)

The most common silent failure: the grid computes zero windows because the active-hours arithmetic rules out every window.

**Step C1 — Read your current profile**

In the Supabase dashboard SQL editor:

```sql
select
  timezone,
  checkin_cadence_minutes,
  checkin_active_hours_start::text,
  checkin_active_hours_end::text,
  latest_energy
from profiles
where id = auth.uid();
```

**What to check:**

| Column                                                | Problem                                                 | Fix                                                                |
| ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `timezone` = `Africa/Abidjan`                         | Hermes `Intl` bug wrote UTC+0 instead of your real zone | `update profiles set timezone = 'Asia/Kolkata' where id = '<ID>';` |
| `start + cadence > end` in minutes                    | Zero windows emitted                                    | Set `start` at least 60 min before `end`                           |
| `end` = `23:59` and `start` ≥ `23:00` with cadence 60 | No window fits (`23:00 + 60 > 23:59`)                   | Move `start` earlier or use cadence 120 with `start ≤ 22:00`       |

**Step C2 — Compute when the first banner fires**

```
first_banner_local = active_hours_start + cadence_minutes
```

Example: `timezone=Asia/Kolkata`, `start=08:00`, `cadence=60` → first banner fires at **09:00 IST**.

Cross-check against `dumpsys alarm` from Step B2 — the trigger timestamp should match.

> [!NOTE]
> The notification fires at **window CLOSE** (`start + cadence`), not at `start`. If you set `start=22:00` and `cadence=60` you wait until 23:00 for the banner. This is intentional — the notification asks about the interval just ended.

---

## Section D — Wait for a Banner and Test Direct Reply

To avoid waiting a full hour, set a short test window that closes in ~5 minutes.

**Step D1 — Set a near-term test window in the DB**

Figure out the current UTC time and set `active_hours_start` to 65 minutes ago in UTC. This puts a window-close ~5 minutes from now.

```sql
-- Example: it is 17:58 UTC right now.
-- Set start to 16:53 UTC (65 min ago) so close = 16:53 + 60 = 17:53 UTC (5 min from now).
update profiles
set
  timezone                   = 'Asia/Kolkata',
  checkin_cadence_minutes    = 60,
  checkin_active_hours_start = '16:53:00',   -- adjust to 65 min before NOW in UTC
  checkin_active_hours_end   = '23:59:00'
where id = '<YOUR_USER_ID>';
```

Then **foreground the app** (AppState `active` triggers re-arm). Run Step B2 again to confirm the new alarm appears with a trigger ~5 min from now.

**Step D2 — Watch for the banner**

Background the app (press Home). Wait for the window-close time.

✅ **Pass:** A heads-up banner slides in titled **"What did you do this hour?"** with a **Reply** action button.

❌ **Fail — no banner:**

```powershell
adb logcat -d | Select-String "NOTIFICATION_EVENT|NotificationManager|davos"
```

- `NOTIFICATION_EVENT` present → OS fired but Android channel blocked display → channel importance problem (`checkin_v2` at `HIGH` must be in the code)
- Nothing → alarm cancelled before firing → re-run Step B

**Step D3 — Test the Direct Reply**

In the banner tap **Reply**, type something like:

```
finished the report 5
```

The Send button should spin briefly, then the **notification dismisses itself** (the `dismissNotificationAsync` fix from the drill earlier today). If the Send button keeps spinning forever, the `finally` block dismissal is not in the build — shake → Reload JS.

**Step D4 — Verify the DB row**

In the Supabase dashboard:

```sql
select
  id,
  kind,
  source,
  checkin_window::text,
  logged_at::text,
  energy,
  left(content, 40)  as content_preview,
  embed_model
from doings_logs
where user_id = auth.uid()
order by created_at desc
limit 3;
```

**Expected row:**

| column           | expected                                                      |
| ---------------- | ------------------------------------------------------------- |
| `kind`           | `doing`                                                       |
| `source`         | `checkin_reply`                                               |
| `checkin_window` | The window **start** timestamp (not the moment you submitted) |
| `logged_at`      | The window **close** timestamp (start + 60 min)               |
| `energy`         | `5`                                                           |
| `embed_model`    | `gemini-embedding-001@768`                                    |

Also confirm `latest_energy` updated:

```sql
select latest_energy from profiles where id = auth.uid();
```

Should be `5`.

---

## Section E — Duplicate Window Guard

Send the exact same window again and confirm the server returns `duplicate` with zero new rows or provider calls.

```powershell
# Use the checkin_window value (ISO string) from Step D4
$windowTs = "2026-10-17T11:23:00Z"   # replace with your actual value

$headers = @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer $env:DAVOS_USER_JWT"
}

$body = @{ content = "second attempt same window"; capture = "reply"; windowTs = $windowTs } | ConvertTo-Json

Invoke-RestMethod `
  -Uri "$env:EXPO_PUBLIC_SUPABASE_URL/functions/v1/submit-checkin" `
  -Method POST -Headers $headers -Body $body
```

**Expected response:**

```json
{
  "status": "duplicate",
  "doing_id": "<same id as before>",
  "energy": 5,
  "eval_ran": false,
  "intervention": false
}
```

**DB check:** `doings_logs` should still have exactly one row for that window.

---

## Section F — Low-Energy Intervention Gate

Trigger `energy ≤ 3` on a fresh window. This proves the eval call runs and the full pipeline fires (writing a message row and sending a push).

**Step F1 — Open a fresh window**

Either wait for the next natural window or delete your test row:

```sql
delete from doings_logs where user_id = auth.uid() and created_at > now() - interval '10 minutes';
```

**Step F2 — Submit with energy 2**

```powershell
# windowTs = the START of the currently-open window
$windowTs = "2026-10-17T11:53:00Z"   # replace

$body = @{ content = "feel awful, exhausted 2"; capture = "reply"; windowTs = $windowTs } | ConvertTo-Json

$resp = Invoke-RestMethod `
  -Uri "$env:EXPO_PUBLIC_SUPABASE_URL/functions/v1/submit-checkin" `
  -Method POST -Headers $headers -Body $body

$resp | ConvertTo-Json
```

**Expected response:**

```json
{
  "status": "ok",
  "doing_id": "<uuid>",
  "energy": 2,
  "eval_ran": true,
  "intervention": true,
  "user_message_id": "<uuid>",
  "assistant_message_id": "<uuid>"
}
```

**Step F3 — Verify message rows**

```sql
-- The check-in user row
select id, role, left(content,60), metadata->>'source', metadata->>'doing_id'
from messages
where user_id = auth.uid() and metadata->>'source' = 'checkin'
order by created_at desc limit 2;

-- The pipeline reply (use user_message_id from the API response)
select id, role, left(content,120)
from messages
where reply_to_message_id = '<user_message_id>'
limit 1;
```

**Expected:**

- User row: `role=user`, `source=checkin`, `doing_id` matches the `doing_id` in the API response
- Assistant row: has Davos's reply text, anchored via `reply_to_message_id`

**Step F4 — Check push attempt in logcat**

```powershell
adb logcat -d | Select-String "push|expo" | Select-Object -Last 10
```

With `expo_push_enabled=true` and a valid Android token, a working push leaves **no log line** (success is silent). If you see `[push] expo_push_enabled=false, skipping` the push gate is off — that is fine for testing, just means the device won't buzz.

---

## Section G — Pending Store (Queue Replay via Airplane Mode)

**Step G1 — Set up a fresh window** (same as F1 above)

**Step G2 — Enable Airplane Mode** on the device

**Step G3 — Trigger the notification banner and reply to it**

The POST will fail (no network). The `handleNotificationResponse` function catches the failure and calls `checkinQueue.enqueueCheckIn`.

Confirm in logcat:

```powershell
adb logcat -d | Select-String "checkin.*queue|enqueue|failed" | Select-Object -Last 10
```

You should see `[checkin] submit failed — queuing: <error>` or similar.

**Step G4 — Turn Airplane Mode off**

Then **foreground the app** (triggers the NetInfo connectivity listener → `triggerFlush`).

**Step G5 — Verify the row appeared in the DB** (same query as Step D4)

The queued submission should replay and produce the row within a few seconds of reconnection.

---

## Section H — Regression Check: Normal Chat Still Works

The `send-message` §5.3 exclusion added in Step 3b must not have broken regular chat.

Open the Chat tab and send a normal message (not a check-in). Confirm:

1. Your message appears optimistically
2. Davos replies within a few seconds
3. No errors in logcat tagged `[send-message]` or `[chat]`

This is your FP-02/03 regression check.

---

## Section I — Clean Up

```sql
-- Reset active hours to your real schedule
update profiles
set
  checkin_active_hours_start = '08:00:00',
  checkin_active_hours_end   = '22:00:00',
  checkin_cadence_minutes    = 60
where id = '<YOUR_USER_ID>';

-- Remove test messages (optional — they won't hurt anything)
delete from messages
where user_id = auth.uid()
  and metadata->>'source' = 'checkin'
  and created_at > now() - interval '2 hours';

delete from doings_logs
where user_id = auth.uid()
  and created_at > now() - interval '2 hours';
```

Foreground the app after resetting so it re-arms with the real grid.

---

## Pass / Fail Summary Table

| #   | Check                                             | Pass condition                        | Section  |
| --- | ------------------------------------------------- | ------------------------------------- | -------- |
| 1   | Jest 17 suites, 257 tests                         | No failures                           | A        |
| 2   | `tsc --noEmit`                                    | No output                             | A        |
| 3   | Exactly one arm per session                       | No rapid-fire `armCheckins` in logcat | Before A |
| 4   | Alarms registered in `dumpsys alarm`              | ≥1 `NOTIFICATION_EVENT` for `davos`   | B        |
| 5   | `timezone` ≠ `Africa/Abidjan`                     | Real IANA zone in DB                  | C        |
| 6   | First banner fires at correct time                | Heads-up at `start + cadence`         | D        |
| 7   | Send button dismisses notification                | No infinite spinner                   | D        |
| 8   | `doings_logs` row: source, window, energy, embed  | DB query matches spec                 | D        |
| 9   | `latest_energy` updated                           | DB query                              | D        |
| 10  | Duplicate window → `status:duplicate`, one row    | API response                          | E        |
| 11  | Energy ≤ 3 → `eval_ran:true`, `intervention:true` | API response                          | F        |
| 12  | Intervention writes user row + assistant row      | DB query                              | F        |
| 13  | Queue replay: offline reply lands after reconnect | DB row appears                        | G        |
| 14  | Normal chat still works (§5.3 regression)         | Davos replies to a chat message       | H        |

**If all 14 pass → Step 4 is verified. Flip it to ✅ in `FP-04-PLAN.md` and start Step 5.**

---

## What This Drill Does NOT Cover

These are intentionally **out of scope** because they are not yet built:

| Feature                                     | Built in | Status       |
| ------------------------------------------- | -------- | ------------ |
| `focus=checkin` composer mode in chat       | Step 5   | ⬜ not built |
| Energy chips in chat thread                 | Step 5   | ⬜ not built |
| Web in-app check-in banner                  | Step 5   | ⬜ not built |
| Automatic watchdog firing on missed windows | Step 6   | ⬜ not built |
| Settings cadence/hours pickers              | Step 7   | ⬜ not built |

The only user-facing capture path right now is: **notification banner → Reply action → direct reply text**, or the manual `submit-checkin` API call. That is exactly what this drill tests.
