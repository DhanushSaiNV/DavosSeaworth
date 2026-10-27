// supabase/functions/_shared/onboarding/apply.ts
// FP-09 Step 3 — the database-facing half of the onboarding turn (TECH-SPEC §7.7).
// Refs: FP-09 FR-4, FR-5; TECH-SPEC §5.1, §5.3, §7.6, §7.7; D8, D17, D20, D21.
//
// The decisions live in the pure `state.ts`; this module only touches the database. It is
// the single writer for the onboarding profile fields, the baseline facts and the stage
// compare-and-set, so the drill and `send-message` exercise the same code.
//
// Failure posture:
//   * stage read failure → `complete` with one warning (the old chat path, never a hijack);
//   * stamp failure → the turn still proceeds and the current answer is counted once;
//   * apply failure → the reply is already committed and the caller logs it;
//   * advance compare-and-set losing the race → a no-op, never an error.

import { getConfig, supabaseService } from "../config.ts";
import {
  normalizeOnboardingBlock,
  type OnboardingWarning,
} from "../pipeline/extractContract.ts";
import { METRIC_PRESETS } from "../metrics/presets.ts";
import {
  ONBOARDING_SOURCE,
  ONBOARDING_STAGES,
  advanceTarget,
  chipPayload,
  nextAction,
  selectPresets,
  type MetricOption,
  type NextAction,
  type OnboardingStage,
  type StageCounts,
} from "./state.ts";

export const ONBOARDING_OPENING_SOURCE = "onboarding_opening";
export const ONBOARDING_STAGE_METADATA = "onboarding_stage";

export interface PreparedOnboardingTurn {
  stage: OnboardingStage;
  answeredInStage: number;
  action: NextAction;
  /** The compare-and-set target, present only when `action.kind === "advance"`. */
  advanceTo: OnboardingStage | null;
  persona: string;
  counts: StageCounts;
}

export interface InterviewMetricContext {
  domainCounts: Record<string, number>;
  latestOptions: MetricOption[] | null;
}

export interface ApplyOnboardingReport {
  fields: string[];
  facts: number;
  skippedFacts: boolean;
  warnings: OnboardingWarning[];
}

export interface ResetOnboardingReport {
  deletedMessages: number;
  deletedFacts: number;
  openingId: string;
}

export class OnboardingResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingResetRefusedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function domainOf(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const domain = metadata.domain;
  return typeof domain === "string" && domain.length > 0 ? domain : null;
}

/** A stored chip list is server state; a malformed one is recomputed, never partially used. */
function parseMetricOptions(raw: unknown): MetricOption[] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const options: MetricOption[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const { key, label, domain, output_unit: outputUnit } = item;
    if (
      typeof key !== "string" || key.length === 0 ||
      typeof label !== "string" || label.length === 0 ||
      typeof domain !== "string" || domain.length === 0 ||
      typeof outputUnit !== "string" || outputUnit.length === 0
    ) {
      return null;
    }
    options.push({ key, label, domain, output_unit: outputUnit });
  }
  return options;
}

/**
 * The profile stage. A missing profile or a malformed/unknown value is treated as
 * `complete` so a transient read failure answers as ordinary chat instead of hijacking
 * the turn into an interview. The next turn retries the read.
 */
export async function readOnboardingStage(userId: string): Promise<OnboardingStage> {
  try {
    const { data, error } = await supabaseService
      .from("profiles")
      .select("onboarding_stage")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    const raw = data?.onboarding_stage;
    if (typeof raw === "string" && (ONBOARDING_STAGES as readonly string[]).includes(raw)) {
      return raw as OnboardingStage;
    }
    console.warn(
      "[onboarding] profile stage missing or invalid — treating the turn as complete",
      JSON.stringify({ userId, stage: raw ?? null }),
    );
    return "complete";
  } catch (err) {
    console.warn(
      "[onboarding] profile stage read failed — treating the turn as complete:",
      err instanceof Error ? err.message : err,
    );
    return "complete";
  }
}

/**
 * Stamp the user row before counting, so the current answer is part of the stage clock.
 * The row's source is also what the `autoAdopt` walk treats as transparent.
 */
