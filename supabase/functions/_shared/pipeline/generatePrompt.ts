// supabase/functions/_shared/pipeline/generatePrompt.ts
// FP-09 Step 3 — the pure stage-5 prompt builder, split out so Jest can pin both branches
// without loading the Deno-only provider adapter.
//
// Refs: FP-09 FR-4, AC-2; TECH-SPEC §4.2, §5.1, §7.7; D17.
//
// This module is pure: no adapter, no config, no client, no clock. `generate.ts` owns the
// provider call and the bounded structural retry; this file owns only the deterministic
// system prompt.

import {
  FEW_SHOT_EXEMPLARS,
  GENERATION_SCHEMA,
  INJECTION_GUARD,
  PERSONA_DEFINITION,
  PERSONA_VOICE,
  ROUTE_VARIANTS,
} from "../prompts/guardrails.ts";
import { buildPlannerSchema } from "../rag/planner.ts";
import type { GenerationBudget } from "../llm/budget.ts";
import type { Route } from "./persona.ts";
import type { RetrievedRule } from "../types/pipeline.ts";
import { escapePromptText } from "../prompts/delimiters.ts";
import { withMemoryContext } from "./memoryContext.ts";

export interface GenerateStageInput {
  route: Route;
  /** Persona assigned by stage 4 (authoritative — the model's own choice is advisory). */
  persona: string;
  domain: string;
  rules: RetrievedRule[];
  userText: string;
  /** Optional day-plan context (FP-05 Step 6). When present, appended to system prompt. */
  dayPlanContext?: string;
  /**
   * Optional recalled-memory block (FP-06 Step 5). When present, appended after every
   * other part; when absent the prompt is byte-identical to FP-05 (gated, not reformatted).
   */
  memoryContext?: string;
  /**
   * Optional immediate context (last sliding_window_messages messages, TECH-SPEC §7.6).
   * When present, prepended before the current user message inside delimiters.
   */
  recentContext?: string;
  /**
   * Optional FP-08 Step 4 lockdown rider (FR-7): the confrontation instruction, the logged
   * evidence and the delimited claim. When present, appended after the day-plan context;
   * absent on OPEN turns, whose prompts stay byte-identical.
   */
  lockdownContext?: string;
  /**
   * FP-09 Step 3: the onboarding interview is structurally rule-free. When true the
   * rules block is omitted entirely — not even the "none retrieved" line — because the
   * interview asks, it does not preach.
   */
  omitRules?: boolean;
  /**
   * FP-09 Step 3: the internal stage instruction (question N, transition, metric
   * proposal). Appended after the day-plan rider and before memory; absent on every
   * non-interview turn, so those prompts stay byte-identical.
   */
  interviewContext?: string;
  /**
   * Dev-only stub seam (FP-08 Step 7): read by the adapter **only** in stub mode and only
   * when `dev_overrides_enabled` is true. Never part of a provider request.
   */
  stubContext?: unknown;
  /**
   * P3: the rendered evidence bundle (`rag/evidencePrompt.ts`). PRD §8.1 puts the evidence
   * bundle at position 7, after the persona riders and before the response-format requirement.
   * Absent on every non-planner turn, so those prompts stay byte-identical.
   */
  evidenceContext?: string;
  /**
   * P3 (PRD §7.6, PLAN.md §12.2): offer the one optional refinement round. Set only when the
   * planner is on **and** the ledger can still pay for a second answer, so the field is absent
   * from the schema — and the instruction from the prompt — on every turn that could not use it.
   */
  allowRefinement?: boolean;
  /** `config.rag_max_plan_requests`, applied to `refinement_request` as well as the plan. */
  maxRefinementRequests?: number;
  /**
   * P3 (PLAN.md §12.1): the turn's provider-request ledger. Absent on every non-planner turn,
   * which is what keeps their provider requests and their prompt byte-identical.
   */
  budget?: GenerationBudget;
}

function renderRules(rules: RetrievedRule[]): string {
  if (rules.length === 0) {
    return "Relevant coaching rules: none retrieved for this turn. Rely on the persona and the person's own words.";
  }
  // AC-11: a malicious rule batch renders as literal quoted content; it cannot close a
  // prompt delimiter or open a structural tag.
  const lines = rules.map((r) => `- [${r.tone}] ${escapePromptText(r.text)}`).join("\n");
  return `Relevant coaching rules (use the ones that fit this turn; never quote them verbatim, never mention "rules"):\n${lines}`;
}

