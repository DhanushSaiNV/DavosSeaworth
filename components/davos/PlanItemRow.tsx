// components/davos/PlanItemRow.tsx
// Canonical component for Object: Plan (PRD §3, §12; design/DESIGN.md §6).
// Props: text, time, status, order
// States: pending, done, partly, missed, editing
// Plan items represent intentions: outlined marker, time at LEFT (PRD §3 rule).
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { PlanItem } from '../../fixtures/davos';

export interface PlanItemRowProps {
  // Support either destructured props matching DESIGN.md or item object
  text?: string;
  time?: string;
  status?: 'pending' | 'done' | 'partly' | 'missed';
  order?: number;
  item?: PlanItem;
  isEditing?: boolean;
  onTextChange?: (text: string) => void;
  onTimeChange?: (time: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  colorScheme?: 'light' | 'dark';
}

export function PlanItemRow({
  text: propText,
  time: propTime,
  status: propStatus,
  order: propOrder,
  item,
  isEditing = false,
  onTextChange,
  onTimeChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp = false,
  canMoveDown = false,
  colorScheme = 'light',
}: PlanItemRowProps) {
  const colors = colorRoles[colorScheme];

  const text = item?.text ?? propText ?? '';
  const time = item?.time ?? propTime ?? '00:00';
  const status = item?.status ?? propStatus ?? 'pending';
  const order = item?.order ?? propOrder ?? 1;

  // State: editing (in-place text & time editing, reordering up/down, remove)
  if (isEditing) {
    return (
      <View style={[styles.editRow, { borderBottomColor: colors.divider }]}>
        {/* Time input at LEFT */}
        <TextInput
          value={time}
          onChangeText={onTimeChange}
          placeholder="00:00"
          placeholderTextColor={colors.disabled}
          accessibilityLabel={`Edit time for plan item ${order}`}
          style={[
            styles.timeInput,
            typeRoles.figure,
            {
              color: colors.textPrimary,
              borderColor: colors.divider,
            },
          ]}
          allowFontScaling={true}
        />

        {/* Text input */}
        <TextInput
          value={text}
          onChangeText={onTextChange}
          placeholder="Plan description"
          placeholderTextColor={colors.disabled}
          accessibilityLabel={`Edit text for plan item ${order}`}
          style={[
            styles.textInput,
            typeRoles.userText,
            {
              color: colors.textPrimary,
              borderColor: colors.divider,
            },
          ]}
          allowFontScaling={true}
        />

        {/* Reorder up button (no drag per PRD §13) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move item ${order} up`}
          disabled={!canMoveUp}
          hitSlop={touchTarget.hitSlop}
          style={[styles.actionButton, { borderColor: colors.divider }]}
          onPress={onMoveUp}>
          <Text
            style={[
              styles.actionButtonText,
              typeRoles.meta,
              { color: canMoveUp ? colors.textPrimary : colors.disabled },
            ]}
            allowFontScaling={true}>
            Up
          </Text>
        </Pressable>

        {/* Reorder down button (no drag per PRD §13) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move item ${order} down`}
          disabled={!canMoveDown}
          hitSlop={touchTarget.hitSlop}
          style={[styles.actionButton, { borderColor: colors.divider }]}
          onPress={onMoveDown}>
          <Text
            style={[
              styles.actionButtonText,
              typeRoles.meta,
              { color: canMoveDown ? colors.textPrimary : colors.disabled },
            ]}
            allowFontScaling={true}>
            Down
          </Text>
        </Pressable>

        {/* Remove button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove plan item ${order}`}
          hitSlop={touchTarget.hitSlop}
          style={[styles.actionButton, { borderColor: colors.divider }]}
          onPress={onRemove}>
          <Text
            style={[
              styles.actionButtonText,
              typeRoles.meta,
              { color: colors.danger },
            ]}
            allowFontScaling={true}>
            Remove
          </Text>
        </Pressable>
      </View>
    );
  }

  // Outlined intention glyph by status (PRD §3 rule)
  const markerGlyph =
    status === 'done'
      ? '[x]'
      : status === 'partly'
      ? '[-]'
      : status === 'missed'
      ? '[-]'
      : '[ ]';

  // View States: pending, done, partly, missed
  return (
    <View style={[styles.viewRow, { borderBottomColor: colors.divider }]}>
      {/* Time at LEFT (PRD §3) */}
      <Text
        style={[styles.timeText, typeRoles.figure, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        {time}
      </Text>

      {/* Outlined intention marker */}
      <Text
        style={[
          styles.markerText,
          typeRoles.figure,
          {
            color:
              status === 'done'
                ? colors.textPrimary
                : status === 'missed'
                ? colors.danger
                : colors.textSecondary,
          },
        ]}
        allowFontScaling={true}>
        {markerGlyph}
      </Text>

      {/* Item text */}
      <Text
        style={[
          styles.viewText,
          typeRoles.userText,
          {
            color: status === 'missed' ? colors.textSecondary : colors.textPrimary,
          },
        ]}
        allowFontScaling={true}>
        {text}
      </Text>

      {/* Status indicator label */}
      <Text
        style={[
          styles.statusText,
          typeRoles.meta,
          {
            color:
              status === 'done'
                ? colors.textSecondary
                : status === 'missed'
                ? colors.danger
                : colors.textSecondary,
          },
        ]}
        allowFontScaling={true}>
        ({status})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeText: {
    minWidth: 48,
    paddingHorizontal: spacing.none,
  },
  markerText: {
    paddingHorizontal: spacing.none,
  },
  viewText: {
    flex: 1,
    paddingHorizontal: spacing.none,
  },
  statusText: {
    paddingHorizontal: spacing.none,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeInput: {
    width: 60,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonText: {
    paddingHorizontal: spacing.none,
  },
});