async function stampOnboardingUserMessage(
  userId: string,
  messageId: string,
  stage: OnboardingStage,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseService
      .from("messages")
      .update({
        metadata: {
          source: ONBOARDING_SOURCE,
          [ONBOARDING_STAGE_METADATA]: stage,
        },
      })
      .eq("id", messageId)
      .eq("user_id", userId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.warn(
      "[onboarding] turn stamp failed — counting this answer once anyway:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function countStageAnswers(userId: string, stage: OnboardingStage): Promise<number> {
  const { count, error } = await supabaseService
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .eq("metadata->>source", ONBOARDING_SOURCE)
    .eq("metadata->>onboarding_stage", stage);
  if (error) throw error;
  return count ?? 0;
}

function parseStageCounts(raw: unknown): StageCounts {
  if (!isRecord(raw)) {
    throw new Error('config key "onboarding_stage_questions" is missing or malformed');
  }
  return raw as StageCounts;
}

/**
 * Stamp + count the turn, read the [SPEC] values, and derive the deterministic next
 * action. One profile-adjacent write and one bounded count; no provider calls.
 */
export async function prepareOnboardingTurn(args: {
  userId: string;
  messageId: string;
  stage: OnboardingStage;
}): Promise<PreparedOnboardingTurn | null> {
  if (args.stage === "complete") return null;

  const stamped = await stampOnboardingUserMessage(args.userId, args.messageId, args.stage);
  const counted = await countStageAnswers(args.userId, args.stage);
  // A failed stamp leaves the current row out of the count; count it exactly once here.
  const answeredInStage = counted + (stamped ? 0 : 1);

  const [rawCounts, persona] = await Promise.all([
    getConfig("onboarding_stage_questions"),
    getConfig("onboarding_persona"),
  ]);
  if (typeof persona !== "string" || persona.length === 0) {
    throw new Error('config key "onboarding_persona" is missing or malformed');
  }
  const counts = parseStageCounts(rawCounts);
  const action = nextAction(args.stage, answeredInStage, counts);
  const target = action.kind === "advance" ? advanceTarget(args.stage) : null;

  return {
    stage: args.stage,
    answeredInStage,
    action,
    advanceTo: target?.to ?? null,
    persona,
    counts,
  };
}

/**
 * Prior interview assistant rows are the preset input. The first proposal also adds the
 * current turn's classified domain; a re-offer reads the stored list instead, so it is
 * byte-identical even if the frequency table has moved.
 */
export async function loadInterviewMetricContext(
  userId: string,
): Promise<InterviewMetricContext> {
  try {
    const { data, error } = await supabaseService
      .from("messages")
      .select("metadata")
      .eq("user_id", userId)
      .eq("role", "assistant")
      .eq("metadata->>source", ONBOARDING_SOURCE)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const domainCounts: Record<string, number> = {};
    let latestOptions: MetricOption[] | null = null;
    for (const row of data ?? []) {
      const metadata = (row as { metadata?: unknown }).metadata;
      const domain = domainOf(metadata);
      if (domain) domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
      if (!latestOptions && isRecord(metadata)) {
        latestOptions = parseMetricOptions(metadata.metric_options);
      }
    }
    return { domainCounts, latestOptions };
  } catch (err) {
    console.warn(
      "[onboarding] metric context read failed — using the catalog fallback:",
      err instanceof Error ? err.message : err,
    );
    return { domainCounts: {}, latestOptions: null };
  }
}

/**
 * The chip list for this turn. `metric_selection` reuses whatever the proposal stored;
 * every other call computes from prior domains plus the current classified domain.
 */
export function resolveMetricOptions(args: {
  context: InterviewMetricContext;
  stage: OnboardingStage;
  currentDomain: string;
}): MetricOption[] {
  if (args.stage === "metric_selection" && args.context.latestOptions) {
    return args.context.latestOptions;
  }
  const domainCounts = { ...args.context.domainCounts };
  if (args.currentDomain.length > 0) {
    domainCounts[args.currentDomain] = (domainCounts[args.currentDomain] ?? 0) + 1;
  }
  return chipPayload(selectPresets(domainCounts, METRIC_PRESETS)).metric_options;
}

/**
 * Write the validated block. Profile fields are overwritten idempotently; baseline facts
 * are at-most-once per source row (a repair replay sees the existing fact and skips).
 */
export async function applyOnboardingBlock(args: {
  userId: string;
  messageId: string;
  rawBlock: unknown;
  embedding: number[] | null;
  embedModel: string | null;
}): Promise<ApplyOnboardingReport> {
  const normalized = normalizeOnboardingBlock(args.rawBlock);
  const report: ApplyOnboardingReport = {
    fields: [],
    facts: 0,
    skippedFacts: false,
    warnings: normalized.warnings,
  };
  const block = normalized.block;
  if (!block) return report;

  const patch: Record<string, unknown> = {};
  if (block.wake_time !== undefined) {
    patch.wake_time = block.wake_time;
    report.fields.push("wake_time");
  }
  if (block.sleep_time !== undefined) {
    patch.sleep_time = block.sleep_time;
    report.fields.push("sleep_time");
  }
  if (block.routine_summary !== undefined) {
    patch.routine = { summary: block.routine_summary };
    report.fields.push("routine");
  }
  if (block.high_dopamine_activities !== undefined) {
    patch.high_dopamine_activities = block.high_dopamine_activities;
    report.fields.push("high_dopamine_activities");
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabaseService
      .from("profiles")
      .update(patch)
      .eq("id", args.userId);
    if (error) throw error;
  }

  const facts = block.baseline_facts ?? [];
  if (facts.length > 0) {
    if (!args.embedding || args.embedding.length === 0) {
      report.skippedFacts = true;
      console.warn(
        "[onboarding] baseline facts skipped — the turn has no embedding",
        JSON.stringify({ userId: args.userId, messageId: args.messageId }),
      );
    } else {
      const { data: existing, error: existingError } = await supabaseService
        .from("memory_facts")
        .select("id")
        .eq("user_id", args.userId)
        .eq("source_message_id", args.messageId)
        .eq("fact_type", "baseline")
        .limit(1);
      if (existingError) throw existingError;

      if ((existing?.length ?? 0) === 0) {
        const { error: factError } = await supabaseService.from("memory_facts").insert(
          facts.map((fact) => ({
            user_id: args.userId,
            fact,
            fact_type: "baseline",
            source_message_id: args.messageId,
            embed_model: args.embedModel,
            embedding: args.embedding,
          })),
        );
        if (factError) throw factError;
        report.facts = facts.length;
      }
    }
  }

  console.log(
    JSON.stringify({
      tag: "[onboarding]",
      event: "applied",
      userId: args.userId,
      messageId: args.messageId,
      fields: report.fields,
      facts: report.facts,
      skippedFacts: report.skippedFacts,
      warnings: report.warnings,
    }),
  );
  return report;
}

/** The production advance. A lost race is a no-op; a DB error is surfaced to the caller. */
export async function advanceOnboardingStage(args: {
  userId: string;
  from: OnboardingStage;
  to: OnboardingStage;
}): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("profiles")
    .update({ onboarding_stage: args.to })
    .eq("id", args.userId)
    .eq("onboarding_stage", args.from)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Dev-only forced transition (the dead-state valve). */
export async function forceOnboardingStage(args: {
  userId: string;
  to: OnboardingStage;
}): Promise<{ from: OnboardingStage; to: OnboardingStage }> {
  const { data: profile, error: readError } = await supabaseService
    .from("profiles")
    .select("onboarding_stage")
    .eq("id", args.userId)
    .maybeSingle();
  if (readError) throw readError;
  if (!profile) throw new Error("profile not found");
  const from = profile.onboarding_stage as OnboardingStage;
  const { error } = await supabaseService
    .from("profiles")
    .update({ onboarding_stage: args.to })
    .eq("id", args.userId);
  if (error) throw error;
  return { from, to: args.to };
}

/**
 * Dev-only reset. Oath facts are non-purgeable (AGENTS §4.8), so a reset refuses if one
 * references an onboarding row. Other derived facts are deleted before their messages,
 * because `memory_facts.source_message_id` is a foreign key.
 */
export async function resetOnboardingDrill(userId: string): Promise<ResetOnboardingReport> {
  // Two equality reads rather than `in` over a JSON path: PostgREST's JSON-path operator
  // filtering is reliable for `eq` (the stage count uses it); the reset must not depend on
  // the array form.
  const [turnRows, openingRows] = await Promise.all([
    supabaseService
      .from("messages")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>source", ONBOARDING_SOURCE),
    supabaseService
      .from("messages")
      .select("id")
      .eq("user_id", userId)
      .eq("metadata->>source", ONBOARDING_OPENING_SOURCE),
  ]);
  if (turnRows.error) throw turnRows.error;
  if (openingRows.error) throw openingRows.error;
  const ids = [...(turnRows.data ?? []), ...(openingRows.data ?? [])]
    .map((row) => row.id as string);
  let deletedFactsCount = 0;

  if (ids.length > 0) {
    const { data: oathFacts, error: oathError } = await supabaseService
      .from("memory_facts")
      .select("id")
      .eq("user_id", userId)
      .eq("fact_type", "oath")
      .in("source_message_id", ids)
      .limit(1);
    if (oathError) throw oathError;
    if ((oathFacts?.length ?? 0) > 0) {
      throw new OnboardingResetRefusedError(
        "reset refused: an oath fact references an onboarding row (non-purgeable)",
      );
    }

    const { data: deletedFacts, error: factsError } = await supabaseService
      .from("memory_facts")
      .delete()
      .eq("user_id", userId)
      .in("source_message_id", ids)
      .neq("fact_type", "oath")
      .select("id");
    if (factsError) throw factsError;
    deletedFactsCount = deletedFacts?.length ?? 0;

    const { error: messagesError } = await supabaseService
      .from("messages")
      .delete()
      .eq("user_id", userId)
      .in("id", ids);
    if (messagesError) throw messagesError;
  }

  const openingText = await getConfig("onboarding_opening_text");
  if (typeof openingText !== "string" || openingText.length === 0) {
    throw new Error('config key "onboarding_opening_text" is missing or malformed');
  }

  const { error: profileError } = await supabaseService
    .from("profiles")
    .update({
      onboarding_stage: "intro",
      wake_time: null,
      sleep_time: null,
      routine: {},
      high_dopamine_activities: [],
    })
    .eq("id", userId);
  if (profileError) throw profileError;

  const { data: opening, error: openingError } = await supabaseService
    .from("messages")
    .insert({
      user_id: userId,
      role: "assistant",
      content: openingText,
      metadata: { source: ONBOARDING_OPENING_SOURCE, onboarding_stage: "intro" },
      persona_key: null,
    })
    .select("id")
    .single();
  if (openingError) throw openingError;

  return {
    deletedMessages: ids.length,
    deletedFacts: deletedFactsCount,
    openingId: opening.id as string,
  };
}
