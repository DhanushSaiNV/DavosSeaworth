// lib/metricsData.test.ts
// FP-07 Step 6 — pure boundary tables for the dashboard metrics section.
//
// Refs: FP-07 FR-14, FR-15, FR-16; TECH-SPEC §7.9, §9.

import {
  assembleSeries,
  buildMetricViews,
  componentKind,
  dayOverDayDelta,
  formatMetricDelta,
  formatMetricNumber,
  heatmapAvailable,
  heatmapGrid,
  heatmapWeeks,
  latestValue,
  normalizeValue,
  progressFraction,
  selectDashboardMetrics,
  seriesExtent,
  trailingStartDate,
  trendBars,
  type DashboardMetricRow,
  type MetricPoint,
  type MetricPointRow,
} from "./metricsData";

const NOW = new Date(2026, 9, 20, 12, 0, 0); // 2026-10-20 local (Tuesday)

function metric(overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
  return {
    id: "metric-1",
    name: "Momentum",
    domain: "Discipline/Habits",
    output_unit: "doings",
    is_quest: false,
    quest_status: null,
    quest_deadline: null,
    created_at: "2026-10-01T00:00:00Z",
    formula_status: "validated",
    archived_at: null,
    ...overrides,
  };
}

function point(computed_for: string, value: number): MetricPoint {
  return { computed_for, value };
}

function pointRow(metric_id: string, computed_for: string, value: number | string): MetricPointRow {
  return { metric_id, computed_for, value };
}

