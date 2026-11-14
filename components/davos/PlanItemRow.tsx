// components/davos/PlanItemRow.tsx
// Canonical component for Object: Plan (PRD §3, §12; design/DESIGN.md §6).
// Props: text, time, status, order
// States: pending, done, partly, late, missed, editing
// Plan items represent intentions: outlined marker, time at LEFT (PRD §3 rule).
// Uses theme hook (PRD Step 0, A.2, AU37). RN primitives only.
// Edit mode: borderless fields with hairline underline strengthening on focus, Up/Down icon buttons,
// quiet "x" in textSecondary, keyboard order time->title->up->down->remove, Enter adds row below (PRD E.1, E.2, E.4).

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { PlanItem } from '../../fixtures/davos';
import { format24Hour } from '../../lib/timeFormat';
import { PlanStatus, StatusMark } from './StatusMark';
import { Icon } from '../ui/Icon';
import { hapticSelection } from '../../lib/haptics';

export interface PlanItemRowProps {
  text?: string;
  time?: string;
  status?: PlanStatus;
  order?: number;
  item?: PlanItem;
  isEditing?: boolean;
  onPress?: () => void;
  onTextChange?: (text: string) => void;
  onTimeChange?: (time: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  onEnterTitle?: () => void;
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
  onPress,
  onTextChange,
  onTimeChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  onEnterTitle,
  canMoveUp = false,
  canMoveDown = false,
  colorScheme,
}: PlanItemRowProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  const [isTimeFocused, setIsTimeFocused] = useState<boolean>(false);
  const [isTitleFocused, setIsTitleFocused] = useState<boolean>(false);

  const text = item?.text ?? propText ?? '';
  const time = item?.time ?? propTime ?? '00:00';
  const status: PlanStatus = item?.status ?? propStatus ?? 'pending';
  const order = item?.order ?? propOrder ?? 1;

  // State: editing (PRD E.1, E.2, E.4)
  if (isEditing) {
    return (
      <View style={[styles.editRow, { borderBottomColor: colors.divider }]}>
        {/* 1. Time input at LEFT: borderless with hairline underline strengthening on focus */}
        <TextInput
          value={time}
          onChangeText={onTimeChange}
          onFocus={() => setIsTimeFocused(true)}
          onBlur={() => setIsTimeFocused(false)}
          placeholder="00:00"
          placeholderTextColor={colors.disabled}
          cursorColor={colors.accent}
          selectionColor={colors.accentSubtle}
          underlineColorAndroid="transparent"
          accessibilityLabel={`Edit time for plan item ${order}`}
          style={[
            styles.timeInput,
            typeRoles.figure,
            {
              color: colors.textPrimary,
              borderBottomColor: isTimeFocused ? colors.focusRing : colors.divider,
              borderBottomWidth: isTimeFocused ? 2 : StyleSheet.hairlineWidth,
            },
          ]}
          allowFontScaling={true}
        />

        {/* 2. Status mark kept visible in edit mode (PRD E.2) */}
        <View style={styles.statusMarkContainer}>
          <StatusMark status={status} showLabel={false} />
        </View>

        {/* 3. Title input: borderless with hairline underline strengthening on focus */}
        <TextInput
          value={text}
          onChangeText={onTextChange}
          onFocus={() => setIsTitleFocused(true)}
          onBlur={() => setIsTitleFocused(false)}
          onSubmitEditing={onEnterTitle}
          returnKeyType="next"
          placeholder="Plan description"
          placeholderTextColor={colors.disabled}
          cursorColor={colors.accent}
          selectionColor={colors.accentSubtle}
          underlineColorAndroid="transparent"
          accessibilityLabel={`Edit text for plan item ${order}`}
          style={[
            styles.titleInput,
            typeRoles.userText,
            {
              color: colors.textPrimary,
              borderBottomColor: isTitleFocused ? colors.focusRing : colors.divider,
              borderBottomWidth: isTitleFocused ? 2 : StyleSheet.hairlineWidth,
            },
          ]}
          allowFontScaling={true}
        />

        {/* 4. Up icon button (PRD E.1, D.1) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Move up"
          disabled={!canMoveUp}
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle, borderless: true }}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
          onPress={() => {
            void hapticSelection();
            onMoveUp?.();
          }}>
          <Icon
            name="arrow-up"
            size="sm"
            color={canMoveUp ? colors.textPrimary : colors.disabled}
          />
        </Pressable>

        {/* 5. Down icon button (PRD E.1, D.1) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Move down"
          disabled={!canMoveDown}
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle, borderless: true }}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
          onPress={() => {
            void hapticSelection();
            onMoveDown?.();
          }}>
          <Icon
            name="arrow-down"
            size="sm"
            color={canMoveDown ? colors.textPrimary : colors.disabled}
          />
        </Pressable>

        {/* 6. Remove quiet "x" icon in textSecondary, not red (PRD E.1, D.1) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove"
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle, borderless: true }}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
          onPress={() => {
            void hapticSelection();
            onRemove?.();
          }}>
          <Icon
            name="x"
            size="sm"
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
    );
  }

  // View States: pending, done, partly, late, missed
  // Hierarchy: Plan rows are stronger (primary text colour, medium weight).
  // StatusMark: glyph + meta label. Never colour alone.
  const content = (
    <View style={styles.viewRow}>
      {/* Time at LEFT (PRD §3) */}
      <Text
        style={[styles.timeText, typeRoles.figure, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        {time ? format24Hour(time) : ''}
      </Text>

      {/* Fixed-width column for status mark + label so all titles align in one column (PRD D.1) */}
      <View style={styles.statusColumn}>
        <StatusMark status={status} />
      </View>

      {/* Item text: stronger (primary text colour, medium weight) */}
      <Text
        style={[
          styles.viewText,
          typeRoles.davosVoice,
          {
            color: colors.textPrimary,
          },
        ]}
        allowFontScaling={true}>
        {text}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Plan item ${order}: ${text} at ${time}, ${status}. Tap to edit.`}
        hitSlop={touchTarget.hitSlop}
        android_ripple={{ color: colors.borderSubtle }}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        onPress={() => {
          void hapticSelection();
          onPress();
        }}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: touchTarget.minTargetIos,
  },
  timeText: {
    width: 48,
    paddingHorizontal: spacing.none,
  },
  statusColumn: {
    width: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewText: {
    flex: 1,
    paddingHorizontal: spacing.none,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
  },
  timeInput: {
    width: 52,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
    borderWidth: 0,
  },
  statusMarkContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxs,
  },
  titleInput: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
    borderWidth: 0,
  },
  iconButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonText: {
    paddingHorizontal: spacing.none,
    fontSize: 16,
  },
});
