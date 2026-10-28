// lib/onboarding.ts
// Pure client state for the onboarding interview (FP-09 Step 4): the stage clock and
// route decision, the row-derived metric-chip payload, and the local multi-select state.
//
// No React, React Native or Supabase imports. The profile read lives in
// `lib/onboardingStage.ts` so this module stays jest-loadable without a client shim.
//
// The server is the authority: `profiles.onboarding_stage` drives routing and the
// indicator; `metadata.metric_options` on an assistant row is the only source of chips.
//
// Refs: FP-09 FR-7, FR-8, FR-9, FR-10; TECH-SPECS §5.3, §7.7, §7.9, §9; D10, D17.

export type OnboardingStage =
  | "intro"
  | "baseline"
  | "goals"
  | "routine"
  | "metric_selection"
  | "complete";

export const CHAT_ROUTE = "/(app)/chat" as const;
export const INTERVIEW_ROUTE = "/(onboarding)/interview" as const;

export interface OnboardingStep {
  stage: Exclude<OnboardingStage, "complete">;
  label: string;
}

/** The five visible steps. `complete` is the end state, not a sixth step. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { stage: "intro", label: "Start" },
  { stage: "baseline", label: "Baseline" },
  { stage: "goals", label: "Goals" },
  { stage: "routine", label: "Routine" },
  { stage: "metric_selection", label: "Metrics" },
];

const STAGE_INDEX: Record<Exclude<OnboardingStage, "complete">, number> = {
  intro: 0,
  baseline: 1,
  goals: 2,
  routine: 3,
  metric_selection: 4,
};

export function isOnboardingStage(value: unknown): value is OnboardingStage {
  return (
    value === "intro" ||
    value === "baseline" ||
    value === "goals" ||
    value === "routine" ||
    value === "metric_selection" ||
    value === "complete"
  );
}

/** Which shell owns the route for a stage. Unknown/null is treated as intake. */
export function entryRouteForStage(
  stage: OnboardingStage | null | undefined,
): typeof CHAT_ROUTE | typeof INTERVIEW_ROUTE {
  return stage === "complete" ? CHAT_ROUTE : INTERVIEW_ROUTE;
}

/** Zero-based step index; `complete` shows all five steps complete. */
export function onboardingStepIndex(
  stage: OnboardingStage | null | undefined,
): number {
  if (stage === "complete") return ONBOARDING_STEPS.length - 1;
  if (!stage) return 0;
  return STAGE_INDEX[stage];
}

/** Human label for the indicator. */
export function onboardingStepLabel(
  stage: OnboardingStage | null | undefined,
): string {
  if (stage === "complete") return "Complete";
  if (!stage) return ONBOARDING_STEPS[0].label;
  return ONBOARDING_STEPS[STAGE_INDEX[stage]].label;
}

/**
 * The newest stage stamp in the thread. Rows carry the stage they answered in, so this
 * lags the profile by one exchange at a stage boundary; it is the offline/fallback
 * indicator value, never the routing authority.
 */
export function onboardingStageFromRows(
  rows: readonly { metadata?: Record<string, unknown> | null }[],
): OnboardingStage | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const value = rows[i].metadata?.onboarding_stage;
    if (isOnboardingStage(value)) return value;
  }
  return null;
}

/** One onboarding core-metric chip (`metadata.metric_options`, FP-09 §7.7). */
export interface MetricOption {
  key: string;
  label: string;
  domain: string;
  output_unit: string;
}

/** Shape-check the row-carried chip payload. Invalid entries are skipped. */
export function metricOptionsOf(metadata: unknown): MetricOption[] | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as { metric_options?: unknown }).metric_options;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const options: MetricOption[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    if (
      typeof o.key !== "string" ||
      o.key.length === 0 ||
      typeof o.label !== "string" ||
      o.label.length === 0 ||
      typeof o.domain !== "string" ||
      o.domain.length === 0 ||
      typeof o.output_unit !== "string" ||
      o.output_unit.length === 0 ||
      seen.has(o.key)
    ) {
      continue;
    }
    seen.add(o.key);
    options.push({
      key: o.key,
      label: o.label,
      domain: o.domain,
      output_unit: o.output_unit,
    });
  }
  return options.length > 0 ? options : null;
}

export type MetricChipPhase = "choosing" | "confirming" | "settled" | "error";

export interface MetricChipSettlement {
  status: "ok" | "duplicate";
  /** Labels from the row the user tapped, in tap order. */
  names: readonly string[];
}

export interface MetricChipState {
  selected: readonly string[];
  phase: MetricChipPhase;
  settlement?: MetricChipSettlement;
  error?: string;
}

export type MetricChipAction =
  | { type: "toggle"; key: string; options: readonly MetricOption[] }
  | { type: "begin" }
  | { type: "settle"; status: "ok" | "duplicate"; names: readonly string[] }
  | { type: "fail"; message: string };

export const INITIAL_METRIC_CHIP_STATE: MetricChipState = {
  selected: [],
  phase: "choosing",
};

/** 1–2 unique keys, exactly the server's contract. */
export function canConfirmMetric(selected: readonly string[]): boolean {
  return (
    selected.length >= 1 &&
    selected.length <= 2 &&
    new Set(selected).size === selected.length
  );
}

export function metricChipReducer(
  state: MetricChipState,
  action: MetricChipAction,
): MetricChipState {
  switch (action.type) {
    case "toggle": {
      if (state.phase === "confirming" || state.phase === "settled") {
        return state;
      }
      const known = action.options.some((option) => option.key === action.key);
      if (!known) return state;

      const selected = state.selected.includes(action.key)
        ? state.selected.filter((key) => key !== action.key)
        : state.selected.length >= 2
          ? state.selected
          : [...state.selected, action.key];

      if (selected === state.selected) {
        if (state.phase !== "error") return state;
        return { ...state, phase: "choosing", error: undefined };
      }
      return {
        selected,
        phase: "choosing",
        error: undefined,
      };
    }

    case "begin": {
      if (state.phase !== "choosing" && state.phase !== "error") return state;
      if (!canConfirmMetric(state.selected)) return state;
      return { ...state, phase: "confirming", error: undefined };
    }

    case "settle":
      return {
        selected: state.selected,
        phase: "settled",
        settlement: { status: action.status, names: action.names },
      };

    case "fail":
      return {
        selected: state.selected,
        phase: "error",
        error: action.message,
      };

    default:
      return state;
  }
}

/** Chosen names from the row's own labels, in tap order, with the key as fallback. */
export function metricChoiceLabels(
  options: readonly MetricOption[],
  selected: readonly string[],
): string[] {
  const byKey = new Map(options.map((option) => [option.key, option.label]));
  return selected.map((key) => byKey.get(key) ?? key);
}
