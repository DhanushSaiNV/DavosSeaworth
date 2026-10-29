// supabase/functions/_shared/degradePair.ts
// FP-10 Step 2 - the atomic degrade pair's request and response handling (TECH-SPEC §4.1,
// §5.1; migration 0036).
//
// Why this module exists separately from `replies.ts`: `replies.ts` imports `config.ts`,
// which reads `Deno.env` at module scope, so jest cannot load it. The parts that decide *what*
// `write_degrade_pair` is called with, and *how* its answer is read, are pure - no Deno, no
// clock, no client construction - and the fault-injection unit drives them with a fake client.
// The RPC writes both rows in one transaction (the migration's guarantee); this module is the
// only place that knows the call's shape, so a field rename breaks one test instead of two
// callers.

/** The one RPC surface needed: `supabaseService` satisfies it at runtime. */
export interface DegradePairClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/** The degrade's outcome: the holding reply's id, or the winner that beat it to the turn. */
export type HoldingReplyResult =
  | { ok: true; assistantMessageId: string; jobId: string }
  | { ok: false; winnerId: string | null };

/** The routing decision carried to the retry job (a subset of `PipelineContext`). */
export interface DegradePairContext {
  route?: string | null;
  persona?: string | null;
  domain?: string | null;
}

/** `write_degrade_pair`'s return shape (migration 0036). */
interface DegradePairRow {
  status?: string;
  assistant_message_id?: string;
  job_id?: string;
  winner_id?: string | null;
}

/** The RPC name, in one place. */
export const DEGRADE_PAIR_RPC = "write_degrade_pair";

/**
 * Build the RPC arguments. The metadata/payload keys are FP-02's as-built shape and must not
 * drift: FP-02/04's degrade gates assert the persisted row's `route`/`source`/`source_job_id`,
 * and `llm_retry` reads `route`/`persona`/`domain` from the payload.
 */
export function buildDegradePairArgs(args: {
  userId: string;
  userMessageId: string;
  jobId: string;
  content: string;
  context?: DegradePairContext;
}): Record<string, unknown> {
  const { userId, userMessageId, jobId, content, context } = args;
  return {
    p_user_id: userId,
    p_user_message_id: userMessageId,
    p_job_id: jobId,
    p_content: content,
    p_metadata: {
      route: "degrade",
      source: "sync_degrade",
      user_message_id: userMessageId,
      source_job_id: jobId,
      ...(context?.domain ? { domain: context.domain } : {}),
    },
    // The routing decision (stages 1-4) is carried to the job so it can re-run stages 3-5
    // without re-extracting. `route` reaches the retry row's metadata because `route` must keep
    // describing the tier that produced the turn (§3.2) - the §5.3 counter is blind to secondary
    // rows by design. The job always generates the `auto` variant, so a degraded turn is never
    // re-offered persona chips that only a primary reply can carry.
    p_payload: {
      user_id: userId,
      user_message_id: userMessageId,
      route: context?.route ?? null,
      persona: context?.persona ?? null,
      domain: context?.domain ?? null,
    },
  };
}

/**
 * Call the pair writer and interpret its answer.
 *
 * Atomicity is the contract: an RPC error means the transaction rolled back, so there is no
 * holding reply to hand back - this throws. That is a deliberate change from FP-02's "the user
 * still has a reply; only the retry is lost": a holding reply nobody will ever replace is worse
 * than a failed turn the resend path can answer (§5.1).
 *
 * A `race_lost` answer is not an error: another invocation answered the turn first, and this one
 * enqueued nothing. An unrecognised shape throws rather than returning a half-filled success.
 */
export async function writeDegradePair(
  client: DegradePairClient,
  args: {
    userId: string;
    userMessageId: string;
    jobId: string;
    content: string;
    context?: DegradePairContext;
  },
): Promise<HoldingReplyResult> {
  const { data, error } = await client.rpc(
    DEGRADE_PAIR_RPC,
    buildDegradePairArgs(args),
  );

  if (error) {
    throw new Error(`${DEGRADE_PAIR_RPC} failed: ${error.message ?? "unknown error"}`);
  }

  const row = (data ?? {}) as DegradePairRow;
  if (row.status === "race_lost") {
    return { ok: false, winnerId: row.winner_id ?? null };
  }
  if (row.status !== "ok" || !row.assistant_message_id || !row.job_id) {
    throw new Error(
      `${DEGRADE_PAIR_RPC} returned an unexpected shape: ${JSON.stringify(row)}`,
    );
  }
  return { ok: true, assistantMessageId: row.assistant_message_id, jobId: row.job_id };
}
