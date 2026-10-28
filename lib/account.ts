// lib/account.ts
// Decision 27 (2026-10-28) / TECH-SPEC §7.13 — the client half of the account lifecycle.
//
// The Edge Function derives the user from the JWT; this module never sends an id (AGENTS.md
// §4.1). Its job is: call the endpoint, then clear everything device-local that the server
// purge cannot reach — notification schedules, the check-in grid cache, the offline send
// queue, and the check-in queue/last-answer stamp.
//
// Reset keeps the session on purpose: the auth user still exists, so there is nothing to
// re-authenticate. The caller navigates to the interview explicitly. It must **not** call
// `refreshSession()` — the root auth listener would treat the session event as a fresh
// sign-in and route to `/(app)/chat`, past the stage gate.
//
// Delete signs out with `scope: "local"`: the server user is already gone, so a global
// sign-out would call the auth server with a dead token. Clearing the local session is enough
// for `app/_layout.tsx`'s listener to route to `/sign-in`.

import { supabase } from "./supabase";
import { logger } from "./logger";
import { traceNetworkCall } from "./observability";
import { clearSendQueue } from "./sendQueue";
import { clearCheckinState } from "./checkinQueue";
import { cancelCheckins, clearLoadedGrid } from "./checkins";
import { disarmImpulseNotification } from "./impulse";
import type { AccountMode } from "../supabase/functions/_shared/account/lifecycleContract";

export type AccountCounts = Record<string, number>;

export type AccountOutcome =
  | { ok: true; mode: AccountMode; counts: AccountCounts; authDeleted?: boolean }
  | { ok: false; mode: AccountMode; status?: number };

/** The HTTP status a `FunctionsHttpError` carries, when it has one. */
function httpStatusOf(error: unknown): number | undefined {
  const context = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof context?.status === "number" ? context.status : undefined;
}

async function invokeLifecycle(mode: AccountMode): Promise<AccountOutcome> {
  const confirm = mode === "reset" ? "RESET" : "DELETE";

  try {
    const { data, error } = await traceNetworkCall("app", `account.${mode}`, () =>
      supabase.functions.invoke("delete-account", { body: { mode, confirm } })
    );

    if (error) {
      const status = httpStatusOf(error);
      logger.warn("app", `account ${mode} refused`, { status });
      return { ok: false, mode, status };
    }

    const payload = data as { counts?: AccountCounts; auth_deleted?: boolean } | null;
    return {
      ok: true,
      mode,
      counts: payload?.counts ?? {},
      authDeleted: payload?.auth_deleted,
    };
  } catch (err) {
    // Network failure or a non-JSON body: no status, and the caller sees the generic copy.
    logger.error("app", `account ${mode} network failure`, { mode }, err);
    return { ok: false, mode };
  }
}

/** Run one cleanup step; a device-local failure must never block the server-side result. */
async function attempt(label: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.warn("app", `account cleanup failed: ${label}`, undefined, err);
  }
}

/**
 * Drop device-local state tied to `userId`. Safe to call twice; every step tolerates a
 * missing key or an already-disarmed notification.
 */
export async function clearLocalAccountState(userId: string): Promise<void> {
  await attempt("impulse", () => disarmImpulseNotification());
  await attempt("checkins", () => cancelCheckins());
  await attempt("grid", () => {
    clearLoadedGrid();
  });
  await attempt("checkin-queue", () => clearCheckinState(userId));
  await attempt("send-queue", () => clearSendQueue(userId));
}

/**
 * Wipe the caller's rows server-side and recreate the profile (the 0033 trigger writes the
 * opening message). The session and auth user are untouched, so the caller can route straight
 * to `/(onboarding)/interview`.
 */
export async function resetAccountData(userId: string): Promise<AccountOutcome> {
  const outcome = await invokeLifecycle("reset");
  if (!outcome.ok) return outcome;

  await clearLocalAccountState(userId);
  logger.info("app", "account reset complete", { counts: outcome.counts });
  return outcome;
}

/**
 * Purge the caller's rows, delete the auth user, clear device state, and sign out locally.
 * The operation is idempotent server-side: retrying after a partial failure converges.
 */
export async function deleteAccount(userId: string): Promise<AccountOutcome> {
  const outcome = await invokeLifecycle("delete");
  if (!outcome.ok) return outcome;

  await clearLocalAccountState(userId);
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    logger.warn("auth", "local sign-out after account deletion failed", undefined, error);
  }
  logger.info("app", "account deleted");
  return outcome;
}
