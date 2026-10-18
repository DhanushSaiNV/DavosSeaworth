// supabase/functions/_shared/dev/overrides.ts
// Dev-only override helpers, shared by `dev-smoke`, `send-message` and (FP-04 Step 3b)
// `submit-checkin` (Step 6 reuses them too). AGENTS.md §2: dev-only; the CALLER decides whether
// to honor them — `send-message` gates on the `dev_overrides_enabled` config flag, and
// `submit-checkin`'s eval drill re-checks the same flag inside `evaluateDoing` (fail-closed).
//
// Reading a flag out of the request body and honoring it are deliberately two steps: this module
// only ever parses, so a mistyped body can never enable a drill on its own.

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

/**
 * FP-04 FR-12 — does this request ask for the eval drill (`dev_force.eval_intervention`)?
 *
 * Fail-closed on everything but a real JSON `true` sitting on an object `dev_force`: a string
 * `dev_force` (the tier shorthand `send-message` also accepts), `1`, `"true"`, a missing key or
 * a non-object all read as "no drill". The caller still re-checks `dev_overrides_enabled`; this
 * function is the parse, not the permission.
 */
export function evalForceIntervention(body: Record<string, unknown>): boolean {
  const raw = body.dev_force;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).eval_intervention === true;
}
