// lib/chat.ts
// Pure chat-thread logic for (app)/chat — ordering, the primary/secondary reply dedupe
// rule, Medium-tier persona chips and their consumption state, optimistic pending
// bubbles, retry gating and error classification.
//
// No React or React Native imports, so it is unit-testable in isolation.
//
// Vocabulary (TECH-SPECS §3.2):
//   primary reply   — the pipeline's single assistant answer to a user message.
//                     Carries `reply_to_message_id`; at most one per user message.
//   secondary reply — a later re-run for the same user message (select-persona, D13
//                     Medium tier). Leaves `reply_to_message_id` NULL, anchors on
//                     `secondary_reply_to_message_id`, and MUST always render.
//
// Refs: FP-02 FR-5, FR-11, FR-16, FR-17; TECH-SPECS §3.2, §4.2, §5.1, §5.3, §7.10, §9;
// D13, D23.

import type { QueueReason } from "./sendQueue";

export interface Message {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  unsavable: boolean;
  /** Client-generated dedupe key; NULL on assistant rows. */
  client_message_id: string | null;
  /** Set on a primary reply only; NULL on user rows and secondary replies. */
  reply_to_message_id: string | null;
  /** Set on a secondary reply only: the persona the user chose from the chips. */
  persona_key?: string | null;
  /**
   * Set on a secondary reply only: the user message it re-answers. Optional so rows
   * written before migration 0019 (and hand-built fixtures) stay valid.
   */
  secondary_reply_to_message_id?: string | null;
  /** Send-tap time; the ordering truth for user rows. */
  client_sent_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** A Medium-tier quick-select chip (§4.2, §5.3). */
export interface PersonaOption {
  key: string;
  label: string;
  one_liner: string;
}

export type ChatErrorKind = "auth" | "client" | "server" | "network";

export interface ChatError {
  kind: ChatErrorKind;
  message: string;
}

/**
 * `sending`        — the POST is in flight.
 * `awaiting-reply` — the POST returned ok; waiting for the assistant row.
 * `queued`         — not sent: offline, or a failed attempt with an unknown outcome. Held
 *                    in the device queue (`lib/sendQueue.ts`) and replayed automatically
 *                    once connectivity returns (FR-16, AC-8). Unlike `failed`, the server
 *                    has not acknowledged the turn, so a resend is always the right move —
 *                    the `client_message_id` makes it idempotent.
 * `failed`         — the turn has no reply and can be retried.
 * `logged`         — on-track check-in: resolved locally, no server row expected (FR-9).
 */
export type PendingState = "sending" | "awaiting-reply" | "queued" | "failed" | "logged";

export interface PendingSend {
  clientMessageId: string;
  content: string;
  clientSentAt: string;
  state: PendingState;
  /** Epoch ms from which a retry is allowed (0 = immediately). */
  retryAt: number;
  /** Set only while `state === "queued"`: why the message is waiting. */
  reason?: QueueReason;
  error?: ChatError;
}

export interface ChatItem {
  /** Stable list key: `client_message_id ?? id`, so an optimistic bubble keeps its
   *  identity when the server row replaces it. For assistant rows this is the row id,
   *  i.e. the `message_id` a chip tap posts to `select-persona`. */
  key: string;
  role: "user" | "assistant";
  content: string;
  /** ISO timestamp to display. */
  createdAt: string;
  /** Epoch ms used for ordering. */
  sortKey: number;
  state: PendingState | "sent";
  /** True only while the item can be resent now: `failed` or `queued`, holdoff elapsed. */
  canRetry: boolean;
  retryAt: number;
  /** Set only while `state === "queued"`: why the message is waiting. */
  reason?: QueueReason;
  error?: ChatError;
  clientMessageId?: string;
  clientSentAt?: string;
  /** The committed server row's id — what `flag-unsavable` takes (FP-06 FR-14). */
  messageId?: string;
  /** The row's own `unsavable` column; the only source of the persistent marker. */
  unsavable?: boolean;
  /** Medium-tier chips offered by this assistant row, when it carries any. */
  personaOptions?: PersonaOption[];
  /** The persona this option set resolved to, once a chip has been consumed. */
  chosenPersonaKey?: string;
}

const UNANSWERED: ChatError = {
  kind: "network",
  message: "No reply arrived for this message.",
};

function timeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Ordering truth: `client_sent_at` when present, else `created_at`. */
export function messageTime(message: Message): number {
  return timeMs(message.client_sent_at) || timeMs(message.created_at);
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sortMessagesAsc(rows: Message[]): Message[] {
  return [...rows].sort(
    (a, b) => messageTime(a) - messageTime(b) || compareKeys(a.id, b.id),
  );
}

export function sortItemsAsc(items: ChatItem[]): ChatItem[] {
  return [...items].sort(
    (a, b) => a.sortKey - b.sortKey || compareKeys(a.key, b.key),
  );
}

/**
 * Drop an assistant row whose `id` was already seen, or that is a second *primary* reply
 * for a user message that already has one. Secondary replies (`reply_to_message_id`
 * NULL, e.g. select-persona) always survive.
 *
 * Applied to the ascending-ordered thread, so "first primary reply wins" matches the
 * `messages_one_primary_reply` index on the server.
 */
export function dedupeAssistantRows(rows: Message[]): Message[] {
  const seenIds = new Set<string>();
  const seenPrimaryFor = new Set<string>();
  const out: Message[] = [];

  for (const row of rows) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);

    if (row.role === "assistant" && row.reply_to_message_id) {
      if (seenPrimaryFor.has(row.reply_to_message_id)) continue;
      seenPrimaryFor.add(row.reply_to_message_id);
    }

    out.push(row);
  }

