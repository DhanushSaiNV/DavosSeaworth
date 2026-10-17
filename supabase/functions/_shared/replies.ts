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
//     PRIMARY reply, then exactly one `llm_retry` job. It never pushes (the retry job pushes the
//     real answer) and never fails on the job insert.
//
// The three return values, not Responses: each caller shapes its own body — `send-message`'s is
// `{user_message_id, assistant_message_id, status}`, `submit-checkin`'s is the frozen check-in
// shape (§7.1). Keeping the HTTP surface in the functions is what stops this module from owning
// a contract it does not mean to own.

import { getConfig, supabaseService } from "./config.ts";
import type { PipelineContext } from "./llm/errors.ts";

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

/** The degrade's outcome: the holding reply's id, or the winner that beat it to the turn. */
export type HoldingReplyResult =
  | { ok: true; assistantMessageId: string; jobId: string }
  | { ok: false; winnerId: string | null };

/**
 * Synchronous degrade (TECH-SPEC §4.1, FP-02 Step 8).
 *
 * Reached only when every provider failed, or when the synchronous budget ran out. The turn is
 * already committed and the client is watching, so it must not be left unanswered. Three steps,
 * in this order for a reason:
 *
 *   1. **Holding reply as the PRIMARY reply** (`metadata.route = 'degrade'`). Going through
 *      `insertPrimaryReply` reuses the `messages_one_primary_reply` guard, so a concurrent
 *      invocation that answered the turn first wins and this one enqueues nothing — otherwise
 *      the loser's job would answer an already-answered turn.
 *   2. **One `llm_retry` job.** Its id is minted up front and used as the row id, so it can be
 *      written into the holding row's metadata before the job exists, and so a re-delivery of
 *      this same degradation cannot enqueue a second job (§2.1).
 *   3. **No push for the holding reply.** On the chat path the user is by definition still in
 *      the app (the Realtime INSERT already showed it). On the check-in path, the interrupting
 *      moment is the intervention's whole point, so a "one moment" push followed seconds later
 *      by the real one is two notifications for one turn. The retry job pushes the real reply,
 *      which is the one worth waking for.
 *
 * The `sync_degrade_reply` config read is the only fatal step: without it there is no holding
 * text to write, and the caller fails loudly rather than committing an empty reply.
 */
export async function writeHoldingReplyAndEnqueueRetry(args: {
  userId: string;
  userMessageId: string;
  context?: PipelineContext;
}): Promise<HoldingReplyResult> {
  const { userId, userMessageId, context } = args;

  const degradeContent = await getConfig("sync_degrade_reply");
  if (typeof degradeContent !== "string" || degradeContent.length === 0) {
    throw new Error('config key "sync_degrade_reply" is missing or empty');
  }

  const jobId = crypto.randomUUID();

  const holding = await insertPrimaryReply({
    userId,
    userMessageId,
    content: degradeContent,
    metadata: {
      route: "degrade",
      source: "sync_degrade",
      user_message_id: userMessageId,
      source_job_id: jobId,
      ...(context ? { domain: context.domain } : {}),
    },
  });

  if ("raceLost" in holding) {
    return { ok: false, winnerId: await findPrimaryReply(userMessageId) };
  }

  // The routing decision (stages 1–4) is carried to the job so it can re-run stages 3–5
  // without re-extracting. `route` reaches the retry row's metadata because `route` must keep
  // describing the tier that produced the turn (§3.2) — the §5.3 counter is blind to secondary
  // rows by design. The job always generates the `auto` variant, so a degraded turn is never
  // re-offered persona chips that only a primary reply can carry.
  const { error: jobError } = await supabaseService.from("jobs").insert({
    id: jobId,
    type: "llm_retry",
    payload: {
      user_id: userId,
      user_message_id: userMessageId,
      route: context?.route ?? null,
      persona: context?.persona ?? null,
      domain: context?.domain ?? null,
    },
  });
  if (jobError) {
    // The user still has a reply; only the retry is lost. Loud, but not fatal.
    console.error("[replies] llm_retry enqueue failed:", jobError.message);
  }

  return { ok: true, assistantMessageId: holding.id, jobId };
}
