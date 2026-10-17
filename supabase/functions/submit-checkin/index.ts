// supabase/functions/submit-checkin/index.ts
// FP-04 Step 2 — check-in ingestion: POST (a check-in doing) and PATCH (a later energy chip).
//
// Refs: FP-04 FR-5, FR-6, FR-7, FR-8, FR-9, FR-14, FR-15, FR-18, NFR-5, NFR-7;
// TECH-SPEC §3.2 (`doings_logs`), §7.1 (the check-in loop and the frozen grid contract),
// §7.10 (CORS), §11; D9.
// Security: AGENTS.md §4.1 (service-role writes happen only inside Edge Functions). The client
// holds no write path it needs, and the `doings_logs` INSERT/UPDATE grant it retains is a
// recorded open surface, asserted by the gate — not widened here.
//
// Why one function for both verbs: they are the same resource (`doings_logs`) and the same
// idempotency story. A separate `patch-energy` function would add a deploy, a second CORS
// contract and a second auth path for one UPDATE (TECH-SPEC §7.1).
//
// Canonicalization (FR-5, §7.1): the client's `windowTs` is a **hint**. The server snaps it to
// the canonical grid window before it touches the duplicate check or the insert, so a shifted
// or replayed hint can never mint a second row for the same window. The arithmetic lives in
// `_shared/checkin/windows.ts` — the twin the client grid and the Step 6 watchdog share.
//
// Duplicate (FR-8): the check runs **before** the embed, so a repeat submit costs zero provider
// calls. The unique partial index `doings_logs_one_checkin_window` is the backstop for a race,
// and the loser re-selects the winner's row rather than failing.
//
// Embedding (FR-7): exactly one `llm.embed([content])`, and its `model` is stamped on the row
// (`gemini-embedding-001@768` — the frozen identity, D5). A provider failure returns 503 and
// stores nothing, so the client's pending-check-in store replays the *same* window: no lost
// doing, and no vectorless row that a later duplicate check would freeze in place forever.

import { getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { embed } from "../_shared/llm/adapter.ts";
import { parseEnergy, sourceForCapture, type CheckinCapture } from "../_shared/checkin/parseEnergy.ts";
import { loadGrid } from "../_shared/checkin/loadGrid.ts";
import { canonicalizeWindow } from "../_shared/checkin/windows.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // `PATCH` is part of this function's contract (the energy chip), so the preflight must allow
  // it or a web client's chip tap is blocked before it is ever sent (§7.10).
  "Access-Control-Allow-Methods": "POST, PATCH, OPTIONS",
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

/** One structured line per submit/patch — the §7.1 observability contract (FR-18). */
function logEvent(scope: string, fields: Record<string, unknown>): void {
  console.log(`[submit-checkin] ${scope}`, JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

/** The existing doing for a canonical window, if the window was already answered (FR-8). */
async function findDoingForWindow(
  userId: string,
  windowIso: string,
): Promise<{ id: string; energy: number | null } | null> {
  const { data, error } = await supabaseService
    .from("doings_logs")
    .select("id, energy")
    .eq("user_id", userId)
    .eq("checkin_window", windowIso)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, energy: (data.energy as number | null) ?? null } : null;
}

/**
 * `profiles.latest_energy` tracks the newest *known* energy (FR-7/FR-14) — from either the
 * text parse or a chip. It is never cleared, so a later energy-less doing leaves it standing.
 *
 * Non-fatal by design, mirroring `recordAutoAdoptSuccess` in `send-message`: the doing row is
 * already committed, and a failure of a derived convenience column must not turn into a 500
 * whose replay the user reads as "my check-in didn't save".
 */
async function setLatestEnergy(userId: string, energy: number): Promise<void> {
  const { error } = await supabaseService
    .from("profiles")
    .update({ latest_energy: energy })
    .eq("id", userId);
  if (error) {
    console.error("[submit-checkin] latest_energy update failed:", error.message);
  }
}

/**
 * POST — a check-in reply. Returns the frozen FR-5 response shape:
 * `{status, doing_id, energy, eval_ran, intervention}`.
 *
 * `eval_ran` and `intervention` are structurally `false` here: Step 2 stores the doing and
 * stops. The deterministic gates and the intervention turn are Step 3, and the shape is frozen
 * now so the client is written once.
 */
async function handleSubmit(userId: string, body: Record<string, unknown>): Promise<Response> {
  // [SPEC] cap, read at runtime — never hardcoded (AGENTS.md §2).
  let maxChars: number;
  try {
    maxChars = await getConfigNumber("chat_max_message_chars");
  } catch (err) {
    console.error("[submit-checkin] config error:", err instanceof Error ? err.message : err);
    return json({ error: "Server misconfigured" }, 500);
  }

  const content = body.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return json({ error: "content is required" }, 400);
  }
  if (content.length > maxChars) {
    return json({ error: `content exceeds ${maxChars} characters` }, 400);
  }

  const capture = body.capture;
  if (capture !== "reply" && capture !== "chat") {
    return json({ error: "capture must be 'reply' or 'chat'" }, 400);
  }
  const source = sourceForCapture(capture);

  // FR-18's submit log: every return below records the same fields plus a latency measured from
  // here (after input validation, before the grid read). Step 3 adds the gate/eval/intervention
  // fields; the shape and the measure are settled now so the tuning feed is comparable across it.
  const startedAt = Date.now();
  const log = (fields: Record<string, unknown>) =>
    logEvent("submit", { userId, capture, latencyMs: Date.now() - startedAt, ...fields });

  // FR-9: the chat path carries the optimistic bubble's id. It is validated here so a
  // malformed body is rejected before any work; Step 3b's intervention reply is the only
  // writer that consumes it.
  if (body.client_message_id !== undefined && body.client_message_id !== null) {
    if (typeof body.client_message_id !== "string" || !UUID_RE.test(body.client_message_id)) {
      return json({ error: "client_message_id must be a uuid" }, 400);
    }
  }

  // FR-5: `windowTs` is an ISO timestamp *hint* on the grid, canonicalized below.
  if (typeof body.windowTs !== "string" || Number.isNaN(Date.parse(body.windowTs))) {
    return json({ error: "window_malformed" }, 400);
  }
  const hintMs = Date.parse(body.windowTs);

  const grid = await loadGrid(userId);
  if (!grid) {
    console.error("[submit-checkin] no usable grid for", userId);
    return json({ error: "Server misconfigured" }, 500);
  }

  const nowMs = Date.now();
  const resolved = canonicalizeWindow(grid, hintMs, nowMs);
  if (!resolved.ok) {
    log({ outcome: resolved.reason });
    return json({ error: resolved.reason }, 400);
  }
  const { window, snappedMs } = resolved;
  const windowIso = new Date(window.startMs).toISOString();

  // FR-8: duplicate first, provider calls never. A replayed or shifted hint maps to the same
  // canonical window, so this is the ONLY dedupe the happy path needs.
  const existing = await findDoingForWindow(userId, windowIso);
  if (existing) {
    log({
      window: windowIso,
      energy: existing.energy,
      outcome: "duplicate",
      snappedMs,
    });
    return json({
      status: "duplicate",
      doing_id: existing.id,
      energy: existing.energy,
      eval_ran: false,
      intervention: false,
    });
  }

  // FR-6: the trailing 1–10, or null — a first-class outcome, answered later by the chips strip.
  const energy = parseEnergy(content);

  // FR-7: exactly one embed, and nothing is written if it fails (see the header).
  const embedded = await embed([content]);
  if (!embedded.ok || !embedded.data) {
    console.error("[submit-checkin] embed failed:", embedded.error ?? "no data");
    log({ window: windowIso, outcome: "embed_unavailable" });
    return json({ error: "embed_unavailable" }, 503);
  }

  // `logged_at` is the canonical window's **close**, not the submit instant: it answers "when
  // did this happen", which is what the doings corpus and the drift math read. Deriving it
  // from the window also makes a replay after a process death record the same instant rather
  // than a misleading later one.
  const { data: inserted, error: insertError } = await supabaseService
    .from("doings_logs")
    .insert({
      user_id: userId,
      kind: "doing",
      content,
      energy,
      source,
      logged_at: new Date(window.closeMs).toISOString(),
      checkin_window: windowIso,
      embedding: embedded.data.embeddings[0],
      embed_model: embedded.data.model,
    })
    .select("id");

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      // Lost the race to a concurrent submit for this window — the winner's row is the answer
      // (the `messages_one_primary_reply` precedent in `send-message`).
      const winner = await findDoingForWindow(userId, windowIso);
      if (winner) {
        log({
          window: windowIso,
          energy: winner.energy,
          outcome: "duplicate",
          race: true,
        });
        return json({
          status: "duplicate",
          doing_id: winner.id,
          energy: winner.energy,
          eval_ran: false,
          intervention: false,
        });
      }
    }
    throw insertError;
  }

  const doingId = inserted![0].id as string;
  if (energy !== null) await setLatestEnergy(userId, energy);

  log({ window: windowIso, energy, outcome: "ok", snappedMs, doingId });
  return json({ status: "ok", doing_id: doingId, energy, eval_ran: false, intervention: false });
}

/**
 * PATCH — set the energy on an existing doing (FR-14). Own rows only; a foreign id is a 404,
 * never a 403, so the caller learns nothing about another user's rows.
 */
async function handleEnergyPatch(userId: string, body: Record<string, unknown>): Promise<Response> {
  const doingId = body.doing_id;
  if (typeof doingId !== "string" || !UUID_RE.test(doingId)) {
    return json({ error: "doing_id must be a uuid" }, 400);
  }

  const energy = body.energy;
  if (typeof energy !== "number" || !Number.isInteger(energy) || energy < 1 || energy > 10) {
    return json({ error: "energy must be an integer 1-10" }, 400);
  }

  const { data, error } = await supabaseService
    .from("doings_logs")
    .select("id, user_id")
    .eq("id", doingId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== userId) {
    logEvent("patch", { userId, doingId, outcome: "not_found" });
    return json({ error: "doing not found" }, 404);
  }

  // The `user_id` filter is defence in depth: the own-row read above already gated it, but the
  // write itself should never be able to touch another user's row.
  const { error: updateError } = await supabaseService
    .from("doings_logs")
    .update({ energy })
    .eq("id", doingId)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  await setLatestEnergy(userId, energy);
  logEvent("patch", { userId, doingId, energy, outcome: "ok" });
  return json({ ok: true, doing_id: doingId, energy });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST" && req.method !== "PATCH") {
    return json({ error: "Method not allowed" }, 405);
  }

  // JWT is verified by the gateway (verify_jwt default); resolve the user ourselves too.
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

  try {
    return req.method === "POST"
      ? await handleSubmit(userId, body)
      : await handleEnergyPatch(userId, body);
  } catch (err) {
    console.error("[submit-checkin] unhandled:", err instanceof Error ? err.message : err);
    return json({ error: "Internal error" }, 500);
  }
});
