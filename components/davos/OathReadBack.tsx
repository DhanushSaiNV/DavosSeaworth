// components/davos/OathReadBack.tsx
// Canonical component for Object: Oath read-back step (S4b in BREADBOARD F4; PRD §7.4, §8, §11, §12, §13).
// Props: fields, delay
// States: disabled, enabled, error
// Layout order (PRD §8): step title -> commitment -> one line -> actions.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
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
  colorScheme,
}: OathReadBackProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  const commitmentText = fields?.commitmentText ?? draft?.commitmentText ?? '';
  const reviewDate = fields?.reviewDate ?? draft?.reviewDate ?? '';

  return (
    <View style={styles.container}>
      {/* 1. Small label above commitment (PRD A.1, AU48) */}
      <Text
        style={[styles.stepLabel, typeRoles.meta, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        Read back your Oath
      </Text>

      {/* 2. Commitment as focal point (largest text role in theme: figureLarge, textPrimary, wrapped, maxWidth 640 per A.1) */}
      <View style={styles.commitmentContainer}>
        <Text
          style={[styles.commitmentText, typeRoles.figureLarge, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          {commitmentText}
        </Text>
      </View>

      {/* 3. Review date in body */}
      {reviewDate ? (
        <View style={styles.reviewDateContainer}>
          <Text
            style={[styles.reviewDateText, typeRoles.userText, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Review date: {reviewDate}
          </Text>
        </View>
      ) : null}

      {/* 4. One plain line: exact PRD copy in semibold, body size, textPrimary, never red (A.2, AU46) */}
      <View style={styles.warningContainer}>
        <Text
          style={[
            styles.warningLine,
            typeRoles.userText,
            { color: colors.textPrimary, fontWeight: '600' },
          ]}
          allowFontScaling={true}>
          This can't be edited or deleted.
        </Text>
      </View>

      {/* 5. Actions: [Back] (bordered secondary) and BindButton (PRD A.3, same height 44, body medium labels) */}
      <View style={styles.actionsRow}>
        {onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to draft"
            hitSlop={touchTarget.hitSlop}
            style={[styles.backButton, { borderColor: colors.controlBorder }]}
            onPress={onBack}>
            <Text
              style={[
                styles.backButtonText,
                typeRoles.davosVoice,
                { color: colors.textPrimary, fontWeight: '500' },
              ]}
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
  },
  stepLabel: {
    paddingVertical: spacing.xxs,
  },
  commitmentContainer: {
    paddingVertical: spacing.xs,
    maxWidth: 640,
    width: '100%',
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
    paddingVertical: spacing.sm,
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
    height: 44,
    minHeight: 44,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  backButtonText: {
    paddingHorizontal: spacing.none,
  },
});
