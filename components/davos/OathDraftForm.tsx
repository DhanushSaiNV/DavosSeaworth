// components/davos/OathDraftForm.tsx
// Canonical component for Object: Oath draft step (S4a in BREADBOARD F4; PRD §7.4, §8, §12; design/DESIGN.md §6).
// Props: fields (commitmentText, reviewDate)
// Layout order (PRD §8): step title -> commitment -> review date -> actions.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { OathDraft } from '../../lib/oathAdapter';

function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y < 2024 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export interface OathDraftFormProps {
  fields?: {
    commitmentText?: string;
    reviewDate?: string;
  };
  initialDraft?: OathDraft | null;
  onReadBack?: (draft: OathDraft) => void;
  onDiscard?: () => void;
  colorScheme?: 'light' | 'dark';
}

export function OathDraftForm({
  fields,
  initialDraft,
  onReadBack,
  onDiscard,
  colorScheme,
}: OathDraftFormProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  const defaultCommitment = fields?.commitmentText ?? initialDraft?.commitmentText ?? '';
  const defaultReviewDate =
    fields?.reviewDate ??
    initialDraft?.reviewDate ??
    new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const [commitmentText, setCommitmentText] = useState<string>(defaultCommitment);
  const [reviewDate, setReviewDate] = useState<string>(defaultReviewDate);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState<boolean>(false);

  const isDateValid = isValidDateString(reviewDate.trim());
  const hasCommitment = commitmentText.trim().length > 0;
  const canProceed = hasCommitment && isDateValid;

  const handleReadBack = () => {
    if (!canProceed) return;
    onReadBack?.({
      commitmentText: commitmentText.trim(),
      reviewDate: reviewDate.trim(),
    });
  };

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      {/* 1. Step title (PRD §8 layout order) */}
      <Text
        style={[styles.stepTitle, typeRoles.heading, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        Draft your Oath
      </Text>

      {/* 2. Commitment text input */}
      <View style={styles.inputGroup}>
        <Text
          style={[styles.label, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Commitment
        </Text>
        <TextInput
          value={commitmentText}
          onChangeText={setCommitmentText}
          placeholder="State what you commit to without qualification."
          placeholderTextColor={colors.disabled}
          multiline
          numberOfLines={4}
          accessibilityLabel="Commitment text input"
          style={[
            styles.textArea,
            typeRoles.userText,
            { color: colors.textPrimary, borderColor: colors.controlBorder },
          ]}
          allowFontScaling={true}
        />
      </View>

      {/* 3. Review date input (format hint YYYY-MM-DD and validation per D.2) */}
      <View style={styles.inputGroup}>
        <View style={styles.labelRow}>
          <Text
            style={[styles.label, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Review Date
          </Text>
          <Text
            style={[
              styles.hint,
              typeRoles.meta,
              { color: isDateValid || reviewDate.length === 0 ? colors.textSecondary : colors.danger },
            ]}
            allowFontScaling={true}>
            {isDateValid || reviewDate.length === 0 ? 'YYYY-MM-DD' : 'Invalid date (YYYY-MM-DD)'}
          </Text>
        </View>
        <TextInput
          value={reviewDate}
          onChangeText={setReviewDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.disabled}
          accessibilityLabel="Review date input"
          style={[
            styles.textInput,
            typeRoles.figure,
            {
              color: colors.textPrimary,
              borderColor: isDateValid || reviewDate.length === 0 ? colors.controlBorder : colors.danger,
            },
          ]}
          allowFontScaling={true}
        />
      </View>

      {/* 4. Actions: [Discard draft / Confirmation], [Read it back] (PRD §8, B.2) */}
      {/* Discard draft is at least 16 (spacing.sm) from primary action per D.4 */}
      {isConfirmingDiscard ? (
        <View style={[styles.confirmDiscardRow, { borderColor: colors.divider }]}>
          <Text
            style={[styles.confirmText, typeRoles.meta, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Discard draft? Progress will be lost.
          </Text>
          <View style={styles.confirmButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel discarding draft"
              hitSlop={touchTarget.hitSlop}
              style={[styles.actionButton, { borderColor: colors.controlBorder }]}
              onPress={() => setIsConfirmingDiscard(false)}>
              <Text
                style={[styles.buttonText, typeRoles.meta, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                Keep draft
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm discard draft"
              hitSlop={touchTarget.hitSlop}
              style={[styles.actionButton, { borderColor: colors.controlBorder }]}
              onPress={onDiscard}>
              <Text
                style={[styles.buttonText, typeRoles.meta, { color: colors.danger }]}
                allowFontScaling={true}>
                Confirm Discard
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <View style={styles.secondaryActions}>
            {onDiscard && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discard oath draft"
                hitSlop={touchTarget.hitSlop}
                style={styles.textOnlyButton}
                onPress={() => setIsConfirmingDiscard(true)}>
                <Text
                  style={[styles.textOnlyButtonText, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  Discard draft
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Read back oath draft"
            disabled={!canProceed}
            hitSlop={touchTarget.hitSlop}
            style={[
              styles.actionButton,
              {
                borderColor: canProceed ? colors.controlBorder : colors.divider,
                backgroundColor: colors.surface,
              },
            ]}
            onPress={handleReadBack}>
            <Text
              style={[
                styles.buttonText,
                typeRoles.heading,
                { color: canProceed ? colors.textPrimary : colors.disabled },
              ]}
              allowFontScaling={true}>
              Read it back
            </Text>
          </Pressable>
        </View>
      )}
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
  inputGroup: {
    gap: spacing.xxs,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    paddingHorizontal: spacing.none,
  },
  hint: {
    paddingHorizontal: spacing.none,
  },
  textArea: {
    minHeight: 96,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm, // Discard draft is at least 16 from primary action per PRD §8
    paddingTop: spacing.sm,
  },
  secondaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  confirmDiscardRow: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  confirmText: {
    paddingHorizontal: spacing.none,
  },
  confirmButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
  textOnlyButton: {
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  textOnlyButtonText: {
    paddingHorizontal: spacing.none,
  },
});
