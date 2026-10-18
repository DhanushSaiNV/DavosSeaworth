// components/ui/Badge.tsx
// Status Badges, Count Pills, and Interactive Selection Chips

import React from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ViewStyle,
  TextStyle,
  PressableProps,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'lantern';

export interface BadgeProps {
  label: string | number;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export function Badge({
  label,
  variant = 'neutral',
  dot = false,
  size = 'md',
  style,
}: BadgeProps) {
  const { colors, radius, spacing } = useTheme();

  const variantStyles: Record<BadgeVariant, { bg: string; text: string; dot: string; border: string }> = {
    neutral: {
      bg: colors.surfaceSubtle,
      text: colors.textSecondary,
      dot: colors.textSecondary,
      border: colors.border,
    },
    success: {
      bg: colors.successSurface,
      text: colors.successText,
      dot: colors.success,
      border: colors.success,
    },
    warning: {
      bg: colors.warningSurface,
      text: colors.warningText,
      dot: colors.warning,
      border: colors.warning,
    },
    danger: {
      bg: colors.dangerSurface,
      text: colors.dangerText,
      dot: colors.danger,
      border: colors.danger,
    },
    info: {
      bg: colors.infoSurface,
      text: colors.infoText,
      dot: colors.info,
      border: colors.info,
    },
    lantern: {
      bg: colors.lanternSurface,
      text: colors.lantern,
      dot: colors.lantern,
      border: colors.lantern,
    },
  };

  const current = variantStyles[variant];
  const isSm = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: current.bg,
          borderColor: current.border,
          borderRadius: radius.full,
          paddingVertical: isSm ? 2 : spacing.xxs,
          paddingHorizontal: isSm ? spacing.xs : spacing.sm,
        },
        style,
      ]}
    >
      {dot ? (
        <View style={[styles.dot, { backgroundColor: current.dot }]} />
      ) : null}
      <Text
        role="caption"
        tabular
        style={[
          styles.badgeText,
          { color: current.text, fontSize: isSm ? 11 : 12 },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export interface ChipProps extends Omit<PressableProps, 'children'> {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  subtitle?: string;
  style?: ViewStyle;
}

export function Chip({
  label,
  selected = false,
  disabled = false,
  icon,
  subtitle,
  style,
  accessibilityRole = 'button',
  accessibilityState,
  ...rest
}: ChipProps) {
  const { colors, radius, spacing, touchTarget } = useTheme();

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{
        selected,
        disabled,
        ...accessibilityState,
      }}
      hitSlop={touchTarget.hitSlop}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radius.md,
          paddingVertical: spacing.xs,
          paddingHorizontal: spacing.sm,
          backgroundColor: selected
            ? colors.accent
            : pressed
            ? colors.surfaceSubtle
            : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <View style={styles.chipContent}>
        {icon ? <View style={styles.chipIcon}>{icon}</View> : null}
        <Text
          role="caption"
          style={{
            color: selected ? colors.onAccent : colors.textPrimary,
            fontWeight: selected ? '600' : '500',
          }}
        >
          {label}
        </Text>
      </View>
      {subtitle ? (
        <Text
          role="caption"
          style={{
            color: selected ? colors.onAccent : colors.textTertiary,
            fontSize: 11,
            marginTop: 2,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  badgeText: {
    fontWeight: '600',
  },
  chip: {
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipIcon: {
    marginRight: 6,
  },
  disabled: {
    opacity: 0.45,
  },
});
