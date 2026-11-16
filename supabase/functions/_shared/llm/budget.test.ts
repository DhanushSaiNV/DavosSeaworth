// supabase/functions/_shared/llm/budget.test.ts
// T12/T13 and PLAN.md §12.1-§12.4: the ledger arithmetic, the answer's reservation, the
// refinement admission rule, and the retry inheritance.
//
// The point of these assertions is the *shape* of the ceiling, not a happy path: every path in
// §12.3 must total 3 or less, and row 8 (answer from the fallback + a refinement request) must
// come out as `remaining = 0` so the refinement is refused.

import {
  DEFAULT_GENERATION_BUDGET,
  charge,
  createBudget,
  refinementAllowed,
  remaining,
  remainingAfterTurn,
  releaseReservation,
  retryBudgetTotal,
} from "./budget.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("createBudget (PLAN.md §12.1)", () => {
  it("starts at total 3 with the answer's request reserved", () => {
    const budget = createBudget();
    expect(DEFAULT_GENERATION_BUDGET).toBe(3);
    expect(budget).toEqual({ total: 3, used: 0, reserved: 1 });
    expect(remaining(budget)).toBe(2);
  });

  it("clamps a nonsense total to zero rather than going negative", () => {
    expect(createBudget(-1).total).toBe(0);
    expect(createBudget(Number.NaN).total).toBe(0);
    expect(createBudget(2.7).total).toBe(2);
  });

  it("gives a retry ledger no reservation", () => {
    expect(createBudget(2, 0)).toEqual({ total: 2, used: 0, reserved: 0 });
    expect(remaining(createBudget(2, 0))).toBe(2);
  });
});

describe("charge (no provider call beyond the ceiling)", () => {
  it("lets extraction spend the two requests the reservation leaves", () => {
    const budget = createBudget();
    expect(charge(budget)).toBe(true);
    expect(charge(budget)).toBe(true);
    expect(charge(budget)).toBe(false);
    expect(budget.used).toBe(2);
    expect(remaining(budget)).toBe(0);
  });

  it("refuses without counting once the ceiling is reached", () => {
    const budget = createBudget(1, 0);
    expect(charge(budget)).toBe(true);
    expect(charge(budget)).toBe(false);
    expect(charge(budget)).toBe(false);
    expect(budget.used).toBe(1);
  });

  it("never exceeds the total on any sequence", () => {
    const budget = createBudget();
    for (let i = 0; i < 20; i += 1) charge(budget);
    expect(budget.used).toBe(2);
  });
});

describe("releaseReservation", () => {
  it("hands the remaining requests to the answer", () => {
    const budget = createBudget();
    charge(budget); // extraction, primary
    releaseReservation(budget);
    expect(remaining(budget)).toBe(2);
    expect(charge(budget)).toBe(true); // answer, primary
    expect(charge(budget)).toBe(true); // answer, fallback
    expect(charge(budget)).toBe(false);
    expect(budget.used).toBe(3);
  });
});

describe("refinementAllowed (PLAN.md §12.1, §12.3 row 8)", () => {
  it("admits refinement when the answer cost one request", () => {
    const budget = createBudget();
    charge(budget); // extraction
    releaseReservation(budget);
    charge(budget); // answer, primary succeeded
    expect(refinementAllowed(budget)).toBe(true);
  });

  it("refuses refinement when the answer came from the fallback", () => {
    const budget = createBudget();
    charge(budget); // extraction
    releaseReservation(budget);
    charge(budget); // answer, primary failed
    charge(budget); // answer, fallback succeeded
    expect(refinementAllowed(budget)).toBe(false);
    expect(remainingAfterTurn(budget)).toBe(0);
  });

  it("refuses refinement when extraction itself needed both attempts", () => {
    const budget = createBudget();
    charge(budget);
    charge(budget); // extraction: primary + fallback
    releaseReservation(budget);
    charge(budget); // answer
    expect(refinementAllowed(budget)).toBe(false);
  });
});

describe("remainingAfterTurn (PLAN.md §12.4)", () => {
  it("counts what a retry may inherit, ignoring the reservation", () => {
    const budget = createBudget();
    expect(remainingAfterTurn(budget)).toBe(3);
    charge(budget);
    expect(remainingAfterTurn(budget)).toBe(2);
  });

  it("is zero once the turn spent the ceiling", () => {
    const budget = createBudget();
    charge(budget);
    releaseReservation(budget);
    charge(budget);
    charge(budget);
    expect(remainingAfterTurn(budget)).toBe(0);
  });
});

describe("retryBudgetTotal (PLAN.md §12.4)", () => {
  it("caps an inherited remainder at 2 and defaults to 2 when absent", () => {
    expect(retryBudgetTotal(3)).toBe(2);
    expect(retryBudgetTotal(2)).toBe(2);
    expect(retryBudgetTotal(1)).toBe(1);
    expect(retryBudgetTotal(0)).toBe(0);
    expect(retryBudgetTotal(undefined)).toBe(2);
    expect(retryBudgetTotal(null)).toBe(2);
    expect(retryBudgetTotal(Number.NaN)).toBe(2);
    expect(retryBudgetTotal(-4)).toBe(0);
  });
});
