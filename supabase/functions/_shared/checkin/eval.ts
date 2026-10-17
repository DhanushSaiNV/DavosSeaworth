// supabase/functions/_shared/checkin/eval.ts
// FP-04 Step 3a — the check-in evaluation call (§7.1 step 2, FR-12).
//
// Refs: FP-04 FR-12; TECH-SPEC §7.1, §4.1, §4.2, §4.3; D9.
//
// The pure contract (`EVAL_SCHEMA`, `isEvalResult`, `evaluateWith`, the stub registration) lives
// in `evalContract.ts` so jest can load it. This module is the thin impure binder — the adapter
// import and the one `dev_overrides_enabled` read are why it cannot be the module under test
// (the `bands.ts` / `persona.ts` split, for the same reason).

import { getConfig } from "../config.ts";
import { generate } from "../llm/adapter.ts";
import { evaluateWith, type EvalInput, type EvalResult } from "./evalContract.ts";

export type { EvalAnchor, EvalInput, EvalResult } from "./evalContract.ts";

/** Dev-only drill flag; the caller reads it from the request body (Step 3b). */
export interface EvalDevOptions {
  forceIntervention?: boolean;
}

/**
 * §7.1 step 2: compare a just-ingested doing against today's anchors. **Fail-open** — the doing
 * is already stored, so an eval problem must never turn a valid check-in into a 500.
 */
export async function evaluateDoing(
  input: EvalInput,
  dev: EvalDevOptions = {},
): Promise<EvalResult> {
  // Re-check the flag server-side: the client gate is convenience, not enforcement (§5.3,
  // §7.10). Fail-closed — only a real JSON `true` enables the drill, so a missing or mistyped
  // config row leaves it off (the `send-message` precedent). Skip the read entirely when the
  // caller sent no flag.
  const devOverridesEnabled = dev.forceIntervention
    ? (await getConfig("dev_overrides_enabled")) === true
    : false;

  return evaluateWith(generate, input, {
    forceIntervention: dev.forceIntervention,
    devOverridesEnabled,
  });
}
