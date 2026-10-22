// supabase/functions/_shared/jobs/snooze.test.ts
// FP-08 Step 7 — the five-snooze table (FR-19, TECH-SPEC §2.2).
//
// A deferral must never move a job toward dead-letter: `claim_jobs` increments on every
// claim, the snooze decrements on every release, and the row stays at zero attempts.

import { snoozeUpdate } from "./snooze.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const NOW = "2026-10-21T18:00:00Z";

describe("snoozeUpdate (FR-19)", () => {
  it("resets the row, pushes the retry, and restores the claim increment", () => {
    expect(snoozeUpdate({ attempts: 1, snoozeUntil: "2026-10-22T18:00:00Z", nowIso: NOW }))
      .toEqual({
        status: "pending",
        attempts: 0,
        next_retry_at: "2026-10-22T18:00:00.000Z",
        updated_at: NOW,
      });
  });

  it("never goes below zero attempts", () => {
    expect(snoozeUpdate({ attempts: 0, snoozeUntil: "2026-10-22T18:00:00Z", nowIso: NOW })!.attempts)
      .toBe(0);
  });

  it("five consecutive snoozes leave attempts at zero (no dead-letter by deferral)", () => {
    let attempts = 0;
    for (let i = 0; i < 5; i += 1) {
      // claim_jobs increments before the handler runs; the handler defers.
      const claimed = attempts + 1;
      const update = snoozeUpdate({
        attempts: claimed,
        snoozeUntil: "2026-10-22T18:00:00Z",
        nowIso: NOW,
      });
      expect(update).toEqual({
        status: "pending",
        attempts: 0,
        next_retry_at: "2026-10-22T18:00:00.000Z",
        updated_at: NOW,
      });
      attempts = update!.attempts;
    }
    expect(attempts).toBe(0);
  });

  it("an unparseable snooze_until is a caller error, not a silent completion", () => {
    expect(snoozeUpdate({ attempts: 1, snoozeUntil: "tomorrow", nowIso: NOW })).toBeNull();
  });
});
