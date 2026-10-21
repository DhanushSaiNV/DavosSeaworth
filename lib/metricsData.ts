// lib/metricsData.ts
// FP-07 Step 6 — pure metric-series assembly and display math.
//
// Refs: FP-07 FR-14, FR-15, FR-16; TECH-SPEC §7.9, §9; decisions2 D9 / TECH-SPEC D10.
//
// Everything numeric lives here so `components/metrics/*` stay layout-only. The dashboard
// reads `metrics` then `metric_points` under the existing RLS and hands the rows to these
// functions. No network, no React, no writes: this module is jest-loadable and client-safe.

export type MetricComponentKind = "stat" | "trend" | "progress";

export interface DashboardMetricRow {
  id: string;
  name: string;
  domain: string | null;
  output_unit: string | null;
  is_quest: boolean | null;
  quest_status: string | null;
  quest_deadline: string | null;
  created_at: string | null;
  formula_status: string;
  archived_at: string | null;
}

export interface MetricPointRow {
  metric_id: string;
  value: number | string;
  computed_for: string;
}

export interface MetricPoint {
  computed_for: string;
  value: number;
}

export interface MetricSeries {
  metric_id: string;
  points: MetricPoint[];
}

export interface MetricView {
  metric: DashboardMetricRow;
  series: MetricSeries;
  kind: MetricComponentKind;
  heatmapAvailable: boolean;
  latest: number | null;
  delta: number | null;
  progress: number;
}

const DAY_MS = 86_400_000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** The local-day window start for a trailing `days`-day series (inclusive). */
export function trailingStartDate(now: Date, days: number): string {
  const count = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
  const start = new Date(now.getTime());
  // Noon avoids a DST spring-forward hour landing on the previous date.
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (count - 1));
  return localIsoDate(start);
}

/** Own, non-archived, validated metrics are the only dashboard inputs. */
export function selectDashboardMetrics(rows: DashboardMetricRow[]): DashboardMetricRow[] {
  return rows.filter((row) => row.formula_status === "validated" && row.archived_at === null);
}

function parsePoint(row: MetricPointRow): MetricPoint | null {
  const value = typeof row.value === "number" ? row.value : Number(row.value);
  if (!Number.isFinite(value)) return null;
  if (typeof row.computed_for !== "string" || row.computed_for.length === 0) return null;
  return { computed_for: row.computed_for, value };
}

/**
 * Group point rows by metric, drop non-finite values, keep the trailing `historyDays` in
 * ascending day order, and return a series (possibly empty) for every metric.
 */
export function assembleSeries(
  metrics: DashboardMetricRow[],
  rows: MetricPointRow[],
  historyDays: number,
  now: Date = new Date(),
): MetricSeries[] {
  const start = trailingStartDate(now, historyDays);
  const limit = Number.isFinite(historyDays) ? Math.max(1, Math.floor(historyDays)) : 1;
  const grouped = new Map<string, MetricPoint[]>();
  for (const metric of metrics) grouped.set(metric.id, []);

  for (const row of rows) {
    if (!grouped.has(row.metric_id)) continue;
    if (row.computed_for < start) continue;
    const point = parsePoint(row);
    if (!point) continue;
    grouped.get(row.metric_id)!.push(point);
  }

  return metrics.map((metric) => {
    const points = grouped.get(metric.id) ?? [];
    points.sort((a, b) => (a.computed_for < b.computed_for ? -1 : a.computed_for > b.computed_for ? 1 : 0));
    return { metric_id: metric.id, points: points.slice(-limit) };
  });
}

/** 0–1 points → stat; a quest with a deadline → progress; otherwise → trend. */
export function componentKind(
  metric: Pick<DashboardMetricRow, "is_quest" | "quest_deadline">,
  points: readonly MetricPoint[],
): MetricComponentKind {
  if (Boolean(metric.is_quest) && Boolean(metric.quest_deadline)) return "progress";
  if (points.length >= 2) return "trend";
  return "stat";
}

/** The heatmap toggle only earns its place once a real week of points exists. */
export function heatmapAvailable(points: readonly MetricPoint[]): boolean {
  return points.length >= 7;
}

export function latestValue(points: readonly MetricPoint[]): number | null {
  if (points.length === 0) return null;
  return points[points.length - 1].value;
}

/** Latest minus the previous point; null until there are two points. */
export function dayOverDayDelta(points: readonly MetricPoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[points.length - 2].value;
}

export interface Extent {
  min: number;
  max: number;
}

export function seriesExtent(points: readonly MetricPoint[]): Extent {
  if (points.length === 0) return { min: 0, max: 0 };
  let min = points[0].value;
  let max = points[0].value;
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  return { min, max };
}

/**
 * Normalize a value into 0..1. A flat series has no meaningful low/high, so every point
 * sits at 0.5 (the single-point min=max case in the Step 6 tables).
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export interface TrendBar {
  computed_for: string;
  value: number;
  /** 0..1; the component owns the pixel height. */
  height: number;
}

