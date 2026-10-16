// supabase/functions/_shared/pipeline/bands.ts
// The confidence-band arithmetic, isolated from config and the service client so it is
// unit-testable (FP-03 Step 7, AC-2). `persona.ts` owns stage 4 and re-exports everything here,
// so every existing call site is unchanged.
//
// Why a separate module: `persona.ts` imports `_shared/config.ts`, which reads `Deno.env` and
// builds a service-role client at module load, so it cannot load under jest (the same reason
// `classify.test.ts` tests only the pure half of the classifier). The band comparison is pure —
// it belongs where a test can reach it without a mock.

export type Route = "auto" | "options" | "low_question" | "fallback";

export interface ConfidenceBands {
  high: number;
  medium_low: number;
  medium_high: number;
  low_low: number;
  low_high: number;
  fallback: number;
}

/**
 * Apply the user's band shift to every threshold: `effective = base − shift`.
 * Successes (positive shift) make auto-adoption easier; overrides make it harder.
 * The ±0.10 cap is §5.4's; it is re-applied here defensively (the reader clamps too).
 */
export function applyBandShift(bands: ConfidenceBands, shift: number): ConfidenceBands {
  const s = Math.max(-0.1, Math.min(0.1, shift));
  return {
    high: bands.high - s,
    medium_low: bands.medium_low - s,
    medium_high: bands.medium_high - s,
    low_low: bands.low_low - s,
    low_high: bands.low_high - s,
    fallback: bands.fallback - s,
  };
}

/**
 * The three-tier comparison — pure, so AC-2's band edges are unit-testable at exactly
 * 0.75 / 0.749 / 0.55 / 0.549 / 0.40 / 0.399. `determinePersona` is the only production caller
 * and the comparison is unchanged: `>=` on every boundary.
 * `bands.fallback` is deliberately not read here — the Low band's floor is `low_low` (§5.3).
 */
export function routeFor(overallConf: number, bands: ConfidenceBands): Route {
  if (overallConf >= bands.high) return "auto";
  if (overallConf >= bands.medium_low) return "options";
  if (overallConf >= bands.low_low) return "low_question";
  return "fallback";
}
