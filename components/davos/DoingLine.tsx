// components/davos/DoingLine.tsx
// Canonical component for Object: Doing (PRD §3, §12; design/DESIGN.md §6).
// Props: what, when, kind, planLink, corrected
// States: default, editing
// A Doing represents a fact: filled marker, time at RIGHT (PRD §3 rule).
// Must be a different component from PlanItemRow.
// Uses only theme/roles.ts. RN primitives only.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { DoingRecord } from '../../fixtures/davos';
import { format24Hour } from '../../lib/timeFormat';

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
  variant?: 'regular' | 'compact';
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
  colorScheme,
  variant = 'regular',
}: DoingLineProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

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
          cursorColor={colors.accent}
          selectionColor={colors.accentSubtle}
          underlineColorAndroid="transparent"
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
            android_ripple={{ color: colors.borderSubtle }}
            style={[styles.button, { borderColor: colors.controlBorder }]}
            onPress={handleCancel}>
            <Text
              style={[styles.buttonText, typeRoles.davosVoice, { color: colors.textSecondary, fontWeight: '500' }]}
              allowFontScaling={true}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save edited doing"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={[styles.button, { borderColor: colors.controlBorder }]}
            onPress={handleSave}>
            <Text
              style={[styles.buttonText, typeRoles.davosVoice, { color: colors.textPrimary, fontWeight: '500' }]}
              allowFontScaling={true}>
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const displayWhen = when ? format24Hour(when) : '';

  // Compact variant for docked TodayPanel (PRD D.1: entry text at meta size, tag and time on one line, max 2 lines)
  if (variant === 'compact') {
    return (
      <View
        style={styles.compactContainer}
        accessibilityRole="text"
        accessibilityLabel={
          isImpulse
            ? `Urge: ${initialWhat} at ${displayWhen}`
            : `Logged: ${initialWhat} at ${displayWhen}`
        }>
        {/* Line 1: Tag and Time on one line (PRD D.1) */}
        <View style={styles.compactMetaRow}>
          <View style={styles.compactTagGroup}>
            <Text
              style={[styles.markerText, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              ●
            </Text>
            {isImpulse && (
              <Text
                style={[styles.urgeLabel, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                {kind === 'impulse_held' ? 'urge · held' : 'urge · gave in'}
              </Text>
            )}
          </View>
          <Text
            style={[styles.whenText, typeRoles.figure, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            {displayWhen}
          </Text>
        </View>

        {/* Line 2: Entry text at meta size, never more than 2 lines per entry (PRD D.1) */}
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.compactWhatText, typeRoles.meta, { color: colors.textPrimary }]}
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
      </View>
    );
  }

  // Regular variant for Today screen and Proof (PRD D.1, AU44: keeps body size in textPrimary)
  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={
        isImpulse
          ? `Urge: ${initialWhat} at ${displayWhen}`
          : `Logged: ${initialWhat} at ${displayWhen}`
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

      {/* Description of what happened (body size, textPrimary per AU44, E.1, D.1) */}
      <Text
        style={[styles.whatText, typeRoles.userText, { color: colors.textPrimary }]}
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

      {/* Time at RIGHT (PRD §3, AU43 24-hour format) */}
      <Text
        style={[styles.whenText, typeRoles.figure, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        {displayWhen}
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
  compactContainer: {
    paddingVertical: spacing.xxs,
    paddingLeft: spacing.sm,
    gap: 2,
  },
  compactMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactTagGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  compactWhatText: {
    paddingHorizontal: spacing.none,
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
    height: 44,
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
