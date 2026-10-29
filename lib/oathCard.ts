// lib/oathCard.ts
// Pure helper for the Oath Confirm Affordance (D26, FP-08 FR-10, TECH-SPEC §5.4).
//
// Detects assistant rows carrying `metadata.source === 'oath_request'` and tracks
// whether the demand is active ('demanded') or has already been sealed ('sealed').
// Pure logic — no React or network imports so it is unit-testable in isolation.

export type OathCardState = "demanded" | "sealed";

export interface OathCard {
  state: OathCardState;
  consumedAt?: string;
  consumedMessageId?: string;
}

function asMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Check if row metadata indicates an oath request from Davos. */
export function isOathRequest(metadata: unknown): boolean {
  const meta = asMetadata(metadata);
  if (!meta) return false;
  return meta.source === "oath_request" || meta.oath_request === true;
}

/** Check if row metadata indicates an already-consumed oath request. */
export function isOathConsumed(metadata: unknown): boolean {
  const meta = asMetadata(metadata);
  if (!meta) return false;
  return meta.consumed === true;
}

/** Parse an oath card from row metadata. Returns null if row is not an oath request. */
export function parseOathCard(metadata: unknown): OathCard | null {
  const meta = asMetadata(metadata);
  if (!meta || !isOathRequest(meta)) return null;

  const consumed = isOathConsumed(meta);
  const consumedAt = typeof meta.consumed_at === "string" ? meta.consumed_at : undefined;
  const consumedMessageId =
    typeof meta.consumed_message_id === "string" ? meta.consumed_message_id : undefined;

  return {
    state: consumed ? "sealed" : "demanded",
    consumedAt,
    consumedMessageId,
  };
}

/** Build a map of message ID -> OathCard for assistant rows. */
export function oathCardsForRows(
  rows: Array<{ id: string; role: string; metadata?: Record<string, unknown> }>,
): Map<string, OathCard> {
  const cards = new Map<string, OathCard>();
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const card = parseOathCard(row.metadata);
    if (card) cards.set(row.id, card);
  }
  return cards;
}

/**
 * Return the active unconsumed oath_request ID if the latest message in the thread
 * is an assistant oath request (the D26 thread-position rule).
 */
export function getActiveOathRequestId(
  rows: Array<{ id: string; role: string; metadata?: Record<string, unknown> }>,
): string | null {
  if (!rows || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (last.role !== "assistant") return null;
  const card = parseOathCard(last.metadata);
  if (!card || card.state === "sealed") return null;
  return last.id;
}
