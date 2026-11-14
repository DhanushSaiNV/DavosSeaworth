// components/metrics/MetricItem.tsx
// Canonical item view for an individual Life Metric in Davos.
// Strictly adheres to TECH-SPEC §7.9.5 and design/DESIGN_PRD.md §14 (no stacked cards, no KPI rows).
// RN primitives only. Tokens via useTheme.

import React, { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { hapticSelection } from '../../lib/haptics';
import {
  formatMetricDelta,
  formatMetricNumber,
  type MetricView,
} from '../../lib/metricsData';
import { TrendLineGraph } from './TrendLineGraph';
import { ConsistencyHeatmap } from './ConsistencyHeatmap';
import { ProgressBar } from './ProgressBar';
import { StatCard } from './StatCard';
import { SegmentedControl } from '../davos/SegmentedControl';

export interface MetricItemProps {
  view: MetricView;
}

export function MetricItem({ view }: MetricItemProps) {
  const { colors } = useTheme();
  const { metric, series, kind, heatmapAvailable, latest, delta, progress } = view;

  // Local visualization toggle for metrics with >= 7 data points
  const [visMode, setVisMode] = useState<'trend' | 'heatmap'>('trend');

  const handleToggleVis = (mode: 'trend' | 'heatmap') => {
    void hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setVisMode(mode);
  };

  const deltaText = formatMetricDelta(delta);
  const deltaLabel =
    delta !== null ? `${deltaText} ${metric.output_unit ?? ''} from yesterday` : 'Initial baseline';

  // Quest deadline helper
  const isQuest = Boolean(metric.is_quest && metric.quest_deadline);
  let questDeadlineLabel: string | null = null;
  if (isQuest && metric.quest_deadline) {
    const deadlineDate = new Date(`${metric.quest_deadline}T23:59:59`);
    const now = new Date();
    const daysRemaining = Math.max(
      0,
      Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );
    questDeadlineLabel =
      daysRemaining === 0
        ? 'Deadline today'
        : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left · deadline ${metric.quest_deadline}`;
  }

  return (
    <View style={[styles.container, { borderBottomColor: colors.borderSubtle }]}>
      {/* 1. Metric Header Row: Name & Domain (Left) / Latest & Delta (Right) */}
      <View style={styles.headerRow}>
        <View style={styles.titleCol}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.metricName, typeRoles.title, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              {metric.name}
            </Text>
            {isQuest && (
              <View style={[styles.questBadge, { borderColor: colors.borderSubtle }]}>
                <Text
                  style={[styles.questBadgeText, typeRoles.meta, { color: colors.accent }]}
                  allowFontScaling={true}>
                  SIDE QUEST
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[styles.metricDomain, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            {metric.domain ?? 'Life'} {metric.output_unit ? `· ${metric.output_unit}` : ''}
          </Text>
        </View>

        <View style={styles.statsCol}>
          <Text
            style={[styles.latestFigure, typeRoles.figureLarge, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            {formatMetricNumber(latest)}
            {metric.output_unit && metric.output_unit !== 'doings' && metric.output_unit !== 'score' && metric.output_unit !== 'pts' ? (
              <Text
                style={[styles.unitSub, typeRoles.meta, { color: colors.textTertiary }]}
                allowFontScaling={true}>
                {' '}{metric.output_unit}
              </Text>
            ) : null}
          </Text>
          <Text
            style={[styles.deltaText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            {deltaLabel}
          </Text>
        </View>
      </View>

      {/* 2. Optional Quest Deadline Line */}
      {isQuest && questDeadlineLabel && (
        <View style={styles.questDeadlineRow}>
          <Text
            style={[styles.questDeadlineText, typeRoles.meta, { color: colors.textTertiary }]}
            allowFontScaling={true}>
            {questDeadlineLabel}
          </Text>
        </View>
      )}

      {/* 3. Optional Trend vs Heatmap Toggle (when >= 7 points exist) */}
      {heatmapAvailable && kind === 'trend' && (
        <View style={styles.toggleRow}>
          <SegmentedControl
            options={[
              { value: 'trend', label: 'Trend' },
              { value: 'heatmap', label: 'Heatmap' },
            ]}
            value={visMode}
            onChange={handleToggleVis}
            accessibilityLabelPrefix={`${metric.name} chart type`}
          />
        </View>
      )}

      {/* 4. Visualization Body (per TECH-SPEC §7.9.5 deterministic rule) */}
      <View style={styles.visBody}>
        {kind === 'progress' ? (
          <ProgressBar
            metric_id={metric.id}
            points={series.points}
            progress={progress}
          />
        ) : kind === 'trend' ? (
          visMode === 'heatmap' && heatmapAvailable ? (
            <ConsistencyHeatmap metric_id={metric.id} points={series.points} />
          ) : (
            <TrendLineGraph metric_id={metric.id} points={series.points} />
          )
        ) : (
          <StatCard metric_id={metric.id} points={series.points} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  titleCol: {
    flex: 1,
    gap: spacing.xxs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  metricName: {
    fontSize: 17,
    fontWeight: '600',
  },
  questBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  questBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricDomain: {
    fontSize: 13,
  },
  statsCol: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
  latestFigure: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '600',
  },
  unitSub: {
    fontSize: 14,
    fontWeight: '400',
  },
  deltaText: {
    fontSize: 12,
  },
  questDeadlineRow: {
    marginTop: -spacing.xs,
  },
  questDeadlineText: {
    fontSize: 12,
  },
  toggleRow: {
    alignSelf: 'flex-start',
    marginVertical: spacing.xxs,
  },
  visBody: {
    width: '100%',
    paddingTop: spacing.xs,
  },
});
