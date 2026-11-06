// components/metrics/index.ts
// Pre-built registry components and canonical metric item.
// Each registry body consumes { metric_id, points[] } and nothing else.

export { TrendLineGraph, type TrendLineGraphProps } from './TrendLineGraph';
export { ConsistencyHeatmap, type ConsistencyHeatmapProps } from './ConsistencyHeatmap';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { StatCard, type StatCardProps } from './StatCard';
export { MetricItem, type MetricItemProps } from './MetricItem';
