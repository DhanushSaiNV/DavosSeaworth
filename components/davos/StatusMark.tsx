// components/davos/StatusMark.tsx
// StatusMark delegating to canonical StatusGlyph (Blueprint §3.3).
// RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { spacing, typeRoles } from '../../theme/roles';
import { StatusGlyph, type GlyphState } from '../StatusGlyph';

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

  const glyphState: GlyphState =
    status === 'pending'
      ? 'upcoming'
      : status === 'late'
      ? 'missed'
      : (status as GlyphState);

  const labelText = status === 'late' ? 'late' : status;

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${labelText}`}>
      <StatusGlyph state={glyphState} size={16} colorScheme={colorScheme} />
      {showLabel ? (
        <Text
          style={[
            styles.labelText,
            typeRoles.meta,
            { color: glyphState === 'done' ? colors.textSecondary : colors.textPrimary },
          ]}
          allowFontScaling={true}>
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
  labelText: {
    paddingHorizontal: spacing.none,
  },
});
