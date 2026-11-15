// supabase/functions/_shared/rag/evidence.ts
// P2 — evidence assembly and the deterministic bundle allocator.
//
// Refs: PRD §7.1 (never concatenate raw tool output), §7.2 (the item contract), §7.3 (the
// classifications), §7.4 (`no_relevant_evidence`), §7.5 (recency), §14.1 B4-B5;
// PLAN.md §1.1, §8.3 (the compliance limitation), §11.1 (envelope), §11.3 (allocation),
// §11.4 (bundle flags), §17 (known limitations).
//
// Two jobs, both pure:
//
//   1. `buildEvidenceBlock` turns one executed call into a labeled block: what was found, over
//      what window, in which zone, with what it does *not* establish. `row_count` always comes
//      from `total_count`, never from `rows.length`, because the difference between the two is
//      exactly the truncation the model must not paper over.
//   2. `allocateBundle` spends a fixed character budget by rank. The model never chooses what is
//      dropped; an essential is never displaced by a lower rank, and an unplaceable essential
//      forbids every optional block (PLAN.md §11.3).

import { specFor } from "./registry.ts";
import type { ComplianceResult } from "./compliance.ts";
import { complianceRows } from "./compliance.ts";
import type {
  Bucket,
  DatasetName,
  EvidenceBlock,
  EvidenceBundle,
  EvidenceCoverage,
  EvidenceRange,
  EvidenceRow,
  EvidenceState,
  ExecutorCall,
  ExecutorFailure,
  Operation,
  PlanEntry,
  Priority,
  RetrievalMethod,
} from "./types.ts";

const DAY_MS = 86_400_000;

/** `rag_evidence_total_chars` (PLAN.md §11.3 item 8). Passed in by the caller from config. */
export const DEFAULT_EVIDENCE_BUDGET = 12_000;

const RANK: Record<Priority, number> = {
  essential: 0,
  primary: 1,
  supporting: 2,
  optional: 3,
};

/** The fixed rank of PLAN.md §11.3 item 1, exposed so the dispatcher trims by the same order. */
export function priorityRank(priority: Priority): number {
  return RANK[priority];
}

