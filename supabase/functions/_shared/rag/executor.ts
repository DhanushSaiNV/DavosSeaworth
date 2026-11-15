// supabase/functions/_shared/rag/executor.ts
// P2 — plan entry → one validated call. Never trust the model twice over (PLAN.md §3).
//
// Refs: PRD §6.1 (DSL, limits, filter primitives), §14.1 A (validation tests), §14.1 A4-A6;
// PLAN.md §6.2 (date rules), §6.4 (per-function contracts), §9.1 (no timezone argument),
// §10 (thresholds fail closed), D2 (the 20-row content clamp), D4 (opaque filters),
// D6 (metrics are a read selection), D9 (unsupported DSL keys are rejected, not ignored).
//
// This module is pure: no client, no `Deno.env`, no config read. It answers one question — "is
// this plan entry executable, and as exactly what RPC arguments?" — and every rejection names
// the same reason the SQL would have raised, so the typed state is identical whether the mistake
// is caught here or in Postgres. The two must never disagree: `executor.test.ts` asserts the
// boundary values on both sides of every bound the SQL enforces.

import { REGISTRY, acceptsParam, effectiveLimit, rpcFor, specFor } from "./registry.ts";
import type { DatasetSpec, FilterSpec, RangeSpec } from "./registry.ts";
import type {
  Bucket,
  ExecutorContext,
  ExecutorFailure,
  ExecutorOutcome,
  Operation,
  PlanEntry,
  RpcCall,
} from "./types.ts";

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only keys a plan entry may carry inside `arguments` (D9). */
const ARGUMENT_KEYS = ["filters", "group_by", "bucket", "metrics", "limit"] as const;

function fail(reason: ExecutorFailure, detail?: string): ExecutorOutcome {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

// ---------------------------------------------------------------------------- primitives

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((v) => typeof v === "string" && v.trim().length > 0)) return null;
  return value as string[];
}

/** `[1,2,3]` — the literal PostgREST sends for a `vector` parameter. */
function vectorLiteral(value: number[] | string | null | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed : null;
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return `[${value.join(",")}]`;
}

// ---------------------------------------------------------------------------- ranges

function readRange(
  range: RangeSpec,
  filters: Record<string, unknown>,
): { ok: true; from: string | null; to: string | null } | { ok: false; reason: ExecutorFailure } {
  const rawFrom = filters[range.from];
  const rawTo = filters[range.to];
  const hasFrom = rawFrom !== undefined && rawFrom !== null;
  const hasTo = rawTo !== undefined && rawTo !== null;

  if (!hasFrom && !hasTo) {
    return range.required ? { ok: false, reason: "date_range_required" } : { ok: true, from: null, to: null };
  }
  if (hasFrom !== hasTo) return { ok: false, reason: "date_range_incomplete" };
  if (!isDate(rawFrom) || !isDate(rawTo)) return { ok: false, reason: "invalid_argument_type" };
  if (rawFrom > rawTo) return { ok: false, reason: "date_range_inverted" };
  if (daysBetween(rawFrom, rawTo) > 366) return { ok: false, reason: "date_range_too_large" };
  return { ok: true, from: rawFrom, to: rawTo };
}

function checkFuture(
  range: RangeSpec,
  to: string | null,
  ctx: ExecutorContext,
): ExecutorFailure | null {
  // §6.2: the future clamp applies only where the date is derived from a timestamp. A stored
  // date column (`plan_date`, `quest_deadline`, `entry_date`, `computed_for`) may point forward.
  if (!range.timezoneDerived || to === null || !ctx.todayLocal) return null;
  return to > ctx.todayLocal ? "date_range_in_future" : null;
}

// ---------------------------------------------------------------------------- filters

