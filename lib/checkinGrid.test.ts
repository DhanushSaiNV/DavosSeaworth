// lib/checkinGrid.test.ts
// FP-04 Step 4 — jest suite for the client grid.
//
// Refs: FP-04 FR-1, FR-2, FR-3, FR-5, NFR-7; TECH-SPEC §7.1 (the frozen grid contract); D9.
//
// The frozen case table is **one** shared fixture — `_shared/checkin/windows.fixture.ts`, also
// imported by the Step 2 server suite. That is what makes NFR-7's "drift between the twins is a
// stop condition" mechanical rather than a promise. Per §7.1 the client test imports **only the
// fixture**, never `windows.ts`.

import {
  parseClock,
  isValidTimeZone,
  utcToLocalLabel,
  localWallToUtcMs,
  windowsForLocalDay,
  rollingWindows,
  canonicalizeWindow,
  windowsClosedBetween,
  devNotifyTarget,
  type Grid,
} from "./checkinGrid";
import {
  WINDOW_DAYS,
  WINDOW_HINTS,
  WINDOW_SPANS,
  FIXTURE_GRIDS,
} from "../supabase/functions/_shared/checkin/windows.fixture";

const USER = "u1";

describe("parseClock", () => {
  test.each([
    ["08:00", 480],
    ["08:00:00", 480],
    ["23:59", 1439],
    ["00:00", 0],
    ["5:30", 330],
    ["  08:00  ", 480],
    ["24:00", null],
    ["08:60", null],
    ["08:00:60", null],
    ["not-a-time", null],
    ["", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseClock(input)).toBe(expected);
  });
});

describe("isValidTimeZone", () => {
  test.each([
    ["UTC", true],
    ["America/New_York", true],
    ["Asia/Kolkata", true],
    ["Europe/London", true],
    ["Invalid/Zone", false],
    ["", false],
  ])("%s -> %s", (tz, expected) => {
    expect(isValidTimeZone(tz)).toBe(expected);
  });
});

describe("utcToLocalLabel / localWallToUtcMs round-trip", () => {
  const tz = "America/New_York";
  const ms = new Date("2026-03-15T12:00:00Z").getTime(); // DST in effect
  test("label round-trips", () => {
    const label = utcToLocalLabel(tz, ms);
    expect(label).not.toBeNull();
    const parts = label!.split(":").map(Number);
    const back = localWallToUtcMs(tz, 2026, 3, 15, parts[0], parts[1]);
    expect(back).toBe(ms);
  });
});

describe("spring-forward gap (2026-03-08 America/New_York: 02:00 does not exist)", () => {
  const tz = "America/New_York";
  test("02:00 is skipped", () => {
    expect(localWallToUtcMs(tz, 2026, 3, 8, 2, 0)).toBeNull();
  });
  test("03:00 exists", () => {
    expect(localWallToUtcMs(tz, 2026, 3, 8, 3, 0)).not.toBeNull();
  });
});

describe("fall-back hour (2026-11-01 America/New_York: 01:00 occurs twice, resolves to earlier)", () => {
  const tz = "America/New_York";
  test("01:00 resolves to the earlier (EDT) occurrence", () => {
    const ms = localWallToUtcMs(tz, 2026, 11, 1, 1, 0);
    expect(ms).not.toBeNull();
    expect(utcToLocalLabel(tz, ms!)).toBe("01:00");
    expect(new Date(ms!).getUTCHours()).toBe(5); // 01:00 EDT = 05:00 UTC
  });
});

describe("rollingWindows", () => {
  const grid: Grid = FIXTURE_GRIDS.hourly;

  test("windows in the next 24h, and the currently-open one", () => {
    const now = new Date("2026-10-17T12:30:00Z").getTime();
    const { windows, currentOpen } = rollingWindows(grid, now, USER);
    expect(currentOpen).not.toBeNull();
    expect(currentOpen!.isoStart).toBe("2026-10-17T12:00:00.000Z");
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => w.closeMs > now && w.closeMs <= now + 86_400_000)).toBe(true);
  });

  test("no currentOpen between windows", () => {
    const now = new Date("2026-10-17T07:00:00Z").getTime(); // before the first window
    expect(rollingWindows(grid, now, USER).currentOpen).toBeNull();
  });

  test("deterministic ids: checkin_{userId}_{epochHour-of-start}", () => {
    const now = new Date("2026-10-17T12:00:00Z").getTime();
    const a = windowsForLocalDay(grid, now, USER).map((w) => w.id);
    const b = windowsForLocalDay(grid, now, USER).map((w) => w.id);
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^checkin_u1_\d+$/);
    expect(a[0]).toBe(`checkin_u1_${Math.floor(new Date("2026-10-17T08:00:00Z").getTime() / 3_600_000)}`);
  });
});

