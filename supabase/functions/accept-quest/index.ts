// supabase/functions/accept-quest/index.ts
// FP-08 Step 6 — the quest accept/decline entry point (FR-15, FR-17).
//
// `POST {message_id, accepted}`. The decision core is the migration's `accept_quest()` RPC:
// one transaction under a per-user advisory lock — consume check, one-active-quest guard,
// validated metric insert, `quest_expire` job insert. This function only (a) authorizes the
// row, (b) re-runs the formula gate on the **stored** offer before the transaction opens so a
// rejected formula consumes nothing (FR-15's gate-before-persist), (c) computes the local
// deadline + expiry instant, and (d) maps the RPC's status to the card's response.
//
// Decline never enters the RPC: a compare-and-set metadata flip marks `quest_consumed` +
// `quest_declined` and writes no metric. A double tap (or an accept after a decline) is the
// idempotent `duplicate`, never a second row (AC-7).
//
// Zero providers: the gate is pure, the RPC is Postgres. No adapter import on this path.
//
// Refs: FP-08 FR-15, FR-17; TECH-SPEC §7.3, §7.9, §2.1; D10, D15.

import { getConfig, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { parseFormulaBounds } from "../_shared/metrics/create.ts";
import { validateFormula } from "../_shared/metrics/formula.ts";
import {
  addDays,
  clampDeadlineDays,
  localDateKey,
  type DeadlineBounds,
} from "../_shared/accountability/quests.ts";
import { localWallToUtcMs } from "../_shared/checkin/windows.ts";

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

interface QuestOffer {
  name: string;
  domain: string;
  output_unit: string;
  formula: Record<string, unknown>;
  deadline_days: number;
}

/** Strict parse of the stored card data; a malformed offer is invalid, never guessed. */
function parseOffer(raw: unknown): QuestOffer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const domain = typeof o.domain === "string" ? o.domain.trim() : "";
  const outputUnit = typeof o.output_unit === "string" ? o.output_unit.trim() : "";
  const deadlineDays = Number(o.deadline_days);
  if (!name || !domain || !outputUnit) return null;
  if (!Number.isFinite(deadlineDays) || deadlineDays < 1) return null;
  if (typeof o.formula !== "object" || o.formula === null || Array.isArray(o.formula)) return null;
  return {
    name,
    domain,
    output_unit: outputUnit,
    formula: o.formula as Record<string, unknown>,
    deadline_days: deadlineDays,
  };
}

function parseBody(raw: unknown): { messageId: string; accepted: boolean } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const messageId = typeof o.message_id === "string" ? o.message_id.trim() : "";
  if (!messageId) return null;
  if (typeof o.accepted !== "boolean") return null;
  return { messageId, accepted: o.accepted };
}

function parseBounds(raw: unknown): DeadlineBounds {
  const o = (typeof raw === "object" && raw !== null && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  const min = Number(o.min_days);
  const max = Number(o.max_days);
  return {
    min_days: Number.isFinite(min) ? min : 3,
    max_days: Number.isFinite(max) ? max : 21,
  };
}

/** deadline + 1 day at 01:15 user-local (after the final nightly metric_eval). */
function expiryInstant(deadline: string, timezone: string): string {
  const [y, mo, d] = deadline.split("-").map(Number);
  const base = localWallToUtcMs(timezone, y, mo, d, 1, 15);
  if (base !== null) return new Date(base + 86_400_000).toISOString();
  const fallback = Date.parse(`${deadline}T01:15:00Z`);
  return new Date((Number.isFinite(fallback) ? fallback : Date.now()) + 86_400_000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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
  const parsed = parseBody(body);
  if (!parsed) {
    return json({ status: "invalid", error: "message_id and a boolean accepted are required" }, 400);
  }

  try {
    const { data: row, error: readError } = await supabaseService
      .from("messages")
      .select("id, role, metadata")
      .eq("id", parsed.messageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw readError;
    if (!row || row.role !== "assistant") {
      return json({ status: "not_found" }, 404);
    }

    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const offer = parseOffer(metadata.quest_offer);
    if (!offer) {
      return json({ status: "invalid" }, 400);
    }
    if (metadata.quest_consumed !== undefined && metadata.quest_consumed !== null) {
      return json({
        status: "duplicate",
        metric_id: typeof metadata.quest_metric_id === "string" ? metadata.quest_metric_id : null,
      });
    }

    if (!parsed.accepted) {
      // Compare-and-set: only the first decline flips the row. A racing accept wins instead.
      const { data: flipped, error: declineError } = await supabaseService
        .from("messages")
        .update({
          metadata: {
            ...metadata,
            quest_consumed: true,
            quest_declined: true,
          },
        })
        .eq("id", parsed.messageId)
        .eq("user_id", userId)
        .is("metadata->>quest_consumed", null)
        .select("id");
      if (declineError) throw declineError;
      if (!flipped || flipped.length === 0) {
        return json({ status: "duplicate" });
      }
      console.log(
        "[accept-quest]",
        JSON.stringify({ message_id: parsed.messageId, outcome: "declined" }),
      );
      return json({ status: "declined" });
    }

    // FR-15: the gate re-runs on the stored formula before the transaction opens. A
    // failure consumes nothing — no metric, no job, no metadata flip.
    const bounds = parseFormulaBounds(await getConfig("metric_formula_bounds"));
    if (!bounds) {
      return json({ status: "error", error: "metric_formula_bounds is missing" }, 500);
    }
    const validation = validateFormula(offer.formula, bounds);
    if (!validation.ok) {
      console.warn(
        "[accept-quest] stored formula failed the gate:",
        JSON.stringify(validation.errors),
      );
      return json({ status: "invalid_formula", errors: validation.errors }, 422);
    }

    const { data: profile, error: profileError } = await supabaseService
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const timezone = typeof profile?.timezone === "string" && profile.timezone.length > 0
      ? profile.timezone
      : "UTC";

    const boundsDays = parseBounds(await getConfig("quest_deadline_bounds"));
    const days = clampDeadlineDays(offer.deadline_days, boundsDays);
    const acceptDate = localDateKey(timezone, Date.now());
    // FR-15's letter: deadline = accept date + the generated (clamped) days.
    const deadline = addDays(acceptDate, days);
    const expireAt = expiryInstant(deadline, timezone);

    const { data: rpc, error: rpcError } = await supabaseService.rpc("accept_quest", {
      p_user_id: userId,
      p_message_id: parsed.messageId,
      p_name: offer.name,
      p_domain: offer.domain,
      p_output_unit: offer.output_unit,
      p_formula: offer.formula,
      p_quest_deadline: deadline,
      p_expire_at: expireAt,
    });
    if (rpcError) throw rpcError;

    const result = (rpc ?? {}) as Record<string, unknown>;
    const status = typeof result.status === "string" ? result.status : "error";
    if (status === "ok") {
      console.log(
        "[accept-quest]",
        JSON.stringify({
          message_id: parsed.messageId,
          outcome: "accepted",
          metric_id: result.metric_id,
          deadline,
        }),
      );
      return json({
        status: "ok",
        metric_id: result.metric_id,
        quest_deadline: deadline,
        deadline_days: days,
      });
    }
    if (status === "duplicate") {
      return json({ status: "duplicate" });
    }
    if (status === "conflict") {
      return json({ status: "conflict" }, 409);
    }
    if (status === "not_found") {
      return json({ status: "not_found" }, 404);
    }
    return json({ status: "invalid" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[accept-quest] failed:", message);
    return json({ status: "error", error: "Failed to accept the quest" }, 500);
  }
});
