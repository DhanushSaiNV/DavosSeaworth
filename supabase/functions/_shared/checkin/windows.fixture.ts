// supabase/functions/_shared/checkin/windows.fixture.ts
// FP-04 — the frozen twin-grid case table (TECH-SPEC §7.1), as data.
//
// Refs: TECH-SPEC §7.1 (the frozen table: cadence 60/120 x active starts 08:00 / 05:30 / 23:00 ·
// UTC+5:30 · a DST-crossing date · hint shifts), NFR-7; FP-04 FR-1, FR-5.
//
// One fixture, two implementations: this file is imported by Step 2's server test
// (`windows.test.ts`, jest) and by Step 4's client test (`lib/checkinGrid`) — which is what
// makes NFR-7's "drift between the twins is a stop condition" mechanical instead of a promise.
// The client test imports **only this file**, never `windows.ts`: the server module uses
// Deno-style imports that jest cannot resolve.
//
// Every expectation is hand-derived from §7.1 and written out in full (labels *and* instants)
// rather than recomputed, so a wrong implementation fails instead of agreeing with itself.
// The DST cases are the load-bearing ones: `America/New_York` 2026-03-08 (the 02:00 local label
// does not exist — the clock jumps to 03:00) and 2026-11-01 (01:00 local occurs twice — the
// earlier instant wins).

import type { CadenceMinutes, Grid, WindowFailure } from "./windows.ts";

/** cadence 60 · 08:00–22:00 · UTC — the common case: 14 windows. */
const GRID_HOURLY: Grid = {
  timezone: "UTC",
  cadenceMinutes: 60,
  activeStart: "08:00",
  activeEnd: "22:00",
};

/** cadence 120 · 08:00–22:00 · UTC — 7 windows, and a close landing exactly on `activeEnd`. */
const GRID_TWO_HOURLY: Grid = {
  timezone: "UTC",
  cadenceMinutes: 120,
  activeStart: "08:00",
  activeEnd: "22:00",
};

/** cadence 60 · 05:30–08:30 · UTC — a non-integer-hour start. */
const GRID_HALF_PAST: Grid = {
  timezone: "UTC",
  cadenceMinutes: 60,
  activeStart: "05:30",
  activeEnd: "08:30",
};

/** cadence 60 · 23:00–23:59 · UTC — no window fits before 24:00, so the grid is **empty**. */
const GRID_LATE_START: Grid = {
  timezone: "UTC",
  cadenceMinutes: 60,
  activeStart: "23:00",
  activeEnd: "23:59",
};

/** cadence 60 · 08:00–22:00 · Asia/Kolkata (+05:30, no DST) — local anchoring, not epoch hours. */
const GRID_KOLKATA: Grid = {
  timezone: "Asia/Kolkata",
  cadenceMinutes: 60,
  activeStart: "08:00",
  activeEnd: "22:00",
};

/** cadence 60 · 00:00–06:00 · America/New_York — spans the spring-forward gap. */
const GRID_SPRING_FORWARD: Grid = {
  timezone: "America/New_York",
  cadenceMinutes: 60,
  activeStart: "00:00",
  activeEnd: "06:00",
};

/** cadence 60 · 00:00–04:00 · America/New_York — spans the fall-back repeat. */
const GRID_FALL_BACK: Grid = {
  timezone: "America/New_York",
  cadenceMinutes: 60,
  activeStart: "00:00",
  activeEnd: "04:00",
};

export interface DayCase {
  name: string;
  grid: Grid;
  /** An instant inside the profile-local day to generate (UTC ISO). */
  anchorUtc: string;
  /** The emitted starts as profile-local wall-clock labels, ascending. */
  expectLabels: string[];
  /** The same starts as instants — this is what pins DST behaviour. */
  expectStartsUtc: string[];
}

export interface HintCase {
  name: string;
  grid: Grid;
  nowUtc: string;
  hintUtc: string;
  expect:
    | { ok: true; windowStartUtc: string; snappedMinutes: number }
    | { ok: false; reason: WindowFailure };
}

export interface SpanCase {
  name: string;
  grid: Grid;
  fromUtc: string;
  toUtc: string;
  expectStartsUtc: string[];
}

const hourlyStarts = [
  "2026-10-17T08:00:00.000Z",
  "2026-10-17T09:00:00.000Z",
  "2026-10-17T10:00:00.000Z",
  "2026-10-17T11:00:00.000Z",
  "2026-10-17T12:00:00.000Z",
  "2026-10-17T13:00:00.000Z",
  "2026-10-17T14:00:00.000Z",
  "2026-10-17T15:00:00.000Z",
  "2026-10-17T16:00:00.000Z",
  "2026-10-17T17:00:00.000Z",
  "2026-10-17T18:00:00.000Z",
  "2026-10-17T19:00:00.000Z",
  "2026-10-17T20:00:00.000Z",
  "2026-10-17T21:00:00.000Z",
];

