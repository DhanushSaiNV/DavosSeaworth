// supabase/functions/_shared/pipeline/ragTurn.ts
// P3 — one turn's retrieval: config, plan validation, dispatch, and the prompt text.
//
// Refs: PRD §5.3 (validation), §5.4 (behaviour), §7.4 (`no_relevant_evidence`), §7.6 (one
// refinement round), §8.1 (prompt slot), §14.1 C1-C7; PLAN.md §3 (module table), §10
// (thresholds), §11 (assembly), §12.1 (budget); D12, D16.
//
// This is the seam between the pipeline and the P2 retrieval layer. It is the *only* place that
// reads the `rag_*` config keys, so the kill switch and the thresholds have one reader each, and
// the layer below stays config-free. It never throws: a retrieval that cannot run degrades to
// "no evidence", because a broken plan must not cost the person their answer (PRD §7.4; PLAN.md
// §10's fail-closed rules are expressed as `unavailable` blocks, not as a failed turn).
//
// Config is read **once** per turn and reused by the refinement round, so a second round cannot
// see a different budget, threshold or request ceiling than the first.

import { getConfig, getConfigBoolean, getConfigNumber } from "../config.ts";
import {
  dispatchPlan,
  type DispatchOptions,
  type DispatchResult,
  type RagClient,
} from "../rag/dispatch.ts";
import { mergeBundles } from "../rag/evidence.ts";
import {
  NO_RELEVANT_EVIDENCE,
  PLAN_REJECTED_EVIDENCE,
  RETRIEVAL_UNAVAILABLE_EVIDENCE,
  renderEvidenceBundle,
} from "../rag/evidencePrompt.ts";
import { noRetrievalPlan, parsePlan } from "../rag/planner.ts";
import type { EvidenceBundle, PlanEntry, RagPlan } from "../rag/types.ts";

/** A non-sensitive, loggable summary of what retrieval did this turn. Never user-facing. */
export interface RagProbe {
  enabled: boolean;
  /**
   * `none` = no plan asked for retrieval; `rejected` = the plan failed validation;
   * `unavailable` = retrieval was on but could not run (config or dispatcher failure).
   */
  plan: "none" | "ok" | "rejected" | "unavailable";
  reason?: string;
  requests: number;
  blocks: number;
  omitted: number;
  bundle_incomplete: boolean;
  total_chars: number;
  trimmed: number;
  refined: boolean;
  /** PLAN.md §15 G3: provider requests this turn spent (the ledger's `used`). */
  generation_requests: number;
}

export interface RagTurnResult {
  plan: RagPlan;
  bundle: EvidenceBundle;
  /** The rendered prompt block. Always present on a planner turn, `no_relevant_evidence` included. */
  evidenceContext: string;
  probe: RagProbe;
  /** `config.rag_max_plan_requests`, so the refinement schema uses the same ceiling. */
  maxRequests: number;
  /**
   * The one optional additional round (PRD §7.6). Bound to the same config and client as the
   * first round, so a refinement cannot read a different budget or threshold mid-turn.
   */
  refine(
    entries: readonly PlanEntry[],
  ): Promise<{ bundle: EvidenceBundle; evidenceContext: string }>;
}

/**
 * The kill switch (PLAN.md §15). Fail-closed on a missing or malformed row: a switch that cannot
 * be read must never be the reason retrieval turns on.
 */
