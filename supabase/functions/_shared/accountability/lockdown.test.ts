// supabase/functions/_shared/accountability/lockdown.test.ts
// FP-08 AC-3 (unit half) — entry, the three exits, and the domain override.
// Refs: FP-08 FR-6, FR-7, FR-8; TECH-SPEC §5.1–5.3; D16, D21; PRD §3.3.
//
// Type-checked by `deno check` and run by jest.

import {
  ACCOUNTABILITY_DOMAINS_DEFAULT,
  LOCKDOWN_PERSONA,
  buildRedirectInstruction,
  effectiveDomain,
  shouldEnterLockdown,
  shouldExit,
} from "./lockdown.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toBeNull(): void;
  toEqual(expected: unknown): void;
  toContain(expected: string): void;
  toHaveLength(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const DOMAINS = [...ACCOUNTABILITY_DOMAINS_DEFAULT];

describe("shouldEnterLockdown (FR-6)", () => {
  it("each extraction flag alone arms", () => {
    expect(shouldEnterLockdown({ give_up: true }, null)).toBe(true);
    expect(shouldEnterLockdown({ false_constraint: true }, null)).toBe(true);
  });

  it("the quit signal arms at the threshold, not below", () => {
    expect(shouldEnterLockdown({}, 0.75, 0.75)).toBe(true);
    expect(shouldEnterLockdown({}, 0.74, 0.75)).toBe(false);
  });

  it("a missing signal does not arm", () => {
    expect(shouldEnterLockdown({}, null)).toBe(false);
    expect(shouldEnterLockdown(null, undefined)).toBe(false);
    expect(shouldEnterLockdown({ give_up: false, false_constraint: false }, 0.1)).toBe(false);
  });

  it("the forced persona is D21's", () => {
    expect(LOCKDOWN_PERSONA).toBe("confrontation");
  });
});

describe("shouldExit (FR-8)", () => {
  const start = "2026-10-21T08:00:00Z";

  it("concession exits", () => {
    expect(shouldExit(true, start, "2026-10-21T09:00:00Z", 24)).toBe(true);
  });

  it("the breaker exits at the configured hours", () => {
    expect(shouldExit(false, start, "2026-10-22T08:00:00Z", 24)).toBe(true);
    expect(shouldExit(false, start, "2026-10-22T07:59:59Z", 24)).toBe(false);
  });

  it("journal S1/S2 exits; S3 does not", () => {
    expect(shouldExit(false, start, "2026-10-21T09:00:00Z", 24, "S1")).toBe(true);
    expect(shouldExit(false, start, "2026-10-21T09:00:00Z", 24, "S2")).toBe(true);
    expect(shouldExit(false, start, "2026-10-21T09:00:00Z", 24, "S3")).toBe(false);
  });

  it("a missing start never expires by accident", () => {
    expect(shouldExit(false, null, "2026-10-30T00:00:00Z", 24)).toBe(false);
  });
});

describe("effectiveDomain (FR-7)", () => {
  it("keeps an in-set domain and marks no mismatch", () => {
    expect(effectiveDomain("Career", DOMAINS)).toEqual({ domains: ["Career"], mismatched: false });
  });

  it("falls back to the whole set on an out-of-set domain and marks the mismatch", () => {
    expect(effectiveDomain("Relationships", DOMAINS)).toEqual({ domains: DOMAINS, mismatched: true });
  });

  it("a null classification uses the set without a mismatch", () => {
    expect(effectiveDomain(null, DOMAINS)).toEqual({ domains: DOMAINS, mismatched: false });
  });

  it("an empty configured set degrades to the §11 default pair", () => {
    expect(effectiveDomain(null, []).domains).toEqual(DOMAINS);
  });
});

describe("buildRedirectInstruction", () => {
  it("is null when the domain is on-topic", () => {
    expect(buildRedirectInstruction("Career", DOMAINS)).toBeNull();
  });

  it("acknowledges then redirects when the domain is off-topic", () => {
    const instruction = buildRedirectInstruction("Relationships", DOMAINS);
    expect(instruction).toContain("Relationships");
    expect(instruction).toContain("Career");
    expect(instruction).toContain("Discipline/Habits");
    expect(instruction).toContain("Acknowledge");
  });
});
