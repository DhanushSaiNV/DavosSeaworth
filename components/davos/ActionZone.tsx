// components/davos/ActionZone.tsx
// Dedicated Action Zone card for the current cadence period check-in (Redesign Mockup).
// Pure RN primitives only (View, Text, Pressable, TextInput).
// Tokens via useTheme.

import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';

export interface ActionZoneProps {
  windowTime?: string;
  submitByTime?: string;
  savedReport: {
    text: string;
    energy: number;
    submittedAt?: string;
  } | null;
  undoSecondsRemaining?: number;
  isEditing?: boolean;
  onSubmit: (text: string, energy: number) => void;
  onUndo: () => void;
  onEdit: () => void;
  onCancelEdit?: () => void;
}

export function ActionZone({
  windowTime = '17:00–18:00',
  submitByTime = 'SUBMIT BY 18:10',
  savedReport,
  undoSecondsRemaining = 0,
  isEditing = false,
  onSubmit,
  onUndo,
  onEdit,
  onCancelEdit,
}: ActionZoneProps) {
  const { colors } = useTheme();

  const [reportText, setReportText] = useState<string>(
    savedReport ? savedReport.text : ''
  );
  const [selectedEnergy, setSelectedEnergy] = useState<number | null>(
    savedReport ? savedReport.energy : null
  );

  // Sync state when savedReport or isEditing changes
  useEffect(() => {
    if (savedReport) {
      setReportText(savedReport.text);
      setSelectedEnergy(savedReport.energy);
    } else {
      setReportText('');
      setSelectedEnergy(null);
    }
  }, [savedReport, isEditing]);

  const isValid = reportText.trim().length >= 8 && selectedEnergy !== null;

  const handleSubmit = () => {
    if (!isValid || selectedEnergy === null) return;
    onSubmit(reportText.trim(), selectedEnergy);
  };

  const handleCancel = () => {
    if (savedReport) {
      setReportText(savedReport.text);
      setSelectedEnergy(savedReport.energy);
    }
    if (onCancelEdit) {
      onCancelEdit();
    }
  };

  // 1. Saved State (when savedReport is present and not currently editing)
  if (savedReport && !isEditing) {
    const canUndo = undoSecondsRemaining > 0;
    return (
      <View style={styles.outerContainer} accessibilityLabel="Action zone">
        <View style={styles.headRow}>
          <Text
            style={[
              styles.headTitle,
              typeRoles.meta,
              { color: colors.textSecondary },
            ]}
            allowFontScaling={true}>
            CURRENT INTERACTION
          </Text>
          <Text
            style={[
              styles.headCount,
              typeRoles.meta,
              { color: colors.textTertiary },
            ]}
            allowFontScaling={true}>
            REPORT RECEIVED · ONE WINDOW
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}>
          <View style={styles.savedInner}>
            <View style={styles.savedCopy}>
              <View style={styles.savedHeading}>
                <View
                  style={[
                    styles.savedDot,
                    { backgroundColor: colors.success },
                  ]}
                />
                <Text
                  style={[
                    styles.savedHeadingText,
                    typeRoles.meta,
                    { color: colors.successText, fontWeight: '600' },
                  ]}
                  allowFontScaling={true}>
                  PERIOD REPORT SAVED
                </Text>
              </View>
              <Text
                style={[
                  styles.savedTitle,
                  { color: colors.textPrimary },
                ]}
                allowFontScaling={true}>
                {windowTime} · Energy {savedReport.energy}/10
              </Text>
              <Text
                style={[
                  styles.savedDetail,
                  typeRoles.meta,
                  { color: colors.textSecondary },
                ]}
                allowFontScaling={true}>
                Saved to the 17:00 window. Editing replaces this report; it does
                not create another check-in. Davos assesses plan anchors
                separately.
              </Text>
            </View>

            <View style={styles.savedActions}>
              {canUndo && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Undo report submission within ${undoSecondsRemaining} seconds`}
                  style={[
                    styles.actionBtn,
                    { borderColor: colors.border },
                  ]}
                  onPress={onUndo}>
                  <Text
                    style={[
                      styles.actionBtnText,
                      typeRoles.meta,
                      { color: colors.textSecondary },
                    ]}
                    allowFontScaling={true}>
                    Undo · {undoSecondsRemaining}s
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit saved period report"
                style={[
                  styles.actionBtn,
                  { borderColor: colors.border },
                ]}
                onPress={onEdit}>
                <Text
                  style={[
                    styles.actionBtnText,
                    typeRoles.meta,
                    { color: colors.textPrimary },
                  ]}
                  allowFontScaling={true}>
                  Edit report
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // 2. Active Form / Edit Mode
  return (
    <View style={styles.outerContainer} accessibilityLabel="Action zone">
      <View style={styles.headRow}>
        <Text
          style={[
            styles.headTitle,
            typeRoles.meta,
            { color: colors.textSecondary },
          ]}
          allowFontScaling={true}>
          CURRENT INTERACTION
        </Text>
        <Text
          style={[
            styles.headCount,
            typeRoles.meta,
            { color: colors.textTertiary },
          ]}
          allowFontScaling={true}>
          {isEditing
            ? 'EDIT EXISTING REPORT · SAME WINDOW'
            : 'PERIOD REPORT · REQUIRED'}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}>
        <View style={styles.cardInner}>
          {/* Meta Row */}
          <View style={styles.metaRow}>
            <View style={styles.typeWrap}>
              <View
                style={[
                  styles.typeMark,
                  { borderColor: colors.accent },
                ]}
              />
              <Text
                style={[
                  styles.typeText,
                  typeRoles.meta,
                  { color: colors.textSecondary, fontWeight: '600' },
                ]}
                allowFontScaling={true}>
                {isEditing ? 'EDIT PERIOD REPORT' : 'PERIOD CHECK-IN'}
              </Text>
            </View>
            <View style={styles.timeWrap}>
              <Text
                style={[
                  styles.timeRange,
                  typeRoles.figure,
                  { color: colors.accent, fontWeight: '600' },
                ]}
                allowFontScaling={true}>
                {windowTime}
              </Text>
              <Text
                style={[
                  styles.submitBy,
                  typeRoles.meta,
                  { color: colors.textTertiary },
                ]}
                allowFontScaling={true}>
                {submitByTime}
              </Text>
            </View>
          </View>

          {/* Title & Prompt */}
          <Text
            style={[
              styles.actionTitle,
              { color: colors.textPrimary },
            ]}
            allowFontScaling={true}>
            What did you do between {windowTime}?
          </Text>
          <Text
            style={[
              styles.actionPrompt,
              typeRoles.meta,
              { color: colors.textSecondary },
            ]}
            allowFontScaling={true}>
            Write one sentence about what happened in this cadence period and
            select your current energy. Davos uses this report as evidence when
            assessing planned anchors.
          </Text>

          {/* Context callout */}
          <View
            style={[
              styles.contextBox,
              {
                backgroundColor: colors.surfaceSubtle,
                borderLeftColor: colors.borderFocus,
              },
            ]}>
            <Text
              style={[
                styles.contextText,
                typeRoles.meta,
                { color: colors.textSecondary },
              ]}
              allowFontScaling={true}>
              This report covers the previous cadence window. It is not a
              task-completion question; describe what happened, including
              interruptions or unfinished work.
            </Text>
          </View>

          {/* Report Input Field */}
          <Text
            style={[
              styles.reportLabel,
              typeRoles.meta,
              { color: colors.textSecondary },
            ]}
            allowFontScaling={true}>
            ACTIVITY REPORT
          </Text>
          <TextInput
            style={[
              styles.textInput,
              typeRoles.userText,
              {
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
                color: colors.textPrimary,
              },
            ]}
            multiline={true}
            numberOfLines={2}
            value={reportText}
            onChangeText={setReportText}
            placeholder="One sentence is enough. What actually happened during this period?"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Activity report input"
            allowFontScaling={true}
          />
          <Text
            style={[
              styles.reportHelper,
              typeRoles.meta,
              { color: colors.textTertiary },
            ]}
            allowFontScaling={true}>
            Include progress, interruptions and unfinished work. You do not
            need to mark any plan item yourself.
          </Text>

          {/* 10-Step Energy Selector */}
          <View
            style={[
              styles.energyRow,
              { borderTopColor: colors.borderSubtle },
            ]}>
            <Text
              style={[
                styles.energyCaption,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              CURRENT ENERGY
            </Text>
            <View
              style={styles.energySteps}
              accessibilityRole="radiogroup"
              accessibilityLabel="Current energy from 1 to 10">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
                const isSelected =
                  selectedEnergy !== null && val <= selectedEnergy;
                return (
                  <Pressable
                    key={val}
                    accessibilityRole="radio"
                    accessibilityLabel={`Energy ${val} of 10`}
                    accessibilityState={{
                      selected: selectedEnergy === val,
                    }}
                    hitSlop={touchTarget.hitSlop}
                    style={[
                      styles.energyStep,
                      {
                        backgroundColor: isSelected
                          ? colors.accent
                          : colors.borderSubtle,
                      },
                    ]}
                    onPress={() => setSelectedEnergy(val)}
                  />
                );
              })}
            </View>
            <Text
              style={[
                styles.energyValue,
                typeRoles.figure,
                { color: colors.textSecondary },
              ]}
              allowFontScaling={true}>
              {selectedEnergy !== null ? `${selectedEnergy} / 10` : '— / 10'}
            </Text>
          </View>

          {/* Bottom Actions */}
          <View style={styles.bottomRow}>
            <Text
              style={[
                styles.requiredNote,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              Sentence + energy required.
            </Text>
            <View style={styles.bottomButtons}>
              {isEditing && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel report edit"
                  style={[
                    styles.secondaryBtn,
                    { borderColor: colors.border },
                  ]}
                  onPress={handleCancel}>
                  <Text
                    style={[
                      styles.secondaryBtnText,
                      typeRoles.meta,
                      { color: colors.textSecondary },
                    ]}
                    allowFontScaling={true}>
                    Cancel
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isEditing ? 'Update same report' : 'Submit period report'
                }
                disabled={!isValid}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: isValid
                      ? colors.accent
                      : colors.surfaceRaised,
                    borderColor: isValid ? colors.accent : colors.border,
                  },
                ]}
                onPress={handleSubmit}>
                <Text
                  style={[
                    styles.saveBtnText,
                    typeRoles.meta,
                    {
                      color: isValid ? colors.onAccent : colors.textTertiary,
                    },
                  ]}
                  allowFontScaling={true}>
                  {isEditing ? 'Update same report' : 'Submit period report'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    width: '100%',
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderColor: 'transparent',
  },
  headTitle: {
    fontSize: 10,
    letterSpacing: 1,
  },
  headCount: {
    fontSize: 9,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardInner: {
    padding: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  typeText: {
    fontSize: 10,
    letterSpacing: 0.9,
  },
  timeWrap: {
    alignItems: 'flex-end',
    gap: 2,
  },
  timeRange: {
    fontSize: 10,
    fontWeight: '600',
  },
  submitBy: {
    fontSize: 8,
    letterSpacing: 0.4,
  },
  actionTitle: {
    marginTop: 10,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  actionPrompt: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  contextBox: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: 2,
    borderRadius: 2,
  },
  contextText: {
    fontSize: 11,
    lineHeight: 16,
  },
  reportLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  textInput: {
    width: '100%',
    minHeight: 70,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: radius.sm,
    fontSize: 12,
    lineHeight: 17,
    textAlignVertical: 'top',
  },
  reportHelper: {
    marginTop: 5,
    fontSize: 10,
    lineHeight: 14,
  },
  energyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
  },
  energyCaption: {
    fontSize: 9,
    letterSpacing: 0.6,
  },
  energySteps: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 28,
    alignItems: 'center',
  },
  energyStep: {
    flex: 1,
    height: 8,
    borderRadius: 4,
  },
  energyValue: {
    width: 44,
    textAlign: 'right',
    fontSize: 10,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
  },
  requiredNote: {
    fontSize: 10,
    flex: 1,
  },
  bottomButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 11,
  },
  saveBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  savedInner: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 15,
  },
  savedCopy: {
    flex: 1,
    minWidth: 0,
  },
  savedHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  savedHeadingText: {
    fontSize: 10,
    letterSpacing: 0.8,
  },
  savedTitle: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  savedDetail: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 16,
  },
  savedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  actionBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 11,
  },
});
