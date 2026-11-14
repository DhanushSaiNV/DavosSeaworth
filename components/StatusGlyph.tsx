// components/StatusGlyph.tsx
// Canonical component for Object: Check-in / Plan status indicator (Blueprint §3.3).
// Drawn purely with React Native View primitives (zero SVG, zero UI kits, zero Unicode checkbox chars).
// Strokes 1.5px, size 16px (Today panel) or 12px (Chat stream).

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, getTheme } from '../theme';
import type { GlyphState } from '../domain/daySnapshot';

export type { GlyphState };

export interface StatusGlyphProps {
  state: GlyphState;
  size?: 12 | 16;
  label?: string;
  colorScheme?: 'light' | 'dark';
  backgroundColor?: string;
}

const DEFAULT_LABELS: Record<GlyphState, string> = {
  upcoming: 'Upcoming',
  due: 'Due now',
  done: 'Done',
  partly: 'Partly done',
  missed: 'Missed',
  unplanned: 'Logged',
  urge_held: 'Urge, held',
  urge_yielded: 'Urge, gave in',
};

export function StatusGlyph({
  state,
  size = 16,
  label,
  colorScheme,
  backgroundColor,
}: StatusGlyphProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const isDark = colorScheme ? colorScheme === 'dark' : theme.isDark;
  const surfaceColor = backgroundColor ?? (isDark ? colors.background : colors.surface);
  const accessibilityLabel = label ?? DEFAULT_LABELS[state] ?? 'Status';

  const strokeWidth = 1.5;
  const halfSize = size / 2;

  // Upcoming: Hollow ring with opaque background, circle border 1.5, textTertiary
  if (state === 'upcoming') {
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: colors.textTertiary,
            backgroundColor: surfaceColor,
          },
        ]}
      />
    );
  }

  // Due now: Ring with center dot and opaque background, textPrimary
  if (state === 'due') {
    const dotSize = size === 16 ? 6 : 4;
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: colors.textPrimary,
            backgroundColor: surfaceColor,
          },
        ]}>
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: colors.textPrimary,
          }}
        />
      </View>
    );
  }

  // Done: Filled disc with knocked-out check in surface color, textSecondary
  if (state === 'done') {
    const checkWidth = size === 16 ? 6 : 5;
    const checkHeight = size === 16 ? 3.5 : 2.5;
    const translateY = size === 16 ? -0.8 : -0.5;

    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            backgroundColor: colors.textSecondary,
          },
        ]}>
        <View
          style={{
            width: checkWidth,
            height: checkHeight,
            borderLeftWidth: strokeWidth,
            borderBottomWidth: strokeWidth,
            borderColor: surfaceColor,
            transform: [{ rotate: '-45deg' }, { translateY }],
          }}
        />
      </View>
    );
  }

  // Partly: Ring with left half filled and opaque background, textPrimary
  if (state === 'partly') {
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: colors.textPrimary,
            backgroundColor: surfaceColor,
            overflow: 'hidden',
          },
        ]}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: halfSize,
            backgroundColor: colors.textPrimary,
          }}
        />
      </View>
    );
  }

  // Missed / didn't: Ring with horizontal bar and opaque background, textPrimary
  if (state === 'missed') {
    const barWidth = size === 16 ? 8 : 6;
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: colors.textPrimary,
            backgroundColor: surfaceColor,
          },
        ]}>
        <View
          style={{
            width: barWidth,
            height: strokeWidth,
            backgroundColor: colors.textPrimary,
          }}
        />
      </View>
    );
  }

  // Unplanned doing: Small solid dot on the spine, textSecondary
  if (state === 'unplanned') {
    const dotSize = size === 16 ? 6 : 4;
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
          },
        ]}>
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: colors.textSecondary,
          }}
        />
      </View>
    );
  }

  // Urge held: Filled diamond (square rotated 45°), textSecondary
  if (state === 'urge_held') {
    const diamondSize = size === 16 ? 8 : 6;
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
          },
        ]}>
        <View
          style={{
            width: diamondSize,
            height: diamondSize,
            backgroundColor: colors.textSecondary,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    );
  }

  // Urge gave in: Hollow diamond with opaque background, textPrimary
  if (state === 'urge_yielded') {
    const diamondSize = size === 16 ? 8 : 6;
    return (
      <View
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
          },
        ]}>
        <View
          style={{
            width: diamondSize,
            height: diamondSize,
            borderWidth: strokeWidth,
            borderColor: colors.textPrimary,
            backgroundColor: surfaceColor,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
