// components/davos/SystemLine.tsx
// Canonical component for Object: Thread (PRD §3, §12; design/DESIGN.md §6).
// Props: text
// States: sync, missed
// Hairline divider, plain text, no cards, no elevation.
// Uses only theme/roles.ts.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
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
  colorScheme = 'light',
}: SystemLineProps) {
  const colors = colorRoles[colorScheme];

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      <Text
        style={[
          styles.text,
          typeRoles.meta,
          {
            color: state === 'missed' ? colors.textSecondary : colors.textSecondary,
          },
        ]}
        allowFontScaling={true}>
        {state === 'missed' ? `[Missed] ${text}` : `[System] ${text}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    paddingHorizontal: spacing.none,
    textAlign: 'center',
  },
});
