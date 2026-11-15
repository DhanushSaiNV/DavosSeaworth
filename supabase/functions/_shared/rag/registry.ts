// supabase/functions/_shared/rag/registry.ts
// P2 — the dataset registry: what the model may ask for, in one table.
//
// Refs: PRD §6.1 (the normative registry, lines 480-610), §6.2 (tool B), §6.3 (tool C);
// PLAN.md §5 (13 datasets), §6.4 (per-function contracts), §9.1 (no timezone argument),
// D4 (validate an enum only where a live CHECK exists), D6 (metrics are a read selection).
//
// The rule this file enforces is PRD line 482: "must not silently expand the fields/operations
// available to the model". Every entry below is transcribed from a validation branch that
// actually exists in `0044`-`0046`; nothing is inferred from the PRD where the SQL disagrees.
// Three deliberate narrowings, all recorded in PLAN.md §1.9:
//
//   * `month` is a bucket only for `metric_series` (the other timeseries functions reject it);
//   * `order`, `cursor`, `datetime_from`/`datetime_to` are not accepted at all — the RPCs have
//     no ordering or cursor parameter and every date filter is a profile-local calendar date;
//   * `metrics` selects *columns* (D6): the SQL aggregate returns every metric its registry row
//     allows, and the executor records which of them the model asked for.
//
// Enum arrays are validated only where a live CHECK exists (D4). `domain`, `source` on
// `conversation` and `domain_hints` on `rules_search` are opaque: an unknown value yields zero
// rows or an inert hint, never an error, because no CHECK and no 16-domain enum exists in the
// repository. Inventing that enum would be the "do not invent" failure.

import type { Bucket, DatasetName, Operation } from "./types.ts";

// ---------------------------------------------------------------------------- spec shapes

export type FilterKind =
  | "enum" // text[] subset-validated against a live CHECK
  | "text_list" // text[] passed through (no CHECK exists — D4)
  | "uuid_list" // uuid[] passed through; ownership is rechecked in SQL
  | "bool"
  | "int"
  | "scalar_enum"; // a single text value from a closed set

export interface FilterSpec {
  /** Key the model uses inside `arguments.filters`. */
  key: string;
  /** SQL parameter it becomes. */
  param: string;
  kind: FilterKind;
  values?: readonly string[];
  min?: number;
  max?: number;
}

export interface RangeSpec {
  /** DSL keys. */
  from: string;
  to: string;
  /** SQL parameters. */
  pFrom: string;
  pTo: string;
  required: boolean;
  /**
   * True when SQL converts a `timestamptz` through the profile zone, which is what makes the
   * §6.2 future clamp and the 366-day cap timezone-dependent. Pure date columns never shift.
   */
  timezoneDerived: boolean;
}

export interface DatasetSpec {
  name: DatasetName;
  /** One RPC per operation. `checkin_compliance` has none: it is resolved in TypeScript. */
  rpcByOp: Partial<Record<Operation, string>>;
  ops: readonly Operation[];
  ranges: readonly RangeSpec[];
  filters: readonly FilterSpec[];
  dimensions: readonly string[];
  buckets: readonly Bucket[];
  limitMax: number;
  /** `latest` clamp (D2). The SQL clamps rather than rejecting, because the default is 200. */
  latestMax?: number;
  /** Rows carrying `content` (PRD line 491). */
  contentMaxRows?: number;
  /** Metric key → result column. The key is `op` or `op_field`, or a bare field name. */
  metrics: Readonly<Record<string, string>>;
  /** Columns a `list`/`latest` row carries. */
  payload: readonly string[];
  /**
   * Bucket caps the SQL enforces by filtering rows (`metric_series` only), not by `LIMIT`. A cap
   * applied before `count(*) over ()` is invisible in `total_count`, so the executor flags the
   * block `complete: false` whenever the range could exceed it.
   */
  bucketCaps?: Readonly<Partial<Record<Bucket, number>>>;
  /** At least one of these filter keys must be supplied (metric_series selectors). */
  requiresOneOf?: readonly string[];
  /** Limitations this dataset always carries, whatever the query. */
  limitations?: readonly string[];
}

// ---------------------------------------------------------------------------- shared vocab

