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
// FP-06 Step 5 adds the recalled-memory rider (§7.6): when `memory_retrieval_enabled` is
// literally true, stage 3 fires `match_facts` in its parallel slot beside `retrieveRules`,
// reusing the turn's already-computed message embedding (zero provider calls added). The
// renderer returns `undefined` for no facts, so both a no-facts turn and a kill-switched
// turn are byte-identical to the FP-05 prompt. The load is fail-open: a Postgres problem
// logs one warning and the turn proceeds with an empty block.
//
// Step 8 adds the synchronous-degrade contract (§4.1): a transport failure anywhere in
// stages 3–5 is rethrown as `ProvidersUnavailableError` carrying the resolved routing
// decision, so the caller can write a holding reply and enqueue exactly one `llm_retry`
// job instead of 500-ing and stranding the turn. The optional `deadlineAt` budget keeps
// the run inside the 150 s synchronous invocation limit.

import { getConfig, getConfigNumber, supabaseService } from "../config.ts";
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
import { resolveCurrentFreeBlock, renderDayPlanPromptContext, type AnchorPlanAnchor } from "./dayPlan.ts";
import { mergeMemoryFacts, renderMemoryContext, type MemoryFact } from "./memoryContext.ts";
import { renderRecentContext, type RecentThreadMessage } from "./recentContext.ts";
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

  /**
   * Optional day-plan context string (FP-05 Step 6). When present, appended to the
   * generation system prompt. If absent (no plan or userId not provided), the prompt
   * is byte-identical to FP-04 — riders are gated, not reformatted.
   */
  dayPlanContext?: string;

  /**
   * Optional pre-rendered immediate conversation context (TECH-SPEC §7.6). When
   * provided, skips loading recent messages from the database.
   */
  recentContext?: string;
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

/**
 * The day-plan rider's load outcome (FP-05 drill follow-up) — the same fields as the
 * `[runPipeline] day-plan` log line, echoed on the result so a drill can assert the rider
 * directly instead of scraping Edge Function logs. `reason` enumerates every exit; `ok` adds
 * `today` / `timezone` / `anchors` / `inBlock` / `energy` / `chars`.
 *
 * **Not a client surface.** `send-message` and `submit-checkin` build their own response
 * bodies and never forward this; only the token-gated `dev-smoke ?action=pipeline` reads it.
 * Nothing here is sensitive — `energy` is already returned by `submit-checkin` (§7.4), and
 * `chars` is the length of a prompt fragment, not the prompt.
 */
export interface DayPlanProbe {
  reason: "ok" | "no_plan_for_today" | "plan_error" | "no_profile" | "profile_error" | "threw";
  today?: string;
  timezone?: string;
  anchors?: number;
  inBlock?: boolean;
  energy?: number | null;
  chars?: number;
  error?: string;
}

/** User-local `YYYY-MM-DD` (the `anchor_plans.plan_date` form) at `ms` in `tz`. */
function localDate(tz: string, ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Load the day-plan rider context for one turn (FP-05 §7.2, FR-12/FR-13).
 *
 * Extracted so *every* stage-5 path can carry the riders, not only `runPipeline`. FR-13 says
 * "**whenever** a plan exists for the user-local today, stage-5 context carries the compact anchors
 * and the instruction that moving any anchor or assigned task requires conversational approval" —
 * and `runLockedPersonaReply` reaches `generateReply` without passing through `runPipeline`. That
 * path is not a corner case: it serves the `select-persona` chip tap and the `llm_retry`
 * replacement answer, i.e. the continuation of the user's own turn.
 *
 * Fail-soft, never fail-silent: a data problem never fails a turn, but every call emits exactly one
 * `[runPipeline] day-plan` line (FP-05 drill follow-up) so "the rider rendered" stays separable
 * from "the model ignored it".
 *
 * `energy` is the caller's explicit value (a check-in's `parseEnergy`, §7.1); `null`/absent falls
 * back to `profiles.latest_energy`.
 */
