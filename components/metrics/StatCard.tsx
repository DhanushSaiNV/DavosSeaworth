// components/metrics/StatCard.tsx
// FP-07 Step 6 — registry component. Consumes only { metric_id, points[] }.
// The latest value is the body; name/unit/delta live in the page header.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from '../ui';
import { formatMetricNumber, latestValue, type MetricPoint } from '../../lib/metricsData';

export interface StatCardProps {
  metric_id: string;
  points: readonly MetricPoint[];
}

export function StatCard({ metric_id, points }: StatCardProps) {
  const { colors, radius, spacing } = useTheme();
  const latest = latestValue(points);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={latest === null ? 'No data yet' : `Latest value ${formatMetricNumber(latest)}`}
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSubtle,
          borderRadius: radius.md,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        },
      ]}
    >
      <Text role="display" tabular style={styles.value}>
        {formatMetricNumber(latest)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    textAlign: 'center',
  },
});
