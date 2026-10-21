// supabase/functions/_shared/accountability/interventions.test.ts
// FP-08 Step 4 — the oath/breakdown/lockdown prompt halve's truth tables and delimiter floor.
// Refs: FP-08 FR-7, FR-10, FR-11; TECH-SPEC §5.4, §6.3, §10.5; D16, D21.
//
// Type-checked by `deno check` and run by jest.

import {
  BREAKDOWN_EMOTIONS,
  BREAKDOWN_REASON,
  OATH_REQUEST_REASON,
  buildBreakdownContext,
  buildLockdownContext,
  buildOathRequestContext,
  shouldRequestOath,
  shouldTriggerBreakdown,
  type BreakdownFacts,
} from "./interventions.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(expected: string): void;
  toBeGreaterThan(expected: number): void;
  toHaveLength(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("shouldRequestOath (FR-10, AC-4)", () => {
  const base = { admission: true, trustBefore: 70, trustThreshold: 70, recentRequests: 0 };

  it("requests at exactly the threshold", () => {
    expect(shouldRequestOath(base)).toBe(true);
  });

  it("does not request one point below — the admission's own +10 must not decide it", () => {
    expect(shouldRequestOath({ ...base, trustBefore: 69 })).toBe(false);
  });

  it("requires the admission flag", () => {
    expect(shouldRequestOath({ ...base, admission: false })).toBe(false);
    expect(shouldRequestOath({ ...base, admission: null })).toBe(false);
  });

  it("honours the cooldown (one request in the trailing window blocks a new one)", () => {
    expect(shouldRequestOath({ ...base, recentRequests: 1 })).toBe(false);
  });

  it("treats a missing or non-finite score as no trigger", () => {
    expect(shouldRequestOath({ ...base, trustBefore: null })).toBe(false);
    expect(shouldRequestOath({ ...base, trustBefore: Number.NaN })).toBe(false);
  });
});

describe("shouldTriggerBreakdown (FR-11)", () => {
  const base = { emotion: "exhausted", confidence: 0.8, highBand: 0.8, trustBefore: 70, trustThreshold: 70 };

  it("fires for each of the three emotions at High confidence and threshold trust", () => {
    for (const emotion of BREAKDOWN_EMOTIONS) {
      expect(shouldTriggerBreakdown({ ...base, emotion })).toBe(true);
    }
  });

  it("does not fire on another emotion", () => {
    expect(shouldTriggerBreakdown({ ...base, emotion: "determined" })).toBe(false);
    expect(shouldTriggerBreakdown({ ...base, emotion: null })).toBe(false);
  });

  it("is a strict High-band gate", () => {
    expect(shouldTriggerBreakdown({ ...base, confidence: 0.79 })).toBe(false);
  });

  it("holds the trust threshold (69 vs 70)", () => {
    expect(shouldTriggerBreakdown({ ...base, trustBefore: 69 })).toBe(false);
    expect(shouldTriggerBreakdown({ ...base, trustBefore: 70 })).toBe(true);
  });

  it("treats a missing confidence/score as no trigger", () => {
    expect(shouldTriggerBreakdown({ ...base, confidence: null })).toBe(false);
    expect(shouldTriggerBreakdown({ ...base, trustBefore: null })).toBe(false);
  });
});

describe("the reason constants", () => {
  it("are the §2.3 strings", () => {
    expect(OATH_REQUEST_REASON).toBe("oath_request");
    expect(BREAKDOWN_REASON).toBe("breakdown");
  });
});

describe("buildOathRequestContext (FR-10)", () => {
  const text = "I keep telling everyone I am fine when I am not.";

  it("wraps the admission in the user_admission delimiter", () => {
    const context = buildOathRequestContext(text);
    expect(context).toContain("<user_admission>");
    expect(context).toContain("</user_admission>");
    expect(context).toContain(text);
  });

  it("demands the oath in the user's own words and forbids comfort/options", () => {
    const context = buildOathRequestContext(text);
    expect(context).toContain("Oath");
    expect(context).toContain("their own words");
    expect(context).toContain("Do not comfort");
    expect(context).toContain("do not offer options");
  });
});

describe("buildLockdownContext (FR-7)", () => {
  it("carries the evidence and the claim in named delimiters", () => {
    const context = buildLockdownContext({
      claim: "I have no time to train.",
      evidence: ["3 check-ins logged in the last 7 days", "2 free blocks logged on Tuesday"],
      domains: ["Career", "Discipline/Habits"],
      redirect: "Acknowledge the Finance point and redirect.",
    });
    expect(context).toContain("<evidence>");
    expect(context).toContain("</evidence>");
    expect(context).toContain("<user_claim>");
    expect(context).toContain("I have no time to train.");
    expect(context).toContain("Career and Discipline/Habits");
    expect(context).toContain("Acknowledge the Finance point and redirect.");
  });

  it("states the no-evidence case instead of inventing facts", () => {
    const context = buildLockdownContext({ claim: "x", evidence: [], domains: [] });
    expect(context).toContain("No logged evidence");
    expect(context).toContain("invented facts");
  });

  it("omits the redirect block when none was supplied", () => {
    const context = buildLockdownContext({ claim: "x", evidence: ["one"], domains: ["Career"] });
    expect(context.includes("outside the accountability")).toBe(false);
  });
});

describe("buildBreakdownContext (FR-11)", () => {
  const facts: BreakdownFacts = {
    since: "2026-10-01",
    checkinCount: 42,
    expected: 60,
    answered: 45,
    streak: 4,
    metrics: [
      { name: "Deep work", unit: "hours", first: 1, latest: 3, firstDate: "2026-10-01", latestDate: "2026-10-21" },
    ],
    oath: { text: "I will not stop improving.", date: "2026-10-12" },
  };

  it("renders the deterministic aggregates", () => {
    const context = buildBreakdownContext(facts);
    expect(context).toContain("42 check-in(s)");
    expect(context).toContain("45 of 60");
    expect(context).toContain("4 complete day(s)");
    expect(context).toContain("Deep work: 1 hours");
    expect(context).toContain("2026-10-21");
  });

  it("re-presents the latest oath inside the user_oath delimiter", () => {
    const context = buildBreakdownContext(facts);
    expect(context).toContain("<user_oath>");
    expect(context).toContain("I will not stop improving.");
    expect(context).toContain("2026-10-12");
  });

  it("forbids inventing an oath when none exists", () => {
    const context = buildBreakdownContext({ ...facts, oath: null });
    expect(context).toContain("no oath on record");
    expect(context).toContain("Do not invent one");
    expect(context.includes("<user_oath>")).toBe(false);
  });

  it("states the empty-metric case instead of inventing progress", () => {
    const context = buildBreakdownContext({ ...facts, metrics: [] });
    expect(context).toContain("No validated metric has two readings");
    expect(context).toContain("do not invent metric progress");
  });

  it("is a single narrative wrap, not a list request", () => {
    const context = buildBreakdownContext(facts);
    expect(context).toContain("One message");
    expect(context).toContain("No lists");
  });
});
