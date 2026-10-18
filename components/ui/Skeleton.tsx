// components/ui/Skeleton.tsx
// Calibrated Loading Placeholder with calm static surface shading.
// Respects Reduce Motion and avoids looping animations.

import React from 'react';
import { StyleSheet, View, ViewStyle, DimensionValue } from 'react-native';
import { useTheme } from '../../theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radiusKey?: 'sm' | 'md' | 'lg' | 'full';
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  radiusKey = 'sm',
  style,
}: SkeletonProps) {
  const { colors, radius } = useTheme();

  return (
    <View
      accessibilityRole="none"
      accessibilityLabel="Loading..."
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: radius[radiusKey],
          backgroundColor: colors.surfaceSubtle,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
});
