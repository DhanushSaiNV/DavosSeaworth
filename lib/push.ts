// lib/push.ts
// FP-02 Step 7 — Expo push token registration (TECH-SPECS §7.10, §8; D23).
//
// Registers this device's Expo push token with the backend (`push_tokens`).
// Called once per authenticated session from `app/(app)/_layout.tsx`.
//
// Beta scope is **Android only**:
//  - iOS: remote push needs the Apple Developer Program ($99/yr) — violates the $0
//    budget (TECH-SPECS §13 live item). iOS degrades to Realtime.
//  - Web: Expo's push service does not support web — on web `getDevicePushTokenAsync`
//    returns a Web-Push subscription ({endpoint, keys}), not an `ExpoPushToken`, so
//    `exp.host` cannot deliver it. Web uses Realtime + the in-app banner (TECH-SPECS §7.10).
//
// Android dev builds require FCM credentials: a `google-services.json` (Firebase
// Spark — free) referenced via `android.googleServicesFile`, plus the FCM v1
// service-account key uploaded to the Expo project. Expo Go cannot test push from
// SDK 53. See TECH-SPECS §7.10.
//
// Refs: FP-02 FR-15; AGENTS.md §2, §3.1, §4.1.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { isCheckinNotification } from "./checkins";

/** Result of a registration attempt. */
export interface PushRegistrationResult {
  success: boolean;
  token?: string;
  platform?: "android" | "web" | "ios";
  error?: string;
}

/** Android notification channel id; the server sends `channelId: "default"` (§7.10). */
const ANDROID_CHANNEL_ID = "default";

/**
 * Request notification permission. Android 13+ needs the runtime POST_NOTIFICATIONS
 * grant; older versions auto-grant, in which case the status already reads "granted".
 */
async function requestPermissions(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return true;
  const { status: newStatus } = await Notifications.requestPermissionsAsync();
  return newStatus === "granted";
}

/**
 * Get this device's Expo push token. `getExpoPushTokenAsync` can infer `projectId`
 * from `expo.extra.eas.projectId`, but we pass it explicitly so the call does not
 * depend on manifest shape.
 */
async function getExpoPushToken(): Promise<string | null> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenData.data;
  } catch (err) {
    console.warn("[push] getExpoPushTokenAsync failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Upsert the push token to the backend.
 * Uses the user's authenticated session (RLS: auth.uid() = user_id).
 * Plain upsert on the (user_id, token) conflict target updates `platform`;
 * idempotency is already guaranteed by the conflict target.
 */
async function upsertPushToken(
  userId: string,
  token: string,
  platform: "android" | "web" | "ios",
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("push_tokens")
      .upsert({ user_id: userId, token, platform }, { onConflict: "user_id,token" });

    if (error) {
      console.error("[push] upsertPushToken failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[push] upsertPushToken threw:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Delete a push token from the backend (e.g., a device that unregistered).
 * Receipt-driven cleanup of invalid tokens happens server-side (`_shared/push.ts`).
 */
export async function unregisterPushToken(userId: string, token: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
    if (error) {
      console.error("[push] unregisterPushToken failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[push] unregisterPushToken threw:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Main entry point: register this device for push notifications.
 * Call once after the user is authenticated (from `(app)/_layout.tsx`).
 *
 * @param userId - The authenticated user's ID (auth.uid())
 * @returns PushRegistrationResult with success status and token/platform info
 */
export async function registerPushToken(userId: string): Promise<PushRegistrationResult> {
  // Beta scope: Android only (see the header). iOS and Web log and skip.
  if (Platform.OS !== "android") {
    const platform = Platform.OS === "ios" ? "ios" : "web";
    console.log(`[push] ${platform}: remote push out of scope for beta — skipping (TECH-SPECS §7.10)`);
    return { success: false, platform, error: `${platform} remote push out of scope for beta` };
  }

  if (!(await requestPermissions())) {
    return { success: false, platform: "android", error: "Notification permission denied" };
  }

  // Android 8+ requires the channel to exist before the token is fetched, otherwise
  // the OS silently drops or silences the banner (the server sends channelId "default").
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Davos messages",
    importance: Notifications.AndroidImportance.HIGH,
  });

  const token = await getExpoPushToken();
  if (!token) {
    return {
      success: false,
      platform: "android",
      error:
        "Failed to get Expo push token — Android dev builds need FCM credentials (google-services.json + FCM v1 key); see TECH-SPECS §7.10",
    };
  }

  if (!(await upsertPushToken(userId, token, "android"))) {
    return { success: false, token, platform: "android", error: "Failed to upsert token to backend" };
  }

  console.log(`[push] registered android token for user ${userId}: ${token.slice(0, 20)}...`);
  return { success: true, token, platform: "android" };
}

/**
 * Configure notification behavior for foreground suppression.
 * Call once at app startup. When the chat screen is focused the handler suppresses the
 * banner/sound/badge — the message arrives via Realtime instead (TECH-SPECS §7.10).
 * ChatScreen owns the focus signal (see `chat.tsx`).
 */
export function configureNotificationHandler(isChatFocused: () => boolean): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // A check-in is a scheduled LOCAL notification whose entire job is to be seen. The
      // chat-focus suppression below is about the chat *push* (§7.10) and must never
      // swallow it: `ExpoPresentationDelegate` drops a notification outright when every
      // presentation flag is false, so a suppressed check-in is invisible everywhere —
      // no banner, no shade entry, even no sound. That is the 2026-10-17 drill defect.
      if (isCheckinNotification(notification)) {
        return {
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      }
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

/**
 * Add a listener for notification responses (tap on notification).
 * The deep link (`davos://chat`) is carried in the payload's `data.url`; a future
 * wiring step routes it through Expo Router. Exposed here for that call site.
 */
export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