export async function ragPlannerEnabled(): Promise<boolean> {
  try {
    return await getConfigBoolean("rag_planner_enabled");
  } catch (err) {
    console.warn(
      "[rag] rag_planner_enabled is unreadable; treating the planner as off:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** A calibrated threshold, or `null` — `null` is "uncalibrated", which the executor fails closed. */
async function thresholdOrNull(key: string): Promise<number | null> {
  const raw = await getConfig(key);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function readDispatchOptions(
  client: RagClient,
  embedding: number[] | null,
  nowMs: number,
): Promise<DispatchOptions> {
  const [rulesMinSimilarity, memoryMinSimilarity, budgetChars, maxRequests] = await Promise.all([
    thresholdOrNull("rag_rules_min_similarity"),
    thresholdOrNull("rag_memory_min_similarity"),
    // Seeded [SPEC] values: a missing row is a deploy defect, surfaced rather than papered over.
    getConfigNumber("rag_evidence_total_chars"),
    getConfigNumber("rag_max_plan_requests"),
  ]);
  return {
    client,
    nowMs,
    embedding,
    rulesMinSimilarity,
    memoryMinSimilarity,
    budgetChars,
    maxRequests,
  };
}

function probeOf(
  plan: RagPlan,
  result: DispatchResult | null,
  planState: RagProbe["plan"],
  reason?: string,
): RagProbe {
  return {
    enabled: true,
    plan: planState,
    ...(reason === undefined ? {} : { reason }),
    requests: plan.retrieval_requests.length,
    blocks: result?.bundle.blocks.length ?? 0,
    omitted: result?.bundle.omitted_essential.length ?? 0,
    bundle_incomplete: result?.bundle.bundle_incomplete ?? false,
    total_chars: result?.bundle.total_chars ?? 0,
    trimmed: result?.trimmed ?? 0,
    refined: false,
    generation_requests: 0,
  };
}

const EMPTY_BUNDLE: EvidenceBundle = {
  blocks: [],
  omitted_essential: [],
  bundle_incomplete: false,
  total_chars: 0,
  limitations: [],
};

/**
 * Run one turn's retrieval. `rawPlan` is `extraction.rag_plan` exactly as the model returned it;
 * validation happens here so the caller never handles an unvalidated plan.
 *
 * Fails closed, never open: a missing `rag_*` value or a dispatcher error produces
 * `RETRIEVAL_UNAVAILABLE_EVIDENCE` and an `unavailable` probe, so the turn is answered without
 * evidence rather than 500-ing on a config row (PRD §7.4, PLAN.md §10).
 */
export async function runRagTurn(options: {
  rawPlan: unknown;
  client: RagClient;
  embedding: number[] | null;
  nowMs: number;
}): Promise<RagTurnResult> {
  const outcome = parsePlan(options.rawPlan);
  const plan = outcome.ok ? outcome.plan : noRetrievalPlan();

  let opts: DispatchOptions | null = null;
  let baseBundle: EvidenceBundle = EMPTY_BUNDLE;
  let maxRequests = 0;

  const refine = async (
    entries: readonly PlanEntry[],
  ): Promise<{ bundle: EvidenceBundle; evidenceContext: string }> => {
    if (opts === null) throw new Error("retrieval is unavailable for this turn");
    const second = await dispatchPlan(entries, opts);
    const merged = mergeBundles(baseBundle, second.bundle);
    return { bundle: merged, evidenceContext: renderEvidenceBundle(merged) };
  };

  let resolved: DispatchOptions;
  try {
    resolved = await readDispatchOptions(options.client, options.embedding, options.nowMs);
  } catch (err) {
    console.warn(
      "[rag] retrieval config is unreadable; answering without evidence:",
      err instanceof Error ? err.message : err,
    );
    return {
      plan,
      bundle: baseBundle,
      evidenceContext: RETRIEVAL_UNAVAILABLE_EVIDENCE,
      probe: probeOf(plan, null, "unavailable", "config_error"),
      maxRequests,
      refine,
    };
  }
  opts = resolved;
  maxRequests = typeof resolved.maxRequests === "number" ? resolved.maxRequests : 0;

  if (!outcome.ok) {
    // A rejected plan executes nothing (PRD C4). The model is told the state, not handed an
    // empty section it might fill itself (PRD §7.4).
    return {
      plan,
      bundle: baseBundle,
      evidenceContext: PLAN_REJECTED_EVIDENCE,
      probe: probeOf(plan, null, "rejected", outcome.reason),
      maxRequests,
      refine,
    };
  }

  if (plan.retrieval_requests.length === 0) {
    return {
      plan,
      bundle: baseBundle,
      evidenceContext: NO_RELEVANT_EVIDENCE,
      probe: probeOf(plan, null, "none"),
      maxRequests,
      refine,
    };
  }

  let dispatched: DispatchResult;
  try {
    dispatched = await dispatchPlan(plan.retrieval_requests, resolved);
  } catch (err) {
    console.warn(
      "[rag] dispatch failed; answering without evidence:",
      err instanceof Error ? err.message : err,
    );
    return {
      plan,
      bundle: baseBundle,
      evidenceContext: RETRIEVAL_UNAVAILABLE_EVIDENCE,
      probe: probeOf(plan, null, "unavailable", "dispatch_error"),
      maxRequests,
      refine,
    };
  }
  baseBundle = dispatched.bundle;

  return {
    plan,
    bundle: baseBundle,
    evidenceContext: renderEvidenceBundle(baseBundle),
    probe: probeOf(plan, dispatched, "ok"),
    maxRequests,
    refine,
  };
}