  return out;
}

/** The visible thread: ascending order, assistant rows deduped. */
export function visibleRows(rows: Message[]): Message[] {
  return dedupeAssistantRows(sortMessagesAsc(rows));
}

/** Id of the primary reply to a user message, or null when the turn is unanswered. */
export function findPrimaryReplyId(rows: Message[], userMessageId: string): string | null {
  for (const row of rows) {
    if (row.role === "assistant" && row.reply_to_message_id === userMessageId) {
      return row.id;
    }
  }
  return null;
}

/**
 * The Medium-tier chips an assistant row offers — `metadata.persona_options` (§4.2) —
 * shape-checked, or null when it offers none. A row that offers chips is the option
 * message a chip tap is posted against.
 */
export function personaOptionsOf(row: Message): PersonaOption[] | null {
  if (row.role !== "assistant") return null;
  const raw = row.metadata?.persona_options;
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

/**
 * Which persona each option set resolved to — **user-message id** → chosen
 * `persona_key`, read from the secondary replies that anchor on it. A user message
 * containing an entry has had its option set spent: the server allows only one
 * secondary reply per user message (`messages_one_secondary_reply`), so the whole set is
 * disabled, not just the tapped chip (AC-3).
 *
 * Keyed by the user message id because that is what a secondary reply anchors on; the
 * chips themselves are rendered from the option message, which answers the same user
 * message (`reply_to_message_id`).
 */
export function personaChoices(rows: Message[]): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const anchor = row.secondary_reply_to_message_id;
    if (!anchor) continue;
    const key = row.persona_key;
    if (typeof key !== "string" || key.length === 0) continue;
    if (!chosen.has(anchor)) chosen.set(anchor, key);
  }
  return chosen;
}

/**
 * Composer user rows that were committed but never answered — the state a died
 * invocation leaves. Excludes turns this client still has in flight.
 *
 * Only rows carrying a `client_message_id` qualify: they came from the composer
 * (Step 5a repair), not from a seeded/older turn.
 */
export function unansweredUserRows(
  rows: Message[],
  inFlightClientIds: Set<string>,
): Message[] {
  const answered = new Set<string>();
  for (const row of rows) {
    if (row.role === "assistant" && row.reply_to_message_id) {
      answered.add(row.reply_to_message_id);
    }
  }

  return rows.filter((row) => {
    if (row.role !== "user") return false;
    if (!row.client_message_id) return false;
    if (answered.has(row.id)) return false;
    if (inFlightClientIds.has(row.client_message_id)) return false;
    return true;
  });
}

/** Merge a batch of rows (Realtime insert, watchdog re-select or a full refetch). */
export function mergeRows(prev: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const row of prev) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return visibleRows([...byId.values()]);
}

/** Drop pending entries whose turn now has a rendered primary reply, or are 'logged' terminal. */
export function pruneResolvedPending(pending: PendingSend[], rows: Message[]): PendingSend[] {
  return pending.filter((entry) => {
    // 'logged' is a client-terminal state for on-track check-ins (FR-9) — no server row ever arrives.
    if (entry.state === "logged") return false;
    const userRow = rows.find(
      (row) => row.role === "user" && row.client_message_id === entry.clientMessageId,
    );
    if (!userRow) return true; // not committed yet — keep the optimistic bubble
    return findPrimaryReplyId(rows, userRow.id) === null;
  });
}

export interface BuildChatItemsArgs {
  rows: Message[];
  pending: PendingSend[];
  /** `config.chat_retry_holdoff_ms` — gates retries whose outcome is unknown. */
  retryHoldoffMs: number;
  /** Epoch ms "now", injected so the result is pure. */
  now: number;
}

/**
 * Build the render list: visible server rows (orphaned composer turns shown as failed)
 * plus optimistic bubbles that have no server row yet.
 */
