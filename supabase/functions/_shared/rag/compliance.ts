// supabase/functions/_shared/rag/compliance.ts
// P2 — check-in compliance: the frozen grid, in TypeScript, over `list_answered_windows`.
//
// Refs: PRD §6.1 (`checkin_compliance`), §7.3 (derived metric), §14.1 B3/B4/B5;
// PLAN.md §1.1 (the defect: no SQL function counts scheduled windows), §8.1 (the flow),
// §8.2 (denominator clamp and zero denominator), §8.3 (the preserved limitation).
//
// `series_checkin_compliance` was deleted from the plan. No SQL function counts scheduled
// windows, because the schedule is a rule the database does not store as history: the grid lives
// in `_shared/checkin/windows.ts` and is evaluated here, once per requested local day. This file
// therefore owns exactly two things — the denominator (`scheduled`) and the honest numerator
// (`answered`, matched on `checkin_window`, never on `logged_at`).
//
// Pure by design (the `windows.ts` precedent): the two RPC reads happen in `dispatch.ts`.

import {
  isValidTimeZone,
  localWallToUtcMs,
  parseClock,
  windowsForLocalDay,
  type CadenceMinutes,
  type Grid,
} from "../checkin/windows.ts";

const DAY_MS = 86_400_000;

export const COMPLIANCE_LIMITATION =
  "compliance uses the current check-in schedule; earlier schedule changes cannot be reconstructed";

/** The allowlisted `read_schedule_profile` row (0044:92). Only four columns build the grid. */
export interface ScheduleProfileRow {
  timezone: string | null;
  checkin_cadence_minutes: number | null;
  checkin_active_hours_start: string | null;
  checkin_active_hours_end: string | null;
  profile_created_at: string | null;
}

/** One `list_answered_windows` row (0044:166). Starts are timestamptz strings. */
export interface AnsweredWindowRow {
  local_day: string;
  answered_count: number | null;
  answered_starts: string[] | null;
}

export interface ComplianceDay {
  local_day: string;
  answered: number;
  scheduled: number;
  /** `answered / scheduled`, or null when no window closed that day (§8.2 — never 0, never NaN). */
  rate: number | null;
  /** `answered × cadence / 60`. Schedule-estimated, not measured (PRD B5). */
  hours_logged: number;
  unmatched_answered_windows: number;
  compliance_state: "ok" | "no_scheduled_windows";
}

export interface ComplianceResult {
  timezone: string;
  created_day: string | null;
  days: ComplianceDay[];
  totals: {
    days: number;
    answered: number;
    scheduled: number;
    rate: number | null;
    hours_logged: number;
    days_excluded_zero_scheduled: number;
    unmatched_answered_windows: number;
  };
  limitations: string[];
}

export type ComplianceGrid =
  | { ok: true; grid: Grid; createdDay: string | null }
  | { ok: false; reason: "timezone_unavailable" | "grid_unavailable" };

// ---------------------------------------------------------------------------- date arithmetic
//
// Calendar dates only: `'YYYY-MM-DD'` strings are converted to a UTC midnight and back, so DST
// never enters the arithmetic. The zone enters only where a *wall clock* is needed.

