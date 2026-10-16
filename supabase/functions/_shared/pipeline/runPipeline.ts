// supabase/functions/_shared/pipeline/runPipeline.ts
// FP-02 Step 3 — pipeline orchestrator (TECH-SPEC §5.1).
//
// Streaming order: [stage 1 ∥ embed] → stage 2 classify → stage 4 → stage 3 retrieval →
// stage 5.
//
// Step 5 (FR-11): stage 2 branches on `classifier_mode` — `'real'` runs the embedding
// classifier over the message embed, `'stub'` keeps the FP-02 deterministic stub (the
// rollback). The embed's *await point* moves ahead of stage 2 because the real classifier
// consumes it; its *failure semantics* do not: a failed embed is non-fatal at stage 2 (it
// yields the §6.4 D7 block, so a routing decision still exists) and stage 3 still throws
// `ProvidersUnavailableError` carrying that decision.
//
// ORDER NOTE (§5.1 / D7): the plan lists stage 3 before stage 4, but retrieval needs a
// domain and stage 4 is the stage that can *override* it to `General` on the fallback
// route. D7 requires the General/inquirer fallback to carry no aggressive rules, so
// retrieval runs against the *decided* domain. Stage 4 depends only on the stage-2
// classifier output, so nothing is serialised that did not need to be.
//
// This module is PURE w.r.t. DB writes: it reads config/rules/persona_stats and returns
// the turn's product. Persisting messages is a caller concern (Step 4, service role).
//
// Step 8 adds the synchronous-degrade contract (§4.1): a transport failure anywhere in
// stages 3–5 is rethrown as `ProvidersUnavailableError` carrying the resolved routing
// decision, so the caller can write a holding reply and enqueue exactly one `llm_retry`
// job instead of 500-ing and stranding the turn. The optional `deadlineAt` budget keeps
// the run inside the 150 s synchronous invocation limit.

import { getConfig } from "../config.ts";
import { embed } from "../llm/adapter.ts";
import {
  isProvidersUnavailable,
  ProvidersUnavailableError,
  type PipelineContext,
} from "../llm/errors.ts";
import {
  applyOverrides,
  classify,
  D7Fallback,
  type Classification,
  type ClassifyOverrides,
} from "./classify.ts";
import { classifyReal } from "./classifyReal.ts";
import { extract, type ExtractionResult } from "./extract.ts";
import {
  generateReply,
  type GenerateStageResult,
  type PersonaOption,
} from "./generate.ts";
import { determinePersona, type ConfidenceBands, type Route } from "./persona.ts";
import { retrieveRules } from "./retrieveRules.ts";
import type { RetrievedRule, RuleTone } from "../types/pipeline.ts";

/** Stage-2 classifier implementations (FR-11, `config.classifier_mode`). */
export type ClassifierMode = "real" | "stub";

export interface RunPipelineOptions {
  text: string;
  /** Owning user, used only to read `persona_stats.band_shift`; omit for dev probes. */
  userId?: string;
  /** Dev-only classifier overrides. The CALLER decides whether to honor them. */
  overrides?: ClassifyOverrides;
  /**
   * The turn's captured energy score (`profiles.latest_energy`), present on check-in turns
   * only (§6.1, FR-8); chat turns carry none. Threaded to the real classifier's energy
   * override — the stub ignores it.
   */
  energy?: number | null;
  /**
   * Dev-only stage-2 mode override, for drills. The CALLER decides whether to honor it
   * (like `overrides`); omitted by every product caller, so `config.classifier_mode`
   * decides. Anything other than `'real'` runs the stub.
   */
  classifierMode?: ClassifierMode;
  matchCount?: number;
  /**
   * Absolute epoch-ms deadline for the whole synchronous run (TECH-SPECS §4.1). The
   * caller derives it from `config.pipeline_deadline_ms` at invocation start; when it
   * passes, the pipeline throws `ProvidersUnavailableError` so the caller degrades
   * *before* the platform can kill the invocation at 150 s — a kill would orphan the
   * turn, because the user's message is already committed. Omit for dev probes.
   */
  deadlineAt?: number;
}

