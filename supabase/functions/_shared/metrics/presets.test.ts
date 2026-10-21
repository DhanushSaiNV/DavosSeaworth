// supabase/functions/_shared/metrics/presets.test.ts
// FP-07 Step 3 — the preset library cannot ship an unvalidated formula (AC-5).
// Refs: FP-07 FR-9, FR-10; TECH-SPEC §7.9, §3.3, §3.4; decisions2 D9 / TECH-SPEC D10, D17.

import { validateFormula, type FormulaBounds } from "./formula.ts";
import { METRIC_PRESETS, METRIC_PRESET_NAMES } from "./presets.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BOUNDS: FormulaBounds = { max_depth: 6, max_nodes: 30, literal_abs_max: 1000 };
const CANONICAL_DOMAINS = new Set([
  "Career",
  "Finance",
  "Fitness",
  "Health",
  "Learning",
  "Creativity",
  "Relationships",
  "Family",
  "Social",
  "Mental/Emotional",
  "Spirituality",
  "Discipline/Habits",
  "Communication",
  "Environment/Home",
  "Recreation",
  "Purpose/Legacy",
]);

describe("FP-07 metric presets", () => {
  it("ships exactly the eight core presets", () => {
    expect(METRIC_PRESETS.length).toBe(8);
    expect(METRIC_PRESET_NAMES).toEqual(METRIC_PRESETS.map((p) => p.name));
  });

  it("passes every preset through the real gate", () => {
    for (const preset of METRIC_PRESETS) {
      const result = validateFormula(preset.formula, BOUNDS);
      if (!result.ok) {
        throw new Error(
          `${preset.name} failed the gate: ${result.errors.map((e) => `${e.code}@${e.path}`).join(", ")}`,
        );
      }
    }
  });

  it("uses canonical domains, unique names, and short output units", () => {
    const names = new Set<string>();
    for (const preset of METRIC_PRESETS) {
      expect(CANONICAL_DOMAINS.has(preset.domain)).toBe(true);
      expect(names.has(preset.name)).toBe(false);
      names.add(preset.name);
      expect(preset.output_unit.length).toBeGreaterThan(0);
      expect(preset.output_unit.length <= 16).toBe(true);
    }
  });
});
