// components/davos/SampleDataMarker.tsx
// Dev-only marker shown wherever fixture data is rendered. Hidden in production builds (C6).
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { spacing, typeRoles } from '../../theme/roles';

export interface SampleDataMarkerProps {
  screen?: string;
  colorScheme?: 'light' | 'dark';
}

export function SampleDataMarker({ screen, colorScheme }: SampleDataMarkerProps) {
  if (!__DEV__) return null;
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  return (
    <View style={styles.container} accessible={false}>
      <Text
        style={[styles.text, typeRoles.meta, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        Sample data{screen ? ` · ${screen}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 0,
    paddingVertical: spacing.xxs,
    alignSelf: 'flex-start',
  },
  text: {
    fontStyle: 'italic',
    paddingHorizontal: spacing.none,
  },
});