export function buildChatItems(args: BuildChatItemsArgs): ChatItem[] {
  const rows = visibleRows(args.rows);
  const inFlight = new Set(
    args.pending
      .filter((entry) => entry.state !== "failed") // 'logged' included for orphan suppression
      .map((entry) => entry.clientMessageId),
  );
  const orphans = new Set(unansweredUserRows(rows, inFlight).map((row) => row.id));
  const committed = new Set<string>();
  for (const row of rows) {
    if (row.client_message_id) committed.add(row.client_message_id);
  }
  const chosen = personaChoices(rows);

  const items: ChatItem[] = [];

  for (const row of rows) {
    const sortKey = messageTime(row);
    const base: ChatItem = {
      key: row.client_message_id ?? row.id,
      role: row.role,
      content: row.content,
      createdAt: row.client_sent_at ?? row.created_at,
      sortKey,
      state: "sent",
      canRetry: false,
      retryAt: 0,
      messageId: row.id,
      unsavable: row.unsavable === true,
    };

    const personaOptions = personaOptionsOf(row);
    if (personaOptions) {
      base.personaOptions = personaOptions;
      // The chips answer `reply_to_message_id`'s user message; a secondary reply for
      // that same user message means the set has been spent.
      const picked = row.reply_to_message_id
        ? chosen.get(row.reply_to_message_id)
        : undefined;
      if (picked) base.chosenPersonaKey = picked;
    }

    if (orphans.has(row.id)) {
      const retryAt = sortKey + args.retryHoldoffMs;
      items.push({
        ...base,
        state: "failed",
        retryAt,
        canRetry: args.now >= retryAt,
        error: UNANSWERED,
        clientMessageId: row.client_message_id ?? undefined,
        clientSentAt: row.client_sent_at ?? undefined,
      });
      continue;
    }

    items.push(base);
  }

  for (const entry of args.pending) {
    if (committed.has(entry.clientMessageId)) continue; // the server row renders instead
    items.push({
      key: entry.clientMessageId,
      role: "user",
      content: entry.content,
      createdAt: entry.clientSentAt,
      sortKey: timeMs(entry.clientSentAt),
      state: entry.state,
      // A queued item is safely resendable (idempotent by `client_message_id`), so it is
      // retryable on the same terms as a failure: immediately, unless it is waiting out
      // the unknown-outcome holdoff.
      canRetry:
        (entry.state === "failed" || entry.state === "queued") && args.now >= entry.retryAt,
      retryAt: entry.retryAt,
      reason: entry.state === "queued" ? entry.reason : undefined,
      error: entry.error,
      clientMessageId: entry.clientMessageId,
      clientSentAt: entry.clientSentAt,
    });
  }

  return sortItemsAsc(items);
}

/**
 * Earliest epoch ms at which a currently-blocked item becomes available — a `failed` bubble
 * waiting out its holdoff, or a `queued` message waiting out the unknown-outcome holdoff.
 * The chat screen wakes on this to re-enable Retry and to run the queue's replay walk.
 */
export function nextRetryAt(items: ChatItem[], now: number): number | null {
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.state !== "failed" && item.state !== "queued") continue;
    if (item.retryAt > now && item.retryAt < earliest) earliest = item.retryAt;
  }
  return Number.isFinite(earliest) ? earliest : null;
}

/** HTTP status carried by a `FunctionsHttpError`/`FunctionsRelayError`, if any. */
export function errorStatus(error: unknown): number | undefined {
  const context = (error as { context?: { status?: unknown } } | null | undefined)?.context;
  const status = context?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Bucket a failed send:
 *   401        → `auth`    (session gone: banner, no per-bubble retry)
 *   400–499    → `client`  (the request was rejected: a verbatim resend will not help,
 *                           so the bubble offers Retry only after a short holdoff)
 *   500+       → `server`  (retry immediately — the server failed fast)
 *   no status  → `network` (fetch error, abort or the `chat_send_timeout_ms` timeout:
 *                           the outcome is unknown, so retry is holdoff-gated)
 */
export function classifyError(error: unknown): ChatError {
  const status = errorStatus(error);
  if (status === 401) {
    return { kind: "auth", message: "Your session has expired. Sign in again." };
  }
  if (status !== undefined) {
    if (status >= 500) {
      return { kind: "server", message: "Davos is unavailable right now." };
    }
    if (status >= 400) {
      return { kind: "client", message: "That message could not be sent." };
    }
  }
  return { kind: "network", message: "Connection problem — your message was not sent." };
}

/**
 * Short holdoff for a rejected (4xx) request. A verbatim resend cannot succeed, so the
 * gap exists only to stop the Retry button being tapped in a rapid loop.
 */
const CLIENT_ERROR_HOLDOFF_MS = 3000;

/** How long a failure must be held before its Retry unlocks. */
export function retryDelayFor(kind: ChatErrorKind, holdoffMs: number): number {
  if (kind === "network") return holdoffMs;
  if (kind === "client") return CLIENT_ERROR_HOLDOFF_MS;
  // 5xx failed fast and 401 is handled by the banner: both are safe to retry at once.
  return 0;
}
