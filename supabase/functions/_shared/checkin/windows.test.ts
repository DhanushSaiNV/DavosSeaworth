// supabase/functions/_shared/checkin/windows.test.ts
// Unit tests for the server check-in grid — FP-04 AC-1/AC-6 (unit level), NFR-5, NFR-7.
// Refs: TECH-SPEC §7.1 (the frozen grid contract); FP-04 FR-1, FR-5, FR-8, FR-15.
//
// The assertions come from `windows.fixture.ts` — the same file Step 4's client test reads — so
// a drift between the server grid and the client grid fails here or there, never silently
// (NFR-7). Everything below is type-checked by `deno check` and run by jest.

import {
  canonicalizeWindow,
  isValidTimeZone,
  localWallToUtcMs,
  parseClock,
  utcToLocalLabel,
  windowsClosedBetween,
  windowsForLocalDay,
  type GridWindow,
} from "./windows.ts";
import { WINDOW_DAYS, WINDOW_HINTS, WINDOW_SPANS } from "./windows.fixture.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeGreaterThan(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const iso = (ms: number) => new Date(ms).toISOString();

function startsOf(grid: Parameters<typeof windowsForLocalDay>[0], anchorIso: string): GridWindow[] {
  return windowsForLocalDay(grid, Date.parse(anchorIso));
}

describe("windowsForLocalDay (§7.1 grid, twin table)", () => {
  for (const kase of WINDOW_DAYS) {
    it(kase.name, () => {
      const windows = startsOf(kase.grid, kase.anchorUtc);
      expect(windows.map((w) => iso(w.startMs))).toEqual(kase.expectStartsUtc);
      expect(
        windows.map((w) => utcToLocalLabel(kase.grid.timezone, w.startMs)),
      ).toEqual(kase.expectLabels);
    });
  }

  it("emits strictly ascending starts, each closing after it starts", () => {
    for (const kase of WINDOW_DAYS) {
      const windows = startsOf(kase.grid, kase.anchorUtc);
      for (let i = 0; i < windows.length; i++) {
        expect(windows[i].closeMs).toBeGreaterThan(windows[i].startMs);
        if (i > 0) expect(windows[i].startMs).toBeGreaterThan(windows[i - 1].startMs);
      }
    }
  });

  it("closes a window at the next emitted start (the wall-clock close, across DST too)", () => {
    // The fall-back day: the 01:00 EDT window closes at 02:00 EST, which is two real hours on.
    const windows = startsOf(
      WINDOW_DAYS.find((k) => k.name.startsWith("fall back"))!.grid,
      "2026-11-01T12:00:00.000Z",
    );
    expect(windows.map((w) => iso(w.closeMs))).toEqual([
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T09:00:00.000Z", // the last window closes at its own start + cadence
    ]);
  });
});

describe("canonicalizeWindow (§7.1 hint resolution)", () => {
  for (const kase of WINDOW_HINTS) {
    it(kase.name, () => {
      const got = canonicalizeWindow(kase.grid, Date.parse(kase.hintUtc), Date.parse(kase.nowUtc));
      if (kase.expect.ok) {
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(iso(got.window.startMs)).toBe(kase.expect.windowStartUtc);
        expect(got.snappedMs / 60_000).toBe(kase.expect.snappedMinutes);
      } else {
        expect(got.ok).toBe(false);
        if (got.ok) return;
        expect(got.reason).toBe(kase.expect.reason);
      }
    });
  }

  it("rejects a hint that does not parse as a time (the malformed branch)", () => {
    const got = canonicalizeWindow(
      WINDOW_DAYS[0].grid,
      Number.NaN,
      Date.parse("2026-10-17T10:05:00.000Z"),
    );
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe("window_malformed");
  });
});

describe("windowsClosedBetween (the Step 6 scan)", () => {
  for (const kase of WINDOW_SPANS) {
    it(kase.name, () => {
      const spans = windowsClosedBetween(
        kase.grid,
        Date.parse(kase.fromUtc),
        Date.parse(kase.toUtc),
      );
      expect(spans.map((w) => iso(w.startMs))).toEqual(kase.expectStartsUtc);
    });
  }
});

describe("wall-clock primitives", () => {
  it("parseClock accepts HH:MM and HH:MM:SS and rejects out-of-range values", () => {
    expect(parseClock("08:00")).toBe(480);
    expect(parseClock("08:00:00")).toBe(480);
    expect(parseClock("05:30")).toBe(330);
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("08:60")).toBeNull();
    expect(parseClock("nonsense")).toBeNull();
  });

  it("returns null for a local time inside the spring-forward gap", () => {
    // 2026-03-08 02:00 does not exist in New York.
    expect(localWallToUtcMs("America/New_York", 2026, 3, 8, 2, 0)).toBeNull();
    expect(localWallToUtcMs("America/New_York", 2026, 3, 8, 1, 0)).toBe(
      Date.parse("2026-03-08T06:00:00.000Z"),
    );
    expect(localWallToUtcMs("America/New_York", 2026, 3, 8, 3, 0)).toBe(
      Date.parse("2026-03-08T07:00:00.000Z"),
    );
  });

  it("resolves a repeated local time to its earlier instant", () => {
    expect(localWallToUtcMs("America/New_York", 2026, 11, 1, 1, 0)).toBe(
      Date.parse("2026-11-01T05:00:00.000Z"),
    );
  });

  it("rejects a zone the runtime does not know", () => {
    expect(isValidTimeZone("UTC")).toBeTruthy();
    expect(isValidTimeZone("Asia/Kolkata")).toBeTruthy();
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
