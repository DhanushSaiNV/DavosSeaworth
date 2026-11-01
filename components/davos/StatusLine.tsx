// components/davos/StatusLine.tsx
// Canonical component for Object: Thread (PRD §3, §12; design/DESIGN.md §6).
// Props: nextCheckIn, progress, syncState
// States: normal, offline
// Hairline divider, plain text, no cards, no elevation.
// Uses only theme/roles.ts.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  typeRoles,
} from '../../theme/roles';

export interface StatusLineProps {
  nextCheckIn: string;
  progress: string;
  syncState: 'normal' | 'offline';
  colorScheme?: 'light' | 'dark';
}

export function StatusLine({
  nextCheckIn,
  progress,
  syncState,
  colorScheme = 'light',
}: StatusLineProps) {
  const colors = colorRoles[colorScheme];

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      {syncState === 'offline' ? (
        <Text
          style={[styles.text, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Offline. 2 waiting. · Next check-in {nextCheckIn}
        </Text>
      ) : (
        <Text
          style={[styles.text, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Next check-in{' '}
          <Text style={typeRoles.figure}>{nextCheckIn}</Text> ·{' '}
          <Text style={typeRoles.figure}>{progress}</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    paddingHorizontal: spacing.none,
  },
});
