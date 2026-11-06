// lib/metricsService.ts
// Service layer for fetching user metrics and metric points from Supabase PostgREST.
// Strictly adheres to TECH-SPEC §7.9.5 and AGENTS.md §3.1/§3.4 (select-only under RLS).
// Pure series assembly and math are delegated to lib/metricsData.ts.

import { supabase } from './supabase';
import { logger } from './logger';
import { requireConfigNumber } from './config';
import {
  buildMetricViews,
  trailingStartDate,
  type DashboardMetricRow,
  type MetricPointRow,
  type MetricView,
} from './metricsData';

export interface MetricPresetInfo {
  name: string;
  domain: string;
  output_unit: string;
  description: string;
}

export const CORE_METRIC_PRESETS: readonly MetricPresetInfo[] = [
  {
    name: 'Momentum',
    domain: 'Discipline/Habits',
    output_unit: 'doings',
    description: 'Daily count of answered check-ins and logged doings.',
  },
  {
    name: 'Deep Work Hours',
    domain: 'Career',
    output_unit: 'h',
    description: 'Hours spent in focused work intervals.',
  },
  {
    name: 'Check-in Consistency',
    domain: 'Discipline/Habits',
    output_unit: '%',
    description: 'On-time response rate against your scheduled check-in cadence.',
  },
  {
    name: 'Energy Level',
    domain: 'Health',
    output_unit: '/10',
    description: 'Average energy reported across hourly check-ins.',
  },
  {
    name: 'Impulse Control',
    domain: 'Discipline/Habits',
    output_unit: 'score',
    description: 'Daily resistance against reported urges and dopamine loops.',
  },
  {
    name: 'Journal Positivity',
    domain: 'Mindset',
    output_unit: 'net',
    description: 'Net balance of constructive vs distress reflections in evening journal.',
  },
  {
    name: 'Quest Completions',
    domain: 'Discipline/Habits',
    output_unit: 'quests',
    description: 'Completed side quests and challenge deadlines.',
  },
  {
    name: 'Life Balance',
    domain: 'Life Balance',
    output_unit: 'pts',
    description: 'Composite equilibrium score across focus, energy, and consistency.',
  },
];

export interface FetchMetricsResult {
  views: MetricView[];
  historyDays: number;
  lastUpdated: string;
}

/**
 * Loads the user's active validated metrics and their trailing point series.
 * PostgREST read surface under RLS (TECH-SPEC §7.9.5).
 */
export async function fetchUserMetrics(
  userId: string,
  now: Date = new Date()
): Promise<FetchMetricsResult> {
  if (!userId) {
    return { views: [], historyDays: 30, lastUpdated: new Date().toISOString() };
  }

  // 1. Read lookback window from config (fail-closed, defaults to 30 if config unseeded)
  let historyDays = 30;
  try {
    historyDays = requireConfigNumber('metric_history_days');
  } catch (err) {
    logger.warn('app', 'metric_history_days config read failed; using fallback 30', { userId }, err);
    historyDays = 30;
  }

  // 2. Query active validated metrics owned by the user
  const { data: metricRows, error: metricError } = await supabase
    .from('metrics')
    .select(
      'id, name, domain, output_unit, is_quest, quest_status, quest_deadline, created_at, formula_status, archived_at'
    )
    .eq('user_id', userId)
    .eq('formula_status', 'validated')
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  if (metricError) {
    logger.error('app', 'metrics query error', { userId }, metricError);
    throw new Error(`Failed to load metrics: ${metricError.message}`);
  }

  const metrics = (metricRows ?? []) as DashboardMetricRow[];
  if (metrics.length === 0) {
    return { views: [], historyDays, lastUpdated: new Date().toISOString() };
  }

  // 3. Query trailing metric_points for these metrics
  const startDate = trailingStartDate(now, historyDays);
  const metricIds = metrics.map((m) => m.id);

  const { data: pointRows, error: pointError } = await supabase
    .from('metric_points')
    .select('metric_id, value, computed_for')
    .in('metric_id', metricIds)
    .gte('computed_for', startDate)
    .order('computed_for', { ascending: true });

  if (pointError) {
    logger.error('app', 'metric_points query error', { userId, metricIdsCount: metricIds.length }, pointError);
    throw new Error(`Failed to load metric points: ${pointError.message}`);
  }

  const rawPoints = (pointRows ?? []) as MetricPointRow[];

  // 4. Pure series assembly and view construction
  const views = buildMetricViews(metrics, rawPoints, historyDays, now);

  logger.info('app', 'metrics loaded successfully', {
    userId,
    metricCount: views.length,
    pointCount: rawPoints.length,
    historyDays,
  });

  return {
    views,
    historyDays,
    lastUpdated: new Date().toISOString(),
  };
}
