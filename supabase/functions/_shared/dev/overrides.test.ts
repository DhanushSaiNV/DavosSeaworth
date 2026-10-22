// supabase/functions/_shared/dev/overrides.test.ts
// FP-04 Step 3b — the dev-override parse helpers (FR-12), and the FP-02 tier mapping they sit
// beside. Both are pure, so both belong in the jest suite rather than a live drill.
//
// Refs: FP-04 FR-12; FP-02 FR-14; TECH-SPEC §5.3, §7.1; AGENTS.md §2.

import { evalForceIntervention, forceToConf, overridesFromForce } from "./overrides.ts";
import type { ConfidenceBands } from "../pipeline/persona.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the ones used here. Babel erases
// these at transform time and jest supplies the real implementations at runtime.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeCloseTo(expected: number, digits?: number): void;
  toThrow(expected?: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BANDS: ConfidenceBands = {
  high: 0.75,
  medium_high: 0.6,
  medium_low: 0.5,
  low_high: 0.4,
  low_low: 0.3,
  fallback: 0.2,
};

describe("evalForceIntervention (FP-04 FR-12)", () => {
  it("accepts only a real JSON true on an object dev_force", () => {
    expect(evalForceIntervention({ dev_force: { eval_intervention: true } })).toBe(true);
  });

  it("is fail-closed on everything that is not a real JSON true", () => {
    const bodies: Record<string, unknown>[] = [
      {},
      { dev_force: null },
      { dev_force: "high" },
      { dev_force: [] },
      { dev_force: { eval_intervention: "true" } },
      { dev_force: { eval_intervention: 1 } },
      { dev_force: { tier: "high" } },
      { dev_force: { eval_intervention: { yes: true } } },
    ];
    for (const body of bodies) {
      expect(evalForceIntervention(body)).toBe(false);
    }
  });
});

describe("forceToConf (FP-02 FR-14)", () => {
  it("maps each tier onto the live bands", () => {
    expect(forceToConf("high", BANDS)).toBe(BANDS.high);
    expect(forceToConf("medium", BANDS)).toBe(BANDS.medium_low);
    expect(forceToConf("low", BANDS)).toBe(BANDS.low_low);
    expect(forceToConf("fallback", BANDS)).toBe(0);
  });

  it("rejects an unknown tier rather than guessing one", () => {
    expect(() => forceToConf("nope", BANDS)).toThrow(/unknown force tier/);
  });
});

describe("overridesFromForce (FP-02 FR-14)", () => {
  it("omits the confidence when the tier is absent or 'none'", () => {
    expect(overridesFromForce({ bands: BANDS })).toEqual({});
    expect(overridesFromForce({ force: "none", bands: BANDS })).toEqual({});
  });

  it("carries a domain/emotion through without forcing a tier", () => {
    expect(overridesFromForce({ domain: "Career", emotion: "exhausted", bands: BANDS })).toEqual({
      domain: "Career",
      emotion: "exhausted",
    });
  });
});