function parseDate(value: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function formatDate(y: number, mo: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dateMs(value: string): number | null {
  const p = parseDate(value);
  if (!p) return null;
  return Date.UTC(p.y, p.mo - 1, p.d);
}

function addDays(value: string, days: number): string {
  const ms = dateMs(value);
  if (ms === null) return value;
  const next = new Date(ms + days * DAY_MS);
  return formatDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function daysInclusive(from: string, to: string): number {
  const a = dateMs(from);
  const b = dateMs(to);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

/** ISO day of week, 1 (Monday) .. 7 (Sunday) — the `weekday` key format of 0046:265. */
function isoDow(value: string): number {
  const ms = dateMs(value);
  if (ms === null) return 0;
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/** Monday of the ISO week containing `value` — `date_trunc('week', …)::date`. */
function mondayOf(value: string): string {
  return addDays(value, -(isoDow(value) - 1));
}

/** `'YYYY-MM-DD'` of an instant in a zone. */
function localDateInZone(iso: string | null, timezone: string): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const mo = Number(get("month"));
    const d = Number(get("day"));
    if (!y || !mo || !d) return null;
    return formatDate(y, mo, d);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------- grid

/**
 * The four grid columns, or the typed refusal. A bogus zone is `timezone_unavailable` (the same
 * token the SQL raises, PLAN.md §9.1); a cadence or active-hours value the grid cannot express is
 * `grid_unavailable` — never a silently empty schedule.
 */
export function gridFromProfile(row: ScheduleProfileRow): ComplianceGrid {
  const timezone = row.timezone ?? "UTC";
  if (!isValidTimeZone(timezone)) return { ok: false, reason: "timezone_unavailable" };

  const cadence = row.checkin_cadence_minutes;
  if (cadence !== 60 && cadence !== 120) return { ok: false, reason: "grid_unavailable" };

  const activeStart = row.checkin_active_hours_start;
  const activeEnd = row.checkin_active_hours_end;
  if (activeStart === null || activeEnd === null) return { ok: false, reason: "grid_unavailable" };
  if (parseClock(activeStart) === null || parseClock(activeEnd) === null) {
    return { ok: false, reason: "grid_unavailable" };
  }

  return {
    ok: true,
    grid: {
      timezone,
      cadenceMinutes: cadence as CadenceMinutes,
      activeStart,
      activeEnd,
    },
    createdDay: localDateInZone(row.profile_created_at, timezone),
  };
}

// ---------------------------------------------------------------------------- the flow

export interface ComplianceInput {
  profile: ScheduleProfileRow;
  answered: readonly AnsweredWindowRow[];
  from: string;
  to: string;
  /** Server clock, ms. Never the client's, never the model's (PLAN.md §8.1). */
  nowMs: number;
}

export type ComplianceComputation =
  | { ok: true; result: ComplianceResult }
  | { ok: false; reason: "timezone_unavailable" | "grid_unavailable" };

/**
 * PLAN.md §8.1, line by line. Days before `profile_created_at` are not emitted at all (they are
 * `no_data`, not `0 %`), and a day whose grid emits nothing is emitted with `rate = null`.
 */
export function computeCompliance(input: ComplianceInput): ComplianceComputation {
  const built = gridFromProfile(input.profile);
  if (!built.ok) return { ok: false, reason: built.reason };

  const { grid, createdDay } = built;
  const { timezone } = grid;

  const today = localDateInZone(new Date(input.nowMs).toISOString(), timezone);
  if (today === null) return { ok: false, reason: "timezone_unavailable" };

  // The denominator clamp (§8.2): never before the profile existed, never after today.
  const start = createdDay !== null && createdDay > input.from ? createdDay : input.from;
  const end = input.to < today ? input.to : today;

  const answeredByDay = new Map<string, { count: number; starts: number[] }>();
  for (const row of input.answered) {
    const starts = (row.answered_starts ?? [])
      .map((s) => Date.parse(s))
      .filter((ms) => Number.isFinite(ms));
    const count = starts.length > 0 ? starts.length : row.answered_count ?? 0;
    const existing = answeredByDay.get(row.local_day);
    if (existing) {
      existing.count += count;
      existing.starts.push(...starts);
    } else {
      answeredByDay.set(row.local_day, { count, starts });
    }
  }

  const days: ComplianceDay[] = [];
  const total = daysInclusive(start, end);
  for (let i = 0; i < total; i += 1) {
    const day = addDays(start, i);
    const parts = parseDate(day);
    if (parts === null) continue;
    // Noon local avoids the DST-midnight ambiguity (§8.1).
    const anchor = localWallToUtcMs(timezone, parts.y, parts.mo, parts.d, 12, 0);
    if (anchor === null) continue;

    const scheduled = windowsForLocalDay(grid, anchor).filter((w) => w.closeMs <= input.nowMs);
    const answeredToday = answeredByDay.get(day);
    let answered = 0;
    let unmatched = 0;
    if (answeredToday) {
      for (const startMs of answeredToday.starts) {
        if (scheduled.some((w) => w.startMs === startMs)) answered += 1;
        else unmatched += 1;
      }
      // A count without starts cannot be matched; it is unmatched, never assumed on-grid.
      unmatched += Math.max(0, answeredToday.count - answeredToday.starts.length);
    }

    days.push({
      local_day: day,
      answered,
      scheduled: scheduled.length,
      rate: scheduled.length === 0 ? null : answered / scheduled.length,
      hours_logged: (answered * grid.cadenceMinutes) / 60,
      unmatched_answered_windows: unmatched,
      compliance_state: scheduled.length === 0 ? "no_scheduled_windows" : "ok",
    });
  }

  const answeredTotal = days.reduce((sum, d) => sum + d.answered, 0);
  const scheduledTotal = days.reduce((sum, d) => sum + d.scheduled, 0);
  const hoursTotal = days.reduce((sum, d) => sum + d.hours_logged, 0);
  const unmatchedTotal = days.reduce((sum, d) => sum + d.unmatched_answered_windows, 0);
  const zeroScheduled = days.filter((d) => d.scheduled === 0).length;

  const limitations = [COMPLIANCE_LIMITATION];
  if (unmatchedTotal > 0) {
    limitations.push(
      "some answered windows do not match the current schedule; they are reported but excluded from the numerator",
    );
  }

  return {
    ok: true,
    result: {
      timezone,
      created_day: createdDay,
      days,
      totals: {
        days: days.length,
        answered: answeredTotal,
        scheduled: scheduledTotal,
        rate: scheduledTotal === 0 ? null : answeredTotal / scheduledTotal,
        hours_logged: hoursTotal,
        days_excluded_zero_scheduled: zeroScheduled,
        unmatched_answered_windows: unmatchedTotal,
      },
      limitations,
    },
  };
}

// ---------------------------------------------------------------------------- row shaping

export type ComplianceRow = Record<string, unknown>;

function dayRow(day: ComplianceDay): ComplianceRow {
  return {
    local_day: day.local_day,
    answered: day.answered,
    scheduled: day.scheduled,
    rate: day.rate,
    hours_logged: day.hours_logged,
    unmatched_answered_windows: day.unmatched_answered_windows,
    compliance_state: day.compliance_state,
  };
}

function groupDays(
  days: readonly ComplianceDay[],
  keyOf: (day: ComplianceDay) => string,
): ComplianceRow[] {
  const groups = new Map<string, ComplianceDay[]>();
  for (const day of days) {
    const key = keyOf(day);
    const bucket = groups.get(key);
    if (bucket) bucket.push(day);
    else groups.set(key, [day]);
  }
  const rows: ComplianceRow[] = [];
  for (const [key, group] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const answered = group.reduce((sum, d) => sum + d.answered, 0);
    const scheduled = group.reduce((sum, d) => sum + d.scheduled, 0);
    rows.push({
      key,
      days: group.length,
      answered,
      scheduled,
      rate: scheduled === 0 ? null : answered / scheduled,
      hours_logged: group.reduce((sum, d) => sum + d.hours_logged, 0),
      unmatched_answered_windows: group.reduce((sum, d) => sum + d.unmatched_answered_windows, 0),
    });
  }
  return rows;
}

/**
 * Rows for one compliance block. `timeseries` emits one row per day (or ISO week); `aggregate`
 * emits the range totals, or one facet row per dimension value — the same facet-list shape every
 * SQL `aggregate` returns (one row per dimension+value, never a cross-tab).
 */
export function complianceRows(
  result: ComplianceResult,
  op: "aggregate" | "timeseries",
  bucket: string | null | undefined,
  dimensions: readonly string[] | null | undefined,
): ComplianceRow[] {
  if (op === "timeseries") {
    if (bucket === "week") {
      return groupDays(result.days, (day) => mondayOf(day.local_day)).map((row) => ({
        week_start: row.key,
        days: row.days,
        answered: row.answered,
        scheduled: row.scheduled,
        rate: row.rate,
        hours_logged: row.hours_logged,
        unmatched_answered_windows: row.unmatched_answered_windows,
      }));
    }
    return result.days.map(dayRow);
  }

  const dims = dimensions ?? [];
  if (dims.length === 0) {
    return [
      {
        days: result.totals.days,
        answered: result.totals.answered,
        scheduled: result.totals.scheduled,
        rate: result.totals.rate,
        hours_logged: result.totals.hours_logged,
        days_excluded_zero_scheduled: result.totals.days_excluded_zero_scheduled,
        unmatched_answered_windows: result.totals.unmatched_answered_windows,
      },
    ];
  }

  const rows: ComplianceRow[] = [];
  for (const dim of dims) {
    const keyOf =
      dim === "week"
        ? (day: ComplianceDay) => mondayOf(day.local_day)
        : dim === "weekday"
          ? (day: ComplianceDay) => String(isoDow(day.local_day))
          : (day: ComplianceDay) => day.local_day;
    for (const row of groupDays(result.days, keyOf)) {
      rows.push({ dimension: dim, ...row });
    }
  }
  return rows;
}
