// components/metrics/ProgressBar.tsx
// FP-07 Step 6 — registry component. Consumes { metric_id, points[] } plus the fraction the
// page computed with lib/metricsData.progressFraction; it never reads metric metadata.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import type { MetricPoint } from '../../lib/metricsData';

export interface ProgressBarProps {
  metric_id: string;
  points: readonly MetricPoint[];
  /** 0..1 elapsed fraction of the quest window. */
  progress: number;
}

export function ProgressBar({ metric_id, points, progress }: ProgressBarProps) {
  const { colors, radius } = useTheme();
  const fraction = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const percent = Math.round(fraction * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Quest progress, ${points.length} point${points.length === 1 ? '' : 's'}`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[
        styles.track,
        {
          backgroundColor: colors.surfaceSubtle,
          borderColor: colors.borderSubtle,
          borderRadius: radius.full,
        },
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${percent}%`,
            backgroundColor: colors.lantern,
            borderRadius: radius.full,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    width: '100%',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fill: {
    height: '100%',
  },
});
