// supabase/functions/_shared/rag/dispatch.ts
// P2 — the client half: validate the whole plan, run it concurrently, assemble evidence.
//
// Refs: PRD §5.3 (planner validation rules), §6.1 (tool A), §14.1 C1-C7 (orchestration),
// §14.1 C4 ("invalid plan is rejected before any query executes");
// PLAN.md §3 (module table), §8.1 (the two compliance reads), §11 (evidence), §12.1 (budget);
// D9 (no silent argument), D12 (the profile read is shared).
//
// This is the only RAG module that talks to a Supabase client, and it still does not import one:
// the client is a three-method structural interface, so `dispatch.test.ts` injects a fake and no
// service-role key can appear here (PRD C7). Everything the caller must supply from `config` —
// thresholds, budget, request ceiling — arrives as an option; nothing is read from `Deno.env`.
//
// Order of operations is the contract:
//   1. trim to `max_plan_requests` (PRD line 369);
//   2. validate *every* entry before executing any (PRD C4);
//   3. read the profile once (compliance needs the grid; coverage needs the zone);
//   4. execute every call concurrently;
//   5. build blocks, then allocate the bundle.

import {
  complianceEvidenceRows,
  allocateBundle,
  buildEvidenceBlock,
  DEFAULT_EVIDENCE_BUDGET,
  priorityRank,
} from "./evidence.ts";
import {
  computeCompliance,
  type AnsweredWindowRow,
  type ScheduleProfileRow,
} from "./compliance.ts";
import { isUnavailableReason, mapRpcError, validateEntry } from "./executor.ts";
import type {
  Bucket,
  EvidenceBlock,
  EvidenceBundle,
  EvidenceRow,
  ExecutorCall,
  ExecutorFailure,
  PlanEntry,
  RpcCall,
} from "./types.ts";

/** The three fields of a PostgREST error this layer reads. */
export interface RagRpcError {
  code?: string | null;
  message?: string | null;
}

export interface RagRpcResponse {
  data: unknown;
  error: RagRpcError | null;
}

/**
 * The narrow slice of the user-JWT Supabase client the dispatcher needs. Structurally satisfied
 * by `supabase-js`, but declared here so this module has no import from it.
 */
export interface RagClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RagRpcResponse>;
}

export interface DispatchOptions {
  client: RagClient;
  /** Server clock, ms. Never the client's, never the model's. */
  nowMs: number;
  /** The turn's embedding, reused by both semantic tools. */
  embedding?: number[] | string | null;
  /** Calibrated thresholds; null/undefined fails closed (`thresholds.ts`). */
  rulesMinSimilarity?: number | null;
  memoryMinSimilarity?: number | null;
  /** Profile-local today, for the executor's future clamp. */
  todayLocal?: string;
  /** `rag_evidence_total_chars`. */
  budgetChars?: number;
  /** `rag_max_plan_requests`. */
  maxRequests?: number;
}

export interface DispatchEntryResult {
  entry: PlanEntry;
  block: EvidenceBlock;
}

export interface DispatchResult {
  /** True when the plan itself was invalid and nothing was executed (PRD C4). */
  rejected: boolean;
  /** Per-entry validation failures, for a non-sensitive log line. */
  validation: Array<{ dataset: string; reason: ExecutorFailure }>;
  executed: DispatchEntryResult[];
  bundle: EvidenceBundle;
  /** How many entries the request ceiling removed (0 when the plan fit). */
  trimmed: number;
}

// ---------------------------------------------------------------------------- helpers

function emptyBundle(limitations: readonly string[] = []): EvidenceBundle {
  return {
    blocks: [],
    omitted_essential: [],
    bundle_incomplete: false,
    total_chars: 0,
    limitations: [...limitations],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep the highest-ranked entries when the plan exceeds the ceiling, then restore planner order
 * (PRD line 369: "reject or trim deterministically"). The ceiling is a config value, never
 * hardcoded — the default is only the documented seed.
 */
export function trimPlan(
  entries: readonly PlanEntry[],
  maxRequests: number,
): { entries: PlanEntry[]; trimmed: number } {
  if (entries.length <= maxRequests) return { entries: [...entries], trimmed: 0 };
  const ranked = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        priorityRank(a.entry.priority) - priorityRank(b.entry.priority) || a.index - b.index,
    )
    .slice(0, Math.max(0, maxRequests))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.entry);
  return { entries: ranked, trimmed: entries.length - ranked.length };
}

