// supabase/functions/_shared/pipeline/bands.test.ts
// Unit tests for the pure band arithmetic — FP-03 AC-2 (unit level): the three-tier routing at
// the exact band edges 0.75 / 0.749 / 0.55 / 0.549 / 0.40 / 0.399, plus the D8 band shift.
// Refs: TECH-SPEC §5.3, §5.4, §11 (`confidence_bands`), D4, D8.
//
// Why `bands.ts` and not `persona.ts`: `persona.ts` imports `_shared/config.ts`, which reads
// `Deno.env` and builds a service-role client at module load, so it cannot load under jest.
// `persona.ts` re-exports everything tested here, so these tests cover the code stage 4 calls.

import { applyBandShift, routeFor, type ConfidenceBands } from "./bands.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the ones we use. Babel erases
// these at transform time and jest supplies the real implementations at runtime.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeCloseTo(expected: number, digits?: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

/** The §11 registry values as seeded by migration 0001 — fixtures; production reads `config`. */
const BANDS: ConfidenceBands = {
  high: 0.75,
  medium_low: 0.55,
  medium_high: 0.74,
  low_low: 0.40,
  low_high: 0.54,
  fallback: 0.40,
};

describe("routeFor (AC-2 band edges)", () => {
  it("routes the six spec edges exactly as AC-2 states them", () => {
    expect(routeFor(0.75, BANDS)).toBe("auto");
    expect(routeFor(0.749, BANDS)).toBe("options");
    expect(routeFor(0.55, BANDS)).toBe("options");
    expect(routeFor(0.549, BANDS)).toBe("low_question");
    expect(routeFor(0.40, BANDS)).toBe("low_question");
    expect(routeFor(0.399, BANDS)).toBe("fallback");
  });

  it("treats every boundary as inclusive (>=, not >)", () => {
    // The edge itself belongs to the higher tier; one ulp below belongs to the lower one.
    expect(routeFor(BANDS.high, BANDS)).toBe("auto");
    expect(routeFor(BANDS.high - 1e-9, BANDS)).toBe("options");
    expect(routeFor(BANDS.medium_low, BANDS)).toBe("options");
    expect(routeFor(BANDS.medium_low - 1e-9, BANDS)).toBe("low_question");
    expect(routeFor(BANDS.low_low, BANDS)).toBe("low_question");
    expect(routeFor(BANDS.low_low - 1e-9, BANDS)).toBe("fallback");
  });

  it("covers the range ends", () => {
    expect(routeFor(1, BANDS)).toBe("auto");
    expect(routeFor(0, BANDS)).toBe("fallback");
  });

  it("ignores medium_high / low_high / fallback — the Low floor is low_low", () => {
    // These three keys are in the §11 registry but gate nothing; this pins that, so a future
    // change to them is a deliberate routing change rather than a silent one.
    const moved: ConfidenceBands = {
      ...BANDS,
      medium_high: 0.99,
      low_high: 0.99,
      fallback: 0.99,
    };
    expect(routeFor(0.6, moved)).toBe("options");
    expect(routeFor(0.45, moved)).toBe("low_question");
    expect(routeFor(0.2, moved)).toBe("fallback");
  });
});

describe("applyBandShift (D8, §5.4)", () => {
  it("lowers every threshold by the shift (positive shift = easier auto-adoption)", () => {
    // `toBeCloseTo`, not exact equality: `base − shift` is float arithmetic and 0.55 − 0.1 is
    // not the double nearest 0.45.
    const s = applyBandShift(BANDS, 0.1);
    expect(s.high).toBeCloseTo(0.65);
    expect(s.medium_low).toBeCloseTo(0.45);
    expect(s.medium_high).toBeCloseTo(0.64);
    expect(s.low_low).toBeCloseTo(0.3);
    expect(s.low_high).toBeCloseTo(0.44);
    expect(s.fallback).toBeCloseTo(0.3);
  });

  it("raises every threshold by the shift (negative shift = harder)", () => {
    expect(applyBandShift(BANDS, -0.1).high).toBeCloseTo(0.85);
    expect(applyBandShift(BANDS, -0.1).low_low).toBeCloseTo(0.5);
  });

  it("clamps the shift to ±0.10 (§5.4)", () => {
    expect(applyBandShift(BANDS, 5)).toEqual(applyBandShift(BANDS, 0.1));
    expect(applyBandShift(BANDS, -5)).toEqual(applyBandShift(BANDS, -0.1));
  });

  it("moves a confidence a tier when composed with routeFor", () => {
    // 0.66 is `options` at the base bands but `auto` once a +0.10 shift lands (high = 0.65).
    expect(routeFor(0.66, BANDS)).toBe("options");
    expect(routeFor(0.66, applyBandShift(BANDS, 0.1))).toBe("auto");
    // 0.70 is `options` at the base bands and stays there once a -0.10 shift raises high to 0.85.
    expect(routeFor(0.70, BANDS)).toBe("options");
    expect(routeFor(0.70, applyBandShift(BANDS, -0.1))).toBe("options");
    // 0.80 auto-adopts at the base bands but drops to `options` under the same negative shift.
    expect(routeFor(0.80, BANDS)).toBe("auto");
    expect(routeFor(0.80, applyBandShift(BANDS, -0.1))).toBe("options");
  });
});
