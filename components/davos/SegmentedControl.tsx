// components/davos/SegmentedControl.tsx
// Canonical segmented control component for Theme and Cadence (PRD Step 0, C.2).
// Selected: surface-raised fill, primary border, semibold, accessibilityState selected.
// Unselected: regular weight, subdued border.
// Touch target >= 44dp. React Native primitives only.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { spacing, touchTarget, typeRoles } from '../../theme/roles';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  accessibilityLabel?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentOption<T>[] | SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabelPrefix?: string;
  colorScheme?: 'light' | 'dark';
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabelPrefix,
  colorScheme,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  return (
    <View style={styles.container}>
      {options.map((opt) => {
        const isSelected = opt.value === value;
        const a11yLabel =
          opt.accessibilityLabel ??
          (accessibilityLabelPrefix
            ? `${accessibilityLabelPrefix} ${opt.label}`
            : opt.label);

        return (
          <Pressable
            key={String(opt.value)}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
            accessibilityState={{ selected: isSelected }}
            hitSlop={touchTarget.hitSlop}
            style={[
              styles.segmentButton,
              {
                borderColor: isSelected ? colors.textPrimary : colors.divider,
                borderWidth: isSelected ? 1.5 : StyleSheet.hairlineWidth,
                backgroundColor: isSelected ? colors.surfaceRaised : colors.surface,
              },
            ]}
            onPress={() => onChange(opt.value)}>
            <Text
              style={[
                styles.segmentButtonText,
                typeRoles.meta,
                {
                  color: isSelected ? colors.textPrimary : colors.textSecondary,
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
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xxs,
  },
  segmentButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentButtonText: {
    paddingHorizontal: spacing.none,
  },
});
