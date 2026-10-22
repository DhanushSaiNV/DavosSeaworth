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

import { getConfig, getConfigNumber, supabaseService } from "../config.ts";
import { localWallToUtcMs } from "../checkin/windows.ts";
import {
  clampBandShift,
  clampTrustScore,
  decideRider,
  impulseCandorCredit,
  type LiveHabit,
  type RiderSignals,
  type TrustReason,
} from "./rider.ts";
import { shouldExit } from "./lockdown.ts";
import { awardStreak } from "./streak.ts";
import { OATH_REQUEST_REASON, shouldRequestOath } from "./interventions.ts";

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

// ============================================================================
// FR-7 / FR-8: the turn-start dialog read (with the lazy circuit breaker)
// ============================================================================

export interface TurnDialogState {
  state: "OPEN" | "LOCKDOWN";
  /** `config.lockdown_accountability_domains` (the §11 default when unreadable). */
  domains: string[];
  /** True when this read performed the lazy 24 h exit. */
  breakerExited: boolean;
}

/**
 * The lockdown override's turn-start read (FR-7). The breaker is lazy by design — no job
 * consumes it, so every turn checks it; when it fires, this call writes the exit and reports
 * OPEN for the same turn. A failed exit write is tolerated: the turn still answers OPEN and
 * the next turn retries (the row stays LOCKDOWN, which is the only durable failure mode).
 *
 * This lives beside `applyTrustRider` on purpose: `applyRider.ts` remains the only writer of
 * `profiles.dialog_state`, so a single static rule covers every transition.
 */
