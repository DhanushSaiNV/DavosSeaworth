// lib/checkins.ts
// FP-04 Step 4 — the check-in scheduler: arm/cancel via expo-notifications,
// direct-reply hook, TZ sync, queue flush.
//
// Refs: FP-04 FR-1, FR-2, FR-3, FR-17; TECH-SPEC §7.1, §8, §9; D1, D9.
// Web has no scheduling (Platform.OS gate); banner is Step 5's.

import * as Notifications from "expo-notifications";
import { Platform, AppState, AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { supabase } from "./supabase"; // the anon client
import { checkinQueue } from "./checkinQueue";
import { Grid, rollingWindows, isValidTimeZone, utcToLocalLabel } from "./checkinGrid";

// ---------------------------------------------------------------------------- config

const CHECKIN_CHANNEL_ID = "checkin";
const CHECKIN_CATEGORY_ID = "checkin_reply";

interface CheckInNotificationData {
  windowTs: number; // the window's start (UTC ms)
  windowId: string; // the deterministic id: checkin_{userId}_{epochHour}
  [key: string]: unknown; // index signature for expo-notifications data field
}

let notificationListener: Notifications.Subscription | null = null;
let responseListener: Notifications.Subscription | null = null;
let appStateListener: { remove: () => void } | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let armedUserId: string | null = null;

// ---------------------------------------------------------------------------- channel / category setup

async function ensureChannelAndCategory(): Promise<void> {
  if (Platform.OS !== "android") return;

  // Channel: separate from push `default`, priority default (not heads-up)
  await Notifications.setNotificationChannelAsync(CHECKIN_CHANNEL_ID, {
    name: "Check-ins",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0066FF",
  });

  // Category with Reply text-input action + tap deep link
  // Note: expo-notifications doesn't expose category actions directly on Android
  // The tap deep link is handled by the notification content's `data` field
  // and the app's URL scheme. The reply action requires native module config
  // which is out of scope for the JS layer — the category registration here
  // is a placeholder for the native side (Step 8 device drill).
  // We still register the category ID so the push payload can reference it.
  try {
    await (Notifications as any).setNotificationCategoryAsync?.(CHECKIN_CATEGORY_ID, [
      {
        identifier: "REPLY",
        buttonTitle: "Reply",
        options: { isAuthenticationRequired: false },
        textInput: {
          submitButtonTitle: "Send",
          placeholder: "Type your check-in…",
        },
      },
    ]);
  } catch {
    // Category API may not be available in all Expo SDK versions — not fatal
  }
}

// ---------------------------------------------------------------------------- profile helpers

interface ProfileGridRow {
  timezone: string | null;
  checkin_cadence_minutes: number;
  checkin_active_hours_start: string;
  checkin_active_hours_end: string;
}

async function loadProfileGrid(userId: string): Promise<Grid | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end",
    )
    .eq("id", userId)
    .single();

  if (error || !data) return null;

  const row = data as ProfileGridRow;
  const cadence = row.checkin_cadence_minutes;
  if (cadence !== 60 && cadence !== 120) return null;

  const timezone = row.timezone || "UTC";
  if (!isValidTimeZone(timezone)) return null;

  return {
    timezone,
    cadenceMinutes: cadence as 60 | 120,
    activeStart: String(row.checkin_active_hours_start),
    activeEnd: String(row.checkin_active_hours_end),
  };
}

// ---------------------------------------------------------------------------- TZ sync

async function maybeSyncTimezone(userId: string): Promise<void> {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data } = await supabase
    .from("profiles")
    .select("timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end")
    .eq("id", userId)
    .single();

  if (!data) return;
  const row = data as ProfileGridRow;
  const profileTz = row.timezone || "UTC";
  if (deviceTz !== profileTz) {
    // Fire-and-forget: keeps the watchdog grid aligned with what the device actually fired
    await supabase.rpc("update_checkin_prefs", {
      p_cadence: row.checkin_cadence_minutes,
      p_start: row.checkin_active_hours_start,
      p_end: row.checkin_active_hours_end,
      p_tz: deviceTz,
    });
  }
}

// ---------------------------------------------------------------------------- scheduling

function buildNotificationContent(
  timezone: string,
  window: { id: string; startMs: number; closeMs: number },
): Notifications.NotificationContentInput {
  const localClose = utcToLocalLabel(timezone, window.closeMs) ?? "close";
  return {
    title: "Davos check-in",
    body: `How did the ${localClose} window go?`,
    data: {
      windowTs: window.startMs,
      windowId: window.id,
      // The tap deep link (GLOSSARY §10; FP-04-PLAN Step 4 item 2): opens the
      // composer in check-in mode focused on this window.
      url: "davos://chat?focus=checkin",
    } as CheckInNotificationData,
    categoryIdentifier: CHECKIN_CATEGORY_ID,
    sound: true,
    priority: Notifications.AndroidNotificationPriority.DEFAULT,
  };
}

