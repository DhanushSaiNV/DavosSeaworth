// components/davos/SampleDataMarker.tsx
// Dev-only marker shown wherever fixture data is rendered. Hidden in production builds (C6).
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colorRoles, spacing, typeRoles } from '../../theme/roles';

export interface SampleDataMarkerProps {
  screen?: string;
  colorScheme?: 'light' | 'dark';
}

export function SampleDataMarker({ screen, colorScheme = 'light' }: SampleDataMarkerProps) {
  if (!__DEV__) return null;
  const colors = colorRoles[colorScheme];

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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    alignSelf: 'flex-start',
  },
  text: {
    fontStyle: 'italic',
    paddingHorizontal: spacing.none,
  },
});
