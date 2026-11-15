// supabase/functions/_shared/rag/thresholds.test.ts
// T8's threshold half and PLAN.md §10: NULL, absent, malformed or out-of-range is unavailable.
//
// Refs: PRD §6.2, §6.3, §14.1 T8; PLAN.md §1.5, §10, §15 gate G1.

import {
  THRESHOLD_KEYS,
  parseThreshold,
  plannerThresholdsReady,
  resolveThresholds,
} from "./thresholds.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("parseThreshold — fails closed", () => {
  it("accepts a finite number in (0, 1]", () => {
    expect(parseThreshold(0.42)).toEqual({ ok: true, value: 0.42 });
    expect(parseThreshold(1)).toEqual({ ok: true, value: 1 });
    expect(parseThreshold(0.0001)).toEqual({ ok: true, value: 0.0001 });
  });

  it("accepts a numeric string (the jsonb storage form)", () => {
    expect(parseThreshold("0.55")).toEqual({ ok: true, value: 0.55 });
    expect(parseThreshold(" 0.6 ")).toEqual({ ok: true, value: 0.6 });
  });

  it("rejects null, undefined and the empty string", () => {
    for (const raw of [null, undefined, "", "   "]) {
      expect(parseThreshold(raw)).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    }
  });

  it("rejects zero and the open lower bound", () => {
    expect(parseThreshold(0)).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(parseThreshold("0")).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(parseThreshold(-0.1)).toEqual({ ok: false, reason: "threshold_uncalibrated" });
  });

  it("rejects values above one and non-finite numbers", () => {
    expect(parseThreshold(1.0001)).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(parseThreshold(Number.NaN)).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(parseThreshold(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: "threshold_uncalibrated",
    });
  });

  it("rejects non-numeric and boolean values", () => {
    expect(parseThreshold("high")).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(parseThreshold(true)).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(parseThreshold({})).toEqual({ ok: false, reason: "threshold_uncalibrated" });
  });
});

describe("resolveThresholds — both keys, missing is unavailable", () => {
  it("reads both calibrated values", () => {
    const resolved = resolveThresholds([
      { key: THRESHOLD_KEYS.rules, value: 0.4 },
      { key: THRESHOLD_KEYS.memory, value: "0.35" },
    ]);
    expect(resolved.rules).toEqual({ ok: true, value: 0.4 });
    expect(resolved.memory).toEqual({ ok: true, value: 0.35 });
    expect(plannerThresholdsReady(resolved)).toBe(true);
  });

  it("treats a missing row exactly like a NULL row", () => {
    const resolved = resolveThresholds([{ key: THRESHOLD_KEYS.rules, value: 0.4 }]);
    expect(resolved.rules.ok).toBe(true);
    expect(resolved.memory).toEqual({ ok: false, reason: "threshold_uncalibrated" });
    expect(plannerThresholdsReady(resolved)).toBe(false);
  });

  it("is not ready while either threshold is NULL", () => {
    const resolved = resolveThresholds([
      { key: THRESHOLD_KEYS.rules, value: null },
      { key: THRESHOLD_KEYS.memory, value: 0.5 },
    ]);
    expect(resolved.rules.ok).toBe(false);
    expect(resolved.memory.ok).toBe(true);
    expect(plannerThresholdsReady(resolved)).toBe(false);
  });

  it("ignores unrelated config keys and lets the last duplicate win", () => {
    const resolved = resolveThresholds([
      { key: "rag_evidence_total_chars", value: 12000 },
      { key: THRESHOLD_KEYS.memory, value: 0.2 },
      { key: THRESHOLD_KEYS.memory, value: 0.3 },
      { key: THRESHOLD_KEYS.rules, value: 0.4 },
    ]);
    expect(resolved.memory).toEqual({ ok: true, value: 0.3 });
    expect(plannerThresholdsReady(resolved)).toBe(true);
  });
});
