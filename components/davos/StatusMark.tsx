// components/davos/StatusMark.tsx
// Canonical component for Object: Plan status indicator (PRD §3, §12, §13).
// Replaces raw text '[x] [-] [ ]' with a small glyph drawn with View/Text primitives
// plus a short label in meta type. Status is never colour alone (PRD AU14, AU30).
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { radius, spacing, typeRoles } from '../../theme/roles';

export type PlanStatus = 'done' | 'partly' | 'late' | 'pending' | 'missed';

export interface StatusMarkProps {
  status: PlanStatus;
  showLabel?: boolean;
  colorScheme?: 'light' | 'dark';
}

export function StatusMark({
  status,
  showLabel = true,
  colorScheme,
}: StatusMarkProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  // Factual glyphs drawn with primitives
  let glyphSymbol = '○';
  let labelText = 'pending';
  let markColor = colors.textSecondary;

  switch (status) {
    case 'done':
      glyphSymbol = '✓';
      labelText = 'done';
      markColor = colors.textPrimary;
      break;
    case 'partly':
      glyphSymbol = '—';
      labelText = 'partly';
      markColor = colors.textSecondary;
      break;
    case 'late':
      glyphSymbol = '✓';
      labelText = 'late';
      markColor = colors.textSecondary;
      break;
    case 'missed':
      glyphSymbol = '✕';
      labelText = 'missed';
      markColor = colors.danger;
      break;
    case 'pending':
    default:
      glyphSymbol = '○';
      labelText = 'pending';
      markColor = colors.textSecondary;
      break;
  }

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${labelText}`}
    >
      <View style={[styles.glyphFrame, { borderColor: markColor }]}>
        <Text
          style={[
            styles.glyphText,
            typeRoles.meta,
            { color: markColor },
          ]}
          allowFontScaling={true}
        >
          {glyphSymbol}
        </Text>
      </View>
      {showLabel ? (
        <Text
          style={[
            styles.labelText,
            typeRoles.meta,
            { color: markColor },
          ]}
          allowFontScaling={true}
        >
          {labelText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  glyphFrame: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderRadius: radius.sm / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: spacing.none,
  },
  labelText: {
    paddingHorizontal: spacing.none,
  },
});
