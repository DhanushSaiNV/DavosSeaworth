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
  nextCheckIn?: string;
  dueNow?: string | boolean;
  isPending?: boolean;
  progress: string;
  syncState?: 'normal' | 'offline';
  colorScheme?: 'light' | 'dark';
}

export function StatusLine({
  nextCheckIn,
  dueNow,
  isPending = false,
  progress,
  syncState = 'normal',
  colorScheme = 'light',
}: StatusLineProps) {
  const colors = colorRoles[colorScheme];
  const isDue = Boolean(isPending || dueNow);
  const timeLabel = isDue ? 'Due now' : 'Next check-in';
  const displayTime = typeof dueNow === 'string' ? dueNow : nextCheckIn ?? '';

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      {syncState === 'offline' ? (
        <Text
          style={[styles.text, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Offline. 2 waiting. · {timeLabel} <Text style={typeRoles.figure}>{displayTime}</Text>
        </Text>
      ) : (
        <Text
          style={[styles.text, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          {timeLabel} <Text style={typeRoles.figure}>{displayTime}</Text> · {progress}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    paddingHorizontal: spacing.none,
  },
});
