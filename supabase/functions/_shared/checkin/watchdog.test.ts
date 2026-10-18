// supabase/functions/_shared/checkin/watchdog.test.ts
// Unit tests for the check-in watchdog's pure half — FP-04 AC-8 (unit level), FR-15/FR-16, NFR-3.
// Refs: TECH-SPEC §2.3, §7.1; FP-04 FR-15, FR-16, FR-18.
//
// The impure half (`runWatchdog.ts`) is exercised by the live gate: it needs the service client,
// the profiles walk and the generation call. What is pinned here is every *decision* the scan
// makes — which windows are missed, and what the intervention is asked — because those are the
// deterministic parts (NFR-3) and the parts a config or grid change could silently move.
//
// Type-checked by `deno check` and run by jest.

import { FIXTURE_GRIDS } from "./windows.fixture.ts";
import {
  buildInterventionContext,
  MISSED_CHECKIN_REASON,
  selectMissedWindows,
  type MissedScanInput,
} from "./watchdog.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeGreaterThan(expected: number): void;
  toContain(expected: string): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);

/** The scan bounds the live config carries (§11): grace 10 min, lookback 120 min. */
const GRACE_MS = 10 * 60_000;
const LOOKBACK_MS = 120 * 60_000;

function scan(over: Partial<MissedScanInput>): number[] {
  const input: MissedScanInput = {
    grid: FIXTURE_GRIDS.hourly, // 08:00–22:00 UTC, cadence 60 → closes on the hour
    nowMs: at("2026-10-17T10:15:00.000Z"),
    graceMs: GRACE_MS,
    lookbackMs: LOOKBACK_MS,
    answeredStartMs: new Set<number>(),
    queuedStartMs: new Set<number>(),
    ...over,
  };
  return selectMissedWindows(input).map((w) => w.startMs);
}

describe("selectMissedWindows (FR-15 scan)", () => {
  it("selects every window closed in (now - lookback, now - grace], ascending", () => {
    // now 10:15 → band (08:15, 10:05]: the 08:00 window (closed 09:00) and the 09:00 one (10:00).
    expect(scan({}).map(iso)).toEqual([
      "2026-10-17T08:00:00.000Z",
      "2026-10-17T09:00:00.000Z",
    ]);
  });

  it("leaves a window alone until its grace has elapsed", () => {
    // The grid's first close is 09:00 (the 08:00 window). At 09:05 it closed 5 min ago — inside
    // grace — so nothing is missed yet; at 09:10 the grace has elapsed and it is selected.
    expect(scan({ nowMs: at("2026-10-17T09:05:00.000Z") })).toEqual([]);
    expect(scan({ nowMs: at("2026-10-17T09:10:00.000Z") }).map(iso)).toEqual([
      "2026-10-17T08:00:00.000Z",
    ]);
  });

  it("does not reach back past the lookback bound (the lower bound is exclusive)", () => {
    // now 11:00 → band (09:00, 10:50]: the 08:00 window's close (09:00) sits exactly on the bound
    // and is excluded; the 09:00 window's close (10:00) is the only one inside.
    expect(scan({ nowMs: at("2026-10-17T11:00:00.000Z") }).map(iso)).toEqual([
      "2026-10-17T09:00:00.000Z",
    ]);
  });

  it("drops a window that a doing answered (the canonical checkin_window join)", () => {
    const answered = new Set([at("2026-10-17T08:00:00.000Z")]);
    expect(scan({ answeredStartMs: answered }).map(iso)).toEqual([
      "2026-10-17T09:00:00.000Z",
    ]);
  });

  it("drops a window that already has an intervention queued (the payload dedup)", () => {
    const queued = new Set([at("2026-10-17T09:00:00.000Z")]);
    expect(scan({ queuedStartMs: queued }).map(iso)).toEqual([
      "2026-10-17T08:00:00.000Z",
    ]);
  });

  it("yields nothing when every candidate is answered or queued", () => {
    const both = new Set([at("2026-10-17T08:00:00.000Z"), at("2026-10-17T09:00:00.000Z")]);
    expect(scan({ answeredStartMs: both })).toEqual([]);
    expect(scan({ queuedStartMs: both })).toEqual([]);
  });

  it("never alerts across a window the grid does not emit (no overnight windows)", () => {
    // 23:00–23:59 with cadence 60 emits nothing at all (§7.1), so no close can fall in any band.
    expect(scan({ grid: FIXTURE_GRIDS.lateStart })).toEqual([]);
    expect(scan({ grid: FIXTURE_GRIDS.lateStart, nowMs: at("2026-10-17T23:30:00.000Z") })).toEqual(
      [],
    );
  });

  it("yields nothing when grace and lookback invert", () => {
    expect(scan({ graceMs: LOOKBACK_MS, lookbackMs: GRACE_MS })).toEqual([]);
  });

  it("carries the half-hour grid's non-hour closes", () => {
    // 05:30–08:30 UTC cadence 60 → closes at 06:30/07:30/08:30; now 07:40 → band (05:40, 07:30].
    expect(
      scan({ grid: FIXTURE_GRIDS.halfPast, nowMs: at("2026-10-17T07:40:00.000Z") }).map(iso),
    ).toEqual(["2026-10-17T05:30:00.000Z", "2026-10-17T06:30:00.000Z"]);
  });
});

describe("buildInterventionContext (FR-16)", () => {
  const window = {
    startMs: at("2026-10-17T09:00:00.000Z"),
    closeMs: at("2026-10-17T10:00:00.000Z"),
  };

  it("states the reason, the window in both frames, and how long ago it closed", () => {
    const text = buildInterventionContext({
      window,
      reason: MISSED_CHECKIN_REASON,
      timezone: "UTC",
      nowMs: at("2026-10-17T10:12:00.000Z"),
      recent: [],
    });
    expect(text).toContain("reason: missed_checkin");
    expect(text).toContain("09:00-10:00 local time (UTC)");
    expect(text).toContain("2026-10-17T09:00:00.000Z - 2026-10-17T10:00:00.000Z");
    expect(text).toContain("closed about 12 minute(s) ago");
    expect(text).toContain("Recent conversation: none yet");
  });

  it("labels the window in the profile's zone, not the epoch's", () => {
    const text = buildInterventionContext({
      window,
      reason: MISSED_CHECKIN_REASON,
      timezone: "Asia/Kolkata",
      nowMs: at("2026-10-17T10:12:00.000Z"),
      recent: [],
    });
    // 09:00 UTC is 14:30 in +05:30 — the wall-clock labels the user would recognise.
    expect(text).toContain("14:30-15:30 local time (Asia/Kolkata)");
  });

  it("replays the recent thread oldest-first, tagged by role", () => {
    const text = buildInterventionContext({
      window,
      reason: MISSED_CHECKIN_REASON,
      timezone: "UTC",
      nowMs: at("2026-10-17T10:12:00.000Z"),
      recent: [
        { role: "user", content: "shipped the draft" },
        { role: "assistant", content: "nice" },
      ],
    });
    expect(text).toContain("[user] shipped the draft");
    expect(text).toContain("[assistant] nice");
    expect(text.indexOf("[user] shipped the draft")).toBeGreaterThan(-1);
    expect(text.indexOf("[assistant] nice")).toBeGreaterThan(
      text.indexOf("[user] shipped the draft"),
    );
  });
});
