// supabase/functions/_shared/metrics/propose.ts
// FP-07 Step 5 — the AI metric-proposal chain (TECH-SPEC §7.9.4, §4.1–4.3, §10.5).
//
// Refs: FP-07 FR-11, FR-12, FR-17; TECH-SPEC §7.9.4, §4.1–4.3, §10.5; decisions2 D9 /
//       TECH-SPEC D10, D13.
//
// Pure contract half at the top (schema, validators, prompt, stub shapes, state machine with an
// injected generator); the adapter-bound `proposeMetric` at the bottom lazily imports the
// adapter and config. That split keeps the state table jest-loadable: importing the adapter at
// module scope reads `Deno.env` (the `evalContract.ts` / `eval.ts` precedent).
//
// The chain writes nothing. It is caller-less until items 9/10 wire the acceptance flows; row
// creation is theirs. Worst case for a gate failure is three generate calls: propose →
// corrected → described. A parse/validation failure consumes the corrected attempt (the §4.2
// one-bounded-retry shape), so the call bound stays at three. `tactical_analysis` is logged
// server-side only and is never returned in the outcome.

import { registerStubShape } from "../llm/stubShapes.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import { validateFormula, type FormulaBounds, type FormulaError } from "./formula.ts";
import { parseFormulaBounds } from "./create.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

// ============================================================================
// Domains — canonical 16 (GLOSSARY §14) plus General
// ============================================================================

export const CANONICAL_METRIC_DOMAINS = [
  "Career",
  "Finance",
  "Fitness",
  "Health",
  "Learning",
  "Creativity",
  "Relationships",
  "Family",
  "Social",
  "Mental/Emotional",
  "Spirituality",
  "Discipline/Habits",
  "Communication",
  "Environment/Home",
  "Recreation",
  "Purpose/Legacy",
] as const;

export const PROPOSAL_DOMAINS = [...CANONICAL_METRIC_DOMAINS, "General"] as const;
export type ProposalDomain = (typeof PROPOSAL_DOMAINS)[number];

export function isProposalDomain(value: unknown): value is ProposalDomain {
  return typeof value === "string" && (PROPOSAL_DOMAINS as readonly string[]).includes(value);
}

// ============================================================================
// Contract: structured proposal
// ============================================================================

export interface MetricProposal {
  tactical_analysis: string;
  name: string;
  domain: string;
  formula: Record<string, unknown>;
  output_unit: string;
  rationale: string;
}

export const METRIC_PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tactical_analysis: {
      type: "string",
      description: "Internal reasoning. Never shown to the person.",
    },
    name: { type: "string", description: "Metric name, 1–80 characters." },
    domain: { type: "string", enum: [...PROPOSAL_DOMAINS] },
    formula: {
      type: "object",
      description: "One JSONLogic object over the eight whitelisted variables.",
    },
    output_unit: { type: "string", description: "Short unit shown beside the value, ≤ 16 characters." },
    rationale: { type: "string", description: "Why this metric matters, ≤ 200 characters." },
  },
  required: ["tactical_analysis", "name", "domain", "formula", "output_unit", "rationale"],
  additionalProperties: false,
};

export function isMetricProposal(parsed: unknown): parsed is MetricProposal {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const o = parsed as Record<string, unknown>;
  if (typeof o.tactical_analysis !== "string") return false;
  if (typeof o.name !== "string" || o.name.trim().length === 0 || o.name.length > 80) return false;
  if (!isProposalDomain(o.domain)) return false;
  if (typeof o.formula !== "object" || o.formula === null || Array.isArray(o.formula)) return false;
  if (typeof o.output_unit !== "string" || o.output_unit.length > 16) return false;
  if (typeof o.rationale !== "string" || o.rationale.length > 200) return false;
  return true;
}

// ============================================================================
// Contract: described fallback
// ============================================================================

export interface DescribedMetric {
  name: string;
  domain: string;
  description: string;
}

export const DESCRIBED_METRIC_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string", description: "Metric name, 1–80 characters." },
    domain: { type: "string", enum: [...PROPOSAL_DOMAINS] },
    description: { type: "string", description: "How to measure it manually, ≤ 500 characters." },
  },
  required: ["name", "domain", "description"],
  additionalProperties: false,
};

export function isDescribedMetric(parsed: unknown): parsed is DescribedMetric {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const o = parsed as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.trim().length === 0 || o.name.length > 80) return false;
  if (!isProposalDomain(o.domain)) return false;
  if (typeof o.description !== "string" || o.description.trim().length === 0) return false;
  if (o.description.length > 500) return false;
  return true;
}

// ============================================================================
// Stub shapes — registered in the same commit as their validators
// ============================================================================

