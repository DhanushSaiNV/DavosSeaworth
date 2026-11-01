// components/davos/SystemLine.tsx
// Canonical component for Object: Thread (PRD §3, §12; design/DESIGN.md §6).
// Props: text
// States: sync, missed
// Hairline divider, plain text, no cards, no elevation.
// Uses only theme/roles.ts.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  typeRoles,
} from '../../theme/roles';

export interface SystemLineProps {
  text: string;
  state?: 'sync' | 'missed';
  colorScheme?: 'light' | 'dark';
}

export function SystemLine({
  text,
  state = 'sync',
  colorScheme,
}: SystemLineProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  return (
    <View style={styles.container}>
      <Text
        style={[
          styles.text,
          typeRoles.meta,
          {
            color: colors.textSecondary,
            fontWeight: '400',
          },
        ]}
        allowFontScaling={true}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  text: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
});
