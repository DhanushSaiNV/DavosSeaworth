// supabase/functions/_shared/llm/errors.ts
// FP-02 Step 8 — typed adapter failure, so a caller can tell a *transport* failure
// (provider unreachable, over budget, timed out — worth retrying later) from a
// *structural* one (the model answered, but not in the anchored shape).
//
// The two get different treatment:
//   * transport  → TECH-SPECS §4.1 sync degrade: holding reply (`sync_degrade_reply`)
//                  + `llm_retry` job, then the real reply on the fallback provider.
//   * structural → TECH-SPECS §4.2: one bounded retry, then `malformed_fallback_reply`.
//                  A retry job cannot fix an off-contract model, so none is enqueued.
//
// Refs: FP-02 FR-3, FR-4; TECH-SPECS §4.1–4.2, §2.3.

import type { Route } from "../pipeline/persona.ts";

export type FailureKind = "transport" | "parse" | "validation";

/** The pipeline's resolved routing decision, carried out of a failed run (§5.1). */
export interface PipelineContext {
  route: Route;
  persona: string;
  domain: string;
  overallConf: number;
  ruleIds: string[];
}

/**
 * Every provider is unavailable (or the synchronous budget ran out).
 *
 * Thrown by the generation stage, and by `runPipeline` when the message embed fails —
 * in both cases the caller degrades synchronously instead of returning 500 and leaving
 * the turn unanswered. `context` carries the stage-1–4 decision so the `llm_retry` job
 * can re-run stages 3–5 without re-extracting (§4.1, §2.3).
 */
export class ProvidersUnavailableError extends Error {
  readonly kind: FailureKind;
  readonly context?: PipelineContext;

  constructor(message: string, options?: { kind?: FailureKind; context?: PipelineContext }) {
    super(message);
    this.name = "ProvidersUnavailableError";
    this.kind = options?.kind ?? "transport";
    this.context = options?.context;
  }
}

export function isProvidersUnavailable(err: unknown): err is ProvidersUnavailableError {
  return err instanceof ProvidersUnavailableError;
}

/**
 * Did the adapter fail for a reason a later retry could plausibly fix? A transport
 * failure anywhere counts: at least one provider was unreachable or over budget, so
 * the next attempt has a real chance. A purely structural failure means the models are
 * answering but off-contract, which retrying cannot fix (§4.2).
 */
export function needsRetry(kind: FailureKind | undefined): boolean {
  return kind === "transport";
}
