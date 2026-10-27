// supabase/functions/_shared/pipeline/generate.ts
// Pipeline stage 5 — Final Response Generation (§4.2 anchored JSON contract).
//
// Builds the system prompt from the route + surviving rules, calls the provider adapter,
// and applies *exactly one* bounded retry on a structural failure before degrading to
// config.malformed_fallback_reply. No loops, no regex post-processing (AGENTS.md §5.1–5.2).

import { generate, type GenerateResponse } from "../llm/adapter.ts";
import { ProvidersUnavailableError } from "../llm/errors.ts";
import { getConfig } from "../config.ts";
import { GENERATION_SCHEMA } from "../prompts/guardrails.ts";
import { buildSystemPrompt, type GenerateStageInput } from "./generatePrompt.ts";

export type { GenerateStageInput };

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
  const userContent = input.recentContext
    ? `${input.recentContext}\n\n<user_message>\n${input.userText}\n</user_message>`
    : `<user_message>\n${input.userText}\n</user_message>`;
  const messages = [
    { role: "user" as const, content: userContent },
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
      ...(input.stubContext === undefined ? {} : { stubContext: input.stubContext }),
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