/** Live CHECK on `doings_logs.source` (P0 audit). */
const DOINGS_SOURCES = ["checkin_reply", "chat", "app", "quick_action"] as const;
/** Live CHECK on `journal_entries.severity`. */
const JOURNAL_SEVERITIES = ["S1", "S2", "S3"] as const;
/** Live CHECK on `habits.status`. */
const HABIT_STATUSES = [
  "detected",
  "confronted",
  "watch",
  "struck",
  "quit_committed",
  "cancelled",
] as const;
/** Live CHECK on `metrics.formula_status`. */
const FORMULA_STATUSES = ["proposed", "validated", "rejected"] as const;
/** Live CHECK on `metrics.quest_status`. */
const QUEST_STATUSES = ["active", "completed", "expired", "failed"] as const;
/** Live CHECK on `messages.role`. */
const MESSAGE_ROLES = ["user", "assistant"] as const;
/** Live CHECK on `memory_facts.fact_type`. */
const FACT_TYPES = ["chat", "journal", "oath", "baseline"] as const;

const COMPLIANCE_LIMITATION =
  "compliance uses the current check-in schedule; earlier schedule changes cannot be reconstructed";
const HOURS_LIMITATION = "hours_logged is schedule-estimated, not measured duration";
const CONTENT_LIMITATION = "check-in content is capped at 20 rows and 280 characters";

// ---------------------------------------------------------------------------- the registry

