// components/ui/SegmentedControl.tsx
// Accessible Multi-option Selector primitive for tabs and mode switches.
// States: default, pressed (scale 0.98), selected, focused, disabled.
// Accessible: accessibilityRole="radiogroup" and "radio", tap target >=44pt.

import React, { useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { hapticSelection } from '../../lib/haptics';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: ViewStyle;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  disabled = false,
  style,
}: SegmentedControlProps<T>) {
  const { colors, radius, spacing, touchTarget } = useTheme();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { fontScale } = useWindowDimensions();
  const isAxSize = fontScale >= 1.35;

  const handleSelect = (option: SegmentOption<T>) => {
    if (disabled || option.disabled || option.value === value) return;
    void hapticSelection();
    onChange(option.value);
  };

  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSubtle,
          borderRadius: radius.md,
          padding: 4,
          borderColor: colors.borderSubtle,
          borderWidth: StyleSheet.hairlineWidth,
        },
        isAxSize && styles.containerStacked,
        disabled && styles.disabled,
        style,
      ]}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isOptionDisabled = disabled || option.disabled;
        const isFocused = focusedIndex === index;
        const isHovered = hoveredIndex === index;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{
              selected: isSelected,
              disabled: isOptionDisabled,
            }}
            disabled={isOptionDisabled}
            onPress={() => handleSelect(option)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex(null)}
            onHoverIn={() => setHoveredIndex(index)}
            onHoverOut={() => setHoveredIndex(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => [
              styles.segment,
              {
                borderRadius: radius.sm,
                minHeight: Math.max(36, touchTarget.minTargetIos - 8),
                paddingHorizontal: spacing.xs,
                paddingVertical: 6,
                backgroundColor: isSelected
                  ? colors.surface
                  : pressed || isHovered
                  ? colors.borderSubtle
                  : 'transparent',
                borderColor: isFocused
                  ? colors.borderFocus
                  : isSelected
                  ? colors.border
                  : 'transparent',
                borderWidth: isFocused ? 2 : isSelected ? 1 : 0,
                cursor: isOptionDisabled ? 'auto' : 'pointer',
                transform: [{ scale: pressed && !isOptionDisabled ? 0.98 : 1 }],
              },
              isOptionDisabled && styles.disabled,
            ]}
          >
            <View style={styles.contentRow}>
              {option.icon ? <View style={styles.iconSlot}>{option.icon}</View> : null}
              <Text
                role="caption"
                style={[
                  styles.segmentText,
                  {
                    color: isSelected || isHovered ? colors.textPrimary : colors.textSecondary,
                    fontWeight: isSelected ? '600' : '500',
                  },
                ]}
              >
                {option.label}
              </Text>
            </View>
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
    width: '100%',
  },
  containerStacked: {
    flexDirection: 'column',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlot: {
    marginRight: 6,
  },
  segmentText: {
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
});
