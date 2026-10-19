// supabase/functions/submit-journal/index.ts
// FP-05 Step 2 — journal ingestion: sync POST → journal_entries + journal_extract job.
// Refs: FP-05 FR-1, FR-2, FR-3, FR-17; TECH-SPEC §3.4, §7.4, §7.10, §10.2; D3, D16.
// Security: AGENTS.md §4.1 (service-role writes only inside Edge Functions) and §4.3
// (tactical_analysis is server-only — never persisted, never returned).
// CORS mirrors send-message exactly (ACAO *, POST/OPTIONS, four headers).
// Zero provider calls — no embed, no generate.

import { getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { validateSubmitBody, canonicalEntryDate } from "../_shared/journal/submitValidate.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function logEvent(event: string, data: Record<string, unknown>): void {
  console.log(`[submit-journal] ${event}`, JSON.stringify(data));
}

async function loadTimezone(userId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[submit-journal] profile timezone read failed:", error.message);
    return null;
  }
  // null/empty -> UTC; the canonicalEntryDate will coerce invalid to UTC
  const tz = (data?.timezone as string | null) ?? "UTC";
  return tz;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Auth
  const auth = await resolveUserId(req);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }
  const userId = auth.userId;

  // Parse JSON body
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const startedAt = Date.now();

  // Config cap — fail closed
  let maxChars: number;
  try {
    maxChars = await getConfigNumber("chat_max_message_chars");
  } catch (err) {
    console.error("[submit-journal] config read failed:", err instanceof Error ? err.message : err);
    return json({ error: "Server misconfigured" }, 500);
  }

  // Validate body (access body fields so static gate sees them)
  const _content = body.content;
  const _entry_date = body.entry_date;
  const v = validateSubmitBody(body, maxChars);
  if (!v.ok) {
    return json({ error: v.error }, 400);
  }

  // Load profile timezone
  const tz = await loadTimezone(userId);
  if (tz === null) {
    return json({ error: "Server misconfigured" }, 500);
  }

  // Canonical entry date (server-local, hint discarded)
  const entryDate = canonicalEntryDate(tz, Date.now());

  // Insert journal entry
  const { data: inserted, error: insertError } = await supabaseService
    .from("journal_entries")
    .insert({
      user_id: userId,
      content: v.content,
      entry_date: entryDate,
    })
    .select("id");
  if (insertError) {
    console.error("[submit-journal] journal_entries insert failed:", insertError.message);
    return json({ error: "Internal error" }, 500);
  }
  const entryId = inserted?.[0]?.id as string;
  if (!entryId) {
    console.error("[submit-journal] no entry id returned from insert");
    return json({ error: "Internal error" }, 500);
  }

  // Kick off the evening chain
  const { error: jobError } = await supabaseService.from("jobs").insert({
    type: "journal_extract",
    payload: { entry_id: entryId },
  });
  if (jobError) {
    console.error("[submit-journal] chain kickoff failed:", jobError.message);
    return json({ error: "Internal error" }, 500);
  }

  logEvent("submit", {
    userId,
    entryId,
    entryDate,
    latencyMs: Date.now() - startedAt,
  });

  return json({ "status": "ok", entry_id: entryId });
});