// components/davos/StatusLine.tsx
// Canonical component for Object: Thread (PRD §3, §12; design/DESIGN.md §6).
// Props: nextCheckIn, progress, syncState
// States: normal, offline
// Hairline divider, plain text, no cards, no elevation.
// Uses theme hook (PRD Step 0, A.2, AU37). Column left aligned (B.2). Regular weight (B.3).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  typeRoles,
} from '../../theme/roles';
import { tabularNums } from '../../theme/tokens/typography';
import { format24Hour } from '../../lib/timeFormat';

export interface StatusLineProps {
  nextCheckIn?: string;
  dueNow?: string | boolean;
  isPending?: boolean;
  isAnswering?: boolean;
  answeringTime?: string;
  progress: string;
  syncState?: 'normal' | 'offline';
  colorScheme?: 'light' | 'dark';
}

export function StatusLine({
  nextCheckIn,
  dueNow,
  isPending = false,
  isAnswering = false,
  answeringTime,
  progress,
  syncState = 'normal',
  colorScheme,
}: StatusLineProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  let timeLabel = 'Next check-in';
  let rawTime = nextCheckIn ?? '';

  if (isAnswering) {
    timeLabel = 'Answering';
    rawTime = answeringTime ?? (typeof dueNow === 'string' ? dueNow : nextCheckIn ?? '');
  } else if (isPending || dueNow) {
    timeLabel = 'Due now';
    rawTime = typeof dueNow === 'string' ? dueNow : nextCheckIn ?? '';
  }

  const displayTime = rawTime ? format24Hour(rawTime) : '';

  return (
    <View style={[styles.outerContainer, { borderBottomColor: colors.divider }]}>
      <View style={styles.innerColumn}>
        {syncState === 'offline' ? (
          <Text
            style={[styles.text, typeRoles.meta, { color: colors.textSecondary, fontWeight: '400' }]}
            allowFontScaling={true}>
            Offline. 2 waiting. · {timeLabel}{' '}
            <Text style={[typeRoles.meta, tabularNums, { color: colors.textPrimary, fontWeight: '400' }]}>
              {displayTime}
            </Text>
          </Text>
        ) : (
          <Text
            style={[styles.text, typeRoles.meta, { color: colors.textSecondary, fontWeight: '400' }]}
            allowFontScaling={true}>
            {timeLabel}{' '}
            <Text style={[typeRoles.meta, tabularNums, { color: colors.textPrimary, fontWeight: '400' }]}>
              {displayTime}
            </Text>{' '}
            · {progress}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  innerColumn: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  text: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
});
