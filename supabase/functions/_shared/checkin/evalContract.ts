// supabase/functions/_shared/checkin/evalContract.ts
// FP-04 Step 3a — the check-in evaluation contract (TECH-SPEC §7.1 step 2, §4.3 family).
//
// Refs: FP-04 FR-12; TECH-SPEC §7.1, §4.1, §4.2, §4.3; D9.
//
// This is the **pure** half: the schema, the validator, the stub registration, the prompt
// builder, and the fail-open combinator. The impure binder (`evaluateDoing`, which holds the
// adapter import and the one `dev_overrides_enabled` read) lives in `eval.ts`, because importing
// `_shared/llm/adapter.ts` reads `Deno.env` at module load and jest cannot load it — the same
// split as `bands.ts`/`persona.ts` and `classify.ts`/`classifyReal.ts`.
//
// Fail-open is the whole point of the contract (§7.1, FR-12): the doing is already ingested by
// the time the eval runs, so nothing here may ever throw or hold a reply. Every failure path
// ends at `failOpen()` plus one structured warning.

import { registerStubShape } from "../llm/stubShapes.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

// ============================================================================
// Contract
// ============================================================================

/** §7.1 / FR-12 — the frozen eval pair. Two booleans and nothing else. */
export interface EvalResult {
  deviation: boolean;
  intervention: boolean;
}

/** The two-branch JSON Schema handed to the provider as the per-call §4.3-family contract. */
export const EVAL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    deviation: {
      type: "boolean",
      description: "True only when the doing conflicts with or drifts from today's plan anchors.",
    },
    intervention: {
      type: "boolean",
      description: "True only when the deviation warrants Davos speaking up now. False when in doubt.",
    },
  },
  required: ["deviation", "intervention"],
  additionalProperties: false,
};

/** Structural validator for the parsed eval response (the `isExtractionResult` pattern). */
export function isEvalResult(parsed: unknown): parsed is EvalResult {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  return typeof o.deviation === "boolean" && typeof o.intervention === "boolean";
}

/**
 * Stub-mode canned answer (§4.1 dispatch): on-track, so `llm_stub_mode=true` exercises the eval
 * path without materializing an intervention turn on every check-in. A drill forces one through
 * `dev_force.eval_intervention` (Step 3b).
 */
export const EVAL_STUB_RESULT: EvalResult = { deviation: false, intervention: false };

// Register at import, so the adapter dispatches this shape instead of asserting the §4.2 one.
registerStubShape(isEvalResult, EVAL_STUB_RESULT);

/** The canonical fail-open answer (§7.1): no deviation, no intervention; the caller carries on. */
export function failOpen(): EvalResult {
  return { deviation: false, intervention: false };
}

// ============================================================================
// Input
// ============================================================================

/**
 * One §3.4 `anchor_plans.anchors` entry. `anchor_plans` is empty until the journal FP, so this
 * is forward-compatible by construction — only `label` is needed to render a line.
 */
export interface EvalAnchor {
  label: string;
  start?: string;
  end?: string;
  kind?: string;
}

/** Everything the eval call needs about the turn: the doing text, its energy, today's anchors. */
export interface EvalInput {
  text: string;
  energy: number | null;
  anchors: readonly EvalAnchor[];
}

/** The structured fail-open warning. Carries no user text — only why the eval gave up. */
export interface EvalWarn {
  tag: string;
  reason: "transport" | "parse" | "validation" | "thrown" | "unknown";
  error?: string;
}

export const EVAL_LOG_TAG = "[checkin-eval]";

/** Dev-only drill flag (gated by `dev_overrides_enabled`, re-checked by `eval.ts`). */
export interface EvalOptions {
  forceIntervention?: boolean;
  /** Resolved by `eval.ts` from config; keeps this module pure and the gate unit-testable. */
  devOverridesEnabled?: boolean;
  /** One warning per fail-open; injectable so tests assert it without a console spy. */
  warn?: (entry: EvalWarn) => void;
}