export async function loadDayPlanContext(
  userId: string,
  energy: number | null,
): Promise<{ dayPlanContext?: string; dayPlanProbe: DayPlanProbe }> {
  let probe: DayPlanProbe = { reason: "threw", error: "unreachable" };
  let ctx: string | undefined;
  try {
    const { data: profile, error: profileError } = await supabaseService
      .from("profiles")
      .select("timezone, latest_energy")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile) {
      probe = {
        reason: profileError ? "profile_error" : "no_profile",
        error: profileError?.message,
      };
    } else {
      const timezone = (profile.timezone as string) ?? "UTC";
      const latestEnergy = (profile.latest_energy as number | null) ?? null;
      // An explicit energy takes precedence over the stored one.
      const turnEnergy = energy ?? latestEnergy;
      const today = localDate(timezone, Date.now());

      const { data: planRow, error: planError } = await supabaseService
        .from("anchor_plans")
        .select("anchors")
        .eq("user_id", userId)
        .eq("plan_date", today)
        .maybeSingle();

      if (planError || !planRow?.anchors) {
        probe = {
          reason: planError ? "plan_error" : "no_plan_for_today",
          today,
          timezone,
          error: planError?.message,
        };
      } else {
        const anchors = (planRow.anchors as unknown as AnchorPlanAnchor[]);
        const currentFreeBlock = resolveCurrentFreeBlock(anchors, Date.now(), timezone);
        ctx = renderDayPlanPromptContext({ anchors, currentFreeBlock, energy: turnEnergy });
        probe = {
          reason: "ok",
          today,
          timezone,
          anchors: anchors.length,
          inBlock: !!currentFreeBlock,
          energy: turnEnergy,
          chars: ctx.length,
        };
      }
    }
  } catch (e) {
    probe = { reason: "threw", error: e instanceof Error ? e.message : String(e) };
  }
  console.log("[runPipeline] day-plan", JSON.stringify(probe));
  return { dayPlanContext: ctx, dayPlanProbe: probe };
}

/**
 * The retrieved-memory load outcome (FP-06 Step 5) — the same fields as the
 * `[runPipeline] memory` log line, echoed on the result so a drill can assert retrieval
 * directly. `reason` enumerates every exit: `ok` (the RPC answered; `facts` may be 0),
 * `disabled` (the kill switch is off), `error` (fail-open: warning logged, block absent).
 *
 * **Not a client surface.** `send-message` and `submit-checkin` build their own response
 * bodies and never forward this; only the token-gated `dev-smoke` reads it. Nothing here
 * is sensitive — `chars` is a prompt-fragment length, and facts themselves never appear.
 */
export interface MemoryFactsProbe {
  reason: "ok" | "disabled" | "error";
  facts: number;
  topK?: number;
  baseline?: number;
  chars?: number;
  error?: string;
}

export interface MemoryContextLoad {
  memoryContext?: string;
  memoryProbe: MemoryFactsProbe;
}

/**
 * The kill switch (FR-10), fail-closed: only a literal `true` enables retrieval, so a
 * missing row, a malformed value, or a config-read failure all leave the prompt exactly
 * as FP-05 left it.
 */
export async function memoryRetrievalEnabled(): Promise<boolean> {
  return (await getConfig("memory_retrieval_enabled")) === true;
}

/**
 * Load and render one turn's recalled-memory block (FR-9/FR-13): one `match_facts` RPC
 * over the turn's already-computed message embedding (no new provider call), split into
 * the top-k arm and the baseline arm, merged, rendered.
 *
 * Fail-open (FR-10): a Postgres/config problem is one warning and an empty block — the
 * turn proceeds on the no-memory prompt rather than degrading for a context extra. The
 * `[runPipeline] memory` line is emitted only when the block is non-empty, so "no facts"
 * stays silent (the day-plan probe logs every exit; this one logs only renderings).
 */
export async function loadMemoryContext(
  userId: string,
  messageEmbedding: number[],
): Promise<MemoryContextLoad> {
  try {
    const topK = await getConfigNumber("memory_fact_top_k");
    const { data, error } = await supabaseService.rpc("match_facts", {
      p_user_id: userId,
      p_query_embedding: messageEmbedding,
      p_top_k: topK,
    });
    if (error) throw new Error(`match_facts failed: ${error.message}`);

    const rows: MemoryFact[] = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      fact: r.fact as string,
      fact_type: r.fact_type as string,
      similarity: Number(r.similarity ?? 0),
    }));
    const baseline = rows.filter((r) => r.fact_type === "baseline");
    const topArm = rows.filter((r) => r.fact_type !== "baseline");
    const merged = mergeMemoryFacts(topArm, baseline);
    const memoryContext = renderMemoryContext(merged);
    const memoryProbe: MemoryFactsProbe = {
      reason: "ok",
      facts: merged.length,
      topK,
      baseline: baseline.length,
      chars: memoryContext?.length,
    };
    if (memoryContext) {
      console.log("[runPipeline] memory", JSON.stringify(memoryProbe));
    }
    return { memoryContext, memoryProbe };
  } catch (e) {
    const memoryProbe: MemoryFactsProbe = {
      reason: "error",
      facts: 0,
      error: e instanceof Error ? e.message : String(e),
    };
    console.warn("[runPipeline] memory", JSON.stringify(memoryProbe));
    return { memoryContext: undefined, memoryProbe };
  }
}

