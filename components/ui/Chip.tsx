// components/ui/Chip.tsx
// Interactive Selection Chip primitive for energy filters, cadence tiers, and tags.
// States: default, pressed (scale 0.98), selected, focused, disabled.
// Accessible: accessibilityRole="button", accessibilityState={{ selected, disabled }}, tap target >=44pt.

import React, { useState } from 'react';
import {
  Pressable,
  PressableProps,
  View,
  StyleSheet,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { hapticSelection } from '../../lib/haptics';

export interface ChipProps extends Omit<PressableProps, 'children'> {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  focused?: boolean;
  icon?: React.ReactNode;
  subtitle?: string;
  style?: ViewStyle;
}

export function Chip({
  label,
  selected = false,
  disabled = false,
  focused = false,
  icon,
  subtitle,
  style,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  onPress,
  onHoverIn,
  onHoverOut,
  ...rest
}: ChipProps) {
  const { colors, radius, spacing, touchTarget } = useTheme();
  const [isFocused, setIsFocused] = useState(focused);
  const [isHovered, setIsHovered] = useState(false);
  const { fontScale } = useWindowDimensions();
  const isAxSize = fontScale >= 1.35;

  const effectiveLabel = accessibilityLabel || `${label}${subtitle ? ', ' + subtitle : ''}`;

  const handlePress: PressableProps['onPress'] = (e) => {
    if (disabled) return;
    void hapticSelection();
    onPress?.(e);
  };

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={effectiveLabel}
      accessibilityState={{
        selected,
        disabled,
        ...accessibilityState,
      }}
      onPress={handlePress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onHoverIn={(e) => {
        setIsHovered(true);
        onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        setIsHovered(false);
        onHoverOut?.(e);
      }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radius.md,
          paddingVertical: isAxSize ? spacing.xs : 8,
          paddingHorizontal: spacing.sm,
          minHeight: touchTarget.minTargetIos,
          minWidth: 44,
          backgroundColor: selected
            ? colors.accent
            : pressed || isHovered
            ? colors.surfaceSubtle
            : colors.surface,
          borderColor: isFocused
            ? colors.borderFocus
            : selected
            ? colors.accent
            : colors.border,
          borderWidth: isFocused ? 2 : 1,
          opacity: disabled ? 0.45 : selected && isHovered ? 0.92 : 1,
          cursor: disabled ? 'auto' : 'pointer',
          transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
        },
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <View style={[styles.chipContent, isAxSize && styles.chipContentStacked]}>
        {icon ? <View style={styles.chipIcon}>{icon}</View> : null}
        <Text
          role="caption"
          style={[
            selected ? styles.chipTextSelected : styles.chipTextNormal,
            { color: selected ? colors.onAccent : colors.textPrimary },
          ]}
        >
          {label}
        </Text>
      </View>
      {subtitle ? (
        <Text
          role="caption"
          style={[
            styles.chipSubtitle,
            { color: selected ? colors.onAccent : colors.textTertiary },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    marginRight: 8,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipContentStacked: {
    flexDirection: 'column',
    gap: 4,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipTextSelected: {
    fontWeight: '600',
  },
  chipTextNormal: {
    fontWeight: '500',
  },
  chipSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  disabled: {
    opacity: 0.45,
  },
});
