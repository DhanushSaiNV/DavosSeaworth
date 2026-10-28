// supabase/functions/_shared/proactive/gaps.test.ts
// FP-09 Step 2 — the proactive gap-vector table and companionship shape (FR-13, AC-7).
// Refs: FP-09 FR-13, AC-7; TECH-SPEC §7.7, §7.8; D22.
// Jest globals declared inline so this tree loads without importing the jest package.

import {
  companionshipContext,
  gapVector,
  type GapConfig,
  type GapProfile,
} from "./gaps.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toThrow(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const CONFIG: GapConfig = { proactive_gap_min_baseline_facts: 5 };

const FULL: GapProfile = {
  wake_time: "07:00",
  sleep_time: "23:00",
  routine: { summary: "Morning walk, focused work, evening review." },
  high_dopamine_activities: ["short video clips"],
};

describe("gapVector (FR-13)", () => {
  it("returns null when every field is present and the fact count clears the minimum", () => {
    expect(gapVector(FULL, 5, CONFIG)).toBeNull();
    expect(gapVector(FULL, 9, CONFIG)).toBeNull();
  });

  it("follows the fixed order: wake -> sleep -> routine -> activities -> facts", () => {
    expect(gapVector({}, 0, CONFIG)).toBe("wake_time");
    expect(gapVector({ wake_time: "07:00" }, 0, CONFIG)).toBe("sleep_time");
    expect(
      gapVector({ wake_time: "07:00", sleep_time: "23:00" }, 0, CONFIG),
    ).toBe("routine");
    expect(
      gapVector(
        {
          wake_time: "07:00",
          sleep_time: "23:00",
          routine: { summary: "Morning walk." },
        },
        0,
        CONFIG,
      ),
    ).toBe("high_dopamine_activities");
    expect(gapVector(FULL, 4, CONFIG)).toBe("baseline_facts");
  });

  it("treats empty/blank routines as missing", () => {
    expect(gapVector({ ...FULL, routine: null }, 9, CONFIG)).toBe("routine");
    expect(gapVector({ ...FULL, routine: {} }, 9, CONFIG)).toBe("routine");
    expect(gapVector({ ...FULL, routine: { summary: "" } }, 9, CONFIG)).toBe("routine");
    expect(gapVector({ ...FULL, routine: { summary: "   " } }, 9, CONFIG)).toBe("routine");
    expect(gapVector({ ...FULL, routine: "prose" }, 9, CONFIG)).toBe("routine");
  });

  it("treats a null, non-array, or empty activity list as missing", () => {
    expect(
      gapVector({ ...FULL, high_dopamine_activities: null }, 9, CONFIG),
    ).toBe("high_dopamine_activities");
    expect(
      gapVector({ ...FULL, high_dopamine_activities: "sweets" }, 9, CONFIG),
    ).toBe("high_dopamine_activities");
    expect(gapVector({ ...FULL, high_dopamine_activities: [] }, 9, CONFIG)).toBe(
      "high_dopamine_activities",
    );
  });

  it("uses the exact minimum boundary and fails closed on a non-finite count", () => {
    expect(gapVector(FULL, 5, CONFIG)).toBeNull();
    expect(gapVector(FULL, 4, CONFIG)).toBe("baseline_facts");
    expect(gapVector(FULL, Number.NaN, CONFIG)).toBe("baseline_facts");
  });

  it("surfaces a malformed threshold instead of silently defaulting", () => {
    expect(() =>
      gapVector(FULL, 0, { proactive_gap_min_baseline_facts: -1 }),
    ).toThrow();
    expect(() =>
      gapVector(FULL, 0, { proactive_gap_min_baseline_facts: 1.5 }),
    ).toThrow();
  });
});

describe("companionshipContext (FR-12)", () => {
  it("shapes only the light context: silence, journal gap, latest metric + direction", () => {
    expect(companionshipContext(18, 4, { name: "Momentum", direction: "up" })).toEqual({
      silence_hours: 18,
      journal_gap_days: 4,
      latest_metric: { name: "Momentum", direction: "up" },
    });
  });

  it("allows a null latest metric", () => {
    expect(companionshipContext(2.5, 0, null)).toEqual({
      silence_hours: 2.5,
      journal_gap_days: 0,
      latest_metric: null,
    });
  });
});
