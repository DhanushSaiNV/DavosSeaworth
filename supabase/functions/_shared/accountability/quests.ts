// supabase/functions/_shared/accountability/quests.ts
// FP-08 Step 2 — the quest math's pure half (FR-15 … FR-17).
//
// Refs: FP-08 FR-15, FR-16, FR-17; TECH-SPEC §7.3, §7.9; D10, D15.
//
// Three rules live here:
//   * the deadline clamp (`quest_deadline_bounds`, [SPEC] {min:3,max:21}) applied at accept;
//   * the verdict table — day-pass = value ≥ 1; zero passing days → `expired`; else passing
//     days ≥ `quest_completion_fraction` × elapsed days → `completed`, else `failed`
//     (FR-16's recorded reading: fraction over elapsed days, so dead days count against);
//   * the ProgressBar input, mirroring FP-07's client rule exactly (`lib/metricsData.ts`),
//     for the debrief recap. The client rule is time-based and stays the single client rule;
//     this copy exists only because the server cannot import the client module.

export interface DeadlineBounds {
  min_days: number;
  max_days: number;
}

/**
 * Clamp the model's proposed deadline into the configured bounds. A non-finite proposal falls
 * back to the minimum (the shortest, least-committing quest) rather than inventing a value.
 * Malformed bounds degrade in the same direction: max never below min.
 */
export function clampDeadlineDays(days: number, bounds: DeadlineBounds): number {
  const min = Number.isFinite(bounds?.min_days) ? Math.max(1, Math.round(bounds.min_days)) : 3;
  const rawMax = Number.isFinite(bounds?.max_days) ? Math.max(1, Math.round(bounds.max_days)) : 21;
  const max = Math.max(min, rawMax);
  if (!Number.isFinite(days)) return min;
  return Math.max(min, Math.min(max, Math.round(days)));
}

/** Inclusive day count of the quest window; a same-day quest is one day. */
export function elapsedDays(createdDate: string, deadline: string): number {
  const start = Date.parse(`${createdDate}T00:00:00Z`);
  const end = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export type QuestVerdict = "completed" | "failed" | "expired";

/**
 * FR-16's verdict table over the points loaded for `[created local date, deadline]`.
 * `points` are the raw `metric_points.value` numbers. Day-pass is `value >= 1`; a day with a
 * value of 0 (or no point at all) does not pass.
 */
export function questVerdict(
  points: number[],
  createdDate: string,
  deadline: string,
  fraction: number,
): QuestVerdict {
  const passingDays = (Array.isArray(points) ? points : [])
    .filter((value) => Number.isFinite(value) && value >= 1).length;
  if (passingDays === 0) return "expired";
  const days = elapsedDays(createdDate, deadline);
  if (days === 0) return "failed";
  const required = (Number.isFinite(fraction) ? Math.max(0, fraction) : 0) * days;
  return passingDays >= required ? "completed" : "failed";
}

/**
 * The elapsed fraction of the created_at → quest_deadline window — a byte-for-byte mirror of
 * `lib/metricsData.ts`'s `progressFraction` (same clamps and the same past-deadline = 1 rule).
 * Used only in the debrief recap (FR-16); the dashboard keeps rendering through the client
 * rule with zero FP-07 changes.
 */
export function progressFraction(
  createdAt: string | null | undefined,
  questDeadline: string | null | undefined,
  nowIso: string,
): number {
  if (!createdAt || !questDeadline) return 0;
  const start = Date.parse(createdAt);
  const end = Date.parse(`${questDeadline}T23:59:59.999Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return Number.isFinite(start) && Number.isFinite(end) && end <= start ? 1 : 0;
  }
  const current = Date.parse(nowIso);
  if (!Number.isFinite(current) || current <= start) return 0;
  if (current >= end) return 1;
  return (current - start) / (end - start);
}
