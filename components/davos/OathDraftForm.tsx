// components/davos/OathDraftForm.tsx
// Canonical component for Object: Oath draft step (S4a in BREADBOARD F4; PRD §7.4, §8, §12; design/DESIGN.md §6).
// Props: fields (commitmentText, reviewDate)
// Layout order (PRD §8): step title -> commitment -> review date -> actions.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { OathDraft } from '../../lib/oathAdapter';

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
  colorScheme = 'light',
}: OathDraftFormProps) {
  const colors = colorRoles[colorScheme];

  const defaultCommitment = fields?.commitmentText ?? initialDraft?.commitmentText ?? '';
  const defaultReviewDate =
    fields?.reviewDate ??
    initialDraft?.reviewDate ??
    new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const [commitmentText, setCommitmentText] = useState<string>(defaultCommitment);
  const [reviewDate, setReviewDate] = useState<string>(defaultReviewDate);

  const canProceed = commitmentText.trim().length > 0;

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
            { color: colors.textPrimary, borderColor: colors.divider },
          ]}
          allowFontScaling={true}
        />
      </View>

      {/* 3. Review date input */}
      <View style={styles.inputGroup}>
        <Text
          style={[styles.label, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Review Date
        </Text>
        <TextInput
          value={reviewDate}
          onChangeText={setReviewDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.disabled}
          accessibilityLabel="Review date input"
          style={[
            styles.textInput,
            typeRoles.figure,
            { color: colors.textPrimary, borderColor: colors.divider },
          ]}
          allowFontScaling={true}
        />
      </View>

      {/* 4. Actions: [Discard draft], [Read it back] */}
      {/* Discard draft is at least 16 (spacing.sm) from primary action per PRD §8 */}
      <View style={styles.actionsRow}>
        {onDiscard && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard oath draft"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={onDiscard}>
            <Text
              style={[styles.buttonText, typeRoles.heading, { color: colors.danger }]}
              allowFontScaling={true}>
              Discard draft
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Read back oath draft"
          disabled={!canProceed}
          hitSlop={touchTarget.hitSlop}
          style={[
            styles.actionButton,
            {
              borderColor: canProceed ? colors.textPrimary : colors.divider,
              backgroundColor: canProceed ? colors.surface : colors.surface,
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
  label: {
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
});
