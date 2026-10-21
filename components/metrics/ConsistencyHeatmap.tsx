// components/metrics/ConsistencyHeatmap.tsx
// FP-07 Step 6 — registry component. Consumes only { metric_id, points[] }.
// The grid geometry is pure (lib/metricsData.heatmapGrid); this file maps it to cells.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from '../ui';
import { heatmapGrid, type MetricPoint } from '../../lib/metricsData';

export interface ConsistencyHeatmapProps {
  metric_id: string;
  points: readonly MetricPoint[];
}

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function ConsistencyHeatmap({ metric_id, points }: ConsistencyHeatmapProps) {
  const { colors, radius, spacing } = useTheme();
  const grid = heatmapGrid(points);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Consistency heatmap with ${points.length} day${points.length === 1 ? '' : 's'}`}
      style={styles.container}
    >
      <View style={[styles.labels, { marginRight: spacing.xxs }]}>
        {WEEKDAY_LABELS.map((label, index) => (
          <View key={`${metric_id}-weekday-${index}`} style={styles.labelCell}>
            <Text role="caption" variant="tertiary">
              {label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {grid.rows.map((row, rowIndex) => (
          <View key={`${metric_id}-row-${rowIndex}`} style={styles.row}>
            {row.map((cell, columnIndex) => (
              <View
                key={`${metric_id}-cell-${rowIndex}-${columnIndex}`}
                style={[
                  styles.cell,
                  {
                    borderRadius: radius.sm,
                    borderColor: colors.borderSubtle,
                    backgroundColor: cell ? colors.lantern : colors.surfaceSubtle,
                    opacity: cell ? 0.2 + cell.intensity * 0.8 : 1,
                    marginRight: columnIndex === row.length - 1 ? 0 : spacing.xxs,
                  },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  labels: {
    width: 16,
    justifyContent: 'space-between',
  },
  labelCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flex: 1,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 0,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