export const REGISTRY: Readonly<Record<DatasetName, DatasetSpec>> = {
  // 1 — doings_logs where kind='doing' (0046:49)
  checkins: {
    name: "checkins",
    rpcByOp: { list: "query_checkins", count: "query_checkins", aggregate: "query_checkins", timeseries: "query_checkins", latest: "query_checkins" },
    ops: ["list", "count", "aggregate", "timeseries", "latest"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: true }],
    filters: [
      { key: "source", param: "p_sources", kind: "enum", values: DOINGS_SOURCES },
      { key: "energy_min", param: "p_energy_min", kind: "int", min: 1, max: 10 },
      { key: "energy_max", param: "p_energy_max", kind: "int", min: 1, max: 10 },
      { key: "has_window", param: "p_has_window", kind: "bool" },
    ],
    dimensions: ["day", "week", "weekday", "hour_of_day", "source"],
    buckets: ["day", "week"],
    limitMax: 500,
    latestMax: 20,
    contentMaxRows: 20,
    metrics: {
      count: "n",
      count_distinct_window: "window_count",
      avg_energy: "energy_avg",
      sum_energy: "energy_sum",
      min_energy: "energy_min",
      max_energy: "energy_max",
    },
    payload: ["id", "occurred_at", "content", "source", "energy", "checkin_window"],
    limitations: [HOURS_LIMITATION, CONTENT_LIMITATION],
  },

  // 2 — doings_logs where kind='impulse_failure' (0046:289). Never projects content.
  impulse_events: {
    name: "impulse_events",
    rpcByOp: { list: "query_impulse_events", count: "query_impulse_events", aggregate: "query_impulse_events", timeseries: "query_impulse_events" },
    ops: ["count", "aggregate", "timeseries", "list"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: true }],
    filters: [{ key: "source", param: "p_sources", kind: "enum", values: DOINGS_SOURCES }],
    dimensions: ["day", "week", "weekday", "hour_of_day", "source"],
    buckets: ["day", "week"],
    limitMax: 500,
    metrics: { count: "n" },
    payload: ["id", "occurred_at", "source"],
    limitations: ["no held-urge dataset exists; only logged impulse yields are counted"],
  },

  // 3 — derived: list_answered_windows + the frozen grid (PLAN.md §8). No RPC of its own.
  checkin_compliance: {
    name: "checkin_compliance",
    rpcByOp: {},
    ops: ["aggregate", "timeseries"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: true }],
    filters: [],
    dimensions: ["day", "week", "weekday"],
    buckets: ["day", "week"],
    limitMax: 366,
    metrics: {
      answered_windows: "answered",
      scheduled_windows: "scheduled",
      compliance_rate: "rate",
    },
    payload: ["local_day", "answered", "scheduled", "rate", "unmatched_answered_windows"],
    limitations: [COMPLIANCE_LIMITATION, HOURS_LIMITATION],
  },

  // 4 — journal_entries (0046:1768). entry_date is already local; no zone is consulted.
  journal: {
    name: "journal",
    rpcByOp: { list: "query_journal_entries", count: "query_journal_entries", aggregate: "query_journal_entries", timeseries: "query_journal_entries" },
    ops: ["count", "aggregate", "timeseries", "list"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: false }],
    filters: [
      { key: "severity", param: "p_severity", kind: "enum", values: JOURNAL_SEVERITIES },
      { key: "probed", param: "p_probed", kind: "bool" },
      { key: "habit_flag", param: "p_habit_flag", kind: "bool" },
    ],
    dimensions: ["day", "week", "severity", "habit_flag"],
    buckets: ["day", "week"],
    limitMax: 500,
    metrics: { count: "n", avg_vagueness: "value" },
    payload: ["id", "occurred_at", "entry_date", "severity", "probed", "habit_flag", "vagueness_score"],
    limitations: [
      "severity is model-assigned and vagueness_score can be null",
      "journal text is never returned; only metadata",
    ],
  },

  // 5 — anchor_plans (0046:453). plan_date is a stored local date: no zone, no future clamp.
  anchor_plans: {
    name: "anchor_plans",
    rpcByOp: { list: "query_anchor_plans", aggregate: "query_anchor_plans", latest: "query_anchor_plans" },
    ops: ["list", "aggregate", "latest"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: false }],
    filters: [],
    dimensions: ["day", "kind"],
    buckets: [],
    limitMax: 500,
    latestMax: 20,
    metrics: { count: "n", plan_count: "plan_count", anchor_count: "anchor_count" },
    payload: ["id", "plan_date", "anchors", "plan_count", "anchor_count"],
    limitations: [
      "anchor_plans is current state, not a history",
      "anchors expose start, end, title and kind only; there is no status or evidence field",
    ],
  },

  // 6 — habits (0046:591). Current state only; `detected_at` needs the zone when dated.
  habits: {
    name: "habits",
    rpcByOp: { list: "query_habits", aggregate: "query_habits" },
    ops: ["list", "aggregate"],
    ranges: [
      { from: "detected_from", to: "detected_to", pFrom: "p_detected_from", pTo: "p_detected_to", required: false, timezoneDerived: true },
      { from: "watch_from", to: "watch_to", pFrom: "p_watch_from", pTo: "p_watch_to", required: false, timezoneDerived: false },
    ],
    filters: [{ key: "status", param: "p_status", kind: "enum", values: HABIT_STATUSES }],
    dimensions: ["status", "detected_day"],
    buckets: [],
    limitMax: 500,
    metrics: { count: "n" },
    payload: ["id", "detected_at", "status", "description", "watch_started_at", "strike_at", "watch_days"],
    limitations: ["habits is current state; no history exists, so no improvement or relapse claim is possible"],
  },

  // 7 — metrics (0046:749). Never projects formula.
  metrics_catalog: {
    name: "metrics_catalog",
    rpcByOp: { list: "query_metrics_catalog", aggregate: "query_metrics_catalog" },
    ops: ["list", "aggregate"],
    ranges: [{ from: "created_from", to: "created_to", pFrom: "p_created_from", pTo: "p_created_to", required: false, timezoneDerived: true }],
    filters: [
      // D4: metrics.domain has no CHECK, so this is an opaque filter, not a validated enum.
      { key: "domain", param: "p_domain", kind: "text_list" },
      { key: "formula_status", param: "p_formula_status", kind: "enum", values: FORMULA_STATUSES },
      { key: "is_quest", param: "p_is_quest", kind: "bool" },
      { key: "quest_status", param: "p_quest_status", kind: "enum", values: QUEST_STATUSES },
      { key: "archived_mode", param: "p_archived_mode", kind: "scalar_enum", values: ["exclude", "include", "only"] },
    ],
    dimensions: ["domain", "formula_status", "is_quest", "quest_status"],
    buckets: [],
    limitMax: 500,
    metrics: { count: "n" },
    payload: ["id", "created_at", "name", "domain", "output_unit", "is_quest", "quest_status", "quest_deadline", "formula_status", "archived_at"],
    limitations: ["metric formulas are never returned", "only validated metrics have points"],
  },

  // 8 — metric_points ⋈ metrics (0046:923). Ownership is the join; there is no user_id on points.
  metric_series: {
    name: "metric_series",
    rpcByOp: { list: "query_metric_series", timeseries: "query_metric_series", latest: "query_metric_series", aggregate: "query_metric_series" },
    ops: ["list", "timeseries", "latest", "aggregate"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: false, timezoneDerived: false }],
    filters: [
      { key: "metric_ids", param: "p_metric_ids", kind: "uuid_list" },
      { key: "metric_names", param: "p_metric_names", kind: "text_list" },
      { key: "domain", param: "p_domain", kind: "text_list" },
      { key: "include_archived", param: "p_include_archived", kind: "bool" },
    ],
    requiresOneOf: ["metric_ids", "metric_names", "domain"],
    dimensions: ["day", "week", "metric_id", "domain"],
    buckets: ["day", "week", "month"],
    limitMax: 500,
    latestMax: 20,
    metrics: {
      latest: "value_latest",
      avg: "value_avg",
      sum: "value_sum",
      min: "value_min",
      max: "value_max",
      count: "point_count",
      delta: "value_delta",
    },
    payload: ["id", "metric_id", "metric_name", "domain", "computed_for", "value"],
    bucketCaps: { day: 60, week: 53, month: 12 },
    limitations: ["metric_points has no user_id; ownership is the metrics join"],
  },

  // 9 — metrics where is_quest (0046:1138). quest_deadline is a stored date; completion is not.
  quests: {
    name: "quests",
    rpcByOp: { list: "query_quests", aggregate: "query_quests" },
    ops: ["list", "aggregate"],
    ranges: [{ from: "deadline_from", to: "deadline_to", pFrom: "p_deadline_from", pTo: "p_deadline_to", required: false, timezoneDerived: false }],
    filters: [
      { key: "quest_status", param: "p_quest_status", kind: "enum", values: QUEST_STATUSES },
      { key: "domain", param: "p_domain", kind: "text_list" },
    ],
    dimensions: ["quest_status", "domain", "deadline_day"],
    buckets: [],
    limitMax: 500,
    metrics: { count: "n" },
    payload: ["id", "name", "domain", "quest_status", "quest_deadline"],
    limitations: ["quest completion date is not persisted; quest_deadline is not a completion date"],
  },

  // 10 — the zero-filled per-local-day grid (0046:1265). hours_logged is computed in SQL (D3).
  daily_vars: {
    name: "daily_vars",
    rpcByOp: { list: "query_daily_vars", timeseries: "query_daily_vars", aggregate: "query_daily_vars" },
    ops: ["list", "timeseries", "aggregate"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: true }],
    filters: [],
    dimensions: ["day", "week", "weekday"],
    buckets: ["day", "week"],
    limitMax: 366,
    metrics: {
      doings_count: "doings_count",
      hours_logged: "hours_logged",
      energy_avg: "energy_avg",
      impulse_failures: "impulse_failures",
      journal_positive_mentions: "journal_positive_mentions",
      journal_negative_mentions: "journal_negative_mentions",
      answered_windows: "answered_windows",
    },
    payload: [
      "local_day",
      "doings_count",
      "energy_avg",
      "impulse_failures",
      "journal_positive_mentions",
      "journal_negative_mentions",
      "hours_logged",
      "answered_windows",
    ],
    limitations: [HOURS_LIMITATION],
  },

  // 11 — messages (0046:1595). Metadata-only; `unsavable = false` is forced in SQL.
  conversation: {
    name: "conversation",
    rpcByOp: { list: "query_conversation", count: "query_conversation", aggregate: "query_conversation", timeseries: "query_conversation" },
    ops: ["count", "aggregate", "timeseries", "list"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: true, timezoneDerived: true }],
    filters: [
      { key: "role", param: "p_role", kind: "enum", values: MESSAGE_ROLES },
      // D4: metadata->>'source' has no CHECK; opaque equality filter.
      { key: "source", param: "p_sources", kind: "text_list" },
    ],
    dimensions: ["day", "hour_of_day", "role", "source"],
    buckets: ["day", "week"],
    limitMax: 500,
    metrics: { count: "n" },
    payload: ["id", "occurred_at", "role", "source"],
    limitations: ["message text is never returned; only role and source metadata", "unsavable messages are excluded"],
  },

  // 12 — memory_facts, three RPCs for one dataset (0044:348, :425, :490).
  memory_facts: {
    name: "memory_facts",
    rpcByOp: {
      list: "list_memory_facts",
      count: "count_memory_facts",
      aggregate: "summarize_memory_facts",
    },
    ops: ["list", "count", "aggregate"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: false, timezoneDerived: true }],
    filters: [
      { key: "fact_types", param: "p_fact_types", kind: "enum", values: FACT_TYPES },
      { key: "has_source", param: "p_has_source", kind: "bool" },
    ],
    dimensions: ["fact_type", "created_day"],
    buckets: [],
    limitMax: 50,
    metrics: { count: "n" },
    payload: ["id", "fact", "fact_type", "created_at", "has_source"],
    limitations: [
      "memory facts have no supersession or validity field; a newer fact is not proof of a truer one",
      "a missing fact is not evidence that the user never said it",
    ],
  },

  // 13 — the allowlisted profile subset (0044:92). No arguments at all.
  schedule_profile: {
    name: "schedule_profile",
    rpcByOp: { read_one: "read_schedule_profile" },
    ops: ["read_one"],
    ranges: [],
    filters: [],
    dimensions: [],
    buckets: [],
    limitMax: 1,
    metrics: {},
    payload: [
      "timezone",
      "checkin_cadence_minutes",
      "checkin_active_hours_start",
      "checkin_active_hours_end",
      "wake_time",
      "sleep_time",
      "onboarding_stage",
      "dialog_state",
      "profile_created_at",
      "day_basis",
    ],
    limitations: [],
  },

  // 14 — tool B, semantic memory (0044:250). The embedding and threshold are injected.
  memory_search: {
    name: "memory_search",
    rpcByOp: { search: "search_facts" },
    ops: ["search"],
    ranges: [{ from: "date_from", to: "date_to", pFrom: "p_from", pTo: "p_to", required: false, timezoneDerived: true }],
    filters: [{ key: "fact_types", param: "p_fact_types", kind: "enum", values: FACT_TYPES }],
    dimensions: [],
    buckets: [],
    limitMax: 5,
    metrics: {},
    payload: ["id", "fact", "fact_type", "created_at", "has_source", "similarity"],
    limitations: [
      "semantic recall is a candidate list, not proof of relevance",
      "a missing fact is not evidence that the user never said it",
    ],
  },

  // 15 — tool C, guiding rules (0045:32). Domain hints boost, never filter.
  rules_search: {
    name: "rules_search",
    rpcByOp: { search: "match_rules_v2" },
    ops: ["search"],
    ranges: [],
    filters: [
      // D4: rules.domain has no CHECK and the 16-domain enum exists nowhere in the repo.
      { key: "domain_hints", param: "p_domain_hints", kind: "text_list" },
    ],
    dimensions: [],
    buckets: [],
    limitMax: 20,
    metrics: {},
    payload: ["id", "text", "domain", "tone", "priority", "similarity"],
    limitations: ["a rule is a principle, never evidence of what the user did"],
  },
};

