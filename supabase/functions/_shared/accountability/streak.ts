// supabase/functions/_shared/accountability/streak.ts
// FP-08 Step 2 — the trust streak's pure math (FR-3).
//
// Refs: FP-08 FR-3; TECH-SPEC §5.4, §7.1, §7.3, §11; D4 (one knob), D20.
//
// The streak is consecutive **complete local days ending yesterday** whose check-in compliance
// is at least `drift_compliance_threshold`. Reusing the drift knob is deliberate (FR-3's
// recorded reading): it is one knob for "showed up", and the grid that computes both is the
// frozen server grid — this module never re-derives windows, it only judges the days the
// caller assembled from `windows.ts` (FP-04 NFR-7).
//
// The award (+2, reason `streak`) is carried by the drift scan because `metric_eval`'s cron
// guard requires an active metric — a metric-less user would never score (FR-3's recorded
// reading). The scan's local-day dedup (a `trust_events_user_reason_idx` lookup) makes the
// award idempotent under the 10-minute cadence.

/** §5.4's streak threshold: three or more consecutive complete days. */
export const STREAK_MIN_DAYS = 3;

/** §5.4's award: +2 trust for a qualifying streak day. */
export const STREAK_TRUST_AWARD = 2;

/** One local day as the grid scored it. */
export interface DayCompliance {
  /** `YYYY-MM-DD`, the user-local day. */
  local_date: string;
  /** Windows the grid expected a check-in for. */
  expected: number;
  /** Windows the grid recorded an answer for. */
  answered: number;
}

/**
 * A "complete day" (FR-3/§11's `drift_compliance_threshold` row) is a day with at least one
 * expected window whose answered/expected ratio meets the threshold. A zero-window day is not
 * complete — it breaks the chain rather than counting as a free day.
 */
export function isCompleteDay(day: DayCompliance, threshold: number): boolean {
  if (!Number.isFinite(day.expected) || day.expected <= 0) return false;
  if (!Number.isFinite(day.answered) || day.answered < 0) return false;
  return day.answered / day.expected >= threshold;
}

function utcDay(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Count consecutive complete days ending at the **last** element of `days`.
 *
 * The caller trims today (a complete day needs a closed day, and today is still open), so the
 * last element is yesterday. Days must be contiguous: any gap (`local_date` not exactly one day
 * after the previous) ends the streak even if both days are complete — "consecutive" is not
 * "all complete days in the list".
 */
export function streakDays(days: DayCompliance[], threshold: number): number {
  if (!Array.isArray(days) || days.length === 0) return 0;
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (!isCompleteDay(day, threshold)) break;
    if (index < days.length - 1) {
      const next = utcDay(days[index + 1].local_date);
      const current = utcDay(day.local_date);
      if (!Number.isFinite(next) || !Number.isFinite(current) || next - current !== 86_400_000) break;
    }
    streak += 1;
  }
  return streak;
}

/**
 * The award for this scan: +2 once per local day, and only when the streak qualifies. The
 * scan supplies `alreadyAwardedToday` from the `trust_events_user_reason_idx` lookup.
 */
export function awardStreak(streak: number, alreadyAwardedToday: boolean): number {
  if (alreadyAwardedToday) return 0;
  if (!Number.isFinite(streak) || streak < STREAK_MIN_DAYS) return 0;
  return STREAK_TRUST_AWARD;
}