function validateFilter(
  spec: FilterSpec,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: ExecutorFailure } {
  switch (spec.kind) {
    case "enum": {
      const values = stringArray(value);
      if (!values) return { ok: false, reason: "invalid_argument_type" };
      const allowed = spec.values ?? [];
      if (!values.every((v) => allowed.includes(v))) {
        return { ok: false, reason: "invalid_enum_value" };
      }
      return { ok: true, value: values };
    }
    case "text_list": {
      const values = stringArray(value);
      return values ? { ok: true, value: values } : { ok: false, reason: "invalid_argument_type" };
    }
    case "uuid_list": {
      const values = stringArray(value);
      if (!values || !values.every((v) => UUID_RE.test(v))) {
        return { ok: false, reason: "invalid_argument_type" };
      }
      return { ok: true, value: values };
    }
    case "scalar_enum": {
      if (typeof value !== "string") return { ok: false, reason: "invalid_argument_type" };
      const allowed = spec.values ?? [];
      return allowed.includes(value)
        ? { ok: true, value }
        : { ok: false, reason: "invalid_enum_value" };
    }
    case "bool":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, reason: "invalid_argument_type" };
    case "int": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { ok: false, reason: "invalid_argument_type" };
      }
      const min = spec.min ?? Number.NEGATIVE_INFINITY;
      const max = spec.max ?? Number.POSITIVE_INFINITY;
      if (value < min || value > max) {
        // Energy bounds have their own SQLSTATE name (PRD §14.1 T7).
        return {
          ok: false,
          reason: spec.key.startsWith("energy") ? "energy_out_of_range" : "invalid_argument_type",
        };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false, reason: "invalid_argument_type" };
  }
}

// ---------------------------------------------------------------------------- metrics (D6)

/**
 * Normalise one metric selector. The PRD's DSL is `{ op, field? }`; `daily_vars` names its
 * variables directly, so a bare string is also accepted. The canonical key is `op` when no field
 * is given, `op_field` otherwise.
 */
function metricKey(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (!isPlainObject(entry)) return null;
  const op = entry.op;
  if (typeof op !== "string" || op.length === 0) return null;
  const field = entry.field;
  if (field === undefined || field === null) return op;
  if (typeof field !== "string" || field.length === 0) return null;
  return `${op}_${field}`;
}

function readMetrics(
  spec: DatasetSpec,
  raw: unknown,
): { ok: true; columns: string[] } | { ok: false; reason: ExecutorFailure } {
  if (raw === undefined || raw === null) {
    // No selection: every metric the registry row allows (D6). The model asked for an aggregate
    // without naming metrics, which is legal — it gets the full allowlisted set.
    return { ok: true, columns: Object.values(spec.metrics) };
  }
  if (!Array.isArray(raw)) return { ok: false, reason: "invalid_argument_type" };
  const columns: string[] = [];
  for (const entry of raw) {
    const key = metricKey(entry);
    if (!key) return { ok: false, reason: "invalid_argument_type" };
    const column = spec.metrics[key];
    if (!column) return { ok: false, reason: "unsupported_metric" };
    if (!columns.includes(column)) columns.push(column);
  }
  return { ok: true, columns };
}

// ---------------------------------------------------------------------------- project

function dedupeColumns(columns: readonly string[]): string[] {
  return [...new Set(columns)];
}

/**
 * The columns a block carries. `list`/`latest`/`search`/`read_one` carry the dataset's payload;
 * `count` carries `n`; `aggregate` keeps the facet columns (`dimension`, `key`) because a facet
 * list is unreadable without them; `timeseries` keeps `bucket_start` and `key`.
 */
function projectFor(spec: DatasetSpec, op: Operation, metricColumns: string[]): string[] {
  if (op === "list" || op === "latest" || op === "search" || op === "read_one") {
    return [...spec.payload];
  }
  if (op === "count") return ["n"];
  if (op === "aggregate") {
    return dedupeColumns(["dimension", "key", "n", ...metricColumns]);
  }
  return dedupeColumns([
    "bucket_start",
    "key",
    "n",
    ...(spec.name === "metric_series" ? ["metric_id"] : []),
    ...metricColumns,
  ]);
}

// ---------------------------------------------------------------------------- entry point

/**
 * Validate one plan entry and produce the call it maps to.
 *
 * Order matters: the dataset and operation are checked first (a wrong dataset must not produce a
 * filter error), then `arguments` keys, then ranges, then filters, then the cross-field rules the
 * SQL applies last (energy ordering, required selectors, bucket-on-timeseries).
 */
