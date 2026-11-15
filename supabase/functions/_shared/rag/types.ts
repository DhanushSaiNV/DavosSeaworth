// supabase/functions/_shared/rag/types.ts
// P2 — the shapes that cross the RAG module boundary: a plan entry, one validated call, one
// evidence block, one bundle.
//
// Refs: PRD §5.3 (planner output contract), §6.1 (tool A input contract), §7.2 (evidence item
// contract), §7.3 (classifications); PLAN.md §3 (module table), §6.4 (SQL contracts), §11
// (evidence assembly).
//
// Why a separate file: `registry.ts`, `executor.ts`, `evidence.ts` and `compliance.ts` all speak
// these types, and none of them may import a provider SDK or a Supabase client (PLAN.md §3). The
// client-touching half is `dispatch.ts` alone, which is why this file is pure.

// ---------------------------------------------------------------------------- datasets

/**
 * The 13 datasets of PRD §6.1 plus the two semantic tools of §6.2 and §6.3.
 *
 * The registry is one dispatch surface: tool A picks a dataset, tool B is `memory_search`, tool C
 * is `rules_search`. `rules` is not a dataset — it is a global corpus with no `user_id` — so
 * folding tool C in here is what keeps a single allowlist instead of two.
 */
export type DatasetName =
  | "checkins"
  | "impulse_events"
  | "checkin_compliance"
  | "journal"
  | "anchor_plans"
  | "habits"
  | "metrics_catalog"
  | "metric_series"
  | "quests"
  | "daily_vars"
  | "conversation"
  | "memory_facts"
  | "schedule_profile"
  | "memory_search"
  | "rules_search";

export type Operation =
  | "list"
  | "count"
  | "aggregate"
  | "timeseries"
  | "latest"
  | "read_one"
  | "search";

export type Bucket = "day" | "week" | "month";

/** PLAN.md §11.3 — the fixed rank. An essential is never displaced by a lower rank. */
export type Priority = "essential" | "primary" | "supporting" | "optional";

/** How the block was obtained. Never a SQL string; this is the label the prompt sees. */
export type RetrievalMethod =
  | "sql_list"
  | "sql_count"
  | "sql_aggregate"
  | "sql_timeseries"
  | "sql_read_one"
  | "sql_grid"
  | "semantic_memory"
  | "semantic_rules";

// ---------------------------------------------------------------------------- plan

/** PRD §5.3 `intent`. Closed in `planner.ts`; declared here so the plan shape is one type. */
export type RagIntent =
  | "conversation"
  | "explanation"
  | "personal_reflection"
  | "personalized_advice"
  | "progress_review"
  | "decision_support"
  | "factual_recall";

/** PRD §5.3 `answer_mode`. */
export type AnswerMode =
  | "conversational"
  | "explanation"
  | "personalized_analysis"
  | "decision_support"
  | "clarification";

/** One entry of the planner's array. `priority` is required (PRD §5.3, PLAN.md §11.2). */
export interface PlanEntry {
  dataset: DatasetName;
  op: Operation;
  priority: Priority;
  purpose: string;
  arguments: PlanArguments;
}

/**
 * The whole planner response (PRD §5.3). `retrieval_requests` keeps the wire name: it is the same
 * array `parsePlan` returns, and renaming it would add a mapping step with nothing to gain.
 */
export interface RagPlan {
  intent: RagIntent;
  retrieval_required: boolean;
  retrieval_requests: PlanEntry[];
  answer_mode: AnswerMode;
}

/** The tool-A DSL of PRD §6.1, restricted to what the SQL can actually honour (see registry). */
export interface PlanArguments {
  filters?: Record<string, unknown>;
  group_by?: string[];
  bucket?: Bucket;
  metrics?: unknown[];
  limit?: number;
}

// ---------------------------------------------------------------------------- executor

