// components/davos/ResponseRow.tsx
// Canonical response row for Object: Check-in (PRD §3, §7.1, §12; AU9, AU25).
// Options: [Did it] [Partly] [Didn't] [Something else].
// Four options at equal visual weight, no accent on any of them.
// Shows a selected state after a tap.
// Uses only theme/roles.ts. RN primitives only. Touch targets >= 44dp.

import React, { useState } from 'react';
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
  colorScheme = 'light',
}: ResponseRowProps) {
  const colors = colorRoles[colorScheme];
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
            disabled={disabled}
            hitSlop={touchTarget.hitSlop}
            style={[
              styles.button,
              {
                borderColor: isSelected ? colors.textPrimary : colors.divider,
                backgroundColor: isSelected ? colors.divider : colors.surface,
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
