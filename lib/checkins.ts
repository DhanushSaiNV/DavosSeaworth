// lib/checkins.ts
// FP-04 Step 4 — the check-in scheduler: arm/cancel via expo-notifications,
// direct-reply hook, TZ sync, queue flush.
//
// Refs: FP-04 FR-1, FR-2, FR-3, FR-17; TECH-SPEC §7.1, §8, §9; D1, D9.
// Web has no scheduling (Platform.OS gate); banner is Step 5's.

import * as Notifications from 'expo-notifications';
import { Platform, AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase'; // the anon client
import { checkinQueue } from './checkinQueue';
import {
  Grid,
  GridWindow,
  currentOpenWindow,
  rollingWindows,
  isValidTimeZone,
  utcToLocalLabel,
} from './checkinGrid';

// ---------------------------------------------------------------------------- config

// Android freezes a channel's importance at creation, and only the *user* may raise it
// afterwards — so a channel that needs a different importance needs a new id. `checkin_v2`
// is the IMPORTANCE_HIGH (heads-up) channel; the pre-drill `checkin` channel was created
// DEFAULT and could never peek, whatever the app asked for later (TECH-SPEC §7.1).
const CHECKIN_CHANNEL_ID = 'checkin_v2';
const CHECKIN_CATEGORY_ID = 'checkin_reply';

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
/** Set by a check-in tap (no direct-reply text) so the composer can carry that very window. */
let pendingTapWindowTs: number | null = null;

// ---------------------------------------------------------------------------- channel / category setup

async function ensureChannelAndCategory(): Promise<void> {
  // The action category (the Reply text-input action, FR-2) is read on iOS **and**
  // Android, so it is registered on both. Without it, the tap deep link still works
  // (Step 5's fallback) — so a registration failure is non-fatal.
  try {
    await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY_ID, [
      {
        identifier: 'REPLY',
        buttonTitle: 'Reply',
        textInput: {
          submitButtonTitle: 'Send',
          placeholder: 'Type your check-in…',
        },
        options: { isAuthenticationRequired: false },
      },
    ]);
  } catch (err) {
    console.warn(
      '[checkin] category registration failed:',
      err instanceof Error ? err.message : err
    );
  }

  // The Android channel is separate from push's `default` and HIGH so a check-in peeks as a
  // heads-up banner (DEFAULT is shade-only — Android refuses the peek at any lower
  // importance). iOS has no channels — nothing to do there.
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHECKIN_CHANNEL_ID, {
    name: 'Check-ins',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0066FF',
    enableVibrate: true,
    showBadge: true,
  });
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
    .from('profiles')
    .select(
      'timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end'
    )
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  const row = data as ProfileGridRow;
  const cadence = row.checkin_cadence_minutes;
  if (cadence !== 60 && cadence !== 120) return null;

  const timezone = row.timezone || 'UTC';
  if (!isValidTimeZone(timezone)) return null;

  return {
    timezone,
    cadenceMinutes: cadence as 60 | 120,
    activeStart: String(row.checkin_active_hours_start),
    activeEnd: String(row.checkin_active_hours_end),
  };
}

// ---------------------------------------------------------------------------- TZ sync

/**
 * Hermes/ICU can fail to resolve the device's zone and silently report a canonical +00:00 id
 * (`Africa/Abidjan` on Android), which would move the whole grid to UTC. Trust the reported
 * zone only when it also describes this device's own wall clock; otherwise leave
 * `profiles.timezone` alone. A native zone read is the durable fix (`expo-localization`,
 * tracked as an owner item; TECH-SPEC §7.1).
 */
function isTrustedDeviceZone(deviceTz: string): boolean {
  if (!isValidTimeZone(deviceTz)) return false;
  const zoneLabel = utcToLocalLabel(deviceTz, Date.now());
  if (!zoneLabel) return false;
  const now = new Date();
  const deviceLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return zoneLabel === deviceLabel;
}

