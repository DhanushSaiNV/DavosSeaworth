// supabase/functions/_shared/accountability/drift.ts
// FP-08 Step 5 — the drift scan's pure half (FR-12, FR-13).
//
// Refs: FP-08 FR-12, FR-13; TECH-SPEC §7.3, §7.5; D15, D24.
//
// Zero imports (the Step 2 floor): jest loads this with no Deno shim. The impure half
// (`runDriftScan.ts`) owns every read and write; this module only decides whether each
// §7.3 pattern fires over an already-loaded window of complete local days.
//
// The window is the trailing `drift_window_days` complete days (today excluded — it is still
// open). A "late start" day needs a first `doing`; a zero-doing day is explicitly not late
// (it breaks the chain), which is why the input carries `first_doing_minutes: null` separately
// from a late-but-present value.

/** The three patterns that become `intervention` jobs; the impulse cluster routes to habits. */
export type DriftPattern = "late_start" | "compliance_drop" | "energy_slide";

/** FR-14's job reasons, one per pattern. */
export const DRIFT_REASONS = {
  late_start: "drift_late_start",
  compliance_drop: "drift_compliance_drop",
  energy_slide: "drift_energy_slide",
} as const;

export const DRIFT_REASON_VALUES: readonly string[] = Object.values(DRIFT_REASONS);

/** FR-13's confrontation reason: the habit path's intervention. */
export const HABIT_CONFRONTATION_REASON = "habit_confrontation";

export function driftReason(pattern: DriftPattern): string {
  return DRIFT_REASONS[pattern];
}

export function isDriftReason(reason: string | null | undefined): reason is string {
  return typeof reason === "string" && DRIFT_REASON_VALUES.includes(reason);
}

export interface DriftDay {
  /** `YYYY-MM-DD`, the user-local day. */
  local_date: string;
  /** Minutes since local midnight of the first `doing` that day; null when nothing was logged. */
  first_doing_minutes: number | null;
  /** Grid windows the day expected. */
  expected: number;
  /** Grid windows the day answered. */
  answered: number;
  /** The view's `energy_avg` for the day; null when no doing carried an energy reading. */
  energy_avg: number | null;
}

export interface DriftThresholds {
  window_days: number;
  late_start_hour: number;
  compliance_threshold: number;
  energy_threshold: number;
}

export interface DriftEvaluation {
  /** Fired patterns, in the table's order. */
  fired: DriftPattern[];
  late_start: boolean;
  compliance_drop: boolean;
  energy_slide: boolean;
  /** Aggregate answered/expected over the window (0 when there were no expected windows). */
  compliance_rate: number;
  /** Mean of the non-null energy readings; null when none. */
  energy_mean: number | null;
  energized_days: number;
  /** The local dates of the days whose first doing was late (for the evidence line). */
  late_days: string[];
  /** Days actually evaluated (the tail of the input, after dropping today if present). */
  days: DriftDay[];
}

/**
 * The three temporal patterns. Thresholds are read from `config` by the caller; the window
 * is already trimmed to complete days.
 */
export function evaluateDrift(
  input: readonly DriftDay[],
  thresholds: DriftThresholds,
): DriftEvaluation {
  const days = Array.isArray(input) ? input : [];
  const windowDays = Math.max(1, Math.floor(thresholds.window_days));
  const lateHour = Number.isFinite(thresholds.late_start_hour) ? thresholds.late_start_hour : 10;
  const lateMinutes = Math.max(0, Math.min(24, lateHour)) * 60;

  // Late starts: the last three days each need a first doing *after* the hour. A missing
  // first doing (zero-doing day) breaks the chain, so the run is counted from the tail.
  let consecutiveLate = 0;
  const lateDays: string[] = [];
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const minutes = days[index].first_doing_minutes;
    if (minutes === null || !Number.isFinite(minutes) || minutes <= lateMinutes) break;
    consecutiveLate += 1;
    lateDays.unshift(days[index].local_date);
    if (consecutiveLate >= 3) break;
  }
  const late_start = consecutiveLate >= 3;

  let expected = 0;
  let answered = 0;
  let energySum = 0;
  let energizedDays = 0;
  for (const day of days) {
    expected += Math.max(0, day.expected);
    answered += Math.max(0, Math.min(day.expected, day.answered));
    if (day.energy_avg !== null && Number.isFinite(day.energy_avg)) {
      energySum += day.energy_avg;
      energizedDays += 1;
    }
  }
  const compliance_rate = expected > 0 ? answered / expected : 0;
  const compliance_drop = expected > 0 && compliance_rate < thresholds.compliance_threshold;
  const energy_mean = energizedDays > 0 ? energySum / energizedDays : null;
  // FR-12: fewer than three energized days → no fire, even when the mean is low.
  const energy_slide = energizedDays >= 3 && energy_mean !== null
    && energy_mean < thresholds.energy_threshold;

  const fired: DriftPattern[] = [];
  if (late_start) fired.push("late_start");
  if (compliance_drop) fired.push("compliance_drop");
  if (energy_slide) fired.push("energy_slide");

  return {
    fired,
    late_start,
    compliance_drop,
    energy_slide,
    compliance_rate,
    energy_mean,
    energized_days: energizedDays,
    late_days: lateDays,
    days: days.slice(Math.max(0, days.length - windowDays)),
  };
}

/** The impulse cluster is a 7-day count compared to the habit threshold. */
export function isImpulseCluster(count: number, threshold: number): boolean {
  if (!Number.isFinite(count) || !Number.isFinite(threshold)) return false;
  return count >= Math.max(1, threshold);
}
