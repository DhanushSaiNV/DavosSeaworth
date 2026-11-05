// components/davos/PlanEditorModal.tsx
// Modal for managing 1–12 scheduled day anchors (Redesign Mockup).
// Pure RN primitives only (Modal, View, Text, Pressable, TextInput, ScrollView).
// Tokens via useTheme.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { typography } from '../../theme/tokens/typography';
import type { PlanAnchor, PlanAnchorKind } from '../../domain/daySnapshot';

export interface PlanEditorModalProps {
  visible: boolean;
  initialAnchors: PlanAnchor[];
  onClose: () => void;
  onSave: (updatedAnchors: PlanAnchor[]) => void;
}

interface EditableAnchor {
  id: string;
  start: string;
  end: string;
  title: string;
  kind: PlanAnchorKind;
}

const KIND_OPTIONS: { label: string; value: PlanAnchorKind }[] = [
  { label: 'Commitment', value: 'commitment' },
  { label: 'Deadline', value: 'deadline' },
  { label: 'Routine', value: 'routine' },
  { label: 'Free block', value: 'free_block' },
  { label: 'Boredom relief', value: 'boredom_relief' },
];

export function PlanEditorModal({
  visible,
  initialAnchors,
  onClose,
  onSave,
}: PlanEditorModalProps) {
  const { colors } = useTheme();

  const [items, setItems] = useState<EditableAnchor[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (visible) {
      setItems(
        initialAnchors.map((a) => ({
          id: a.id,
          start: a.start,
          end: a.end,
          title: a.title,
          kind: a.kind,
        }))
      );
      setErrorMessage('');
    }
  }, [visible, initialAnchors]);

  const handleAddAnchor = () => {
    if (items.length >= 12) return;
    const newAnchor: EditableAnchor = {
      id: `anchor_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      start: '21:00',
      end: '22:00',
      title: '',
      kind: 'commitment',
    };
    setItems((prev) => [...prev, newAnchor]);
    setErrorMessage('');
  };

  const handleRemoveAnchor = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setErrorMessage('');
  };

  const handleUpdateItem = (
    id: string,
    field: keyof EditableAnchor,
    value: string
  ) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleCycleKind = (id: string, currentKind: PlanAnchorKind) => {
    const currentIndex = KIND_OPTIONS.findIndex((o) => o.value === currentKind);
    const nextIndex = (currentIndex + 1) % KIND_OPTIONS.length;
    handleUpdateItem(id, 'kind', KIND_OPTIONS[nextIndex].value);
  };

  const handleSave = () => {
    if (items.length < 1 || items.length > 12) {
      setErrorMessage('A day plan must contain between 1 and 12 anchors.');
      return;
    }

    const invalid = items.find(
      (item) => !item.start.trim() || !item.end.trim() || !item.title.trim()
    );
    if (invalid) {
      setErrorMessage(
        'Each anchor needs a title, a start time and an end time.'
      );
      return;
    }

    setErrorMessage('');

    // Sort chronologically by start time
    const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));

    const finalAnchors: PlanAnchor[] = sorted.map((item) => {
      const existing = initialAnchors.find((a) => a.id === item.id);
      return {
        id: item.id,
        start: item.start,
        end: item.end,
        title: item.title,
        kind: item.kind,
        status: existing ? existing.status : 'scheduled',
        evidence: existing?.evidence,
      };
    });

    onSave(finalAnchors);
    onClose();
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
                Today's plan
              </Text>
              <Text
                style={[
                  styles.dialogKicker,
                  typography.mono,
                  { color: colors.textTertiary },
                ]}
                allowFontScaling={true}>
                SCHEDULED ANCHORS · INDEPENDENT OF PERIOD REPORTS
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close plan editor"
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
          <ScrollView
            style={styles.dialogBody}
            contentContainerStyle={styles.dialogContent}>
            <View style={styles.list}>
              {items.map((item) => {
                const kindOption =
                  KIND_OPTIONS.find((o) => o.value === item.kind) ||
                  KIND_OPTIONS[0];
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.anchorRow,
                      { borderBottomColor: colors.borderSubtle },
                    ]}>
                    <View style={styles.timesRow}>
                      <TextInput
                        style={[
                          styles.timeInput,
                          typography.mono,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                            color: colors.textPrimary,
                          },
                        ]}
                        value={item.start}
                        onChangeText={(txt) =>
                          handleUpdateItem(item.id, 'start', txt)
                        }
                        placeholder="HH:MM"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="Start time"
                        allowFontScaling={true}
                      />
                      <Text
                        style={[
                          styles.toLabel,
                          typeRoles.meta,
                          { color: colors.textTertiary },
                        ]}>
                        to
                      </Text>
                      <TextInput
                        style={[
                          styles.timeInput,
                          typography.mono,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                            color: colors.textPrimary,
                          },
                        ]}
                        value={item.end}
                        onChangeText={(txt) =>
                          handleUpdateItem(item.id, 'end', txt)
                        }
                        placeholder="HH:MM"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="End time"
                        allowFontScaling={true}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove plan anchor ${item.title || item.start}`}
                        style={[
                          styles.removeBtn,
                          { borderColor: colors.border },
                        ]}
                        onPress={() => handleRemoveAnchor(item.id)}>
                        <Text
                          style={[
                            styles.removeBtnText,
                            { color: colors.textTertiary },
                          ]}>
                          ×
                        </Text>
                      </Pressable>
                    </View>

                    <View style={styles.fieldsRow}>
                      <TextInput
                        style={[
                          styles.titleInput,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                            color: colors.textPrimary,
                          },
                        ]}
                        value={item.title}
                        onChangeText={(txt) =>
                          handleUpdateItem(item.id, 'title', txt)
                        }
                        placeholder="Anchor title"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="Plan anchor title"
                        allowFontScaling={true}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Change anchor kind, currently ${kindOption.label}`}
                        style={[
                          styles.kindBtn,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                          },
                        ]}
                        onPress={() =>
                          handleCycleKind(item.id, item.kind)
                        }>
                        <Text
                          style={[
                            styles.kindText,
                            typeRoles.meta,
                            { color: colors.textSecondary },
                          ]}>
                          {kindOption.label} ▾
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a planned anchor"
              disabled={items.length >= 12}
              style={[
                styles.addBtn,
                {
                  borderColor: colors.border,
                  opacity: items.length >= 12 ? 0.45 : 1,
                },
              ]}
              onPress={handleAddAnchor}>
              <Text
                style={[
                  styles.addBtnText,
                  typeRoles.meta,
                  { color: colors.textSecondary },
                ]}>
                {items.length >= 12
                  ? '12 of 12 planned anchors'
                  : `＋ Add a planned anchor · ${items.length}/12`}
              </Text>
            </Pressable>

            <Text
              style={[
                styles.noteText,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              1–12 planned anchors per day. Editing this list changes the schedule
              only; it never edits period reports or manually sets completion.
            </Text>

            {Boolean(errorMessage) && (
              <Text
                style={[
                  styles.errorText,
                  typeRoles.meta,
                  { color: colors.dangerText },
                ]}
                accessibilityRole="alert"
                allowFontScaling={true}>
                {errorMessage}
              </Text>
            )}

            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing plan"
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
                accessibilityLabel="Save plan anchors"
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.accent,
                    borderColor: colors.accent,
                  },
                ]}
                onPress={handleSave}>
                <Text
                  style={[
                    styles.primaryBtnText,
                    typeRoles.meta,
                    { color: colors.onAccent },
                  ]}>
                  Save plan
                </Text>
              </Pressable>
            </View>
          </ScrollView>
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
    maxWidth: 500,
    maxHeight: '90%',
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
    fontSize: 9,
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
    flexGrow: 0,
  },
  dialogContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  list: {
    gap: 8,
  },
  anchorRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 6,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  timeInput: {
    width: 88,
    height: 38,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 11,
    textAlign: 'center',
  },
  toLabel: {
    fontSize: 10,
  },
  removeBtn: {
    marginLeft: 'auto',
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBtnText: {
    fontSize: 18,
    lineHeight: 18,
  },
  fieldsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  titleInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    fontSize: 11,
  },
  kindBtn: {
    width: 130,
    height: 38,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kindText: {
    fontSize: 10,
  },
  addBtn: {
    width: '100%',
    minHeight: 40,
    marginTop: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    fontSize: 11,
  },
  noteText: {
    marginTop: 10,
    fontSize: 10,
    lineHeight: 14,
  },
  errorText: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '500',
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
});
