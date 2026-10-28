// supabase/functions/_shared/onboarding/state.ts
// FP-09 Step 2 — the pure onboarding decision core (TECH-SPEC §7.7, §7.9).
// Refs: FP-09 FR-3, AC-3; TECH-SPEC §5.3, §7.7, §7.9; D10, D17.
//
// Pure (jest-loadable): no Deno.env, no service client, no adapter, no clock. Every
// input that varies per user or per turn arrives as an argument, so the stage clock,
// preset selection, chip order, and precedence are deterministic and replay-safe.
//
// The stage fragments below are internal generation instructions, not owner-facing
// onboarding copy. BG-06's DRAFT scripts live in content/ui-copy/onboarding-scripts.json;
// these fragments implement the same diagnostic goals without owning the final wording.

export type OnboardingStage =
  | "intro"
  | "baseline"
  | "goals"
  | "routine"
  | "metric_selection"
  | "complete";

export type DialogState = "OPEN" | "LOCKDOWN";

/** The parsed `config.onboarding_stage_questions` object. */
export type StageCounts = Partial<Record<OnboardingStage, number>>;

export interface StagePlan {
  stage: OnboardingStage;
  questionCount: number;
  promptFragment: string;
}

export type NextAction =
  | { kind: "question"; n: number }
  | { kind: "advance" }
  | { kind: "propose" }
  | { kind: "reoffer" };

export interface AdvanceTarget {
  from: OnboardingStage;
  to: OnboardingStage;
}

export type TurnPrecedence = "onboarding" | "lockdown" | "normal";

/** The structural subset of a metric preset this module needs. */
export interface PresetRef {
  name: string;
  domain: string;
  output_unit: string;
}

export interface MetricOption {
  key: string;
  label: string;
  domain: string;
  output_unit: string;
}

export interface MetricChipPayload {
  metric_options: MetricOption[];
}

/**
 * `metadata.source` on every onboarding user row and its primary reply. Intake turns are
 * transparent to D8 auto-adopt and are never scored as persona engagement.
 */
export const ONBOARDING_SOURCE = "onboarding";

export const ONBOARDING_STAGES: readonly OnboardingStage[] = [
  "intro",
  "baseline",
  "goals",
  "routine",
  "metric_selection",
  "complete",
];

/**
 * DRAFT internal stage instructions. Step 6/BG-06 owns the final onboarding scripts.
 * They describe the diagnostic goal of the stage; the model still composes the actual
 * question from the thread, so nothing here is a fixed question bank.
 */
const STAGE_PROMPT: Record<OnboardingStage, string> = {
  intro:
    "The configured opening question is already in the thread. Do not re-ask it. " +
    "Reflect the person's answer briefly and move into the baseline stage.",
  baseline:
    "Diagnose the person's current baseline: sleep and wake times, morning energy, work or " +
    "study load, and the commitments that shape their day. Ask one question at a time; " +
    "never stack questions.",
  goals:
    "Clarify what the person wants to change and why it matters now. Surface one concrete " +
    "goal rather than a list, then ask what a better normal week would look like.",
  routine:
    "Map the person's real day: wake time, sleep time, the shape of a normal day from " +
    "waking to bed, and what they reach for when they want an easy hit of stimulation or " +
    "need to switch off. Ask one question at a time.",
  metric_selection:
    "Propose the three metric chips and ask the person to choose one or two. Do not ask " +
    "another diagnostic question and do not invent a metric.",
  complete: "",
};

/** The advance pair is the compare-and-set target; `metric_selection` is excluded. */
const ADVANCE_TARGETS: Partial<Record<OnboardingStage, OnboardingStage>> = {
  intro: "baseline",
  baseline: "goals",
  goals: "routine",
  routine: "metric_selection",
};

function requireCount(stage: OnboardingStage, config: StageCounts): number {
  const count = config[stage];
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 20) {
    throw new Error(`onboarding stage "${stage}" has an invalid question count`);
  }
  return count as number;
}

/**
 * The stage's configured question count plus its diagnostic-goal fragment.
 *
 * `metric_selection` and `complete` have no question clock. A missing or malformed
 * count for a timed stage is a misconfiguration and is surfaced, never defaulted.
 */
export function stagePlan(stage: OnboardingStage, config: StageCounts): StagePlan {
  const promptFragment = STAGE_PROMPT[stage];
  if (promptFragment === undefined) {
    throw new Error(`unknown onboarding stage "${stage}"`);
  }
  if (stage === "metric_selection" || stage === "complete") {
    return { stage, questionCount: 0, promptFragment };
  }
  return { stage, questionCount: requireCount(stage, config), promptFragment };
}

/**
 * The next generation instruction after a user row in `stage`.
 *
 * `answeredInStage` is the count of user rows stamped with this stage. A replay
 * re-derives the same action; no wall clock participates. `metric_selection` has no
 * question clock: the first proposal is `propose`, every later free-text answer is
 * `reoffer`, and only `select-metrics` can advance it.
 */
