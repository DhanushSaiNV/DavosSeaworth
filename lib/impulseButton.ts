// lib/impulseButton.ts
// FP-08 Step 8 — the in-app impulse button's pure state machine (FR-20).
//
// Kept free of React Native imports so jest can pin every transition. `chat.tsx` renders the
// label and calls `logImpulse`; this module only says what the button is doing.
//
// Refs: FP-08 FR-20; TECH-SPEC §7.8; D22.

export type ImpulseState = "idle" | "logging" | "logged" | "error";

export type ImpulseResult = { ok: true } | { ok: false };

/** A successful log is terminal until the caller resets; a failure is retryable. */
export function nextImpulseState(current: ImpulseState, result: ImpulseResult): ImpulseState {
  if (current !== "logging") return current;
  return result.ok ? "logged" : "error";
}

export function impulseButtonLabel(state: ImpulseState): string {
  switch (state) {
    case "logging":
      return "Logging…";
    case "logged":
      return "Logged";
    case "error":
      return "Retry log";
    default:
      return "Impulse lost";
  }
}

export function impulseButtonDisabled(state: ImpulseState): boolean {
  return state === "logging" || state === "logged";
}

/** The one-line acknowledgement beside the composer; empty for idle/logging. */
export function impulseAckText(state: ImpulseState): string {
  if (state === "logged") return "On the record. Now break the pattern.";
  if (state === "error") return "Could not log it. Tap again.";
  return "";
}
