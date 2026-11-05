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

  // 1. Saved State (compact undo strip; auto-retracts to null when undoSecondsRemaining <= 0)
  if (savedReport && !isEditing) {
    if (undoSecondsRemaining <= 0) {
      return null;
    }
    return (
      <View style={styles.outerContainer} accessibilityLabel="Action zone">
        <View
          style={[
            styles.undoStrip,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}>
          <View style={styles.undoStripLeft}>
            <View
              style={[
                styles.savedDot,
                { backgroundColor: colors.success },
              ]}
            />
            <Text
              style={[
                styles.undoStripText,
                typeRoles.meta,
                { color: colors.textPrimary },
              ]}
              allowFontScaling={true}
              numberOfLines={1}>
              Report saved · {windowTime} (Energy {savedReport.energy}/10)
            </Text>
          </View>
          <View style={styles.undoStripActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Undo report submission within ${undoSecondsRemaining} seconds`}
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.undoBtn,
                { borderColor: colors.border },
              ]}
              onPress={onUndo}>
              <Text
                style={[
                  styles.undoBtnText,
                  typeRoles.meta,
                  { color: colors.textSecondary },
                ]}
                allowFontScaling={true}>
                Undo · {undoSecondsRemaining}s
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit saved period report"
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.editBtn,
                { borderColor: colors.border },
              ]}
              onPress={onEdit}>
              <Text
                style={[
                  styles.editBtnText,
                  typeRoles.meta,
                  { color: colors.textPrimary, fontWeight: '600' },
                ]}
                allowFontScaling={true}>
                Edit
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // 2. Active Form / Edit Mode (Compact ~130dp layout)
  return (
    <View style={styles.outerContainer} accessibilityLabel="Action zone">
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}>
        <View style={styles.cardInner}>
          {/* Header Row: Title & submit deadline */}
          <View style={styles.cardHeader}>
            <View style={styles.titleWrap}>
              <View
                style={[
                  styles.typeMark,
                  { borderColor: colors.accent },
                ]}
              />
              <Text
                style={[
                  styles.cardTitle,
                  typeRoles.userText,
                  { color: colors.textPrimary, fontWeight: '600' },
                ]}
                allowFontScaling={true}>
                {isEditing
                  ? `Edit report · ${windowTime}`
                  : `What did you do between ${windowTime}?`}
              </Text>
            </View>
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

          {/* Compact Input Field */}
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

          {/* Compact 10-Step Energy Selector */}
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
              ENERGY
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
                          : colors.surfaceSubtle,
                        borderColor: isSelected ? colors.accent : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedEnergy(val)}>
                    <Text
                      style={[
                        styles.energyStepText,
                        typeRoles.meta,
                        {
                          color: isSelected
                            ? colors.onAccent
                            : colors.textTertiary,
                          fontSize: 9,
                        },
                      ]}>
                      {val}
                    </Text>
                  </Pressable>
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
              {selectedEnergy !== null ? `${selectedEnergy}/10` : '—/10'}
            </Text>
          </View>

          {/* Bottom Actions */}
          <View style={styles.bottomRow}>
            <Text
              style={[
                styles.requiredNote,
                typeRoles.meta,
                { color: isValid ? colors.successText : colors.textTertiary },
              ]}
              allowFontScaling={true}>
              {reportText.trim().length < 8
                ? `${8 - reportText.trim().length} more characters needed`
                : selectedEnergy === null
                ? 'Select energy (1–10)'
                : 'Ready to submit'}
            </Text>
            <View style={styles.bottomButtons}>
              {isEditing && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel report edit"
                  hitSlop={touchTarget.hitSlop}
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
                hitSlop={touchTarget.hitSlop}
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
                  {isEditing ? 'Update report' : 'Submit report'}
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
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardInner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  typeMark: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  cardTitle: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  submitBy: {
    fontSize: 8,
    letterSpacing: 0.4,
    marginLeft: 8,
  },
  textInput: {
    width: '100%',
    minHeight: 52,
    maxHeight: 96,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: radius.sm,
    fontSize: 12,
    lineHeight: 17,
    textAlignVertical: 'top',
  },
  energyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  energyCaption: {
    fontSize: 8,
    letterSpacing: 0.6,
  },
  energySteps: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
    minHeight: 26,
    alignItems: 'center',
  },
  energyStep: {
    flex: 1,
    height: 22,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  energyStepText: {
    fontSize: 9,
    fontWeight: '600',
  },
  energyValue: {
    width: 38,
    textAlign: 'right',
    fontSize: 10,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  requiredNote: {
    fontSize: 10,
    flex: 1,
  },
  bottomButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secondaryBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 10,
  },
  saveBtn: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 10,
    fontWeight: '600',
  },
  undoStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: 40,
    gap: 8,
  },
  undoStripLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  savedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  undoStripText: {
    fontSize: 11,
    flex: 1,
  },
  undoStripActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  undoBtn: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  undoBtnText: {
    fontSize: 10,
  },
  editBtn: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtnText: {
    fontSize: 10,
  },
});
