// components/ui/Skeleton.tsx
// Calibrated Loading Placeholder with subtle opacity pulse

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Animated, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

export interface SkeletonProps {
  width?: number | `${number}%` | 'auto';
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
  const opacityAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.85,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacityAnim]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius: radius[radiusKey],
          backgroundColor: colors.surfaceSubtle,
          opacity: opacityAnim,
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