export function validateEntry(entry: PlanEntry, ctx: ExecutorContext = {}): ExecutorOutcome {
  if (!entry || typeof entry !== "object") return fail("unsupported_dataset");
  if (typeof entry.dataset !== "string" || !(entry.dataset in REGISTRY)) {
    return fail("unsupported_dataset");
  }
  const spec = specFor(entry.dataset);
  const op = entry.op;
  if (typeof op !== "string" || !spec.ops.includes(op as Operation)) {
    return fail("unsupported_operation");
  }

  const args = entry.arguments === undefined || entry.arguments === null
    ? {}
    : isPlainObject(entry.arguments)
      ? entry.arguments
      : null;
  if (args === null) return fail("invalid_argument_type", "arguments");
  for (const key of Object.keys(args)) {
    if (!(ARGUMENT_KEYS as readonly string[]).includes(key)) {
      return fail("unknown_argument", key);
    }
  }

  const filters = isPlainObject(args.filters) ? { ...args.filters } : {};
  const rpcArgs: Record<string, unknown> = {};
  /** Which DSL field produced each parameter. Drives the rejection reason below (D9). */
  const origin: Record<string, string> = {};

  const set = (param: string, value: unknown, from: string): void => {
    rpcArgs[param] = value;
    origin[param] = from;
  };

  set("p_op", op, "op");

  // ---- ranges
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  for (const spec_ of spec.ranges) {
    const read = readRange(spec_, filters);
    if (!read.ok) return fail(read.reason);
    delete filters[spec_.from];
    delete filters[spec_.to];
    if (read.from !== null) {
      set(spec_.pFrom, read.from, `filter:${spec_.from}`);
      set(spec_.pTo, read.to, `filter:${spec_.to}`);
      const future = checkFuture(spec_, read.to, ctx);
      if (future) return fail(future);
      if (rangeFrom === null) {
        rangeFrom = read.from;
        rangeTo = read.to;
      }
    }
  }

  // ---- filters
  for (const [key, raw] of Object.entries(filters)) {
    const filter = spec.filters.find((f) => f.key === key);
    if (!filter) return fail("unsupported_filter", key);
    if (raw === null) continue;
    const checked = validateFilter(filter, raw);
    if (!checked.ok) return fail(checked.reason, key);
    set(filter.param, checked.value, `filter:${key}`);
  }

  // ---- energy ordering (the SQL checks min <= max last, PRD §14.1 T7)
  const energyMin = rpcArgs["p_energy_min"];
  const energyMax = rpcArgs["p_energy_max"];
  if (typeof energyMin === "number" && typeof energyMax === "number" && energyMin > energyMax) {
    return fail("energy_range_inverted");
  }

  // ---- required selectors (metric_series: id, name or domain)
  if (spec.requiresOneOf) {
    const present = spec.requiresOneOf.some((key) => rpcArgs[selectorParam(spec, key)] !== undefined);
    if (!present) return fail("metric_selector_required");
  }

  // ---- dimensions (an empty array means "no dimensions", matching 0044:524)
  const groupBy = args.group_by;
  if (groupBy !== undefined && groupBy !== null) {
    if (!Array.isArray(groupBy)) return fail("invalid_argument_type", "group_by");
    if (groupBy.length > 0) {
      const dims = stringArray(groupBy);
      if (!dims) return fail("invalid_argument_type", "group_by");
      if (!dims.every((d) => spec.dimensions.includes(d))) {
        return fail("unsupported_dimension", dims.find((d) => !spec.dimensions.includes(d)));
      }
      set("p_dimensions", dims, "group_by");
    }
  }

  // ---- bucket (only `timeseries` accepts one; the SQL raises invalid_bucket otherwise)
  const bucket = args.bucket;
  if (bucket !== undefined && bucket !== null) {
    if (op !== "timeseries") return fail("unsupported_bucket", "bucket");
    if (typeof bucket !== "string" || !spec.buckets.includes(bucket as Bucket)) {
      return fail("unsupported_bucket", String(bucket));
    }
    set("p_bucket", bucket, "bucket");
  }

  // ---- metrics (a read selection, not a SQL argument — D6)
  const metrics = readMetrics(spec, args.metrics);
  if (!metrics.ok) return fail(metrics.reason);

  // ---- limit
  const limit = args.limit;
  if (limit !== undefined && limit !== null) {
    if (typeof limit !== "number" || !Number.isInteger(limit)) {
      return fail("invalid_argument_type", "limit");
    }
    if (limit < 1 || limit > spec.limitMax) return fail("limit_out_of_range", "limit");
    set("p_limit", effectiveLimit(spec, op, limit), "limit");
  } else if (op === "list") {
    // PRD line 459: `limit` is required for `list`. The SQL default exists for direct callers.
    return fail("limit_required");
  }

  // ---- semantic tools: the embedding and the calibrated threshold are injected, never modelled
  if (op === "search") {
    const embedding = vectorLiteral(ctx.embedding);
    if (!embedding) return fail("missing_embedding");
    const threshold =
      entry.dataset === "rules_search" ? ctx.rulesMinSimilarity : ctx.memoryMinSimilarity;
    if (threshold === undefined || threshold === null) return fail("threshold_uncalibrated");
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      return fail("threshold_uncalibrated");
    }
    set("p_query_embedding", embedding, "embedding");
    set("p_min_similarity", threshold, "embedding");
  }

  const project = projectFor(spec, op, metrics.columns);

  // ---- checkin_compliance is the one dataset with no RPC (PLAN.md §8.4)
  if (entry.dataset === "checkin_compliance") {
    if (rangeFrom === null || rangeTo === null) return fail("date_range_required");
    // The grid emits every day in the range; there is no row cap for `limit` to control.
    if (args.limit !== undefined && args.limit !== null) return fail("unknown_argument", "limit");
    return {
      ok: true,
      call: {
        kind: "compliance",
        dataset: "checkin_compliance",
        op: op as "aggregate" | "timeseries",
        from: rangeFrom,
        to: rangeTo,
      },
    };
  }

  const rpc = rpcFor(entry.dataset, op);
  if (!rpc) return fail("unsupported_operation");

  // ---- assemble against the RPC's real parameter list (D7)
  //
  // `p_op` is executor-generated and silently dropped where the function has no such parameter.
  // Everything else came from the model, so a parameter the function does not declare is a
  // rejection, never a silent omission (D9): `limit` on `count_memory_facts` and `group_by`
  // outside `summarize_memory_facts` are the two real cases.
  const finalArgs: Record<string, unknown> = {};
  for (const [param, value] of Object.entries(rpcArgs)) {
    if (acceptsParam(rpc, param)) {
      finalArgs[param] = value;
      continue;
    }
    const from = origin[param] ?? param;
    if (from === "op") continue;
    if (from === "group_by") return fail("unsupported_dimension", "group_by");
    if (from === "limit") return fail("unknown_argument", "limit");
    if (from === "bucket") return fail("unsupported_bucket", "bucket");
    return fail("unknown_argument", from.startsWith("filter:") ? from.slice(7) : from);
  }

  const call: RpcCall = {
    kind: "rpc",
    dataset: entry.dataset,
    op,
    rpc,
    args: finalArgs,
    project,
  };
  return { ok: true, call };
}

