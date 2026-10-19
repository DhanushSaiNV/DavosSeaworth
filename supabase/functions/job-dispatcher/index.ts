// supabase/functions/job-dispatcher/index.ts
// The job runner. Invoked by pg_cron through the `job_dispatcher_auth` Vault secret
// (FP-01 Step 8): it claims due rows from `jobs` via `claim_jobs` (lease-based, so a
// killed invocation self-heals), runs them sequentially, and settles each one as
// done / failed (exponential backoff) / dead at `max_attempts`.
//
// Handlers must be idempotent (§2.2.4) — a claimed job can be re-delivered after a lease
// timeout.
//
// BATCH BUDGET (§2.2, §12): one tick runs under a wall-clock budget
// (`config.job_dispatcher_budget_ms`) and stops *starting* jobs once the next handler's
// worst case no longer fits. A kill is the worst outcome here, not a slow tick:
// `claim_jobs` has already incremented `attempts` for every row in the batch, and a killed
// invocation cannot hand back the rows it never reached. Un-started claims are therefore
// released to `pending` with their attempt restored, so a job that never executed can
// never drift toward dead-letter. Generation-capable handlers reserve the full
// `pipeline_deadline_ms` before they start; cheap handlers opt out via `FAST_JOB_TYPES`.
//
// `llm_retry` (FP-02 Step 8) finishes a turn that the sync-degrade path answered with a
// holding reply (§4.1).
//
// FP-04 Step 6 adds the two check-in watchdog handlers. They are thin: the work lives in
// `_shared/checkin/` so the AC-8 drill (`dev-smoke ?action=watchdog-scan`) drives the *same*
// scan the cron does, and so the pure decisions stay unit-tested.
//   * `watchdog_checkin` — the 5-min scan (cheap: a profiles walk, two reads per user, inserts)
//     → one `intervention` job per missed window. In `FAST_JOB_TYPES`.
//   * `intervention` — generation for one missed window (a locked persona + a high-priority
//     push). Deliberately NOT in `FAST_JOB_TYPES`: it reserves a whole `pipeline_deadline_ms`.
//
// Refs: FP-02 FR-3, FR-4; FP-04 FR-15, FR-16; TECH-SPECS §2.1–§2.3, §4.1, §5.1, §7.1, §12; D12, D18.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getConfigNumber } from '../_shared/config.ts';
import { createAiMessagePushPayload, sendPush } from '../_shared/push.ts';
import { runIntervention, runWatchdogScan } from '../_shared/checkin/runWatchdog.ts';
import { runJournalExtract } from '../_shared/journal/runChain.ts';
import { MISSED_CHECKIN_REASON } from '../_shared/checkin/watchdog.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
}