export interface RouteInfo {
  route: Route;
  persona: string;
  domain: string;
  overallConf: number;
  bandShift: number;
  effectiveBands: ConfidenceBands;
  /** Which stage-2 branch produced `classification` (FR-11) — the turn's mode evidence. */
  classifierMode: ClassifierMode;
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

/**
 * Total-budget guard (§4.1). Checked before each *expensive* stage, not before the
 * assistant insert: discarding an already-generated reply to write a holding message
 * instead would be pure loss, and that insert is a single fast statement.
 */
function assertWithinDeadline(
  deadlineAt: number | undefined,
  stage: string,
  context?: PipelineContext,
): void {
  if (deadlineAt === undefined) return;
  if (Date.now() > deadlineAt) {
    throw new ProvidersUnavailableError(`pipeline deadline exceeded before ${stage}`, {
      kind: "transport",
      context,
    });
  }
}

function contextOf(decision: {
  route: Route;
  persona: string;
  domain: string;
  overallConf: number;
  ruleIds?: string[];
}): PipelineContext {
  return {
    route: decision.route,
    persona: decision.persona,
    domain: decision.domain,
    overallConf: decision.overallConf,
    ruleIds: decision.ruleIds ?? [],
  };
}

export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { text, userId, overrides, matchCount = 5, deadlineAt } = opts;

  // Stage 3 (part A): embed the message once. Runs concurrently with stage 1 and the mode read.
  const embedPromise = embed([text]);

  // Stage 1 — started before the embed is awaited so the two still overlap. Stage 1 and the
  // embed both hand back adapter *result* objects: they resolve, they never reject.
  const extractionPromise = extract(text);

  // Stage 2's mode (FR-11), resolved while the embed is in flight so it costs no wall-clock.
  // Only the exact string `'real'` selects the embedding classifier, so a missing or malformed
  // config row falls back to the stub — the rollback direction. The dev override skips the read.
  const modePromise: Promise<ClassifierMode> =
    opts.classifierMode !== undefined
      ? Promise.resolve(opts.classifierMode)
      : getConfig("classifier_mode").then((raw): ClassifierMode => (raw === "real" ? "real" : "stub"));

  // The embed is awaited HERE rather than in stage 3: the real classifier consumes it (§5.1,
  // FR-11) and stage 3 reuses this same result, so a turn still issues exactly one embed.
  const embedResult = await embedPromise;
  const mode = await modePromise;

  // Stage 2 — classify. A failed embed yields the §6.4 D7 block instead of throwing, so the
  // routing decision below still exists and stage 3's throw can carry it to the degrade path
  // (§4.1: the hand-off is total by construction; FR-12/FR-13).
  const classifyStartedAt = Date.now();
  const classification: Classification =
    mode === "real"
      ? embedResult.ok && embedResult.data
        ? applyOverrides(
            await classifyReal({ embedding: embedResult.data.embeddings[0], energy: opts.energy }),
            overrides,
          )
        : D7Fallback()
      : classify(text, overrides);
  const classifyLatencyMs = Date.now() - classifyStartedAt;

  const extraction = await extractionPromise;

  // Stage 4 — route + persona (needs only the classifier output).
  const decision = await determinePersona(classification, userId);

