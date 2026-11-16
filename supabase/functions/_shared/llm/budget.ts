// supabase/functions/_shared/llm/budget.ts
// P3 — the global provider-request ledger (PLAN.md §12).
//
// Refs: PLAN.md §12.1 (the ledger), §12.2 (why a refinement can never displace an answer),
// §12.3 (the ten call-count paths), §12.4 (`llm_retry` propagates, never resets), §12.5 (the
// owner's override of PRD line 268); PRD §4.4 (call budget), §14.1 T12/T13; AGENTS.md §3.8.
//
// Unit = one HTTP generation request to a provider. `total = 3` covers the original turn *and*
// any `llm_retry` job it causes. The ledger is mutable on purpose: one turn walks extraction →
// answer → refinement in sequence, and every stage must see the same count. It is pure — no
// client, no clock, no config — so T12/T13 can be asserted without a provider.
//
// Why the reservation exists: without it, a turn whose extraction burns both its attempts would
// leave the answer nothing, and the user would get a holding reply for a turn where one provider
// call would have sufficed. `reserved = 1` is the answer's guarantee, not a heuristic.

/** One turn's ledger. Mutated in place by `charge` / `releaseReservation`. */
export interface GenerationBudget {
  /** The ceiling for the whole turn, including a retry job it causes. */
  readonly total: number;
  /** Provider requests already made (or refused-after-counting; see `charge`). */
  used: number;
  /** Requests held back for a later stage. Only ever 1 (the answer) or 0. */
  reserved: number;
}

/**
 * PLAN.md §12: `total = 3`. Not a `config` value: §12.3 enumerates every path against this
 * number, and the owner settled it as decision B-3. A caller may still pass a different total
 * (the `llm_retry` job passes what the original turn left, capped at 2).
 */
export const DEFAULT_GENERATION_BUDGET = 3;

/**
 * A fresh ledger. `reserved = 1` at turn start guarantees the answer one request
 * (PLAN.md §12.1); the retry job passes `reserved = 0` because it has no extraction stage.
 */
export function createBudget(
  total: number = DEFAULT_GENERATION_BUDGET,
  reserved = 1,
): GenerationBudget {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  return { total: safeTotal, used: 0, reserved: reserved > 0 ? 1 : 0 };
}

/** Requests still spendable right now (`total − used − reserved`), never negative. */
export function remaining(budget: GenerationBudget): number {
  return Math.max(0, budget.total - budget.used - budget.reserved);
}

/**
 * Count one provider request. Returns false when the ceiling is already reached — the caller
 * must then make **no** provider call (PLAN.md §12.1: "no provider call is made").
 */
export function charge(budget: GenerationBudget): boolean {
  if (remaining(budget) <= 0) return false;
  budget.used += 1;
  return true;
}

/** The answer stage releases the reservation: whatever is left is the answer's to spend. */
export function releaseReservation(budget: GenerationBudget): void {
  budget.reserved = 0;
}

/**
 * PLAN.md §12.1: "refinement is admitted only if `total − used ≥ 1` **after** the answer
 * returns". Deliberately ignores `reserved` — the answer has already released it by then.
 */
export function refinementAllowed(budget: GenerationBudget): boolean {
  return budget.total - budget.used >= 1;
}

/**
 * What a retry job may inherit (PLAN.md §12.4): `max(0, total − used)`. The reservation is
 * *not* subtracted: a turn that degraded before its answer never spent it, and the retry has no
 * extraction stage to protect.
 */
export function remainingAfterTurn(budget: GenerationBudget): number {
  return Math.max(0, budget.total - budget.used);
}

/**
 * The retry job's ceiling: the inherited remainder capped at 2, because a retry re-runs stages
 * 3-5 only — there is no extraction request to pay for (PLAN.md §12.4).
 */
export function retryBudgetTotal(inherited: number | null | undefined): number {
  const value = typeof inherited === "number" && Number.isFinite(inherited) ? inherited : 2;
  return Math.min(2, Math.max(0, Math.floor(value)));
}
