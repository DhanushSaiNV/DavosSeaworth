// lib/onboarding.test.ts
// Pure onboarding client state: routing, stage steps, metric payload and chip state.
// Refs: FP-09 FR-7, FR-8, FR-9, FR-10; TECH-SPECS §5.3, §7.7, §9.

import {
  CHAT_ROUTE,
  INTERVIEW_ROUTE,
  INITIAL_METRIC_CHIP_STATE,
  canConfirmMetric,
  entryRouteForStage,
  isOnboardingStage,
  metricChipReducer,
  metricChoiceLabels,
  metricOptionsOf,
  onboardingStageFromRows,
  onboardingStepIndex,
  onboardingStepLabel,
  type MetricOption,
} from "./onboarding";

const OPTIONS: MetricOption[] = [
  { key: "Momentum", label: "Momentum", domain: "Discipline/Habits", output_unit: "doings" },
  { key: "Deep Work Hours", label: "Deep Work Hours", domain: "Career", output_unit: "h" },
  { key: "Energy Level", label: "Energy Level", domain: "Health", output_unit: "/10" },
];

describe("onboarding routing", () => {
  it("sends every intake stage to the interview and complete to the app", () => {
    for (const stage of ["intro", "baseline", "goals", "routine", "metric_selection"] as const) {
      expect(entryRouteForStage(stage)).toBe(INTERVIEW_ROUTE);
    }
    expect(entryRouteForStage("complete")).toBe(CHAT_ROUTE);
    expect(entryRouteForStage(null)).toBe(INTERVIEW_ROUTE);
  });

  it("maps stages to five visible steps", () => {
    expect(onboardingStepIndex("intro")).toBe(0);
    expect(onboardingStepIndex("baseline")).toBe(1);
    expect(onboardingStepIndex("goals")).toBe(2);
    expect(onboardingStepIndex("routine")).toBe(3);
    expect(onboardingStepIndex("metric_selection")).toBe(4);
    expect(onboardingStepIndex("complete")).toBe(4);
    expect(onboardingStepIndex(null)).toBe(0);

    expect(onboardingStepLabel("intro")).toBe("Start");
    expect(onboardingStepLabel("metric_selection")).toBe("Metrics");
    expect(onboardingStepLabel("complete")).toBe("Complete");
    expect(onboardingStepLabel(null)).toBe("Start");
  });

  it("validates stage values", () => {
    expect(isOnboardingStage("routine")).toBe(true);
    expect(isOnboardingStage("done")).toBe(false);
    expect(isOnboardingStage(null)).toBe(false);
  });
});

describe("onboardingStageFromRows", () => {
  it("uses the newest valid stage stamp, ignoring invalid metadata", () => {
    const rows = [
      { metadata: { onboarding_stage: "intro" } },
      { metadata: { onboarding_stage: "nonsense" } },
      { metadata: { onboarding_stage: "baseline" } },
      { metadata: null },
    ];
    expect(onboardingStageFromRows(rows)).toBe("baseline");
  });

  it("returns null when no row carries a stage", () => {
    expect(onboardingStageFromRows([{ metadata: {} }, { metadata: null }])).toBeNull();
  });
});

describe("metricOptionsOf", () => {
  it("shape-checks metadata.metric_options and drops malformed entries", () => {
    expect(
      metricOptionsOf({
        metric_options: [
          OPTIONS[0],
          { key: "bad" },
          { key: "bad", label: "", domain: "x", output_unit: "u" },
          OPTIONS[1],
        ],
      }),
    ).toEqual([OPTIONS[0], OPTIONS[1]]);
  });

  it("returns null for absent, empty or malformed payloads", () => {
    expect(metricOptionsOf(null)).toBeNull();
    expect(metricOptionsOf({})).toBeNull();
    expect(metricOptionsOf({ metric_options: [] })).toBeNull();
    expect(metricOptionsOf({ metric_options: "x" })).toBeNull();
  });
});

describe("metric chip reducer", () => {
  it("multi-toggles up to two keys and allows deselection", () => {
    let state = INITIAL_METRIC_CHIP_STATE;
    state = metricChipReducer(state, { type: "toggle", key: "Momentum", options: OPTIONS });
    state = metricChipReducer(state, {
      type: "toggle",
      key: "Deep Work Hours",
      options: OPTIONS,
    });
    state = metricChipReducer(state, { type: "toggle", key: "Energy Level", options: OPTIONS });
    expect(state.selected).toEqual(["Momentum", "Deep Work Hours"]);

    state = metricChipReducer(state, { type: "toggle", key: "Momentum", options: OPTIONS });
    expect(state.selected).toEqual(["Deep Work Hours"]);
  });

  it("ignores unknown keys and Confirm before a selection", () => {
    let state = metricChipReducer(INITIAL_METRIC_CHIP_STATE, {
      type: "toggle",
      key: "unknown",
      options: OPTIONS,
    });
    expect(state.selected).toEqual([]);
    state = metricChipReducer(state, { type: "begin" });
    expect(state.phase).toBe("choosing");
  });

  it("confirms one or two and settles with the chosen names", () => {
    expect(canConfirmMetric([])).toBe(false);
    expect(canConfirmMetric(["Momentum"])).toBe(true);
    expect(canConfirmMetric(["Momentum", "Deep Work Hours"])).toBe(true);
    expect(canConfirmMetric(["Momentum", "Momentum"])).toBe(false);
    expect(canConfirmMetric(["Momentum", "Deep Work Hours", "Energy Level"])).toBe(false);

    let state = metricChipReducer(INITIAL_METRIC_CHIP_STATE, {
      type: "toggle",
      key: "Momentum",
      options: OPTIONS,
    });
    state = metricChipReducer(state, { type: "begin" });
    expect(state.phase).toBe("confirming");
    state = metricChipReducer(state, {
      type: "settle",
      status: "ok",
      names: ["Momentum"],
    });
    expect(state.phase).toBe("settled");
    expect(state.settlement).toEqual({ status: "ok", names: ["Momentum"] });
    // Settled is terminal for the local strip.
    expect(
      metricChipReducer(state, { type: "toggle", key: "Energy Level", options: OPTIONS }),
    ).toBe(state);
  });

  it("re-enables selection after a failure", () => {
    let state = metricChipReducer(INITIAL_METRIC_CHIP_STATE, {
      type: "toggle",
      key: "Momentum",
      options: OPTIONS,
    });
    state = metricChipReducer(state, { type: "begin" });
    state = metricChipReducer(state, { type: "fail", message: "Try again." });
    expect(state.phase).toBe("error");
    expect(state.error).toBe("Try again.");
    state = metricChipReducer(state, {
      type: "toggle",
      key: "Energy Level",
      options: OPTIONS,
    });
    expect(state.phase).toBe("choosing");
    expect(state.error).toBeUndefined();
  });
});

describe("metricChoiceLabels", () => {
  it("returns labels in tap order and falls back to the key", () => {
    expect(metricChoiceLabels(OPTIONS, ["Deep Work Hours", "missing"])).toEqual([
      "Deep Work Hours",
      "missing",
    ]);
  });
});