export const METRIC_PROPOSAL_STUB: MetricProposal = {
  tactical_analysis:
    "STUB: Momentum is the simplest honest first metric — it counts the doings the person already logs and needs no derived quantity.",
  name: "Momentum",
  domain: "Discipline/Habits",
  formula: { var: "doings_count" },
  output_unit: "doings",
  rationale: "Counts the actions you logged; a simple signal that you kept moving.",
};

export const DESCRIBED_METRIC_STUB: DescribedMetric = {
  name: "Consistency",
  domain: "General",
  description: "Rate each day from 1 to 5 on whether you kept the commitments you set for yourself.",
};

registerStubShape(isMetricProposal, METRIC_PROPOSAL_STUB);
registerStubShape(isDescribedMetric, DESCRIBED_METRIC_STUB);

// ============================================================================
// Prompt
// ============================================================================

/** Variables and their zero-data semantics — the model needs both to choose a safe formula. */
export const PROPOSAL_VARIABLE_DOCS = `The eight variables, one value per local day:
- doings_count — number of doings logged (check-in replies, chat, app, quick actions).
- hours_logged — distinct check-in windows answered × cadence ÷ 60. A day with no check-in replies is 0.
- checkin_compliance_rate — answered check-in windows ÷ expected windows, 0–1. Zero expected windows (e.g. a rest day) is 0.
- energy_avg — average non-null energy across all doings, 1–10. A day with no energized doings is 0 (zero-data, not "exhausted").
- impulse_failures — count of impulse-failure rows.
- journal_positive_mentions — journal entries with severity S3.
- journal_negative_mentions — journal entries with severity S1 or S2.
- quest_completions — completed quest metrics whose deadline is that day.
Every key is present every day. A zero can mean a real zero or no source data; the evaluator logs which keys were zero-data. Prefer formulas that do not read "no data" as a bad day: guard energy_avg with doings_count, for example.`;

export function buildProposalSystem(bounds: FormulaBounds): string {
  return `You are an internal metric-design module for a life-coaching app. Your output is never
shown to the person. Propose one measurable daily metric for the requested life domain.
Answer exactly the schema.

${INJECTION_GUARD}

${PROPOSAL_VARIABLE_DOCS}

Hard rules:
- The formula must be a single JSONLogic object built only from these operators:
  ${["var", "+", "-", "*", "/", "%", ">", "<", ">=", "<=", "==", "!=", "if", "and", "or", "not", "min", "max"].join(", ")}.
- Every formula object has exactly one key, and that key is one of the operators above.
  The value of that key is the operator's argument (an array for most operators, or the
  bare variable name for "var"). Never add a second key, metadata, a wrapper object, or a
  top-level array. {"var":"doings_count"} is valid; so is {"+":[...]}. {"+":[...],"unit":"x"}
  and {} are invalid. Arrays appear only as an operator's operand list.
- A var operand must be a bare string naming one of the eight variables above. No dotted
  paths, no other names, no computed keys.
- Numeric literals must stay within ±${bounds.literal_abs_max}; tree depth ≤ ${bounds.max_depth};
  node count ≤ ${bounds.max_nodes}. Binary operators take exactly two operands; "if" takes a
  boolean condition and two same-typed branches; "not" takes one boolean; "and"/"or"/"min"/"max"
  take two or more operands. Numeric operators require numeric operands.
- domain must be one of: ${PROPOSAL_DOMAINS.join(", ")}.
- name is 1–80 characters. output_unit is at most 16 characters. rationale is at most 200
  characters and explains what the number means.
- Do not use Markdown, prose, or a wrapper around the JSON.

Worked example:
domain: Career
formula: {"*":[{"var":"hours_logged"},10]}
name: Focused Hours
output_unit: pts
rationale: "Ten points per logged hour makes focused time visible without rewarding busyness."

The formula is evaluated as-is. A formula that fails the gate is rejected and you get one
corrected attempt; a second failure falls back to a prose description.`;
}

export const DESCRIBED_SYSTEM = `You are an internal metric-design module for a life-coaching app.
The structured formula proposal could not be validated, so describe a metric the person can
track manually instead. Answer exactly the schema: name (1–80 characters), domain, and a
description of at most 500 characters explaining how to measure it. Do not include a formula.
domain must be one of: ${PROPOSAL_DOMAINS.join(", ")}.

${INJECTION_GUARD}`;

export interface ProposalInput {
  domain: ProposalDomain;
  /** Future user text, always wrapped in <user_message> per §10.5. */
  userText?: string | null;
}

export interface ProposalFeedback {
  kind: "gate" | "parse";
  errors?: FormulaError[];
  detail?: string;
}

export function formatGateErrors(errors: readonly FormulaError[]): string {
  return errors
    .map((e) => `- ${e.code} at ${e.path}: ${e.message}`)
    .join("\n");
}

