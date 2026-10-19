// supabase/functions/_shared/journal/anchor.ts
// FP-05 Step 5 — adapter-bound entry for anchor plan generation (TECH-SPEC §4.1, §7.2).
// Refs: FP-05 FR-9, FR-10, FR-11, FR-16; TECH-SPEC §4.1, §7.2.
// Impure (loads Deno.env via adapter): cannot be the module under test. The pure half is anchorContract.ts.

import { generate } from "../llm/adapter.ts";
import { anchorPlanWith, type AnchorPlanResult, type AnchorPlanInput } from "./anchorContract.ts";

/** Generate an anchor plan — the function the handler and dev-smoke both call. */
export async function generateAnchorPlan(input: AnchorPlanInput): Promise<AnchorPlanResult> {
  return anchorPlanWith(generate, input);
}