// supabase/functions/_shared/onboarding/state.test.ts
// FP-09 Step 2 — the pure onboarding decision tables (FR-3, AC-3).
// Refs: FP-09 FR-3, AC-3; TECH-SPEC §5.3, §7.7, §7.9; D10, D17.
// Jest globals declared inline so this tree loads without importing the jest package
// (tsconfig.json excludes supabase/functions).

import {
  advanceTarget,
  buildOnboardingInstruction,
  chipPayload,
  nextAction,
  overridePrecedence,
  selectPresets,
  stagePlan,
  type MetricOption,
  type PresetRef,
  type StageCounts,
} from "./state.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeGreaterThan(expected: number): void;
  toContain(expected: unknown): void;
  toThrow(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const COUNTS: StageCounts = {
  intro: 1,
  baseline: 3,
  goals: 3,
  routine: 4,
  metric_selection: 0,
};

const CATALOG: readonly PresetRef[] = [
  { name: "Career A", domain: "Career", output_unit: "h" },
  { name: "Fitness B", domain: "Fitness", output_unit: "min" },
  { name: "Career C", domain: "Career", output_unit: "%" },
  { name: "Health D", domain: "Health", output_unit: "/10" },
];

describe("stagePlan (FR-3)", () => {
  it("reads the configured counts and returns a non-empty diagnostic fragment", () => {
    expect(stagePlan("intro", COUNTS).questionCount).toBe(1);
    expect(stagePlan("baseline", COUNTS).questionCount).toBe(3);
    expect(stagePlan("goals", COUNTS).questionCount).toBe(3);
    expect(stagePlan("routine", COUNTS).questionCount).toBe(4);
    expect(stagePlan("metric_selection", COUNTS).questionCount).toBe(0);
    expect(stagePlan("complete", COUNTS).questionCount).toBe(0);
    expect(stagePlan("baseline", COUNTS).promptFragment.length).toBeGreaterThan(0);
    expect(stagePlan("complete", COUNTS).promptFragment).toBe("");
  });

  it("surfaces a missing or malformed timed-stage count instead of defaulting", () => {
    expect(() => stagePlan("baseline", { baseline: 0 })).toThrow();
    expect(() => stagePlan("routine", {})).toThrow();
  });
});

describe("nextAction (FR-3)", () => {
  it("asks question N+1 until the configured boundary", () => {
    expect(nextAction("intro", 0, COUNTS)).toEqual({ kind: "question", n: 1 });
    expect(nextAction("intro", 1, COUNTS)).toEqual({ kind: "advance" });
    expect(nextAction("baseline", 0, COUNTS)).toEqual({ kind: "question", n: 1 });
    expect(nextAction("baseline", 2, COUNTS)).toEqual({ kind: "question", n: 3 });
    expect(nextAction("baseline", 3, COUNTS)).toEqual({ kind: "advance" });
    expect(nextAction("goals", 3, COUNTS)).toEqual({ kind: "advance" });
    expect(nextAction("routine", 3, COUNTS)).toEqual({ kind: "question", n: 4 });
    expect(nextAction("routine", 4, COUNTS)).toEqual({ kind: "advance" });
  });

  it("resumes a mid-stage close on the next answer without re-asking or skipping", () => {
    expect(nextAction("baseline", 1, COUNTS)).toEqual({ kind: "question", n: 2 });
    expect(nextAction("routine", 2, COUNTS)).toEqual({ kind: "question", n: 3 });
  });

  it("never uses a clock for metric_selection and re-offers after free text", () => {
    expect(nextAction("metric_selection", 0, COUNTS)).toEqual({ kind: "propose" });
    expect(nextAction("metric_selection", 1, COUNTS)).toEqual({ kind: "reoffer" });
    expect(nextAction("metric_selection", 9, COUNTS)).toEqual({ kind: "reoffer" });
  });

  it("is replay-deterministic: the same stage/count always yields the same action", () => {
    const first = nextAction("goals", 2, COUNTS);
    const replay = nextAction("goals", 2, COUNTS);
    expect(replay).toEqual(first);
  });

  it("returns the unreachable complete sentinel without a question", () => {
    expect(nextAction("complete", 0, COUNTS)).toEqual({ kind: "advance" });
  });
});

describe("selectPresets (FR-3)", () => {
  it("ranks by classified-domain frequency and uses catalog order for ties", () => {
    const picked = selectPresets({ Fitness: 5, Career: 2 }, CATALOG);
    expect(picked.map((p) => p.name)).toEqual(["Fitness B", "Career A", "Career C"]);
  });

  it("falls back to catalog order when every domain count is zero", () => {
    expect(selectPresets({}, CATALOG).map((p) => p.name)).toEqual([
      "Career A",
      "Fitness B",
      "Career C",
    ]);
    expect(selectPresets({ Fitness: 0, Career: 0 }, CATALOG).map((p) => p.name)).toEqual([
      "Career A",
      "Fitness B",
      "Career C",
    ]);
  });

  it("keeps catalog order for equal positive frequencies", () => {
    expect(selectPresets({ Career: 2 }, CATALOG).map((p) => p.name)).toEqual([
      "Career A",
      "Career C",
      "Fitness B",
    ]);
  });

  it("returns all presets when the catalog is shorter than three", () => {
    const short = CATALOG.slice(0, 2);
    expect(selectPresets({ Fitness: 9 }, short).map((p) => p.name)).toEqual([
      "Fitness B",
      "Career A",
    ]);
  });

  it("does not mutate the catalog", () => {
    const before = CATALOG.map((p) => p.name);
    selectPresets({ Health: 9 }, CATALOG);
    expect(CATALOG.map((p) => p.name)).toEqual(before);
  });
});

describe("chipPayload (FR-3, FR-8)", () => {
  it("produces the metric_options shape with the preset name as the server key", () => {
    expect(chipPayload(CATALOG.slice(0, 2))).toEqual({
      metric_options: [
        {
          key: "Career A",
          label: "Career A",
          domain: "Career",
          output_unit: "h",
        },
        {
          key: "Fitness B",
          label: "Fitness B",
          domain: "Fitness",
          output_unit: "min",
        },
      ],
    });
  });
});

const OPTIONS: MetricOption[] = [
  { key: "Momentum", label: "Momentum", domain: "Career", output_unit: "tasks" },
  { key: "Deep Work Hours", label: "Deep Work Hours", domain: "Focus", output_unit: "h" },
  { key: "Energy Level", label: "Energy Level", domain: "Health", output_unit: "/10" },
];

describe("buildOnboardingInstruction (FR-3, FR-4)", () => {
  it("asks exactly the next diagnostic question", () => {
    const text = buildOnboardingInstruction({
      stage: "baseline",
      plan: stagePlan("baseline", COUNTS),
      action: { kind: "question", n: 2 },
      advanceTo: null,
      config: COUNTS,
    });
    expect(text).toContain("Stage: baseline.");
    expect(text).toContain("diagnostic question 2 of 3");
    expect(text).toContain("Ask exactly one question.");
  });

  it("acknowledges and asks the first question of the next timed stage", () => {
    const text = buildOnboardingInstruction({
      stage: "baseline",
      plan: stagePlan("baseline", COUNTS),
      action: { kind: "advance" },
      advanceTo: "goals",
      config: COUNTS,
    });
    expect(text).toContain("transition to goals");
    expect(text).toContain("diagnostic question 1 of 3");
  });

  it("presents the three server-owned metric names at the routine boundary", () => {
    const text = buildOnboardingInstruction({
      stage: "routine",
      plan: stagePlan("routine", COUNTS),
      action: { kind: "advance" },
      advanceTo: "metric_selection",
      config: COUNTS,
      metricOptions: OPTIONS,
    });
    expect(text).toContain("Momentum, Deep Work Hours, Energy Level");
    expect(text).toContain("choose one or two");
    expect(text).toContain("do not invent a metric");
  });

  it("re-offers the same list without asking another diagnostic question", () => {
    const text = buildOnboardingInstruction({
      stage: "metric_selection",
      plan: stagePlan("metric_selection", COUNTS),
      action: { kind: "reoffer" },
      advanceTo: null,
      config: COUNTS,
      metricOptions: OPTIONS,
    });
    expect(text).toContain("Re-present the same three metric options");
    expect(text).toContain("Momentum, Deep Work Hours, Energy Level");
  });

  it("refuses to build a metric instruction without exactly three options", () => {
    expect(() =>
      buildOnboardingInstruction({
        stage: "routine",
        plan: stagePlan("routine", COUNTS),
        action: { kind: "advance" },
        advanceTo: "metric_selection",
        config: COUNTS,
      })
    ).toThrow();
    expect(() =>
      buildOnboardingInstruction({
        stage: "metric_selection",
        plan: stagePlan("metric_selection", COUNTS),
        action: { kind: "propose" },
        advanceTo: null,
        config: COUNTS,
        metricOptions: OPTIONS.slice(0, 2),
      })
    ).toThrow();
  });
});

describe("advanceTarget (FR-3, FR-7)", () => {
  it("returns the compare-and-set pair for every pre-metric stage", () => {
    expect(advanceTarget("intro")).toEqual({ from: "intro", to: "baseline" });
    expect(advanceTarget("baseline")).toEqual({ from: "baseline", to: "goals" });
    expect(advanceTarget("goals")).toEqual({ from: "goals", to: "routine" });
    expect(advanceTarget("routine")).toEqual({ from: "routine", to: "metric_selection" });
  });

  it("excludes metric_selection (select-metrics owns the flip) and complete", () => {
    expect(advanceTarget("metric_selection")).toBeNull();
    expect(advanceTarget("complete")).toBeNull();
  });
});

describe("overridePrecedence (FR-3)", () => {
  it("interview wins for every non-complete stage, even under LOCKDOWN", () => {
    expect(overridePrecedence("intro", "OPEN")).toBe("onboarding");
    expect(overridePrecedence("baseline", "LOCKDOWN")).toBe("onboarding");
    expect(overridePrecedence("metric_selection", "LOCKDOWN")).toBe("onboarding");
  });

  it("restores the standing dialog semantics after completion", () => {
    expect(overridePrecedence("complete", "OPEN")).toBe("normal");
    expect(overridePrecedence("complete", "LOCKDOWN")).toBe("lockdown");
  });
});