/**
 * The exact parameter list of every RPC the registry can emit, transcribed from the
 * `create or replace function` headers of 0044-0046 (D7).
 *
 * The executor builds arguments against this table rather than assuming a common shape: the ten
 * `query_*` functions take `p_op`, but the memory functions do not, `count_memory_facts` has no
 * `p_limit` or `p_dimensions`, and `read_schedule_profile` takes no arguments at all. Sending an
 * undeclared named argument is a PostgREST 404, not a Postgres error, so the table is the only
 * thing standing between a correct plan and an untyped transport failure.
 */
export const RPC_PARAMS: Readonly<Record<string, readonly string[]>> = {
  query_checkins: [
    "p_op", "p_from", "p_to", "p_sources", "p_energy_min", "p_energy_max", "p_has_window",
    "p_dimensions", "p_bucket", "p_limit",
  ],
  query_impulse_events: [
    "p_op", "p_from", "p_to", "p_sources", "p_dimensions", "p_bucket", "p_limit",
  ],
  query_anchor_plans: ["p_op", "p_from", "p_to", "p_dimensions", "p_limit"],
  query_habits: [
    "p_op", "p_status", "p_detected_from", "p_detected_to", "p_watch_from", "p_watch_to",
    "p_dimensions", "p_limit",
  ],
  query_metrics_catalog: [
    "p_op", "p_domain", "p_formula_status", "p_is_quest", "p_quest_status", "p_archived_mode",
    "p_created_from", "p_created_to", "p_dimensions", "p_limit",
  ],
  query_metric_series: [
    "p_op", "p_metric_ids", "p_metric_names", "p_domain", "p_from", "p_to", "p_bucket",
    "p_include_archived", "p_dimensions", "p_limit",
  ],
  query_quests: [
    "p_op", "p_quest_status", "p_deadline_from", "p_deadline_to", "p_domain", "p_dimensions",
    "p_limit",
  ],
  query_daily_vars: ["p_op", "p_from", "p_to", "p_dimensions", "p_bucket", "p_limit"],
  query_conversation: [
    "p_op", "p_from", "p_to", "p_role", "p_sources", "p_dimensions", "p_bucket", "p_limit",
  ],
  query_journal_entries: [
    "p_op", "p_from", "p_to", "p_severity", "p_probed", "p_habit_flag", "p_dimensions",
    "p_bucket", "p_limit",
  ],
  list_answered_windows: ["p_from", "p_to"],
  list_memory_facts: ["p_fact_types", "p_from", "p_to", "p_has_source", "p_limit"],
  count_memory_facts: ["p_fact_types", "p_from", "p_to", "p_has_source"],
  summarize_memory_facts: ["p_fact_types", "p_from", "p_to", "p_has_source", "p_dimensions"],
  search_facts: [
    "p_query_embedding", "p_min_similarity", "p_fact_types", "p_from", "p_to", "p_limit",
  ],
  match_rules_v2: ["p_query_embedding", "p_min_similarity", "p_domain_hints", "p_limit"],
  read_schedule_profile: [],
};