async function scheduleNotifications(
  userId: string,
  grid: Grid,
  nowMs: number,
): Promise<void> {
  const { windows } = rollingWindows(grid, nowMs, userId);
  const validIds = new Set(windows.map((w) => w.id));

  // Re-arm is idempotent: cancel the check-in ids the rolling set no longer covers, then
  // schedule only the ids that are not already pending (the deterministic id is the key).
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const pending = new Set(
    existing
      .filter((n) => n.identifier.startsWith("checkin_"))
      .map((n) => n.identifier),
  );

  for (const id of pending) {
    if (!validIds.has(id)) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  }

  for (const w of windows) {
    if (pending.has(w.id)) continue;
    const trigger: Notifications.TimeIntervalTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.ceil((w.closeMs - nowMs) / 1000)),
      repeats: false,
    };
    await Notifications.scheduleNotificationAsync({
      content: buildNotificationContent(grid.timezone, w),
      trigger,
      identifier: w.id, // deterministic id enables re-arm idempotency
    });
  }
}

/** Arm the check-in scheduler for a user. Idempotent — safe to call repeatedly. */
export async function armCheckins(userId: string): Promise<void> {
  if (Platform.OS === "web") return; // Step 5 banner is web's path

  await ensureChannelAndCategory();

  const grid = await loadProfileGrid(userId);
  if (!grid) return; // fail-closed: no grid, no scheduling

  const nowMs = Date.now();
  await maybeSyncTimezone(userId);
  await scheduleNotifications(userId, grid, nowMs);

  armedUserId = userId;

  // Install listeners once per session
  if (!notificationListener) {
    notificationListener = Notifications.addNotificationReceivedListener(handleNotificationReceived);
  }
  if (!responseListener) {
    responseListener = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
  }
  if (!appStateListener) {
    appStateListener = AppState.addEventListener("change", handleAppStateChange);
  }
  if (!realtimeChannel) {
    // A live socket means real connectivity: replay anything the queue is holding. Mirrors
    // `chat.tsx`'s replay trigger (Realtime `SUBSCRIBED`, not a transport event). No timer:
    // the queue replay is trigger-driven only, so it can never poll or spin (GLOSSARY §8).
    realtimeChannel = supabase
      .channel(`checkin_flush_${userId}`)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void triggerFlush(userId);
      });
  }
}

/** Cancel all check-in notifications for the current user. */
export async function cancelCheckins(): Promise<void> {
  if (armedUserId) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    armedUserId = null;
  }
  if (notificationListener) {
    notificationListener.remove();
    notificationListener = null;
  }
  if (responseListener) {
    responseListener.remove();
    responseListener = null;
  }
  if (appStateListener) {
    appStateListener.remove();
    appStateListener = null;
  }
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  removeNetInfoListener();
}

// ---------------------------------------------------------------------------- direct-reply handling

async function submitCheckIn(
  userId: string,
  content: string,
  windowTs: number,
): Promise<{ ok: boolean; error?: string }> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return { ok: false, error: "no_session" };

  const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/submit-checkin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify({ content, capture: "reply", windowTs }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || `http_${res.status}` };
  }
  return { ok: true };
}

async function handleNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
  const data = response.notification.request.content.data as CheckInNotificationData | undefined;
  if (!data?.windowTs) return;

  const userId = armedUserId;
  if (!userId) return;

  // If the user typed in the reply action, `response.userText` has it.
  // Otherwise, deep-link tap opens the app — Step 5 handles that path.
  const content = response.userText?.trim();
  if (content) {
    const { ok, error } = await submitCheckIn(userId, content, data.windowTs);
    if (!ok) {
      await checkinQueue.enqueueCheckIn(userId, content, data.windowTs, Date.now());
    }
  }
}

function handleNotificationReceived(notification: Notifications.Notification): void {
  // Foreground receipt — could surface an in-app banner, but the notification
  // already shows. No-op for now; Step 5's composer focus handles the tap path.
}

function handleAppStateChange(state: AppStateStatus): void {
  if (state === "active" && armedUserId) {
    triggerFlush(armedUserId);
  }
}

// ---------------------------------------------------------------------------- queue flush triggers

async function triggerFlush(userId: string): Promise<void> {
  const { drained } = await checkinQueue.flushQueue(
    userId,
    (content, windowTs) => submitCheckIn(userId, content, windowTs),
    Date.now(),
  );
  if (!drained) {
    // Next periodic flush or trigger will retry
  }
}

/**
 * Flush the pending check-in queue now — the manual/focus trigger (FP-04-PLAN Step 4
 * item 3). Also invoked internally by the NetInfo, Realtime and AppState triggers.
 */
export async function flushCheckins(userId: string): Promise<void> {
  await triggerFlush(userId);
}

// NetInfo listener for connectivity changes
let netInfoUnsubscribe: (() => void) | null = null;
export function installNetInfoListener(): void {
  if (netInfoUnsubscribe) return;
  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && armedUserId) {
      triggerFlush(armedUserId);
    }
  });
}

export function removeNetInfoListener(): void {
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
    netInfoUnsubscribe = null;
  }
}

// ---------------------------------------------------------------------------- utilities

export function isCheckinNotification(notification: Notifications.Notification): boolean {
  const data = notification.request.content.data as CheckInNotificationData | undefined;
  return !!data?.windowId?.startsWith("checkin_");
}

export function getCheckinWindowTs(notification: Notifications.Notification): number | null {
  const data = notification.request.content.data as CheckInNotificationData | undefined;
  return data?.windowTs ?? null;
}

// Re-export for convenience
export { loadProfileGrid };
export type { Grid, GridWindow } from "./checkinGrid";