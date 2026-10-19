// lib/journal/submitState.ts
// FP-05 Step 7 — pure state machine + payload builder for journal submit (TECH-SPEC §7.4, §9, §10.2).
// Refs: FP-05 FR-18; D3.
// Pure (jest-loadable): no React, no Supabase, no AsyncStorage.

import { stripSummary } from "./strip";

/** The submit state machine. */
export type SubmitState =
  | { status: "idle" }
  | { status: "in-flight" }
  | { status: "confirmed"; sent: number; total: number }
  | { status: "failed"; error: string };

/** Actions for the reducer. */
export type SubmitAction =
  | { type: "SUBMIT" }
  | { type: "OK"; sent: number; total: number }
  | { type: "FAIL"; error: string }
  | { type: "RETRY" }
  | { type: "DISMISS_CONFIRMATION" };

/** The payload sent to submit-journal. */
export interface SubmitPayload {
  content: string;     // stripped text (verbatim from stripUnsavable)
  entry_date: string;  // YYYY-MM-DD (today in user's local timezone)
}

/**
 * Build the submit payload from raw text and flagged set.
 * Runs the client-side Unsavable strip (D3) — the server receives verbatim stripped content.
 */
export function buildSubmitPayload(raw: string, flaggedTexts: Set<string>): SubmitPayload {
  const summary = stripSummary(raw, flaggedTexts);
  const today = new Date();
  const entry_date = today.toISOString().split("T")[0]; // YYYY-MM-DD in local timezone
  return {
    content: summary.stripped,
    entry_date,
  };
}

/** Pure reducer for the submit state machine. */
export function submitStateReducer(state: SubmitState, action: SubmitAction): SubmitState {
  switch (action.type) {
    case "SUBMIT":
      if (state.status === "idle") {
        return { status: "in-flight" };
      }
      return state;

    case "OK":
      if (state.status === "in-flight") {
        return { status: "confirmed", sent: action.sent, total: action.total };
      }
      return state;

    case "FAIL":
      if (state.status === "in-flight" || state.status === "failed") {
        return { status: "failed", error: action.error };
      }
      return state;

    case "RETRY":
      if (state.status === "failed") {
        return { status: "in-flight" };
      }
      return state;

    case "DISMISS_CONFIRMATION":
      if (state.status === "confirmed") {
        return { status: "idle" };
      }
      return state;

    default:
      return state;
  }
}

/** Whether the submit button should be disabled. */
export function isSubmitDisabled(state: SubmitState, raw: string, flaggedTexts: Set<string>): boolean {
  if (state.status === "in-flight") return true;
  const summary = stripSummary(raw, flaggedTexts);
  if (summary.total === 0) return true;
  if (summary.sent === 0) return true; // all flagged
  return false;
}