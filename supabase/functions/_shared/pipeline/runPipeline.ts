// supabase/functions/_shared/pipeline/runPipeline.ts
// FP-02 Step 3 — pipeline orchestrator (TECH-SPEC §5.1).
//
// Streaming order: stage 1 ∥ stage 2 (the message embed is kicked off concurrently) →
// stage 4 → stage 3 retrieval → stage 5.
//
// ORDER NOTE (§5.1 / D7): the plan lists stage 3 before stage 4, but retrieval needs a
// domain and stage 4 is the stage that can *override* it to `General` on the fallback
// route. D7 requires the General/inquirer fallback to carry no aggressive rules, so
// retrieval runs against the *decided* domain. Stage 4 depends only on the stage-2
// classifier output, so nothing is serialised that did not need to be.
//
// This module is PURE w.r.t. DB writes: it reads config/rules/persona_stats and returns
// the turn's product. Persisting messages is a caller concern (Step 4, service role).

import { embed } from "../llm/adapter.ts";
import { classify, type Classification, type ClassifyOverrides } from "./classify.ts";
import { extract, type ExtractionResult } from "./extract.ts";
import {
  generateReply,
  type GenerateStageResult,
  type PersonaOption,
} from "./generate.ts";
import { determinePersona, type ConfidenceBands, type Route } from "./persona.ts";
import { retrieveRules } from "./retrieveRules.ts";
import type { RetrievedRule, RuleTone } from "../types/pipeline.ts";

export interface RunPipelineOptions {
  text: string;
  /** Owning user, used only to read `persona_stats.band_shift`; omit for dev probes. */
  userId?: string;
  /** Dev-only classifier overrides. The CALLER decides whether to honor them. */
  overrides?: ClassifyOverrides;
  matchCount?: number;
}

export interface RouteInfo {
  route: Route;
  persona: string;
  domain: string;
  overallConf: number;
  bandShift: number;
  effectiveBands: ConfidenceBands;
  classification: Classification;
  extraction: ExtractionResult | null;
  extractionOk: boolean;
  extractionError: string | null;
  ruleIds: string[];
  ruleTones: RuleTone[];
  droppedTone: RuleTone | null;
  retrieved: number;
  provider: GenerateStageResult["provider"];
  latencyMs: number;
  attempts: number;
  degraded: boolean;
  modelPersona: string | null;
}

export interface RunPipelineResult {
  assistantContent: string;
  uiMetadata?: { persona_options?: PersonaOption[] };
  /** Internal reasoning — caller must log it, never persist or return it (§4.2). */
  tacticalAnalysis: string;
  routeInfo: RouteInfo;
}

export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { text, userId, overrides, matchCount = 5 } = opts;

  // Stage 3 (part A): embed the message once. Runs concurrently with stages 1–2.
  const embedPromise = embed([text]);

  // Stage 1 ∥ stage 2 — independent.
  const [extraction, classification] = await Promise.all([
    extract(text),
    Promise.resolve(classify(text, overrides)),
  ]);

  // Stage 4 — route + persona (needs only the classifier output).
  const decision = await determinePersona(classification, userId);

  // Stage 3 (part B): retrieve rules for the DECIDED domain, then conflict-filter.
  const embedResult = await embedPromise;
  if (!embedResult.ok || !embedResult.data) {
    throw new Error(`stage 3 embed failed: ${embedResult.error ?? "unknown"}`);
  }
  const retrieval = await retrieveRules({
    domain: decision.domain,
    messageEmbedding: embedResult.data.embeddings[0],
    matchCount,
  });

  // Stage 5 — generate.
  const gen = await generateReply({
    route: decision.route,
    persona: decision.persona,
    domain: decision.domain,
    rules: retrieval.survivors,
    userText: text,
  });

  return {
    assistantContent: gen.directQuote,
    uiMetadata: gen.uiMetadata,
    tacticalAnalysis: gen.tacticalAnalysis,
    routeInfo: {
      route: decision.route,
      persona: decision.persona,
      domain: decision.domain,
      overallConf: decision.overallConf,
      bandShift: decision.bandShift,
      effectiveBands: decision.effectiveBands,
      classification,
      extraction: extraction.ok && extraction.data ? extraction.data : null,
      extractionOk: extraction.ok,
      extractionError: extraction.ok ? null : (extraction.error ?? "unknown"),
      ruleIds: retrieval.survivors.map((r: RetrievedRule) => r.id),
      ruleTones: retrieval.survivors.map((r: RetrievedRule) => r.tone),
      droppedTone: retrieval.droppedTone,
      retrieved: retrieval.retrieved,
      provider: gen.provider,
      latencyMs: gen.latencyMs,
      attempts: gen.attempts,
      degraded: gen.degraded,
      modelPersona: gen.modelPersona,
    },
  };
}
