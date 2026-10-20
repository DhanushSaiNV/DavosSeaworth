// lib/memoryFlag.ts
// FP-06 Step 6 — the chat flag affordance's pure half: the state machine, the affordance
// truth, the request body and the failure copy (TECH-SPEC §7.6, §9; FP-06 FR-14).
// Pure (jest-loadable): the POST and the row re-read live in app/(app)/chat.tsx (the
// `submitState` / `lib/chat.ts` split).
//
// Two truths are deliberately separate:
//   * the *marker* derives from the row's own `unsavable` column — never from local state,
//     so a reload and a Realtime re-delivery render the same bubble;
//   * the *phase* only drives the transient affordance (menu item disabled in flight,
//     inline error + Retry after a retryable failure).

export type FlagPhase = "idle" | "in-flight" | "flagged" | "failed";

export interface FlagState {
  phase: FlagPhase;
  /** The server message row the phase is about; null at idle. */
  messageId: string | null;
  /** After `failed`: whether Retry is offered (transport/5xx/429 yes; a 4xx no). */
  retryable: boolean;
  /** After `failed`: the short inline copy. */
  error?: string;
}

export const IDLE_FLAG: FlagState = { phase: "idle", messageId: null, retryable: true };

/** The fields the affordance needs from a bubble. */
export interface FlagTarget {
  role: "user" | "assistant";
  /** The committed server row's id; absent on optimistic bubbles. */
  messageId?: string;
  /** The row's own column — the only marker truth. */
  unsavable?: boolean;
}

/**
 * Own committed user bubbles only, and never one already flagged: the flag is one-way
 * (TECH-SPEC §7.6 — there is no unflag affordance).
 */
export function canMarkUnsavable(target: FlagTarget): boolean {
  return (
    target.role === "user" &&
    typeof target.messageId === "string" &&
    target.messageId.length > 0 &&
    target.unsavable !== true
  );
}

/** The persistent marker truth: the row column, nothing else. */
export function showsUnsavableMarker(target: Pick<FlagTarget, "unsavable">): boolean {
  return target.unsavable === true;
}

/** The request body: an id and nothing else (§5.3 body rule; the Step 2 surface). */
export function flagPayload(messageId: string): { message_id: string } {
  return { message_id: messageId };
}

/** Single-flight: beginning while one is already in flight is a no-op. */
export function beginFlag(state: FlagState, messageId: string): FlagState {
  if (state.phase === "in-flight") return state;
  return { phase: "in-flight", messageId, retryable: true };
}

/** ok → flagged. A response for a different message never rewrites the phase. */
export function flagSucceeded(state: FlagState, messageId: string): FlagState {
  if (state.messageId !== messageId) return state;
  return { phase: "flagged", messageId, retryable: true };
}

/** Retry is offered for an unknown outcome, a 5xx and a 429; a 4xx is terminal. */
export function isRetryableFlagFailure(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status >= 500) return true;
  return status === 429;
}

/** The inline copy for a failed flag attempt (short; never echoes server text). */
export function flagFailureCopy(status: number | undefined): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 404) return "This message is no longer available.";
  if (status !== undefined && status >= 400 && status < 500) {
    return "This message cannot be marked unsavable.";
  }
  return "Could not mark this message. Try again.";
}

/** failed → failed (retryable per the status). A response for another message is ignored. */
export function flagFailed(
  state: FlagState,
  messageId: string,
  status: number | undefined,
): FlagState {
  if (state.messageId !== messageId) return state;
  return {
    phase: "failed",
    messageId,
    retryable: isRetryableFlagFailure(status),
    error: flagFailureCopy(status),
  };
}

/** The menu item is disabled while *this* bubble's flag is in flight. */
export function isFlagBusy(state: FlagState, messageId: string): boolean {
  return state.phase === "in-flight" && state.messageId === messageId;
}

/** The id a Retry re-runs, or null when the failure is terminal (or there is none). */
export function retryTarget(state: FlagState): string | null {
  return state.phase === "failed" && state.retryable ? state.messageId : null;
}

/** The inline error to render on a bubble, or null when this bubble has none. */
export function flagErrorFor(
  state: FlagState,
  messageId: string | undefined,
): { message: string; retryable: boolean } | null {
  if (!messageId) return null;
  if (state.phase !== "failed" || state.messageId !== messageId) return null;
  return { message: state.error ?? flagFailureCopy(undefined), retryable: state.retryable };
}
