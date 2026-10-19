// lib/journal/submitState.test.ts
// FP-05 Step 7 — unit tests for the journal submit state machine + payload builder.
// Refs: FP-05 FR-18; TECH-SPEC §7.4, §9, §10.2; D3.

import { buildSubmitPayload, submitStateReducer, isSubmitDisabled, type SubmitState } from "./submitState";
import { stripSummary } from "./strip";

describe("buildSubmitPayload", () => {
  it("strips flagged blocks and returns stripped content + today date", () => {
    const raw = "Block 1\n\nFlagged block\n\nBlock 3";
    const flagged = new Set(["Flagged block"]);
    const payload = buildSubmitPayload(raw, flagged);
    expect(payload.content).toBe("Block 1\n\nBlock 3");
    expect(payload.entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("empty flagged set returns raw content", () => {
    const raw = "Just one block";
    const payload = buildSubmitPayload(raw, new Set());
    expect(payload.content).toBe(raw);
  });

  it("all flagged returns empty content", () => {
    const raw = "Only flagged";
    const flagged = new Set(["Only flagged"]);
    const payload = buildSubmitPayload(raw, flagged);
    expect(payload.content).toBe("");
  });

  it("entry_date is today in YYYY-MM-DD format", () => {
    const payload = buildSubmitPayload("x", new Set());
    expect(payload.entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("submitStateReducer (state machine)", () => {
  const idle: SubmitState = { status: "idle" };
  const inFlight: SubmitState = { status: "in-flight" };
  const confirmed: SubmitState = { status: "confirmed", sent: 2, total: 3 };
  const failed: SubmitState = { status: "failed", error: "Network error" };

  it("idle + SUBMIT -> in-flight", () => {
    expect(submitStateReducer(idle, { type: "SUBMIT" })).toEqual({ status: "in-flight" });
  });

  it("in-flight + SUBMIT -> stays in-flight (idempotent)", () => {
    expect(submitStateReducer(inFlight, { type: "SUBMIT" })).toEqual({ status: "in-flight" });
  });

  it("in-flight + OK -> confirmed with counts", () => {
    expect(submitStateReducer(inFlight, { type: "OK", sent: 3, total: 4 })).toEqual({
      status: "confirmed",
      sent: 3,
      total: 4,
    });
  });

  it("confirmed + OK -> stays confirmed (idempotent)", () => {
    expect(submitStateReducer(confirmed, { type: "OK", sent: 5, total: 5 })).toEqual(confirmed);
  });

  it("in-flight + FAIL -> failed with error", () => {
    expect(submitStateReducer(inFlight, { type: "FAIL", error: "Timeout" })).toEqual({
      status: "failed",
      error: "Timeout",
    });
  });

  it("failed + FAIL -> stays failed with new error", () => {
    expect(submitStateReducer(failed, { type: "FAIL", error: "Another error" })).toEqual({
      status: "failed",
      error: "Another error",
    });
  });

  it("failed + RETRY -> in-flight", () => {
    expect(submitStateReducer(failed, { type: "RETRY" })).toEqual({ status: "in-flight" });
  });

  it("idle + RETRY -> stays idle (invalid transition)", () => {
    expect(submitStateReducer(idle, { type: "RETRY" })).toEqual(idle);
  });

  it("confirmed + DISMISS_CONFIRMATION -> idle", () => {
    expect(submitStateReducer(confirmed, { type: "DISMISS_CONFIRMATION" })).toEqual({ status: "idle" });
  });

  it("idle + DISMISS_CONFIRMATION -> stays idle", () => {
    expect(submitStateReducer(idle, { type: "DISMISS_CONFIRMATION" })).toEqual(idle);
  });
});

describe("isSubmitDisabled (button enable logic)", () => {
  const idle: SubmitState = { status: "idle" };
  const inFlight: SubmitState = { status: "in-flight" };
  const confirmed: SubmitState = { status: "confirmed", sent: 1, total: 1 };
  const failed: SubmitState = { status: "failed", error: "err" };

  it("in-flight always disabled", () => {
    expect(isSubmitDisabled(inFlight, "x", new Set())).toBe(true);
  });

  it("empty raw disabled", () => {
    expect(isSubmitDisabled(idle, "", new Set())).toBe(true);
  });

  it("whitespace-only disabled", () => {
    expect(isSubmitDisabled(idle, "   \n  ", new Set())).toBe(true);
  });

  it("all blocks flagged (sent=0) disabled", () => {
    const raw = "Flagged only";
    const flagged = new Set(["Flagged only"]);
    expect(stripSummary(raw, flagged).sent).toBe(0);
    expect(isSubmitDisabled(idle, raw, flagged)).toBe(true);
  });

  it("some blocks sent -> enabled", () => {
    const raw = "Good\n\nBad";
    const flagged = new Set(["Bad"]);
    expect(stripSummary(raw, flagged).sent).toBe(1);
    expect(isSubmitDisabled(idle, raw, flagged)).toBe(false);
  });

  it("no blocks (total=0) disabled", () => {
    expect(isSubmitDisabled(idle, "", new Set())).toBe(true);
  });
});

describe("Payload equivalence: buildSubmitPayload === stripSummary.stripped + today", () => {
  it("payload content matches stripSummary.stripped exactly", () => {
    const raw = "Line 1\n\nLine 2\n\nLine 3";
    const flagged = new Set(["Line 2"]);
    const payload = buildSubmitPayload(raw, flagged);
    const summary = stripSummary(raw, flagged);
    expect(payload.content).toBe(summary.stripped);
  });

  it("entry_date is today local date", () => {
    const payload = buildSubmitPayload("x", new Set());
    const today = new Date().toISOString().split("T")[0];
    expect(payload.entry_date).toBe(today);
  });

  it("fixture equivalence: preview test extended to wire shape", () => {
    const FIXTURE = "Morning pages: slept badly.\n\nPrivate: do NOT send this.\n\nPlan: gym at six.";
    const FLAGGED = new Set(["Private: do NOT send this."]);
    const payload = buildSubmitPayload(FIXTURE, FLAGGED);
    const summary = stripSummary(FIXTURE, FLAGGED);
    expect(payload.content).toBe(summary.stripped);
    expect(payload.content).toBe("Morning pages: slept badly.\n\nPlan: gym at six.");
  });
});