export function acceptsParam(rpc: string, param: string): boolean {
  return RPC_PARAMS[rpc]?.includes(param) ?? false;
}

/**
 * The limit the SQL will actually apply. Three functions clamp instead of rejecting: every
 * `latest` op to 20, and `query_checkins` `list` to 20 as well (the D2 content cap, enforced at
 * 0046:148 before `count(*) over ()`). Clamping here keeps the executor's picture of the call
 * identical to what Postgres does, so evidence can tell truncation from an exact answer.
 */
export function effectiveLimit(spec: DatasetSpec, op: Operation, limit: number): number {
  if (op === "latest" && spec.latestMax !== undefined) return Math.min(limit, spec.latestMax);
  if (op === "list" && spec.contentMaxRows !== undefined) {
    return Math.min(limit, spec.contentMaxRows);
  }
  return limit;
}

/** The 13 datasets of PRD §6.1, in registry order. */
export const DATASETS: readonly DatasetName[] = [
  "checkins",
  "impulse_events",
  "checkin_compliance",
  "journal",
  "anchor_plans",
  "habits",
  "metrics_catalog",
  "metric_series",
  "quests",
  "daily_vars",
  "conversation",
  "memory_facts",
  "schedule_profile",
];

/** The two semantic tools (PRD §6.2, §6.3). Not datasets; separate tools. */
export const SEMANTIC_TOOLS: readonly DatasetName[] = ["memory_search", "rules_search"];

export function isDatasetName(value: unknown): value is DatasetName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REGISTRY, value);
}

export function specFor(name: DatasetName): DatasetSpec {
  return REGISTRY[name];
}

/** The RPC for one operation, or null when the operation has none (compliance). */
export function rpcFor(name: DatasetName, op: Operation): string | null {
  return REGISTRY[name].rpcByOp[op] ?? null;
}