export async function readTurnDialogState(
  userId: string,
  nowIso = new Date().toISOString(),
): Promise<TurnDialogState> {
  const [breakerHours, rawDomains] = await Promise.all([
    getConfigNumber("lockdown_circuit_breaker_hours"),
    getConfig("lockdown_accountability_domains"),
  ]);
  const domains = Array.isArray(rawDomains)
    ? rawDomains.filter((d): d is string => typeof d === "string" && d.length > 0)
    : [];

  const { data: profile, error } = await supabaseService
    .from("profiles")
    .select("dialog_state, lockdown_started_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return { state: "OPEN", domains, breakerExited: false };

  const state = (profile.dialog_state as "OPEN" | "LOCKDOWN" | null) ?? "OPEN";
  const startedAt = (profile.lockdown_started_at as string | null) ?? null;
  if (state === "LOCKDOWN" && shouldExit(null, startedAt, nowIso, breakerHours)) {
    // `.eq("dialog_state", "LOCKDOWN")` keeps the write idempotent when two turns race the
    // breaker; both may write, but neither can flip a freshly re-entered lock back to OPEN.
    const { error: exitError } = await supabaseService
      .from("profiles")
      .update({ dialog_state: "OPEN", lockdown_started_at: null })
      .eq("id", userId)
      .eq("dialog_state", "LOCKDOWN");
    if (exitError) {
      console.warn("[accountability] lazy breaker exit failed:", exitError.message);
    } else {
      console.log(JSON.stringify({ tag: "[accountability]", event: "breaker_exit", userId }));
    }
    return { state: "OPEN", domains, breakerExited: true };
  }
  return { state, domains, breakerExited: false };
}

// ============================================================================
// FR-10: the oath trigger (send-message's post-rider step)
// ============================================================================

export interface OathTriggerResult {
  requested: boolean;
  reason?: string;
}

/**
 * FR-10 / AC-4: `admission ∧ trust_score ≥ trust_threshold ∧ no request in the trailing
 * cooldown` → one `intervention` job (reason `oath_request`) carrying the source message id.
 *
 * The score is the turn's **pre-rider** score (`riderProbe.trust_before`): AC-4's "plant 69 +
 * admission → no request" must hold even though the rider's own admission bonus would lift 69
 * to 79. The cooldown counts both written request rows and live jobs, so a slow/retrying job
 * cannot be double-enqueued by a repair run; the source-message check makes a Step 5a repair
 * idempotent.
 */
export async function maybeRequestOath(args: {
  userId: string;
  admission: boolean | null | undefined;
  trustBefore: number | null | undefined;
  sourceMessageId: string | null | undefined;
}): Promise<OathTriggerResult> {
  const trustThreshold = await getConfigNumber("trust_threshold");
  const base = {
    admission: args.admission,
    trustBefore: args.trustBefore,
    trustThreshold,
    recentRequests: 0,
  };
  if (!shouldRequestOath(base)) return { requested: false, reason: "gate" };

  const cooldownDays = await getConfigNumber("oath_request_cooldown_days");
  const since = new Date(
    Date.now() - Math.max(0, cooldownDays) * 86_400_000,
  ).toISOString();

  const [recentRows, recentJobs] = await Promise.all([
    supabaseService
      .from("messages")
      .select("id")
      .eq("user_id", args.userId)
      .eq("metadata->>source", "oath_request")
      .gte("created_at", since)
      .limit(1),
    supabaseService
      .from("jobs")
      .select("id")
      .eq("type", "intervention")
      .eq("payload->>reason", OATH_REQUEST_REASON)
      .eq("payload->>user_id", args.userId)
      .in("status", ["pending", "claimed", "running"])
      .gte("created_at", since)
      .limit(1),
  ]);
  if (recentRows.error) throw recentRows.error;
  if (recentJobs.error) throw recentJobs.error;

  const recentRequests = (recentRows.data?.length ?? 0) + (recentJobs.data?.length ?? 0);
  if (!shouldRequestOath({ ...base, recentRequests })) {
    return { requested: false, reason: "cooldown" };
  }

  if (args.sourceMessageId) {
    const { data: existingRow, error: rowError } = await supabaseService
      .from("messages")
      .select("id")
      .eq("user_id", args.userId)
      .eq("metadata->>source", "oath_request")
      .eq("metadata->>source_message_id", args.sourceMessageId)
      .limit(1);
    if (rowError) throw rowError;
    if ((existingRow?.length ?? 0) > 0) return { requested: false, reason: "already_requested" };

    const { data: existingJob, error: jobError } = await supabaseService
      .from("jobs")
      .select("id")
      .eq("type", "intervention")
      .eq("payload->>reason", OATH_REQUEST_REASON)
      .eq("payload->>source_message_id", args.sourceMessageId)
      .limit(1);
    if (jobError) throw jobError;
    if ((existingJob?.length ?? 0) > 0) return { requested: false, reason: "job_pending" };
  }

  const { error: insertError } = await supabaseService.from("jobs").insert({
    type: "intervention",
    payload: {
      user_id: args.userId,
      reason: OATH_REQUEST_REASON,
      source_message_id: args.sourceMessageId ?? null,
    },
    next_retry_at: new Date().toISOString(),
  });
  if (insertError) throw insertError;

  console.log(
    JSON.stringify({
      tag: "[accountability]",
      event: "oath_requested",
      userId: args.userId,
      trustBefore: args.trustBefore,
      sourceMessageId: args.sourceMessageId ?? null,
    }),
  );
  return { requested: true };
}

/**
 * FP-08 FR-3/FR-12: the drift scan's streak award. Still the rider module's write because the
 * single-writer rule (TECH-SPECS §5.3) covers every `trust_score`/`trust_events` write.
 *
 * Dedup is by **local day**, not by scan: the scan runs every 10 minutes and a naive award would
 * add +2 every tick. `awardStreak` decides, `trust_events` gets the audit row, and the profile
 * update follows it (the rider's order). A zero award writes nothing.
 */
export async function applyStreakAward(args: {
  userId: string;
  streak: number;
  timezone: string;
  nowMs?: number;
}): Promise<{ awarded: boolean; trust_before: number; trust_after: number }> {
  const { data: profile, error: profileError } = await supabaseService
    .from("profiles")
    .select("trust_score")
    .eq("id", args.userId)
    .maybeSingle();
  if (profileError) throw new Error(`profiles read failed: ${profileError.message}`);
  const before = Number(profile?.trust_score ?? 0);

  const nowMs = args.nowMs ?? Date.now();
  const today = localDateIn(args.timezone, nowMs);
  // 26 h covers the local day even across a DST shift; the exact match below is on local dates.
  const sinceIso = new Date(nowMs - 26 * 3_600_000).toISOString();
  const { data: events, error: eventsError } = await supabaseService
    .from("trust_events")
    .select("created_at")
    .eq("user_id", args.userId)
    .eq("reason", "streak")
    .gte("created_at", sinceIso);
  if (eventsError) throw new Error(`trust_events read failed: ${eventsError.message}`);
  const alreadyAwardedToday = (events ?? []).some((row) =>
    localDateIn(args.timezone, Date.parse(String(row.created_at))) === today
  );

  const delta = awardStreak(args.streak, alreadyAwardedToday);
  if (delta === 0) return { awarded: false, trust_before: before, trust_after: before };

  const after = clampTrustScore(before + delta);
  const { error: eventError } = await supabaseService.from("trust_events").insert({
    user_id: args.userId,
    delta: after - before,
    reason: "streak",
  });
  if (eventError) throw new Error(`trust_events insert failed: ${eventError.message}`);

  const { error: updateError } = await supabaseService
    .from("profiles")
    .update({ trust_score: after })
    .eq("id", args.userId);
  if (updateError) throw new Error(`profiles update failed: ${updateError.message}`);

  return { awarded: after !== before, trust_before: before, trust_after: after };
}

/**
 * FP-08 FR-20 / FR-2: the impulse candor credit. A self-logged failure is an honest act, so
 * the first `IMPULSE_CANDOR_CAP_PER_DAY` (3) logged impulses in the user's local day each earn
 * +1 `openness`; the fourth and later earn nothing. The count is the `doings_logs` rows
 * themselves (the truthful record — no extra bookkeeping), read **after** the caller's insert.
 *
 * Still the rider module's write: `log-impulse` is a sync path with no turn, but the
 * single-writer rule (TECH-SPECS §5.3) covers every `trust_score`/`trust_events` write. As
 * with the streak award, a zero award writes nothing. The caller treats a throw as non-fatal:
 * the impulse row is already committed.
 */
export async function applyImpulseCandorCredit(args: {
  userId: string;
  timezone: string;
  nowMs?: number;
}): Promise<{ awarded: boolean; credits_today: number; trust_before: number; trust_after: number }> {
  const { data: profile, error: profileError } = await supabaseService
    .from("profiles")
    .select("trust_score")
    .eq("id", args.userId)
    .maybeSingle();
  if (profileError) throw new Error(`profiles read failed: ${profileError.message}`);
  const before = Number(profile?.trust_score ?? 0);

  const nowMs = args.nowMs ?? Date.now();
  const today = localDateIn(args.timezone, nowMs);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!parts) return { awarded: false, credits_today: 0, trust_before: before, trust_after: before };
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const startMs = localWallToUtcMs(args.timezone, y, mo, d, 0, 0);
  const endMs = localWallToUtcMs(
    args.timezone,
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
  );
  if (startMs === null || endMs === null) {
    return { awarded: false, credits_today: 0, trust_before: before, trust_after: before };
  }

  const { count, error: countError } = await supabaseService
    .from("doings_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .eq("kind", "impulse_failure")
    .gte("logged_at", new Date(startMs).toISOString())
    .lt("logged_at", new Date(endMs).toISOString());
  if (countError) throw new Error(`impulse candor count failed: ${countError.message}`);

  const creditsToday = Math.max(0, Number(count ?? 0));
  const delta = impulseCandorCredit(creditsToday - 1);
  if (delta === 0) {
    return { awarded: false, credits_today: creditsToday, trust_before: before, trust_after: before };
  }

  const after = clampTrustScore(before + delta);
  if (after === before) {
    return { awarded: false, credits_today: creditsToday, trust_before: before, trust_after: before };
  }

  const { error: eventError } = await supabaseService.from("trust_events").insert({
    user_id: args.userId,
    delta: after - before,
    reason: "openness",
  });
  if (eventError) throw new Error(`trust_events insert failed: ${eventError.message}`);

  const { error: updateError } = await supabaseService
    .from("profiles")
    .update({ trust_score: after })
    .eq("id", args.userId);
  if (updateError) throw new Error(`profiles update failed: ${updateError.message}`);

  return {
    awarded: true,
    credits_today: creditsToday,
    trust_before: before,
    trust_after: after,
  };
}