async function maybeSyncTimezone(userId: string): Promise<void> {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // A zone the engine cannot vouch for is never written (see isTrustedDeviceZone).
  if (!isTrustedDeviceZone(deviceTz)) return;
  const { data } = await supabase
    .from('profiles')
    .select(
      'timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end'
    )
    .eq('id', userId)
    .single();

  if (!data) return;
  const row = data as ProfileGridRow;
  const profileTz = row.timezone || 'UTC';
  if (deviceTz !== profileTz) {
    // Fire-and-forget: keeps the watchdog grid aligned with what the device actually fired
    await supabase.rpc('update_checkin_prefs', {
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
  window: { id: string; startMs: number; closeMs: number }
): Notifications.NotificationContentInput {
  const localClose = utcToLocalLabel(timezone, window.closeMs) ?? 'close';
  return {
    title: 'What did you do this hour?',
    body: `How did the ${localClose} window go?`,
    data: {
      windowTs: window.startMs,
      windowId: window.id,
      // The tap deep link (GLOSSARY §10; FP-04-PLAN Step 4 item 2): opens the
      // composer in check-in mode focused on this window. The window start rides along so a tap
      // seconds after the close still answers the interval the notification asked about (FR-4);
      // the server canonicalizes the hint either way.
      url: `davos://chat?focus=checkin&windowTs=${window.startMs}`,
    } as CheckInNotificationData,
    categoryIdentifier: CHECKIN_CATEGORY_ID,
    sound: true,
    // On Android 8+ the channel's importance (not this field) decides heads-up; the
    // priority is what Android 7 and older read, so it is set to match the channel.
    priority: Notifications.AndroidNotificationPriority.HIGH,
  };
}

async function scheduleNotifications(userId: string, grid: Grid, nowMs: number): Promise<void> {
  const { windows } = rollingWindows(grid, nowMs, userId);
  const validIds = new Set(windows.map((w) => w.id));

  // Re-arm is idempotent: cancel the check-in ids the rolling set no longer covers, then
  // schedule only the ids that are not already pending (the deterministic id is the key).
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const pending = new Set(
    existing.filter((n) => n.identifier.startsWith('checkin_')).map((n) => n.identifier)
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
  if (Platform.OS === 'web') {
    // Web schedules no notifications (FR-2) — but the in-app banner is web's *only* check-in
    // surface, and its predicate reads this cached grid. Returning before the load left
    // `getGrid()` null on web, so the banner could never render at all (FR-4, AC-10).
    const webGrid = await loadProfileGrid(userId);
    if (webGrid) setLoadedGrid(webGrid);
    return; // Step 5 banner is web's path
  }

  // Android 13+ gates notifications behind the runtime POST_NOTIFICATIONS grant, and
  // scheduling "succeeds" without it — the notification is simply never shown, with
  // nothing in the logs. `registerPushToken` asks first (§7.10), but a revoked or
  // never-granted permission must not leave the check-in loop silently dead.
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    if (!canAskAgain) {
      console.warn('[checkin] notification permission denied — nothing scheduled');
      return;
    }
    const { status: requested } = await Notifications.requestPermissionsAsync();
    if (requested !== 'granted') {
      console.warn('[checkin] notification permission not granted — nothing scheduled');
      return;
    }
  }

  await ensureChannelAndCategory();

  const grid = await loadProfileGrid(userId);
  if (!grid) return; // fail-closed: no grid, no scheduling

  setLoadedGrid(grid); // cache + publish for chat.tsx banner/check-in mode

  const nowMs = Date.now();
  await maybeSyncTimezone(userId);
  await scheduleNotifications(userId, grid, nowMs);

  armedUserId = userId;

  // Install listeners once per session
  if (!notificationListener) {
    notificationListener = Notifications.addNotificationReceivedListener(
      handleNotificationReceived
    );
  }
  if (!responseListener) {
    responseListener = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );
  }
  if (!appStateListener) {
    appStateListener = AppState.addEventListener('change', handleAppStateChange);
  }
  if (!realtimeChannel) {
    // A live socket means real connectivity: replay anything the queue is holding. Mirrors
    // `chat.tsx`'s replay trigger (Realtime `SUBSCRIBED`, not a transport event). No timer:
    // the queue replay is trigger-driven only, so it can never poll or spin (GLOSSARY §8).
    realtimeChannel = supabase.channel(`checkin_flush_${userId}`).subscribe((status) => {
      if (status === 'SUBSCRIBED') void triggerFlush(userId);
    });
  }

  // FR-3: a reply delivered while the process was dead is held by the OS and handed back as
  // the launch response. `getLastNotificationResponse()` returns it once the emitter is live,
  // so the original windowTs is replayed here; the handler clears it afterwards, so a later
  // re-arm cannot handle the same reply twice.
  const launchResponse = Notifications.getLastNotificationResponse();
  if (launchResponse) void handleNotificationResponse(launchResponse);
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

interface SubmitResult {
  ok: boolean;
  error?: string;
  /** A 4xx is a permanent rejection — a replay can never succeed, so the queue drops it. */
  permanent?: boolean;
}

async function submitCheckIn(
  userId: string,
  content: string,
  windowTs: number
): Promise<SubmitResult> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return { ok: false, error: 'no_session', permanent: true };

  const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/submit-checkin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.session.access_token}`,
    },
    // FR-5: `windowTs` is the notification's window start as an ISO hint — the server
    // canonicalizes it to a grid window. The notification payload carries it as epoch ms
    // (a number), which the server accepts too, but ISO is the canonical wire form.
    body: JSON.stringify({ content, capture: 'reply', windowTs: new Date(windowTs).toISOString() }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: err.error || `http_${res.status}`,
      permanent: res.status >= 400 && res.status < 500,
    };
  }
  return { ok: true };
}

async function handleNotificationResponse(
  response: Notifications.NotificationResponse
): Promise<void> {
  const notification = response.notification;
  const data = notification.request.content.data as CheckInNotificationData | undefined;
  // Only check-in notifications belong to this handler — a tap on any other notification
  // (e.g. an intervention push) must be left untouched, not dismissed here.
  if (!data?.windowId?.startsWith('checkin_')) return;

  try {
    const userId = armedUserId;
    // If the user typed in the reply action, `response.userText` has it.
    // Otherwise, deep-link tap opens the app — Step 5 handles that path.
    const content = response.userText?.trim();
    if (userId && data.windowTs && content) {
      try {
        const { ok, error } = await submitCheckIn(userId, content, data.windowTs);
        if (!ok) {
          console.warn(`[checkin] submit failed (${error}), enqueueing`);
          await checkinQueue.enqueueCheckIn(userId, content, data.windowTs, Date.now());
        }
      } catch (e) {
        console.warn(
          `[checkin] submit threw (${e instanceof Error ? e.message : String(e)}), enqueueing`
        );
        await checkinQueue.enqueueCheckIn(userId, content, data.windowTs, Date.now());
      }
    } else if (typeof data.windowTs === 'number') {
      // A plain tap (no direct-reply text): the composer opens in check-in mode for this very
      // window (FR-4). Recorded here because the handler always runs before the tap's route.
      pendingTapWindowTs = data.windowTs;
    }
  } finally {
    // A consumed RemoteInput reply leaves Android's send button spinning until the
    // notification is dismissed — expo-notifications does not do it for us (the "still
    // loading" spinner the drill hit). Clearing the last response also keeps the FR-3
    // app-open replay from handling the same reply twice.
    await Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
    Notifications.clearLastNotificationResponse();
  }
}

function handleNotificationReceived(notification: Notifications.Notification): void {
  // Foreground receipt — could surface an in-app banner, but the notification
  // already shows. No-op for now; Step 5's composer focus handles the tap path.
}

function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active' && armedUserId) {
    triggerFlush(armedUserId);
  }
}

// ---------------------------------------------------------------------------- queue flush triggers

async function triggerFlush(userId: string): Promise<void> {
  const { drained } = await checkinQueue.flushQueue(
    userId,
    (content, windowTs) => submitCheckIn(userId, content, windowTs),
    Date.now()
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

// Module-level cached grid from the last successful armCheckins
let _loadedGrid: Grid | null = null;

type GridListener = (grid: Grid) => void;

/** Consumers waiting for the first grid (or a refreshed one) — the web banner's re-render hook. */
let gridListeners: GridListener[] = [];

/**
 * Cache the grid and publish it. The load is asynchronous and resolves *after* `chat.tsx`'s
 * first render, so a listener is the only way the banner can appear without waiting for its
 * next clock tick (§7.1).
 */
function setLoadedGrid(grid: Grid): void {
  _loadedGrid = grid;
  for (const listener of gridListeners) listener(grid);
}

/** Returns the grid loaded by the most recent successful armCheckins, or null if never armed. */
export function getGrid(): Grid | null {
  return _loadedGrid;
}

/**
 * Subscribe to grid availability. Fires immediately when a grid is already cached, so a late
 * subscriber is not left waiting. Returns the unsubscribe function.
 */
export function onGridLoaded(listener: GridListener): () => void {
  gridListeners.push(listener);
  if (_loadedGrid) listener(_loadedGrid);
  return () => {
    gridListeners = gridListeners.filter((entry) => entry !== listener);
  };
}

/** Returns the currently-open check-in window for the given user, with correct userId in the window id. */
export function getCurrentOpenWindow(grid: Grid, nowMs: number, userId: string): GridWindow | null {
  return currentOpenWindow(grid, nowMs, userId);
}

/**
 * The window a check-in tap should focus the composer on (FR-4). The response handler records a
 * live tap; a launch-from-notification has no live event, so its response is read from Expo's
 * last-response slot. Consumed once — a re-render must not re-open a stale window. Web has no
 * notification at all, so it has nothing to report (the banner resolves the window itself).
 */
export function takePendingTapWindowTs(): number | null {
  if (Platform.OS === 'web') return null;
  const recorded = pendingTapWindowTs;
  pendingTapWindowTs = null;
  if (recorded !== null) return recorded;
  const launch = Notifications.getLastNotificationResponse();
  const data = launch?.notification.request.content.data as CheckInNotificationData | undefined;
  return typeof data?.windowTs === 'number' ? data.windowTs : null;
}

/** Delegates to checkinQueue for the last answered timestamp. */
export async function getLastCheckInResponseAt(userId: string): Promise<number | null> {
  return checkinQueue.getLastCheckInResponseAt(userId);
}

// ---------------------------------------------------------------------------- utilities

export function isCheckinNotification(notification: Notifications.Notification): boolean {
  const data = notification.request.content.data as CheckInNotificationData | undefined;
  return !!data?.windowId?.startsWith('checkin_');
}

export function getCheckinWindowTs(notification: Notifications.Notification): number | null {
  const data = notification.request.content.data as CheckInNotificationData | undefined;
  return data?.windowTs ?? null;
}

// Re-export for convenience
export { loadProfileGrid, utcToLocalLabel };
export type { Grid, GridWindow } from './checkinGrid';
