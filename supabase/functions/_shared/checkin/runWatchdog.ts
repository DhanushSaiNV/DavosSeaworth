// supabase/functions/_shared/checkin/runWatchdog.ts
// FP-04 Step 6 — the check-in watchdog's **impure** half: the profiles walk, the two lookups
// behind the missed-window decision, the `intervention` job insert, and the intervention itself
// (context → generation → unprompted assistant row → high-priority push).
//
// Refs: FP-04 FR-15, FR-16, FR-18; TECH-SPEC §2.2–2.3, §7.1, §7.10, §8, §11; D2, D9, D12.
//
// Split from `watchdog.ts` for the same reason `loadGrid.ts` is split from `windows.ts`: this
// half touches the service client (which reads `Deno.env` at module load), so it cannot be the
// module under test. The decisions it consumes and produces are pinned in `watchdog.test.ts`.
//
// Both entry points are shared, not duplicated: the `job-dispatcher` registers the two handlers
// over them, and `dev-smoke ?action=watchdog-scan` drives the same scan for the AC-8 drill.
// A second copy of the scan for the drill would be a second thing to drift (NFR-7's argument,
// applied to the implementation rather than to the grid).
//
// Service role throughout: `jobs`, `messages`, `doings_logs` and `profiles` are all written from
// inside an Edge Function, which is the only place a service-role write may happen
// (AGENTS.md §4.1). RLS is untouched; the client has no path to any of this.

import { getConfigNumber, getConfigString, supabaseService } from "../config.ts";
import { FALLBACK_DOMAIN } from "../pipeline/persona.ts";
import { createAiMessagePushPayload, createHighPriorityPushPayload, sendPush } from "../push.ts";
import { loadGrid } from "./loadGrid.ts";
import { windowsClosedBetween, windowsForLocalDay, type GridWindow } from "./windows.ts";
import {
  buildInterventionContext,
  MISSED_CHECKIN_REASON,
  selectMissedWindows,
  type ThreadLine,
} from "./watchdog.ts";
import {
  BREAKDOWN_REASON,
  OATH_REQUEST_REASON,
  buildBreakdownContext,
  buildDriftConfrontationContext,
  buildHabitConfrontationContext,
  buildOathRequestContext,
  type BreakdownFacts,
  type DriftFacts,
  type QuestOffer,
} from "../accountability/interventions.ts";
import {
  HABIT_CONFRONTATION_REASON,
  isDriftReason,
  type DriftPattern,
} from "../accountability/drift.ts";
import { HABIT_WINDOW_DAYS, driftFactsFromEvidence, loadDriftEvidence } from "../accountability/runDriftScan.ts";
import { isPublicQuestProposal, proposeMetric } from "../metrics/propose.ts";
import { streakDays, type DayCompliance } from "../accountability/streak.ts";

const iso = (ms: number) => new Date(ms).toISOString();

/** ~100 chars, matching `createAiMessagePushPayload`'s notification preview (§7.10). */
function pushPreview(content: string): string {
  return content.length > 100 ? content.slice(0, 97) + "..." : content;
}

export interface WatchdogAlert {
  userId: string;
  /** The canonical window **start**, ISO-8601 — the same key `checkin_window` stores (§7.1). */
  window: string;
}

export interface WatchdogScanResult {
  nowMs: number;
  profiles: number;
  /** Candidate windows the scan looked at, before the answered/queued filters (FR-18). */
  considered: number;
  alerts: WatchdogAlert[];
  /** Users the scan could not evaluate, and why. One user never blocks the others. */
  skipped: Array<{ userId: string; reason: string }>;
}

/**
 * The watchdog scan (FR-15): for every profile, insert an `intervention` job for each window that
 * closed between `watchdog_grace_minutes` and `watchdog_lookback_minutes` ago with no submission.
 *
 * Robustness contract, deliberately different from `submit-checkin`'s: `loadGrid` returning null
 * is **fail-closed for that user only** (skip + log + keep scanning). A single profile with a
 * misconfigured cadence or an unknown zone must not stop the other four users' watchdogs — a
 * batch job's failure mode is the batch, not the row.
 *
 * `userId` narrows the walk to one profile and exists for the AC-8 drill, which must not nudge
 * every beta user. The production path (the `watchdog_checkin` handler) passes no filter, so the
 * cron scan is every profile, as FR-15 requires; the onboarding-stage gate lands with the
 * onboarding FP.
 */
