// lib/impulse.ts
// FP-08 Step 8 — the impulse interception surfaces (FR-20, D22's logging half).
//
// Two surfaces, one endpoint:
//   * Android: a persistent (ongoing) local notification with the "Impulse lost" quick action.
//     It rides FP-04's channel/category infrastructure and is posted while the app is
//     backgrounded, dismissed while it is active. The action opens the app (no headless task
//     dependency — `expo-task-manager` is not part of this build) and the response listener
//     then posts `log-impulse`; the tap target is chat.
//   * Every platform: the in-app button in the chat composer (`chat.tsx`), posting `capture:'app'`.
//
// Both go through `traceNetworkCall` with subsystem `chat`; every log line uses `logger`.
// Web/iOS have no persistent notification (the recorded reading in FR-20: persistent
// notifications are an Android idiom).
//
// Refs: FP-08 FR-20, FR-21; TECH-SPEC §7.8, §8, §9; D1, D22; AGENTS.md §7.8.

import * as Notifications from "expo-notifications";
import { AppState, AppStateStatus, Linking, Platform } from "react-native";
import { supabase } from "./supabase";
import { logger } from "./logger";
import { traceNetworkCall } from "./observability";

export type ImpulseCapture = "quick_action" | "app";

export type LogImpulseResult =
  | { ok: true; doingId: string }
  | { ok: false; error: string };

const IMPULSE_CHANNEL_ID = "impulse_v1";
const IMPULSE_CATEGORY_ID = "impulse_lost";
const IMPULSE_ACTION_ID = "LOG_IMPULSE";
const IMPULSE_NOTIFICATION_ID = "impulse_persistent";
const IMPULSE_DEEP_LINK = "davos://chat";

interface ImpulseNotificationData {
  kind: "impulse";
  url: string;
  [key: string]: unknown;
}

let armedUserId: string | null = null;
let appStateListener: { remove: () => void } | null = null;
let responseListener: Notifications.Subscription | null = null;

/** POST `log-impulse` for the signed-in user. Never throws; callers render the outcome. */
export async function logImpulse(
  capture: ImpulseCapture,
  content?: string,
): Promise<LogImpulseResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    logger.warn("chat", "log-impulse skipped: no session");
    return { ok: false, error: "no_session" };
  }

  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) {
    logger.warn("chat", "log-impulse skipped: no Supabase URL");
    return { ok: false, error: "no_config" };
  }

  const body: Record<string, unknown> = { capture };
  if (typeof content === "string" && content.trim().length > 0) {
    body.content = content.trim();
  }

  try {
    const result = await traceNetworkCall("chat", "log-impulse", async () => {
      const res = await fetch(`${base}/functions/v1/log-impulse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => ({}));
        throw new Error(parsed.error || `http_${res.status}`);
      }
      return (await res.json()) as { doing_id?: string };
    }, { capture });

    if (!result.doing_id) {
      logger.warn("chat", "log-impulse returned no doing_id");
      return { ok: false, error: "no_doing_id" };
    }
    logger.info("chat", "impulse logged", { capture, doing_id: result.doing_id });
    return { ok: true, doingId: result.doing_id };
  } catch (err) {
    logger.warn(
      "chat",
      "log-impulse failed",
      { capture },
      err,
    );
    return { ok: false, error: err instanceof Error ? err.message : "network" };
  }
}

// ---------------------------------------------------------------------------- persistent notification

async function ensureCategoryAndChannel(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(IMPULSE_CATEGORY_ID, [
      {
        identifier: IMPULSE_ACTION_ID,
        buttonTitle: "Impulse lost",
        // No headless task in this build: the action opens the app and the JS response
        // listener posts the row. It is one tap either way; the row is the product.
        options: { isAuthenticationRequired: false, isDestructive: false, opensAppToForeground: true },
      },
    ]);
  } catch (err) {
    logger.warn("chat", "impulse category registration failed", undefined, err);
  }

  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(IMPULSE_CHANNEL_ID, {
      name: "Impulse",
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
      enableVibrate: false,
    });
  } catch (err) {
    logger.warn("chat", "impulse channel registration failed", undefined, err);
  }
}

async function dismissImpulseNotification(): Promise<void> {
  await Notifications.dismissNotificationAsync(IMPULSE_NOTIFICATION_ID).catch(() => {});
}

async function postImpulseNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  // Replace, never stack: the persistent row is one row.
  await dismissImpulseNotification();
  const content: Notifications.NotificationContentInput = {
    title: "Impulse incoming?",
    body: "Log it before it wins.",
    categoryIdentifier: IMPULSE_CATEGORY_ID,
    sticky: true,
    autoDismiss: false,
    data: { kind: "impulse", url: IMPULSE_DEEP_LINK } as ImpulseNotificationData,
  };
  await Notifications.scheduleNotificationAsync({
    identifier: IMPULSE_NOTIFICATION_ID,
    content,
    trigger: null,
  }).catch((err) => {
    logger.warn("chat", "impulse notification post failed", undefined, err);
  });
}

function handleAppStateChange(state: AppStateStatus): void {
  if (!armedUserId) return;
  if (state === "active") void dismissImpulseNotification();
  else void postImpulseNotification();
}

async function handleImpulseResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const data = response.notification.request.content.data as ImpulseNotificationData | undefined;
  if (!data || data.kind !== "impulse") return;

  try {
    if (response.actionIdentifier === IMPULSE_ACTION_ID) {
      const result = await logImpulse("quick_action");
      logger.info("chat", "quick-action impulse handled", {
        ok: result.ok,
        ...(result.ok ? { doing_id: result.doingId } : { error: result.error }),
      });
    }
    if (typeof data.url === "string" && data.url.length > 0) {
      await Linking.openURL(data.url).catch(() => {});
    }
  } finally {
    await dismissImpulseNotification();
  }
}

/**
 * Arm the Android persistent notification for a signed-in user. Idempotent; safe on iOS/web
 * (no persistent surface, nothing to register). Call `disarmImpulseNotification` on sign-out.
 */
export async function armImpulseNotification(userId: string): Promise<void> {
  armedUserId = userId;
  if (Platform.OS !== "android") return;

  await ensureCategoryAndChannel();

  if (!appStateListener) {
    appStateListener = AppState.addEventListener("change", handleAppStateChange);
  }
  if (!responseListener) {
    responseListener = Notifications.addNotificationResponseReceivedListener(
      (response) => void handleImpulseResponse(response),
    );
  }

  // A cold start can hand back the action that launched the process.
  const launchResponse = Notifications.getLastNotificationResponse();
  if (launchResponse) void handleImpulseResponse(launchResponse);

  // The notification is for the backgrounded app. Foreground it is noise.
  if (AppState.currentState === "active") await dismissImpulseNotification();
  else await postImpulseNotification();
}

/** Dismiss and unhook the persistent surface. */
export async function disarmImpulseNotification(): Promise<void> {
  armedUserId = null;
  if (appStateListener) {
    appStateListener.remove();
    appStateListener = null;
  }
  if (responseListener) {
    responseListener.remove();
    responseListener = null;
  }
  await dismissImpulseNotification();
}
