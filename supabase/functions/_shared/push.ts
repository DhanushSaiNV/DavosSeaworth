// supabase/functions/_shared/push.ts
// FP-02 Step 7 — Server-side Expo push sender (TECH-SPECS §7.10, §8; D23).
//
// Raw fetch to exp.host (Deno-compatible, no SDK). Collapse key: chat_{userId}.
// Deletes tokens on InvalidCredentials/DeviceNotRegistered receipts.
// Called from send-message and select-persona Edge Functions.
//
// Refs: FP-02 FR-15; AGENTS.md §3.1, §4.1.
// Config: expo_push_enabled (bool), EXPO_VAPID_PRIVATE_KEY (secret for web tokens).

import { getConfigBoolean, supabaseService } from "../_shared/config.ts";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: "default" | "high";
  collapseKey?: string; // defaults to chat_{userId}
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: "default" | "high";
  channelId?: string;
  collapseKey?: string;
}

interface ExpoPushResponse {
  data: Array<{ status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } }>;
}

interface ExpoReceiptResponse {
  data: Record<string, { status: "ok" | "error"; message?: string; details?: { error?: string } }>;
}

/**
 * Send a push notification to all of a user's registered tokens.
 * Best-effort: logs failures but never throws (push is not critical-path).
 */
export async function sendPush(payload: PushPayload): Promise<void> {
  // Master toggle
  const enabled = await getConfigBoolean("expo_push_enabled").catch(() => {
    console.error("[push] expo_push_enabled config missing/malformed, disabling push");
    return false;
  });
  if (!enabled) {
    console.log("[push] expo_push_enabled=false, skipping");
    return;
  }

  // Fetch user's tokens
  const { data: tokens, error } = await supabaseService
    .from("push_tokens")
    .select("token, platform")
    .eq("user_id", payload.userId);

  if (error) {
    console.error("[push] Failed to fetch tokens:", error.message);
    return;
  }

  if (!tokens || tokens.length === 0) {
    console.log("[push] No tokens for user", payload.userId);
    return;
  }

  const collapseKey = payload.collapseKey ?? `chat_${payload.userId}`;
  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    priority: payload.priority ?? "default",
    channelId: "default",
    collapseKey,
  }));

  // Send in chunks (Expo recommends max 100 per request)
  const CHUNK_SIZE = 100;
  // Map ticketId -> token so we can delete only the errored token(s)
  const ticketToToken = new Map<string, string>();

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const resp = await fetch(EXPO_PUSH_SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error("[push] Send failed:", resp.status, text);
        continue;
      }

      const json = (await resp.json()) as ExpoPushResponse;
      json.data.forEach((item, idx) => {
        if (item.status === "ok" && item.id) {
          ticketToToken.set(item.id, chunk[idx].to);
        } else {
          console.warn("[push] Ticket error:", item.message, item.details);
        }
      });
    } catch (err) {
      console.error("[push] Send threw:", err instanceof Error ? err.message : err);
    }
  }

  // Fire-and-forget receipt check to clean up invalid tokens
  if (ticketToToken.size > 0) {
    checkReceiptsAndCleanup(ticketToToken).catch((err) =>
      console.error("[push] Receipt check threw:", err instanceof Error ? err.message : err)
    );
  }
}

/**
 * Check receipts for sent tickets and delete only the invalid token(s).
 * Runs asynchronously (non-blocking).
 */
async function checkReceiptsAndCleanup(ticketToToken: Map<string, string>): Promise<void> {
  if (ticketToToken.size === 0) return;

  try {
    const resp = await fetch(EXPO_PUSH_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: Array.from(ticketToToken.keys()) }),
    });

    if (!resp.ok) {
      console.warn("[push] Receipts fetch failed:", resp.status);
      return;
    }

    const json = (await resp.json()) as ExpoReceiptResponse;

    for (const [ticketId, receipt] of Object.entries(json.data)) {
      if (receipt.status === "error") {
        const err = receipt.details?.error;
        // Delete token on these specific errors (token is invalid/expired)
        if (err === "InvalidCredentials" || err === "DeviceNotRegistered") {
          const token = ticketToToken.get(ticketId);
          if (token) await deleteInvalidToken(token);
        }
      }
    }
  } catch (err) {
    console.warn("[push] Receipt check error:", err instanceof Error ? err.message : err);
  }
}

/**
 * Delete a token that Expo reported as invalid.
 * Idempotent — safe to call multiple times.
 */
async function deleteInvalidToken(token: string): Promise<void> {
  try {
    const { error } = await supabaseService.from("push_tokens").delete().eq("token", token);
    if (error) {
      console.warn("[push] Failed to delete invalid token:", error.message);
    } else {
      console.log("[push] Deleted invalid token:", token.slice(0, 20) + "...");
    }
  } catch (err) {
    console.warn("[push] Delete token threw:", err instanceof Error ? err.message : err);
  }
}

/**
 * Helper: create a standard push payload for an AI message.
 * Used by send-message and select-persona.
 */
export function createAiMessagePushPayload(
  userId: string,
  content: string,
  deepLink = "davos://chat"
): PushPayload {
  // Truncate body to ~100 chars for notification preview
  const body = content.length > 100 ? content.slice(0, 97) + "..." : content;
  return {
    userId,
    title: "Davos",
    body,
    data: { deepLink },
    priority: "default",
    collapseKey: `chat_${userId}`,
  };
}

/**
 * Helper: create a high-priority push payload (interventions, Strikes, etc.).
 * Priority "high" bypasses some OS battery optimizations.
 */
export function createHighPriorityPushPayload(
  userId: string,
  title: string,
  body: string,
  deepLink: string
): PushPayload {
  return {
    userId,
    title,
    body,
    data: { deepLink },
    priority: "high",
    collapseKey: `chat_${userId}`,
  };
}