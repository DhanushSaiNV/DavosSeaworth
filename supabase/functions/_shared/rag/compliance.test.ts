// supabase/functions/_shared/rag/compliance.test.ts
// T10 — compliance uses the canonical grid: the denominator is `windowsForLocalDay` alone,
// `checkin_window` (not `logged_at`) decides the day, `hours_logged = answered × cadence / 60`,
// and a zero denominator is `null`, never `0` or `NaN`.
//
// Refs: PRD §6.1, §14.1 B3/B4/B5; PLAN.md §8.1-§8.3.

import {
  COMPLIANCE_LIMITATION,
  complianceRows,
  computeCompliance,
  gridFromProfile,
  type AnsweredWindowRow,
  type ScheduleProfileRow,
} from "./compliance.ts";
import { localWallToUtcMs, windowsForLocalDay } from "../checkin/windows.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toContain(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeCloseTo(expected: number, digits?: number): void;
  toMatchObject(expected: Record<string, unknown>): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const TZ = "America/New_York";

function profile(overrides: Partial<ScheduleProfileRow> = {}): ScheduleProfileRow {
  return {
    timezone: TZ,
    checkin_cadence_minutes: 60,
    checkin_active_hours_start: "08:00:00",
    checkin_active_hours_end: "12:00:00",
    profile_created_at: null,
    ...overrides,
  };
}

/** 2026-06-15 16:00 local (EDT, UTC-4). */
const NOW_MS = Date.parse("2026-06-15T20:00:00Z");

function answered(localDay: string, starts: string[]): AnsweredWindowRow {
  return { local_day: localDay, answered_count: starts.length, answered_starts: starts };
}

describe("gridFromProfile", () => {
  it("builds the four-column grid", () => {
    const built = gridFromProfile(profile());
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.grid).toEqual({
        timezone: TZ,
        cadenceMinutes: 60,
        activeStart: "08:00:00",
        activeEnd: "12:00:00",
      });
      expect(built.createdDay).toBeNull();
    }
  });

  it("fails with timezone_unavailable for a zone the runtime cannot parse", () => {
    const built = gridFromProfile(profile({ timezone: "Mars/Olympus_Mons" }));
    expect(built).toEqual({ ok: false, reason: "timezone_unavailable" });
  });

  it("fails with grid_unavailable for a cadence the grid cannot express", () => {
    expect(gridFromProfile(profile({ checkin_cadence_minutes: 90 }))).toEqual({
      ok: false,
      reason: "grid_unavailable",
    });
    expect(gridFromProfile(profile({ checkin_cadence_minutes: null }))).toEqual({
      ok: false,
      reason: "grid_unavailable",
    });
  });

  it("fails with grid_unavailable for missing or malformed active hours", () => {
    expect(gridFromProfile(profile({ checkin_active_hours_start: null }))).toEqual({
      ok: false,
      reason: "grid_unavailable",
    });
    expect(gridFromProfile(profile({ checkin_active_hours_end: "25:00" }))).toEqual({
      ok: false,
      reason: "grid_unavailable",
    });
  });
});

