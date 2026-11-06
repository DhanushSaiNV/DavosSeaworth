// components/metrics/ConsistencyHeatmap.tsx
// FP-07 Step 6 — registry component. Consumes only { metric_id, points[] }.
// The grid geometry is pure (lib/metricsData.heatmapGrid); this file maps it to cells.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, typeRoles } from '../../theme/roles';
import { heatmapGrid, type MetricPoint } from '../../lib/metricsData';

export interface ConsistencyHeatmapProps {
  metric_id: string;
  points: readonly MetricPoint[];
}

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function ConsistencyHeatmap({ metric_id, points }: ConsistencyHeatmapProps) {
  const { colors } = useTheme();
  const grid = heatmapGrid(points);
  const [gridWidth, setGridWidth] = useState(0);
  const gap = spacing.xxs;
  const cellSize =
    gridWidth > 0
      ? Math.max(16, Math.min(36, Math.floor((gridWidth - (grid.weeks - 1) * gap) / grid.weeks)))
      : 20;

  return (
    <View
      testID={`metric-heatmap-${metric_id}`}
      accessibilityRole="image"
      accessibilityLabel={`Consistency heatmap with ${points.length} day${points.length === 1 ? '' : 's'}`}
      style={styles.container}
    >
      <View style={[styles.labels, { marginRight: spacing.xxs }]}>
        {WEEKDAY_LABELS.map((label, index) => (
          <View key={`${metric_id}-weekday-${index}`} style={styles.labelCell}>
            <Text
              style={[styles.weekdayLabel, typeRoles.meta, { color: colors.textTertiary }]}
              allowFontScaling={true}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.grid} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
        {grid.rows.map((row, rowIndex) => (
          <View key={`${metric_id}-row-${rowIndex}`} style={styles.row}>
            {row.map((cell, columnIndex) => (
              <View
                key={`${metric_id}-cell-${rowIndex}-${columnIndex}`}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    borderRadius: radius.sm,
                    borderColor: colors.borderSubtle,
                    backgroundColor: cell ? colors.lantern : colors.surfaceSubtle,
                    opacity: cell ? 0.2 + cell.intensity * 0.8 : 1,
                    marginRight: columnIndex === row.length - 1 ? 0 : gap,
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
  weekdayLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  grid: {
    flex: 1,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
