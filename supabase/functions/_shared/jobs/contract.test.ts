// supabase/functions/_shared/jobs/contract.test.ts
// FP-10 Step 2 - the dispatcher's four semantics as pinned arithmetic (TECH-SPEC §2.2).
//
// The dispatcher entry point cannot be imported here (module-level `Deno.env`), so the
// arithmetic it uses lives in `contract.ts` and these tables are the contract: claim/backoff,
// dead at `max_attempts`, budget release hands the increment back, lease recovery keeps it.

import {
  backoffSecondsFor,
  failedStatusFor,
  leaseResetCutoff,
  releaseUpdate,
} from "./contract.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const NOW_MS = Date.parse("2026-10-28T12:00:00Z");
const NOW_ISO = "2026-10-28T12:00:00.000Z";

describe("backoffSecondsFor (§2.2)", () => {
  it("doubles from 30s: 30, 60, 120, 240, 480", () => {
    expect([1, 2, 3, 4, 5].map(backoffSecondsFor)).toEqual([30, 60, 120, 240, 480]);
  });

  it("treats a missing or non-finite attempt as the first one", () => {
    expect(backoffSecondsFor(0)).toBe(30);
    expect(backoffSecondsFor(-3)).toBe(30);
    expect(backoffSecondsFor(Number.NaN)).toBe(30);
  });

  it("is 1-based, not 0-based (the off-by-one that would halve every retry)", () => {
    expect(backoffSecondsFor(2)).toBe(60);
  });
});

describe("failedStatusFor (§2.2)", () => {
  it("fails before the cap and dies at it", () => {
    expect(failedStatusFor(1, 5)).toBe("failed");
    expect(failedStatusFor(4, 5)).toBe("failed");
    expect(failedStatusFor(5, 5)).toBe("dead");
    expect(failedStatusFor(6, 5)).toBe("dead");
  });

  it("dead-letters on the first attempt when max_attempts is 1", () => {
    expect(failedStatusFor(1, 1)).toBe("dead");
  });

  it("treats a missing cap as a single attempt", () => {
    expect(failedStatusFor(1, Number.NaN)).toBe("dead");
  });
});

describe("releaseUpdate (§2.2 budget release)", () => {
  it("returns the job to pending with the claim increment handed back", () => {
    expect(releaseUpdate(1, NOW_ISO)).toEqual({
      status: "pending",
      attempts: 0,
      updated_at: NOW_ISO,
    });
    expect(releaseUpdate(3, NOW_ISO).attempts).toBe(2);
  });

  it("never goes below zero attempts", () => {
    expect(releaseUpdate(0, NOW_ISO).attempts).toBe(0);
    expect(releaseUpdate(-2, NOW_ISO).attempts).toBe(0);
  });
});

describe("leaseResetCutoff (§2.2 lease recovery)", () => {
  it("is now minus the lease window", () => {
    expect(leaseResetCutoff(NOW_MS, 5)).toBe("2026-10-28T11:55:00.000Z");
  });

  it("is now for a zero lease", () => {
    expect(leaseResetCutoff(NOW_MS, 0)).toBe(NOW_ISO);
  });

  it("clamps a malformed lease to zero rather than producing an invalid date", () => {
    expect(leaseResetCutoff(NOW_MS, Number.NaN)).toBe(NOW_ISO);
  });
});
