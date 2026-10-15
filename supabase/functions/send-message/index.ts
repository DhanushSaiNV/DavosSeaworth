// supabase/functions/send-message/index.ts
// FP-02 Step 4 — user chat message → 5-stage pipeline → assistant reply.
//
// Refs: FP-02 FR-4, FR-5, FR-12, FR-16; TECH-SPECS §5.1, §7.10, §3.2; D23.
// Security: AGENTS.md §4.1 (service-role writes only inside Edge Functions) and §4.3
// (`tactical_analysis` is logged server-side only — never persisted, never returned).
//
// Idempotency (FR-5/FR-16): the user row carries a client-generated `client_message_id`
// with a unique (user_id, client_message_id) index. A repeat send neither creates a new
// user row nor re-runs the pipeline.
//
// KNOWN LIMITATION (deferred to Step 8, which owns this handler's failure path): if the
// invocation dies after the user insert but before the assistant insert, a later retry is
// seen as a duplicate and the turn is not auto-repaired. Step 8's degrade path narrows
// this window; the explicit-claim fix is scheduled there.

import { getConfig, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { runPipeline } from "../_shared/pipeline/runPipeline.ts";
import { readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
import type { ClassifyOverrides } from "../_shared/pipeline/classify.ts";

const MAX_CONTENT_LENGTH = 8000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
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

  const content = body.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return json({ error: "content is required" }, 400);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return json({ error: `content exceeds ${MAX_CONTENT_LENGTH} characters` }, 400);
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
    // --- Insert the user row, deduped by (user_id, client_message_id) ---
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

    // ON CONFLICT DO NOTHING returns zero rows → a duplicate send. Return the existing
    // turn and skip the pipeline (the idempotency rule: run exactly once per new message).
    if (!inserted || inserted.length === 0) {
      const { data: existing, error: existingError } = await supabaseService
        .from("messages")
        .select("id")
        .eq("user_id", userId)
        .eq("client_message_id", clientMessageId)
        .single();
      if (existingError || !existing) {
        throw existingError ?? new Error("duplicate row could not be located");
      }

      const { data: reply } = await supabaseService
        .from("messages")
        .select("id")
        .eq("user_id", userId)
        .eq("role", "assistant")
        .eq("metadata->>user_message_id", existing.id)
        .maybeSingle();

      return json({
        user_message_id: existing.id,
        assistant_message_id: reply?.id ?? null,
        status: "duplicate",
      });
    }

    const userMessageId = inserted[0].id as string;

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

    const result = await runPipeline({ text: content, userId, overrides });

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

    // --- Insert the assistant row via service role ---
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

    const { data: assistant, error: assistantError } = await supabaseService
      .from("messages")
      .insert({
        user_id: userId,
        role: "assistant",
        content: result.assistantContent,
        metadata,
      })
      .select("id")
      .single();
    if (assistantError) throw assistantError;

    return json({
      user_message_id: userMessageId,
      assistant_message_id: assistant.id as string,
      status: "ok",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-message] failed:", msg);
    return json({ error: "Failed to process message" }, 500);
  }
});
