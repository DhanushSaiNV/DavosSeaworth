# FP-04 Device Drill Guide (owner)

**Companion to:** `docs/feature-prds/FP-04/FP-04.md` · build plan `docs/feature-prds/FP-04/FP-04-PLAN.md` · the ledger `docs/feature-prds/FP-04/FP-04-ACCEPTANCE.md` (the rows this drill flips)
**Scope:** the whole check-in loop as built through **Step 7** — the rolling scheduler, the notification and its direct reply, the deep link, energy chips, the watchdog intervention, the settings screen, and the web banner.
**Why this drill exists:** four AC rows cannot be automated (AC-3's device/browser leg, AC-4's Android push, AC-9's device half, AC-10's banner). They are `[owner-observed]` by definition: `sendPush` is silent on success, and a notification banner has no automated witness. Record each observation in `FP-04-ACCEPTANCE.md` and flip the row.

**Time:** ~40 min Android, ~15 min iOS, ~10 min web, ~10 min settings.

**Preconditions:**

- A **dev build** on the device (not Expo Go) and Metro running (`npx expo start`).
- Signed in — the `(app)` layout must be mounted, because that is what arms the scheduler. If you are on the sign-in screen, nothing is scheduled.
- `adb` working for the Android checks; a browser tab for web.
- The workstation env: `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DEV_SMOKE_TOKEN` / `DAVOS_USER_JWT` (the same env the gates use).
- Android battery: **Settings → Apps → Davos → Battery → Unrestricted.** OEM battery managers kill the direct-reply handler — D9's acknowledged trade-off (R-1).
- `dev_overrides_enabled`: leave it `true` for the drill (the energy/eval forcing needs it), then flip it to `false` before real beta users — FP-04's drill is part of that "done drills" set.

---

## Section A — Workstation static checks (run first, ~3 min)

```powershell
npx jest --ci 2>&1 | Select-String "Tests:|Test Suites:|FAIL"
npx tsc --noEmit
python scripts/verify-fp04-step4.py --static-only
```

**Expected:** jest `21 passed / 324 tests`, `tsc` silent, the gate green. A failure here means the device results cannot be trusted — stop and fix first.

---

## Section B — Confirm the app is armed (device, ~2 min)

The single most important check. Without alarms in Android's AlarmManager, nothing else matters.

```powershell
adb shell pidof com.anonymous.davos          # non-empty = the process is alive
adb shell dumpsys alarm | Select-String "davos" | Select-Object -First 30
```

**What you must see:** `*walarm*:expo.modules.notifications.NOTIFICATION_EVENT` with 1–24 entries (one per upcoming window). Note the soonest trigger — that is when the next banner fires.

| Output | Diagnosis |
| --- | --- |
| Zero `davos` lines | The arm failed — check logcat below |
| `alarm_cancelled` entries with nothing after them | The grid changed and the re-arm did not run; foreground the app |
| All triggers far in the future | Grid math — Section C |

```powershell
adb logcat -d | Select-String "checkin|arm|cancel|permission" | Select-Object -Last 30
```

You want exactly **one** arm sequence per session:

```
[checkin] getPermissionsAsync → granted
[checkin] armCheckins start for user <uuid>
[checkin] scheduleNotifications: N windows scheduled
```

`notification permission not granted` → Settings → Apps → Davos → Notifications → enable (and see §L for the in-app surface). `loadProfileGrid returned null` → the profile read failed; check the `.env` URL and the network.

> **Cold-start-offline note:** if the app opens with no connectivity, `armCheckins` bails before setting `armedUserId`, so a later foreground retries the arm. That is the recorded gap — a device that starts offline simply arms on the next successful open.

---

## Section C — Grid math (workstation, ~3 min)

The most common silent failure: the grid computes zero windows because the active-hours arithmetic rules every window out.

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

