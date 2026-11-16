// supabase/functions/_shared/pipeline/extract.ts
// Pipeline stage 1 — Context/State Extraction (sync, LLM-lite). §4.3 per-turn sync
// extraction contract. Runs in parallel with stage 2.
//
// FP-09 Step 2 moves the pure contract into extractContract.ts (the journal split):
// the prompt/schema/validator/sanitizer/stub registration are jest-loadable there, and
// this file holds only the adapter import. The onboarding block is requested only when
// the caller flags the turn; unflagged calls are byte-identical to the FP-08 baseline.
//
// P3 adds the retrieval plan to the same structured response (`rag_plan`), so planning costs no
// provider request (PLAN.md §3, §12.2). Both extensions are caller-flagged and default off.

import { generate, type AdapterResult } from "../llm/adapter.ts";
import type { GenerationBudget } from "../llm/budget.ts";
import { escapePromptText } from "../prompts/delimiters.ts";
import {
  buildExtractionSchema,
  buildExtractionSystem,
  isExtractionResult,
  type ExtractionResult,
} from "./extractContract.ts";

export type { ExtractionResult, IntentFlags } from "./extractContract.ts";
export { EXTRACTION_SCHEMA, isExtractionResult } from "./extractContract.ts";

export interface ExtractOptions {
  /** Ask the stage-1 contract for the optional onboarding block. */
  onboarding?: boolean;
  /** P3: ask the same response for the retrieval plan (`rag_planner_enabled`). */
  ragPlan?: boolean;
  /** P3: the turn's provider-request ledger (PLAN.md §12.1). */
  budget?: GenerationBudget;
}

/**
 * Stage 1. Returns the adapter result as-is; callers treat failure as non-fatal
 * (the fields are not consumed in FP-02, so a failed extraction must not block a reply).
 */
export async function extract(
  text: string,
  options: ExtractOptions = {},
): Promise<AdapterResult<ExtractionResult>> {
  const onboarding = options.onboarding === true;
  const ragPlan = options.ragPlan === true;
  return generate<ExtractionResult>({
    system: buildExtractionSystem(onboarding, ragPlan),
    messages: [{ role: "user", content: `<user_message>\n${escapePromptText(text)}\n</user_message>` }],
    schema: buildExtractionSchema(onboarding, ragPlan),
    validate: isExtractionResult,
    stubContext: ragPlan ? { onboarding, ragPlan } : { onboarding },
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  });
}
