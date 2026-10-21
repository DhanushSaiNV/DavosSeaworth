// supabase/functions/_shared/accountability/templates.ts
// FP-08 Step 2 — the deterministic texts (FR-19's fallback, FR-21's fire leg).
//
// Refs: FP-08 FR-19, FR-21; TECH-SPEC §7.5, §7.8, §8; D11, D22.
//
// Server-only and in-code by design: the preemptive ping text is deterministic (no model call
// in the fire leg), and the Strike template is the post-claim-check fallback — evidence numbers
// only, never a goal claim. Both texts are part of the product voice: change them via review,
// not at runtime.

/** The evidence fields the fallback renders — structurally `StrikeGroundTruth` + the watch. */
export interface StrikeEvidence {
  doings_count: number;
  hours_logged: number;
  missed_windows: number;
  impulse_failures: number;
  watch_started_at: string;
  strike_at: string;
  watch_days: number;
}

/** Human label for a bucket hour, `HH:00`. */
function hourLabel(hour: number): string {
  return `${String(Math.max(0, Math.min(23, Math.round(hour)))).padStart(2, "0")}:00`;
}

/**
 * FR-21's preemptive text. With an activity: names it plainly. With none (the empty-list
 * degradation): the generic alternative suggestion. Lead time is fixed at
 * `preemptive_lead_minutes` in the send, so the text says "15 minutes" only when that is the
 * live value — the caller passes it in.
 */
export function preemptiveText(
  activity: string | null | undefined,
  bucketHour: number,
  leadMinutes = 15,
): string {
  const window = `${hourLabel(bucketHour)}`;
  const lead = Number.isFinite(leadMinutes) ? Math.max(1, Math.round(leadMinutes)) : 15;
  if (typeof activity === "string" && activity.trim().length > 0) {
    return `Danger window at ${window}. ${lead} minutes before it starts: do ${activity.trim()} instead. ` +
      "One swap, nothing more.";
  }
  return `Danger window at ${window}. ${lead} minutes before it starts, pick one alternative you can begin right now — ` +
    "the point is to break the pattern before it starts, not to win the day.";
}

/** `YYYY-MM-DD` → "21 October 2026" (deterministic, locale-free). */
function formatDate(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  const names = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const d = new Date(parsed);
  return `${d.getUTCDate()} ${names[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * FR-19's fallback Strike: evidence numbers only, no goal claims, no model call. Every figure
 * is a ground-truth field, so the text passes the claim-check by construction (the caller's
 * post-write assertion in Step 7 relies on it).
 */
export function strikeTemplate(evidence: StrikeEvidence): string {
  const days = Number.isFinite(evidence.watch_days) ? Math.max(0, Math.round(evidence.watch_days)) : 0;
  return [
    `Here is the record, not an opinion. Since ${formatDate(evidence.watch_started_at)}:`,
    `${evidence.doings_count} doings logged,`,
    `${evidence.hours_logged} hours accounted for,`,
    `${evidence.missed_windows} check-in windows missed,`,
    `${evidence.impulse_failures} impulse failures logged.`,
    `The watch ran ${days} days. You asked me to hold you to this — so I am, with the numbers, not a story about them.`,
  ].join(" ");
}