function selectorParam(spec: DatasetSpec, key: string): string {
  return spec.filters.find((f) => f.key === key)?.param ?? key;
}

// ---------------------------------------------------------------------------- SQLSTATE map

/**
 * Postgres error → the same typed failure the executor would have produced.
 *
 * `22023` is the contract's own class: the SQL raises it with a leading token (`invalid_source`,
 * `range_too_large`, …), so the token is the discriminator. Anything unrecognised stays
 * `invalid_argument_type` rather than being silently treated as success.
 */
export function mapRpcError(
  code: string | null | undefined,
  message: string | null | undefined,
): ExecutorFailure {
  const text = String(message ?? "");
  if (code === "42501") return "not_authenticated";
  if (code === "42883" || code === "42703" || code === "22P02") return "invalid_argument_type";
  if (code === "22023") {
    if (text.includes("timezone_unavailable")) return "timezone_unavailable";
    if (text.includes("range_too_large")) return "range_too_large";
    if (text.includes("grid_unavailable")) return "grid_unavailable";
    if (text.includes("not_authenticated")) return "not_authenticated";
    return "invalid_argument_type";
  }
  return "rpc_failed";
}

/** True when the failure means "this evidence cannot exist", not "the plan was malformed". */
export function isUnavailableReason(reason: ExecutorFailure): boolean {
  return (
    reason === "timezone_unavailable" ||
    reason === "threshold_uncalibrated" ||
    reason === "range_too_large" ||
    reason === "grid_unavailable" ||
    reason === "not_authenticated" ||
    reason === "rpc_failed"
  );
}
