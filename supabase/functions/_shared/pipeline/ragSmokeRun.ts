// supabase/functions/_shared/pipeline/ragSmokeRun.ts
// P4 — one smoke prompt at a time, through the real turn seam.
//
// Refs: PRD §14.1 D (the set), §14.2 (manual checklist); PLAN.md §15 (P4), §16 (ceilings),
// §1.10 D21 (the fixture lives in `content/`).
//
// This module is pure orchestration: it knows how to turn a prompt into a plan, a plan into a
// turn, and a turn into an observation, and nothing else. Every side effect — the provider call,
// the retrieval RPC, the ledger — arrives as an injected function, so the whole loop is testable
// in Jest with fakes and the Deno-only wiring stays in the drill that calls it.
//
// The type imports are `import type` on purpose: `ragTurn.ts` reads `Deno.env` at module scope, so
// a value import would make this file unloadable outside the edge runtime.

import type { DatasetName, RagPlan } from "../rag/types.ts";
import {
  evaluateObservation,
  summarizeSmoke,
  type SmokeObservation,
  type SmokePrompt,
  type SmokeResult,
  type SmokeSet,
} from "../rag/smoke.ts";
import type { RagProbe } from "./ragTurn.ts";

/** What one executed prompt produced, in the shape the evaluator needs. */
export interface SmokeTurn {
  plan: RagPlan;
  evidenceContext: string;
  probe: RagProbe;
}

export interface SmokeRunnerDeps {
  /**
   * Ask the model for a plan. The real implementation is `extract(prompt, { ragPlan: true })`;
   * the drill may instead return a plan written by hand, which is how a deterministic run works.
   */
  planFor(prompt: SmokePrompt): Promise<{ rawPlan: unknown }>;
  /** Execute that plan through `runRagTurn`, exactly as a real turn does. */
  runTurn(rawPlan: unknown): Promise<SmokeTurn>;
  /** Provider requests spent so far, from the shared ledger. */
  requestsSpent(): number;
}

export interface SmokeRunOptions {
  maxGenerationRequests?: number;
  maxEvidenceChars?: number;
}

export interface SmokeRun {
  results: SmokeResult[];
  observations: SmokeObservation[];
  summary: { pass: number; warn: number; fail: number; blocking: boolean };
}

function datasetsOf(plan: RagPlan): DatasetName[] {
  return plan.retrieval_requests.map((request) => request.dataset);
}

/**
 * Run every prompt in the set. A throw is caught per prompt and recorded as a failure, so one bad
 * prompt cannot hide the nine behind it — a smoke run that stops at the first error tells the
 * owner nothing about the rest.
 */
export async function runSmoke(
  set: SmokeSet,
  deps: SmokeRunnerDeps,
  options: SmokeRunOptions = {},
): Promise<SmokeRun> {
  const results: SmokeResult[] = [];
  const observations: SmokeObservation[] = [];

  for (const prompt of set.prompts) {
    let observation: SmokeObservation;
    try {
      const { rawPlan } = await deps.planFor(prompt);
      const turn = await deps.runTurn(rawPlan);
      observation = {
        promptId: prompt.id,
        planState: turn.probe.plan,
        ...(turn.probe.reason === undefined ? {} : { reason: turn.probe.reason }),
        requestedDatasets: datasetsOf(turn.plan),
        blocks: turn.probe.blocks,
        totalChars: turn.probe.total_chars,
        generationRequests: deps.requestsSpent(),
        evidenceText: turn.evidenceContext,
      };
    } catch (err) {
      results.push({
        promptId: prompt.id,
        verdict: "fail",
        notes: [`threw before an observation existed: ${err instanceof Error ? err.message : err}`],
      });
      continue;
    }

    observations.push(observation);
    results.push(evaluateObservation(prompt, observation, options));
  }

  return { results, observations, summary: summarizeSmoke(results) };
}
