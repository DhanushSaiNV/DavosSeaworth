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
import { determinePersona, readConfidenceBands, FALLBACK_DOMAIN, type ConfidenceBands, type Route } from "./persona.ts";
import { applyConflictFilter, retrieveRules } from "./retrieveRules.ts";
import { resolveCurrentFreeBlock, renderDayPlanPromptContext, type AnchorPlanAnchor } from "./dayPlan.ts";
import { mergeMemoryFacts, renderMemoryContext, type MemoryFact } from "./memoryContext.ts";
import { renderRecentContext, type RecentThreadMessage } from "./recentContext.ts";
import {
  applyTrustRider,
  readTurnDialogState,
  type RiderProbe,
  type TurnDialogState,
} from "../accountability/applyRider.ts";
import { signalsFromExtraction } from "../accountability/rider.ts";
import {
  ACCOUNTABILITY_DOMAINS_DEFAULT,
  LOCKDOWN_PERSONA,
  buildRedirectInstruction,
  effectiveDomain,
} from "../accountability/lockdown.ts";
import {
  BREAKDOWN_EMOTIONS,
  BREAKDOWN_REASON,
  buildLockdownContext,
  shouldTriggerBreakdown,
} from "../accountability/interventions.ts";
import type { RetrievedRule, RetrieveRulesResult, RuleTone } from "../types/pipeline.ts";

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
   * FP-08 FR-2/FR-8: apply the D20 rider from this turn's extraction before stage 4 and
   * generation. Chat turns opt in (`send-message`); every other caller leaves it off because
   * check-in turns have no rider path and journal turns apply it in `journal_extract`. A
   * neutral turn still issues no writes (the rider's floor), and a rider failure is non-fatal.
   */
  applyRider?: boolean;

  /**
   * FP-08 Step 4 (FR-10/FR-11): the user row this turn answers. The breakdown trigger stamps
   * it into the intervention job's payload so a repair run and a re-claimed job dedupe on the
   * same source; absent on dev probes and check-in turns (no chat row).
   */
  sourceMessageId?: string;

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
  /** Present only when `applyRider` ran (FP-08 Step 3). Drill-facing - not a client surface. */
  riderProbe?: RiderProbe;
  /**
   * Present only when the turn-start read ran (FP-08 Step 4). `active` is the state that
   * stage 4 used *after* the rider's entry/exit and the lazy breaker. Drill-facing.
   */
  lockdownProbe?: LockdownProbe;
  /**
   * The turn's message embedding and its model stamp (FP-08 Step 4 / FR-10): the oath capture
   * reuses them so the fact costs zero provider calls. Absent when the embed failed — the turn
   * has already degraded in that case, so no capture runs.
   */
  messageEmbedding?: number[];
  embedModel?: string | null;
}

