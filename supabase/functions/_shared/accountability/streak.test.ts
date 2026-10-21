// supabase/functions/_shared/accountability/streak.test.ts
// FP-08 AC-2 (unit half) — the streak's day rule and award.
// Refs: FP-08 FR-3; TECH-SPEC §5.4, §7.3; D4, D20.
//
// Type-checked by `deno check` and run by jest.

import {
  STREAK_MIN_DAYS,
  STREAK_TRUST_AWARD,
  awardStreak,
  isCompleteDay,
  streakDays,
  type DayCompliance,
} from "./streak.ts";

interface Expectation {
  toBe(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

function day(local_date: string, answered: number, expected: number): DayCompliance {
  return { local_date, answered, expected };
}

describe("isCompleteDay", () => {
  it("meets the threshold exactly", () => {
    expect(isCompleteDay(day("2026-10-20", 6, 10), 0.6)).toBe(true);
  });

  it("one answer short fails", () => {
    expect(isCompleteDay(day("2026-10-20", 5, 10), 0.6)).toBe(false);
  });

  it("a zero-window day is not complete", () => {
    expect(isCompleteDay(day("2026-10-20", 0, 0), 0.6)).toBe(false);
  });
});

describe("streakDays", () => {
  it("counts consecutive complete days ending at the last element", () => {
    expect(streakDays([
      day("2026-10-17", 10, 10),
      day("2026-10-18", 8, 10),
      day("2026-10-19", 6, 10),
      day("2026-10-20", 6, 10),
    ], 0.6)).toBe(4);
  });

  it("an incomplete day ends the streak", () => {
    expect(streakDays([
      day("2026-10-18", 10, 10),
      day("2026-10-19", 4, 10),
      day("2026-10-20", 9, 10),
    ], 0.6)).toBe(1);
  });

  it("a gap in the dates ends the streak even when both days are complete", () => {
    expect(streakDays([
      day("2026-10-17", 10, 10),
      day("2026-10-19", 10, 10),
      day("2026-10-20", 10, 10),
    ], 0.6)).toBe(2);
  });

  it("an empty list is zero", () => {
    expect(streakDays([], 0.6)).toBe(0);
  });

  it("yesterday failing means no streak, however long the run before it", () => {
    expect(streakDays([
      day("2026-10-17", 10, 10),
      day("2026-10-18", 10, 10),
      day("2026-10-19", 10, 10),
      day("2026-10-20", 1, 10),
    ], 0.6)).toBe(0);
  });
});

describe("awardStreak", () => {
  it("awards +2 at three days and above", () => {
    expect(STREAK_MIN_DAYS).toBe(3);
    expect(STREAK_TRUST_AWARD).toBe(2);
    expect(awardStreak(3, false)).toBe(2);
    expect(awardStreak(9, false)).toBe(2);
  });

  it("pays nothing below the threshold", () => {
    expect(awardStreak(2, false)).toBe(0);
  });

  it("pays once per local day (the scan's dedup)", () => {
    expect(awardStreak(5, true)).toBe(0);
  });
});
