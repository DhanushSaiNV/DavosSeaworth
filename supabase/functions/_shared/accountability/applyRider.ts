// supabase/functions/_shared/accountability/applyRider.ts
// FP-08 Step 3 — the thin apply half of the D20 rider (FR-2, FR-4, FR-8).
//
// Refs: FP-08 FR-2, FR-4, FR-8, FR-18; TECH-SPEC §5.3–5.4, §3.2, §3.4, §11; D8, D20, D21.
//
// The decisions live in the zero-import modules beside this file (`rider.ts` and friends); this
// file is the only place that touches the database, and the only writer of `trust_events`,
// `profiles.trust_score` / `dialog_state` and the `strike_fire` jobs. That single-writer rule is
// a static gate in `scripts/verify-fp08-step3.py`.
//
// Idempotency and failure posture:
//   * A neutral turn (no flags, no live habits, OPEN) issues the reads and zero writes (FR-2's
//     floor, asserted live in the Step 3 gate).
//   * The apply throws on a DB error and every caller catches — a rider failure is logged and
//     never 500s a turn (the auto-adopt precedent, FR-2's non-fatal clause).
//   * The journal path applies at most once because `journal_extract` writes its re-run marker
//     in the same step: a re-claim skips extraction *and* the apply (a missed award is the
//     acceptable side, a double award is not).
//   * Habit transitions are read-then-write; the tiny concurrent-turn race is acceptable at the
//     5-user basis and self-heals (a second `watch` update is a no-op; one duplicate
//     `strike_fire` job would be a harmless second nudge).

import { getConfigNumber, supabaseService } from "../config.ts";
import { localWallToUtcMs } from "../checkin/windows.ts";
import {
  clampBandShift,
  clampTrustScore,
  decideRider,
  type LiveHabit,
  type RiderSignals,
  type TrustReason,
} from "./rider.ts";

const HABIT_LIVE_STATUSES = ["detected", "confronted", "watch"] as const;

/** Drill-facing report. Never returned to a client surface. */
export interface RiderProbe {
  applied: boolean;
  reason?: "no_profile";
  trust_before?: number;
  trust_after?: number;
  events?: number;
  habits?: number;
  strike_jobs?: number;
  lockdown?: { enter: boolean; exit: boolean; refresh_started_at: boolean };
  dialog_state?: "OPEN" | "LOCKDOWN";
}

/** `YYYY-MM-DD` in the zone at `ms` (`en-CA` formats exactly that way). */
function localDateIn(timezone: string, ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * The `strike_at` local date at `strike_fire_local_hour` in the user's zone. A reading that does
 * not exist (the spring-forward gap) falls back to the naive UTC stamp — the job still fires,
 * an hour off, rather than never.
 */
function strikeFireInstant(timezone: string, strikeAt: string, hour: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(strikeAt);
  const h = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.round(hour))) : 18;
  if (!match) return new Date().toISOString();
  const at = localWallToUtcMs(timezone, Number(match[1]), Number(match[2]), Number(match[3]), h, 0);
  if (at === null) return `${strikeAt}T${String(h).padStart(2, "0")}:00:00Z`;
  return new Date(at).toISOString();
}

/**
 * Apply the rider for one turn. `signals` is the normalized set; `quitSignal` is stage 2's
 * probability (chat turns) and `severity` the journal label (journal turns). Returns the probe.
 */
