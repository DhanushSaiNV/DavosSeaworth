// supabase/functions/_shared/accountability/drift.test.ts
// FP-08 Step 5 — the drift evaluator's decision table (FR-12).
// Refs: FP-08 FR-12; TECH-SPEC §7.3; D15.

import { evaluateDrift, isDriftReason, isImpulseCluster, driftReason } from "./drift.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toContain(expected: string): void;
  toHaveLength(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const thresholds = {
  window_days: 3,
  late_start_hour: 10,
  compliance_threshold: 0.6,
  energy_threshold: 4,
};

function day(local_date: string, first: number | null, expected = 2, answered = 2, energy: number | null = null) {
  return { local_date, first_doing_minutes: first, expected, answered, energy_avg: energy };
}

describe("evaluateDrift (FR-12)", () => {
  it("does not fire when the most recent day is on time", () => {
    const result = evaluateDrift([
      day("2026-10-19", 11 * 60),
      day("2026-10-20", 10 * 60 + 1),
      day("2026-10-21", 9 * 60 + 59),
    ], thresholds);
    expect(result.late_start).toBe(false);
    // The chain counts back from yesterday; yesterday was on time, so no run exists.
    expect(result.late_days).toHaveLength(0);
  });

  it("fires late starts only when all three tail days are late", () => {
    const result = evaluateDrift([
      day("2026-10-19", 12 * 60),
      day("2026-10-20", 12 * 60),
      day("2026-10-21", 12 * 60),
    ], thresholds);
    expect(result.late_start).toBe(true);
    expect(result.late_days).toHaveLength(3);
  });

  it("breaks the late chain on a zero-doing day", () => {
    const result = evaluateDrift([
      day("2026-10-19", 12 * 60),
      day("2026-10-20", null),
      day("2026-10-21", 12 * 60),
    ], thresholds);
    expect(result.late_start).toBe(false);
  });

  it("counts a first doing exactly at the hour as on time", () => {
    const result = evaluateDrift([
      day("2026-10-19", 10 * 60),
      day("2026-10-20", 10 * 60),
      day("2026-10-21", 10 * 60),
    ], thresholds);
    expect(result.late_start).toBe(false);
  });

  it("fires compliance below the threshold (aggregate over the window)", () => {
    const result = evaluateDrift([
      day("2026-10-19", 9 * 60, 2, 1),
      day("2026-10-20", 9 * 60, 2, 1),
      day("2026-10-21", 9 * 60, 2, 1),
    ], thresholds);
    expect(result.compliance_rate).toBe(0.5);
    expect(result.compliance_drop).toBe(true);
  });

  it("does not fire compliance exactly at the threshold", () => {
    const result = evaluateDrift([
      day("2026-10-19", 9 * 60, 2, 2),
      day("2026-10-20", 9 * 60, 3, 1),
      day("2026-10-21", 9 * 60, 5, 3),
    ], thresholds);
    // 6/10 = 0.6, not below 0.6.
    expect(result.compliance_rate).toBe(0.6);
    expect(result.compliance_drop).toBe(false);
  });

  it("does not fire compliance with zero expected windows", () => {
    const result = evaluateDrift([day("2026-10-21", 9 * 60, 0, 0)], thresholds);
    expect(result.compliance_drop).toBe(false);
  });

  it("fires the energy slide below the threshold with at least three energized days", () => {
    const result = evaluateDrift([
      day("2026-10-19", 9 * 60, 2, 2, 3.5),
      day("2026-10-20", 9 * 60, 2, 2, 3.5),
      day("2026-10-21", 9 * 60, 2, 2, 3.5),
    ], thresholds);
    expect(result.energy_mean).toBe(3.5);
    expect(result.energy_slide).toBe(true);
  });

  it("does not fire the energy slide with fewer than three energized days", () => {
    const result = evaluateDrift([
      day("2026-10-19", 9 * 60, 2, 2, 1),
      day("2026-10-20", 9 * 60, 2, 2, 1),
      day("2026-10-21", 9 * 60, 2, 2, null),
    ], thresholds);
    expect(result.energy_mean).toBe(1);
    expect(result.energy_slide).toBe(false);
  });

  it("does not fire the energy slide at the threshold", () => {
    const result = evaluateDrift([
      day("2026-10-19", 9 * 60, 2, 2, 4),
      day("2026-10-20", 9 * 60, 2, 2, 4),
      day("2026-10-21", 9 * 60, 2, 2, 4),
    ], thresholds);
    expect(result.energy_slide).toBe(false);
  });

  it("reports every fired pattern in table order", () => {
    const result = evaluateDrift([
      day("2026-10-19", 12 * 60, 2, 0, 2),
      day("2026-10-20", 12 * 60, 2, 0, 2),
      day("2026-10-21", 12 * 60, 2, 0, 2),
    ], thresholds);
    expect(result.fired).toEqual(["late_start", "compliance_drop", "energy_slide"]);
  });
});

describe("isImpulseCluster (FR-12)", () => {
  it("fires at the threshold", () => {
    expect(isImpulseCluster(3, 3)).toBe(true);
  });
  it("does not fire below it", () => {
    expect(isImpulseCluster(2, 3)).toBe(false);
  });
  it("treats malformed input as no fire", () => {
    expect(isImpulseCluster(Number.NaN, 3)).toBe(false);
  });
});

describe("the reason map (FR-14)", () => {
  it("maps each pattern to its §2.3 reason", () => {
    expect(driftReason("late_start")).toBe("drift_late_start");
    expect(driftReason("compliance_drop")).toBe("drift_compliance_drop");
    expect(driftReason("energy_slide")).toBe("drift_energy_slide");
    expect(isDriftReason("drift_late_start")).toBe(true);
    expect(isDriftReason("habit_confrontation")).toBe(false);
  });
});