// ---------------------------------------------------------------------------- helpers

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateMs(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

function daysInclusive(from: string, to: string): number {
  const a = dateMs(from);
  const b = dateMs(to);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

/** `'YYYY-MM-DD'` of an instant in the profile zone. */
function localDate(iso: string, timezone: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = get("year");
    const mo = get("month");
    const d = get("day");
    return y && mo && d ? `${y}-${mo}-${d}` : null;
  } catch {
    return null;
  }
}

/**
 * The date a row belongs to, for coverage only. Stored calendar dates are taken as-is; timestamp
 * columns are converted through the profile zone, which is the same basis every query uses.
 */
const DATE_COLUMNS = ["local_day", "bucket_start", "entry_date", "plan_date", "quest_deadline", "computed_for"] as const;
const TIMESTAMP_COLUMNS = ["occurred_at", "logged_at", "created_at", "detected_at", "watch_started_at", "strike_at"] as const;

function rowDate(row: EvidenceRow, timezone: string): string | null {
  for (const column of DATE_COLUMNS) {
    const value = row[column];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  for (const column of TIMESTAMP_COLUMNS) {
    const value = row[column];
    if (typeof value === "string") {
      const date = localDate(value, timezone);
      if (date !== null) return date;
    }
  }
  return null;
}

function retrievalMethod(dataset: DatasetName, op: Operation): RetrievalMethod {
  if (dataset === "checkin_compliance") return "sql_grid";
  if (dataset === "memory_search") return "semantic_memory";
  if (dataset === "rules_search") return "semantic_rules";
  switch (op) {
    case "count":
      return "sql_count";
    case "aggregate":
      return "sql_aggregate";
    case "timeseries":
      return "sql_timeseries";
    case "read_one":
      return "sql_read_one";
    default:
      return "sql_list";
  }
}

function rangeFromEntry(entry: PlanEntry): EvidenceRange | null {
  const spec = specFor(entry.dataset);
  const filters = isPlainObject(entry.arguments?.filters) ? entry.arguments.filters : {};
  for (const range of spec.ranges) {
    const from = filters[range.from];
    const to = filters[range.to];
    if (typeof from === "string" && typeof to === "string") return { from, to };
  }
  return null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------- block

export interface EvidenceInput {
  entry: PlanEntry;
  /** Profile zone, or null when the profile read itself failed. */
  timezone: string | null;
  /** Raw rows from the RPC, or the compliance result's shaped rows. */
  rows: EvidenceRow[];
  /** `total_count` from the result set; ignored for `count`, which carries `n`. */
  totalCount?: number | null;
  /** Set when the call could not be executed. Produces an `unavailable` block. */
  failure?: ExecutorFailure;
  /** The call that produced the rows, for bucket/dimension-aware shaping. */
  call?: ExecutorCall;
}

function projectRows(rows: readonly EvidenceRow[], project: readonly string[]): EvidenceRow[] {
  // An empty projection means "carry the row as produced" — compliance rows are shaped by
  // `compliance.ts` and their columns differ between timeseries and aggregate.
  if (project.length === 0) return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const out: EvidenceRow = {};
    for (const column of project) {
      if (Object.prototype.hasOwnProperty.call(row, column)) out[column] = row[column];
    }
    return out;
  });
}

function projectForCall(call: ExecutorCall | undefined, entry: PlanEntry): readonly string[] {
  if (call && call.kind === "rpc") return call.project;
  if (entry.dataset === "checkin_compliance") return [];
  if (entry.op === "count") return ["n"];
  const spec = specFor(entry.dataset);
  return spec.payload;
}

/**
 * PLAN.md §11.1. The envelope is always present; `coverage` only when the range is known and at
 * least one row carries a date, because a made-up `days_with_data: 0` would be a false statement.
 */
export function buildEvidenceBlock(input: EvidenceInput): EvidenceBlock {
  const { entry } = input;
  const spec = specFor(entry.dataset);
  const range = rangeFromEntry(entry);
  const project = projectForCall(input.call, entry);
  const rows = projectRows(input.rows, project);

  const rawCount = input.totalCount;
  let rowCount: number;
  if (entry.op === "count") {
    const value = input.rows[0]?.n;
    rowCount = typeof value === "number" ? value : Number(value ?? 0);
    if (!Number.isFinite(rowCount)) rowCount = 0;
  } else {
    rowCount = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : rows.length;
  }

  const state: EvidenceState = input.failure ? "unavailable" : rowCount === 0 ? "empty" : "ok";

  let complete = !input.failure && (entry.op === "count" || rowCount <= rows.length);

  const limitations: string[] = [...(spec.limitations ?? [])];

  // `metric_series` timeseries is the one invisible truncation: the SQL applies the per-metric
  // point cap *before* `count(*) over ()`, so `total_count` cannot reveal it (0046:1057-1068).
  if (entry.dataset === "metric_series" && entry.op === "timeseries" && spec.bucketCaps) {
    const bucket = (isPlainObject(entry.arguments) && entry.arguments.bucket) as Bucket | undefined;
    const cap = spec.bucketCaps[bucket ?? "day"];
    if (cap !== undefined) {
      limitations.push(
        `each metric's series is capped at ${cap} ${bucket ?? "day"} points; older points are dropped before counting`,
      );
      const estimate = range === null ? null : bucketEstimate(range, bucket ?? "day");
      if ((estimate !== null && estimate > cap) || rowCount >= cap) complete = false;
    }
  }

  if (!complete && !input.failure) {
    limitations.push("results were truncated by a per-dataset cap");
  }

  let coverage: EvidenceCoverage | undefined;
  if (range !== null && input.timezone !== null && rows.length > 0) {
    const dates = rows
      .map((row) => rowDate(row, input.timezone as string))
      .filter((date): date is string => date !== null)
      .sort();
    if (dates.length > 0) {
      coverage = {
        requested_days: daysInclusive(range.from, range.to),
        days_with_data: new Set(dates).size,
        first_day_with_data: dates[0],
      };
    }
  }

  return {
    dataset: entry.dataset,
    op: entry.op,
    retrieval_method: retrievalMethod(entry.dataset, entry.op),
    priority: entry.priority,
    purpose: entry.purpose,
    timezone: input.timezone,
    day_basis: "profile_local_day",
    range,
    row_count: rowCount,
    rows_returned: rows.length,
    complete,
    state,
    ...(input.failure ? { reason: input.failure } : {}),
    ...(coverage ? { coverage } : {}),
    limitations: dedupe(limitations),
    rows,
  };
}

/** How many buckets a range can produce for a bucket size — the cap test, conservatively. */
function bucketEstimate(range: EvidenceRange, bucket: Bucket): number {
  const days = daysInclusive(range.from, range.to);
  if (bucket === "day") return days;
  if (bucket === "week") return Math.floor(days / 7) + 2;
  return monthsSpan(range) + 1;
}

function monthsSpan(range: EvidenceRange): number {
  const from = /^(\d{4})-(\d{2})/.exec(range.from);
  const to = /^(\d{4})-(\d{2})/.exec(range.to);
  if (!from || !to) return 0;
  return (
    (Number(to[1]) - Number(from[1])) * 12 + (Number(to[2]) - Number(from[2]))
  );
}

// ---------------------------------------------------------------------------- allocator

function blockChars(block: EvidenceBlock): number {
  return JSON.stringify(block).length;
}

function withTruncation(limitations: readonly string[]): string[] {
  return dedupe([...limitations, "this block was truncated to fit the evidence budget"]);
}

/**
 * Fit one block into `remaining` by dropping rows from the end. Returns null when even the
 * envelope does not fit, or when the block's single row is its whole meaning (`count`,
 * `read_one`) and cannot be dropped without lying.
 */
function fitBlock(block: EvidenceBlock, remaining: number): EvidenceBlock | null {
  if (blockChars(block) <= remaining) return block;
  if (block.op === "count" || block.op === "read_one") return null;

  let rows = block.rows.slice();
  while (rows.length > 0) {
    rows = rows.slice(0, -1);
    const candidate: EvidenceBlock = {
      ...block,
      rows,
      rows_returned: rows.length,
      complete: false,
      limitations: withTruncation(block.limitations),
    };
    if (blockChars(candidate) <= remaining) return candidate;
  }
  return null;
}

/**
 * PLAN.md §11.3, deterministically. Rank order, then planner index; essentials first and never
 * displaced; an unplaceable essential sets `bundle_incomplete` and forbids every optional block.
 */
export function allocateBundle(
  blocks: readonly EvidenceBlock[],
  budgetChars: number = DEFAULT_EVIDENCE_BUDGET,
): EvidenceBundle {
  const indexed = blocks.map((block, index) => ({ block, index }));
  indexed.sort((a, b) => RANK[a.block.priority] - RANK[b.block.priority] || a.index - b.index);

  let remaining = budgetChars;
  const kept: EvidenceBlock[] = [];
  const omittedEssential: DatasetName[] = [];
  let bundleIncomplete = false;
  let essentialUnplaceable = false;
  let lowerDropped = false;

  for (const { block } of indexed) {
    if (essentialUnplaceable && block.priority === "optional") {
      lowerDropped = true;
      continue;
    }
    const fitted = fitBlock(block, remaining);
    if (fitted === null) {
      if (block.priority === "essential") {
        omittedEssential.push(block.dataset);
        bundleIncomplete = true;
        essentialUnplaceable = true;
      } else {
        if (block.priority !== "optional") bundleIncomplete = true;
        lowerDropped = true;
      }
      continue;
    }
    kept.push(fitted);
    remaining -= blockChars(fitted);
  }

  // Presentation order follows the planner, not the allocation order.
  const order = new Map(blocks.map((block, index) => [block, index]));
  kept.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  const limitations: string[] = [];
  if (bundleIncomplete) {
    limitations.push("some requested evidence could not be included; the answer must be qualified");
  }
  if (lowerDropped) {
    limitations.push("lower-priority evidence was omitted to fit the evidence budget");
  }
  for (const block of kept) limitations.push(...block.limitations);

  return {
    blocks: kept,
    omitted_essential: omittedEssential,
    bundle_incomplete: bundleIncomplete,
    total_chars: kept.reduce((sum, block) => sum + blockChars(block), 0),
    limitations: dedupe(limitations),
  };
}

// ---------------------------------------------------------------------------- compliance

/**
 * Compliance rows for a block. Kept here so `dispatch.ts` never shapes rows itself: the grid
 * arithmetic is `compliance.ts`, the presentation is this function, and the envelope is above.
 */
export function complianceEvidenceRows(
  result: ComplianceResult,
  op: Operation,
  bucket: Bucket | null | undefined,
  dimensions: readonly string[] | null | undefined,
): EvidenceRow[] {
  if (op !== "aggregate" && op !== "timeseries") return [];
  return complianceRows(result, op, bucket, dimensions);
}
