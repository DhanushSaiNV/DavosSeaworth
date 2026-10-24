// supabase/functions/_shared/proactive/gaps.ts
// FP-09 Step 2 — the pure proactive gap vector and companionship context
// (TECH-SPEC §7.7, §7.8).
// Refs: FP-09 FR-13, AC-7; TECH-SPEC §7.7, §7.8; D22.
//
// Pure (jest-loadable): no Deno.env, no service client, no clock. The order and the
// first-missing rule mirror the `0033` tick exactly:
//   wake -> sleep -> routine -> high-dopamine activities -> baseline-fact count.
// The handler reuses this module so the live gate and the message path cannot drift.

export type GapKey =
  | "wake_time"
  | "sleep_time"
  | "routine"
  | "high_dopamine_activities"
  | "baseline_facts";

export interface GapProfile {
  wake_time?: string | null;
  sleep_time?: string | null;
  routine?: unknown;
  high_dopamine_activities?: unknown;
}

export interface GapConfig {
  proactive_gap_min_baseline_facts: number;
}

export type MetricDirection = "up" | "down" | "flat";

export interface LatestMetric {
  name: string;
  direction: MetricDirection;
}

export interface CompanionshipContext {
  silence_hours: number;
  journal_gap_days: number;
  latest_metric: LatestMetric | null;
}

function routineHasSummary(routine: unknown): boolean {
  if (routine === null || typeof routine !== "object" || Array.isArray(routine)) {
    return false;
  }
  const summary = (routine as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim().length > 0;
}

/**
 * The first missing gap in the fixed order, or `null` when the profile is complete
 * enough for a companionship message. `config` is validated: a missing or malformed
 * threshold is a misconfiguration, never a silent default.
 */
export function gapVector(
  profile: GapProfile,
  baselineFactCount: number,
  config: GapConfig,
): GapKey | null {
  const minimum = config?.proactive_gap_min_baseline_facts;
  if (!Number.isInteger(minimum) || minimum < 0) {
    throw new Error(`proactive_gap_min_baseline_facts must be a non-negative integer`);
  }

  if (profile.wake_time == null) return "wake_time";
  if (profile.sleep_time == null) return "sleep_time";
  if (!routineHasSummary(profile.routine)) return "routine";

  const activities = profile.high_dopamine_activities;
  if (!Array.isArray(activities) || activities.length === 0) {
    return "high_dopamine_activities";
  }

  if (!Number.isFinite(baselineFactCount) || baselineFactCount < minimum) {
    return "baseline_facts";
  }
  return null;
}

/** The light context the companionship message may use (FR-12) — no habit/watch data. */
export function companionshipContext(
  silenceHours: number,
  journalGapDays: number,
  latestMetric: LatestMetric | null,
): CompanionshipContext {
  return {
    silence_hours: silenceHours,
    journal_gap_days: journalGapDays,
    latest_metric: latestMetric
      ? { name: latestMetric.name, direction: latestMetric.direction }
      : null,
  };
}
