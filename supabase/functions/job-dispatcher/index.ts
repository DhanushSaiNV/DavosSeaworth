import { createClient } from 'npm:@supabase/supabase-js@2';

// Handler registry - only smoke_test for now (dev-only, 15th type)
const HANDLERS: Record<string, (payload: Record<string, unknown>) => Promise<void>> = {
  smoke_test: async (payload) => {
    if (payload?.fail === true) {
      throw new Error('smoke_test forced failure');
    }
    // Success: no-op, completes immediately
  },
};

// Configuration
const BATCH_SIZE = 10;
const LEASE_MINUTES = 5;
const BASE_BACKOFF_SECONDS = 30;
const MAX_ATTEMPTS = 5;

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

  await handler(job.payload);
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
  try {
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

    // Execute each job sequentially
    for (const job of jobs) {
      try {
        const result = await executeJob(job);
        if (result.handled) {
          await markJobDone(job.id);
        }
        // If not handled (unknown job type), executeJob already marked it dead
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Job ${job.id} (${job.type}) failed:`, errorMessage);
        // job.attempts was already incremented by claim_jobs() when setting status='running'
        // Pass the current attempts value (not +1) to markJobFailed
        await markJobFailed(job.id, errorMessage, job.attempts, job.max_attempts);
      }
    }

    return new Response(JSON.stringify({ processed: jobs.length }), {
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