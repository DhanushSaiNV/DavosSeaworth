// components/davos/CheckInPrompt.tsx
// Canonical component for Object: Check-in (PRD §3, §7.1, §11, §12; design/DESIGN.md §6).
// Props: interval, planItem?, status
// States: pending, answered, missed
// Integrates ResponseRow when planItem exists; replaces row when no planItem (PRD §7.1 rule).
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  typeRoles,
} from '../../theme/roles';
import { PlanItem } from '../../fixtures/davos';
import { CheckInResponseOption, ResponseRow } from './ResponseRow';

export interface CheckInPromptProps {
  interval: string;
  planItem?: PlanItem | null;
  status: 'pending' | 'answered' | 'missed';
  onSelectResponse?: (response: CheckInResponseOption) => void;
  colorScheme?: 'light' | 'dark';
}

export function CheckInPrompt({
  interval,
  planItem,
  status,
  onSelectResponse = () => {},
  colorScheme = 'light',
}: CheckInPromptProps) {
  const colors = colorRoles[colorScheme];
  const hasPlan = planItem !== null && planItem !== undefined;

  // 1. Pending state: with planItem renders prompt + ResponseRow; without planItem renders prompt only
  if (status === 'pending') {
    const promptText = hasPlan
      ? `${interval}. Plan says ${planItem.text}. Did you do it?`
      : `${interval}. What did you do this hour?`;

    return (
      <View style={[styles.container, { borderBottomColor: colors.divider }]}>
        <Text
          style={[
            styles.promptText,
            typeRoles.davosVoice,
            { color: colors.textPrimary },
          ]}
          allowFontScaling={true}>
          Davos: {promptText}
        </Text>

        {hasPlan ? (
          <View style={styles.responseContainer}>
            <ResponseRow
              onSelect={onSelectResponse}
              colorScheme={colorScheme}
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
    return (
      <View style={[styles.container, { borderBottomColor: colors.divider }]}>
        <Text
          style={[
            styles.promptText,
            typeRoles.davosVoice,
            { color: colors.textSecondary },
          ]}
          allowFontScaling={true}>
          Davos: {interval} check-in answered. Next check-in scheduled.
        </Text>
      </View>
    );
  }

  // 3. Missed state (PRD §11, §13: "Missed. What got in the way?")
  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      <Text
        style={[
          styles.promptText,
          typeRoles.davosVoice,
          { color: colors.danger },
        ]}
        allowFontScaling={true}>
        Davos: {interval} check-in missed. What got in the way?
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  promptText: {
    paddingHorizontal: spacing.none,
  },
  responseContainer: {
    paddingTop: spacing.xxs,
  },
  noPlanContainer: {
    paddingTop: spacing.xxs,
  },
  metaNotice: {
    paddingHorizontal: spacing.none,
  },
});