| Column | Problem | Fix |
| --- | --- | --- |
| `timezone` = `Africa/Abidjan` | A Hermes `Intl` fallback wrote UTC+0 instead of the real zone | `update profiles set timezone = 'Asia/Kolkata' where id = '<ID>';` |
| `start + cadence > end` (in minutes) | Zero windows emitted | Set `start` at least one cadence before `end` |
| `end = 23:59` with `start` too late | No window fits | Move `start` earlier, or cadence 120 with `start ≤ 22:00` |

First banner fires at **`active_hours_start + cadence`** (the notification asks about the interval just ended, not the one beginning). Cross-check against `dumpsys alarm` from Section B.

---

## Section D — Android: banner → direct reply → DB row (AC-1, AC-3, AC-9)

To avoid waiting an hour, open a test window that closes in ~5 minutes: set `checkin_active_hours_start` to `now − 65 min` (in the profile's zone) so close lands ~5 min out.

```sql
-- adjust to 65 min before NOW
update profiles
set
  checkin_cadence_minutes    = 60,
  checkin_active_hours_start = '16:53:00',
  checkin_active_hours_end   = '23:59:00'
where id = '<YOUR_USER_ID>';
```

Foreground the app (the AppState listener re-arms), then re-run Section B to confirm the new trigger.

**D1 — watch for the banner.** Background the app. At window close:
✅ a heads-up banner titled **"What did you do this hour?"** with a **Reply** action.
❌ no banner → `adb logcat -d | Select-String "NOTIFICATION_EVENT|NotificationManager|davos"`. `NOTIFICATION_EVENT` present means the OS fired but the channel blocked display (the channel must be `checkin_v2` at `HIGH`); nothing means the alarm was cancelled — re-check Section B.

**D2 — direct reply.** Tap **Reply**, send `finished the report 5`. The Send control spins briefly, then the **notification dismisses itself**. An eternal spinner means the dismissal `finally` is not in the build — shake → Reload JS.

**D3 — verify the row.**

```sql
select id, kind, source, checkin_window::text, logged_at::text, energy,
       left(content, 40) as content_preview, embed_model
from doings_logs
where user_id = auth.uid()
order by created_at desc
limit 3;

select latest_energy from profiles where id = auth.uid();
```

Expected: `kind=doing`, `source=checkin_reply`, `checkin_window` = the window **start**, `logged_at` = the window **close**, `energy=5`, `embed_model=gemini-embedding-001@768`, and `latest_energy=5`. **No `messages` rows** for this on-track turn.

---

## Section E — Duplicate window guard (AC-6)

```powershell
$windowTs = "2026-10-18T11:00:00Z"   # the checkin_window (ISO) from D3
$headers  = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $env:DAVOS_USER_JWT" }
$body     = @{ content = "second attempt same window"; capture = "reply"; windowTs = $windowTs } | ConvertTo-Json
Invoke-RestMethod -Uri "$env:SUPABASE_URL/functions/v1/submit-checkin" -Method POST -Headers $headers -Body $body
```

Expected: `status: "duplicate"` with the **same** `doing_id`, and still exactly one row for that window. No new embed.

---

## Section F — Low-energy intervention + the push (AC-4)

**F1 — open a fresh window** (wait for the next natural one, or clear your test row):

```sql
delete from doings_logs where user_id = auth.uid() and created_at > now() - interval '10 minutes';
```

**F2 — submit with energy 2:**

```powershell
$body = @{ content = "feel awful, exhausted 2"; capture = "reply"; windowTs = "<current window start>" } | ConvertTo-Json
Invoke-RestMethod -Uri "$env:SUPABASE_URL/functions/v1/submit-checkin" -Method POST -Headers $headers -Body $body | ConvertTo-Json
```

Expected: `eval_ran: true`, `intervention: true`, with `user_message_id` + `assistant_message_id`.

**F3 — verify the turn:**

```sql
select id, role, left(content,60), metadata->>'source', metadata->>'doing_id'
from messages where user_id = auth.uid() and metadata->>'source' = 'checkin'
order by created_at desc limit 2;

select id, role, left(content,120) from messages
where reply_to_message_id = '<user_message_id>' limit 1;
```

**F4 — the push (the AC-4 device row).** With `expo_push_enabled=true` and a valid Android token, a delivered push leaves **no log line** (success is silent) — the banner/buzz on the device **is** the observation. `[push] expo_push_enabled=false, skipping` is the gate being off, not a failure of the path.

---

## Section G — Android: deep link + energy chips (AC-3)

**G1 — deep link.** Send another notification, then tap the **body** (not Reply). Chat opens with the composer in check-in mode, focused on that window (`davos://chat?focus=checkin&windowTs=…`).

**G2 — capture + chips.** Send a check-in with no trailing score, e.g. `wrote the deck`. The **1–10 strip** renders above the composer. Tap **7**: the strip settles (`Energy: 7`), the doing's `energy` and `profiles.latest_energy` both become `7` (re-run the D3 query), and the value **sticks on reload**. If the strip never appeared, confirm the send was in check-in mode, not a normal chat message.

---

## Section H — Pending store (offline reply replay, FR-3)

Enable **Airplane Mode**, trigger a notification, reply to it (the POST fails → the reply is queued). Confirm in logcat: `adb logcat -d | Select-String "checkin.*queue|enqueue|failed"` → a `submit failed — queuing` line. Disable Airplane Mode and **foreground the app** (the NetInfo listener triggers the flush): the row appears within seconds.

---

## Section I — Watchdog smoke (AC-8)

AC-8 is already proven **in production** (job `01eeb89a…`, 2026-10-18 — one unprompted row, no re-fire). This is only a sanity re-check, and it should be run scoped so it cannot nudge the other beta users:

```powershell
Invoke-RestMethod -Uri "$env:SUPABASE_URL/functions/v1/dev-smoke?action=watchdog-scan&now=<a-window-close-minus-15min>&user=<YOUR_USER_ID>" -Headers @{ Authorization = "Bearer $env:DEV_SMOKE_TOKEN" }
```

Then dispatch, and confirm exactly **one** unprompted assistant row (`reply_to_message_id null`, `metadata.source='watchdog_intervention'`) and that a **second scan writes nothing**. The full procedure + the `[watchdog] scan` log shape are in `scripts/verify-fp04-step6.py`.

---

## Section J — iOS (AC-9 device half; the amended AC-4)

- **J1** — the local notification fires at window close; tapping it opens chat (there is no OS direct-reply on iOS in this build; the tap path is the capture path).
- **J2** — an intervention renders **in-thread on the next app open**. There is **no remote push on iOS** ($0 budget — the amended AC, TECH-SPEC §13 item 7). The fallback is the expected behavior, not a failure.
- **J3** — confirm the app never registers for remote push on iOS.

---

## Section K — Web (AC-10)

- **K1** — sign in on web and stay inside active hours with the current window unanswered: the **persistent in-app banner** appears (this replaces notifications; web has no OS scheduling).
- **K2** — tap it → the composer opens in check-in mode → send → the doing lands with `source='chat'`.
- **K3** — the chips render → tap → PATCH → the doing + `latest_energy` update.
- **K4** — no local notifications are scheduled on web (the platform gate); Web Push is deferred (TECH-SPEC §13 item 9).

---

## Section L — Settings (FR-17, Step 7)

- **L1** — cadence **60 → 120** → Save → the `profiles` row shows `120` and the next arm follows the new grid (re-run Section B: fewer alarms, different trigger times; the "N check-ins on a full day" reading drops 14 → 7).
- **L2** — an invalid combination (end ≤ start) is refused **by the form** (Save disabled + the message) and, if forced, by the RPC.
- **L3** — deny the notification permission, then open settings: the **R-4 warning** renders with the re-prompt / "Open system settings" path; grant it there and return — the row refreshes to granted (the screen re-reads on foreground return).
- **L4** — the half-hour steppers clamp at the ends (they do not wrap): stepping past the last valid value simply stops at it.

---

## Section M — Regression: normal chat still works

Send a normal chat message (not a check-in). It appears optimistically, Davos replies, and there is nothing in logcat tagged `[send-message]`/`[chat]`. This is the §5.3 transparency check (AC-7) at the device level.

---

## Section N — Clean up

```sql
update profiles
set checkin_active_hours_start = '08:00:00',
    checkin_active_hours_end   = '22:00:00',
    checkin_cadence_minutes    = 60
where id = '<YOUR_USER_ID>';

delete from messages
where user_id = auth.uid() and metadata->>'source' = 'checkin'
  and created_at > now() - interval '2 hours';

delete from doings_logs
where user_id = auth.uid() and created_at > now() - interval '2 hours';
```

Foreground the app after resetting so it re-arms with the real grid. Then flip `dev_overrides_enabled` to `false`.

---

## Pass / fail summary

| # | Check | AC | Section | Pass condition |
| --- | --- | --- | --- | --- |
| 1 | jest 21 / 324, `tsc` clean, Step 4 gate green | — | A | no failures |
| 2 | Exactly one arm per session | AC-9 | B | one `armCheckins` sequence in logcat |
| 3 | Alarms registered in `dumpsys alarm` | AC-9 | B | ≥ 1 `NOTIFICATION_EVENT` for `davos` |
| 4 | `timezone` is the real IANA zone | AC-9 | C | e.g. `Asia/Kolkata` |
| 5 | The banner fires at window close | AC-9 | D | heads-up at `start + cadence` |
| 6 | Direct reply dismisses the notification | AC-3 | D | no eternal spinner |
| 7 | The doing row is correct (source, window, energy, embed) | AC-1 | D | query matches |
| 8 | `latest_energy` updated | AC-3 | D | query matches |
| 9 | Duplicate window → `status:'duplicate'`, one row | AC-6 | E | API response |
| 10 | energy ≤ 3 → `eval_ran:true`, `intervention:true` | AC-4 | F | API response + rows |
| 11 | The high-priority push arrives | AC-4 | F | the device buzzes/banners |
| 12 | Deep link focuses the check-in composer | AC-3 | G | composer in check-in mode |
| 13 | Chips render → tap 7 → PATCH → reload-stable | AC-3 | G | `energy=7`, `latest_energy=7` |
| 14 | Offline reply replays after reconnect | FR-3 | H | the row appears |
| 15 | Watchdog: one unprompted row, no re-fire | AC-8 | I | one row, second scan writes nothing |
| 16 | iOS local notification + in-chat intervention | AC-9, AC-4 | J | tap opens chat; no remote push |
| 17 | Web banner → check-in → chips | AC-10 | K | banner + PATCH |
| 18 | Settings: cadence save re-arms | FR-17 | L | `profiles` row + new alarms |
| 19 | Settings: denied permission → R-4 warning | R-4 | L | warning + recovery |
| 20 | Normal chat unaffected (§5.3) | AC-7 | M | reply arrives |

**When rows 2–15 and 17–19 pass, flip the four ⏳ rows (AC-3, AC-4's push, AC-9, AC-10) and the ⏳ DoD rows in `FP-04-ACCEPTANCE.md`, then flip the Step 5/6/7/8 tracker rows in `FP-04-PLAN.md`.** If a leg fails, the row stays ⏳ and the fix is its own change.

---

## What this drill does NOT cover

- The watchdog's production evidence — already elapsed (AC-8, Section I is only a sanity re-check).
- Eval quality (R-2) — the `[checkin]`/`[watchdog]` structured log lines are the tuning feed (FR-18).
- The **deferred dev-client items**, which need a rebuild and are recorded, not silently missing: `expo-localization` for the timezone read (`Localization.getCalendars()[0].timeZone`), and `android.permission.SCHEDULE_EXACT_ALARM` in `app.json`.
- Pushes to iOS — no Apple Developer Program ($0); the amended AC stands.
