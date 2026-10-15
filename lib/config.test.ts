// lib/config.test.ts
// Unit tests for the pure `config` helpers (parseConfigRows / coerceConfigNumber /
// coerceConfigBoolean).
//
// `./supabase` is mocked because it throws at import time when the EXPO_PUBLIC_* env
// vars are absent, as in a jest run (the same reason app/__tests__ mocks it).
//
// Refs: FP-02 FR-17; TECH-SPECS §11; AGENTS.md §2.

import { coerceConfigBoolean, coerceConfigNumber, parseConfigRows } from "./config";

// `./supabase` throws at import time when the EXPO_PUBLIC_* env vars are absent, as in
// a jest run (the same reason app/__tests__ mocks it). babel hoists this above the
// imports, so its position here is a lint preference only.
jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

describe("parseConfigRows", () => {
  it("builds a lookup map from rows", () => {
    expect(
      parseConfigRows([
        { key: "a", value: 1 },
        { key: "b", value: "two" },
      ]),
    ).toEqual({ a: 1, b: "two" });
  });

  it("lets the last row win on duplicate keys", () => {
    expect(
      parseConfigRows([
        { key: "a", value: 1 },
        { key: "a", value: 2 },
      ]),
    ).toEqual({ a: 2 });
  });

  it("returns an empty object for no rows", () => {
    expect(parseConfigRows([])).toEqual({});
  });
});

describe("coerceConfigNumber", () => {
  it("passes numbers through unchanged", () => {
    expect(coerceConfigNumber("k", 42)).toBe(42);
    expect(coerceConfigNumber("k", 0)).toBe(0);
    expect(coerceConfigNumber("k", -5)).toBe(-5);
  });

  it("parses numeric strings", () => {
    expect(coerceConfigNumber("k", "90000")).toBe(90000);
    expect(coerceConfigNumber("k", "3.14")).toBe(3.14);
  });

  it("throws when the key is missing or empty", () => {
    expect(() => coerceConfigNumber("k", null)).toThrow('config key "k" is missing');
    expect(() => coerceConfigNumber("k", undefined)).toThrow('config key "k" is missing');
    expect(() => coerceConfigNumber("k", "")).toThrow('config key "k" is missing');
  });

  it("throws when the value is not numeric", () => {
    expect(() => coerceConfigNumber("k", "abc")).toThrow('config key "k" is not numeric');
    expect(() => coerceConfigNumber("k", Number.NaN)).toThrow('config key "k" is not numeric');
  });
});

describe("coerceConfigBoolean", () => {
  it("passes real booleans through", () => {
    expect(coerceConfigBoolean("k", true)).toBe(true);
    expect(coerceConfigBoolean("k", false)).toBe(false);
  });

  it("fails closed on a missing or mistyped value", () => {
    // Only a JSON boolean counts: a stray "true" string must never enable a dev surface.
    expect(() => coerceConfigBoolean("k", "true")).toThrow(
      'config key "k" is missing or not a boolean',
    );
    expect(() => coerceConfigBoolean("k", 1)).toThrow(
      'config key "k" is missing or not a boolean',
    );
    expect(() => coerceConfigBoolean("k", null)).toThrow(
      'config key "k" is missing or not a boolean',
    );
    expect(() => coerceConfigBoolean("k", undefined)).toThrow(
      'config key "k" is missing or not a boolean',
    );
  });
});