function normalizeRows(data: unknown): EvidenceRow[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) return [data];
  return [];
}

function totalCountOf(rows: readonly EvidenceRow[]): number | null {
  const first = rows[0];
  const value = first?.total_count;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

interface RpcOutcome {
  rows: EvidenceRow[];
  totalCount: number | null;
  failure?: ExecutorFailure;
}

async function runRpc(client: RagClient, call: RpcCall): Promise<RpcOutcome> {
  const response = await Promise.resolve(client.rpc(call.rpc, call.args));
  if (response.error) {
    return {
      rows: [],
      totalCount: null,
      failure: mapRpcError(response.error.code, response.error.message),
    };
  }

  // `count_memory_facts` returns a bare bigint, not a row set.
  if (call.rpc === "count_memory_facts") {
    const raw = typeof response.data === "number" ? response.data : Number(response.data ?? 0);
    const n = Number.isFinite(raw) ? raw : 0;
    return { rows: [{ n }], totalCount: null };
  }

  const rows = normalizeRows(response.data);
  return { rows, totalCount: totalCountOf(rows) };
}

async function readProfile(
  client: RagClient,
): Promise<{ ok: true; row: ScheduleProfileRow } | { ok: false; failure: ExecutorFailure }> {
  const response = await Promise.resolve(client.rpc("read_schedule_profile", {}));
  if (response.error) {
    return { ok: false, failure: mapRpcError(response.error.code, response.error.message) };
  }
  const rows = normalizeRows(response.data);
  if (rows.length === 0) return { ok: false, failure: "rpc_failed" };
  return { ok: true, row: rows[0] as unknown as ScheduleProfileRow };
}

function bucketOf(entry: PlanEntry): Bucket | null {
  const value = isRecord(entry.arguments) ? entry.arguments.bucket : undefined;
  return value === "day" || value === "week" || value === "month" ? value : null;
}

function dimensionsOf(entry: PlanEntry): string[] | null {
  const value = isRecord(entry.arguments) ? entry.arguments.group_by : undefined;
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

// ---------------------------------------------------------------------------- entry point

export async function dispatchPlan(
  entries: readonly PlanEntry[],
  options: DispatchOptions,
): Promise<DispatchResult> {
  const budgetChars = options.budgetChars ?? DEFAULT_EVIDENCE_BUDGET;
  const maxRequests = options.maxRequests ?? 6;

  const { entries: plan, trimmed } = trimPlan(entries, maxRequests);

  // PRD C1: nothing to retrieve is not a tool call.
  if (plan.length === 0) {
    return { rejected: false, validation: [], executed: [], bundle: emptyBundle(), trimmed };
  }

  // ---- validate everything before executing anything (PRD C4)
  const ctx = {
    embedding: options.embedding ?? null,
    rulesMinSimilarity: options.rulesMinSimilarity ?? null,
    memoryMinSimilarity: options.memoryMinSimilarity ?? null,
    nowMs: options.nowMs,
    todayLocal: options.todayLocal,
  };

  const validation: Array<{ dataset: string; reason: ExecutorFailure }> = [];
  const calls: Array<{ entry: PlanEntry; call: ExecutorCall }> = [];
  const unavailable: Array<{ entry: PlanEntry; reason: ExecutorFailure }> = [];

  for (const entry of plan) {
    const outcome = validateEntry(entry, ctx);
    if (outcome.ok) {
      calls.push({ entry, call: outcome.call });
      continue;
    }
    // A malformed plan is rejected wholesale; a runtime unavailability becomes an `unavailable`
    // block and never stops the other datasets from running.
    if (isUnavailableReason(outcome.reason) || outcome.reason === "missing_embedding") {
      unavailable.push({ entry, reason: outcome.reason });
    } else {
      validation.push({ dataset: String(entry.dataset), reason: outcome.reason });
    }
  }

  if (validation.length > 0) {
    return {
      rejected: true,
      validation,
      executed: [],
      bundle: emptyBundle(["the retrieval plan was rejected before execution"]),
      trimmed,
    };
  }

  // ---- the profile is read once (D12): the grid for compliance, the zone for coverage labels
  const profile = await readProfile(options.client);
  const timezone = profile.ok ? (profile.row.timezone ?? "UTC") : null;

  // ---- execute concurrently (PRD C3)
  const results = await Promise.all(
    calls.map(async ({ entry, call }) => {
      if (call.kind === "rpc") {
        const outcome = await runRpc(options.client, call);
        return { entry, call, ...outcome };
      }
      return runCompliance(options, entry, call, profile);
    }),
  );

  // ---- blocks, in planner order
  const byEntry = new Map<
    PlanEntry,
    { rows: EvidenceRow[]; totalCount: number | null; failure?: ExecutorFailure; call?: ExecutorCall }
  >();
  for (const item of results) {
    byEntry.set(item.entry, {
      rows: item.rows,
      totalCount: item.totalCount,
      ...(item.failure ? { failure: item.failure } : {}),
      call: item.call,
    });
  }
  for (const item of unavailable) {
    byEntry.set(item.entry, { rows: [], totalCount: null, failure: item.reason });
  }

  const blocks: EvidenceBlock[] = [];
  const executed: DispatchEntryResult[] = [];

  for (const entry of plan) {
    const item = byEntry.get(entry);
    const block = buildEvidenceBlock({
      entry,
      timezone,
      rows: item?.rows ?? [],
      totalCount: item?.totalCount ?? null,
      ...(item?.failure ? { failure: item.failure } : {}),
      ...(item?.call ? { call: item.call } : {}),
    });
    blocks.push(block);
    executed.push({ entry, block });
  }

  const bundle = allocateBundle(blocks, budgetChars);
  if (trimmed > 0) {
    bundle.limitations.push("the plan exceeded the request ceiling and was trimmed by priority");
    bundle.limitations = [...new Set(bundle.limitations)];
  }

  return { rejected: false, validation: [], executed, bundle, trimmed };
}

// ---------------------------------------------------------------------------- compliance

interface ComplianceOutcome {
  entry: PlanEntry;
  call: ExecutorCall;
  rows: EvidenceRow[];
  totalCount: number | null;
  failure?: ExecutorFailure;
}

async function runCompliance(
  options: DispatchOptions,
  entry: PlanEntry,
  call: Extract<ExecutorCall, { kind: "compliance" }>,
  profile: { ok: true; row: ScheduleProfileRow } | { ok: false; failure: ExecutorFailure },
): Promise<ComplianceOutcome> {
  if (!profile.ok) {
    return { entry, call, rows: [], totalCount: null, failure: profile.failure };
  }

  const response = await Promise.resolve(
    options.client.rpc("list_answered_windows", { p_from: call.from, p_to: call.to }),
  );
  if (response.error) {
    return {
      entry,
      call,
      rows: [],
      totalCount: null,
      failure: mapRpcError(response.error.code, response.error.message),
    };
  }

  const answered = normalizeRows(response.data) as unknown as AnsweredWindowRow[];
  const computed = computeCompliance({
    profile: profile.row,
    answered,
    from: call.from,
    to: call.to,
    nowMs: options.nowMs,
  });

  if (!computed.ok) {
    return { entry, call, rows: [], totalCount: null, failure: computed.reason };
  }

  const rows = complianceEvidenceRows(
    computed.result,
    call.op,
    bucketOf(entry),
    dimensionsOf(entry),
  );
  return { entry, call, rows, totalCount: rows.length };
}
