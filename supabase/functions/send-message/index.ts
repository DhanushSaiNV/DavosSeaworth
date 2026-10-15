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

import { getConfig, getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { runPipeline } from "../_shared/pipeline/runPipeline.ts";
import { readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
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

  // [SPEC] cap, read at runtime — never hardcoded (AGENTS.md §2).
  let maxChars: number;
  try {
    maxChars = await getConfigNumber("chat_max_message_chars");
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
      .select("id");
    if (insertError) throw insertError;

    let userMessageId: string;
    let text: string;

    if (inserted && inserted.length > 0) {
      userMessageId = inserted[0].id as string;
      text = content;
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

    const result = await runPipeline({ text, userId, overrides });

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