export async function runWatchdogScan(args: {
  nowMs: number;
  userId?: string;
}): Promise<WatchdogScanResult> {
  const { nowMs, userId } = args;

  const [graceMinutes, lookbackMinutes] = await Promise.all([
    getConfigNumber("watchdog_grace_minutes"),
    getConfigNumber("watchdog_lookback_minutes"),
  ]);
  const graceMs = graceMinutes * 60_000;
  const lookbackMs = lookbackMinutes * 60_000;

  let profilesQuery = supabaseService.from("profiles").select("id");
  if (userId) profilesQuery = profilesQuery.eq("id", userId);
  const { data: profiles, error: profilesError } = await profilesQuery;
  if (profilesError) {
    throw new Error(`watchdog: could not list profiles: ${profilesError.message}`);
  }

  const alerts: WatchdogAlert[] = [];
  const skipped: Array<{ userId: string; reason: string }> = [];
  let considered = 0;

  for (const profile of profiles ?? []) {
    const uid = profile.id as string;

    const grid = await loadGrid(uid);
    if (!grid) {
      skipped.push({ userId: uid, reason: "no_grid" });
      continue;
    }

    // The candidate set, before evidence: closes in (now - lookback, now - grace] (FR-15).
    const closed = windowsClosedBetween(grid, nowMs - lookbackMs, nowMs - graceMs);
    considered += closed.length;
    if (closed.length === 0) continue;

    // Evidence, one pair of lookups per candidate window. Both predicates are the plain `eq`
    // forms the rest of the codebase already uses — `checkin_window` exactly as `submit-checkin`
    // reads it (§7.1's join key), and `eq` on a jsonb path exactly as `metadata->>doing_id` is
    // read. At most a couple of candidates per scan, so this is cheaper than it reads.
    const answeredStartMs = new Set<number>();
    const queuedStartMs = new Set<number>();
    let evidenceFailed: string | null = null;

    for (const window of closed) {
      const windowIso = iso(window.startMs);

      const { data: answeredRows, error: answeredError } = await supabaseService
        .from("doings_logs")
        .select("id")
        .eq("user_id", uid)
        .eq("checkin_window", windowIso)
        .limit(1);
      if (answeredError) {
        console.error(`[watchdog] doings read failed for ${uid}: ${answeredError.message}`);
        evidenceFailed = "doings_read_failed";
        break;
      }
      if ((answeredRows ?? []).length > 0) answeredStartMs.add(window.startMs);

      // The dedup (FR-16): any `intervention` row for this window, at **any** status — one job
      // per missed window, ever. Narrowing to the in-flight statuses would re-arm the window the
      // moment its job completed, i.e. one no-op claim every 5 minutes for the rest of the
      // lookback's life; the handler's row check would absorb each one, but the queue would fill
      // with work that cannot do anything. A `dead` row also blocks: five failed attempts over
      // ~15 minutes is a real outage, and re-arming would spend ~40 provider attempts re-losing
      // the same nudge (AGENTS.md §3.4's bounded-load rule beats a best-effort guarantee here).
      const { data: queuedRows, error: queuedError } = await supabaseService
        .from("jobs")
        .select("id")
        .eq("type", "intervention")
        .eq("payload->>user_id", uid)
        .eq("payload->>window", windowIso)
        .limit(1);
      if (queuedError) {
        console.error(`[watchdog] jobs read failed for ${uid}: ${queuedError.message}`);
        evidenceFailed = "jobs_read_failed";
        break;
      }
      if ((queuedRows ?? []).length > 0) queuedStartMs.add(window.startMs);
    }

    if (evidenceFailed !== null) {
      skipped.push({ userId: uid, reason: evidenceFailed });
      continue;
    }

    const missed = selectMissedWindows({
      grid,
      nowMs,
      graceMs,
      lookbackMs,
      answeredStartMs,
      queuedStartMs,
    });

    for (const window of missed) {
      const windowIso = iso(window.startMs);
      const { error: insertError } = await supabaseService.from("jobs").insert({
        type: "intervention",
        payload: { user_id: uid, window: windowIso, reason: MISSED_CHECKIN_REASON },
      });
      if (insertError) {
        console.error(`[watchdog] intervention insert failed for ${uid}: ${insertError.message}`);
        skipped.push({ userId: uid, reason: "job_insert_failed" });
        continue;
      }
      alerts.push({ userId: uid, window: windowIso });
    }
  }

  // FR-18: one structured line per scan — windows considered, alerts inserted.
  console.log(
    `[watchdog] scan now=${iso(nowMs)} profiles=${(profiles ?? []).length} ` +
      `considered=${considered} alerts=${alerts.length} skipped=${skipped.length}` +
      (alerts.length > 0 ? ` queued=${JSON.stringify(alerts)}` : "") +
      (skipped.length > 0 ? ` skippedDetail=${JSON.stringify(skipped)}` : ""),
  );

  return { nowMs, profiles: (profiles ?? []).length, considered, alerts, skipped };
}

