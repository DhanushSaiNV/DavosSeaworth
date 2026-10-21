// supabase/functions/_shared/accountability/habits.ts
// FP-08 Step 2 — the habit lifecycle's pure table (FR-13, FR-18).
//
// Refs: FP-08 FR-13, FR-18; TECH-SPEC §7.5, §3.4; D22, D24.
//
// `habits.status` (0007) has six values: detected → confronted → watch → struck, with
// `quit_committed` reachable from any live state (cancellation takes precedence) and
// `cancelled` **reserved with no writer** (FR-18's recorded reading — it is in the CHECK
// constraint, not in this table).
//
// Descriptions are deterministic summaries (FR-13's recorded reading): the live-guard is an
// exact same-description match, so the format is effectively a key. Changing it changes the
// guard — pin it with tests.

export type HabitStatus =
  | "detected"
  | "confronted"
  | "watch"
  | "struck"
  | "quit_committed"
  | "cancelled";

export type HabitEvent = "confront" | "concession" | "quit_commitment" | "strike";

export const LIVE_STATUSES: readonly HabitStatus[] = ["detected", "confronted", "watch"];

export function isLive(status: HabitStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

export interface HabitCounts {
  impulse_failures: number;
  journal_flags: number;
}

export interface HabitThresholds {
  impulse_failures_per_week: number;
  journal_flags_per_week: number;
}

export type HabitPattern = "impulse" | "journal";

export interface SurfaceDecision {
  surface: boolean;
  pattern: HabitPattern | null;
}

/**
 * FR-13: surface when either threshold is met. Impulse wins when both fire (the recorded
 * reading: an impulse cluster routes to habit surfacing, not to a plain drift intervention).
 * Thresholds are read from `config.habit_detection_thresholds` by the caller.
 */
export function shouldSurface(
  counts: HabitCounts,
  thresholds: HabitThresholds,
): SurfaceDecision {
  if (counts.impulse_failures >= thresholds.impulse_failures_per_week) {
    return { surface: true, pattern: "impulse" };
  }
  if (counts.journal_flags >= thresholds.journal_flags_per_week) {
    return { surface: true, pattern: "journal" };
  }
  return { surface: false, pattern: null };
}

/**
 * The lifecycle table. A transition not in the table is a no-op (the current status is
 * returned), which is what makes every writer idempotent: re-running a confrontation flip or a
 * strike after a retry cannot move a terminal row.
 */
export function nextStatus(current: HabitStatus, event: HabitEvent): HabitStatus {
  if (event === "quit_commitment") {
    return isLive(current) ? "quit_committed" : current;
  }
  switch (current) {
    case "detected":
      return event === "confront" ? "confronted" : current;
    case "confronted":
      return event === "concession" ? "watch" : current;
    case "watch":
      return event === "strike" ? "struck" : current;
    default:
      // struck / quit_committed / cancelled are terminal for this table.
      return current;
  }
}

/**
 * The deterministic description stored on the row and used for the live-guard. Two shapes,
 * one per surfacing path; the window is the trailing-days value the scan used.
 */
export function buildDescription(
  pattern: HabitPattern,
  counts: HabitCounts,
  windowDays: number,
): string {
  if (pattern === "impulse") {
    return `Recurring impulse failures: ${counts.impulse_failures} in the last ${windowDays} days.`;
  }
  return `Recurring behaviour flagged in journal entries: ${counts.journal_flags} in the last ${windowDays} days.`;
}