/** FP-08 Step 4's drill-facing lockdown report. Not a client surface. */
export interface LockdownProbe {
  active: boolean;
  /** True when this turn's read performed the lazy 24 h exit. */
  breakerExited: boolean;
  /** True when the state came from the rider's own decision this turn. */
  riderDecided: boolean;
  persona: string | null;
  domains: string[];
  /** The deterministic redirect instruction when the classified domain is outside the set. */
  redirect: string | null;
  /** The classified domain, echoed for the gate's mismatch leg. */
  classifiedDomain: string;
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

/**
 * FP-08 FR-7: retrieval for the accountability domain *set*. `match_rules` takes one domain,
 * so each domain is queried once and the survivors are merged, deduped, re-filtered for tone
 * conflicts (the union can introduce a pair neither single query saw) and capped at the
 * standard top-`matchCount`.
 */
async function retrieveLockdownRules(
  domains: string[],
  messageEmbedding: number[],
  matchCount: number,
): Promise<RetrieveRulesResult> {
  if (domains.length === 0) {
    return { survivors: [], retrieved: 0, droppedTone: null, window: 0 };
  }
  const results = await Promise.all(
    domains.map((domain) => retrieveRules({ domain, messageEmbedding, matchCount })),
  );
  const seen = new Set<string>();
  const merged: RetrievedRule[] = [];
  for (const result of results) {
    for (const rule of result.survivors) {
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      merged.push(rule);
    }
  }
  const window = results[0]?.window ?? 0;
  const filtered = applyConflictFilter(merged, window);
  return {
    survivors: filtered.survivors.slice(0, matchCount),
    retrieved: results.reduce((sum, result) => sum + result.retrieved, 0),
    droppedTone: filtered.droppedTone,
    window,
  };
}

/**
 * FR-7's "logged evidence vs the user's claim": the bounded, deterministic slice the locked
 * prompt carries. Reads only rows the server already owns (check-in logs, live habits, trust
 * signals); a read failure yields an empty list, never a failed turn.
 */
async function loadConfrontationEvidence(userId: string): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [checkins, habits, events] = await Promise.all([
      supabaseService
        .from("doings_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("source", "checkin_reply")
        .gte("logged_at", since),
      supabaseService
        .from("habits")
        .select("description, status")
        .eq("user_id", userId)
        .in("status", ["detected", "confronted", "watch", "struck"])
        .order("created_at", { ascending: false })
        .limit(5),
      supabaseService
        .from("trust_events")
        .select("reason, delta, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    const lines: string[] = [];
    if (!checkins.error) {
      lines.push(`${checkins.count ?? 0} check-in(s) logged in the last 7 days.`);
    }
    if (!habits.error && (habits.data?.length ?? 0) > 0) {
      lines.push(
        "Habits on record: " +
          habits.data!.map((h) => `${String(h.description)} (${String(h.status)})`).join("; ") +
          ".",
      );
    }
    if (!events.error && (events.data?.length ?? 0) > 0) {
      lines.push(
        "Recent logged signals: " +
          events.data!.map((e) => {
            const delta = Number(e.delta);
            return `${String(e.reason)} ${delta >= 0 ? "+" : ""}${delta}`;
          }).join(", ") +
          ".",
      );
    }
    return lines;
  } catch (err) {
    console.warn(
      "[pipeline] confrontation evidence read failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { text, userId, overrides, energy, matchCount = 5, deadlineAt, dayPlanContext } = opts;

  // FP-08 Step 4 (FR-7): the turn-start dialog read + lazy breaker. It runs before stage 1 so
  // the breaker exit is visible to this turn, and it is fail-soft: a read failure answers OPEN
  // rather than failing a turn that has no user-visible relationship to the dialog state.
  const turnDialogPromise: Promise<TurnDialogState | null> = userId
    ? readTurnDialogState(userId).catch((err) => {
      console.warn(
        "[pipeline] dialog-state read failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    })
    : Promise.resolve(null);

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

  // FP-08 Step 3 (FR-2, FR-8): the D20 rider, applied from this turn's already-computed
  // extraction before stage 4 reads the dialog state and before generation runs — the
  // concession exit must be visible to *this* turn, and re-entry only refreshes the clock.
  // The rider also runs when extraction failed, so the lazy 24 h breaker still gets its turn
  // (FR-8). Non-fatal by design: the turn still answers (the auto-adopt precedent).
  let riderProbe: RiderProbe | undefined;
  if (opts.applyRider && userId) {
    try {
      riderProbe = await applyTrustRider({
        userId,
        signals: extraction.ok && extraction.data
          ? signalsFromExtraction(extraction.data.intent_flags, extraction.data.openness_delta)
          : {},
        // Stage 2 has already applied `quit_signal_threshold` (classify.ts §6.3), so the
        // boolean is saturated to a probability — the rider must not threshold it twice.
        quitSignal: classification.quit_signal ? 1 : 0,
      });
    } catch (err) {
      console.warn(
        "[pipeline] rider apply failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // FP-08 Step 4 (FR-11): the breakdown trigger, post-stage-2 and pre-generation. It fires
  // regardless of dialog_state (support is not confrontation) and only on chat turns — the
  // rider opt-in is this codebase's "this is a chat turn" signal. The gate reads the
  // pre-rider score for the same reason the oath gate does: the turn's own deltas must not
  // decide whether the turn triggers an intervention.
  if (
    opts.applyRider && userId && riderProbe?.applied &&
    BREAKDOWN_EMOTIONS.includes(classification.emotion ?? "")
  ) {
    try {
      const [trustThreshold, bands] = await Promise.all([
        getConfigNumber("trust_threshold"),
        readConfidenceBands(),
      ]);
      if (
        shouldTriggerBreakdown({
          emotion: classification.emotion,
          confidence: classification.overall_conf,
          highBand: bands.high,
          trustBefore: riderProbe.trust_before,
          trustThreshold,
        })
      ) {
        let duplicate = false;
        if (opts.sourceMessageId) {
          const { data: existing, error: existingError } = await supabaseService
            .from("jobs")
            .select("id")
            .eq("type", "intervention")
            .eq("payload->>reason", BREAKDOWN_REASON)
            .eq("payload->>source_message_id", opts.sourceMessageId)
            .limit(1);
          if (existingError) throw existingError;
          duplicate = (existing?.length ?? 0) > 0;
        }
        if (!duplicate) {
          const { error: jobError } = await supabaseService.from("jobs").insert({
            type: "intervention",
            payload: {
              user_id: userId,
              reason: BREAKDOWN_REASON,
              source_message_id: opts.sourceMessageId ?? null,
            },
            next_retry_at: new Date().toISOString(),
          });
          if (jobError) throw jobError;
        }
      }
    } catch (err) {
      // The turn proceeds normally; a missed support message is the acceptable failure.
      console.warn(
        "[pipeline] breakdown trigger failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Stage 4 — route + persona (needs only the classifier output).
  const turnDialog = await turnDialogPromise;
  const riderDialog = riderProbe?.dialog_state;
  const dialogState = riderDialog ?? turnDialog?.state ?? "OPEN";
  let decision = await determinePersona(classification, userId);

  // FR-7's override: the persona, route and retrieval domain are forced, but the band
  // bookkeeping determinePersona read is preserved for the metadata and the §5.3 log line.
  // The rider's own decision wins over the turn-start read (FR-6: the triggering turn itself
  // confronts; FR-8: a concession exits before this turn's generation).
  const accountabilityDomains = turnDialog?.domains?.length
    ? turnDialog.domains
    : [...ACCOUNTABILITY_DOMAINS_DEFAULT];
  let lockdownProbe: LockdownProbe | undefined;
  if (dialogState === "LOCKDOWN") {
    const classifiedDomain = classification.domain ?? "";
    const { domains, mismatched } = effectiveDomain(classifiedDomain, accountabilityDomains);
    const redirect = mismatched
      ? buildRedirectInstruction(classifiedDomain, accountabilityDomains)
      : null;
    decision = {
      ...decision,
      route: "auto",
      persona: LOCKDOWN_PERSONA,
      domain: domains[0] ?? FALLBACK_DOMAIN,
    };
    lockdownProbe = {
      active: true,
      breakerExited: turnDialog?.breakerExited ?? false,
      riderDecided: riderDialog !== undefined,
      persona: LOCKDOWN_PERSONA,
      domains,
      redirect,
      classifiedDomain,
    };
  } else if (turnDialog) {
    lockdownProbe = {
      active: false,
      breakerExited: turnDialog.breakerExited,
      riderDecided: riderDialog !== undefined,
      persona: null,
      domains: accountabilityDomains,
      redirect: null,
      classifiedDomain: classification.domain ?? "",
    };
  }

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

  const retrieval: RetrieveRulesResult = lockdownProbe?.active
    ? await retrieveLockdownRules(
      lockdownProbe.domains,
      embedResult.data.embeddings[0],
      matchCount,
    )
    : await retrieveRules({
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
  // FP-08 FR-7: the locked prompt is a §10.5-delimited context built from server rows and the
  // user's own claim. OPEN turns pass `undefined`, so their prompt stays byte-identical (the
  // hard floor for this step).
  const lockdownContext = lockdownProbe?.active && userId
    ? buildLockdownContext({
      claim: text,
      evidence: await loadConfrontationEvidence(userId),
      domains: lockdownProbe.domains,
      redirect: lockdownProbe.redirect,
    })
    : undefined;
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
      lockdownContext,
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
    riderProbe,
    lockdownProbe,
    messageEmbedding: embedResult.data.embeddings[0],
    embedModel: embedResult.data.model ?? null,
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
  /**
   * Dev-only stub seam (FP-08 Step 7). The adapter reads it only in stub mode and never
   * places it in a provider body; production callers omit it.
   */
  stubContext?: unknown;
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
    ...(opts.stubContext === undefined ? {} : { stubContext: opts.stubContext }),
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
