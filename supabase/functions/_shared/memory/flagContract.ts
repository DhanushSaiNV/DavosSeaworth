// supabase/functions/_shared/memory/flagContract.ts
// FP-06 Step 2 — the pure half of the late-flag loop: request validation, the flag
// decision table, and the purge statement's guard predicate (TECH-SPEC §7.6, §5.4).
// Refs: FP-06 FR-1, FR-2, FR-17; TECH-SPEC §7.6, §5.4, §7.10; D3, D6.
//
// Pure (jest-loadable): no Deno.env, no service client, no clock. The IO half is the
// `flag-unsavable` function; the dispatcher owns the SQL itself.

/** Request-input validation only (never LLM output — AGENTS.md §5.1). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FlagParseResult =
  | { ok: true; messageId: string }
  | { ok: false; status: number; error: string };

/**
 * Validate the POST body. A malformed body is a 400 and never a read/write (FR-1).
 * The id is the only field there is — ids only, the §5.3 rule for request bodies.
 */
export function parseFlagBody(body: unknown): FlagParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
  const messageId = (body as Record<string, unknown>).message_id;
  if (typeof messageId !== "string" || !UUID_RE.test(messageId)) {
    return { ok: false, status: 400, error: "message_id must be a uuid" };
  }
  return { ok: true, messageId };
}

/**
 * The decision table, computed from the loaded row **for the caller's own user_id**.
 *
 *   `not_found`       — unknown id, or a foreign user's row: the own-rows read makes both
 *                       indistinguishable, which is exactly why it is the boundary (404).
 *   `assistant`       — flagging Davos's own words is meaningless: the flag's job is to
 *                       stop extraction *from the user*, and an assistant row is never a
 *                       memory source (400, recorded reading — FR-1).
 *   `already_flagged` — the flip already happened: return `ok`, enqueue nothing (FR-1).
 *   `flip`            — the one transition that writes + enqueues exactly one purge job.
 */
export type FlagDecision = "not_found" | "assistant" | "already_flagged" | "flip";

export function decideFlag(row: { role?: unknown; unsavable?: unknown } | null): FlagDecision {
  if (!row) return "not_found";
  if (row.role === "assistant") return "assistant";
  if (row.unsavable === true) return "already_flagged";
  return "flip";
}

/**
 * The purge statement's guard predicate, as data — the exact filter the dispatcher's
 * UPDATE applies (`fact_type <> 'oath' and purged_at is null`). The oath exemption is
 * §5.4 (oath facts are non-purgeable by design); it is written now for a writer that
 * lands with item 9, so the exemption can never be retrofitted wrongly.
 */
export function isPurgeable(fact: { fact_type?: unknown; purged_at?: unknown }): boolean {
  if (fact.purged_at !== null && fact.purged_at !== undefined) return false;
  if (fact.fact_type === "oath") return false;
  return true;
}
