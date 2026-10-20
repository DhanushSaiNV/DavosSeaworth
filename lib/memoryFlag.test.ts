// lib/memoryFlag.test.ts
// FP-06 Step 6 — the flag affordance's pure half: the state machine (single-flight,
// ok → flagged, failure → retryable or terminal), the affordance truth, and the marker's
// row-column derivation (FR-14; TECH-SPEC §7.6).

import {
  beginFlag,
  canMarkUnsavable,
  flagErrorFor,
  flagFailed,
  flagFailureCopy,
  flagPayload,
  flagSucceeded,
  IDLE_FLAG,
  isFlagBusy,
  isRetryableFlagFailure,
  retryTarget,
  showsUnsavableMarker,
  type FlagState,
} from "./memoryFlag";

const MID = "11111111-1111-1111-1111-111111111111";

describe("canMarkUnsavable (affordance truth)", () => {
  it("offers the flag on own committed user bubbles", () => {
    expect(canMarkUnsavable({ role: "user", messageId: MID, unsavable: false })).toBe(true);
    expect(canMarkUnsavable({ role: "user", messageId: MID })).toBe(true);
  });

  it("offers nothing on assistant bubbles", () => {
    expect(canMarkUnsavable({ role: "assistant", messageId: MID, unsavable: false })).toBe(false);
  });

  it("offers nothing on optimistic bubbles (no row id yet)", () => {
    expect(canMarkUnsavable({ role: "user", unsavable: false })).toBe(false);
  });

  it("offers nothing once the row is flagged (the flag is one-way)", () => {
    expect(canMarkUnsavable({ role: "user", messageId: MID, unsavable: true })).toBe(false);
  });
});

describe("showsUnsavableMarker (row column, never local state)", () => {
  it("renders only from the row's own column", () => {
    expect(showsUnsavableMarker({ unsavable: true })).toBe(true);
    expect(showsUnsavableMarker({ unsavable: false })).toBe(false);
    expect(showsUnsavableMarker({})).toBe(false);
  });

  it("a flagged phase alone is not the marker — the row must carry it", () => {
    const state = flagSucceeded(beginFlag(IDLE_FLAG, MID), MID);
    expect(state.phase).toBe("flagged");
    expect(showsUnsavableMarker({ unsavable: false })).toBe(false);
  });
});

describe("flagPayload", () => {
  it("is an id and nothing else", () => {
    expect(flagPayload(MID)).toEqual({ message_id: MID });
    expect(Object.keys(flagPayload(MID))).toEqual(["message_id"]);
  });
});

describe("the state machine", () => {
  it("idle -> in-flight -> flagged", () => {
    const started = beginFlag(IDLE_FLAG, MID);
    expect(started).toEqual({ phase: "in-flight", messageId: MID, retryable: true });
    expect(flagSucceeded(started, MID)).toEqual({
      phase: "flagged",
      messageId: MID,
      retryable: true,
    });
  });

  it("is single-flight: a second begin while in flight is a no-op", () => {
    const started = beginFlag(IDLE_FLAG, MID);
    const again = beginFlag(started, "22222222-2222-2222-2222-222222222222");
    expect(again).toBe(started);
  });

  it("ignores a response for a different message", () => {
    const started = beginFlag(IDLE_FLAG, MID);
    expect(flagSucceeded(started, "other")).toBe(started);
    expect(flagFailed(started, "other", 500)).toBe(started);
  });

  it("failure is retryable for transport/5xx/429 and terminal for 4xx", () => {
    const started = beginFlag(IDLE_FLAG, MID);
    for (const status of [undefined, 500, 503, 429]) {
      const failed = flagFailed(started, MID, status);
      expect(failed.phase).toBe("failed");
      expect(failed.retryable).toBe(true);
      expect(retryTarget(failed)).toBe(MID);
    }
    for (const status of [400, 401, 403, 404]) {
      const failed = flagFailed(started, MID, status);
      expect(failed.phase).toBe("failed");
      expect(failed.retryable).toBe(false);
      expect(retryTarget(failed)).toBeNull();
    }
  });

  it("carries short inline copy per status class", () => {
    expect(flagFailureCopy(401)).toContain("session");
    expect(flagFailureCopy(404)).toContain("no longer");
    expect(flagFailureCopy(400)).toContain("cannot be marked");
    expect(flagFailureCopy(undefined)).toContain("Try again");
    expect(flagFailureCopy(503)).toContain("Try again");
  });

  it("isFlagBusy only while this bubble's attempt is in flight", () => {
    const started = beginFlag(IDLE_FLAG, MID);
    expect(isFlagBusy(started, MID)).toBe(true);
    expect(isFlagBusy(started, "other")).toBe(false);
    expect(isFlagBusy(IDLE_FLAG, MID)).toBe(false);
  });

  it("flagErrorFor renders only on the failed bubble", () => {
    const failed: FlagState = flagFailed(beginFlag(IDLE_FLAG, MID), MID, 500);
    expect(flagErrorFor(failed, MID)?.retryable).toBe(true);
    expect(flagErrorFor(failed, "other")).toBeNull();
    expect(flagErrorFor(IDLE_FLAG, MID)).toBeNull();
    expect(flagErrorFor(failed, undefined)).toBeNull();
  });

  it("retry re-runs the same path: failed → in-flight", () => {
    const failed = flagFailed(beginFlag(IDLE_FLAG, MID), MID, undefined);
    expect(retryTarget(failed)).toBe(MID);
    expect(beginFlag(failed, MID).phase).toBe("in-flight");
  });
});

describe("isRetryableFlagFailure", () => {
  it("matches the offer rule", () => {
    expect(isRetryableFlagFailure(undefined)).toBe(true);
    expect(isRetryableFlagFailure(500)).toBe(true);
    expect(isRetryableFlagFailure(429)).toBe(true);
    expect(isRetryableFlagFailure(400)).toBe(false);
    expect(isRetryableFlagFailure(404)).toBe(false);
  });
});
