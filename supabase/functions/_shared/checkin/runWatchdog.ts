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
import { createHighPriorityPushPayload, sendPush } from "../push.ts";
import { loadGrid } from "./loadGrid.ts";
import { windowsClosedBetween, windowsForLocalDay, type GridWindow } from "./windows.ts";
import {
  buildInterventionContext,
  MISSED_CHECKIN_REASON,
  selectMissedWindows,
  type ThreadLine,
} from "./watchdog.ts";

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
  | { status: "written"; assistantMessageId: string }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

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
export async function runIntervention(args: {
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
