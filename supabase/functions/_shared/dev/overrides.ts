// supabase/functions/_shared/dev/overrides.ts
// Dev-only classifier override helpers, shared by `dev-smoke` and `send-message`
// (Step 6 reuses them too). AGENTS.md §2: dev-only; the CALLER decides whether to
// honor them (send-message gates on the `dev_overrides_enabled` config flag).

import type { ClassifyOverrides } from "../pipeline/classify.ts";
import type { ConfidenceBands } from "../pipeline/persona.ts";

export type ForceTier = "high" | "medium" | "low" | "fallback";

/**
 * Map a dev `force` tier to a classifier `overall_conf`, derived from the live
 * `confidence_bands` config — no hardcoded thresholds. The `fallback` tier sits one
 * notch below the low band so it trips the D7 route.
 */
export function forceToConf(force: string, bands: ConfidenceBands): number {
  switch (force) {
    case "high":
      return bands.high;
    case "medium":
      return bands.medium_low;
    case "low":
      return bands.low_low;
    case "fallback":
      return Math.max(0, bands.fallback - 0.01);
    default:
      throw new Error(`unknown force tier: ${force} (use high|medium|low|fallback)`);
  }
}

/** Assemble classifier overrides from a dev force tier + optional domain/emotion. */
export function overridesFromForce(args: {
  force?: string | null;
  domain?: string | null;
  emotion?: string | null;
  bands: ConfidenceBands;
}): ClassifyOverrides {
  const overrides: ClassifyOverrides = {};
  if (args.force && args.force !== "none") {
    overrides.overall_conf = forceToConf(args.force, args.bands);
  }
  if (args.domain) overrides.domain = args.domain;
  if (args.emotion) overrides.emotion = args.emotion;
  return overrides;
}
