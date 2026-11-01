// components/davos/ResponseRow.tsx
// Canonical response row for Object: Check-in (PRD §3, §7.1, §12; AU9, AU25).
// Options: [Did it] [Partly] [Didn't] [Something else].
// Four options at equal visual weight, no accent on any of them.
// Shows a selected state after a tap.
// Uses theme hook (PRD Step 0, A.2, AU37). Border >= 3:1 on surface (B.6). Touch targets >= 44dp.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export type CheckInResponseOption = 'did_it' | 'partly' | 'didnt' | 'something_else';

export interface ResponseRowProps {
  onSelect: (option: CheckInResponseOption) => void;
  selectedOption?: CheckInResponseOption | null;
  disabled?: boolean;
  colorScheme?: 'light' | 'dark';
}

const OPTIONS: { key: CheckInResponseOption; label: string }[] = [
  { key: 'did_it', label: 'Did it' },
  { key: 'partly', label: 'Partly' },
  { key: 'didnt', label: "Didn't" },
  { key: 'something_else', label: 'Something else' },
];

export function ResponseRow({
  onSelect,
  selectedOption = null,
  disabled = false,
  colorScheme,
}: ResponseRowProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const [selected, setSelected] = useState<CheckInResponseOption | null>(selectedOption);

  const handlePress = (option: CheckInResponseOption) => {
    if (disabled) return;
    setSelected(option);
    onSelect(option);
  };

  const activeSelected = selectedOption !== undefined && selectedOption !== null ? selectedOption : selected;

  return (
    <View style={styles.container}>
      {OPTIONS.map((opt) => {
        const isSelected = activeSelected === opt.key;

        return (
          <Pressable
            key={opt.key}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label}${isSelected ? ', selected' : ''}`}
            accessibilityState={{ selected: isSelected }}
            disabled={disabled}
            hitSlop={touchTarget.hitSlop}
            style={({ pressed }) => [
              styles.button,
              {
                borderColor: isSelected
                  ? colors.textPrimary
                  : pressed
                  ? colors.textSecondary
                  : colors.controlBorder,
                borderWidth: isSelected ? 1 : StyleSheet.hairlineWidth,
                backgroundColor: isSelected
                  ? colors.divider
                  : pressed
                  ? colors.divider
                  : colors.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={() => handlePress(opt.key)}>
            <Text
              style={[
                styles.buttonText,
                typeRoles.davosVoice,
                {
                  color: disabled
                    ? colors.disabled
                    : colors.textPrimary,
                  fontWeight: isSelected ? '600' : '400',
                },
              ]}
              allowFontScaling={true}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  button: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