/** The provider call, injected so the pure combinator is unit-testable. */
export type EvalGenerate = <T>(request: GenerateRequest<T>) => Promise<AdapterResult<T>>;

// ============================================================================
// Prompt
// ============================================================================

export const EVAL_SYSTEM = `You are an internal analysis module for a life-coaching app. Your output is never
shown to the person. Compare the doing they just logged against the plan anchors they set for
today, then answer exactly the schema.

${INJECTION_GUARD}

deviation — true only when the doing clearly conflicts with, or drifts away from, the
person's stated plan or goal for today: a different task, an avoidance move, an unplanned
detour. A doing that is merely *not on* the plan is not a deviation.

intervention — true only when the deviation is worth Davos speaking up about right now: the
person is off-track in a way that will cost them, or they are pushing on while clearly
drained. When in doubt answer false — a missed intervention costs nothing; a false one
interrupts a person who did nothing wrong.`;

/**
 * Render today's anchors for the prompt. Empty is a normal state (the journal FP is what
 * populates `anchor_plans`), so it reads as a fact rather than an error.
 */
export function formatAnchorBlock(anchors: readonly EvalAnchor[]): string {
  if (anchors.length === 0) return "Today's plan anchors: none saved yet.";
  const lines = anchors.map((a) => {
    const when = a.start && a.end ? `${a.start}-${a.end} ` : "";
    const kind = a.kind ? ` (${a.kind})` : "";
    return `- ${when}${a.label}${kind}`;
  });
  return `Today's plan anchors:\n${lines.join("\n")}`;
}

/** The user turn: the person's words inside the injection guard's tags, then the context. */
export function buildEvalUserMessage(input: EvalInput): string {
  const energy = input.energy === null ? "not reported" : `${input.energy}/10`;
  return (
    `<user_message>\n${input.text}\n</user_message>\n\n` +
    `Energy: ${energy}\n${formatAnchorBlock(input.anchors)}`
  );
}

// ============================================================================
// The call
// ============================================================================

function defaultWarn(entry: EvalWarn): void {
  // Structured line only — never the user's text (the fail-open warning is diagnostic).
  console.warn(JSON.stringify(entry));
}

/**
 * Run the eval and always resolve to an `EvalResult`; never throw (§7.1, FR-12).
 *
 * Bounded retry (§4.2): exactly one extra attempt, and only for a *structural* failure. A
 * transport failure already means both provider tiers failed inside the adapter (§4.1), so
 * another round trip would only push the invocation toward the 150 s limit — fail open at once.
 */
export async function evaluateWith(
  gen: EvalGenerate,
  input: EvalInput,
  opts: EvalOptions = {},
): Promise<EvalResult> {
  const warn = opts.warn ?? defaultWarn;

  // Dev drill: short-circuit before any provider call. The caller resolves the config flag; a
  // drill flag with dev overrides off is ignored, not an error (the §5.3 / §7.10 precedent).
  if (opts.forceIntervention && opts.devOverridesEnabled) {
    return { deviation: false, intervention: true };
  }

  const request: GenerateRequest<EvalResult> = {
    system: EVAL_SYSTEM,
    messages: [{ role: "user", content: buildEvalUserMessage(input) }],
    schema: EVAL_SCHEMA,
    validate: isEvalResult,
  };

  let last: AdapterResult<EvalResult> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: AdapterResult<EvalResult>;
    try {
      result = await gen(request);
    } catch (err) {
      // The adapter can throw before reaching a provider (a missing config key makes
      // `getConfigNumber` throw). The doing is already stored: fail open, never propagate.
      warn({
        tag: EVAL_LOG_TAG,
        reason: "thrown",
        error: err instanceof Error ? err.message : String(err),
      });
      return failOpen();
    }
    if (result.ok && result.data) return result.data;
    last = result;
    if (result.kind === "transport") break;
  }

  warn({ tag: EVAL_LOG_TAG, reason: last?.kind ?? "unknown", error: last?.error });
  return failOpen();
}
