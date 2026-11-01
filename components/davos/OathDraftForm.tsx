// components/davos/OathDraftForm.tsx
// Canonical component for Oath Draft step (S4a in BREADBOARD F4, PRD §7.4, §8, §12).
// Step 1: Commitment text, review date, [Discard draft], [Read it back].

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { spacing, touchTarget } from '../../theme/tokens/spacing';
import { OathDraft } from '../../lib/oathAdapter';

export interface OathDraftFormProps {
  initialDraft?: OathDraft | null;
  onReadBack: (draft: OathDraft) => void;
  onDiscard: () => void;
}

export function OathDraftForm({
  initialDraft,
  onReadBack,
  onDiscard,
}: OathDraftFormProps) {
  const [commitmentText, setCommitmentText] = useState<string>(
    initialDraft?.commitmentText ?? ''
  );
  const [reviewDate, setReviewDate] = useState<string>(
    initialDraft?.reviewDate ??
      new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  );

  const canProceed = commitmentText.trim().length > 0;

  const handleReadBack = () => {
    if (!canProceed) return;
    onReadBack({
      commitmentText: commitmentText.trim(),
      reviewDate: reviewDate.trim(),
    });
  };

  return (
    <View style={styles.container}>
      {/* Step title (PRD §8 layout order) */}
      <Text style={styles.stepTitle}>Draft your Oath</Text>

      {/* Commitment text input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Commitment</Text>
        <TextInput
          value={commitmentText}
          onChangeText={setCommitmentText}
          placeholder="State what you commit to without qualification."
          multiline
          numberOfLines={4}
          accessibilityLabel="Commitment text input"
          style={styles.textArea}
        />
      </View>

      {/* Review date input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Review Date</Text>
        <TextInput
          value={reviewDate}
          onChangeText={setReviewDate}
          placeholder="YYYY-MM-DD"
          accessibilityLabel="Review date input"
          style={styles.textInput}
        />
      </View>

      {/* Action buttons: Discard draft is at least 16 (spacing.sm) from primary action per PRD §8 */}
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard oath draft"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={onDiscard}>
          <Text>Discard draft</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Read back oath draft"
          disabled={!canProceed}
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={handleReadBack}>
          <Text>Read it back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    gap: spacing.md,
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
  },
  textInput: {
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