/** Non-empty string, else null. Payload values come from the DB — never trusted. */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Id of the secondary reply already written for a turn, or null (§3.2). */
async function findSecondaryReply(userMessageId: string): Promise<string | null> {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('role', 'assistant')
    .eq('secondary_reply_to_message_id', userMessageId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * `llm_retry` — finish a turn that was answered with the sync-degrade holding reply
 * because every provider was unavailable (§4.1, FP-02 Step 8).
 *
 * It re-runs **stages 3–5** only: the payload carries the stage-1–4 decision, so there is
 * nothing left to extract, classify or route. Re-running stage 3 as well (not stage 5
 * alone) matters because the degrade path is also reached when the *embed* fails — a
 * stage-5-only retry would never recover that turn.
 *
 * Idempotent (§2.2.4): the reply is looked up first, and the insert is additionally
 * guarded by `messages_one_secondary_reply`, so a re-delivered or concurrent run is a
 * no-op. The user's text is read server-side from `user_message_id` — it is never taken
 * from the payload (the payload carries ids only, §5.3).
 *
 * Generation always runs the `auto` variant, even when the original turn was Medium
 * (`options`). Persona chips belong to a *primary* reply: the client's chip tap resolves
 * its anchor from `reply_to_message_id`, which a secondary row does not carry, so chips
 * written here would be untappable. The original route is still recorded in the row's
 * `metadata.route` because `route` must keep describing the tier that produced the turn —
 * the same convention `select-persona` uses. The Step 10 adoption counter is blind to these
 * secondary rows by design (§5.3), so a retry answer never scores as engagement.
 */
async function handleLlmRetry(payload: Record<string, unknown>, job: Job): Promise<void> {
  const userId = asString(payload.user_id);
  const userMessageId = asString(payload.user_message_id);
  const persona = asString(payload.persona);
  const domain = asString(payload.domain);
  const route = asString(payload.route);

  if (!userId || !userMessageId || !persona || !domain) {
    // The shipped send-message path always writes a full decision, so a payload missing
    // one cannot be produced by this codebase. It is not transient either: looping it
    // through 5 backoff attempts only burns quota. Log loudly and close the job.
    console.error(
      `[llm_retry] unusable payload on job ${job.id} — user_id/user_message_id/persona/domain required:`,
      JSON.stringify(payload),
    );
    return;
  }

  if (await findSecondaryReply(userMessageId)) {
    console.log(`[llm_retry] turn ${userMessageId} already has a retry reply; nothing to do`);
    return;
  }

  const { data: userRow, error: userError } = await supabase
    .from('messages')
    .select('id, role, content')
    .eq('id', userMessageId)
    .eq('user_id', userId)
    .maybeSingle();
  if (userError) {
    throw new Error(`could not load user message ${userMessageId}: ${userError.message}`);
  }
  if (!userRow || userRow.role !== 'user') {
    // The turn is gone (purged account / removed row). Retrying cannot bring it back.
    console.warn(`[llm_retry] user message ${userMessageId} is gone; abandoning`);
    return;
  }

  const budget = await getConfigNumber('pipeline_deadline_ms');

  // Imported lazily, deliberately: `_shared/llm/adapter.ts` throws at module load when
  // GEMINI_API_KEY / GROQ_API_KEY are absent, and this function runs *every* job type. A
  // deployment missing those secrets must break `llm_retry` alone — not lease recovery and
  // every other handler (TECH-SPECS §13). Loaded here, a missing secret surfaces as an
  // ordinary job failure with backoff instead of a module-load crash with no job context.
  const { runLockedPersonaReply } = await import('../_shared/pipeline/runPipeline.ts');

  const result = await runLockedPersonaReply({
    text: userRow.content as string,
    domain,
    persona,
    deadlineAt: Date.now() + budget,
  });

  // tactical_analysis is internal reasoning: logged server-side only, never persisted
  // and never returned to the client (§4.3).
  console.log(
    `[llm_retry] tactical_analysis (job ${job.id}):`,
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

  const metadata: Record<string, unknown> = {
    persona: result.persona,
    domain: result.domain,
    rule_ids: result.ruleIds,
    source: 'llm_retry',
    user_message_id: userMessageId,
    source_job_id: job.id,
  };
  if (route) metadata.route = route;

  const { data: inserted, error: insertError } = await supabase
    .from('messages')
    .insert({
      user_id: userId,
      role: 'assistant',
      content: result.assistantContent,
      // Secondary reply: the primary anchor stays NULL by contract, and the turn anchor
      // lives in its own column, guarded by `messages_one_secondary_reply` (§3.2).
      reply_to_message_id: null,
      persona_key: result.persona,
      secondary_reply_to_message_id: userMessageId,
      metadata,
    })
    .select('id');

  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      console.log(`[llm_retry] turn ${userMessageId} was answered concurrently; nothing to do`);
      return;
    }
    throw new Error(`could not write retry reply for ${userMessageId}: ${insertError.message}`);
  }

  // Best-effort and bounded: the reply is already committed, so a push failure must not
  // fail the job (that would burn an attempt re-doing the work above).
  try {
    await Promise.race([
      sendPush(createAiMessagePushPayload(userId, result.assistantContent)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    console.error(`[llm_retry] push send failed:`, err instanceof Error ? err.message : err);
  }

  console.log(
    `[llm_retry] wrote reply ${inserted?.[0]?.id ?? '?'} for turn ${userMessageId} (job ${job.id})`,
  );
}

// Handler registry. Job types are registered in TECH-SPECS §2.3 + GLOSSARY §12.
const HANDLERS: Record<
  string,
  (payload: Record<string, unknown>, job: Job) => Promise<void>
> = {
  smoke_test: async (payload) => {
    if (payload?.fail === true) {
      throw new Error('smoke_test forced failure');
    }
    // Success: no-op, completes immediately
  },

  llm_retry: handleLlmRetry,

  /**
   * The 5-min check-in scan (FR-15). `runWatchdogScan` owns the walk; this handler only decides
   * *when*, and the cron tick is the only caller in production. No membership filter: the cron
   * scan is every profile, and the `userId` narrowing exists for the drill alone.
   */
  watchdog_checkin: async () => {
    await runWatchdogScan({ nowMs: Date.now() });
  },

  /**
   * One missed window's intervention (FR-16). The payload is written by the scan and carries ids
   * only — the prompt's context is rebuilt server-side from the window and the thread, never
   * taken from the payload (§5.3's rule for job payloads).
   */
  intervention: async (payload, job) => {
    const userId = asString(payload.user_id);
    const windowIso = asString(payload.window);
    if (!userId || !windowIso) {
      // Not producible by this codebase (the scan always writes both), and not transient:
      // retrying only burns quota. Log loudly and close the job.
      console.error(
        `[intervention] unusable payload on job ${job.id} — user_id/window required:`,
        JSON.stringify(payload),
      );
      return;
    }

    await runIntervention({
      userId,
      windowIso,
      reason: asString(payload.reason) ?? MISSED_CHECKIN_REASON,
      jobId: job.id,
    });
  },

  /**
   * Evening journal chain head (FP-05 FR-4, FR-5, FR-6, FR-7, FR-9).
   * Runs the extraction, writes the marker + facts, enqueues probe/plan jobs.
   * Thin wrapper: lazy import pattern (llm_retry precedent) for secret isolation.
   * NOT in FAST_JOB_TYPES — generation-capable, reserves pipeline_deadline_ms.
   */
  journal_extract: async (payload, job) => {
    await runJournalExtract(payload, job);
  },
};

// Configuration
const BATCH_SIZE = 10;
const LEASE_MINUTES = 5;
const BASE_BACKOFF_SECONDS = 30;
const MAX_ATTEMPTS = 5;

/**
 * Handler types known to be cheap (no LLM call), so a tick does not have to hold a whole
 * generation budget in reserve before starting one. Every *other* registered type is
 * treated as generation-capable, because the default must fail safe: starting a
 * generation job with no room left to finish it gets the invocation killed, and a killed
 * invocation cannot hand back the claims it never reached (§2.2, §12). A new cheap job
 * type opts in here.
 *
 * `watchdog_checkin` is cheap: a profiles walk plus two bounded reads per profile and one insert
 * per missed window — no model call. `intervention` is deliberately absent: it generates.
 */
const FAST_JOB_TYPES = new Set(['smoke_test', 'watchdog_checkin']);

/**
 * Wall-clock time that must still be available before starting a job of `type`. Unknown
 * types get zero — `executeJob` dead-letters those immediately without doing any work.
 */
function reserveMsFor(type: string, perJobMs: number): number {
  if (!HANDLERS[type]) return 0;
  return FAST_JOB_TYPES.has(type) ? 0 : perJobMs;
}

async function claimJobs(): Promise<Job[]> {
  const { data, error } = await supabase.rpc('claim_jobs', {
    batch_size: BATCH_SIZE,
    lease_minutes: LEASE_MINUTES,
  });

  if (error) {
    throw new Error(`Failed to claim jobs: ${error.message}`);
  }

  return data ?? [];
}

async function executeJob(job: Job): Promise<{ handled: boolean }> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    // Unknown job type: mark dead immediately (no retry) with max attempts
    // This prevents infinite retry loops for jobs that will never have handlers
    await markJobFailed(
      job.id,
      `No handler registered for job type: ${job.type}`,
      job.max_attempts,  // Force dead status immediately
      job.max_attempts
    );
    return { handled: false };
  }

  await handler(job.payload, job);
  return { handled: true };
}

async function markJobDone(jobId: string): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    throw new Error(`Failed to mark job done: ${error.message}`);
  }
}

