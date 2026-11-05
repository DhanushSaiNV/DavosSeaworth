// components/davos/UrgeModal.tsx
// Modal for logging an urge, tracking the 10-minute hold, and recording resolution.
// RN primitives only (Modal, View, Text, Pressable, TextInput).
// Tokens via useTheme.

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { typography } from '../../theme/tokens/typography';

export type UrgeModalStage = 'log' | 'hold' | 'resolve';

export interface UrgeModalProps {
  visible: boolean;
  stage: UrgeModalStage;
  trigger: string;
  intensity: number | null;
  countdown: string;
  onClose: () => void;
  onStartHold: (trigger: string, intensity: number | null) => void;
  onExtendHold: () => void;
  onResolve: (outcome: 'held' | 'yielded') => void;
}

export function UrgeModal({
  visible,
  stage,
  trigger: initialTrigger,
  intensity: initialIntensity,
  countdown,
  onClose,
  onStartHold,
  onExtendHold,
  onResolve,
}: UrgeModalProps) {
  const { colors } = useTheme();
  const [triggerInput, setTriggerInput] = useState<string>(initialTrigger || '');
  const [selectedIntensity, setSelectedIntensity] = useState<number | null>(
    initialIntensity ?? null
  );

  const handleStart = () => {
    onStartHold(triggerInput.trim() || 'Unspecified distraction urge', selectedIntensity);
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.dialog,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}>
          {/* Header */}
          <View
            style={[
              styles.dialogHead,
              { borderBottomColor: colors.borderSubtle },
            ]}>
            <View style={styles.titleWrap}>
              <Text
                style={[
                  styles.dialogTitle,
                  { color: colors.textPrimary },
                ]}
                allowFontScaling={true}>
                {stage === 'log'
                  ? 'Log an urge'
                  : stage === 'hold'
                  ? 'Stay with the urge'
                  : 'How did it go?'}
              </Text>
              <Text
                style={[
                  styles.dialogKicker,
                  typeRoles.meta,
                  { color: colors.textTertiary },
                ]}
                allowFontScaling={true}>
                {stage === 'log'
                  ? 'User-started intervention'
                  : stage === 'hold'
                  ? 'Hold in progress'
                  : '10-minute hold complete'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close urge dialog"
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.closeButton,
                { borderColor: colors.border },
              ]}
              onPress={onClose}>
              <Text
                style={[
                  styles.closeIcon,
                  { color: colors.textPrimary },
                ]}>
                ×
              </Text>
            </Pressable>
          </View>

          {/* Body */}
          <View style={styles.dialogBody}>
            {stage === 'log' && (
              <>
                <Text
                  style={[
                    styles.fieldLabel,
                    typeRoles.meta,
                    { color: colors.textSecondary },
                  ]}
                  allowFontScaling={true}>
                  What is pulling your attention?
                </Text>
                <TextInput
                  style={[
                    styles.inputField,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                  value={triggerInput}
                  onChangeText={setTriggerInput}
                  placeholder="e.g. Open YouTube, check my phone…"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Urge trigger description"
                  allowFontScaling={true}
                />

                <View style={styles.intensityWrap}>
                  <Text
                    style={[
                      styles.fieldLabel,
                      typeRoles.meta,
                      { color: colors.textSecondary },
                    ]}
                    allowFontScaling={true}>
                    Intensity · optional
                  </Text>
                  <View style={styles.intensityRow}>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
                      const isSelected = selectedIntensity === val;
                      return (
                        <Pressable
                          key={val}
                          accessibilityRole="button"
                          accessibilityLabel={`Intensity ${val}`}
                          accessibilityState={{ selected: isSelected }}
                          style={[
                            styles.intensityBtn,
                            {
                              backgroundColor: isSelected
                                ? colors.accentSubtle
                                : colors.surfaceSubtle,
                              borderColor: isSelected
                                ? colors.borderFocus
                                : colors.border,
                            },
                          ]}
                          onPress={() =>
                            setSelectedIntensity(isSelected ? null : val)
                          }>
                          <Text
                            style={[
                              styles.intensityText,
                              typeRoles.figure,
                              {
                                color: isSelected
                                  ? colors.textPrimary
                                  : colors.textTertiary,
                              },
                            ]}>
                            {val}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel urge logging"
                    style={[
                      styles.secondaryBtn,
                      { borderColor: colors.border },
                    ]}
                    onPress={onClose}>
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        typeRoles.meta,
                        { color: colors.textSecondary },
                      ]}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start 10-minute hold"
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: colors.accent,
                        borderColor: colors.accent,
                      },
                    ]}
                    onPress={handleStart}>
                    <Text
                      style={[
                        styles.primaryBtnText,
                        typeRoles.meta,
                        { color: colors.onAccent },
                      ]}>
                      Start 10-minute hold
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {(stage === 'hold' || stage === 'resolve') && (
              <>
                <View
                  style={[
                    styles.holdPanel,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.holdStatus,
                      typeRoles.meta,
                      { color: colors.textSecondary, fontWeight: '600' },
                    ]}
                    allowFontScaling={true}>
                    {stage === 'hold'
                      ? 'HOLD IN PROGRESS'
                      : '10-MINUTE HOLD COMPLETE'}
                  </Text>
                  {stage === 'hold' && (
                    <Text
                      style={[
                        styles.holdTimer,
                        typeRoles.figureLarge,
                        { color: colors.textPrimary, fontVariant: ['tabular-nums'] },
                      ]}
                      allowFontScaling={true}>
                      {countdown}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.holdTrigger,
                      typeRoles.meta,
                      { color: colors.textSecondary },
                    ]}
                    allowFontScaling={true}>
                    {initialTrigger || 'Distraction urge'}
                  </Text>
                </View>

                <View style={styles.resolveRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Report urge yielded"
                    style={[
                      styles.secondaryBtn,
                      { borderColor: colors.border, flex: 1 },
                    ]}
                    onPress={() => onResolve('yielded')}>
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        typeRoles.meta,
                        { color: colors.textSecondary },
                      ]}>
                      I gave in
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Report urge resisted"
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: colors.accent,
                        borderColor: colors.accent,
                        flex: 1,
                      },
                    ]}
                    onPress={() => onResolve('held')}>
                    <Text
                      style={[
                        styles.primaryBtnText,
                        typeRoles.meta,
                        { color: colors.onAccent },
                      ]}>
                      I resisted
                    </Text>
                  </Pressable>
                </View>

                <View style={[styles.actionsRow, { marginTop: 12 }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add 10 more minutes"
                    style={[
                      styles.secondaryBtn,
                      { borderColor: colors.border, flex: 1 },
                    ]}
                    onPress={onExtendHold}>
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        typeRoles.meta,
                        { color: colors.textSecondary },
                      ]}>
                      {stage === 'hold'
                        ? 'Add 10 minutes'
                        : 'Continue for 10 more minutes'}
                    </Text>
                  </Pressable>
                  {stage === 'hold' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close urge window"
                      style={[
                        styles.secondaryBtn,
                        { borderColor: colors.border },
                      ]}
                      onPress={onClose}>
                      <Text
                        style={[
                          styles.secondaryBtnText,
                          typeRoles.meta,
                          { color: colors.textSecondary },
                        ]}>
                        Close
                      </Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  dialog: {
    width: '100%',
    maxWidth: 480,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  dialogHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  titleWrap: {
    flex: 1,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  dialogKicker: {
    fontSize: 10,
    letterSpacing: 0.8,
    marginTop: 4,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 18,
    lineHeight: 18,
  },
  dialogBody: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  fieldLabel: {
    fontSize: 10,
    letterSpacing: 0.7,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  inputField: {
    width: '100%',
    minHeight: 40,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    fontSize: 12,
  },
  intensityWrap: {
    marginTop: 14,
  },
  intensityRow: {
    flexDirection: 'row',
    gap: 4,
  },
  intensityBtn: {
    flex: 1,
    height: 32,
    borderWidth: 1,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  intensityText: {
    fontSize: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
  },
  secondaryBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 11,
    fontWeight: '500',
  },
  primaryBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  holdPanel: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 8,
  },
  holdStatus: {
    fontSize: 10,
    letterSpacing: 0.8,
  },
  holdTimer: {
    fontSize: 32,
    fontWeight: '600',
    lineHeight: 38,
    marginTop: 7,
    letterSpacing: -1,
  },
  holdTrigger: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 5,
  },
  resolveRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 15,
  },
});
