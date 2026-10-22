// lib/questCard.ts
// FP-08 Step 6 — the pure quest card state (FR-17).
//
// The card renders on an assistant row carrying `metadata.quest_offer`; its state comes from
// the row's own metadata (accepted/declined survive a refetch) plus the in-flight tap. This
// module has no React and no network: the chat screen owns the fetch and passes the result
// through `acceptOutcome`.
//
// Refs: FP-08 FR-15, FR-17; TECH-SPEC §7.9, §9; D15.

export interface QuestOffer {
  name: string;
  domain: string;
  output_unit: string;
  deadline_days: number;
  rationale?: string;
}

export type QuestCardState = "offer" | "accepting" | "accepted" | "declined" | "conflict" | "error";

export interface QuestCardAction {
  pending?: boolean;
  result?: QuestCardState;
  metricId?: string;
  error?: string;
}

export interface QuestCard {
  offer: QuestOffer;
  state: QuestCardState;
  metricId?: string;
  error?: string;
}

function asMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Strict parse: a malformed offer renders no card rather than a broken one. */
export function parseQuestOffer(raw: unknown): QuestOffer | null {
  const o = asMetadata(raw);
  if (!o) return null;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const domain = typeof o.domain === "string" ? o.domain.trim() : "";
  const unit = typeof o.output_unit === "string" ? o.output_unit.trim() : "";
  const days = Number(o.deadline_days);
  if (!name || !domain || !unit) return null;
  if (!Number.isFinite(days) || days < 1) return null;
  return {
    name,
    domain,
    output_unit: unit,
    deadline_days: Math.round(days),
    rationale: typeof o.rationale === "string" && o.rationale.length > 0 ? o.rationale : undefined,
  };
}

/** The card's persisted state from the row metadata alone. */
export function persistedState(metadata: Record<string, unknown> | null | undefined): QuestCardState {
  const meta = asMetadata(metadata);
  if (!meta) return "offer";
  if (meta.quest_declined === true) return "declined";
  if (meta.quest_accepted === true || meta.quest_consumed === true) return "accepted";
  return "offer";
}

/**
 * The state to render: a completed tap result wins over the in-flight flag, which wins over
 * the persisted metadata. An accepted row keeps its metric id from either source.
 */
export function questCardFor(
  metadata: Record<string, unknown> | null | undefined,
  action?: QuestCardAction,
): QuestCard | null {
  const meta = asMetadata(metadata);
  if (!meta) return null;
  const offer = parseQuestOffer(meta.quest_offer);
  if (!offer) return null;

  let state = persistedState(meta);
  if (action?.result) state = action.result;
  else if (action?.pending) state = "accepting";

  const metadataMetricId = typeof meta.quest_metric_id === "string" ? meta.quest_metric_id : undefined;
  return {
    offer,
    state,
    metricId: action?.metricId ?? metadataMetricId,
    error: action?.error,
  };
}

export interface AcceptOutcome {
  state: QuestCardState;
  metricId?: string;
  error?: string;
}

/**
 * Map the `accept-quest` response to the card's next state. `duplicate` means the first tap
 * already won, so it renders accepted (AC-7's idempotent double-tap). A transport failure is
 * the caller's `error` state.
 */
export function acceptOutcome(status: number | undefined, body: unknown): AcceptOutcome {
  const o = asMetadata(body) ?? {};
  const flagged = typeof o.status === "string" ? o.status : undefined;
  const metricId = typeof o.metric_id === "string" ? o.metric_id : undefined;

  if (status === 200 && (flagged === "ok" || flagged === "duplicate" || flagged === "accepted")) {
    return { state: "accepted", metricId };
  }
  if (status === 200 && flagged === "declined") {
    return { state: "declined" };
  }
  if (status === 409 || flagged === "conflict") {
    return { state: "conflict", error: "A quest is already active." };
  }
  if (flagged === "invalid_formula" || flagged === "invalid") {
    return { state: "error", error: "This quest could not be validated." };
  }
  if (status === 404 || flagged === "not_found") {
    return { state: "error", error: "This quest is no longer available." };
  }
  return { state: "error", error: "Could not accept the quest. Try again." };
}