export function trendBars(points: readonly MetricPoint[]): TrendBar[] {
  const { min, max } = seriesExtent(points);
  return points.map((point) => ({
    computed_for: point.computed_for,
    value: point.value,
    height: normalizeValue(point.value, min, max),
  }));
}

export interface HeatmapCell {
  computed_for: string;
  value: number;
  /** 0..1; the component owns the fill opacity. */
  intensity: number;
}

export interface HeatmapGrid {
  weeks: number;
  /** 7 rows (Monday..Sunday), each with `weeks` columns; null means no point. */
  rows: (HeatmapCell | null)[][];
}

export function heatmapWeeks(points: readonly MetricPoint[]): number {
  if (points.length === 0) return 1;
  const sorted = [...points].sort((a, b) =>
    a.computed_for < b.computed_for ? -1 : a.computed_for > b.computed_for ? 1 : 0
  );
  const first = utcDateMs(sorted[0].computed_for);
  const last = utcDateMs(sorted[sorted.length - 1].computed_for);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 1;
  // Count calendar-week columns, not raw 7-day blocks: a Wed→Tue window touches two
  // Monday-start columns even though it is only seven days long.
  const firstMonday = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
  const lastMonday = last - ((new Date(last).getUTCDay() + 6) % 7) * DAY_MS;
  const weeks = Math.floor((lastMonday - firstMonday) / (7 * DAY_MS)) + 1;
  return Math.max(1, Math.min(8, weeks));
}

function utcDateMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/**
 * Calendar-week heatmap: columns are Monday-start weeks, rows are weekdays. The window ends
 * on the Sunday of the latest point's week, so the current week's future cells are null.
 */
export function heatmapGrid(
  points: readonly MetricPoint[],
  weeks: number = heatmapWeeks(points),
): HeatmapGrid {
  const count = Math.max(1, Math.min(8, Math.floor(weeks) || 1));
  const grid: HeatmapGrid = {
    weeks: count,
    rows: Array.from({ length: 7 }, () => Array<HeatmapCell | null>(count).fill(null)),
  };
  if (points.length === 0) return grid;

  const sorted = [...points].sort((a, b) =>
    a.computed_for < b.computed_for ? -1 : a.computed_for > b.computed_for ? 1 : 0
  );
  const latestMs = utcDateMs(sorted[sorted.length - 1].computed_for);
  if (!Number.isFinite(latestMs)) return grid;

  const latestWeekday = (new Date(latestMs).getUTCDay() + 6) % 7; // Monday = 0
  const sundayMs = latestMs + (6 - latestWeekday) * DAY_MS;
  const startMs = sundayMs - (count * 7 - 1) * DAY_MS;
  const { min, max } = seriesExtent(sorted);

  for (const point of sorted) {
    const ms = utcDateMs(point.computed_for);
    if (!Number.isFinite(ms)) continue;
    const offset = Math.round((ms - startMs) / DAY_MS);
    if (offset < 0 || offset >= count * 7) continue;
    const week = Math.floor(offset / 7);
    const weekday = offset % 7;
    grid.rows[weekday][week] = {
      computed_for: point.computed_for,
      value: point.value,
      intensity: normalizeValue(point.value, min, max),
    };
  }
  return grid;
}

/**
 * Elapsed fraction of the created_at → quest_deadline window. No created_at (or no
 * deadline) is 0; a past deadline is 1; before creation is 0.
 */
export function progressFraction(
  metric: Pick<DashboardMetricRow, "created_at" | "quest_deadline">,
  now: Date = new Date(),
): number {
  if (!metric.created_at || !metric.quest_deadline) return 0;
  const start = Date.parse(metric.created_at);
  const end = Date.parse(`${metric.quest_deadline}T23:59:59.999Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return Number.isFinite(start) && Number.isFinite(end) && end <= start ? 1 : 0;
  }
  const current = now.getTime();
  if (current <= start) return 0;
  if (current >= end) return 1;
  return (current - start) / (end - start);
}

export function buildMetricViews(
  metrics: DashboardMetricRow[],
  rows: MetricPointRow[],
  historyDays: number,
  now: Date = new Date(),
): MetricView[] {
  const selected = selectDashboardMetrics(metrics);
  const series = assembleSeries(selected, rows, historyDays, now);
  return selected.map((metric, index) => {
    const metricSeries = series[index] ?? { metric_id: metric.id, points: [] };
    return {
      metric,
      series: metricSeries,
      kind: componentKind(metric, metricSeries.points),
      heatmapAvailable: heatmapAvailable(metricSeries.points),
      latest: latestValue(metricSeries.points),
      delta: dayOverDayDelta(metricSeries.points),
      progress: progressFraction(metric, now),
    };
  });
}

/** Format a metric value for a header; the unit is rendered separately. */
export function formatMetricNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Signed delta text for the header (e.g. +3, -2, 0, —). */
export function formatMetricDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return "0";
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? "+" : "-"}${text}`;
}
