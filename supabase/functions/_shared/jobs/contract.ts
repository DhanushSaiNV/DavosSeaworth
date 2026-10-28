// supabase/functions/_shared/jobs/contract.ts
// FP-10 Step 2 - the dispatcher's four semantics as pure arithmetic (TECH-SPEC §2.2).
//
// The dispatcher entry point cannot be imported by jest (module-level `Deno.env`), so the
// parts of §2.2 that are arithmetic rather than I/O live here and the dispatcher imports
// them. One implementation, pinned by `contract.test.ts`, so a drift in backoff, the
// dead-letter threshold, the budget release or the lease window fails a unit test instead
// of a live tick.
//
// Nothing here touches the network, a clock, or a client: every time value is a parameter.

/** §2.2: `next_retry_at = now() + 2^(attempts-1) * 30s`. Attempts are 1-based (post-claim). */
export function backoffSecondsFor(attempt: number): number {
  const claimed = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return Math.pow(2, claimed - 1) * 30;
}

/**
 * §2.2: dead at `max_attempts`, failed before it. `attempt` is the post-claim count, so an
 * attempt of `max_attempts` is the last one that may run.
 */
export function failedStatusFor(attempt: number, maxAttempts: number): "failed" | "dead" {
  const claimed = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const max = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : 1;
  return claimed >= max ? "dead" : "failed";
}

/** The columns a budget release writes; the caller scopes the update to its own claim. */
export interface JobReleaseUpdate {
  status: "pending";
  attempts: number;
  updated_at: string;
}

/**
 * §2.2's budget release: a claimed-but-never-started job returns to `pending` with the
 * claim increment handed back - it must not move toward dead-letter. The lease path
 * deliberately does not do this (`leaseResetCutoff` below): a killed invocation may already
 * have run the handler, so that increment is the safety valve.
 */
export function releaseUpdate(attempts: number, nowIso: string): JobReleaseUpdate {
  const claimed = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  return {
    status: "pending",
    attempts: Math.max(claimed - 1, 0),
    updated_at: nowIso,
  };
}

/**
 * §2.2's lease recovery: `running` rows whose `updated_at` is older than the lease window
 * return to `pending` (attempt increment kept, by design).
 */
export function leaseResetCutoff(nowMs: number, leaseMinutes: number): string {
  const minutes = Number.isFinite(leaseMinutes) ? Math.max(0, leaseMinutes) : 0;
  return new Date(nowMs - minutes * 60 * 1000).toISOString();
}
