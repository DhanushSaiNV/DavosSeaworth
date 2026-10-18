// lib/checkinSettings.ts
// FP-04 Step 7 — pure settings logic for the check-in loop: the cadence/hour option model, the
// active-hours clock math, the client mirror of the RPC's validation, and the RPC argument shape.
//
// Refs: FP-04 FR-17, FR-1; TECH-SPEC §7.1, §9; §3.2 + migration 0026 (the `update_checkin_prefs`
// contract); D9.
// Pure by design — the only value import is the grid's `parseClock` — so jest loads it exactly
// like `checkinGrid.ts` / `checkinUi.ts`, with the side-effectful wiring left in `lib/checkins.ts`
// and the screen. `60 | 120` is the column CHECK and the RPC's own enum, so it is correctly a
// schema constant here, not a `[SPEC]` value read from `config` (AGENTS.md §9).

import { parseClock, type CadenceMinutes, type Grid } from './checkinGrid';

/** The only allowed cadences (`profiles.checkin_cadence_minutes` CHECK, mirroring the RPC guard). */
export const CADENCE_OPTIONS: readonly CadenceMinutes[] = [60, 120];

/** Active-hours boundaries move in half-hour steps (the frozen fixture's 05:30 start is reachable). */
export const ACTIVE_HOURS_STEP_MINUTES = 30;

export interface CheckinPrefs {
  cadenceMinutes: CadenceMinutes;
  /** Profile-local wall clock, always normalized to `'HH:MM'`. */
  activeStart: string;
  activeEnd: string;
}

/** The client-side reasons, named after the RPC's own guards so the mirror is auditable. */
export type CheckinPrefsFailure = 'cadence_invalid' | 'hours_malformed' | 'hours_order';

export type CheckinPrefsValidation = { ok: true } | { ok: false; reason: CheckinPrefsFailure };

export function cadenceLabel(cadence: CadenceMinutes): string {
  return cadence === 60 ? 'Hourly' : 'Every 2 hours';
}

/** `'HH:MM'` from minutes since local midnight, clamped into the day. */
export function formatClockLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Move a wall-clock label by `deltaMinutes`, clamped to the same day. Deliberately no wrap: the
 * RPC requires `start < end` (the grid contract has no overnight windows), so a stepper that
 * wrapped past midnight could only ever produce a value the server rejects. A malformed input is
 * returned unchanged rather than repaired.
 */
export function shiftClock(value: string, deltaMinutes: number): string {
  const minutes = parseClock(value);
  if (minutes === null) return value;
  return formatClockLabel(minutes + deltaMinutes);
}

/** The four-column read normalized into the form's shape, or null when the row is malformed. */
export function prefsFromGrid(grid: Grid): CheckinPrefs | null {
  const start = parseClock(grid.activeStart);
  const end = parseClock(grid.activeEnd);
  if (start === null || end === null) return null;
  return {
    cadenceMinutes: grid.cadenceMinutes,
    activeStart: formatClockLabel(start),
    activeEnd: formatClockLabel(end),
  };
}

/** The inverse of `prefsFromGrid` — the grid the scheduler would arm for these prefs. */
export function gridFromPrefs(prefs: CheckinPrefs, timezone: string): Grid {
  return {
    timezone,
    cadenceMinutes: prefs.cadenceMinutes,
    activeStart: prefs.activeStart,
    activeEnd: prefs.activeEnd,
  };
}

/**
 * The client mirror of `update_checkin_prefs`'s guards (migration 0026: `p_cadence in (60,120)`,
 * `p_start < p_end`). The timezone is deliberately **not** re-validated here — the scheduler
 * (`maybeSyncTimezone`) is its only writer and the screen passes the loaded zone straight back.
 * The server stays the enforcement point; this mirror exists so the form can refuse a bad value
 * without a round-trip.
 */
export function validateCheckinPrefs(prefs: CheckinPrefs): CheckinPrefsValidation {
  if (prefs.cadenceMinutes !== 60 && prefs.cadenceMinutes !== 120) {
    return { ok: false, reason: 'cadence_invalid' };
  }
  const start = parseClock(prefs.activeStart);
  const end = parseClock(prefs.activeEnd);
  if (start === null || end === null) return { ok: false, reason: 'hours_malformed' };
  if (start >= end) return { ok: false, reason: 'hours_order' };
  return { ok: true };
}

/** The RPC's exact wire shape — the four `update_checkin_prefs` parameters. */
export function prefsToRpcArgs(prefs: CheckinPrefs, timezone: string): {
  p_cadence: CadenceMinutes;
  p_start: string;
  p_end: string;
  p_tz: string;
} {
  return {
    p_cadence: prefs.cadenceMinutes,
    p_start: prefs.activeStart,
    p_end: prefs.activeEnd,
    p_tz: timezone,
  };
}