const hourlyLabels = [
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
  "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00",
];

/** 08:00 local in +05:30 is 02:30 UTC. */
const kolkataStarts = hourlyLabels.map(
  (label) => `2026-10-17T${String(Number(label.slice(0, 2)) - 6).padStart(2, "0")}:30:00.000Z`,
);

export const WINDOW_DAYS: DayCase[] = [
  {
    name: "cadence 60 · 08:00-22:00 · UTC — 14 windows, last closes exactly on activeEnd",
    grid: GRID_HOURLY,
    anchorUtc: "2026-10-17T12:00:00.000Z",
    expectLabels: hourlyLabels,
    expectStartsUtc: hourlyStarts,
  },
  {
    name: "cadence 120 · 08:00-22:00 · UTC — 7 windows, 20:00 closes exactly on activeEnd",
    grid: GRID_TWO_HOURLY,
    anchorUtc: "2026-10-17T12:00:00.000Z",
    expectLabels: ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"],
    expectStartsUtc: [
      "2026-10-17T08:00:00.000Z",
      "2026-10-17T10:00:00.000Z",
      "2026-10-17T12:00:00.000Z",
      "2026-10-17T14:00:00.000Z",
      "2026-10-17T16:00:00.000Z",
      "2026-10-17T18:00:00.000Z",
      "2026-10-17T20:00:00.000Z",
    ],
  },
  {
    name: "cadence 60 · 05:30-08:30 · UTC — a half-hour start (3 windows)",
    grid: GRID_HALF_PAST,
    anchorUtc: "2026-10-17T06:00:00.000Z",
    expectLabels: ["05:30", "06:30", "07:30"],
    expectStartsUtc: [
      "2026-10-17T05:30:00.000Z",
      "2026-10-17T06:30:00.000Z",
      "2026-10-17T07:30:00.000Z",
    ],
  },
  {
    name: "cadence 60 · 23:00-23:59 · UTC — the empty grid (23:00 + 60 > 23:59)",
    grid: GRID_LATE_START,
    anchorUtc: "2026-10-17T12:00:00.000Z",
    expectLabels: [],
    expectStartsUtc: [],
  },
  {
    name: "cadence 60 · 08:00-22:00 · Asia/Kolkata — 08:00 local is 02:30 UTC (not an epoch hour)",
    grid: GRID_KOLKATA,
    anchorUtc: "2026-10-17T12:00:00.000Z",
    expectLabels: hourlyLabels,
    expectStartsUtc: kolkataStarts,
  },
  {
    name: "spring forward · 2026-03-08 · America/New_York — the 02:00 label is skipped",
    grid: GRID_SPRING_FORWARD,
    anchorUtc: "2026-03-08T12:00:00.000Z",
    expectLabels: ["00:00", "01:00", "03:00", "04:00", "05:00"],
    expectStartsUtc: [
      "2026-03-08T05:00:00.000Z", // 00:00 EST (-05:00)
      "2026-03-08T06:00:00.000Z", // 01:00 EST
      "2026-03-08T07:00:00.000Z", // 03:00 EDT (-04:00) — 02:00 never happens
      "2026-03-08T08:00:00.000Z", // 04:00 EDT
      "2026-03-08T09:00:00.000Z", // 05:00 EDT
    ],
  },
  {
    name: "fall back · 2026-11-01 · America/New_York — 01:00 local repeats; the earlier instant wins",
    grid: GRID_FALL_BACK,
    anchorUtc: "2026-11-01T12:00:00.000Z",
    expectLabels: ["00:00", "01:00", "02:00", "03:00"],
    expectStartsUtc: [
      "2026-11-01T04:00:00.000Z", // 00:00 EDT (-04:00)
      "2026-11-01T05:00:00.000Z", // 01:00 EDT — the first of the two
      "2026-11-01T07:00:00.000Z", // 02:00 EST (-05:00) — two real hours later
      "2026-11-01T08:00:00.000Z", // 03:00 EST
    ],
  },
];