// ---------------------------------------------------------------------------
// The frozen twin-grid fixture (NFR-7): the same table the server suite runs.
// ---------------------------------------------------------------------------

describe("frozen fixture — window generation (WINDOW_DAYS)", () => {
  for (const tc of WINDOW_DAYS) {
    test(tc.name, () => {
      const anchorMs = new Date(tc.anchorUtc).getTime();
      const ws = windowsForLocalDay(tc.grid, anchorMs, USER);
      expect(ws.map((w) => w.isoStart)).toEqual(tc.expectStartsUtc);
      // The labels are computed in the profile zone — the local-anchoring check.
      expect(ws.map((w) => utcToLocalLabel(tc.grid.timezone, w.startMs))).toEqual(tc.expectLabels);
    });
  }
});

describe("frozen fixture — canonicalization (WINDOW_HINTS)", () => {
  for (const tc of WINDOW_HINTS) {
    test(tc.name, () => {
      const nowMs = new Date(tc.nowUtc).getTime();
      const hintMs = new Date(tc.hintUtc).getTime();
      const res = canonicalizeWindow(tc.grid, hintMs, nowMs);
      if (tc.expect.ok) {
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(new Date(res.window.startMs).toISOString()).toBe(tc.expect.windowStartUtc);
          expect(res.snappedMs / 60_000).toBe(tc.expect.snappedMinutes);
        }
      } else {
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe(tc.expect.reason);
      }
    });
  }
});

describe("frozen fixture — closed-in-span (WINDOW_SPANS)", () => {
  for (const tc of WINDOW_SPANS) {
    test(tc.name, () => {
      const fromMs = new Date(tc.fromUtc).getTime();
      const toMs = new Date(tc.toUtc).getTime();
      const ws = windowsClosedBetween(tc.grid, fromMs, toMs);
      expect(ws.map((w) => new Date(w.startMs).toISOString())).toEqual(tc.expectStartsUtc);
    });
  }
});

describe("frozen fixture — an empty grid yields nothing", () => {
  test("23:00-23:59 has no window (no overnight)", () => {
    const grid = FIXTURE_GRIDS.lateStart;
    const anchor = new Date("2026-10-17T12:00:00Z").getTime();
    expect(windowsForLocalDay(grid, anchor, USER)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The dev drill trigger's target selection (TECH-SPEC §7.1). Dev-only, but the
// selection is what decides *which* window a "notify now" tap answers, so it is
// pinned here rather than left to the screen.
// ---------------------------------------------------------------------------

describe("devNotifyTarget", () => {
  const grid: Grid = FIXTURE_GRIDS.hourly; // 08:00-22:00 UTC

  test("inside active hours it is the window open now", () => {
    const now = new Date("2026-10-17T12:30:00Z").getTime();
    const target = devNotifyTarget(grid, now, USER);
    expect(new Date(target!.startMs).toISOString()).toBe("2026-10-17T12:00:00.000Z");
    // The real id, so the tap/reply handlers accept it (`data.windowId` gate).
    expect(target!.id).toMatch(/^checkin_u1_\d+$/);
  });

  test("before the first window it falls back to the most recently closed one", () => {
    const now = new Date("2026-10-17T07:00:00Z").getTime();
    // Nothing open at 07:00 (the day starts at 08:00), so the previous day's 21:00 window —
    // still inside the server's 24 h acceptance — is what the drill should fire for.
    expect(rollingWindows(grid, now, USER).currentOpen).toBeNull();
    const target = devNotifyTarget(grid, now, USER);
    expect(new Date(target!.startMs).toISOString()).toBe("2026-10-16T21:00:00.000Z");
  });

  test("just after the last close it is that close's window (the late path)", () => {
    const now = new Date("2026-10-17T22:05:00Z").getTime();
    const target = devNotifyTarget(grid, now, USER);
    expect(new Date(target!.startMs).toISOString()).toBe("2026-10-17T21:00:00.000Z");
  });

  test("the empty grid has nothing to fire for", () => {
    const now = new Date("2026-10-17T12:00:00Z").getTime();
    expect(devNotifyTarget(FIXTURE_GRIDS.lateStart, now, USER)).toBeNull();
  });
});