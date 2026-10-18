// supabase/functions/submit-checkin/index.ts
// FP-04 Steps 2–3b — check-in ingestion: POST (a check-in doing) and PATCH (a later energy chip).
//
// Refs: FP-04 FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-18,
// NFR-5, NFR-7; TECH-SPEC §3.2 (`doings_logs`, `messages`), §5.1, §5.3, §6.1–6.2, §7.1 (the
// check-in loop and the frozen grid contract), §7.10 (CORS, push), §11; D8, D9, D23.
// Security: AGENTS.md §4.1 (service-role writes happen only inside Edge Functions) and §4.3
// (`tactical_analysis` is logged server-side only — never persisted, never returned). The client
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
//
// The loop after ingestion (FR-11–FR-13, §7.1 "sync evaluation"): deterministic gates first —
// low energy, or a window answered late — and only a gated check-in reaches the LLM. A gated
// eval that answers `intervention=true` materializes a real turn: the user row
// (`metadata.source='checkin'`), the pipeline run **with the check-in's energy** (the FP-03
// parameter, dormant until now), the primary reply, and one high-priority push. An on-track
// check-in writes **no** `messages` row at all (FR-9), and a check-in turn never scores D8's
// `auto_adopt_successes` either way (FR-10) — this function never calls that recorder.