function renderExemplars(): string {
  const blocks = FEW_SHOT_EXEMPLARS.map(
    (e, i) => `Example ${i + 1} — ${e.scenario}\nBAD: ${e.bad}\nGOOD: ${e.good}`,
  ).join("\n\n");
  return `Study these examples of the register you must write in:\n\n${blocks}`;
}

/**
 * PRD §7.6 and PLAN.md §12.2: the one optional additional round. The sentence is the only place
 * the model learns the field exists, so it is gated on `allowRefinement` exactly like the schema
 * property — a turn that cannot pay for a second answer is never told the option exists.
 */
export const REFINEMENT_INSTRUCTION =
  "If the evidence above cannot settle one specific part of the question, you may add " +
  "refinement_request: an array of retrieval requests in the same shape as the retrieval plan. " +
  "Ask only when a narrower or missing dataset would resolve the gap, and still answer as fully " +
  "as the current evidence allows. Otherwise omit the field entirely.";

/**
 * P3 — the §4.2 generation contract with the optional refinement field (PLAN.md §12.2).
 *
 * Without `allowRefinement` this returns `GENERATION_SCHEMA` **by identity**, so every
 * non-planner turn and every planner turn that cannot afford a second answer sends exactly the
 * pre-P3 schema. The refinement items are the planner's own request items, generated from the
 * registry, so the two contracts cannot drift apart.
 */
export function buildGenerationSchema(
  options: { allowRefinement?: boolean; maxRequests?: number } = {},
): Record<string, unknown> {
  if (!options.allowRefinement) return GENERATION_SCHEMA;

  const planner = buildPlannerSchema(
    options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests },
  );
  const requests = (planner.properties as Record<string, Record<string, unknown>>)
    .retrieval_requests;

  return {
    ...GENERATION_SCHEMA,
    properties: {
      ...(GENERATION_SCHEMA.properties as Record<string, unknown>),
      refinement_request: {
        type: "array",
        description:
          "Optional. One additional retrieval round, only for a specific gap the evidence above " +
          "cannot settle. Omit when the evidence is sufficient or the gap is not retrievable.",
        ...(requests.maxItems === undefined ? {} : { maxItems: requests.maxItems }),
        items: requests.items,
      },
    },
  };
}

export function buildSystemPrompt(input: GenerateStageInput): string {
  const parts = [
    PERSONA_DEFINITION,
    INJECTION_GUARD,
    ROUTE_VARIANTS[input.route],
    `Persona for this turn: ${input.persona}. ${PERSONA_VOICE[input.persona] ?? ""}`.trim(),
    `Life domain context: ${input.domain}.`,
    // FP-09 Step 3: the interview prompt has no rules block at all. The un-flagged path
    // keeps the exact FP-08 shape (`renderRules` always ran, even for an empty array).
    ...(input.omitRules ? [] : [renderRules(input.rules)]),
    renderExemplars(),
  ];
  // P3: PRD §8.1 item 7 — the evidence bundle sits after the persona riders and before the
  // response-format requirement. Only a planner turn passes it, so every other prompt keeps
  // its exact pre-P3 shape.
  if (input.evidenceContext) {
    parts.push(input.evidenceContext);
  }
  // P3: the refinement offer sits with the evidence it is about, and only when the ledger can
  // pay for the second answer (PLAN.md §12.2). Absent on every other turn.
  if (input.allowRefinement) {
    parts.push(REFINEMENT_INSTRUCTION);
  }
  parts.push(
    `You must return ONLY a JSON object matching the required schema: ` +
      `tactical_analysis (your private reasoning), direct_quote (what the person reads), ` +
      `persona (the persona key you used)` +
      (input.route === "options"
        ? `, and ui_metadata.persona_options (2–3 options).`
        : `. Do not include ui_metadata.persona_options.`),
  );
  // FP-05 Step 6: append day-plan context when present (gated, not reformatted)
  if (input.dayPlanContext) {
    parts.push(input.dayPlanContext);
  }
  // FP-09 Step 3: the interview instruction rides after the day-plan rider and before
  // memory. Only an onboarding turn passes it, so every other prompt is unchanged.
  if (input.interviewContext) {
    parts.push(input.interviewContext);
  }
  // FP-08 Step 4: the lockdown rider is the last system block before memory; only a LOCKDOWN
  // turn ever passes it, so OPEN prompts keep their exact FP-06 shape.
  if (input.lockdownContext) {
    parts.push(input.lockdownContext);
  }
  // FP-06 Step 5: recalled memory rides last; `undefined` returns the base by identity, so
  // a no-facts or kill-switched turn is the exact FP-05 prompt.
  return withMemoryContext(parts.filter(Boolean).join("\n\n"), input.memoryContext);
}