/** The nudge already written for this window, if any — FR-16's re-claim guard. */
async function findWatchdogIntervention(
  userId: string,
  windowIso: string,
): Promise<string | null> {
  const { data } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "assistant")
    .eq("metadata->>source", "watchdog_intervention")
    .eq("metadata->>watchdog_window", windowIso)
    .limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

export type InterventionOutcome =
  | { status: "written"; assistantMessageId: string; context?: string }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

/**
 * The `intervention` handler's entry point. FP-08 Step 4 adds two non-watchdog reasons:
 * `oath_request` (FR-10) and `breakdown` (FR-11); Step 5 adds the three drift reasons and
 * `habit_confrontation` (FR-12 … FR-14). Only the watchdog path needs a window; the drift
 * branch re-loads its evidence server-side, the habit branch re-reads its row.
 */
export async function runIntervention(args: {
  userId: string;
  windowIso: string | null;
  reason: string;
  jobId: string;
  sourceMessageId?: string | null;
  habitId?: string | null;
  context?: unknown;
}): Promise<InterventionOutcome> {
  if (args.reason === OATH_REQUEST_REASON) {
    return runOathRequestIntervention(args);
  }
  if (args.reason === BREAKDOWN_REASON) {
    return runBreakdownIntervention(args);
  }
  if (isDriftReason(args.reason)) {
    return runDriftIntervention(args);
  }
  if (args.reason === HABIT_CONFRONTATION_REASON) {
    return runHabitConfrontation(args);
  }
  if (!args.windowIso) {
    // Not producible by this codebase for a watchdog reason, and not transient either.
    console.error(
      `[intervention] reason ${args.reason} needs a window on job ${args.jobId}`,
    );
    return { status: "skipped", reason: "window_malformed" };
  }
  return runWatchdogIntervention({
    userId: args.userId,
    windowIso: args.windowIso,
    reason: args.reason,
    jobId: args.jobId,
  });
}

/**
 * The `intervention` handler's body (FR-16, §2.3): generation with the missed window as context
 * and a locked persona, then the **unprompted** assistant row and one high-priority push.
 *
 * Why an unprompted row and not a check-in turn: there is no user text to answer. The watchdog
 * fires precisely because nothing was submitted, so there is nothing to anchor a reply to — the
 * row carries `reply_to_message_id = NULL` and `metadata.source = 'watchdog_intervention'`, which
 * is what §15 records. That also means `messages_one_primary_reply` does not apply, so
 * idempotency rests on the window key: checked before generating, and re-checked by the same
 * lookup on a re-claimed job (a second run writes nothing).
 *
 * Generation reuses the locked-persona path (`runLockedPersonaReply`, the `llm_retry` and
 * `select-persona` precedent) because §7.1/FR-16 fix the persona rather than deriving it from a
 * classification — there is no user message to classify. The domain is the D7 fallback domain,
 * the neutral one that carries no aggressive rules by design (§5.3, §6.4).
 *
 * A transport failure propagates: no client is waiting on an async job, so the honest outcome is
 * a failed job with backoff, not a holding reply.
 */
