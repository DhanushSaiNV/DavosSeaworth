// supabase/functions/_shared/metrics/runEval.test.ts
// FP-07 Step 4 — variable assembly, compliance, local-day anchoring, and point building.
// Refs: FP-07 FR-2, FR-3, FR-6; TECH-SPEC §7.9.5, §7.1, §3.4.

import {
  assembleMetricVars,
  buildMetricPoints,
  complianceFromWindows,
  localDayNoonMs,
} from "./runEval.ts";
import type { FormulaBounds } from "./formula.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BOUNDS: FormulaBounds = { max_depth: 6, max_nodes: 30, literal_abs_max: 1000 };

describe("FP-07 metric variable assembly", () => {
  it("turns a missing view row into all-zero plus all eight zero-data names", () => {
    const assembled = assembleMetricVars(null, 0, 0);
    expect(assembled.vars).toEqual({
      doings_count: 0,
      hours_logged: 0,
      checkin_compliance_rate: 0,
      energy_avg: 0,
      impulse_failures: 0,
      journal_positive_mentions: 0,
      journal_negative_mentions: 0,
      quest_completions: 0,
    });
    expect(assembled.zeroData).toEqual([
      "doings_count",
      "hours_logged",
      "checkin_compliance_rate",
      "energy_avg",
      "impulse_failures",
      "journal_positive_mentions",
      "journal_negative_mentions",
      "quest_completions",
    ]);
  });

  it("merges view values with grid compliance and tolerates numeric strings", () => {
    const assembled = assembleMetricVars(
      {
        doings_count: "4",
        hours_logged: "6.0",
        energy_avg: "5.5",
        impulse_failures: 1,
        journal_positive_mentions: 3,
        journal_negative_mentions: 2,
        quest_completions: 1,
      },
      0.5,
      4,
    );
    expect(assembled.vars.doings_count).toBe(4);
    expect(assembled.vars.hours_logged).toBe(6);
    expect(assembled.vars.energy_avg).toBe(5.5);
    expect(assembled.vars.impulse_failures).toBe(1);
    expect(assembled.vars.checkin_compliance_rate).toBe(0.5);
    expect(assembled.zeroData).toEqual([]);
  });

  it("marks null aggregates and zero expected windows as zero-data", () => {
    const assembled = assembleMetricVars(
      {
        doings_count: 0,
        hours_logged: 0,
        energy_avg: null,
        impulse_failures: 0,
        journal_positive_mentions: 0,
        journal_negative_mentions: 0,
        quest_completions: 0,
      },
      null,
      0,
    );
    expect(assembled.vars.energy_avg).toBe(0);
    expect(assembled.vars.checkin_compliance_rate).toBe(0);
    expect(assembled.zeroData).toEqual(["energy_avg", "checkin_compliance_rate"]);
  });

  it("clamps out-of-range compliance", () => {
    expect(assembleMetricVars({ doings_count: 1 }, 1.4, 2).vars.checkin_compliance_rate).toBe(1);
    expect(assembleMetricVars({ doings_count: 1 }, -0.2, 2).vars.checkin_compliance_rate).toBe(0);
  });
});

describe("FP-07 compliance and local-day anchoring", () => {
  it("computes answered ÷ expected, with zero expected windows -> 0", () => {
    expect(complianceFromWindows([], [])).toBe(0);
    expect(complianceFromWindows([1, 2], [1, 2])).toBe(1);
    expect(complianceFromWindows([1, 2], [1])).toBe(0.5);
    expect(complianceFromWindows([1, 2], [])).toBe(0);
    expect(complianceFromWindows([1, 2], [2, 9])).toBe(0.5);
  });

  it("anchors the local day at noon, including a DST date", () => {
    expect(new Date(localDayNoonMs("2026-10-20", "Asia/Kolkata") ?? 0).toISOString()).toBe(
      "2026-10-20T06:30:00.000Z",
    );
    expect(new Date(localDayNoonMs("2026-03-08", "America/New_York") ?? 0).toISOString()).toBe(
      "2026-03-08T16:00:00.000Z",
    );
  });

  it("rejects malformed and impossible dates", () => {
    expect(localDayNoonMs("2026-2-3", "UTC")).toBeNull();
    expect(localDayNoonMs("2026-02-30", "UTC")).toBeNull();
    expect(localDayNoonMs("not-a-date", "UTC")).toBeNull();
  });
});

describe("FP-07 metric point building", () => {
  it("evaluates valid metrics and skips invalid or non-finite ones", () => {
    const built = buildMetricPoints(
      [
        { id: "m1", name: "Momentum", formula: { var: "doings_count" } },
        { id: "m2", name: "Divide", formula: { "/": [1, 0] } },
        { id: "m3", name: "Bool", formula: { ">": [1, 0] } },
        { id: "m4", name: "Bad", formula: { reduce: [1, 0] } },
      ],
      {
        doings_count: 7,
        hours_logged: 6,
        checkin_compliance_rate: 0.5,
        energy_avg: 5.5,
        impulse_failures: 2,
        journal_positive_mentions: 3,
        journal_negative_mentions: 1,
        quest_completions: 4,
      },
      "2026-10-20",
      BOUNDS,
    );
    expect(built.points.length).toBe(1);
    expect(built.points[0]).toEqual({ metric_id: "m1", computed_for: "2026-10-20", value: 7 });
    expect(built.skipped.map((s) => s.metricId).sort()).toEqual(["m2", "m3", "m4"]);
  });

  it("re-evaluates with changed variables (the do-update input)", () => {
    const metric = [{ id: "m1", name: "Hours", formula: { var: "hours_logged" } }];
    const vars = {
      doings_count: 1,
      hours_logged: 2,
      checkin_compliance_rate: 0.5,
      energy_avg: 5,
      impulse_failures: 0,
      journal_positive_mentions: 0,
      journal_negative_mentions: 0,
      quest_completions: 0,
    };
    const first = buildMetricPoints(metric, vars, "2026-10-20", BOUNDS);
    const second = buildMetricPoints(metric, { ...vars, hours_logged: 8 }, "2026-10-20", BOUNDS);
    expect(first.points[0].value).toBe(2);
    expect(second.points[0].value).toBe(8);
  });
});
