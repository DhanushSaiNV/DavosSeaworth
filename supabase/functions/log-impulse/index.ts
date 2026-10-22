// supabase/functions/log-impulse/index.ts
// FP-08 Step 8 — the impulse quick-log (FR-20, D22's logging half).
//
// Sync, zero providers: validate the optional text against `chat_max_message_chars`, insert
// `doings_logs(kind='impulse_failure', source=capture, logged_at=server now)`, apply the FR-2
// candor credit (first three per local day, reason `openness`), acknowledge `{doing_id}`.
//
// No server dedupe: an impulse has no natural key (the submit-journal R-4 acceptance). The
// 14-day histogram smooths a stray double-tap. The client disables its button while in flight;
// the quick action is one OS event.
//
// Refs: FP-08 FR-2, FR-20, FR-21; TECH-SPEC §7.8, §3.2, §8, §9; D22.

import { getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { applyImpulseCandorCredit } from "../_shared/accountability/applyRider.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type Capture = "quick_action" | "app";

function isCapture(value: unknown): value is Capture {
  return value === "quick_action" || value === "app";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await resolveUserId(req);
  if (!auth.ok) return json({ error: auth.message }, auth.status);
  const userId = auth.userId;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let maxChars: number;
  try {
    maxChars = await getConfigNumber("chat_max_message_chars");
  } catch (err) {
    console.error("[log-impulse] config error:", err instanceof Error ? err.message : err);
    return json({ error: "Server misconfigured" }, 500);
  }

  if (!isCapture(body.capture)) {
    return json({ error: "capture must be 'quick_action' or 'app'" }, 400);
  }

  let content: string | null = null;
  if (body.content !== undefined && body.content !== null) {
    if (typeof body.content !== "string") {
      return json({ error: "content must be a string" }, 400);
    }
    const trimmed = body.content.trim();
    if (trimmed.length > maxChars) {
      return json({ error: `content exceeds ${maxChars} characters` }, 400);
    }
    content = trimmed.length > 0 ? trimmed : null;
  }

  const loggedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseService
    .from("doings_logs")
    .insert({
      user_id: userId,
      kind: "impulse_failure",
      content,
      source: body.capture,
      logged_at: loggedAt,
    })
    .select("id");

  if (insertError || !inserted || inserted.length === 0) {
    console.error("[log-impulse] insert failed:", insertError?.message ?? "no row");
    return json({ error: "Internal error" }, 500);
  }

  const doingId = inserted[0].id as string;

  // The row is committed. A failed credit is a derived-write failure, not a lost impulse.
  try {
    const { data: profile } = await supabaseService
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    const timezone = (profile?.timezone as string | null) || "UTC";
    const credit = await applyImpulseCandorCredit({ userId, timezone, nowMs: Date.now() });
    console.log(
      "[log-impulse]",
      JSON.stringify({
        user_id: userId,
        doing_id: doingId,
        capture: body.capture,
        candor_awarded: credit.awarded,
        credits_today: credit.credits_today,
      }),
    );
  } catch (err) {
    console.error(
      "[log-impulse] candor credit failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return json({ doing_id: doingId });
});
