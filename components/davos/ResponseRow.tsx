// components/davos/ResponseRow.tsx
// Canonical response row for Object: Check-in (PRD §3, §7.1, §12; design/DESIGN.md §6).
// Options: [Did it] [Partly] [Didn't] [Something else].
// Accent on primary response [Did it] only (PRD §12 accent rule).
// Uses only theme/roles.ts. RN primitives only. Touch targets >= 44dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export type CheckInResponseOption = 'did_it' | 'partly' | 'didnt' | 'something_else';

export interface ResponseRowProps {
  onSelect: (option: CheckInResponseOption) => void;
  disabled?: boolean;
  colorScheme?: 'light' | 'dark';
}

export function ResponseRow({
  onSelect,
  disabled = false,
  colorScheme = 'light',
}: ResponseRowProps) {
  const colors = colorRoles[colorScheme];

  return (
    <View style={styles.container}>
      {/* 1. Primary response: [Did it] - Accent token per PRD §12 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Did it"
        disabled={disabled}
        hitSlop={touchTarget.hitSlop}
        style={[
          styles.button,
          {
            borderColor: disabled ? colors.disabled : colors.accent,
            backgroundColor: disabled ? colors.surface : colors.surface,
          },
        ]}
        onPress={() => onSelect('did_it')}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: disabled ? colors.disabled : colors.accent },
          ]}
          allowFontScaling={true}>
          Did it
        </Text>
      </Pressable>

      {/* 2. [Partly] */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Partly"
        disabled={disabled}
        hitSlop={touchTarget.hitSlop}
        style={[
          styles.button,
          {
            borderColor: colors.divider,
            backgroundColor: colors.surface,
          },
        ]}
        onPress={() => onSelect('partly')}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: disabled ? colors.disabled : colors.textPrimary },
          ]}
          allowFontScaling={true}>
          Partly
        </Text>
      </Pressable>

      {/* 3. [Didn't] */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Didn't"
        disabled={disabled}
        hitSlop={touchTarget.hitSlop}
        style={[
          styles.button,
          {
            borderColor: colors.divider,
            backgroundColor: colors.surface,
          },
        ]}
        onPress={() => onSelect('didnt')}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: disabled ? colors.disabled : colors.textPrimary },
          ]}
          allowFontScaling={true}>
          Didn't
        </Text>
      </Pressable>

      {/* 4. [Something else] */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Something else"
        disabled={disabled}
        hitSlop={touchTarget.hitSlop}
        style={[
          styles.button,
          {
            borderColor: colors.divider,
            backgroundColor: colors.surface,
          },
        ]}
        onPress={() => onSelect('something_else')}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: disabled ? colors.disabled : colors.textPrimary },
          ]}
          allowFontScaling={true}>
          Something else
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  button: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
