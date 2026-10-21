// supabase/functions/_shared/accountability/quests.test.ts
// FP-08 AC-7 (unit half) — the deadline clamp, the verdict table, and the mirrored fraction.
// Refs: FP-08 FR-15, FR-16, FR-17; TECH-SPEC §7.3, §7.9; D10, D15.
//
// Type-checked by `deno check` and run by jest.

import {
  clampDeadlineDays,
  elapsedDays,
  progressFraction,
  questVerdict,
} from "./quests.ts";

interface Expectation {
  toBe(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BOUNDS = { min_days: 3, max_days: 21 };

describe("clampDeadlineDays (FR-15, quest_deadline_bounds)", () => {
  it("keeps an in-bounds value", () => {
    expect(clampDeadlineDays(7, BOUNDS)).toBe(7);
  });

  it("clamps both ends", () => {
    expect(clampDeadlineDays(1, BOUNDS)).toBe(3);
    expect(clampDeadlineDays(60, BOUNDS)).toBe(21);
  });

  it("rounds and falls back to the minimum on non-finite input", () => {
    expect(clampDeadlineDays(4.6, BOUNDS)).toBe(5);
    expect(clampDeadlineDays(Number.NaN, BOUNDS)).toBe(3);
  });

  it("degrades malformed bounds toward the shortest quest", () => {
    expect(clampDeadlineDays(10, { min_days: 12, max_days: 4 })).toBe(12);
  });
});

describe("elapsedDays — inclusive window", () => {
  it("a same-day deadline is one day", () => {
    expect(elapsedDays("2026-10-21", "2026-10-21")).toBe(1);
  });

  it("a seven-day deadline window is eight calendar days", () => {
    expect(elapsedDays("2026-10-21", "2026-10-28")).toBe(8);
  });

  it("a reversed window is zero", () => {
    expect(elapsedDays("2026-10-28", "2026-10-21")).toBe(0);
  });
});

describe("questVerdict (FR-16)", () => {
  const created = "2026-10-21";
  const deadline = "2026-10-28"; // eight elapsed days

  it("zero points → expired", () => {
    expect(questVerdict([], created, deadline, 0.5)).toBe("expired");
    expect(questVerdict([0, 0, 0], created, deadline, 0.5)).toBe("expired");
  });

  it("enough passing days → completed", () => {
    // 4 passing days ≥ 0.5 × 8
    expect(questVerdict([3, 1, 0, 2, 0, 5, 0, 0], created, deadline, 0.5)).toBe("completed");
  });

  it("the boundary exactly meets the fraction", () => {
    expect(questVerdict([1, 1, 1, 1, 0, 0, 0, 0], created, deadline, 0.5)).toBe("completed");
  });

  it("one passing day → failed (a day-pass is not a completion)", () => {
    expect(questVerdict([1, 0, 0, 0, 0, 0, 0, 0], created, deadline, 0.5)).toBe("failed");
  });

  it("dead days count against: a spread of sub-1 values never passes", () => {
    expect(questVerdict([0.4, 0.5, 0.9, 0.2, 0.1, 0.3, 0.2, 0.1], created, deadline, 0.5))
      .toBe("expired");
  });
});

describe("progressFraction — the FP-07 client rule, mirrored", () => {
  const created = "2026-10-21T00:00:00Z";
  const deadline = "2026-10-28";

  it("null inputs are zero", () => {
    expect(progressFraction(null, deadline, "2026-10-24T00:00:00Z")).toBe(0);
    expect(progressFraction(created, null, "2026-10-24T00:00:00Z")).toBe(0);
  });

  it("a past deadline is 1", () => {
    expect(progressFraction(created, deadline, "2026-11-01T00:00:00Z")).toBe(1);
  });

  it("before creation is 0", () => {
    expect(progressFraction(created, deadline, "2026-10-20T00:00:00Z")).toBe(0);
  });

  it("a midpoint is strictly between 0 and 1", () => {
    const value = progressFraction(created, deadline, "2026-10-24T12:00:00Z");
    expect(value > 0.4 && value < 0.6).toBe(true);
  });
});
