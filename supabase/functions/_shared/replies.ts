// supabase/functions/_shared/replies.ts
// FP-04 Step 3b — reply persistence shared by the synchronous chat functions.
//
// Refs: FP-02 FR-4, FR-5, FR-12, FR-15; FP-04 FR-13; TECH-SPEC §3.2, §4.1, §5.1, §5.3, §7.10.
//
// Lifted out of `send-message` (FP-02 Steps 4, 5a, 8) when `submit-checkin`'s intervention turn
// needed the same three operations. One implementation, because both callers rest on the same
// two guards, and an intervention turn is "just a turn" (FP-04 FR-13):
//
//   - `insertPrimaryReply` — the `messages_one_primary_reply` partial unique index is the
//     at-most-one-primary-reply guard; the loser of that race gets `{raceLost:true}` and asks
//     `findPrimaryReply` who won.
//   - `findPrimaryReply` — the §3.2 lookup for that winner, and the "is this turn answered"
//     probe the repair path uses.
//   - `writeHoldingReplyAndEnqueueRetry` — §4.1's synchronous degrade: a holding reply as the
//     PRIMARY reply plus exactly one `llm_retry` job, written **atomically** (FP-10 Step 2) by
//     one `write_degrade_pair` RPC. It never pushes (the retry job pushes the real answer).
//     Both rows land or neither does; there is no longer a window where a holding reply has
//     no retry behind it.
//
// The three return values, not Responses: each caller shapes its own body — `send-message`'s is
// `{user_message_id, assistant_message_id, status}`, `submit-checkin`'s is the frozen check-in
// shape (§7.1). Keeping the HTTP surface in the functions is what stops this module from owning
// a contract it does not mean to own.

import { getConfig, supabaseService } from "./config.ts";
import type { PipelineContext } from "./llm/errors.ts";
import {
  type DegradePairClient,
  type HoldingReplyResult,
  writeDegradePair,
} from "./degradePair.ts";

export type { HoldingReplyResult } from "./degradePair.ts";

/** Id of the primary reply to a user message, or null when the turn is unanswered. */
export async function findPrimaryReply(userMessageId: string): Promise<string | null> {
  const { data } = await supabaseService
    .from("messages")
    .select("id")
    .eq("role", "assistant")
    .eq("reply_to_message_id", userMessageId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Insert the primary reply. Returns `{ raceLost: true }` when the partial unique index
 * rejects it — another invocation answered the same user message first.
 */
export async function insertPrimaryReply(args: {
  userId: string;
  userMessageId: string;
  content: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string } | { raceLost: true }> {
  const { data, error } = await supabaseService
    .from("messages")
    .insert({
      user_id: args.userId,
      role: "assistant",
      content: args.content,
      reply_to_message_id: args.userMessageId,
      metadata: args.metadata,
    })
    .select("id");

  if (error) {
    if ((error as { code?: string }).code === "23505") return { raceLost: true };
    throw error;
  }
  return { id: data![0].id as string };
}

/**
 * Synchronous degrade (TECH-SPEC §4.1, FP-02 Step 8; atomic since FP-10 Step 2).
 *
 * Reached only when every provider failed, or when the synchronous budget ran out. The turn is
 * already committed and the client is watching, so it must not be left unanswered - and the
 * answer must not outlive its retry:
 *
 *   1. **One call, one transaction.** `write_degrade_pair` (0036, via `_shared/degradePair.ts`)
 *      inserts the holding reply through the `messages_one_primary_reply` guard and the
 *      `llm_retry` job with its pre-minted id, both or neither. The id is minted here so the
 *      holding row's `metadata.source_job_id` can name the job before it exists (§2.1's
 *      idempotency key). Before this step the two writes were separate PostgREST calls, so an
 *      invocation killed between them left a holding reply with no retry behind it (§5.1).
 *   2. **Race semantics unchanged.** A concurrent invocation that answered the turn first
 *      loses the partial-unique-index race; the RPC returns `race_lost` with the winner's id
 *      and this one enqueues nothing, because its job would answer an already-answered turn.
 *   3. **No push for the holding reply.** On the chat path the user is by definition still in
 *      the app (the Realtime INSERT already showed it). On the check-in path, the interrupting
 *      moment is the intervention's whole point, so a "one moment" push followed seconds later
 *      by the real one is two notifications for one turn. The retry job pushes the real reply.
 *
 * The `sync_degrade_reply` config read is the first fatal step: without it there is no holding
 * text to write. A failed RPC is the second: the pair rolled back, so there is nothing to
 * return and the caller surfaces the failure - the resend path answers the turn instead.
 */
export async function writeHoldingReplyAndEnqueueRetry(args: {
  userId: string;
  userMessageId: string;
  context?: PipelineContext;
  /** Test seam only: the pair RPC client (defaults to the service-role client). */
  client?: DegradePairClient;
}): Promise<HoldingReplyResult> {
  const { userId, userMessageId, context, client } = args;

  const degradeContent = await getConfig("sync_degrade_reply");
  if (typeof degradeContent !== "string" || degradeContent.length === 0) {
    throw new Error('config key "sync_degrade_reply" is missing or empty');
  }

  return await writeDegradePair(
    client ?? (supabaseService as unknown as DegradePairClient),
    {
      userId,
      userMessageId,
      jobId: crypto.randomUUID(),
      content: degradeContent,
      context,
    },
  );
}
