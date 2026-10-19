// supabase/functions/select-persona/index.ts
// FP-02 Step 6 — Medium-tier persona chip selection (TECH-SPECS §5.3, §7.10).
//
// A tap on one of an option message's chips re-runs stages 3–5 with the persona locked
// and writes a SECONDARY reply. Two schema rules govern that row (§3.2):
//   * `reply_to_message_id` stays NULL — the `messages_one_primary_reply` guard would
//     otherwise reject it, and the client would drop it;
//   * its anchor goes in `secondary_reply_to_message_id`, guarded by
//     `messages_one_secondary_reply`, so one tap consumes the whole option set (AC-3).
//
// Trust boundary: the request body carries ids only. The user's text and the domain are
// read server-side — the domain from the option message's own `metadata`, the text from
// the user message that option message answers. The anchor is the option message's
// `reply_to_message_id` column, which §3.2 makes authoritative (`metadata.user_message_id`
// is a convenience copy, so it is never used for this).
//
// Refs: FP-02 FR-11 (validated key, stages 3–5 re-run, consumed = no-op); TECH-SPECS
// §3.2, §5.3, §7.10; D13. Security: AGENTS.md §4.1 (service-role writes only inside Edge
// Functions), §4.3 (`tactical_analysis` is logged server-side only).
//
// Push for the reply is deferred to Step 7 (FR-15), which wires `_shared/push.ts` into
// both `send-message` and here.

import { supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { runLockedPersonaReply } from "../_shared/pipeline/runPipeline.ts";
import { PERSONA_KEYS } from "../_shared/prompts/guardrails.ts";
import { sendPush, createAiMessagePushPayload } from "../_shared/push.ts";

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

const PERSONA_KEY_SET: ReadonlySet<string> = new Set<string>(PERSONA_KEYS);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface PersonaOption {
  key: string;
  label: string;
  one_liner: string;
}

/** The chips carried by an option message, or null when it carries none. */
function readPersonaOptions(metadata: unknown): PersonaOption[] | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { persona_options?: unknown }).persona_options;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const options: PersonaOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") continue;
    options.push({
      key: o.key,
      label: o.label,
      one_liner: typeof o.one_liner === "string" ? o.one_liner : "",
    });
  }
  return options.length > 0 ? options : null;
}

