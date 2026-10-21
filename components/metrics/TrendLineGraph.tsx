// components/metrics/TrendLineGraph.tsx
// FP-07 Step 6 — registry component. Consumes only { metric_id, points[] }; the page owns
// the name/unit/delta header. Layout-only: normalization comes from lib/metricsData.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { trendBars, type MetricPoint } from '../../lib/metricsData';

export interface TrendLineGraphProps {
  metric_id: string;
  points: readonly MetricPoint[];
}

const TRACK_HEIGHT = 48;
const MIN_BAR_HEIGHT = 4;

export function TrendLineGraph({ metric_id, points }: TrendLineGraphProps) {
  const { colors, radius, spacing } = useTheme();
  const bars = trendBars(points);

  return (
    <View
      testID={`metric-trend-${metric_id}`}
      accessibilityRole="image"
      accessibilityLabel={`Trend chart with ${points.length} day${points.length === 1 ? '' : 's'}`}
      style={styles.container}
    >
      {bars.map((bar, index) => (
        <View
          key={`${metric_id}-${bar.computed_for}-${index}`}
          style={[
            styles.track,
            {
              height: TRACK_HEIGHT,
              backgroundColor: colors.surfaceSubtle,
              borderRadius: radius.sm,
              marginRight: index === bars.length - 1 ? 0 : spacing.xxs,
            },
          ]}
        >
          <View
            style={[
              styles.bar,
              {
                height: Math.max(MIN_BAR_HEIGHT, bar.height * (TRACK_HEIGHT - 4)),
                backgroundColor: colors.lantern,
                borderRadius: radius.sm,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
  },
  track: {
    flex: 1,
    minWidth: 2,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
  },
});
