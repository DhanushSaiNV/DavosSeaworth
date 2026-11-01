// components/davos/DoingLine.tsx
// Canonical component for Object: Doing (PRD §3, §12; design/DESIGN.md §6).
// Props: what, when, kind, planLink, corrected
// States: default, editing
// A Doing represents a fact: filled marker, time at RIGHT (PRD §3 rule).
// Must be a different component from PlanItemRow.
// Uses only theme/roles.ts. RN primitives only.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { DoingRecord } from '../../fixtures/davos';

export interface DoingLineProps {
  what?: string;
  when?: string;
  kind?: 'action' | 'impulse_held' | 'impulse_yielded';
  planLink?: string | null;
  corrected?: boolean;
  doing?: DoingRecord;
  isEditing?: boolean;
  onSave?: (newWhat: string) => void;
  onCancel?: () => void;
  colorScheme?: 'light' | 'dark';
}

export function DoingLine({
  what: propWhat,
  when: propWhen,
  kind: propKind,
  planLink: propPlanLink,
  corrected: propCorrected,
  doing,
  isEditing = false,
  onSave,
  onCancel,
  colorScheme = 'light',
}: DoingLineProps) {
  const colors = colorRoles[colorScheme];

  const kind = doing?.kind ?? propKind ?? 'action';
  const initialWhat = doing?.what ?? propWhat ?? '';
  const when = doing?.when ?? propWhen ?? '00:00';
  const corrected = doing?.corrected ?? propCorrected ?? false;
  const isImpulse = kind === 'impulse_held' || kind === 'impulse_yielded';

  const [draftWhat, setDraftWhat] = useState<string>(initialWhat);
  const [internalEditing, setInternalEditing] = useState<boolean>(isEditing);

  const activeEditing = isEditing || internalEditing;

  const handleSave = () => {
    onSave?.(draftWhat);
    setInternalEditing(false);
  };

  const handleCancel = () => {
    setDraftWhat(initialWhat);
    onCancel?.();
    setInternalEditing(false);
  };

  // State: editing (Doing correction preserving original audit context per PRD §3 / A16)
  if (activeEditing) {
    return (
      <View style={[styles.editContainer, { borderBottomColor: colors.divider }]}>
        <TextInput
          value={draftWhat}
          onChangeText={setDraftWhat}
          placeholder="What did you do?"
          placeholderTextColor={colors.disabled}
          accessibilityLabel="Edit doing description"
          style={[
            styles.input,
            typeRoles.userText,
            { color: colors.textPrimary, borderColor: colors.divider },
          ]}
          allowFontScaling={true}
        />
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel editing doing"
            hitSlop={touchTarget.hitSlop}
            style={[styles.button, { borderColor: colors.divider }]}
            onPress={handleCancel}>
            <Text
              style={[styles.buttonText, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save edited doing"
            hitSlop={touchTarget.hitSlop}
            style={[styles.button, { borderColor: colors.divider }]}
            onPress={handleSave}>
            <Text
              style={[styles.buttonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // State: default (Fact: filled marker or urge marker, time at RIGHT)
  // Quieter hierarchy: meta size (12px), textSecondary, indented, no per-row hairline (C2, D4)
  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={
        isImpulse
          ? `Urge: ${initialWhat} at ${when}`
          : `Logged: ${initialWhat} at ${when}`
      }>
      {isImpulse ? (
        <View style={styles.urgeGroup}>
          <Text
            style={[styles.markerText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            ●
          </Text>
          <Text
            style={[styles.urgeLabel, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            {kind === 'impulse_held' ? 'urge · held' : 'urge · gave in'}
          </Text>
        </View>
      ) : (
        <Text
          style={[styles.markerText, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          ●
        </Text>
      )}

      {/* Description of what happened (meta size, textSecondary) */}
      <Text
        style={[styles.whatText, typeRoles.meta, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        {initialWhat}
        {corrected ? (
          <Text
            style={[styles.correctedNotice, typeRoles.meta, { color: colors.disabled }]}
            allowFontScaling={true}>
            {' '}(corrected)
          </Text>
        ) : null}
      </Text>

      {/* Time at RIGHT (PRD §3) */}
      <Text
        style={[styles.whenText, typeRoles.figure, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        {when}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
    paddingLeft: spacing.md, // Indented under Plan item
  },
  urgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  urgeLabel: {
    paddingHorizontal: spacing.none,
  },
  markerText: {
    paddingHorizontal: spacing.none,
  },
  whatText: {
    flex: 1,
    paddingHorizontal: spacing.none,
  },
  correctedNotice: {
    paddingHorizontal: spacing.none,
  },
  whenText: {
    minWidth: 48,
    textAlign: 'right',
    paddingHorizontal: spacing.none,
  },
  editContainer: {
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  button: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
