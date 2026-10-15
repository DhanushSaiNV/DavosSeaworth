// lib/devOverrides.test.ts
// Unit tests for the pure dev-forcer helpers (parse / payload / active check).
//
// `@react-native-async-storage/async-storage` is mocked for the same reason the app
// tests mock it: the store is device-only, and these tests exercise the pure logic.
//
// Refs: FP-02 FR-7, FR-10; TECH-SPECS §5.3; AGENTS.md §2.

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import {
  devForcePayload,
  isDevOverridesActive,
  parseDevOverrides,
  type DevOverrides,
} from "./devOverrides";

describe("parseDevOverrides", () => {
  it("keeps a known tier and trims the domain", () => {
    expect(parseDevOverrides({ tier: "medium", domain: "  Career  " })).toEqual({
      tier: "medium",
      domain: "Career",
    });
  });

  it("degrades anything unexpected to no override", () => {
    const none: DevOverrides = { tier: "none", domain: "" };
    expect(parseDevOverrides(null)).toEqual(none);
    expect(parseDevOverrides("medium")).toEqual(none);
    expect(parseDevOverrides({ tier: "extreme", domain: 7 })).toEqual(none);
    expect(parseDevOverrides({})).toEqual(none);
  });
});

describe("devForcePayload", () => {
  it("is null when the forcer is off or nothing is pinned", () => {
    expect(devForcePayload({ tier: "high", domain: "Career" }, false)).toBeNull();
    expect(devForcePayload({ tier: "none", domain: "" }, true)).toBeNull();
  });

  it("omits an unset tier or domain rather than sending a placeholder", () => {
    expect(devForcePayload({ tier: "medium", domain: "" }, true)).toEqual({ tier: "medium" });
    expect(devForcePayload({ tier: "none", domain: "Career" }, true)).toEqual({
      domain: "Career",
    });
    expect(devForcePayload({ tier: "fallback", domain: "Career" }, true)).toEqual({
      tier: "fallback",
      domain: "Career",
    });
  });
});

describe("isDevOverridesActive", () => {
  it("is true only when something is pinned", () => {
    expect(isDevOverridesActive({ tier: "none", domain: "" })).toBe(false);
    expect(isDevOverridesActive({ tier: "low", domain: "" })).toBe(true);
    expect(isDevOverridesActive({ tier: "none", domain: "Fitness" })).toBe(true);
  });
});
