// supabase/functions/send-message/index.ts
// FP-02 Steps 4+5a — user chat message → 5-stage pipeline → assistant reply.
//
// Refs: FP-02 FR-4, FR-5, FR-12, FR-16; TECH-SPECS §3.2, §5.1, §7.10, §11; D23.
// Security: AGENTS.md §4.1 (service-role writes only inside Edge Functions) and §4.3
// (`tactical_analysis` is logged server-side only — never persisted, never returned).
//
// Idempotency (FR-5/FR-16): the user row carries a client-generated `client_message_id`
// with a unique (user_id, client_message_id) index, so a repeat send never creates a
// second user row.
//
// Repair-on-duplicate (Step 5a): a repeat send whose turn was never answered does NOT
// short-circuit — the pipeline is re-run and a reply is written, so Retry after a provider
// failure is recoverable. A repeat send whose turn IS answered returns `duplicate`.
//
// At-most-one primary reply: the reply carries `reply_to_message_id` (= the user message)
// and a partial unique index (`messages_one_primary_reply`) guards it, so concurrent
// invocations (retry-vs-retry, or original-vs-repair) cannot produce two replies. The
// loser of that race catches Postgres 23505 and returns the winner's id.
//
// Sync degrade (Step 8, TECH-SPECS §4.1): when *both* providers fail — the adapter has
// already run its inline primary→fallback — or the synchronous budget runs out, the turn
// is answered immediately with `config.sync_degrade_reply` (a holding reply) and one
// `llm_retry` job is enqueued to produce the real answer. Rejected alternatives: a
// 500 (strands the turn), and handing a *single*-provider failure to the job (that would
// make a routine Gemini 429 visible to the user).
//
// D8 `auto_adopt_successes` (Step 10, TECH-SPECS §5.3): a genuinely new user message scores
// one success when the row immediately before it is an `auto`-route *primary* reply written
// inside `config.auto_adopt_window_minutes`. Only the fresh-insert branch counts, and the
// narrow primary-only rule keeps the Step 8 `llm_retry` secondary row out of the count.