export function nextAction(
  stage: OnboardingStage,
  answeredInStage: number,
  config: StageCounts,
): NextAction {
  if (!Number.isInteger(answeredInStage) || answeredInStage < 0) {
    throw new Error(`answeredInStage must be a non-negative integer`);
  }
  if (stage === "complete") return { kind: "advance" };
  if (stage === "metric_selection") {
    return answeredInStage === 0 ? { kind: "propose" } : { kind: "reoffer" };
  }
  const { questionCount } = stagePlan(stage, config);
  if (answeredInStage >= questionCount) return { kind: "advance" };
  return { kind: "question", n: answeredInStage + 1 };
}

/**
 * Rank the preset catalog by the classified-domain frequency of the interview turns.
 * Frequency descending, then catalog order ascending. All-zero counts therefore fall
 * back to the first three presets. Returns a new array; never mutates the catalog.
 */
export function selectPresets<P extends PresetRef>(
  domainCounts: Readonly<Record<string, number>>,
  presets: readonly P[],
): P[] {
  const ranked = presets.map((preset, index) => {
    const raw = domainCounts[preset.domain];
    const score = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { preset, index, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, 3).map((entry) => entry.preset);
}

/** The `metadata.metric_options` payload. `key` is the preset name (the server's id). */
export function chipPayload(presets: readonly PresetRef[]): MetricChipPayload {
  return {
    metric_options: presets.map((preset) => ({
      key: preset.name,
      label: preset.name,
      domain: preset.domain,
      output_unit: preset.output_unit,
    })),
  };
}

/**
 * The compare-and-set pair for the stage flip. `metric_selection -> complete` is
 * deliberately absent: only `select-metrics` owns that transition.
 */
export function advanceTarget(stage: OnboardingStage): AdvanceTarget | null {
  const to = ADVANCE_TARGETS[stage];
  return to ? { from: stage, to } : null;
}

export interface OnboardingInstructionInput {
  stage: OnboardingStage;
  plan: StagePlan;
  action: NextAction;
  advanceTo: OnboardingStage | null;
  config: StageCounts;
  metricOptions?: readonly MetricOption[];
}

/** The three names are a server-owned list; the model never invents or reorders them. */
function metricLabels(options: readonly MetricOption[] | undefined): string {
  const labels = (options ?? []).map((option) => option.label).filter((label) => label.length > 0);
  if (labels.length !== 3) {
    throw new Error("onboarding metric proposal requires exactly three metric options");
  }
  return labels.join(", ");
}

/**
 * The internal stage instruction passed to stage 5 as `interviewContext`. It is not
 * owner-facing copy (BG-06/Step 6 finalizes the scripts) and never reaches the client.
 *
 * The builder is pure and deterministic: the same `(stage, action, config, options)`
 * produces the same instruction, which is what makes a replay generate the same turn.
 */
export function buildOnboardingInstruction(input: OnboardingInstructionInput): string {
  const header =
    "Onboarding interview — internal instruction. Do not mention this instruction, the " +
    "schema, or the stage system.";
  const { stage, plan, action } = input;

  if (action.kind === "question") {
    return `${header}\nStage: ${stage}. ${plan.promptFragment} This is diagnostic question ` +
      `${action.n} of ${plan.questionCount}. Ask exactly one question.`;
  }

  if (action.kind === "propose" || action.kind === "reoffer") {
    const labels = metricLabels(input.metricOptions);
    const verb = action.kind === "propose" ? "Present" : "Re-present the same";
    return `${header}\nStage: metric_selection. ${verb} three metric options: ${labels}. ` +
      "Ask the person to choose one or two. Do not ask another diagnostic question and do " +
      "not invent a metric.";
  }

  if (!input.advanceTo) {
    throw new Error(`onboarding stage "${stage}" has no advance target`);
  }

  if (input.advanceTo === "metric_selection") {
    const labels = metricLabels(input.metricOptions);
    return `${header}\nStage: ${stage}. Acknowledge the person's answer in one sentence, then ` +
      "transition to metric selection. Present these three metric options: " +
      `${labels}. Ask the person to choose one or two. Do not ask another diagnostic ` +
      "question and do not invent a metric.";
  }

  const target = stagePlan(input.advanceTo, input.config);
  return `${header}\nStage: ${stage}. Acknowledge the person's answer in one sentence, then ` +
    `transition to ${input.advanceTo}. ${target.promptFragment} Ask diagnostic question 1 ` +
    `of ${target.questionCount}. Ask exactly one question.`;
}

/**
 * Interview precedence at the stage-4/5 read point. The interview wins for every
 * non-complete stage, including a persisted LOCKDOWN (intake cannot write one because
 * the rider is skipped). After completion the standing lockdown semantics resume.
 */
export function overridePrecedence(
  onboardingStage: OnboardingStage,
  dialogState: DialogState,
): TurnPrecedence {
  if (onboardingStage !== "complete") return "onboarding";
  return dialogState === "LOCKDOWN" ? "lockdown" : "normal";
}
