// supabase/functions/_shared/accountability/templates.test.ts
// FP-08 AC-8/AC-9 (unit half) — the deterministic texts.
// Refs: FP-08 FR-19, FR-21; TECH-SPEC §7.5, §7.8.
//
// Type-checked by `deno check` and run by jest.

import { preemptiveText, strikeTemplate } from "./templates.ts";
import type { StrikeGroundTruth } from "./strike.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toContain(expected: string): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const GT: StrikeGroundTruth = {
  doings_count: 14,
  hours_logged: 12,
  missed_windows: 3,
  impulse_failures: 5,
  watch_started_at: "2026-10-14",
  strike_at: "2026-10-21",
  window: { start: "2026-10-14", end: "2026-10-20" },
};

describe("preemptiveText (FR-21)", () => {
  it("names the rotating activity and the window", () => {
    const text = preemptiveText("a 10-minute walk", 18, 15);
    expect(text).toContain("18:00");
    expect(text).toContain("a 10-minute walk");
    expect(text).toContain("15 minutes");
  });

  it("degrades to the generic alternative when the list is empty", () => {
    const text = preemptiveText(null, 21, 15);
    expect(text).toContain("21:00");
    expect(text).toContain("alternative");
  });

  it("clamps a malformed lead to the default", () => {
    const text = preemptiveText(null, 21, Number.NaN);
    expect(text).toContain("15 minutes");
  });
});

describe("strikeTemplate (FR-19 fallback)", () => {
  it("carries the ground-truth numbers and the watch length only", () => {
    const text = strikeTemplate({ ...GT, watch_days: 7 });
    expect(text).toContain("14 doings");
    expect(text).toContain("12 hours");
    expect(text).toContain("3 check-in windows missed");
    expect(text).toContain("5 impulse failures");
    expect(text).toContain("7 days");
    expect(text).toContain("14 October 2026");
  });

  it("makes no goal claim", () => {
    const text = strikeTemplate({ ...GT, watch_days: 7 });
    expect(text.includes("goal") || text.includes("deadline")).toBe(false);
  });
});
