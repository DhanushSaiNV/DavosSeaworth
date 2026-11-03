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
import { SegmentedControl } from './SegmentedControl';

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

function getPresetDate(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type DatePreset = '1_week' | '30_days' | '90_days' | 'custom';

const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: '1_week', label: '1 week' },
  { value: '30_days', label: '30 days' },
  { value: '90_days', label: '90 days' },
  { value: 'custom', label: 'Custom' },
];

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
  const initialReviewDate = fields?.reviewDate ?? initialDraft?.reviewDate;

  // Determine initial preset: default to 30 days per B.3
  const [datePreset, setDatePreset] = useState<DatePreset>(() => {
    if (!initialReviewDate) return '30_days';
    if (initialReviewDate === getPresetDate(7)) return '1_week';
    if (initialReviewDate === getPresetDate(30)) return '30_days';
    if (initialReviewDate === getPresetDate(90)) return '90_days';
    return 'custom';
  });

  const [commitmentText, setCommitmentText] = useState<string>(defaultCommitment);
  const [reviewDate, setReviewDate] = useState<string>(
    initialReviewDate ?? getPresetDate(30)
  );
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState<boolean>(false);

  const isDateValid = isValidDateString(reviewDate.trim());
  const isCommitmentValid = commitmentText.trim().length >= 10 && commitmentText.length <= 280;
  const canProceed = isCommitmentValid && isDateValid;

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === '1_week') {
      setReviewDate(getPresetDate(7));
    } else if (preset === '30_days') {
      setReviewDate(getPresetDate(30));
    } else if (preset === '90_days') {
      setReviewDate(getPresetDate(90));
    }
  };

  const handleReadBack = () => {
    if (!canProceed) return;
    onReadBack?.({
      commitmentText: commitmentText.trim(),
      reviewDate: reviewDate.trim(),
    });
  };

  return (
    <View style={styles.container}>
      {/* 1. Step title and subline (PRD B.1) */}
      <View style={styles.headerGroup}>
        <Text
          style={[styles.stepTitle, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          Draft your Oath
        </Text>
        <Text
          style={[styles.stepSubline, typeRoles.userText, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          One sentence. Davos will hold you to it.
        </Text>
      </View>

      {/* 2. Commitment text input (max 280, min 10, live count in meta per B.2) */}
      <View style={styles.inputGroup}>
        <View style={styles.labelRow}>
          <Text
            style={[styles.label, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Commitment
          </Text>
          <Text
            style={[
              styles.hint,
              typeRoles.meta,
              { color: commitmentText.length > 280 ? colors.danger : colors.textSecondary },
            ]}
            allowFontScaling={true}>
            {commitmentText.length}/280
          </Text>
        </View>
        <TextInput
          value={commitmentText}
          onChangeText={setCommitmentText}
          placeholder="State what you commit to without qualification."
          placeholderTextColor={colors.disabled}
          multiline
          numberOfLines={4}
          maxLength={280}
          accessibilityLabel="Commitment text input"
          style={[
            styles.textArea,
            typeRoles.userText,
            { color: colors.textPrimary, borderColor: colors.controlBorder },
          ]}
          allowFontScaling={true}
        />
        {commitmentText.length > 0 && commitmentText.trim().length < 10 && (
          <Text
            style={[styles.minNotice, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Minimum 10 characters required.
          </Text>
        )}
      </View>

      {/* 3. Review date: segmented control with 1 week / 30 days / 90 days / Custom (PRD B.3) */}
      <View style={styles.inputGroup}>
        <View style={styles.labelRow}>
          <Text
            style={[styles.label, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Review Date
          </Text>
          {datePreset !== 'custom' && (
            <Text
              style={[styles.hint, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              {reviewDate}
            </Text>
          )}
        </View>

        <SegmentedControl
          options={DATE_PRESET_OPTIONS}
          value={datePreset}
          onChange={handlePresetChange}
          colorScheme={colorScheme}
        />

        {datePreset === 'custom' && (
          <View style={styles.customDateWrapper}>
            <View style={styles.labelRow}>
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
        )}
      </View>

      {/* 4. Actions: [Discard draft / Confirmation], [Read it back] (PRD §8, B.2, B.4) */}
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
                style={[styles.buttonText, typeRoles.davosVoice, { color: colors.textPrimary, fontWeight: '500' }]}
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
                style={[styles.buttonText, typeRoles.davosVoice, { color: colors.danger, fontWeight: '500' }]}
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
                  style={[styles.textOnlyButtonText, typeRoles.davosVoice, { color: colors.textSecondary, fontWeight: '500' }]}
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
                typeRoles.davosVoice,
                { color: canProceed ? colors.textPrimary : colors.disabled, fontWeight: '500' },
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
  },
  headerGroup: {
    gap: spacing.xxs,
  },
  stepTitle: {
    paddingHorizontal: spacing.none,
  },
  stepSubline: {
    paddingHorizontal: spacing.none,
  },
  inputGroup: {
    gap: spacing.xs,
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
  minNotice: {
    paddingHorizontal: spacing.none,
  },
  textArea: {
    minHeight: 96,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  customDateWrapper: {
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
  },
  textInput: {
    height: 44,
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
    height: 44,
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
  textOnlyButton: {
    height: 44,
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  textOnlyButtonText: {
    paddingHorizontal: spacing.none,
  },
});
