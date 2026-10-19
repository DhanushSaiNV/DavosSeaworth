// supabase/functions/flag-unsavable/index.ts
// FP-06 Step 2 — the late flag: `messages.unsavable=true` + exactly one `purge_memory` job
// (TECH-SPEC §7.6, FP-06 FR-1). The D6 correction mechanism's chat half — the journal's
// pre-submission strip (BG-10) is the other, and it runs client-side.
//
// The body is `{message_id}` — an id and nothing else (the §5.3 request-body rule). The
// row is read **scoped to the caller's own user_id**, so an unknown id and a foreign
// user's id are indistinguishable: both read as absent and answer 404. That read is the
// authorization boundary; the service-role write below can therefore never touch a row
// the caller does not own.
//
// Idempotent re-flag (FR-1): an already-flagged row returns the same `ok` and enqueues
// nothing. The pre-check read races only under a concurrent double-flag — a double-enqueued
// purge is tolerated because the handler is idempotent by construction (§2.2 clause 4).
//
// Zero provider calls: no adapter import, no LLM anywhere on this path.
//
// Refs: FP-06 FR-1, FR-2, FR-16, FR-17; TECH-SPEC §7.6, §7.10, §10.2, §5.4; D3, D6.
// Security: AGENTS.md §4.1 (service-role writes only inside Edge Functions).

import { supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { decideFlag, parseFlagBody } from "../_shared/memory/flagContract.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // `x-client-info` is injected by supabase-js on every request (`X-Client-Info:
  // supabase-js/<version>; runtime=web`), so the preflight must allow it or the browser
  // blocks the call outright. Mirrors `send-message` exactly.
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = parseFlagBody(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  try {
    // Own-rows read: the user_id filter IS the boundary (see the header note).
    const { data: row, error: readError } = await supabaseService
      .from("messages")
      .select("id, role, unsavable")
      .eq("id", parsed.messageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw readError;

    const decision = decideFlag(row);

    if (decision === "not_found") {
      return json({ error: "Message not found" }, 404);
    }
    if (decision === "assistant") {
      // 400, not 404: the row exists and is the caller's — the request is understood and
      // refused, because an assistant row is never a memory source (FR-1 reading).
      return json({ error: "Cannot flag an assistant message" }, 400);
    }
    if (decision === "already_flagged") {
      console.log(
        "[flag-unsavable]",
        JSON.stringify({ message_id: parsed.messageId, outcome: "no-flip" }),
      );
      return json({ status: "ok", message_id: parsed.messageId });
    }

    const { error: updateError } = await supabaseService
      .from("messages")
      .update({ unsavable: true })
      .eq("id", parsed.messageId)
      .eq("user_id", userId);
    if (updateError) throw updateError;

    // Exactly one purge job on the flip. The handler is idempotent, so a rare
    // concurrent-marking double insert is harmless (§2.2 clause 4).
    const { error: jobError } = await supabaseService
      .from("jobs")
      .insert({ type: "purge_memory", payload: { message_id: parsed.messageId } });
    if (jobError) throw jobError;

    console.log(
      "[flag-unsavable]",
      JSON.stringify({ message_id: parsed.messageId, outcome: "flip" }),
    );
    return json({ status: "ok", message_id: parsed.messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[flag-unsavable] failed:", msg);
    return json({ error: "Failed to flag message" }, 500);
  }
});
