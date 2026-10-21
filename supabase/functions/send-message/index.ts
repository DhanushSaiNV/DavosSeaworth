// supabase/functions/send-message/index.ts
// FP-02 Steps 4+5a — user chat message → 5-stage pipeline → assistant reply.
//
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
// FP-04 FR-10 adds one exclusion: a materialized check-in turn is transparent to that rule —
// its user row and its intervention reply neither count nor break the chain.
//
// FP-06 Step 4 (FR-3) adds the window-boundary trigger beside the recorder: the same
// fresh-insert branch counts the user's user-role rows and a crossing of
// `config.sliding_window_messages` enqueues one `memory_extract` job. Zero provider calls;
// non-fatal (a trigger failure is a warning, never a stranded turn).
//
// Refs: FP-02 FR-4, FR-5, FR-12, FR-16; FP-04 FR-10; FP-06 FR-3; TECH-SPECS §3.2, §5.1,
// §5.3, §7.6, §7.10, §11; D6, D23.

import { getConfig, getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { runPipeline, type RunPipelineResult } from "../_shared/pipeline/runPipeline.ts";
import { decideAutoAdopt, type AutoAdoptRow } from "../_shared/pipeline/autoAdopt.ts";
import { readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
import { sendPush, createAiMessagePushPayload } from "../_shared/push.ts";
import {
  findPrimaryReply,
  insertPrimaryReply,
  writeHoldingReplyAndEnqueueRetry,
} from "../_shared/replies.ts";
import { isProvidersUnavailable, type PipelineContext } from "../_shared/llm/errors.ts";
import type { ClassifyOverrides } from "../_shared/pipeline/classify.ts";
import { applyAutoAdoptBandShift, maybeRequestOath } from "../_shared/accountability/applyRider.ts";
import {
  buildMemoryExtractPayload,
  shouldExtractAtBoundary,
} from "../_shared/memory/boundary.ts";

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

/**
 * How many preceding `messages` rows `recordAutoAdoptSuccess` reads. FR-10 makes a materialized
 * check-in turn transparent to the §5.3 chain, so this scan has to see past one — it is a slice,
 * not `limit(1)` — and telling a check-in reply from an ordinary one needs each reply's anchor
 * row, which lands in the same slice. Ten rows is several turns of context in one bounded,
 * indexed read; `_shared/pipeline/autoAdopt.ts` documents what the walk does at the edge.
 */
const AUTO_ADOPT_SLICE = 10;

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

/**
 * D8 `auto_adopt_successes` (FR-14, AC-9; TECH-SPECS §5.3, §5.4; FP-04 FR-10).
 *
 * The signal is the user *engaging* with a turn the system answered on its own: if the row
 * immediately before this new user message is an `auto`-route **primary** reply written
 * within `config.auto_adopt_window_minutes`, one success is recorded for that reply's domain.
 * The rule itself — its four clauses, and FR-10's check-in transparency — lives in the pure
 * `_shared/pipeline/autoAdopt.ts` (`decideAutoAdopt`), where AC-7's directions are unit tests:
 *
 *   - **immediately before** (`D-B`): one success per auto-adopted reply, so a user who fires
 *     three follow-ups at one suggestion scores one engagement, not three. A user row in between
 *     means the auto reply was not the turn being answered.
 *   - **primary** (`D-A`): the degrade holding reply carries `route='degrade'`, and the Step 8
 *     `llm_retry` secondary row is a different insert entirely, so neither can read as one.
 *   - **server clock** (`D-C`): the window is `now - reply.created_at`, never `client_sent_at`.
 *   - **check-in transparency** (FP-04 FR-10): a materialized check-in turn is skipped rather
 *     than allowed to break the chain — a check-in is not persona engagement.
 *
 * This function is only the I/O half: one bounded slice read, the decision, one RPC.
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
    .select("id, role, reply_to_message_id, metadata, created_at")
    .eq("user_id", args.userId)
    .lt("created_at", args.userMessageCreatedAt)
    .order("created_at", { ascending: false })
    .limit(AUTO_ADOPT_SLICE);

  const decision = decideAutoAdopt({
    rows: (data ?? []) as AutoAdoptRow[],
    nowMs: Date.now(),
    windowMinutes,
  });
  if (!decision.qualifies || !decision.domain) return;

  const { error } = await supabaseService.rpc("increment_auto_adopt_successes", {
    p_user_id: args.userId,
    p_domain: decision.domain,
  });
  if (error) throw error;

  // FP-08 FR-4: the success half of the D8 rider rides the same event — +0.01 band_shift,
  // cap +0.10 — so the counter and the band can never drift apart. Throws are non-fatal at
  // this function's call site (the turn is already committed).
  await applyAutoAdoptBandShift(args.userId, decision.domain);

  console.log(
    "[send-message] auto_adopt_success",
    JSON.stringify({ domain: decision.domain, replyAgoMs: decision.replyAgoMs }),
  );
}

/**
 * The window-boundary trigger (FP-06 FR-3, §7.6). The count is Postgres `count(*)` over
 * the user's user-role rows — all sources, chat and check-in writes alike — read after
 * the fresh row lands. It runs in the fresh-insert branch only (the auto-adopt
 * recorder's clause discipline): a duplicate send, a §5.1 repair and an offline replay
 * take the other branch, so the count advances exactly once per real message.
 *
 * Zero provider calls: two Postgres roundtrips and, on a crossing, one job insert.
 * Non-fatal by design (see the call site) — a trigger failure must never strand a turn.
 */
async function maybeEnqueueMemoryExtract(userId: string): Promise<void> {
  const windowSize = await getConfigNumber("sliding_window_messages");

  const { count, error } = await supabaseService
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user");
  if (error) throw error;

  const boundary = count ?? 0;
  if (!shouldExtractAtBoundary(boundary, windowSize)) return;

  const { error: jobError } = await supabaseService
    .from("jobs")
    .insert({ type: "memory_extract", payload: buildMemoryExtractPayload(userId, boundary) });
  if (jobError) throw jobError;

  console.log("[send-message] memory_extract enqueued", JSON.stringify({ boundary }));
}

/**
 * FP-08 FR-10 (owner decision D26): the oath is captured only from a **confirmed** tap on the
 * oath-request row. The body carries `oath_confirmed: true` + `oath_request_id`; the request id
 * must be the message row immediately preceding this turn (no user row between) and must still
 * be unconsumed. Anything else degrades to an ordinary message — a forged or stale confirm is
 * ignored, never a 400, because the user's text is always worth answering.
 */
async function validateOathConfirmation(
  userId: string,
  requestId: string,
): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id, role, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = data?.[0];
  if (!last || last.id !== requestId || last.role !== "assistant") return null;
  const meta = (last.metadata ?? {}) as Record<string, unknown>;
  if (meta.source !== "oath_request" || meta.oath_request !== true) return null;
  if (meta.consumed === true) return null;
  return requestId;
}

/**
 * FR-10's capture (FR-10, §7.6, D6): the user's confirmed oath text is stored verbatim as
 * `memory_facts (fact_type='oath', source_message_id=<this message>)`, reusing the turn's own
 * embedding — zero added provider calls. Claim-first: the request is marked consumed before
 * the fact exists, so a crash loses an oath rather than duplicating a non-purgeable one.
 */
async function captureOathFact(args: {
  userId: string;
  requestId: string;
  messageId: string;
  text: string;
  embedding: number[];
  embedModel: string | null;
}): Promise<boolean> {
  const { data: request, error: readError } = await supabaseService
    .from("messages")
    .select("id, metadata")
    .eq("id", args.requestId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (readError) throw readError;
  if (!request) return false;

  const meta = (request.metadata ?? {}) as Record<string, unknown>;
  const nextMeta = {
    ...meta,
    consumed: true,
    consumed_at: new Date().toISOString(),
    consumed_message_id: args.messageId,
  };
  const { data: claimed, error: claimError } = await supabaseService
    .from("messages")
    .update({ metadata: nextMeta })
    .eq("id", args.requestId)
    .eq("user_id", args.userId)
    .is("metadata->>consumed", null)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) return false;

  const { error: factError } = await supabaseService.from("memory_facts").insert({
    user_id: args.userId,
    fact: args.text,
    fact_type: "oath",
    source_message_id: args.messageId,
    embed_model: args.embedModel,
    embedding: args.embedding,
  });
  if (factError) throw factError;

  console.log(
    JSON.stringify({
      tag: "[send-message]",
      event: "oath_captured",
      requestId: args.requestId,
      messageId: args.messageId,
    }),
  );
  return true;
}

/**
 * Synchronous degrade (TECH-SPECS §4.1, FP-02 Step 8) — the response-shaping half.
 *
 * The machinery (holding reply as the PRIMARY reply, then exactly one `llm_retry` job, and the
 * reasons for each) is `writeHoldingReplyAndEnqueueRetry` in `_shared/replies.ts`, shared with
 * `submit-checkin`'s intervention turn so the two functions cannot drift. This wrapper only
 * turns its outcome into this function's body: the winner's id when the race was lost, the
 * holding reply's id otherwise.
 */
async function degradeToHoldingReply(args: {
  userId: string;
  userMessageId: string;
  context?: PipelineContext;
}): Promise<Response> {
  const holding = await writeHoldingReplyAndEnqueueRetry(args);

  if (!holding.ok) {
    console.warn("[send-message] degrade race lost — turn already answered", args.userMessageId);
    if (!holding.winnerId) throw new Error("degrade race lost but no winner found");
    return json({
      user_message_id: args.userMessageId,
      assistant_message_id: holding.winnerId,
      status: "duplicate",
    });
  }

  return json({
    user_message_id: args.userMessageId,
    assistant_message_id: holding.assistantMessageId,
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

  // FP-08 FR-10 (owner decision D26): the oath is captured only when the client confirms the
  // request row it is answering. `oath_request_id` is validated against server state below;
  // the flag alone never captures anything.
  const oathConfirmed = body.oath_confirmed === true;
  let oathRequestId: string | null = null;
  if (oathConfirmed) {
    const raw = body.oath_request_id;
    if (typeof raw !== "string" || !UUID_RE.test(raw)) {
      return json({ error: "oath_request_id must be a uuid when oath_confirmed is set" }, 400);
    }
    oathRequestId = raw;
  }

  try {
    // Absolute budget for the synchronous pipeline (§4.1). Measured from the server clock
    // at request start — never from the client's `client_sent_at` (untrusted input) and
    // never from the user row's `created_at` (a repair run reuses an older row, which
    // would trip the guard immediately and degrade every repair).
    const deadlineAt = Date.now() + pipelineDeadlineMs;

    // FR-10's confirmation check runs BEFORE the user row lands: "the immediately preceding
    // assistant row" is only meaningful while the request is still the newest message.
    let oathRequestToConsume: string | null = null;
    if (oathConfirmed && oathRequestId) {
      try {
        oathRequestToConsume = await validateOathConfirmation(userId, oathRequestId);
      } catch (err) {
        console.warn(
          "[send-message] oath confirmation check failed:",
          err instanceof Error ? err.message : err,
        );
      }
      if (!oathRequestToConsume) {
        console.warn("[send-message] oath confirm ignored — no unconsumed preceding request");
      }
    }

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
    let freshInsert = false;

    if (inserted && inserted.length > 0) {
      userMessageId = inserted[0].id as string;
      text = content;
      freshInsert = true;

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

      // Window-boundary trigger (FP-06 FR-3): this fresh insert advanced the user-message
      // count; a crossing enqueues the memory_extract job. Same clause discipline as the
      // recorder above (fresh-insert branch only), same non-fatal contract — a trigger
      // failure is a warning, never a stranded turn.
      try {
        await maybeEnqueueMemoryExtract(userId);
      } catch (err) {
        console.warn(
          "[send-message] memory-extract boundary trigger failed:",
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
      result = await runPipeline({
        text,
        userId,
        overrides,
        deadlineAt,
        applyRider: true,
        sourceMessageId: userMessageId,
      });
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

    // FP-08 FR-10: the confirmed oath capture. The request was validated before the user row
    // landed; the fact reuses this turn's embedding (zero provider calls). Claim-first inside
    // the helper makes it at-most-once.
    if (freshInsert && oathRequestToConsume) {
      if (result.messageEmbedding) {
        try {
          await captureOathFact({
            userId,
            requestId: oathRequestToConsume,
            messageId: userMessageId,
            text,
            embedding: result.messageEmbedding,
            embedModel: result.embedModel ?? null,
          });
        } catch (err) {
          console.warn(
            "[send-message] oath capture failed:",
            err instanceof Error ? err.message : err,
          );
        }
      } else {
        console.warn("[send-message] oath capture skipped — the turn has no embedding");
      }
    }

    // FP-08 FR-10: the oath request trigger (post-rider, post-commit, fresh turn only). The
    // threshold reads the pre-rider score — AC-4's 69 must not cross on its own admission
    // delta. Non-fatal: the reply is already written.
    if (freshInsert) {
      try {
        const oath = await maybeRequestOath({
          userId,
          admission: result.routeInfo.extraction?.intent_flags?.admission === true,
          trustBefore: result.riderProbe?.trust_before ?? null,
          sourceMessageId: userMessageId,
        });
        if (oath.requested) console.log("[send-message] oath_request enqueued", userMessageId);
      } catch (err) {
        console.warn(
          "[send-message] oath trigger failed:",
          err instanceof Error ? err.message : err,
        );
      }
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
