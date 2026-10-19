// supabase/functions/_shared/pipeline/generate.ts
// Pipeline stage 5 — Final Response Generation (§4.2 anchored JSON contract).
//
// Builds the system prompt from the route + surviving rules, calls the provider adapter,
// and applies *exactly one* bounded retry on a structural failure before degrading to
// config.malformed_fallback_reply. No loops, no regex post-processing (AGENTS.md §5.1–5.2).

import { generate, type GenerateResponse } from "../llm/adapter.ts";
import { ProvidersUnavailableError } from "../llm/errors.ts";
import { getConfig } from "../config.ts";
import {
  FEW_SHOT_EXEMPLARS,
  GENERATION_SCHEMA,
  INJECTION_GUARD,
  PERSONA_DEFINITION,
  PERSONA_VOICE,
  ROUTE_VARIANTS,
} from "../prompts/guardrails.ts";
import type { Route } from "./persona.ts";
import type { RetrievedRule } from "../types/pipeline.ts";

export interface GenerateStageInput {
  route: Route;
  /** Persona assigned by stage 4 (authoritative — the model's own choice is advisory). */
  persona: string;
  domain: string;
  rules: RetrievedRule[];
  userText: string;
  /** Optional day-plan context (FP-05 Step 6). When present, appended to system prompt. */
  dayPlanContext?: string;
}

export interface PersonaOption {
  key: string;
  label: string;
  one_liner: string;
}

export interface GenerateStageResult {
  directQuote: string;
  uiMetadata?: { persona_options?: PersonaOption[] };
  tacticalAnalysis: string;
  persona: string;
  /** The persona key the model returned (advisory; may differ from the assigned one). */
  modelPersona: string | null;
  provider: "gemini" | "groq" | "stub";
  latencyMs: number;
  /** Provider attempts made (1 = first try succeeded, 2 = the single bounded retry ran). */
  attempts: number;
  /** True when both attempts failed and the malformed fallback reply was used. */
  degraded: boolean;
}

function renderRules(rules: RetrievedRule[]): string {
  if (rules.length === 0) {
    return "Relevant coaching rules: none retrieved for this turn. Rely on the persona and the person's own words.";
  }
  const lines = rules.map((r) => `- [${r.tone}] ${r.text}`).join("\n");
  return `Relevant coaching rules (use the ones that fit this turn; never quote them verbatim, never mention "rules"):\n${lines}`;
}

function renderExemplars(): string {
  const blocks = FEW_SHOT_EXEMPLARS.map(
    (e, i) => `Example ${i + 1} — ${e.scenario}\nBAD: ${e.bad}\nGOOD: ${e.good}`,
  ).join("\n\n");
  return `Study these examples of the register you must write in (PLACEHOLDER-DEV exemplars):\n\n${blocks}`;
}

function buildSystemPrompt(input: GenerateStageInput): string {
  const parts = [
    PERSONA_DEFINITION,
    INJECTION_GUARD,
    ROUTE_VARIANTS[input.route],
    `Persona for this turn: ${input.persona}. ${PERSONA_VOICE[input.persona] ?? ""}`.trim(),
    `Life domain context: ${input.domain}.`,
    renderRules(input.rules),
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
  return parts.filter(Boolean).join("\n\n");
}

async function malformedFallbackReply(): Promise<string> {
  const val = await getConfig("malformed_fallback_reply");
  if (typeof val !== "string" || val.length === 0) {
    throw new Error('config key "malformed_fallback_reply" is missing or empty');
  }
  return val;
}

/**
 * Stage 5. `ui_metadata.persona_options` is only ever permitted on the Medium
 * (`options`) route (§4.2), so it is stripped from every other route's output — a
 * structural drop, not regex post-processing.
 *
 * Two failure modes, deliberately handled differently (TECH-SPECS §4.1 vs §4.2):
 *
 *   * **structural** — the model answered but off-contract. One bounded retry, then
 *     `config.malformed_fallback_reply`. Nothing enqueues: retrying later cannot make an
 *     off-contract model contract-compliant.
 *   * **transport** — no provider could be reached. The adapter has already tried both
 *     tiers inside `generate()`, so there is no second attempt to make here; the failure
 *     is rethrown as `ProvidersUnavailableError` and the *caller* degrades synchronously
 *     (holding reply + `llm_retry` job, §4.1). Burning another round-trip inside the
 *     invocation would only push it toward the 150 s platform limit.
 */
export async function generateReply(input: GenerateStageInput): Promise<GenerateStageResult> {
  const system = buildSystemPrompt(input);
  const messages = [
    { role: "user" as const, content: `<user_message>\n${input.userText}\n</user_message>` },
  ];

  let attempts = 0;
  let last: Awaited<ReturnType<typeof generate<GenerateResponse>>> | null = null;

  // Exactly one bounded retry: at most two attempts, then the fallback reply.
  while (attempts < 2) {
    attempts += 1;
    last = await generate<GenerateResponse>({
      system,
      messages,
      schema: GENERATION_SCHEMA,
    });
    if (last.ok && last.data) break;
    if (last.kind === "transport") {
      throw new ProvidersUnavailableError(
        `stage 5: no provider answered after ${attempts} attempt(s): ${last.error ?? "unknown"}`,
        { kind: "transport" },
      );
    }
  }

  if (last?.ok && last.data) {
    const data = last.data;
    const options = input.route === "options" ? data.ui_metadata?.persona_options : undefined;
    return {
      directQuote: data.direct_quote,
      uiMetadata: options && options.length > 0 ? { persona_options: options } : undefined,
      tacticalAnalysis: data.tactical_analysis,
      persona: input.persona,
      modelPersona: typeof data.persona === "string" ? data.persona : null,
      provider: last.provider,
      latencyMs: last.latencyMs,
      attempts,
      degraded: false,
    };
  }

  // Both attempts failed structurally → malformed fallback (§4.2, D13). Reaching this
  // point means neither attempt was a transport failure, so a retry job would not help.
  return {
    directQuote: await malformedFallbackReply(),
    uiMetadata: undefined,
    tacticalAnalysis: `generation failed after ${attempts} attempt(s): ${last?.error ?? "unknown"}`,
    persona: input.persona,
    modelPersona: null,
    provider: last?.provider ?? "gemini",
    latencyMs: last?.latencyMs ?? 0,
    attempts,
    degraded: true,
  };
}