import { getConfigNumber, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { embed } from "../_shared/llm/adapter.ts";
import {
  parseEnergy,
  sourceForCapture,
  type CheckinCapture,
  type DoingsSource,
} from "../_shared/checkin/parseEnergy.ts";
import { loadGrid } from "../_shared/checkin/loadGrid.ts";
import { canonicalizeWindow } from "../_shared/checkin/windows.ts";
import { evaluateDoing } from "../_shared/checkin/eval.ts";
import { toEvalAnchors, type EvalAnchor } from "../_shared/checkin/evalContract.ts";
import { runPipeline, type RunPipelineResult } from "../_shared/pipeline/runPipeline.ts";
import { evalForceIntervention } from "../_shared/dev/overrides.ts";
import {
  findPrimaryReply,
  insertPrimaryReply,
  writeHoldingReplyAndEnqueueRetry,
} from "../_shared/replies.ts";
import { sendPush, createHighPriorityPushPayload } from "../_shared/push.ts";
import { isProvidersUnavailable } from "../_shared/llm/errors.ts";

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

/** Why a check-in took the eval path (FR-11). Both may hold; the log carries the list. */
type GateReason = "low_energy" | "late";

/** What the eval decided, or that it was never reached (FR-12, FR-18). */
type EvalOutcome = "skipped" | "on_track" | "deviation" | "intervention";

/** The intervention turn's ids — the response's `user_message_id` / `assistant_message_id`. */
interface InterventionTurn {
  userMessageId: string;
  /** Null only when a concurrent invocation answered the turn and its reply was not locatable. */
  assistantMessageId: string | null;
}

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

/** The profile-local calendar date as `YYYY-MM-DD` — the text a Postgres `date` compares to. */
function localDate(timezone: string, ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Today's `anchor_plans` row, mapped to the eval's input shape (§3.4, FR-12).
 *
 * `[]` is the normal answer until the journal FP: the table is written by the evening
 * `anchor_plan` job, which does not exist yet. It is still a real read rather than a hardcoded
 * empty array, so the eval call is exercised end-to-end today and the journal FP changes no
 * FP-04 code. `plan_date` is the date in the **profile's** zone — the same clock the window was
 * resolved against, so a window that belongs to "today" reads "today's" plan.
 *
 * Non-fatal: a lookup problem must never fail a check-in, so it degrades to no anchors, which is
 * exactly the pre-journal-FP state.
 */
async function loadTodayAnchors(
  userId: string,
  timezone: string,
  nowMs: number,
): Promise<EvalAnchor[]> {
  try {
    const { data, error } = await supabaseService
      .from("anchor_plans")
      .select("anchors")
      .eq("user_id", userId)
      .eq("plan_date", localDate(timezone, nowMs))
      .maybeSingle();
    if (error || !data) return [];
    return toEvalAnchors((data as { anchors?: unknown }).anchors);
  } catch (err) {
    console.error(
      "[submit-checkin] anchor read failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * The intervention turn already written for this doing, if any (FR-9, FR-8 replay).
 *
 * `messages.metadata.doing_id` is the only link the schema carries from a doing to the turn it
 * materialized, and it lives on the **user** row — the reply is found through the §3.2 anchor.
 * A null `assistant_message_id` on a row that exists means the process died between the two
 * writes; the response reports that rather than repairing it (see the duplicate branch).
 */
async function findInterventionTurn(
  userId: string,
  doingId: string,
): Promise<InterventionTurn | null> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "user")
    .eq("metadata->>doing_id", doingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const userMessageId = data.id as string;
  return { userMessageId, assistantMessageId: await findPrimaryReply(userMessageId) };
}

/** ~100 chars, matching `createAiMessagePushPayload`'s notification preview (§7.10). */
function pushPreview(content: string): string {
  return content.length > 100 ? content.slice(0, 97) + "..." : content;
}

/**
 * Materialize an intervention turn (FR-9, FR-13).
 *
 * Three writes and one push, in this order: the user row (the reply's anchor, and the record
 * FR-10 keys off), the pipeline run, the primary reply. The user row goes first because the
 * pipeline needs something to answer, and because `metadata.source='checkin'` is what keeps the
 * turn transparent to `send-message`'s §5.3 counter.
 *
 * `energy` is the FP-03 turn parameter going live: the real classifier's low-energy override
 * (§6.1–6.2) is what makes a drained check-in read as drained on the turn it produced.
 *
 * A transport failure inside the pipeline degrades through the **unchanged** §4.1 machinery —
 * the same `_shared/replies.ts` helper `send-message` uses, so an intervention turn is just a
 * turn. The retry job pushes the real answer; this function pushes only a real one.
 *
 * Only a DB failure propagates. That leaves a user row without a reply, which the duplicate
 * branch reports rather than repairs — the §7.10 precedent for the equivalent `send-message`
 * residual (the eval has already run once; re-running the pipeline on a replay could answer the
 * turn differently from the one the gates approved).
 */
async function writeInterventionTurn(args: {
  userId: string;
  doingId: string;
  content: string;
  energy: number | null;
  clientMessageId: string | null;
  deadlineAt: number;
}): Promise<InterventionTurn> {
  const { userId, doingId, content, energy, clientMessageId, deadlineAt } = args;

  const row: Record<string, unknown> = {
    user_id: userId,
    role: "user",
    content,
    metadata: { source: "checkin", doing_id: doingId },
  };
  if (clientMessageId) row.client_message_id = clientMessageId;

  let userMessageId: string;
  const { data: insertedUser, error: userError } = await supabaseService
    .from("messages")
    .insert(row)
    .select("id");

  if (userError) {
    // A replay that slipped past the window check: the chat path's bubble id is the unique key,
    // so re-select the row the first attempt wrote rather than failing the whole submit.
    if ((userError as { code?: string }).code !== "23505" || !clientMessageId) throw userError;
    const { data: existing, error: existingError } = await supabaseService
      .from("messages")
      .select("id")
      .eq("user_id", userId)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();
    if (existingError || !existing) throw existingError ?? userError;
    userMessageId = existing.id as string;
  } else {
    userMessageId = insertedUser![0].id as string;
  }

  let result: RunPipelineResult;
  try {
    result = await runPipeline({ text: content, userId, energy, deadlineAt });
  } catch (err) {
    if (!isProvidersUnavailable(err)) throw err;
    console.error(
      "[submit-checkin] providers unavailable — degrading the intervention turn:",
      err.message,
    );
    const holding = await writeHoldingReplyAndEnqueueRetry({
      userId,
      userMessageId,
      context: err.context,
    });
    return {
      userMessageId,
      assistantMessageId: holding.ok ? holding.assistantMessageId : holding.winnerId,
    };
  }

  // tactical_analysis: server log only — never persisted, never returned (§4.3).
  console.log(
    "[submit-checkin] tactical_analysis:",
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
  const assistantMessageId = "raceLost" in reply ? await findPrimaryReply(userMessageId) : reply.id;

  // One high-priority push (FR-13) — `expo_push_enabled` gates the sender itself, and the
  // bounded await mirrors `send-message`: the turn is committed and must not wait on exp.host.
  if (assistantMessageId) {
    const payload = createHighPriorityPushPayload(
      userId,
      "Davos",
      pushPreview(result.assistantContent),
      "davos://chat",
    );
    try {
      await Promise.race([sendPush(payload), new Promise((r) => setTimeout(r, 5000))]);
    } catch (err) {
      console.error(
        "[submit-checkin] push send failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { userMessageId, assistantMessageId };
}

/**
 * POST — a check-in reply. Returns the frozen FR-5 response shape:
 * `{status, doing_id, energy, eval_ran, intervention}`, plus `user_message_id` /
 * `assistant_message_id` when an intervention turn is written (§7.1 — Step 3 *adds* keys, it
 * never renames one).
 *
 * `eval_ran`/`intervention` are structurally `false` for an on-track check-in: the doing is
 * stored, no `messages` row exists, and the next window is already scheduled (FR-9).
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
  const source: DoingsSource = sourceForCapture(capture as CheckinCapture);

  // FR-18's submit log: every return below records the same fields plus a latency measured from
  // here (after input validation, before the grid read), so the tuning feed is comparable across
  // the on-track, gated and duplicate outcomes.
  const startedAt = Date.now();
  const log = (fields: Record<string, unknown>) =>
    logEvent("submit", { userId, capture, latencyMs: Date.now() - startedAt, ...fields });

  // FR-9: the chat path carries the optimistic bubble's id. It is validated here so a
  // malformed body is rejected before any work, and kept **only** for the chat capture — the
  // notification-reply path has no bubble to reconcile, so a stray id there is ignored rather
  // than written onto a row nothing will look up.
  let clientMessageId: string | null = null;
  if (body.client_message_id !== undefined && body.client_message_id !== null) {
    if (typeof body.client_message_id !== "string" || !UUID_RE.test(body.client_message_id)) {
      return json({ error: "client_message_id must be a uuid" }, 400);
    }
    if (capture === "chat") clientMessageId = body.client_message_id;
  }

  // FR-5: `windowTs` is a *hint* on the grid — canonicalized below, never trusted as the
  // window. The canonical form is an ISO-8601 timestamp; a numeric epoch-ms hint is also
  // accepted, because the notification-reply client derives it from the notification and a
  // number/string skew between the twins must not surface as a silent 400 (the drill caught
  // exactly that). Anything else — absent, non-finite, unparseable — stays `window_malformed`.
  const rawWindowTs = body.windowTs;
  const hintMs =
    typeof rawWindowTs === "number" && Number.isFinite(rawWindowTs)
      ? rawWindowTs
      : typeof rawWindowTs === "string" && !Number.isNaN(Date.parse(rawWindowTs))
        ? Date.parse(rawWindowTs)
        : NaN;
  if (Number.isNaN(hintMs)) {
    return json({ error: "window_malformed" }, 400);
  }

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
    // A replay of an interventioned window returns the turn it already materialized (§7.1), so
    // the client can reconcile its bubble instead of waiting for a reply that will not come.
    const turn = await findInterventionTurn(userId, existing.id);
    log({
      window: windowIso,
      energy: existing.energy,
      gates: [],
      eval: turn ? "intervention" : "skipped",
      intervention: turn !== null,
      outcome: "duplicate",
      snappedMs,
      doingId: existing.id,
    });
    return json({
      status: "duplicate",
      doing_id: existing.id,
      energy: existing.energy,
      eval_ran: turn !== null,
      intervention: turn !== null,
      ...(turn ? { user_message_id: turn.userMessageId } : {}),
      ...(turn?.assistantMessageId ? { assistant_message_id: turn.assistantMessageId } : {}),
    });
  }

  // FR-11's gates and FR-13's budget, read before anything is written: nothing is stored yet,
  // so a missing key is a loud 500 whose replay is harmless — and never a check-in that
  // silently skips its own evaluation.
  let energyExhaustedMax: number;
  let lateMinutes: number;
  let pipelineDeadlineMs: number;
  try {
    [energyExhaustedMax, lateMinutes, pipelineDeadlineMs] = await Promise.all([
      getConfigNumber("energy_exhausted_max"),
      getConfigNumber("checkin_late_minutes"),
      getConfigNumber("pipeline_deadline_ms"),
    ]);
  } catch (err) {
    console.error("[submit-checkin] config error:", err instanceof Error ? err.message : err);
    log({ window: windowIso, outcome: "config_unavailable" });
    return json({ error: "Server misconfigured" }, 500);
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
        const turn = await findInterventionTurn(userId, winner.id);
        log({
          window: windowIso,
          energy: winner.energy,
          gates: [],
          eval: turn ? "intervention" : "skipped",
          intervention: turn !== null,
          outcome: "duplicate",
          race: true,
        });
        return json({
          status: "duplicate",
          doing_id: winner.id,
          energy: winner.energy,
          eval_ran: turn !== null,
          intervention: turn !== null,
          ...(turn ? { user_message_id: turn.userMessageId } : {}),
          ...(turn?.assistantMessageId ? { assistant_message_id: turn.assistantMessageId } : {}),
        });
      }
    }
    throw insertError;
  }

  const doingId = inserted![0].id as string;
  if (energy !== null) await setLatestEnergy(userId, energy);

  // --- FR-11: deterministic gates. Nothing deterministic to gate on → zero LLM calls. ---
  const gates: GateReason[] = [];
  if (energy !== null && energy <= energyExhaustedMax) gates.push("low_energy");
  if (nowMs > window.closeMs + lateMinutes * 60_000) gates.push("late");

  let evalOutcome: EvalOutcome = "skipped";
  let turn: InterventionTurn | null = null;

  if (gates.length > 0) {
    const anchors = await loadTodayAnchors(userId, grid.timezone, nowMs);
    const outcome = await evaluateDoing(
      { text: content, energy, anchors },
      { forceIntervention: evalForceIntervention(body) },
    );

    if (outcome.intervention) {
      evalOutcome = "intervention";
      turn = await writeInterventionTurn({
        userId,
        doingId,
        content,
        energy,
        clientMessageId,
        deadlineAt: Date.now() + pipelineDeadlineMs,
      });
    } else if (outcome.deviation) {
      // FR-13: a deviation worth noting but not speaking up about. Log line only — nothing is
      // persisted, and no push is sent.
      evalOutcome = "deviation";
      console.log("[submit-checkin] deviation", JSON.stringify({ userId, doingId, energy }));
    } else {
      evalOutcome = "on_track";
    }
  }

  log({
    window: windowIso,
    energy,
    gates,
    eval: evalOutcome,
    intervention: turn !== null,
    outcome: "ok",
    snappedMs,
    doingId,
    ...(turn ? { userMessageId: turn.userMessageId } : {}),
    ...(turn?.assistantMessageId ? { assistantMessageId: turn.assistantMessageId } : {}),
  });

  return json({
    status: "ok",
    doing_id: doingId,
    energy,
    eval_ran: evalOutcome !== "skipped",
    intervention: turn !== null,
    ...(turn ? { user_message_id: turn.userMessageId } : {}),
    ...(turn?.assistantMessageId ? { assistant_message_id: turn.assistantMessageId } : {}),
  });
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