async function runWatchdogIntervention(args: {
  userId: string;
  windowIso: string;
  reason: string;
  jobId: string;
}): Promise<InterventionOutcome> {
  const { userId, windowIso, reason, jobId } = args;

  const startMs = Date.parse(windowIso);
  if (!Number.isFinite(startMs)) {
    // Not producible by this codebase (the scan writes the payload), and not transient either:
    // looping it through five backoff attempts only burns quota. Log loudly and close the job.
    console.error(`[intervention] unusable window on job ${jobId}:`, JSON.stringify(windowIso));
    return { status: "skipped", reason: "window_malformed" };
  }

  const existing = await findWatchdogIntervention(userId, windowIso);
  if (existing) {
    console.log(
      `[intervention] window ${windowIso} already has the nudge ${existing}; nothing to do`,
    );
    return { status: "duplicate" };
  }

  const [persona, recentLimit, budget] = await Promise.all([
    getConfigString("intervention_persona"),
    getConfigNumber("sliding_window_messages"),
    getConfigNumber("pipeline_deadline_ms"),
  ]);

  // The grid is wanted for the window's local label, not for correctness. Between the scan and
  // this claim the prefs could have changed (or the profile gone); the nudge is still owed, so a
  // missing grid degrades the label instead of dropping the turn.
  const grid = await loadGrid(userId);
  const span =
    grid === null
      ? null
      : windowsForLocalDay(grid, startMs).find((w) => w.startMs === startMs) ?? null;
  const window: GridWindow = span ?? { startMs, closeMs: startMs };

  const { data: threadRows, error: threadError } = await supabaseService
    .from("messages")
    .select("role, content")
    .eq("user_id", userId)
    .eq("unsavable", false) // the §7.6 permission flag: flagged text is never reused as memory
    .order("created_at", { ascending: false })
    .limit(Math.max(0, Math.trunc(recentLimit)));
  if (threadError) {
    throw new Error(`could not load the recent thread for ${userId}: ${threadError.message}`);
  }

  // The query is newest-first (the index order); the prompt wants oldest-first.
  const recent: ThreadLine[] = (threadRows ?? [])
    .map((row) => ({ role: String(row.role), content: String(row.content) }))
    .reverse();

  const context = buildInterventionContext({
    window,
    reason,
    timezone: grid?.timezone ?? "UTC",
    nowMs: Date.now(),
    recent,
  });

  // Imported lazily, deliberately — the `llm_retry` precedent. `_shared/llm/adapter.ts` throws at
  // module load when the provider secrets are absent, and this module is loaded by the function
  // that runs *every* job type. A deployment missing those secrets must break `intervention`
  // alone, as an ordinary job failure with backoff, not as a module-load crash with no job
  // context (§4.1's adapter is the only thing that owns those secrets).
  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");

  const result = await runLockedPersonaReply({
    text: context,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt: Date.now() + budget,
  });

  // tactical_analysis is internal reasoning: logged server-side only, never persisted and never
  // returned anywhere (§4.3). It is the only place this turn's reasoning is observable.
  console.log(
    `[intervention] tactical_analysis (job ${jobId}):`,
    result.tacticalAnalysis,
    JSON.stringify({
      provider: result.provider,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      degraded: result.degraded,
      persona: result.persona,
      domain: result.domain,
    }),
  );

  // The window rides in metadata because that is the only record of *which* missed window
  // produced this row — it is the FR-16 dedup key as well as the audit trail, exactly as
  // `doing_id` is for a check-in turn.
  const metadata: Record<string, unknown> = {
    persona: result.persona,
    domain: result.domain,
    rule_ids: result.ruleIds,
    source: "watchdog_intervention",
    watchdog_window: windowIso,
    source_job_id: jobId,
  };

  const { data: inserted, error: insertError } = await supabaseService
    .from("messages")
    .insert({
      user_id: userId,
      role: "assistant",
      content: result.assistantContent,
      reply_to_message_id: null, // unprompted: no user row to answer (FR-16)
      persona_key: result.persona,
      metadata,
    })
    .select("id");
  if (insertError) {
    throw new Error(`could not write the intervention row for ${userId}: ${insertError.message}`);
  }

  const assistantMessageId = inserted![0].id as string;

  // One high-priority push (FR-16, §7.10). Best-effort and bounded: the row is already committed,
  // so a push failure must not fail the job and burn an attempt re-writing a row that exists.
  try {
    await Promise.race([
      sendPush(
        createHighPriorityPushPayload(
          userId,
          "Davos",
          pushPreview(result.assistantContent),
          "davos://chat",
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    console.error(`[intervention] push send failed:`, err instanceof Error ? err.message : err);
  }

  console.log(
    `[intervention] wrote ${assistantMessageId} for window ${windowIso} (job ${jobId}, persona ${result.persona})`,
  );

  return { status: "written", assistantMessageId };
}

// ============================================================================
// FP-08 Step 4 — the oath and breakdown intervention branches (FR-10, FR-11)
// ============================================================================

/** `YYYY-MM-DD` in the zone at `ms` (the `local_date` key the streak rule consumes). */
function localDateKey(timezone: string, ms: number): string {
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

/** One dedicated row per source message and reason — the new branches' idempotency key. */
async function findInterventionBySource(
  userId: string,
  source: string,
  sourceMessageId: string,
): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>source", source)
    .eq("metadata->>source_message_id", sourceMessageId)
    .limit(1);
  if (error) throw new Error(`intervention dedupe read failed: ${error.message}`);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/**
 * The shared tail of the two new branches: the unprompted row (`reply_to_message_id = NULL`,
 * §15's `oath_request` / `breakdown` sources) plus one high-priority push. The row is committed
 * before the push, and a push failure never fails the job (§7.10).
 */
export async function deliverIntervention(args: {
  userId: string;
  persona: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Interventions are high; the quest debrief is default (FR-16's recorded reading). */
  priority?: "high" | "default";
}): Promise<string> {
  const { data: inserted, error } = await supabaseService
    .from("messages")
    .insert({
      user_id: args.userId,
      role: "assistant",
      content: args.content,
      reply_to_message_id: null,
      persona_key: args.persona,
      metadata: args.metadata,
    })
    .select("id");
  if (error) {
    throw new Error(`could not write the intervention row for ${args.userId}: ${error.message}`);
  }
  const assistantMessageId = inserted![0].id as string;

  try {
    const payload = args.priority === "default"
      ? createAiMessagePushPayload(args.userId, args.content, "davos://chat")
      : createHighPriorityPushPayload(
        args.userId,
        "Davos",
        pushPreview(args.content),
        "davos://chat",
      );
    await Promise.race([
      sendPush(payload),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    console.error(`[intervention] push send failed:`, err instanceof Error ? err.message : err);
  }
  return assistantMessageId;
}

/**
 * FR-10's demand turn: `intervention_persona` (the §5.4 value), the delimited admission
 * as context, an unprompted `metadata.source='oath_request'` row, one high push. The row is the
 * affordance the client confirms; the job's source message is the dedup key. Flagged text is
 * never reused as memory (§7.6), so an `unsavable` admission is skipped.
 */
async function runOathRequestIntervention(args: {
  userId: string;
  jobId: string;
  sourceMessageId?: string | null;
}): Promise<InterventionOutcome> {
  const sourceId = args.sourceMessageId ?? null;
  if (!sourceId) {
    console.error(`[intervention] oath_request on job ${args.jobId} has no source_message_id`);
    return { status: "skipped", reason: "missing_source" };
  }

  const existing = await findInterventionBySource(args.userId, OATH_REQUEST_REASON, sourceId);
  if (existing) {
    console.log(`[intervention] oath for ${sourceId} already demanded (${existing}); duplicate`);
    return { status: "duplicate" };
  }

  const { data: source, error: sourceError } = await supabaseService
    .from("messages")
    .select("content, unsavable")
    .eq("id", sourceId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (sourceError) throw new Error(`oath_request source read failed: ${sourceError.message}`);
  if (!source) return { status: "skipped", reason: "source_missing" };
  if (source.unsavable === true) return { status: "skipped", reason: "unsavable" };

  const [persona, budget] = await Promise.all([
    getConfigString("intervention_persona"),
    getConfigNumber("pipeline_deadline_ms"),
  ]);
  const context = buildOathRequestContext(String(source.content));

  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");
  const result = await runLockedPersonaReply({
    text: context,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt: Date.now() + budget,
  });

  console.log(
    `[intervention] tactical_analysis (oath ${args.jobId}):`,
    result.tacticalAnalysis,
    JSON.stringify({ provider: result.provider, persona: result.persona, domain: result.domain }),
  );

  const assistantMessageId = await deliverIntervention({
    userId: args.userId,
    persona: result.persona,
    content: result.assistantContent,
    metadata: {
      persona: result.persona,
      domain: result.domain,
      rule_ids: result.ruleIds,
      source: OATH_REQUEST_REASON,
      source_message_id: sourceId,
      source_job_id: args.jobId,
      oath_request: true,
    },
  });

  return { status: "written", assistantMessageId, context };
}

/**
 * FR-11's breakdown turn: deterministic day-1→now aggregates, the latest unpurged oath when one
 * exists, one narrative wrap under `breakdown_persona`, an unprompted `metadata.source='breakdown'`
 * row and one high push. It fires regardless of `dialog_state` — support is not confrontation.
 */
async function runBreakdownIntervention(args: {
  userId: string;
  jobId: string;
  sourceMessageId?: string | null;
}): Promise<InterventionOutcome> {
  const sourceId = args.sourceMessageId ?? null;

  if (sourceId) {
    const existing = await findInterventionBySource(args.userId, BREAKDOWN_REASON, sourceId);
    if (existing) {
      console.log(`[intervention] breakdown for ${sourceId} already written (${existing})`);
      return { status: "duplicate" };
    }
  } else {
    // Dev drills carry no source row; dedupe on the hour so a re-claim cannot spam support.
    const { data } = await supabaseService
      .from("messages")
      .select("id")
      .eq("user_id", args.userId)
      .eq("metadata->>source", BREAKDOWN_REASON)
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString())
      .limit(1);
    if ((data?.length ?? 0) > 0) return { status: "duplicate" };
  }

  const [persona, budget, facts] = await Promise.all([
    getConfigString("breakdown_persona"),
    getConfigNumber("pipeline_deadline_ms"),
    loadBreakdownFacts(args.userId),
  ]);
  const context = buildBreakdownContext(facts);

  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");
  const result = await runLockedPersonaReply({
    text: context,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt: Date.now() + budget,
  });

  console.log(
    `[intervention] tactical_analysis (breakdown ${args.jobId}):`,
    result.tacticalAnalysis,
    JSON.stringify({ provider: result.provider, persona: result.persona, domain: result.domain }),
  );

  const assistantMessageId = await deliverIntervention({
    userId: args.userId,
    persona: result.persona,
    content: result.assistantContent,
    metadata: {
      persona: result.persona,
      domain: result.domain,
      rule_ids: result.ruleIds,
      source: BREAKDOWN_REASON,
      source_message_id: sourceId,
      source_job_id: args.jobId,
    },
  });

  return { status: "written", assistantMessageId, context };
}

/**
 * FR-11's aggregates: check-ins + grid compliance from day 1, per-metric first-vs-latest deltas,
 * the streak rule, and the latest unpurged oath. Bounded reads; a metric with fewer than two
 * points is omitted rather than rendered as fake progress.
 */
async function loadBreakdownFacts(userId: string): Promise<BreakdownFacts> {
  const { data: profile } = await supabaseService
    .from("profiles")
    .select("created_at, timezone")
    .eq("id", userId)
    .maybeSingle();
  const timezone = (profile?.timezone as string | null) || "UTC";
  const dayOneMs = profile?.created_at
    ? Date.parse(String(profile.created_at))
    : Date.now() - 30 * 86_400_000;
  const sinceMs = Number.isFinite(dayOneMs) ? dayOneMs : Date.now() - 30 * 86_400_000;
  const since = localDateKey(timezone, sinceMs);
  const nowMs = Date.now();

  const grid = await loadGrid(userId);
  const windows = grid ? windowsClosedBetween(grid, sinceMs, nowMs) : [];
  const windowStarts = new Set(windows.map((w) => w.startMs));

  const { data: doingRows, error: doingError } = await supabaseService
    .from("doings_logs")
    .select("source, checkin_window")
    .eq("user_id", userId)
    .gte("logged_at", new Date(sinceMs).toISOString());
  if (doingError) throw new Error(`breakdown: doings read failed: ${doingError.message}`);
  const rows = doingRows ?? [];
  const checkinCount = rows.filter((row) => row.source === "checkin_reply").length;

  const answeredStarts = new Set<number>();
  for (const row of rows) {
    if (!row.checkin_window) continue;
    const start = Date.parse(String(row.checkin_window));
    if (Number.isFinite(start)) answeredStarts.add(start);
  }
  const answered = windows.filter((window) => answeredStarts.has(window.startMs)).length;

  const byDay = new Map<string, { expected: number; answered: number }>();
  for (const window of windows) {
    const key = localDateKey(timezone, window.startMs);
    const day = byDay.get(key) ?? { expected: 0, answered: 0 };
    day.expected += 1;
    if (windowStarts.has(window.startMs) && answeredStarts.has(window.startMs)) day.answered += 1;
    byDay.set(key, day);
  }
  const todayKey = localDateKey(timezone, nowMs);
  const days: DayCompliance[] = [...byDay.entries()]
    .filter(([day]) => day !== todayKey) // a streak needs closed days; today is still open
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([local_date, day]) => ({ local_date, expected: day.expected, answered: day.answered }));
  const complianceThreshold = await getConfigNumber("drift_compliance_threshold");
  const streak = streakDays(days, complianceThreshold);

  const { data: metricRows, error: metricError } = await supabaseService
    .from("metrics")
    .select("id, name, output_unit")
    .eq("user_id", userId)
    .is("archived_at", null)
    .eq("formula_status", "validated");
  if (metricError) throw new Error(`breakdown: metrics read failed: ${metricError.message}`);

  const metrics: BreakdownFacts["metrics"] = [];
  for (const metric of metricRows ?? []) {
    const { data: points } = await supabaseService
      .from("metric_points")
      .select("value, computed_for")
      .eq("metric_id", metric.id)
      .order("computed_for", { ascending: true })
      .limit(400);
    if (!points || points.length < 2) continue;
    const first = points[0];
    const latest = points[points.length - 1];
    metrics.push({
      name: String(metric.name),
      unit: metric.output_unit ? String(metric.output_unit) : null,
      first: Number(first.value),
      latest: Number(latest.value),
      firstDate: String(first.computed_for),
      latestDate: String(latest.computed_for),
    });
  }

  const { data: oathRows } = await supabaseService
    .from("memory_facts")
    .select("fact, created_at")
    .eq("user_id", userId)
    .eq("fact_type", "oath")
    .is("purged_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const oathRow = oathRows?.[0];
  const oath = oathRow
    ? {
      text: String(oathRow.fact),
      date: localDateKey(timezone, Date.parse(String(oathRow.created_at))),
    }
    : null;

  return {
    since,
    checkinCount,
    expected: windows.length,
    answered,
    streak,
    metrics,
    oath,
  };
}

// ============================================================================
// FP-08 Step 5 — the drift and habit intervention branches (FR-12 … FR-14)
// ============================================================================

/** Reverse the §2.3 reason map to the pattern the context is built for. */
function patternForReason(reason: string): DriftPattern | null {
  if (reason === "drift_late_start") return "late_start";
  if (reason === "drift_compliance_drop") return "compliance_drop";
  if (reason === "drift_energy_slide") return "energy_slide";
  return null;
}

/** The scan writes the deterministic evidence; accept it only when every field is the right shape. */
function isDriftContext(value: unknown): value is DriftFacts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const patterns = ["late_start", "compliance_drop", "energy_slide"];
  if (typeof o.pattern !== "string" || !patterns.includes(o.pattern)) return false;
  if (!Number.isFinite(Number(o.window_days))) return false;
  if (!Number.isFinite(Number(o.late_start_hour))) return false;
  if (!Array.isArray(o.late_days)) return false;
  if (!Number.isFinite(Number(o.expected)) || !Number.isFinite(Number(o.answered))) return false;
  if (!Number.isFinite(Number(o.compliance_rate))) return false;
  if (o.energy_mean !== null && !Number.isFinite(Number(o.energy_mean))) return false;
  return Number.isFinite(Number(o.energized_days));
}

/** One row per job — the job id survives a re-claim, so a retry cannot double-write. */
async function findInterventionByJob(
  userId: string,
  source: string,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>source", source)
    .eq("metadata->>source_job_id", jobId)
    .limit(1);
  if (error) throw new Error(`intervention job dedupe failed: ${error.message}`);
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function hasActiveQuest(userId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("metrics")
    .select("id")
    .eq("user_id", userId)
    .eq("is_quest", true)
    .is("archived_at", null)
    .limit(1);
  if (error) throw new Error(`active quest read failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** The pattern picks the domain the quest is proposed in (§7.9.4's sixteen). */
function questDomainFor(pattern: DriftPattern): "Discipline/Habits" | "Health" {
  return pattern === "energy_slide" ? "Health" : "Discipline/Habits";
}

/**
 * FR-12/FR-14's drift turn: the evidence confrontation plus the Side-Quest offer. The offer is
 * skipped when less than half the invocation budget remains (the confrontation must land) and
 * when an unarchived quest already exists. A gate-failed proposal degrades to a prose mention
 * with no card; a transport failure degrades to no offer at all — never to a missing message.
 */
async function runDriftIntervention(args: {
  userId: string;
  jobId: string;
  reason: string;
  context?: unknown;
}): Promise<InterventionOutcome> {
  const pattern = patternForReason(args.reason);
  if (!pattern) return { status: "skipped", reason: "unknown_pattern" };

  const existing = await findInterventionByJob(args.userId, "drift_intervention", args.jobId);
  if (existing) {
    console.log(`[intervention] ${args.reason} already written for job ${args.jobId} (${existing})`);
    return { status: "duplicate" };
  }

  const startedAt = Date.now();
  const [persona, budget] = await Promise.all([
    getConfigString("intervention_persona"),
    getConfigNumber("pipeline_deadline_ms"),
  ]);
  const deadlineAt = startedAt + Math.max(0, budget);

  let facts: DriftFacts | null = isDriftContext(args.context) ? args.context : null;
  if (!facts) {
    const evidence = await loadDriftEvidence(args.userId, Date.now());
    if (!evidence) return { status: "skipped", reason: "no_grid" };
    facts = driftFactsFromEvidence(evidence, pattern);
  }

  let offer: QuestOffer | null = null;
  let offerMeta: Record<string, unknown> | null = null;
  let described: string | null = null;
  const remaining = deadlineAt - Date.now();
  const reserve = Math.floor(Math.max(0, budget) / 2);
  if (remaining > reserve) {
    try {
      if (await hasActiveQuest(args.userId)) {
        console.log(`[intervention] quest offer skipped (active quest) for ${args.userId}`);
      } else {
        const outcome = await proposeMetric({ domain: questDomainFor(pattern) }, { quest: true });
        if (outcome.status === "validated" && isPublicQuestProposal(outcome.proposal)) {
          const proposal = outcome.proposal;
          offer = {
            name: proposal.name,
            domain: proposal.domain,
            output_unit: proposal.output_unit,
            deadline_days: proposal.deadline_days,
            rationale: proposal.rationale,
          };
          offerMeta = {
            name: proposal.name,
            domain: proposal.domain,
            output_unit: proposal.output_unit,
            formula: proposal.formula,
            deadline_days: proposal.deadline_days,
          };
        } else if (outcome.status === "described") {
          described = outcome.description.description;
        }
        console.log(`[intervention] quest proposal for job ${args.jobId}: ${outcome.status}`);
      }
    } catch (error) {
      // The confrontation is owed regardless: a proposal failure only removes the card.
      console.error(
        `[intervention] quest proposal failed for job ${args.jobId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  } else {
    console.log(`[intervention] quest offer skipped (budget) for job ${args.jobId}`);
  }

  const contextText = buildDriftConfrontationContext({ facts, offer, described });

  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");
  const result = await runLockedPersonaReply({
    text: contextText,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt,
  });

  console.log(
    `[intervention] tactical_analysis (${args.reason} ${args.jobId}):`,
    result.tacticalAnalysis,
    JSON.stringify({ provider: result.provider, persona: result.persona, domain: result.domain }),
  );

  const metadata: Record<string, unknown> = {
    persona: result.persona,
    domain: result.domain,
    rule_ids: result.ruleIds,
    source: "drift_intervention",
    reason: args.reason,
    pattern,
    source_job_id: args.jobId,
  };
  if (offerMeta) metadata.quest_offer = offerMeta;

  const assistantMessageId = await deliverIntervention({
    userId: args.userId,
    persona: result.persona,
    content: result.assistantContent,
    metadata,
  });

  return { status: "written", assistantMessageId, context: contextText };
}

/** The stored description is deterministic; its prefix is the surfacing path (FR-13). */
function habitPatternFromDescription(description: string): "impulse" | "journal" {
  return description.startsWith("Recurring impulse") ? "impulse" : "journal";
}

async function loadHabitCounts(
  userId: string,
): Promise<{ impulses: number; journalFlags: number }> {
  const since = new Date(Date.now() - HABIT_WINDOW_DAYS * 86_400_000).toISOString();
  const [impulses, journalFlags] = await Promise.all([
    supabaseService
      .from("doings_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "impulse_failure")
      .gte("logged_at", since),
    supabaseService
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("habit_flag", true)
      .gte("created_at", since),
  ]);
  if (impulses.error) throw new Error(`habit impulse count failed: ${impulses.error.message}`);
  if (journalFlags.error) throw new Error(`habit journal count failed: ${journalFlags.error.message}`);
  return { impulses: impulses.count ?? 0, journalFlags: journalFlags.count ?? 0 };
}

/**
 * FR-13's confrontation: the deterministic habit description, one direct question, the
 * unprompted `metadata.source='habit_confrontation'` row, then the status flip
 * `detected -> confronted`. The flip is **after** the row: a crash loses the flip (the scan
 * re-arms it), never the message. A re-claimed job finds the row and only repairs the flip.
 */
async function runHabitConfrontation(args: {
  userId: string;
  jobId: string;
  habitId?: string | null;
}): Promise<InterventionOutcome> {
  const habitId = args.habitId ?? null;
  if (!habitId) {
    console.error(`[intervention] habit_confrontation on job ${args.jobId} has no habit_id`);
    return { status: "skipped", reason: "missing_habit" };
  }

  const { data: habit, error: habitError } = await supabaseService
    .from("habits")
    .select("id, description, status")
    .eq("id", habitId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (habitError) throw new Error(`habit read failed: ${habitError.message}`);
  if (!habit) return { status: "skipped", reason: "habit_missing" };
  if (!["detected", "confronted"].includes(String(habit.status))) {
    return { status: "skipped", reason: "habit_not_live" };
  }

  const flip = async (): Promise<void> => {
    const { error } = await supabaseService
      .from("habits")
      .update({ status: "confronted" })
      .eq("id", habitId)
      .eq("user_id", args.userId)
      .eq("status", "detected");
    if (error) console.error(`[intervention] habit flip failed for ${habitId}: ${error.message}`);
  };

  const existing = await findInterventionByJob(
    args.userId,
    HABIT_CONFRONTATION_REASON,
    args.jobId,
  );
  if (existing) {
    await flip();
    console.log(`[intervention] habit ${habitId} already confronted by job ${args.jobId}`);
    return { status: "duplicate" };
  }

  const [persona, budget, counts] = await Promise.all([
    getConfigString("intervention_persona"),
    getConfigNumber("pipeline_deadline_ms"),
    loadHabitCounts(args.userId),
  ]);
  const pattern = habitPatternFromDescription(String(habit.description));
  const count = pattern === "impulse" ? counts.impulses : counts.journalFlags;
  const contextText = buildHabitConfrontationContext({
    description: String(habit.description),
    pattern,
    count,
    windowDays: HABIT_WINDOW_DAYS,
  });

  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");
  const result = await runLockedPersonaReply({
    text: contextText,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt: Date.now() + Math.max(0, budget),
  });

  console.log(
    `[intervention] tactical_analysis (habit ${args.jobId}):`,
    result.tacticalAnalysis,
    JSON.stringify({ provider: result.provider, persona: result.persona, domain: result.domain }),
  );

  const assistantMessageId = await deliverIntervention({
    userId: args.userId,
    persona: result.persona,
    content: result.assistantContent,
    metadata: {
      persona: result.persona,
      domain: result.domain,
      rule_ids: result.ruleIds,
      source: HABIT_CONFRONTATION_REASON,
      habit_id: habitId,
      source_job_id: args.jobId,
    },
  });

  await flip();
  return { status: "written", assistantMessageId, context: contextText };
}
