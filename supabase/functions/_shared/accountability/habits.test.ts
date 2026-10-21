// supabase/functions/_shared/accountability/habits.test.ts
// FP-08 AC-6 (unit half) — the habit lifecycle and the deterministic description.
// Refs: FP-08 FR-13, FR-18; TECH-SPEC §7.5; D22, D24.
//
// Type-checked by `deno check` and run by jest.

import {
  buildDescription,
  isLive,
  nextStatus,
  shouldSurface,
  type HabitStatus,
} from "./habits.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("shouldSurface (FR-13)", () => {
  const thresholds = { impulse_failures_per_week: 3, journal_flags_per_week: 3 };

  it("impulse threshold met → impulse pattern", () => {
    expect(shouldSurface({ impulse_failures: 3, journal_flags: 0 }, thresholds)).toEqual({
      surface: true,
      pattern: "impulse",
    });
  });

  it("journal threshold met → journal pattern", () => {
    expect(shouldSurface({ impulse_failures: 0, journal_flags: 3 }, thresholds)).toEqual({
      surface: true,
      pattern: "journal",
    });
  });

  it("both met → impulse wins (the recorded routing)", () => {
    expect(shouldSurface({ impulse_failures: 5, journal_flags: 4 }, thresholds).pattern).toBe("impulse");
  });

  it("below both → nothing", () => {
    expect(shouldSurface({ impulse_failures: 2, journal_flags: 2 }, thresholds)).toEqual({
      surface: false,
      pattern: null,
    });
  });
});

describe("nextStatus (FR-18 lifecycle table)", () => {
  const table: Array<[HabitStatus, Parameters<typeof nextStatus>[1], HabitStatus]> = [
    ["detected", "confront", "confronted"],
    ["detected", "concession", "detected"],
    ["detected", "strike", "detected"],
    ["confronted", "confront", "confronted"],
    ["confronted", "concession", "watch"],
    ["confronted", "strike", "confronted"],
    ["watch", "strike", "struck"],
    ["watch", "concession", "watch"],
    ["confronted", "quit_commitment", "quit_committed"],
    ["watch", "quit_commitment", "quit_committed"],
    ["detected", "quit_commitment", "quit_committed"],
    ["struck", "quit_commitment", "struck"],
    ["quit_committed", "concession", "quit_committed"],
    ["cancelled", "confront", "cancelled"],
    ["struck", "strike", "struck"],
  ];

  table.forEach(([from, event, expected]) => {
    it(`${from} + ${event} → ${expected}`, () => {
      expect(nextStatus(from, event)).toBe(expected);
    });
  });
});

describe("isLive", () => {
  it("only detected/confronted/watch are live", () => {
    expect(isLive("detected")).toBe(true);
    expect(isLive("confronted")).toBe(true);
    expect(isLive("watch")).toBe(true);
    expect(isLive("struck")).toBe(false);
    expect(isLive("quit_committed")).toBe(false);
    expect(isLive("cancelled")).toBe(false);
  });
});

describe("buildDescription — deterministic, the live-guard key", () => {
  it("impulse shape is stable", () => {
    expect(buildDescription("impulse", { impulse_failures: 4, journal_flags: 0 }, 7))
      .toBe("Recurring impulse failures: 4 in the last 7 days.");
  });

  it("journal shape is stable", () => {
    expect(buildDescription("journal", { impulse_failures: 0, journal_flags: 3 }, 7))
      .toBe("Recurring behaviour flagged in journal entries: 3 in the last 7 days.");
  });
});