export async function applyTrustRider(args: {
  userId: string;
  signals: RiderSignals;
  quitSignal?: number | null;
  severity?: "S1" | "S2" | "S3" | null;
  nowIso?: string;
}): Promise<RiderProbe> {
  const nowIso = args.nowIso ?? new Date().toISOString();

  const { data: profile, error: profileError } = await supabaseService
    .from("profiles")
    .select("trust_score, dialog_state, lockdown_started_at, timezone")
    .eq("id", args.userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { applied: false, reason: "no_profile" };

  const [watchDays, breakerHours, quitThreshold, strikeHour] = await Promise.all([
    getConfigNumber("strike_watch_days_default"),
    getConfigNumber("lockdown_circuit_breaker_hours"),
    getConfigNumber("quit_signal_threshold"),
    getConfigNumber("strike_fire_local_hour"),
  ]);

  const { data: habitRows, error: habitsError } = await supabaseService
    .from("habits")
    .select("id, status")
    .eq("user_id", args.userId)
    .in("status", HABIT_LIVE_STATUSES);
  if (habitsError) throw habitsError;

  const timezone = (profile.timezone as string | null) || "UTC";
  const trustBefore = clampTrustScore(Number(profile.trust_score ?? 0));
  const dialogState = (profile.dialog_state as "OPEN" | "LOCKDOWN" | null) ?? "OPEN";

  const decision = decideRider(args.signals, {
    trust_score: trustBefore,
    dialog_state: dialogState,
    lockdown_started_at: (profile.lockdown_started_at as string | null) ?? null,
    live_habits: (habitRows ?? []) as LiveHabit[],
    local_date: localDateIn(timezone, Date.parse(nowIso)),
    watch_days: watchDays,
    breaker_hours: breakerHours,
    quit_signal: args.quitSignal ?? null,
    quit_signal_threshold: quitThreshold,
    severity: args.severity ?? null,
    now_iso: nowIso,
  });

  const probe: RiderProbe = {
    applied: true,
    trust_before: trustBefore,
    trust_after: clampTrustScore(trustBefore + decision.trust_delta),
    events: decision.trust_events.length,
    habits: decision.habit_updates.length,
    strike_jobs: decision.strike_jobs.length,
    lockdown: decision.lockdown,
    dialog_state: decision.dialog_state,
  };

  if (!decision.changed) return probe;

  if (decision.trust_delta !== 0) {
    const { error } = await supabaseService
      .from("profiles")
      .update({ trust_score: probe.trust_after })
      .eq("id", args.userId);
    if (error) throw error;
  }

  if (decision.trust_events.length > 0) {
    const rows: Array<{ user_id: string; reason: TrustReason; delta: number }> =
      decision.trust_events.map((event) => ({
        user_id: args.userId,
        reason: event.reason,
        delta: event.delta,
      }));
    const { error } = await supabaseService.from("trust_events").insert(rows);
    if (error) throw error;
  }

  for (const update of decision.habit_updates) {
    const patch: Record<string, unknown> = { status: update.status };
    if (update.status === "watch") {
      patch.watch_started_at = update.watch_started_at;
      patch.strike_at = update.strike_at;
    }
    const { error } = await supabaseService.from("habits").update(patch).eq("id", update.id);
    if (error) throw error;
  }

  for (const job of decision.strike_jobs) {
    const { error } = await supabaseService.from("jobs").insert({
      type: "strike_fire",
      payload: { user_id: args.userId, habit_id: job.habit_id },
      next_retry_at: strikeFireInstant(timezone, job.strike_at, strikeHour),
    });
    if (error) throw error;
  }

  if (decision.lockdown.exit) {
    const { error } = await supabaseService
      .from("profiles")
      .update({ dialog_state: "OPEN", lockdown_started_at: null })
      .eq("id", args.userId);
    if (error) throw error;
  } else if (decision.lockdown.enter || decision.lockdown.refresh_started_at) {
    const { error } = await supabaseService
      .from("profiles")
      .update({ dialog_state: "LOCKDOWN", lockdown_started_at: nowIso })
      .eq("id", args.userId);
    if (error) throw error;
  }

  return probe;
}

/**
 * FR-4's override half: the consumed chip tap writes `persona_stats.user_overrides++`,
 * `band_shift -= 0.02` (floor −0.10), and the `trust_events('override', 0)` audit row.
 * The row is audit, not a delta — an override is not a trust signal (recorded reading).
 */
export async function applyPersonaOverride(userId: string, domain: string): Promise<void> {
  const { data, error } = await supabaseService
    .from("persona_stats")
    .select("user_overrides, band_shift")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw error;

  const { error: upsertError } = await supabaseService.from("persona_stats").upsert(
    {
      user_id: userId,
      domain,
      user_overrides: Number(data?.user_overrides ?? 0) + 1,
      band_shift: clampBandShift(Number(data?.band_shift ?? 0), -0.02),
    },
    { onConflict: "user_id,domain" },
  );
  if (upsertError) throw upsertError;

  const { error: eventError } = await supabaseService.from("trust_events").insert({
    user_id: userId,
    reason: "override",
    delta: 0,
  });
  if (eventError) throw eventError;
}

/**
 * FR-4's success half: the auto-adopt increment additionally raises `band_shift` by +0.01
 * (cap +0.10). The counter itself is the RPC (`increment_auto_adopt_successes`); this only
 * moves the band, so the two always land together at the one call site.
 */
export async function applyAutoAdoptBandShift(userId: string, domain: string): Promise<void> {
  const { data, error } = await supabaseService
    .from("persona_stats")
    .select("band_shift")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw error;

  const { error: upsertError } = await supabaseService.from("persona_stats").upsert(
    {
      user_id: userId,
      domain,
      band_shift: clampBandShift(Number(data?.band_shift ?? 0), 0.01),
    },
    { onConflict: "user_id,domain" },
  );
  if (upsertError) throw upsertError;
}