describe("computeCompliance — the §8.1 flow", () => {
  it("uses the frozen grid for the denominator, one call per requested day", () => {
    const built = gridFromProfile(profile());
    if (!built.ok) throw new Error("grid");
    const result = computeCompliance({
      profile: profile(),
      answered: [],
      from: "2026-06-13",
      to: "2026-06-15",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);

    expect(result.result.days.map((day) => day.local_day)).toEqual([
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
    ]);
    for (const day of result.result.days) {
      const [y, mo, d] = day.local_day.split("-").map(Number);
      const noon = localWallToUtcMs(TZ, y, mo, d, 12, 0);
      if (noon === null) throw new Error("noon");
      const windows = windowsForLocalDay(built.grid, noon);
      expect(day.scheduled).toBe(windows.length);
      expect(day.scheduled).toBe(4);
    }
    expect(result.result.totals.scheduled).toBe(12);
  });

  it("matches answered starts on checkin_window, not on any receipt time", () => {
    const result = computeCompliance({
      profile: profile(),
      // 08:00 and 10:00 local on 2026-06-14 (EDT = UTC-4).
      answered: [answered("2026-06-14", ["2026-06-14T12:00:00Z", "2026-06-14T14:00:00Z"])],
      from: "2026-06-13",
      to: "2026-06-15",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);

    const day = result.result.days.find((item) => item.local_day === "2026-06-14");
    expect(day?.answered).toBe(2);
    expect(day?.rate).toBe(0.5);
    expect(day?.hours_logged).toBe(2);
    expect(day?.unmatched_answered_windows).toBe(0);
    expect(result.result.totals.rate).toBeCloseTo(2 / 12, 10);
  });

  it("reports an off-grid answered window as unmatched and excludes it from the numerator", () => {
    const result = computeCompliance({
      profile: profile(),
      // 12:30 local is not an emitted start.
      answered: [answered("2026-06-14", ["2026-06-14T16:30:00Z"])],
      from: "2026-06-14",
      to: "2026-06-14",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);

    expect(result.result.days[0].answered).toBe(0);
    expect(result.result.days[0].unmatched_answered_windows).toBe(1);
    expect(result.result.totals.unmatched_answered_windows).toBe(1);
    expect(
      result.result.limitations.some((line) => line.includes("do not match the current schedule")),
    ).toBe(true);
  });

  it("never assumes a count without starts is on-grid", () => {
    const result = computeCompliance({
      profile: profile(),
      answered: [{ local_day: "2026-06-14", answered_count: 2, answered_starts: null }],
      from: "2026-06-14",
      to: "2026-06-14",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.result.days[0].answered).toBe(0);
    expect(result.result.days[0].unmatched_answered_windows).toBe(2);
  });

  it("excludes windows that have not closed yet", () => {
    // 09:30 local: the 08:00 window closed at 09:00, the 09:00 window closes at 10:00.
    const result = computeCompliance({
      profile: profile(),
      answered: [],
      from: "2026-06-15",
      to: "2026-06-15",
      nowMs: Date.parse("2026-06-15T13:30:00Z"),
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.result.days[0].scheduled).toBe(1);
  });

  it("gives a zero denominator rate = null and counts the excluded day (§8.2)", () => {
    const result = computeCompliance({
      profile: profile({ checkin_active_hours_start: "08:00:00", checkin_active_hours_end: "08:00:00" }),
      answered: [],
      from: "2026-06-14",
      to: "2026-06-15",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);

    for (const day of result.result.days) {
      expect(day.scheduled).toBe(0);
      expect(day.rate).toBeNull();
      expect(day.compliance_state).toBe("no_scheduled_windows");
    }
    expect(result.result.totals.rate).toBeNull();
    expect(result.result.totals.days_excluded_zero_scheduled).toBe(2);
  });

  it("clamps the range at today and at profile creation (§8.2)", () => {
    const result = computeCompliance({
      profile: profile({ profile_created_at: "2026-06-14T12:00:00Z" }),
      answered: [],
      from: "2026-06-10",
      to: "2026-06-20",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);

    expect(result.result.created_day).toBe("2026-06-14");
    expect(result.result.days.map((day) => day.local_day)).toEqual([
      "2026-06-14",
      "2026-06-15",
    ]);
  });

  it("emits no days when the range is entirely before creation", () => {
    const result = computeCompliance({
      profile: profile({ profile_created_at: "2026-06-14T12:00:00Z" }),
      answered: [],
      from: "2026-06-01",
      to: "2026-06-05",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.result.days).toEqual([]);
    expect(result.result.totals.rate).toBeNull();
  });

  it("scales hours_logged by cadence / 60", () => {
    const result = computeCompliance({
      profile: profile({ checkin_cadence_minutes: 120 }),
      answered: [answered("2026-06-14", ["2026-06-14T12:00:00Z", "2026-06-14T14:00:00Z"])],
      from: "2026-06-14",
      to: "2026-06-14",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.result.days[0].scheduled).toBe(2);
    expect(result.result.days[0].answered).toBe(2);
    expect(result.result.days[0].hours_logged).toBe(4);
  });

  it("always carries the schedule-history limitation (§8.3)", () => {
    const result = computeCompliance({
      profile: profile(),
      answered: [],
      from: "2026-06-14",
      to: "2026-06-14",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.result.limitations).toContain(COMPLIANCE_LIMITATION);
  });

  it("surfaces the grid failure instead of an empty schedule", () => {
    const result = computeCompliance({
      profile: profile({ timezone: "Mars/Olympus_Mons" }),
      answered: [],
      from: "2026-06-14",
      to: "2026-06-14",
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: "timezone_unavailable" });
  });
});

describe("complianceRows — timeseries and the facet list", () => {
  function resultOf() {
    const result = computeCompliance({
      profile: profile(),
      answered: [answered("2026-06-14", ["2026-06-14T12:00:00Z"])],
      from: "2026-06-13",
      to: "2026-06-15",
      nowMs: NOW_MS,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.result;
  }

  it("emits one row per local day for a day timeseries", () => {
    const rows = complianceRows(resultOf(), "timeseries", "day", null);
    expect(rows.length).toBe(3);
    expect(rows[0].local_day).toBe("2026-06-13");
    expect(rows[1]).toMatchObject({ answered: 1, scheduled: 4, rate: 0.25 });
  });

  it("groups by ISO week for a week timeseries", () => {
    const rows = complianceRows(resultOf(), "timeseries", "week", null);
    expect(rows.length).toBe(2);
    expect(rows[0].week_start).toBe("2026-06-08");
    expect(rows[0].days).toBe(2);
    expect(rows[0].scheduled).toBe(8);
    expect(rows[1].week_start).toBe("2026-06-15");
  });

  it("emits range totals for an aggregate without dimensions", () => {
    const rows = complianceRows(resultOf(), "aggregate", null, null);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ days: 3, answered: 1, scheduled: 12 });
    expect(rows[0].rate).toBeCloseTo(1 / 12, 10);
  });

  it("emits a facet list, one row per dimension+value, with the SQL key formats", () => {
    const rows = complianceRows(resultOf(), "aggregate", null, ["weekday"]);
    expect(rows.map((row) => row.key)).toEqual(["1", "6", "7"]);
    for (const row of rows) expect(row.dimension).toBe("weekday");

    const weeks = complianceRows(resultOf(), "aggregate", null, ["week"]);
    expect(weeks.map((row) => row.key)).toEqual(["2026-06-08", "2026-06-15"]);
  });
});
