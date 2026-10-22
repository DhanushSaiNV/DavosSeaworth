// lib/impulseButton.test.ts
// FP-08 Step 8 — the pure impulse-button transitions (FR-20).

import {
  impulseAckText,
  impulseButtonDisabled,
  impulseButtonLabel,
  nextImpulseState,
} from "./impulseButton";

describe("nextImpulseState", () => {
  it("moves logging to logged on success", () => {
    expect(nextImpulseState("logging", { ok: true })).toBe("logged");
  });

  it("moves logging to error on failure", () => {
    expect(nextImpulseState("logging", { ok: false })).toBe("error");
  });

  it("retries from error", () => {
    expect(nextImpulseState("error", { ok: true })).toBe("error");
  });

  it("ignores a result outside logging (a stray double-tap)", () => {
    expect(nextImpulseState("idle", { ok: true })).toBe("idle");
    expect(nextImpulseState("logged", { ok: false })).toBe("logged");
  });
});

describe("the rendered surface", () => {
  it("labels every state", () => {
    expect(impulseButtonLabel("idle")).toBe("Impulse lost");
    expect(impulseButtonLabel("logging")).toBe("Logging…");
    expect(impulseButtonLabel("logged")).toBe("Logged");
    expect(impulseButtonLabel("error")).toBe("Retry log");
  });

  it("disables only while logging or once logged", () => {
    expect(impulseButtonDisabled("idle")).toBe(false);
    expect(impulseButtonDisabled("error")).toBe(false);
    expect(impulseButtonDisabled("logging")).toBe(true);
    expect(impulseButtonDisabled("logged")).toBe(true);
  });

  it("acknowledges success and failure, and says nothing otherwise", () => {
    expect(impulseAckText("logged")).toContain("On the record");
    expect(impulseAckText("error")).toContain("Tap again");
    expect(impulseAckText("idle")).toBe("");
    expect(impulseAckText("logging")).toBe("");
  });
});