export const WINDOW_HINTS: HintCase[] = [
  {
    name: "exact window start → itself, zero snap",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T10:05:00.000Z",
    hintUtc: "2026-10-17T10:00:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-10-17T10:00:00.000Z", snappedMinutes: 0 },
  },
  {
    name: "+5 min shift snaps back onto the same window",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T10:10:00.000Z",
    hintUtc: "2026-10-17T10:05:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-10-17T10:00:00.000Z", snappedMinutes: -5 },
  },
  {
    name: "-5 min shift snaps forward onto the same window",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T10:20:00.000Z",
    hintUtc: "2026-10-17T09:55:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-10-17T10:00:00.000Z", snappedMinutes: 5 },
  },
  {
    name: "exactly cadence/2 is inside the tolerance, and a tie takes the earlier start",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T10:45:00.000Z",
    hintUtc: "2026-10-17T10:30:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-10-17T10:00:00.000Z", snappedMinutes: -30 },
  },
  {
    name: "the currently-open window (close still in the future) is accepted",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T10:15:00.000Z",
    hintUtc: "2026-10-17T10:00:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-10-17T10:00:00.000Z", snappedMinutes: 0 },
  },
  {
    name: "a hint in the future is rejected",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T09:00:00.000Z",
    hintUtc: "2026-10-17T11:00:00.000Z",
    expect: { ok: false, reason: "window_future" },
  },
  {
    name: "a hint older than the trailing 24 h is stale",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-18T12:00:00.000Z",
    hintUtc: "2026-10-17T09:00:00.000Z",
    expect: { ok: false, reason: "window_stale" },
  },
  {
    name: "a hint that snaps onto a window more than 24 h old is stale after the snap",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-18T08:10:00.000Z",
    hintUtc: "2026-10-17T08:20:00.000Z",
    expect: { ok: false, reason: "window_stale" },
  },
  {
    name: "a hint before the active hours is off-grid",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T12:00:00.000Z",
    hintUtc: "2026-10-17T03:00:00.000Z",
    expect: { ok: false, reason: "window_off_grid" },
  },
  {
    name: "a hint after the last window (22:00 close) is off-grid",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T22:30:00.000Z",
    hintUtc: "2026-10-17T21:45:00.000Z",
    expect: { ok: false, reason: "window_off_grid" },
  },
  {
    name: "a hint whose nearest start is still in the future is rejected",
    grid: GRID_HOURLY,
    nowUtc: "2026-10-17T10:31:00.000Z",
    hintUtc: "2026-10-17T10:31:00.000Z",
    expect: { ok: false, reason: "window_future" },
  },
  {
    name: "the empty grid has nothing to snap to",
    grid: GRID_LATE_START,
    nowUtc: "2026-10-17T23:30:00.000Z",
    hintUtc: "2026-10-17T23:00:00.000Z",
    expect: { ok: false, reason: "window_off_grid" },
  },
  {
    name: "a DST-day hint resolves to the emitted window across the skipped hour",
    grid: GRID_SPRING_FORWARD,
    nowUtc: "2026-03-08T07:30:00.000Z",
    hintUtc: "2026-03-08T07:00:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-03-08T07:00:00.000Z", snappedMinutes: 0 },
  },
  {
    name: "cadence 120 · a 60-minute shift is inside tolerance and snaps to the earlier window start",
    grid: GRID_TWO_HOURLY,
    nowUtc: "2026-10-17T11:00:00.000Z",
    hintUtc: "2026-10-17T10:00:00.000Z",
    expect: { ok: true, windowStartUtc: "2026-10-17T10:00:00.000Z", snappedMinutes: 0 },
  },
];

export const WINDOW_SPANS: SpanCase[] = [
  {
    name: "closes in (09:30, 12:05] — three windows",
    grid: GRID_HOURLY,
    fromUtc: "2026-10-17T09:30:00.000Z",
    toUtc: "2026-10-17T12:05:00.000Z",
    expectStartsUtc: [
      "2026-10-17T09:00:00.000Z",
      "2026-10-17T10:00:00.000Z",
      "2026-10-17T11:00:00.000Z",
    ],
  },
  {
    name: "the bounds are half-open: a close exactly at `from` is excluded, at `to` included",
    grid: GRID_HOURLY,
    fromUtc: "2026-10-17T10:00:00.000Z",
    toUtc: "2026-10-17T11:00:00.000Z",
    expectStartsUtc: ["2026-10-17T10:00:00.000Z"],
  },
];

export interface FixtureGrids {
  hourly: Grid;
  twoHourly: Grid;
  halfPast: Grid;
  lateStart: Grid;
  kolkata: Grid;
  springForward: Grid;
  fallBack: Grid;
}

/** The named grids, so a test can assert grid-level facts (cadence typing, local anchoring). */
export const FIXTURE_GRIDS: FixtureGrids = {
  hourly: GRID_HOURLY,
  twoHourly: GRID_TWO_HOURLY,
  halfPast: GRID_HALF_PAST,
  lateStart: GRID_LATE_START,
  kolkata: GRID_KOLKATA,
  springForward: GRID_SPRING_FORWARD,
  fallBack: GRID_FALL_BACK,
};

/** Exported for the gate's static read: the cadences the table actually exercises. */
export const FIXTURE_CADENCES: CadenceMinutes[] = [60, 120];
