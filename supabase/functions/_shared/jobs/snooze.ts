// supabase/functions/_shared/jobs/snooze.ts
// FP-08 Step 7 — the dispatcher's snooze convention (TECH-SPEC §2.2).
//
// A handler that must defer *without* doing its work returns `{snooze_until}`. The
// dispatcher then resets the row to `pending`, pushes `next_retry_at` to the requested
// instant, and **decrements `attempts`** — `claim_jobs` already incremented it, and a
// deferral is not an attempt (the budget-release precedent). Without the decrement, five
// consecutive S1/S2 deferrals would dead-letter a Strike that never ran (FR-19).
//
// Pure (no Deno, no client) so jest can load it with the rest of the decision tables.

/** The columns a snooze writes; `updated_at` is supplied by the caller. */
export interface JobSnoozeUpdate {
  status: "pending";
  attempts: number;
  next_retry_at: string;
  updated_at: string;
}

/**
 * Build the row update for one snooze. Returns `null` for an unparseable `snooze_until`
 * (a handler defect the caller must surface, never silently consume).
 */
export function snoozeUpdate(args: {
  attempts: number;
  snoozeUntil: string;
  nowIso: string;
}): JobSnoozeUpdate | null {
  const until = Date.parse(args.snoozeUntil);
  if (!Number.isFinite(until)) return null;
  const claimed = Number.isFinite(args.attempts) ? Math.max(0, Math.floor(args.attempts)) : 0;
  return {
    status: "pending",
    attempts: Math.max(claimed - 1, 0),
    next_retry_at: new Date(until).toISOString(),
    updated_at: args.nowIso,
  };
}
