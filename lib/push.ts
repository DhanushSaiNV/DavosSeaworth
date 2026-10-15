// lib/push.ts
// FP-02 Step 7 — Expo push token registration (TECH-SPECS §7.10, §8; D23).
//
// Registers the device's Expo push token with the backend (push_tokens table).
// Platforms: Android (expo push), Web (expo push + VAPID), iOS-in-Expo-Go (skip, log).
// Called once on auth completion from (app)/_layout.tsx.
//
// Refs: FP-02 FR-15; AGENTS.md §2, §3.1, §4.1.
// VAPID: public key from app.config (expo.extra.vapidPublicKey), private key in Edge Function secret.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";

/** Result of a registration attempt. */
export interface PushRegistrationResult {
  success: boolean;
  token?: string;
  platform?: "android" | "web" | "ios";
  error?: string;
}

/**
 * Get the VAPID public key from app config (expo.extra.vapidPublicKey).
 * Returns null if not configured — web push will fall back to in-app banner.
 */
function getVapidPublicKey(): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const key = extra?.vapidPublicKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Check if we're running in Expo Go on iOS — remote push is not supported there.
 * (Requires Apple Developer Program, which violates $0 budget — TECH-SPECS §13 live item.)
 * Uses `Constants.appOwnership === "expo"` which is the canonical check for Expo Go.
 */
function isIOSExpoGo(): boolean {
  return Platform.OS === "ios" && Constants.appOwnership === "expo";
}

/**
 * Request notification permissions for the current platform.
 * Returns true if granted, false otherwise.
 */
async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    return newStatus === "granted";
  }

  if (Platform.OS === "web") {
    // Web uses the standard Notification API
    if (typeof Notification !== "undefined") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }
    return false;
  }

  // iOS (native build) — would need proper APNs setup, skipped for Expo Go
  return false;
}

/**
 * Get the Expo push token for the current platform.
 * On web, includes the VAPID public key if available.
 */
async function getExpoPushToken(): Promise<string | null> {
  try {
    const vapidKey = getVapidPublicKey();

    // Type assertion needed: expo-notifications types may not include vapidKey in all versions
    const tokenData = await Notifications.getExpoPushTokenAsync(
      vapidKey ? ({ vapidKey } as Notifications.ExpoPushTokenOptions) : undefined
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
 * Plain upsert on (user_id, token) conflict target updates `platform`;
 * idempotency is already guaranteed by the conflict target.
 */
async function upsertPushToken(userId: string, token: string, platform: "android" | "web" | "ios"): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("push_tokens")
      .upsert(
        {
          user_id: userId,
          token,
          platform,
        },
        { onConflict: "user_id,token" }
      );

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
 * Delete a push token from the backend (e.g., on receipt of InvalidCredentials).
 * Called from the server-side push handler, but exposed here for completeness.
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
 * Main entry point: register the current device for push notifications.
 * Call once after the user is authenticated (e.g., in (app)/_layout.tsx).
 *
 * @param userId - The authenticated user's ID (auth.uid())
 * @returns PushRegistrationResult with success status and token/platform info
 */
export async function registerPushToken(userId: string): Promise<PushRegistrationResult> {
  // iOS in Expo Go: remote push unsupported, log and skip
  if (isIOSExpoGo()) {
    console.log("[push] iOS-in-Expo-Go: remote push unsupported (TECH-SPECS §13 live item)");
    return { success: false, platform: "ios", error: "iOS-in-Expo-Go unsupported" };
  }

  // Request permissions
  const granted = await requestPermissions();
  if (!granted) {
    return { success: false, error: "Notification permission denied" };
  }

  // Create Android notification channel (required for Android 8+)
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Davos messages",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Get Expo push token
  const token = await getExpoPushToken();
  if (!token) {
    return { success: false, error: "Failed to get Expo push token" };
  }

  // Determine platform for DB
  const platform = Platform.OS === "android" ? "android" : Platform.OS === "web" ? "web" : "ios";

  // Upsert to backend
  const ok = await upsertPushToken(userId, token, platform);
  if (!ok) {
    return { success: false, token, platform, error: "Failed to upsert token to backend" };
  }

  console.log(`[push] Registered ${platform} token for user ${userId}: ${token.slice(0, 20)}...`);
  return { success: true, token, platform };
}

/**
 * Configure notification behavior for foreground suppression.
 * Call once at app startup (e.g., in (app)/_layout.tsx or ChatScreen mount).
 * When the chat screen is focused, the handler will suppress the banner/sound/badge.
 * The suppression logic itself lives in ChatScreen (which knows when it's focused).
 */
export function configureNotificationHandler(isChatFocused: () => boolean): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      // Suppress the OS notification banner/sound/badge when chat is focused
      // The message will arrive via Realtime instead (TECH-SPECS §7.10)
      if (isChatFocused()) {
        return {
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }
      // Otherwise, show normally
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
 * The deep link (davos://chat) is handled by Expo Router automatically via app.json scheme.
 * This is here for any custom handling if needed.
 */
export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}