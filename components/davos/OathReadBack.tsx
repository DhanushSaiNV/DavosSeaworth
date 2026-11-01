// components/davos/OathReadBack.tsx
// Canonical component for Object: Oath read-back step (S4b in BREADBOARD F4; PRD §7.4, §8, §11, §12, §13).
// Props: fields, delay
// States: disabled, enabled, error
// Layout order (PRD §8): step title -> commitment -> one line -> actions.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { OathDraft } from '../../lib/oathAdapter';
import { BindButton } from './BindButton';

export interface OathReadBackProps {
  fields?: {
    commitmentText: string;
    reviewDate: string;
  };
  draft?: OathDraft;
  delay?: number; // 5 seconds by default
  onBack?: () => void;
  onBind?: () => void;
  state?: 'disabled' | 'enabled' | 'error';
  isBinding?: boolean;
  isOffline?: boolean;
  errorMessage?: string;
  colorScheme?: 'light' | 'dark';
}

export function OathReadBack({
  fields,
  draft,
  delay = 5,
  onBack,
  onBind = () => {},
  state,
  isBinding = false,
  isOffline = false,
  errorMessage,
  colorScheme = 'light',
}: OathReadBackProps) {
  const colors = colorRoles[colorScheme];

  const commitmentText = fields?.commitmentText ?? draft?.commitmentText ?? '';
  const reviewDate = fields?.reviewDate ?? draft?.reviewDate ?? '';

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      {/* 1. Step title (PRD §8 layout order) */}
      <Text
        style={[styles.stepTitle, typeRoles.heading, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        Read back your Oath
      </Text>

      {/* 2. Commitment in large type (PRD §7.4, §8) */}
      <View style={styles.commitmentContainer}>
        <Text
          style={[styles.commitmentText, typeRoles.davosVoice, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          {commitmentText}
        </Text>
      </View>

      {/* 3. Review date plain line */}
      {reviewDate ? (
        <View style={styles.reviewDateContainer}>
          <Text
            style={[styles.reviewDateText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Review date: {reviewDate}
          </Text>
        </View>
      ) : null}

      {/* 4. One plain line: exact PRD §13 / BREADBOARD F4 copy */}
      <View style={styles.warningContainer}>
        <Text
          style={[styles.warningLine, typeRoles.meta, { color: colors.danger }]}
          allowFontScaling={true}>
          This can't be edited or deleted.
        </Text>
      </View>

      {/* 5. Actions: [Back] and BindButton (PRD §8) */}
      <View style={styles.actionsRow}>
        {onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to draft"
            hitSlop={touchTarget.hitSlop}
            style={[styles.backButton, { borderColor: colors.divider }]}
            onPress={onBack}>
            <Text
              style={[styles.backButtonText, typeRoles.heading, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Back
            </Text>
          </Pressable>
        )}

        <BindButton
          delay={delay}
          onBind={onBind}
          state={state}
          isBinding={isBinding}
          isOffline={isOffline}
          errorMessage={errorMessage}
          colorScheme={colorScheme}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepTitle: {
    paddingVertical: spacing.xxs,
  },
  commitmentContainer: {
    paddingVertical: spacing.xs,
  },
  commitmentText: {
    paddingHorizontal: spacing.none,
  },
  reviewDateContainer: {
    paddingVertical: spacing.xxs,
  },
  reviewDateText: {
    paddingHorizontal: spacing.none,
  },
  warningContainer: {
    paddingVertical: spacing.xxs,
  },
  warningLine: {
    paddingHorizontal: spacing.none,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm, // Discard/Back at least 16dp from Bind per PRD §8
    paddingTop: spacing.xs,
  },
  backButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  backButtonText: {
    paddingHorizontal: spacing.none,
  },
});
