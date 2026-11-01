// components/davos/PlanItemRow.tsx
// Canonical component for Object: Plan (PRD §3, §12).
// Plan items represent intentions: outlined marker, time at LEFT.
// Supports view mode and in-place edit mode (change text/time, up/down, remove).

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { spacing, touchTarget } from '../../theme/tokens/spacing';
import { PlanItem } from '../../fixtures/davos';

export interface PlanItemRowProps {
  item: PlanItem;
  isEditing?: boolean;
  onTextChange?: (text: string) => void;
  onTimeChange?: (time: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function PlanItemRow({
  item,
  isEditing = false,
  onTextChange,
  onTimeChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp = false,
  canMoveDown = false,
}: PlanItemRowProps) {
  if (isEditing) {
    return (
      <View style={styles.editRow}>
        {/* Time input at LEFT */}
        <TextInput
          value={item.time}
          onChangeText={onTimeChange}
          placeholder="00:00"
          accessibilityLabel={`Edit time for plan item ${item.order}`}
          style={styles.timeInput}
        />

        {/* Text input */}
        <TextInput
          value={item.text}
          onChangeText={onTextChange}
          placeholder="Plan description"
          accessibilityLabel={`Edit text for plan item ${item.order}`}
          style={styles.textInput}
        />

        {/* Reorder up button (no drag per PRD §13) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move item ${item.order} up`}
          disabled={!canMoveUp}
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={onMoveUp}>
          <Text>{canMoveUp ? 'Up' : '-'}</Text>
        </Pressable>

        {/* Reorder down button (no drag per PRD §13) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move item ${item.order} down`}
          disabled={!canMoveDown}
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={onMoveDown}>
          <Text>{canMoveDown ? 'Down' : '-'}</Text>
        </Pressable>

        {/* Remove button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove plan item ${item.order}`}
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={onRemove}>
          <Text>Remove</Text>
        </Pressable>
      </View>
    );
  }

  // View / Locked mode: Intention with time at LEFT and outlined marker
  return (
    <View style={styles.viewRow}>
      {/* Time at LEFT */}
      <Text style={styles.timeText}>{item.time}</Text>

      {/* Outlined marker (intention) */}
      <Text style={styles.markerText}>[ ]</Text>

      {/* Item text */}
      <Text style={styles.viewText}>{item.text}</Text>

      {/* Status indicator */}
      <Text style={styles.statusText}>{item.status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
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
    paddingVertical: spacing.xxs,
  },
  timeInput: {
    width: 60,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  textInput: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