  // FR-17: one structured line per REAL classification, emitted once stage 4 has resolved the
  // route. It carries no `provider`/`requestId`, so the adapter's `requestId === "embed"`
  // accounting (verify-step11.py's log parse) is unaffected. Step 6's calibration feed.
  if (mode === "real") {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        stage: "classify",
        mode,
        domain: classification.domain,
        emotion: classification.emotion,
        overall_conf: classification.overall_conf,
        quit_signal: classification.quit_signal,
        route: decision.route,
        latencyMs: classifyLatencyMs,
      }),
    );
  }

  // From here on the routing decision exists, so any failure can carry it to the caller
  // and the `llm_retry` job can re-run stages 3–5 without re-extracting (§4.1, §2.3).
  const context = contextOf(decision);

  // Stage 3 (part B): retrieve rules for the DECIDED domain, then conflict-filter.
  assertWithinDeadline(deadlineAt, "rule retrieval", context);
  if (!embedResult.ok || !embedResult.data) {
    // The embed has no fallback tier (D5: identity frozen to gemini-embedding-001@768),
    // so a Gemini outage would otherwise 500 the turn. Degrade like any transport failure.
    throw new ProvidersUnavailableError(
      `stage 3 embed failed: ${embedResult.error ?? "unknown"}`,
      { kind: "transport", context },
    );
  }
  const retrieval = await retrieveRules({
    domain: decision.domain,
    messageEmbedding: embedResult.data.embeddings[0],
    matchCount,
  });

  context.ruleIds = retrieval.survivors.map((r: RetrievedRule) => r.id);

  // Stage 5 — generate.
  assertWithinDeadline(deadlineAt, "generation", context);
  let gen: GenerateStageResult;
  try {
    gen = await generateReply({
      route: decision.route,
      persona: decision.persona,
      domain: decision.domain,
      rules: retrieval.survivors,
      userText: text,
    });
  } catch (err) {
    // Stage 5 throws `ProvidersUnavailableError` with no context of its own; attach the
    // decision here so the degrade path and the retry job see the same shape either way.
    if (isProvidersUnavailable(err) && !err.context) {
      throw new ProvidersUnavailableError(err.message, { kind: err.kind, context });
    }
    throw err;
  }

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
      classifierMode: mode,
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

export interface LockedPersonaOptions {
  /** The user's stored text — the same turn the chips were offered on. */
  text: string;
  /** The domain the option message was generated for (authoritative, §5.3). */
  domain: string;
  /** The persona the user picked. Locked for this turn. */
  persona: string;
  matchCount?: number;
  /** Absolute epoch-ms budget for the run — see `RunPipelineOptions.deadlineAt` (§4.1). */
  deadlineAt?: number;
}

export interface LockedPersonaResult {
  assistantContent: string;
  ruleIds: string[];
  persona: string;
  domain: string;
  provider: GenerateStageResult["provider"];
  latencyMs: number;
  attempts: number;
  degraded: boolean;
  /** Internal reasoning — the caller logs it, never persists or returns it (§4.2). */
  tacticalAnalysis: string;
}

/**
 * Stages 3–5 for a persona the user has *already chosen* — the Medium tier's chip tap
 * (§5.3, `select-persona`). Stages 1–2 and stage 4 are skipped by design: the choice
 * *is* the routing decision, so there is nothing left to extract, classify or route.
 *
 * Generation therefore runs on the `auto` route variant: the persona is locked, so the
 * turn must deliver a direct answer and must NOT offer persona options again.
 *
 * PURE w.r.t. DB writes, like `runPipeline` — persisting the secondary reply is the
 * caller's concern (service role).
 */
export async function runLockedPersonaReply(
  opts: LockedPersonaOptions,
): Promise<LockedPersonaResult> {
  const { text, domain, persona, matchCount = 5, deadlineAt } = opts;

  // The locked persona *is* the routing decision, so the context is known up front.
  const context: PipelineContext = {
    route: "auto",
    persona,
    domain,
    overallConf: 0,
    ruleIds: [],
  };

  // Stage 3: embed the stored text, then retrieve for the decided domain.
  assertWithinDeadline(deadlineAt, "rule retrieval", context);
  const embedResult = await embed([text]);
  if (!embedResult.ok || !embedResult.data) {
    throw new ProvidersUnavailableError(
      `stage 3 embed failed: ${embedResult.error ?? "unknown"}`,
      { kind: "transport", context },
    );
  }
  const retrieval = await retrieveRules({
    domain,
    messageEmbedding: embedResult.data.embeddings[0],
    matchCount,
  });

  context.ruleIds = retrieval.survivors.map((r: RetrievedRule) => r.id);

  // Stage 5: generate with the persona locked.
  assertWithinDeadline(deadlineAt, "generation", context);
  const gen = await generateReply({
    route: "auto",
    persona,
    domain,
    rules: retrieval.survivors,
    userText: text,
  });

  return {
    assistantContent: gen.directQuote,
    ruleIds: retrieval.survivors.map((r: RetrievedRule) => r.id),
    persona,
    domain,
    provider: gen.provider,
    latencyMs: gen.latencyMs,
    attempts: gen.attempts,
    degraded: gen.degraded,
    tacticalAnalysis: gen.tacticalAnalysis,
  };
}
