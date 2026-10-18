// supabase/functions/_shared/pipeline/persona.ts
// Pipeline stage 4 — Persona Determination (three-tier routing, PRD §2 / TECH-SPEC §5.3).
//
// Effective bands = config.confidence_bands shifted by persona_stats.band_shift
// (D8 adaptive weighting). A positive shift lowers every threshold, so a user whose
// auto-adoptions keep landing gets auto-adopted sooner. band_shift is capped ±0.10 by
// §5.4; we clamp defensively anyway.

import { getConfig, supabaseService } from "../config.ts";
import type { Classification } from "./classify.ts";
import { applyBandShift, routeFor } from "./bands.ts";
import type { ConfidenceBands, Route } from "./bands.ts";

// Re-exported so every existing `from "./persona.ts"` call site keeps working; the band
// arithmetic itself lives in `bands.ts` (pure, jest-reachable — FP-03 Step 7, AC-2).
export { applyBandShift, routeFor } from "./bands.ts";
export type { ConfidenceBands, Route } from "./bands.ts";

export interface PersonaDecision {
  route: Route;
  persona: string;
  /** Domain used downstream; forced to `General` on the fallback route (D7). */
  domain: string;
  overallConf: number;
  bandShift: number;
  /** Effective (shifted) thresholds actually used for routing. */
  effectiveBands: ConfidenceBands;
}

/**
 * PLACEHOLDER-DEV emotion → persona map (AGENTS.md §8.4).
 * §5.3 says High auto-adopts "the persona matching the detected emotion" but no
 * mapping exists in any source doc. This is a labeled stand-in pending owner content;
 * it is not derived from the PRD and must be signed off before beta.
 */
export const EMOTION_PERSONA: Record<string, string> = {
  frustrated: "mentor_tough",
  determined: "mentor_tough",
  proud: "brother",
  exhausted: "therapist_empath",
  anxious: "therapist_empath",
  avoidant: "therapist_empath",
};

/**
 * The D7 route's domain (§5.3, §6.4). Exported so a caller that has *no* classification to
 * route on still retrieves rules for the same neutral domain the fallback route would use —
 * the Step 6 watchdog intervention, whose turn is unclassified by construction.
 */
export const FALLBACK_DOMAIN = "General";
const FALLBACK_PERSONA = "inquirer";

export async function readConfidenceBands(): Promise<ConfidenceBands> {
  const raw = await getConfig("confidence_bands");
  if (typeof raw !== "object" || raw === null) {
    throw new Error('config key "confidence_bands" is missing or not an object');
  }
  const b = raw as Record<string, unknown>;
  const num = (k: keyof ConfidenceBands): number => {
    const v = b[k];
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error(`confidence_bands.${k} is missing or not numeric`);
    return n;
  };
  return {
    high: num("high"),
    medium_low: num("medium_low"),
    medium_high: num("medium_high"),
    low_low: num("low_low"),
    low_high: num("low_high"),
    fallback: num("fallback"),
  };
}

async function readBandShift(userId: string | undefined, domain: string): Promise<number> {
  if (!userId) return 0; // dev-smoke has no user; no history → no shift
  const { data, error } = await supabaseService
    .from("persona_stats")
    .select("band_shift")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error || !data) return 0;
  const v = data.band_shift;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-0.1, Math.min(0.1, n)); // §5.4 ±0.10 cap
}

/**
 * The three-tier comparison and the shift arithmetic live in `bands.ts` (pure, jest-reachable)
 * and are re-exported above. This module keeps stage 4's config/service dependencies.
 */

/** The D7 route: domain → `General`, persona → `inquirer` (§5.3, §6.4). */
function fallbackDecision(
  conf: number,
  bandShift: number,
  eff: ConfidenceBands,
): PersonaDecision {
  return {
    route: "fallback",
    persona: FALLBACK_PERSONA,
    domain: FALLBACK_DOMAIN,
    overallConf: conf,
    bandShift,
    effectiveBands: eff,
  };
}

/**
 * Stage 4. Reads the classifier output and returns the route + persona key.
 * NOTE: `dialog_state = LOCKDOWN` handling (D21) is intentionally NOT implemented —
 * FP-02 excludes it (no setter exists yet; the hook lands with that FP).
 */
export async function determinePersona(
  classification: Classification,
  userId?: string,
): Promise<PersonaDecision> {
  const bands = await readConfidenceBands();
  const bandShift = await readBandShift(userId, classification.domain ?? FALLBACK_DOMAIN);
  const eff = applyBandShift(bands, bandShift);

  const conf = classification.overall_conf;
  const domain = classification.domain;
  const emotion = classification.emotion;

  // No label, or below the low band → D7 General/inquirer fallback.
  if (!domain || !emotion) return fallbackDecision(conf, bandShift, eff);
  const route = routeFor(conf, eff);
  if (route === "fallback") return fallbackDecision(conf, bandShift, eff);

  const persona = EMOTION_PERSONA[emotion] ?? FALLBACK_PERSONA;
  return { route, persona, domain, overallConf: conf, bandShift, effectiveBands: eff };
}