/** Id of the secondary reply already written for a user message, or null. */
async function findSecondaryReply(userMessageId: string): Promise<string | null> {
  const { data } = await supabaseService
    .from("messages")
    .select("id")
    .eq("role", "assistant")
    .eq("secondary_reply_to_message_id", userMessageId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Insert the secondary reply. Returns `{ raceLost: true }` when the
 * `messages_one_secondary_reply` index rejects it — a concurrent tap already consumed
 * the option set.
 */
async function insertSecondaryReply(args: {
  userId: string;
  userMessageId: string;
  personaKey: string;
  content: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string } | { raceLost: true }> {
  const { data, error } = await supabaseService
    .from("messages")
    .insert({
      user_id: args.userId,
      role: "assistant",
      content: args.content,
      // Secondary reply: NULL by contract — the anchor lives in its own column.
      reply_to_message_id: null,
      persona_key: args.personaKey,
      secondary_reply_to_message_id: args.userMessageId,
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

  const messageId = body.message_id;
  if (typeof messageId !== "string" || !UUID_RE.test(messageId)) {
    return json({ error: "message_id must be a uuid" }, 400);
  }

  const personaKey = body.persona_key;
  if (typeof personaKey !== "string" || personaKey.length === 0) {
    return json({ error: "persona_key is required" }, 400);
  }

  try {
    // --- Load the option message (the row the chips were rendered from) ---
    const { data: option, error: optionError } = await supabaseService
      .from("messages")
      .select("id, role, reply_to_message_id, metadata")
      .eq("id", messageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (optionError) throw optionError;
    if (!option) return json({ error: "message not found" }, 404);
    if (option.role !== "assistant") {
      return json({ error: "message_id must reference an assistant reply" }, 400);
    }

    const options = readPersonaOptions(option.metadata);
    if (!options) return json({ error: "message carries no persona options" }, 400);

    // FR-11: the chosen key must be one of THIS message's options. The enum check is
    // belt-and-braces for the Groq path, where JSON mode does not enforce the schema's
    // `key` enum (TECH-SPECS §4.1, AGENTS.md §8.1) — the model could hand us an option
    // whose key is not a real persona.
    const offered = options.some((o) => o.key === personaKey);
    if (!offered || !PERSONA_KEY_SET.has(personaKey)) {
      return json({ error: "persona_key is not one of this message's options" }, 400);
    }

    // §3.2: the primary-reply link is authoritative for the turn this answers.
    const userMessageId = option.reply_to_message_id as string | null;
    if (!userMessageId) {
      return json({ error: "option message is not linked to a user message" }, 409);
    }

    const domain = (option.metadata as { domain?: unknown } | null)?.domain;
    if (typeof domain !== "string" || domain.length === 0) {
      console.error("[select-persona] option message has no domain:", messageId);
      return json({ error: "option message has no domain" }, 409);
    }

    // --- Consumed already? One tap consumes the whole option set (AC-3) ---
    const existing = await findSecondaryReply(userMessageId);
    if (existing) {
      return json({ assistant_message_id: existing, status: "duplicate" });
    }

    // --- The user's own words, server-side only (never trusted from the body) ---
    const { data: userRow, error: userError } = await supabaseService
      .from("messages")
      .select("id, role, content")
      .eq("id", userMessageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!userRow || userRow.role !== "user") {
      return json({ error: "the message this option set belongs to is gone" }, 409);
    }

    // --- Stages 3–5 with the persona locked ---
    // `userId` carries the FP-05 day-plan riders (FR-13): this turn is the user's own message
    // re-run under the chosen persona, so it must carry the plan exactly as `send-message` did.
    const result = await runLockedPersonaReply({
      text: userRow.content as string,
      domain,
      persona: personaKey,
      userId,
    });

    // tactical_analysis: server log only — never persisted, never returned (§4.2).
    console.log(
      "[select-persona] tactical_analysis:",
      result.tacticalAnalysis,
      JSON.stringify({
        persona: result.persona,
        domain: result.domain,
        rules: result.ruleIds.length,
        provider: result.provider,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        degraded: result.degraded,
        dayPlan: result.dayPlanProbe,
      }),
    );

    // `route` records the tier that produced the turn (the Medium tier, resolved by the
    // user's choice) — NOT `auto`, so the Step 10 auto-adopt counter never mistakes a
    // deliberate choice for an accepted suggestion (§5.4).
    const metadata: Record<string, unknown> = {
      persona: personaKey,
      route: "options",
      domain,
      rule_ids: result.ruleIds,
      source: "pipeline_secondary",
      user_message_id: userMessageId,
    };

    const reply = await insertSecondaryReply({
      userId,
      userMessageId,
      personaKey,
      content: result.assistantContent,
      metadata,
    });

    if ("raceLost" in reply) {
      // A concurrent tap consumed the set first.
      const winner = await findSecondaryReply(userMessageId);
      if (!winner) throw new Error("secondary reply race lost but no winner found");
      return json({ assistant_message_id: winner, status: "duplicate" });
    }

    // --- Send Expo push (best-effort but guaranteed to run: bounded wait, never blocks past 5 s) ---
    const pushPayload = createAiMessagePushPayload(userId, result.assistantContent);
    try {
      await Promise.race([
        sendPush(pushPayload),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    } catch (err) {
      console.error("[select-persona] push send failed:", err instanceof Error ? err.message : err);
    }

    return json({ assistant_message_id: reply.id, status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[select-persona] failed:", msg);
    return json({ error: "Failed to select persona" }, 500);
  }
});