import { getConfig, getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { runPipeline, type RunPipelineResult } from "../_shared/pipeline/runPipeline.ts";
import { readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
import { sendPush, createAiMessagePushPayload } from "../_shared/push.ts";
import { isProvidersUnavailable, type PipelineContext } from "../_shared/llm/errors.ts";
import type { ClassifyOverrides } from "../_shared/pipeline/classify.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // `x-client-info` is injected by supabase-js on every request (`X-Client-Info:
  // supabase-js/<version>; runtime=web`), so the preflight must allow it or the browser
  // blocks the call outright.
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// Request-input validation only (never LLM output — AGENTS.md §5.1).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Normalize the dev override params into a single tier/domain/emotion triple. */
function normalizeDevForce(body: Record<string, unknown>): {
  force?: string;
  domain?: string;
  emotion?: string;
} {
  const out: { force?: string; domain?: string; emotion?: string } = {};
  const raw = body.dev_force;
  if (typeof raw === "string") {
    out.force = raw;
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.tier === "string") out.force = o.tier;
    if (typeof o.domain === "string") out.domain = o.domain;
    if (typeof o.emotion === "string") out.emotion = o.emotion;
  }
  if (typeof body.dev_domain === "string") out.domain = body.dev_domain;
  if (typeof body.dev_emotion === "string") out.emotion = body.dev_emotion;
  return out;
}

/** Id of the primary reply to a user message, or null when the turn is unanswered. */
async function findPrimaryReply(userMessageId: string): Promise<string | null> {
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
async function insertPrimaryReply(args: {
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
 * D8 `auto_adopt_successes` (FR-14, AC-9; TECH-SPECS §5.3, §5.4).
 *
 * The signal is the user *engaging* with a turn the system answered on its own: if the row
 * immediately before this new user message is an `auto`-route **primary** reply written
 * within `config.auto_adopt_window_minutes`, one success is recorded for that reply's
 * domain. Three parts of that sentence are deliberate:
 *
 *   - **immediately before** (`D-B`): one success per auto-adopted reply, so a user who
 *     fires three follow-ups at one suggestion scores one engagement, not three. A user row
 *     in between means the auto reply was not the turn being answered.
 *   - **primary** (`D-A`): `reply_to_message_id IS NOT NULL` is the structural test for
 *     "the sync pipeline's own reply". The Step 8 `llm_retry` row records the *original*
 *     turn's `metadata.route` by design (§3.2), so without this clause a High-tier turn
 *     degraded by an outage and answered minutes later would read as an accepted
 *     auto-adoption. The only other primary writer is the degrade holding reply, and it
 *     carries `route='degrade'`.
 *   - **server clock** (`D-C`): the window is `now - reply.created_at`, never
 *     `client_sent_at` (untrusted input, §5.1). An offline reply delivered late by the Step
 *     9 queue can therefore miss the window — a lost count, never a wrong one.
 *
 * Non-fatal by design: the user row is already committed, so a stats failure must never
 * turn into a 500 that strands the turn.
 */
async function recordAutoAdoptSuccess(args: {
  userId: string;
  userMessageCreatedAt: string;
}): Promise<void> {
  const windowMinutes = await getConfigNumber("auto_adopt_window_minutes");

  const { data } = await supabaseService
    .from("messages")
    .select("role, reply_to_message_id, metadata, created_at")
    .eq("user_id", args.userId)
    .lt("created_at", args.userMessageCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1);

  const prev = data?.[0] as
    | {
      role?: string;
      reply_to_message_id?: string | null;
      metadata?: Record<string, unknown>;
      created_at?: string;
    }
    | undefined;
  if (!prev || prev.role !== "assistant") return;
  if (!prev.reply_to_message_id) return;

  const metadata = prev.metadata ?? {};
  if (metadata.route !== "auto") return;
  const domain = metadata.domain;
  if (typeof domain !== "string" || domain.length === 0) return;

  const replyAt = prev.created_at ? Date.parse(prev.created_at) : NaN;
  if (!Number.isFinite(replyAt)) return;
  const replyAgoMs = Date.now() - replyAt;
  if (replyAgoMs > windowMinutes * 60_000) return;

  const { error } = await supabaseService.rpc("increment_auto_adopt_successes", {
    p_user_id: args.userId,
    p_domain: domain,
  });
  if (error) throw error;

  console.log(
    "[send-message] auto_adopt_success",
    JSON.stringify({ domain, replyAgoMs }),
  );
}

/**
 * Synchronous degrade (TECH-SPECS §4.1, FP-02 Step 8).
 *
 * Reached only when every provider failed, or when the synchronous budget ran out. The
 * turn is already committed and the client is watching, so it must not be left
 * unanswered. Three steps, in this order for a reason:
 *
 *   1. **Holding reply as the PRIMARY reply** (`metadata.route = 'degrade'`). Going
 *      through `insertPrimaryReply` reuses the `messages_one_primary_reply` guard, so a
 *      concurrent invocation that answered the turn first wins and this one enqueues
 *      nothing — otherwise the loser's job would answer an already-answered turn.
 *   2. **One `llm_retry` job.** Its id is minted up front and used as the row id, so it
 *      can be written into the holding row's metadata before the job exists, and so a
 *      re-delivery of this same degradation cannot enqueue a second job (§2.1).
 *   3. **No push for the holding reply.** The user is by definition still in the app
 *      (they just sent the message), so the Realtime INSERT already showed it; pushing
 *      "one moment" and then the real answer seconds later is two notifications for one
 *      turn. The retry job pushes the real reply, which is the one worth waking for.
 */
async function degradeToHoldingReply(args: {
  userId: string;
  userMessageId: string;
  context?: PipelineContext;
}): Promise<Response> {
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
    console.warn("[send-message] degrade race lost — turn already answered", userMessageId);
    const winner = await findPrimaryReply(userMessageId);
    if (!winner) throw new Error("degrade race lost but no winner found");
    return json({
      user_message_id: userMessageId,
      assistant_message_id: winner,
      status: "duplicate",
    });
  }

  // The routing decision (stages 1–4) is carried to the job so it can re-run stages 3–5
  // without re-extracting. `route` reaches the retry row's metadata because `route` must
  // keep describing the tier that produced the turn (§3.2) — the Step 10 counter is blind
  // to secondary rows by design (§5.3). The job always generates the `auto` variant, so a
  // degraded turn is never re-offered persona chips that only a primary reply can carry.
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
    console.error("[send-message] llm_retry enqueue failed:", jobError.message);
  }

  return json({
    user_message_id: userMessageId,
    assistant_message_id: holding.id,
    status: "ok",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // JWT is verified by the gateway (verify_jwt default); resolve the user ourselves.
  const auth = await resolveUserId(req);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }
  const userId = auth.userId;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // [SPEC] caps, read at runtime — never hardcoded (AGENTS.md §2).
  let maxChars: number;
  let pipelineDeadlineMs: number;
  try {
    maxChars = await getConfigNumber("chat_max_message_chars");
    pipelineDeadlineMs = await getConfigNumber("pipeline_deadline_ms");
  } catch (err) {
    console.error("[send-message] config error:", err instanceof Error ? err.message : err);
    return json({ error: "Server misconfigured" }, 500);
  }

  const content = body.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return json({ error: "content is required" }, 400);
  }
  if (content.length > maxChars) {
    return json({ error: `content exceeds ${maxChars} characters` }, 400);
  }

  const clientMessageId = body.client_message_id;
  if (typeof clientMessageId !== "string" || !UUID_RE.test(clientMessageId)) {
    return json({ error: "client_message_id must be a uuid" }, 400);
  }

  let clientSentAt: string | null = null;
  if (body.client_sent_at !== undefined && body.client_sent_at !== null) {
    if (typeof body.client_sent_at !== "string" || Number.isNaN(Date.parse(body.client_sent_at))) {
      return json({ error: "client_sent_at must be an ISO timestamp" }, 400);
    }
    clientSentAt = body.client_sent_at;
  }

  try {
    // Absolute budget for the synchronous pipeline (§4.1). Measured from the server clock
    // at request start — never from the client's `client_sent_at` (untrusted input) and
    // never from the user row's `created_at` (a repair run reuses an older row, which
    // would trip the guard immediately and degrade every repair).
    const deadlineAt = Date.now() + pipelineDeadlineMs;

    // --- Claim the turn, deduped by (user_id, client_message_id) ---
    const userRow: Record<string, unknown> = {
      user_id: userId,
      role: "user",
      content,
      client_message_id: clientMessageId,
    };
    if (clientSentAt) userRow.client_sent_at = clientSentAt;

    const { data: inserted, error: insertError } = await supabaseService
      .from("messages")
      .upsert(userRow, { onConflict: "user_id,client_message_id", ignoreDuplicates: true })
      .select("id, created_at");
    if (insertError) throw insertError;

    let userMessageId: string;
    let text: string;

    if (inserted && inserted.length > 0) {
      userMessageId = inserted[0].id as string;
      text = content;

      // D8 counter (§5.3). Only this branch counts: a duplicate send, a Step 5a repair and
      // a Step 9 offline replay all take the branch below and must not score the same
      // arrival twice. The call sits before the pipeline because the signal is the user's
      // *arrival* — a turn that then degrades still counts. Non-fatal (see the helper).
      try {
        await recordAutoAdoptSuccess({
          userId,
          userMessageCreatedAt: inserted[0].created_at as string,
        });
      } catch (err) {
        console.error(
          "[send-message] auto-adopt counter failed:",
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      // Repeat send. Locate the existing user row.
      const { data: existing, error: existingError } = await supabaseService
        .from("messages")
        .select("id, content")
        .eq("user_id", userId)
        .eq("client_message_id", clientMessageId)
        .single();
      if (existingError || !existing) {
        throw existingError ?? new Error("duplicate row could not be located");
      }
      userMessageId = existing.id as string;

      const existingReply = await findPrimaryReply(userMessageId);
      if (existingReply) {
        return json({
          user_message_id: userMessageId,
          assistant_message_id: existingReply,
          status: "duplicate",
        });
      }

      // Unanswered turn → repair. Re-run from the STORED content; never trust the
      // request body for it (the client may have retried with different text).
      text = existing.content as string;
      console.warn("[send-message] repairing unanswered turn", userMessageId);
    }

    // --- Run the pipeline (dev overrides honored only when enabled) ---
    const dev = normalizeDevForce(body);
    let overrides: ClassifyOverrides | undefined;
    if ((dev.force || dev.domain || dev.emotion) && (await getConfig("dev_overrides_enabled")) === true) {
      overrides = overridesFromForce({
        force: dev.force,
        domain: dev.domain,
        emotion: dev.emotion,
        bands: await readConfidenceBands(),
      });
    }

    let result: RunPipelineResult;
    try {
      result = await runPipeline({ text, userId, overrides, deadlineAt });
    } catch (err) {
      // A transport failure (no provider reachable, or the budget ran out) degrades
      // instead of 500-ing: the user row is already committed, so a 500 would strand
      // the turn. Anything else — a DB error, a bug — is a real failure and still 500s.
      if (!isProvidersUnavailable(err)) throw err;
      console.error(
        "[send-message] providers unavailable — degrading to holding reply:",
        err.message,
      );
      return await degradeToHoldingReply({ userId, userMessageId, context: err.context });
    }

    // tactical_analysis: server log only — never persisted, never returned (§4.3).
    console.log(
      "[send-message] tactical_analysis:",
      result.tacticalAnalysis,
      JSON.stringify({
        route: result.routeInfo.route,
        persona: result.routeInfo.persona,
        domain: result.routeInfo.domain,
        provider: result.routeInfo.provider,
        latencyMs: result.routeInfo.latencyMs,
        attempts: result.routeInfo.attempts,
        degraded: result.routeInfo.degraded,
      }),
    );

    // --- Insert the primary reply via service role ---
    const metadata: Record<string, unknown> = {
      persona: result.routeInfo.persona,
      route: result.routeInfo.route,
      domain: result.routeInfo.domain,
      rule_ids: result.routeInfo.ruleIds,
      source: "pipeline",
      user_message_id: userMessageId,
    };
    const options = result.uiMetadata?.persona_options;
    if (options && options.length > 0) metadata.persona_options = options;

    const reply = await insertPrimaryReply({
      userId,
      userMessageId,
      content: result.assistantContent,
      metadata,
    });

    if ("raceLost" in reply) {
      // Another invocation answered this turn first (retry-vs-retry or original-vs-repair).
      // Logged so beta can measure wasted pipeline runs.
      console.warn("[send-message] primary-reply race lost", userMessageId);
      const winner = await findPrimaryReply(userMessageId);
      if (!winner) throw new Error("primary reply race lost but no winner found");
      return json({
        user_message_id: userMessageId,
        assistant_message_id: winner,
        status: "duplicate",
      });
    }

    // --- Send Expo push (best-effort but guaranteed to run: bounded wait, never blocks past 5 s) ---
    const pushPayload = createAiMessagePushPayload(userId, result.assistantContent);
    try {
      await Promise.race([
        sendPush(pushPayload),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    } catch (err) {
      console.error("[send-message] push send failed:", err instanceof Error ? err.message : err);
    }

    return json({
      user_message_id: userMessageId,
      assistant_message_id: reply.id,
      status: "ok",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-message] failed:", msg);
    return json({ error: "Failed to process message" }, 500);
  }
});