/**
 * Load and render the immediate conversation context (last sliding_window_messages).
 *
 * Scoped to the user, strictly skips unsavable=true rows (AGENTS.md §4.2, TECH-SPEC §7.6),
 * and excludes the active user message so the current turn is not duplicated in history.
 *
 * Active turn exclusion heuristic:
 * Callers (send-message, submit-checkin) commit the incoming user message to the messages
 * table prior to calling the pipeline. When loading recent history, if the newest row has
 * role='user' and content matches currentText, it is sliced off as the active turn. If another
 * row intervened or the active message was not yet committed, no slice occurs. This keeps
 * pipeline callers decoupled from message row IDs.
 *
 * Oldest-first order matching the prompt contract. Fail-open on database errors.
 */
export async function loadRecentContext(
  userId: string,
  currentText?: string,
): Promise<string | undefined> {
  try {
    const windowSize = await getConfigNumber("sliding_window_messages");
    const limit = Math.max(0, Math.trunc(windowSize)) + 1;
    const { data: rows, error } = await supabaseService
      .from("messages")
      .select("id, role, content")
      .eq("user_id", userId)
      .eq("unsavable", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[runPipeline] recent-context load failed:", error.message);
      return undefined;
    }

    if (!rows || rows.length === 0) return undefined;

    let candidateRows = rows;
    // Active turn exclusion heuristic: if the newest row is the active user message, slice it off
    if (currentText !== undefined && candidateRows.length > 0) {
      const top = candidateRows[0];
      if (top.role === "user" && top.content === currentText) {
        candidateRows = candidateRows.slice(1);
      }
    }

    const slice = candidateRows.slice(0, Math.max(0, Math.trunc(windowSize)));
    if (slice.length === 0) return undefined;

    // The query is newest-first (the index order); the prompt wants oldest-first.
    const messages: RecentThreadMessage[] = (slice as Array<{ role: string; content: string }>)
      .map((r) => ({ role: String(r.role), content: String(r.content) }))
      .reverse();

    return renderRecentContext(messages);
  } catch (err) {
    console.warn("[runPipeline] recent-context load error:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

export interface RunPipelineResult {
  assistantContent: string;
  uiMetadata?: { persona_options?: PersonaOption[] };
  /** Internal reasoning — caller must log it, never persist or return it (§4.2). */
  tacticalAnalysis: string;
  routeInfo: RouteInfo;
  /** Present only when the rider block ran (i.e. `userId` given, §5.1). Drill-facing. */
  dayPlanProbe?: DayPlanProbe;
  /**
   * Present only when `userId` was given (FP-06 Step 5). `disabled` when the kill switch
   * is off; `error` when the fail-open path caught. Drill-facing — not a client surface.
   */
  memoryProbe?: MemoryFactsProbe;
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
  const { text, userId, overrides, energy, matchCount = 5, deadlineAt, dayPlanContext } = opts;

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

  // FP-06 Step 5: the retrieval kill switch (fail-closed) likewise resolves while the embed
  // is in flight; no userId means no user-scoped read, so it stays off.
  const memoryEnabledPromise: Promise<boolean> = userId
    ? memoryRetrievalEnabled()
    : Promise.resolve(false);

  // Immediate context (last sliding_window_messages, TECH-SPEC §7.6).
  // Runs in flight alongside the embed/extract promises.
  const recentContextPromise: Promise<string | undefined> =
    opts.recentContext !== undefined
      ? Promise.resolve(opts.recentContext)
      : userId
        ? loadRecentContext(userId, text)
        : Promise.resolve(undefined);

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
  // FP-06 Step 5: memory retrieval rides stage 3's parallel slot beside rule retrieval and
  // reuses this turn's message embedding — zero provider calls added. The load is fail-open.
  const memoryEnabled = await memoryEnabledPromise;
  const memoryPromise: Promise<MemoryContextLoad> =
    userId && memoryEnabled
      ? loadMemoryContext(userId, embedResult.data.embeddings[0])
      : Promise.resolve({
          memoryContext: undefined,
          memoryProbe: { reason: "disabled", facts: 0 } as MemoryFactsProbe,
        });

  const retrieval = await retrieveRules({
    domain: decision.domain,
    messageEmbedding: embedResult.data.embeddings[0],
    matchCount,
  });
  const memory = await memoryPromise;

  context.ruleIds = retrieval.survivors.map((r: RetrievedRule) => r.id);

  // FP-05 Step 6/§7.2: the day-plan riders (no plan -> byte-identical prompt). The load lives in
  // `loadDayPlanContext` so the locked-persona path carries the same riders (FR-13's "whenever").
  let finalDayPlanContext = dayPlanContext;
  let dayPlanProbe: DayPlanProbe | undefined;
  if (userId && !finalDayPlanContext) {
    const loaded = await loadDayPlanContext(userId, energy ?? null);
    finalDayPlanContext = loaded.dayPlanContext;
    dayPlanProbe = loaded.dayPlanProbe;
  }

  // Stage 5 — generate.
  assertWithinDeadline(deadlineAt, "generation", context);
  const recentContext = await recentContextPromise;
  let gen: GenerateStageResult;
  try {
    gen = await generateReply({
      route: decision.route,
      persona: decision.persona,
      domain: decision.domain,
      rules: retrieval.survivors,
      userText: text,
      dayPlanContext: finalDayPlanContext,
      memoryContext: memory.memoryContext,
      recentContext,
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
    dayPlanProbe,
    memoryProbe: userId ? memory.memoryProbe : undefined,
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
  /**
   * The user this turn belongs to (FP-05 §7.2). When present the day-plan riders are loaded and
   * appended exactly as `runPipeline` does — FR-13 requires them *whenever* a plan exists, and the
   * chip tap / retry are continuations of the user's own turn, where the plan is directly
   * relevant. Omitted by the watchdog intervention and the journal probe, which are not
   * continuations of a user turn (they load nothing and log nothing) — and by construction
   * stay memory-free too (FP-06 Step 5 gates retrieval on this same field).
   */
  userId?: string;
  /**
   * Explicit energy for this turn (a check-in's `parseEnergy`, §7.1). Omitted/null falls back to
   * `profiles.latest_energy`, the same precedence `runPipeline` applies.
   */
  energy?: number | null;
  /**
   * Optional pre-rendered immediate conversation context (TECH-SPEC §7.6). When
   * provided, skips loading recent messages from the database.
   */
  recentContext?: string;
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
  /** Present only when a `userId` was supplied (§7.2). Drill-facing — see `DayPlanProbe`. */
  dayPlanProbe?: DayPlanProbe;
  /** Present only when a `userId` was supplied (FP-06 Step 5). Drill-facing. */
  memoryProbe?: MemoryFactsProbe;
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
  const { text, domain, persona, userId, energy = null, matchCount = 5, deadlineAt } = opts;

  // The locked persona *is* the routing decision, so the context is known up front.
  const context: PipelineContext = {
    route: "auto",
    persona,
    domain,
    overallConf: 0,
    ruleIds: [],
  };

  // FP-06 Step 5: the retrieval kill switch (fail-closed), in flight beside the embed. A
  // `userId` is present only on continuations of the user's own turn (chip tap, retry
  // replacement); the watchdog intervention and the journal probe omit it, so unprompted
  // generations stay memory-free by construction.
  const memoryEnabledPromise: Promise<boolean> = userId
    ? memoryRetrievalEnabled()
    : Promise.resolve(false);

  // Stage 3: embed the stored text, then retrieve for the decided domain.
  assertWithinDeadline(deadlineAt, "rule retrieval", context);
  const embedResult = await embed([text]);
  if (!embedResult.ok || !embedResult.data) {
    throw new ProvidersUnavailableError(
      `stage 3 embed failed: ${embedResult.error ?? "unknown"}`,
      { kind: "transport", context },
    );
  }
  const memoryPromise: Promise<MemoryContextLoad> =
    userId && (await memoryEnabledPromise)
      ? loadMemoryContext(userId, embedResult.data.embeddings[0])
      : Promise.resolve({
          memoryContext: undefined,
          memoryProbe: { reason: "disabled", facts: 0 } as MemoryFactsProbe,
        });
  const retrieval = await retrieveRules({
    domain,
    messageEmbedding: embedResult.data.embeddings[0],
    matchCount,
  });
  const memory = await memoryPromise;

  context.ruleIds = retrieval.survivors.map((r: RetrievedRule) => r.id);

  // FP-05 §7.2 / FR-13: the day-plan riders reach this path too. Without a `userId` the prompt is
  // unchanged (the riders are gated on plan existence, never reformatted) — the watchdog
  // intervention and the journal probe call this without one, by design.
  const dayPlan = userId
    ? await loadDayPlanContext(userId, energy)
    : { dayPlanContext: undefined, dayPlanProbe: undefined };

  // Immediate context (last sliding_window_messages, TECH-SPEC §7.6).
  const recentContextPromise: Promise<string | undefined> =
    opts.recentContext !== undefined
      ? Promise.resolve(opts.recentContext)
      : userId
        ? loadRecentContext(userId, text)
        : Promise.resolve(undefined);

  // Stage 5: generate with the persona locked.
  assertWithinDeadline(deadlineAt, "generation", context);
  const recentContext = await recentContextPromise;
  const gen = await generateReply({
    route: "auto",
    persona,
    domain,
    rules: retrieval.survivors,
    userText: text,
    dayPlanContext: dayPlan.dayPlanContext,
    memoryContext: memory.memoryContext,
    recentContext,
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
    dayPlanProbe: dayPlan.dayPlanProbe,
    memoryProbe: userId ? memory.memoryProbe : undefined,
  };
}
