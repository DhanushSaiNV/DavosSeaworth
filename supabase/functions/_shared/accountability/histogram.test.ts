// supabase/functions/_shared/accountability/histogram.test.ts
// FP-08 AC-9 (unit half) — bucketing, the top-2 cap, the fire time, and the rotation.
// Refs: FP-08 FR-21; TECH-SPEC §7.8; D22.
//
// Type-checked by `deno check` and run by jest.

import {
  bucketByLocalHour,
  dayOrdinal,
  fireTime,
  qualifyingBuckets,
  rotateActivity,
  totalFailures,
  type HourBucketRow,
} from "./histogram.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toHaveLength(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

function row(local_date: string, local_hour: number): HourBucketRow {
  return { local_date, local_hour };
}

describe("bucketByLocalHour", () => {
  it("counts inside the inclusive trailing window and ignores outside rows", () => {
    const buckets = bucketByLocalHour([
      row("2026-10-08", 10),
      row("2026-10-09", 21),
      row("2026-10-20", 21),
      row("2026-10-20", 21),
    ], 14, "2026-10-20"); // window 10-07 .. 10-20
    expect(buckets[21].count).toBe(3);
    expect(buckets[10].count).toBe(1);
  });

  it("excludes the day before the window", () => {
    const buckets = bucketByLocalHour([row("2026-10-06", 9)], 14, "2026-10-20");
    expect(totalFailures(buckets)).toBe(0);
  });

  it("ignores out-of-range hours", () => {
    const buckets = bucketByLocalHour([row("2026-10-20", 24)], 14, "2026-10-20");
    expect(totalFailures(buckets)).toBe(0);
  });

  it("returns all 24 hours with zero counts for an empty set", () => {
    const buckets = bucketByLocalHour([], 14, "2026-10-20");
    expect(buckets).toHaveLength(24);
    expect(totalFailures(buckets)).toBe(0);
  });
});

describe("qualifyingBuckets (min count, top-2 cap)", () => {
  const buckets = [
    { hour: 9, count: 1 },
    { hour: 18, count: 4 },
    { hour: 21, count: 4 },
    { hour: 7, count: 3 },
    { hour: 12, count: 6 },
  ];

  it("filters by the cold-start threshold", () => {
    expect(qualifyingBuckets(buckets, 3, 5).map((bucket) => bucket.hour)).toEqual([12, 18, 21, 7]);
  });

  it("caps at two, count descending, earlier hour on ties", () => {
    expect(qualifyingBuckets(buckets, 3).slice(0, 2).map((bucket) => bucket.hour)).toEqual([12, 18]);
  });

  it("a cap of zero yields nothing", () => {
    expect(qualifyingBuckets(buckets, 3, 0)).toHaveLength(0);
  });
});

describe("fireTime — bucket start minus the lead", () => {
  it("18:00 with a 15-minute lead → 17:45 the same day", () => {
    expect(fireTime(18, 15, "2026-10-21")).toBe("2026-10-21T17:45:00");
  });

  it("00:00 with a 15-minute lead rolls to the previous day", () => {
    expect(fireTime(0, 15, "2026-10-21")).toBe("2026-10-20T23:45:00");
  });

  it("a zero lead is the bucket start", () => {
    expect(fireTime(9, 0, "2026-10-21")).toBe("2026-10-21T09:00:00");
  });
});

describe("rotateActivity + dayOrdinal", () => {
  it("rotates over the list", () => {
    expect(rotateActivity(["run", "read", "walk"], 3)).toBe("run");
    expect(rotateActivity(["run", "read", "walk"], 4)).toBe("read");
  });

  it("negative and non-finite ordinals stay in range", () => {
    expect(rotateActivity(["run", "read", "walk"], -1)).toBe("walk");
    expect(rotateActivity(["run", "read", "walk"], Number.NaN)).toBe("run");
  });

  it("an empty or malformed list → null (the generic degradation)", () => {
    expect(rotateActivity([], 1)).toBeNull();
    expect(rotateActivity(["", "   "], 1)).toBeNull();
    expect(rotateActivity(null, 1)).toBeNull();
  });

  it("dayOrdinal is days since epoch", () => {
    expect(dayOrdinal("2026-10-21") - dayOrdinal("2026-10-20")).toBe(1);
  });
});