async function markJobFailed(jobId: string, errorMessage: string, attempt: number, maxAttempts: number): Promise<void> {
  // attempt is now 1-based (after claim_jobs returns post-increment row)
  // Use attempt - 1 for correct backoff: 30s, 60s, 120s, 240s...
  const nextRetryAt = new Date(Date.now() + Math.pow(2, attempt - 1) * BASE_BACKOFF_SECONDS * 1000);
  const status = attempt >= maxAttempts ? 'dead' : 'failed';

  const { error } = await supabase
    .from('jobs')
    .update({
      status,
      attempts: attempt,
      last_error: errorMessage,
      next_retry_at: nextRetryAt.toISOString(),
      updated_at: new Date().toISOString(),
      ...(status === 'dead' ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', jobId);

  if (error) {
    throw new Error(`Failed to mark job failed: ${error.message}`);
  }
}

/**
 * Hand claimed-but-never-started jobs back to `pending`.
 *
 * `claim_jobs` increments `attempts` as part of claiming, so releasing has to decrement it
 * again: a job the dispatcher never started must not move toward dead-letter. (The lease
 * path deliberately does not do this — `resetStaleJobs` cannot know whether a killed
 * invocation had already run the handler, so it leaves the increment in place as the
 * safety valve against a handler that reliably kills its invocation.)
 */
async function releaseJobs(jobs: Job[]): Promise<number> {
  let released = 0;

  for (const job of jobs) {
    const { data, error } = await supabase
      .from('jobs')
      .update({
        status: 'pending',
        attempts: Math.max(job.attempts - 1, 0),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'running') // still ours; a lease reset would have flipped it
      .select('id');

    if (error) {
      console.error(`Failed to release un-started job ${job.id}:`, error.message);
      continue;
    }
    if (data && data.length > 0) released += 1;
  }

  return released;
}

async function resetStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - LEASE_MINUTES * 60 * 1000);
  
  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('updated_at', cutoff.toISOString());

  if (error) {
    console.error('Failed to reset stale jobs:', error.message);
  }
}

Deno.serve(async () => {
  const startedAt = Date.now();
  try {
    // Read the budgets *before* claiming. `getConfigNumber` throws on a missing or
    // non-numeric [SPEC] key (§11, fail-closed); failing here leaves the queue untouched,
    // whereas failing after a claim would burn an attempt on every row in the batch.
    const [budgetMs, perJobMs] = await Promise.all([
      getConfigNumber('job_dispatcher_budget_ms'),
      getConfigNumber('pipeline_deadline_ms'),
    ]);
    const deadline = startedAt + budgetMs;

    // Reset stale running jobs (lease recovery)
    await resetStaleJobs();

    // Claim due jobs
    const jobs = await claimJobs();

    if (jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Execute each job sequentially, stopping once the next one's worst case no longer
    // fits in the tick — see the batch-budget note at the top of this file.
    let processed = 0;
    let released = 0;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      if (Date.now() + reserveMsFor(job.type, perJobMs) > deadline) {
        released = await releaseJobs(jobs.slice(i));
        console.warn(
          `Dispatcher budget spent after ${Date.now() - startedAt}ms of ${budgetMs}ms: ` +
            `processed ${processed}, released ${released} un-started job(s)`,
        );
        break;
      }

      try {
        const result = await executeJob(job);
        if (result.handled) {
          await markJobDone(job.id);
        }
        // If not handled (unknown job type), executeJob already marked it dead
        processed += 1;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Job ${job.id} (${job.type}) failed:`, errorMessage);
        // job.attempts was already incremented by claim_jobs() when setting status='running'
        // Pass the current attempts value (not +1) to markJobFailed
        await markJobFailed(job.id, errorMessage, job.attempts, job.max_attempts);
      }
    }

    return new Response(JSON.stringify({ processed, released }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Dispatcher error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});