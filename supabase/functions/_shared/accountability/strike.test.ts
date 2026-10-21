// supabase/functions/_shared/accountability/strike.test.ts
// FP-08 AC-8 (unit half) — the claim-check, the snooze, and the evidence shape.
// Refs: FP-08 FR-19; TECH-SPEC §7.5, §4.2, §2.2; D11, D24.
//
// Type-checked by `deno check` and run by jest.

import {
  assembleEvidence,
  checkClaims,
  evidenceMode,
  extractNumericClaims,
  snoozeDecision,
  type EvidenceContext,
  type StrikeGroundTruth,
} from "./strike.ts";
import { strikeTemplate } from "./templates.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toHaveLength(expected: number): void;
  toBeGreaterThan(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const GT: StrikeGroundTruth = {
  doings_count: 14,
  hours_logged: 12,
  missed_windows: 3,
  impulse_failures: 5,
  watch_started_at: "2026-10-14",
  strike_at: "2026-10-21",
  window: { start: "2026-10-14", end: "2026-10-20" },
};

const UNVERIFIED: EvidenceContext = { ground_truth: GT, verified_goals: [] };

describe("extractNumericClaims", () => {
  it("recognises a goal/deadline figure as one claim, not a duration too", () => {
    const claims = extractNumericClaims("You promised a 400-hour deadline.");
    expect(claims).toHaveLength(1);
    expect(claims[0].kind).toBe("goal");
    expect(claims[0].value).toBe(400);
    expect(claims[0].unit).toBe("hour");
  });

  it("recognises durations", () => {
    const claims = extractNumericClaims("You logged 12 hours and missed 7 days.");
    expect(claims.map((claim) => claim.unit)).toEqual(["hour", "day"]);
  });

  it("recognises quantities", () => {
    const claims = extractNumericClaims("14 doings, 3 check-in windows, 5 impulse failures.");
    expect(claims.map((claim) => claim.unit)).toEqual(["doings", "checkins", "impulses"]);
  });

  it("recognises ISO, month-name and slash dates", () => {
    const claims = extractNumericClaims("Since 2026-10-14, and on 21 October, and 10/21.");
    expect(claims.map((claim) => claim.date)).toEqual(["2026-10-14", "10-21", "10-21"]);
  });

  it("no numbers → no claims", () => {
    expect(extractNumericClaims("Nothing numeric here.")).toHaveLength(0);
  });
});

describe("checkClaims — provenance, not mere presence", () => {
  it("licenses every ground-truth figure in a clean quote", () => {
    const quote =
      "In 7 days you logged 14 doings and 12 hours, missed 3 check-in windows, and logged 5 impulse failures.";
    expect(checkClaims(quote, UNVERIFIED)).toHaveLength(0);
  });

  it("licenses the watch/strike dates", () => {
    expect(checkClaims("Since 2026-10-14, the watch ends on 2026-10-21.", UNVERIFIED)).toHaveLength(0);
  });

  it("rejects the fabricated '400-hour deadline' in unverified mode", () => {
    const violations = checkClaims("You gave me a 400-hour deadline.", UNVERIFIED);
    expect(violations).toHaveLength(1);
    expect(violations[0].claim.value).toBe(400);
    expect(violations[0].reason).toBe("goal_claim_without_goals");
  });

  it("rejects an unsourced count", () => {
    const violations = checkClaims("You did 40 doings.", UNVERIFIED);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("unsourced");
  });

  it("rejects an unsourced date", () => {
    const violations = checkClaims("Since 2026-09-01 you have drifted.", UNVERIFIED);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("date_unsourced");
  });

  it("licenses a figure cited from a verified goal", () => {
    const verified: EvidenceContext = {
      ground_truth: GT,
      verified_goals: ["Finish the 90-day program by 2026-12-01"],
    };
    expect(checkClaims("We agreed on the 90-day program, due 2026-12-01.", verified)).toHaveLength(0);
  });

  it("rejects a goal figure in verified mode when no cited goal carries it", () => {
    const verified: EvidenceContext = {
      ground_truth: GT,
      verified_goals: ["Finish the 90-day program"],
    };
    const violations = checkClaims("You gave me a 400-hour deadline.", verified);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("unsourced");
  });

  it("the in-code template passes the claim-check by construction", () => {
    const template = strikeTemplate({ ...GT, watch_days: 7 });
    expect(checkClaims(template, UNVERIFIED)).toHaveLength(0);
  });
});

describe("snoozeDecision (FR-19, trailing 24 h)", () => {
  const now = "2026-10-21T18:00:00Z";

  it("an S2 within 24 hours snoozes by exactly one day", () => {
    expect(snoozeDecision([{ severity: "S2", at: "2026-10-21T06:00:00Z" }], now))
      .toEqual({ snooze_until: "2026-10-22T18:00:00.000Z" });
  });

  it("S1 within 24 hours snoozes", () => {
    expect(snoozeDecision([{ severity: "S1", at: "2026-10-20T18:01:00Z" }], now) !== null).toBe(true);
  });

  it("an S1/S2 older than 24 hours does not", () => {
    expect(snoozeDecision([{ severity: "S1", at: "2026-10-20T17:59:00Z" }], now)).toBeNull();
  });

  it("S3 never snoozes", () => {
    expect(snoozeDecision([{ severity: "S3", at: "2026-10-21T17:00:00Z" }], now)).toBeNull();
  });

  it("an empty list does not", () => {
    expect(snoozeDecision([], now)).toBeNull();
  });
});

describe("evidence assembly", () => {
  it("goals present → verified; absent → unverified", () => {
    expect(evidenceMode(["goal"])).toBe("verified");
    expect(evidenceMode([])).toBe("unverified");
  });

  it("assembleEvidence carries the mode and a copy of the goals", () => {
    const assembled = assembleEvidence(UNVERIFIED);
    expect(assembled.mode).toBe("unverified");
    expect(assembled.ground_truth.doings_count).toBe(14);
    expect(assembled.verified_goals).toHaveLength(0);
  });
});
