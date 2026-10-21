// components/metrics/index.ts
// FP-07 Step 6 — the four registry components. Each consumes { metric_id, points[] } and
// nothing else (ProgressBar also receives the page-computed fraction).

export { TrendLineGraph, type TrendLineGraphProps } from './TrendLineGraph';
export { ConsistencyHeatmap, type ConsistencyHeatmapProps } from './ConsistencyHeatmap';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { StatCard, type StatCardProps } from './StatCard';