describe("selection and series assembly", () => {
  it("keeps only non-archived validated metrics", () => {
    const rows = [
      metric({ id: "a" }),
      metric({ id: "b", archived_at: "2026-10-02T00:00:00Z" }),
      metric({ id: "c", formula_status: "rejected" }),
    ];
    expect(selectDashboardMetrics(rows).map((row) => row.id)).toEqual(["a"]);
  });

  it("computes an inclusive local-day window start", () => {
    expect(trailingStartDate(NOW, 7)).toBe("2026-10-14");
    expect(trailingStartDate(NOW, 1)).toBe("2026-10-20");
    expect(trailingStartDate(NOW, 0)).toBe("2026-10-20");
  });

  it("sorts, coerces, filters stale/non-finite rows, and slices to the window", () => {
    const metrics = [metric({ id: "a" }), metric({ id: "b" })];
    const rows = [
      pointRow("a", "2026-10-19", "3"),
      pointRow("a", "2026-10-20", 4),
      pointRow("a", "2026-10-18", 2),
      pointRow("a", "2026-10-13", 1), // before the 7-day window
      pointRow("a", "2026-10-17", Number.NaN),
      pointRow("b", "2026-10-20", 9),
    ];
    const series = assembleSeries(metrics, rows, 7, NOW);
    expect(series).toHaveLength(2);
    expect(series[0].metric_id).toBe("a");
    expect(series[0].points.map((p) => p.value)).toEqual([2, 3, 4]);
    expect(series[0].points.map((p) => p.computed_for)).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    expect(series[1].points).toHaveLength(1);
    expect(series[1].points[0].value).toBe(9);
  });

  it("caps each series at historyDays points even when the date window is wider", () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(11 + i).padStart(2, "0")}`);
    const rows = days.map((day, i) => pointRow("a", day, i));
    const [series] = assembleSeries([metric({ id: "a" })], rows, 4, NOW);
    expect(series.points.map((p) => p.value)).toEqual([6, 7, 8, 9]);
  });
});

describe("component selection boundaries", () => {
  it("uses stat for 0–1 points, trend from 2, and exposes the heatmap at 7", () => {
    const zero: MetricPoint[] = [];
    const one = [point("2026-10-19", 1)];
    const two = [point("2026-10-19", 1), point("2026-10-20", 2)];
    const seven = Array.from({ length: 7 }, (_, i) =>
      point(`2026-10-${String(14 + i).padStart(2, "0")}`, i)
    );
    expect(componentKind(metric(), zero)).toBe("stat");
    expect(componentKind(metric(), one)).toBe("stat");
    expect(componentKind(metric(), two)).toBe("trend");
    expect(componentKind(metric(), seven)).toBe("trend");
    expect(heatmapAvailable(zero)).toBe(false);
    expect(heatmapAvailable(one)).toBe(false);
    expect(heatmapAvailable(two)).toBe(false);
    expect(heatmapAvailable(seven)).toBe(true);
  });

  it("uses progress for a quest with a deadline, even before points exist", () => {
    const quest = metric({
      is_quest: true,
      quest_deadline: "2026-10-30",
      created_at: "2026-10-01T00:00:00Z",
    });
    expect(componentKind(quest, [])).toBe("progress");
    expect(componentKind(quest, [point("2026-10-19", 1), point("2026-10-20", 2)])).toBe("progress");
  });

  it("uses trend/stat for a quest without a deadline", () => {
    const quest = metric({ is_quest: true, quest_deadline: null });
    expect(componentKind(quest, [point("2026-10-19", 1), point("2026-10-20", 2)])).toBe("trend");
    expect(componentKind(quest, [point("2026-10-20", 1)])).toBe("stat");
  });
});

describe("value, delta, and normalization math", () => {
  it("reads the latest point and a signed day-over-day delta", () => {
    expect(latestValue([])).toBeNull();
    expect(latestValue([point("2026-10-19", 3)])).toBe(3);
    expect(dayOverDayDelta([point("2026-10-19", 3)])).toBeNull();
    expect(dayOverDayDelta([point("2026-10-19", 3), point("2026-10-20", 5)])).toBe(2);
    expect(dayOverDayDelta([point("2026-10-19", 5), point("2026-10-20", 2)])).toBe(-3);
  });

  it("computes extents and clamps normalization", () => {
    expect(seriesExtent([])).toEqual({ min: 0, max: 0 });
    expect(seriesExtent([point("a", 4), point("b", -2), point("c", 7)])).toEqual({
      min: -2,
      max: 7,
    });
    expect(normalizeValue(5, 0, 10)).toBe(0.5);
    expect(normalizeValue(-1, 0, 10)).toBe(0);
    expect(normalizeValue(11, 0, 10)).toBe(1);
    expect(normalizeValue(5, 5, 5)).toBe(0.5);
    expect(normalizeValue(5, 5, 5)).toBe(0.5); // single-point / flat series
    expect(normalizeValue(Number.NaN, 0, 10)).toBe(0);
  });

  it("gives every bar the flat-series midpoint and handles an empty strip", () => {
    expect(trendBars([])).toEqual([]);
    expect(trendBars([point("2026-10-19", 4), point("2026-10-20", 4)])).toEqual([
      { computed_for: "2026-10-19", value: 4, height: 0.5 },
      { computed_for: "2026-10-20", value: 4, height: 0.5 },
    ]);
    expect(trendBars([point("2026-10-19", 0), point("2026-10-20", 10)]).map((b) => b.height)).toEqual([
      0, 1,
    ]);
  });
});

describe("heatmap geometry", () => {
  const points = Array.from({ length: 7 }, (_, i) =>
    point(`2026-10-${String(14 + i).padStart(2, "0")}`, i + 1)
  );

  it("counts calendar-week columns, including a partial first week", () => {
    expect(heatmapWeeks([])).toBe(1);
    expect(heatmapWeeks(points)).toBe(2); // Wed 14 Oct → Tue 20 Oct touches two Mondays
    expect(
      heatmapWeeks(
        Array.from({ length: 7 }, (_, i) =>
          point(`2026-10-${String(12 + i).padStart(2, "0")}`, i)
        )
      )
    ).toBe(1); // Mon 12 → Sun 18
  });

  it("maps cells to Monday-start rows and calendar-week columns", () => {
    const grid = heatmapGrid(points);
    expect(grid.weeks).toBe(2);
    expect(grid.rows).toHaveLength(7);
    expect(grid.rows[2][0]).toEqual({
      computed_for: "2026-10-14",
      value: 1,
      intensity: 0,
    });
    expect(grid.rows[1][1]).toEqual({
      computed_for: "2026-10-20",
      value: 7,
      intensity: 1,
    });
    expect(grid.rows[0][0]).toBeNull(); // Monday 12 Oct is before the first point
    expect(grid.rows[2][1]).toBeNull(); // Wednesday 21 Oct is after the latest point
  });

  it("returns an empty grid and gives a flat series midpoint intensity", () => {
    const empty = heatmapGrid([]);
    expect(empty.weeks).toBe(1);
    expect(empty.rows.flat().every((cell) => cell === null)).toBe(true);

    const flat = heatmapGrid([
      point("2026-10-19", 4),
      point("2026-10-20", 4),
    ]);
    expect(flat.rows[0][0]?.intensity).toBe(0.5);
    expect(flat.rows[1][0]?.intensity).toBe(0.5);
  });
});

describe("quest progress", () => {
  it("is 0 without a creation time or before the window", () => {
    expect(progressFraction(metric({ created_at: null, quest_deadline: "2026-10-30" }), NOW)).toBe(0);
    expect(progressFraction(metric({ created_at: "2026-10-10T00:00:00Z" }), NOW)).toBe(0);
    expect(
      progressFraction(
        metric({ created_at: "2026-10-21T00:00:00Z", quest_deadline: "2026-10-30" }),
        NOW
      )
    ).toBe(0);
  });

  it("is 1 once the deadline has passed and clamps at the window edges", () => {
    expect(
      progressFraction(
        metric({ created_at: "2026-10-01T00:00:00Z", quest_deadline: "2026-10-10" }),
        NOW
      )
    ).toBe(1);
    const halfway = progressFraction(
      metric({ created_at: "2026-10-10T00:00:00Z", quest_deadline: "2026-10-20" }),
      new Date("2026-10-15T12:00:00Z")
    );
    expect(halfway).toBeGreaterThan(0.49);
    expect(halfway).toBeLessThan(0.51);
  });
});

describe("display formatting", () => {
  it("formats numbers and signed deltas", () => {
    expect(formatMetricNumber(null)).toBe("—");
    expect(formatMetricNumber(25)).toBe("25");
    expect(formatMetricNumber(25.04)).toBe("25");
    expect(formatMetricNumber(25.06)).toBe("25.1");
    expect(formatMetricNumber(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatMetricDelta(null)).toBe("—");
    expect(formatMetricDelta(0)).toBe("0");
    expect(formatMetricDelta(3)).toBe("+3");
    expect(formatMetricDelta(-2.5)).toBe("-2.5");
  });
});

describe("buildMetricViews", () => {
  it("keeps one view per selected metric and attaches the display state", () => {
    const metrics = [
      metric({ id: "a", name: "Momentum" }),
      metric({
        id: "b",
        name: "Quest",
        is_quest: true,
        quest_deadline: "2026-10-30",
        created_at: "2026-10-10T00:00:00Z",
      }),
      metric({ id: "c", archived_at: "2026-10-01T00:00:00Z" }),
    ];
    const rows = [
      pointRow("a", "2026-10-19", 2),
      pointRow("a", "2026-10-20", 4),
      pointRow("b", "2026-10-20", 1),
    ];
    const views = buildMetricViews(metrics, rows, 7, NOW);
    expect(views.map((view) => view.metric.id)).toEqual(["a", "b"]);
    expect(views[0].kind).toBe("trend");
    expect(views[0].latest).toBe(4);
    expect(views[0].delta).toBe(2);
    expect(views[1].kind).toBe("progress");
    expect(views[1].progress).toBeGreaterThan(0);
  });
});
