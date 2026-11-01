// components/davos/CheckInPrompt.tsx
// Canonical component for Object: Check-in (PRD §3, §7.1, §11, §12; AU4, AU14).
// Props: interval, planItem?, status
// States: pending, answered, missed
// Integrates ResponseRow directly under the question, left-aligned with it.
// Uses theme hook (PRD Step 0, A.2, AU37). RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  typeRoles,
} from '../../theme/roles';
import { PlanItem } from '../../fixtures/davos';
import { CheckInResponseOption, ResponseRow } from './ResponseRow';
import { SystemLine } from './SystemLine';

export interface CheckInPromptProps {
  interval: string;
  planItem?: PlanItem | null;
  status: 'pending' | 'answered' | 'missed';
  onSelectResponse?: (response: CheckInResponseOption) => void;
  selectedOption?: CheckInResponseOption | null;
  colorScheme?: 'light' | 'dark';
}

export function CheckInPrompt({
  interval,
  planItem,
  status,
  onSelectResponse = () => {},
  selectedOption = null,
  colorScheme,
}: CheckInPromptProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const hasPlan = planItem !== null && planItem !== undefined;

  // 1. Pending state: question and options agree (PRD A2, A3, A4)
  if (status === 'pending') {
    const promptText = hasPlan
      ? `${interval}. Plan says ${planItem.text}. Did you do it?`
      : `${interval}. What did you do this hour?`;

    return (
      <View
        style={styles.container}
        accessible={true}
        accessibilityRole="text"
        accessibilityLabel={`Davos said: ${promptText}`}
      >
        <Text
          style={[
            styles.promptText,
            styles.focalPromptText,
            { color: colors.textPrimary },
          ]}
          allowFontScaling={true}>
          {promptText}
        </Text>

        {hasPlan ? (
          <View style={styles.responseContainer}>
            <ResponseRow
              onSelect={onSelectResponse}
              selectedOption={selectedOption}
            />
          </View>
        ) : (
          <View style={styles.noPlanContainer}>
            <Text
              style={[styles.metaNotice, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              No Plan item for this interval. Reply in composer below.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // 2. Answered state (PRD §11)
  if (status === 'answered') {
    const answeredText = `${interval} check-in answered. Next check-in scheduled.`;
    return (
      <View
        style={styles.container}
        accessible={true}
        accessibilityRole="text"
        accessibilityLabel={`Davos said: ${answeredText}`}
      >
        <Text
          style={[
            styles.promptText,
            typeRoles.davosVoice,
            { color: colors.textSecondary },
          ]}
          allowFontScaling={true}>
          {answeredText}
        </Text>
      </View>
    );
  }

  // 3. Missed state (PRD A4: plain system line "14:00 check-in missed." followed by Davos's question "What got in the way?", never red)
  return (
    <View style={styles.missedContainer}>
      <SystemLine text={`${interval} check-in missed.`} state="missed" />
      <View
        style={styles.davosFollowUp}
        accessible={true}
        accessibilityRole="text"
        accessibilityLabel="Davos said: What got in the way?"
      >
        <Text
          style={[
            styles.promptText,
            typeRoles.davosVoice,
            { color: colors.textPrimary },
          ]}
          allowFontScaling={true}>
          What got in the way?
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  missedContainer: {
    paddingVertical: spacing.xs,
    alignItems: 'flex-start',
    gap: spacing.xs,
    width: '100%',
  },
  davosFollowUp: {
    paddingTop: spacing.xxs,
  },
  promptText: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
  focalPromptText: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '500',
  },
  responseContainer: {
    paddingTop: spacing.xxs,
    alignItems: 'flex-start',
  },
  noPlanContainer: {
    paddingTop: spacing.xxs,
  },
  metaNotice: {
    paddingHorizontal: spacing.none,
  },
});