/** A single RPC, fully validated. `args` is what PostgREST receives. */
export interface RpcCall {
  kind: "rpc";
  dataset: DatasetName;
  op: Operation;
  rpc: string;
  args: Record<string, unknown>;
  /** Result columns the evidence block should carry (D6: a read selection, not a SQL argument). */
  project: readonly string[];
}

/**
 * `checkin_compliance` has no RPC of its own: the answer is `list_answered_windows` plus the
 * frozen grid, and the grid lives in TypeScript (PLAN.md §8.1, §8.4). The executor therefore
 * emits a two-RPC call the dispatcher resolves before `compliance.ts` does the arithmetic.
 */
export interface ComplianceCall {
  kind: "compliance";
  dataset: "checkin_compliance";
  op: "aggregate" | "timeseries";
  from: string;
  to: string;
}

export type ExecutorCall = RpcCall | ComplianceCall;

/**
 * Every reason the executor can refuse a plan entry, and every state a call can fail into.
 *
 * The first block is the argument-validation vocabulary (PRD §14.1 A, PLAN.md §6.2); the second
 * is the unavailable-state vocabulary of PLAN.md §10 and §11.4.
 */
export type ExecutorFailure =
  | "unsupported_dataset"
  | "unsupported_operation"
  | "unsupported_filter"
  | "unsupported_dimension"
  | "unsupported_bucket"
  | "unsupported_metric"
  | "unknown_argument"
  | "invalid_argument_type"
  | "invalid_enum_value"
  | "limit_required"
  | "limit_out_of_range"
  | "date_range_required"
  | "date_range_incomplete"
  | "date_range_inverted"
  | "date_range_too_large"
  | "date_range_in_future"
  | "energy_out_of_range"
  | "energy_range_inverted"
  | "metric_selector_required"
  | "missing_embedding"
  | "threshold_uncalibrated"
  | "timezone_unavailable"
  | "grid_unavailable"
  | "range_too_large"
  | "not_authenticated"
  | "rpc_failed";

export type ExecutorOutcome =
  | { ok: true; call: ExecutorCall }
  | { ok: false; reason: ExecutorFailure; detail?: string };

/** Injected by the caller: P2 never reads a config row or an embedding itself. */
export interface ExecutorContext {
  /** The turn's embedding, reused for both semantic tools (PLAN.md §4 "Embeddings"). */
  embedding?: number[] | string | null;
  /** Calibrated thresholds; `null` means uncalibrated, which fails closed (PLAN.md §10). */
  rulesMinSimilarity?: number | null;
  memoryMinSimilarity?: number | null;
  /** Server clock, ms. Never the client's, never the model's (PLAN.md §8.1). */
  nowMs?: number;
  /** Profile-local "today", used by the future clamp. */
  todayLocal?: string;
}

// ---------------------------------------------------------------------------- evidence

export type EvidenceState = "ok" | "empty" | "unavailable";

export interface EvidenceRange {
  from: string;
  to: string;
}

export interface EvidenceCoverage {
  requested_days: number;
  days_with_data: number;
  first_day_with_data: string | null;
}

export type EvidenceRow = Record<string, unknown>;

export interface EvidenceBlock {
  dataset: DatasetName;
  op: Operation;
  retrieval_method: RetrievalMethod;
  priority: Priority;
  purpose: string;
  timezone: string | null;
  day_basis: "profile_local_day";
  range: EvidenceRange | null;
  row_count: number;
  rows_returned: number;
  complete: boolean;
  state: EvidenceState;
  reason?: ExecutorFailure;
  coverage?: EvidenceCoverage;
  limitations: string[];
  rows: EvidenceRow[];
}

export interface EvidenceBundle {
  blocks: EvidenceBlock[];
  omitted_essential: DatasetName[];
  bundle_incomplete: boolean;
  total_chars: number;
  limitations: string[];
}

// ---------------------------------------------------------------------------- thresholds

export type ThresholdOutcome =
  | { ok: true; value: number }
  | { ok: false; reason: "threshold_uncalibrated" };
