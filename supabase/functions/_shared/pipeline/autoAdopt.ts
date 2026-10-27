// supabase/functions/_shared/pipeline/autoAdopt.ts
// FP-04 Step 3b — the §5.3 `auto_adopt_successes` qualifying-row rule (extracted from
// `send-message` so both FR-10 directions are unit-testable).
//
// Refs: TECH-SPEC §5.3 (the four clauses), §7.1; FP-04 FR-10, AC-7; D8.
//
// Pure and I/O-free — no clock, no config, no client (the `bands.ts` / `windows.ts` split, same
// reason). The caller fetches a bounded slice of the user's recent `messages`, newest first, and
// passes the server clock and the window it read from `config.auto_adopt_window_minutes`; this
// module decides. That split is what turns AC-7 from a live assertion into a unit test.

import { ONBOARDING_SOURCE } from "../onboarding/state.ts";

export { ONBOARDING_SOURCE };

/** One `messages` row, as the §5.3 scan reads it. */
export interface AutoAdoptRow {
  id: string;
  role: string;
  reply_to_message_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** `metadata.source` on the **user** row of a materialized check-in turn (§7.1, FR-9). */
export const CHECKIN_SOURCE = "checkin";

/**
 * Sources whose turns neither count as a success nor break the preceding-row chain:
 * a materialized check-in (FP-04) and the onboarding interview (FP-09, D17).
 */
const TRANSPARENT_SOURCES = new Set<string>([CHECKIN_SOURCE, ONBOARDING_SOURCE]);

/** Why the walk stopped. `qualifies` is the only value that records a success. */
export type AutoAdoptReason =
  | "qualifies"
  | "no_rows"
  | "preceded_by_user"
  | "not_primary"
  | "anchor_unresolved"
  | "not_auto"
  | "no_domain"
  | "stale";

export interface AutoAdoptDecision {
  qualifies: boolean;
  reason: AutoAdoptReason;
  /** The qualifying reply's `metadata.domain`, when `qualifies` — null otherwise. */
  domain: string | null;
  /** `now − reply.created_at`, when `qualifies` — null otherwise. */
  replyAgoMs: number | null;
}

function sourceOf(row: AutoAdoptRow | undefined): string | null {
  const source = row?.metadata?.source;
  return typeof source === "string" ? source : null;
}

/**
 * Is this row part of a transparent turn? (§7.1, FR-10; FP-09 Step 3, D17)
 *
 * Check-in: the **user** row carries `metadata.source='checkin'`, while the **intervention
 * reply** is an ordinary `source:'pipeline'` primary reply written through the shared helper,
 * so it is identified by the user row it anchors on. `reply_to_message_id` is that anchor
 * (§3.2). Onboarding: both the user row and its primary reply carry
 * `metadata.source='onboarding'`, so the direct source check covers both.
 *
 * `unknown` means the anchored row is not in the fetched slice. It can only be reached when the
 * reply is the slice's **oldest** row *and* every row above it was a transparent turn, because
 * the walk only ever descends through such rows — and those turns write their two rows back to
 * back, so a reply the walk can reach has its anchor above it in the same slice. It answers
 * conservatively (§5.3's own bias: a lost count, never a wrong one), since counting the
 * intervention/onboarding reply would credit a persona the user never chose.
 */
function isTransparentTurn(
  row: AutoAdoptRow,
  byId: ReadonlyMap<string, AutoAdoptRow>,
): "yes" | "no" | "unknown" {
  const source = sourceOf(row);
  if (source !== null && TRANSPARENT_SOURCES.has(source)) return "yes";
  if (row.role !== "assistant" || !row.reply_to_message_id) return "no";
  if (!byId.has(row.reply_to_message_id)) return "unknown";
  const anchor = sourceOf(byId.get(row.reply_to_message_id));
  return anchor !== null && TRANSPARENT_SOURCES.has(anchor) ? "yes" : "no";
}

function stop(reason: AutoAdoptReason): AutoAdoptDecision {
  return { qualifies: false, reason, domain: null, replyAgoMs: null };
}

/**
 * Does the newest *non-transparent* row before a new user message qualify? (§5.3 + FR-10)
 *
 * `rows` must be the user's messages **newer-to-older**, truncated to a bounded slice. The walk
 * reproduces §5.3's "immediately preceding row" rule with one exception: a materialized
 * check-in turn (FR-10) and an onboarding interview turn (FP-09 Step 3, D17) are
 * **transparent** — neither is persona engagement. Their user rows and replies are skipped
 * rather than breaking the chain, so a check-in or an old interview turn that lands between
 * an auto-adopted reply and the user's next chat message keeps that success countable (AC-7).
 * Every other row stops the walk and the first one to do so supplies the `reason`, because
 * that is then the row the user was answering.
 *
 * Clauses, in the order §5.3 states them: primary only (`reply_to_message_id` set), route
 * `'auto'`, a non-empty `metadata.domain`, and inside `windowMinutes` measured on the server
 * clock. `nowMs` is passed in, never read here, so the rule stays a pure function of its input.
 */
export function decideAutoAdopt(args: {
  rows: readonly AutoAdoptRow[];
  nowMs: number;
  windowMinutes: number;
}): AutoAdoptDecision {
  const { rows, nowMs, windowMinutes } = args;
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const row of rows) {
    const transparent = isTransparentTurn(row, byId);
    if (transparent === "yes") continue;
    if (transparent === "unknown") return stop("anchor_unresolved");

    if (row.role !== "assistant") return stop("preceded_by_user");

    // §5.3 clause 1 — primary only. A secondary row (a chip tap) and an unprompted watchdog row
    // both carry no `reply_to_message_id`, so neither can read as this arrival's answer.
    if (!row.reply_to_message_id) return stop("not_primary");

    // §5.3 clause 2 — an auto-adopted persona is the only thing D8 measures.
    if (row.metadata?.route !== "auto") return stop("not_auto");

    const domain = row.metadata?.domain;
    if (typeof domain !== "string" || domain.length === 0) return stop("no_domain");

    // §5.3 clause 4 — the server clock, never the untrusted `client_sent_at`. An unparseable
    // timestamp is a lost count, not a wrong one.
    const replyAt = Date.parse(row.created_at);
    const replyAgoMs = Number.isFinite(replyAt) ? nowMs - replyAt : NaN;
    if (!Number.isFinite(replyAgoMs) || replyAgoMs > windowMinutes * 60_000) {
      return stop("stale");
    }

    return { qualifies: true, reason: "qualifies", domain, replyAgoMs };
  }

  return stop("no_rows");
}