export function buildProposalUserMessage(
  input: ProposalInput,
  feedback?: ProposalFeedback,
): string {
  const parts = [`Requested domain: ${input.domain}`];
  if (input.userText && input.userText.trim().length > 0) {
    parts.push(`<user_message>\n${input.userText}\n</user_message>`);
  }
  if (feedback) {
    if (feedback.kind === "gate") {
      parts.push(
        `The previous formula failed the deterministic gate:\n${formatGateErrors(
          feedback.errors ?? [],
        )}\nReturn one corrected JSON object.`,
      );
    } else {
      parts.push(
        `The previous output was not valid JSON or did not match the schema${
          feedback.detail ? ` (${feedback.detail})` : ""
        }. Return only the JSON object with the exact fields.`,
      );
    }
  }
  return parts.join("\n\n");
}

export function buildDescribedUserMessage(input: ProposalInput): string {
  const parts = [`Requested domain: ${input.domain}`];
  if (input.userText && input.userText.trim().length > 0) {
    parts.push(`<user_message>\n${input.userText}\n</user_message>`);
  }
  parts.push("The structured formula proposal could not be validated. Return a described metric.");
  return parts.join("\n\n");
}

// ============================================================================
// State machine
// ============================================================================

export type ProposeGenerate = <T>(request: GenerateRequest<T>) => Promise<AdapterResult<T>>;

export interface GateRejection {
  attempt: number;
  errors: FormulaError[];
}

export interface GateLog extends GateRejection {
  tag: "[metric-gate]";
}

export type ProposalOutcome =
  | {
    status: "validated";
    proposal: MetricProposal;
    attempts: number;
    adapterCalls: number;
    gateRejections: GateRejection[];
  }
  | {
    status: "described";
    description: DescribedMetric;
    attempt: number;
    adapterCalls: number;
    gateRejections: GateRejection[];
    reason: "gate" | "parse";
  }
  | {
    status: "error";
    attempts: number;
    adapterCalls: number;
    gateRejections: GateRejection[];
    error: string;
  };

export interface ProposeOptions {
  bounds: FormulaBounds;
  /** Dev-only, honored only when `devOverridesEnabled` is true. */
  forceGateFail?: boolean;
  devOverridesEnabled?: boolean;
  /** One [metric-gate] line per rejection; injectable for the unit table. */
  warn?: (entry: GateLog) => void;
  /** tactical_analysis is server-only; the impure caller logs it here. */
  onTacticalAnalysis?: (text: string) => void;
}

function defaultGateWarn(entry: GateLog): void {
  console.warn(
    JSON.stringify({
      tag: entry.tag,
      attempt: entry.attempt,
      errors: entry.errors,
    }),
  );
}

function proposalRequest(
  input: ProposalInput,
  bounds: FormulaBounds,
  feedback?: ProposalFeedback,
): GenerateRequest<MetricProposal> {
  return {
    system: buildProposalSystem(bounds),
    messages: [{ role: "user", content: buildProposalUserMessage(input, feedback) }],
    schema: METRIC_PROPOSAL_SCHEMA,
    validate: isMetricProposal,
    maxTokens: 1024,
  };
}

function describedRequest(input: ProposalInput): GenerateRequest<DescribedMetric> {
  return {
    system: DESCRIBED_SYSTEM,
    messages: [{ role: "user", content: buildDescribedUserMessage(input) }],
    schema: DESCRIBED_METRIC_SCHEMA,
    validate: isDescribedMetric,
    maxTokens: 512,
  };
}

/** Dev force: replace the model's formula with a deliberately invalid tree after validation. */
function forceInvalidFormula(proposal: MetricProposal): MetricProposal {
  return {
    ...proposal,
    formula: { reduce: [{ var: "doings_count" }, 0] },
  };
}

/**
 * The bounded chain. One proposal call; on gate/parse failure one corrected call; on a second
 * failure the described fallback. The generator is injected so the state table is unit-tested
 * without the adapter or Deno env.
 */
