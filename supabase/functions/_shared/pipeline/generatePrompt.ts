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
  INJECTION_GUARD,
  PERSONA_DEFINITION,
  PERSONA_VOICE,
  ROUTE_VARIANTS,
} from "../prompts/guardrails.ts";
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
  return `Study these examples of the register you must write in (PLACEHOLDER-DEV exemplars):\n\n${blocks}`;
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
    `You must return ONLY a JSON object matching the required schema: ` +
      `tactical_analysis (your private reasoning), direct_quote (what the person reads), ` +
      `persona (the persona key you used)` +
      (input.route === "options"
        ? `, and ui_metadata.persona_options (2–3 options).`
        : `. Do not include ui_metadata.persona_options.`),
  ];
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