export async function proposeWith(
  gen: ProposeGenerate,
  input: ProposalInput,
  opts: ProposeOptions,
): Promise<ProposalOutcome> {
  const warn = opts.warn ?? defaultGateWarn;
  const gateRejections: GateRejection[] = [];
  let adapterCalls = 0;
  let feedback: ProposalFeedback | undefined;
  let lastFailure: "gate" | "parse" | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result: AdapterResult<MetricProposal>;
    try {
      adapterCalls += 1;
      result = await gen(proposalRequest(input, opts.bounds, feedback));
    } catch (error) {
      return {
        status: "error",
        attempts: attempt,
        adapterCalls,
        gateRejections,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!result.ok || !result.data) {
      if (result.kind === "transport") {
        return {
          status: "error",
          attempts: attempt,
          adapterCalls,
          gateRejections,
          error: result.error ?? "proposal transport failure",
        };
      }
      lastFailure = "parse";
      feedback = { kind: "parse", detail: result.error };
      continue;
    }

    let proposal = result.data;
    if (opts.forceGateFail && opts.devOverridesEnabled) {
      proposal = forceInvalidFormula(proposal);
    }
    opts.onTacticalAnalysis?.(proposal.tactical_analysis);

    const gate = validateFormula(proposal.formula, opts.bounds);
    if (gate.ok) {
      return {
        status: "validated",
        proposal,
        attempts: attempt,
        adapterCalls,
        gateRejections,
      };
    }

    const rejection: GateRejection = { attempt, errors: gate.errors };
    gateRejections.push(rejection);
    warn({ tag: "[metric-gate]", ...rejection });
    lastFailure = "gate";
    feedback = { kind: "gate", errors: gate.errors };
  }

  // The corrected re-output also failed. Fall back to the described contract (third call).
  adapterCalls += 1;
  let described: AdapterResult<DescribedMetric>;
  try {
    described = await gen(describedRequest(input));
  } catch (error) {
    return {
      status: "error",
      attempts: 2,
      adapterCalls,
      gateRejections,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!described.ok || !described.data) {
    return {
      status: "error",
      attempts: 2,
      adapterCalls,
      gateRejections,
      error: described.error ?? "described fallback failed",
    };
  }

  // A described fallback is only reached after a failed proposal; lastFailure is set.
  return {
    status: "described",
    description: described.data,
    attempt: 2,
    adapterCalls,
    gateRejections,
    reason: lastFailure === "parse" ? "parse" : "gate",
  };
}

// ============================================================================
// Adapter-bound half
// ============================================================================

export interface ProposeMetricOptions {
  forceGateFail?: boolean;
}

/** The public shape strips the server-only reasoning before any caller can serialize it. */
export type PublicMetricProposal = Omit<MetricProposal, "tactical_analysis">;

export type PublicProposalOutcome =
  | {
    status: "validated";
    proposal: PublicMetricProposal;
    attempts: number;
    adapterCalls: number;
    gateRejections: GateRejection[];
  }
  | {
    status: "described";
    description: DescribedMetric;
    attempt: number;
    adapterCalls: number;
    gateRejections: GateRejection[];
    reason: "gate" | "parse";
  }
  | {
    status: "error";
    attempts: number;
    adapterCalls: number;
    gateRejections: GateRejection[];
    error: string;
  };

function publicOutcome(outcome: ProposalOutcome): PublicProposalOutcome {
  if (outcome.status !== "validated") return outcome;
  const { tactical_analysis, ...proposal } = outcome.proposal;
  void tactical_analysis;
  return { ...outcome, proposal };
}

/**
 * Run the real chain. Reads bounds and the dev gate from config at the call site; the module
 * writes nothing to the database on any path.
 */
export async function proposeMetric(
  input: ProposalInput,
  options: ProposeMetricOptions = {},
): Promise<PublicProposalOutcome> {
  if (!isProposalDomain(input.domain)) {
    return {
      status: "error",
      attempts: 0,
      adapterCalls: 0,
      gateRejections: [],
      error: `domain "${String(input.domain)}" is not canonical`,
    };
  }

  const { getConfig, getConfigBoolean } = await import("../config.ts");
  const bounds = parseFormulaBounds(await getConfig("metric_formula_bounds"));
  if (!bounds) {
    return {
      status: "error",
      attempts: 0,
      adapterCalls: 0,
      gateRejections: [],
      error: "config.metric_formula_bounds is missing or malformed",
    };
  }

  let devOverridesEnabled = false;
  try {
    devOverridesEnabled = await getConfigBoolean("dev_overrides_enabled");
  } catch {
    devOverridesEnabled = false;
  }

  const { generate } = await import("../llm/adapter.ts");
  const outcome = await proposeWith(
    (request) => generate(request),
    { domain: input.domain, userText: input.userText ?? null },
    {
      bounds,
      forceGateFail: options.forceGateFail === true,
      devOverridesEnabled,
      onTacticalAnalysis: (text) => {
        // Internal reasoning: server-side log only, never returned or persisted. A separate
        // tag keeps the one-summary-line-per-run contract below.
        console.log(`[metric-tactical] ${text}`);
      },
    },
  );

  const attempts = outcome.status === "described" ? outcome.attempt : outcome.attempts;
  console.log(
    `[metric-propose] attempts=${attempts} outcome=${outcome.status} ` +
      `adapter_calls=${outcome.adapterCalls} gate_rejections=${outcome.gateRejections.length}`,
  );
  return publicOutcome(outcome);
}
