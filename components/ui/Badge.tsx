// components/ui/Badge.tsx
// Status Badges and Count Pills for Davos Seaworth.
// Constraints:
// - Badges carry a number or a single status word.
// - No decorative bouncing dots.
// - Color is paired with text label or icon (never color-alone).

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Icon } from './Icon';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'lantern';

export interface BadgeProps {
  label: string | number;
  variant?: BadgeVariant;
  icon?: boolean;
  dot?: boolean;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export function Badge({
  label,
  variant = 'neutral',
  icon = false,
  dot = false,
  size = 'md',
  style,
}: BadgeProps) {
  const { colors, radius, spacing } = useTheme();

  const variantStyles: Record<
    BadgeVariant,
    { bg: string; text: string; iconColor: string; border: string; iconName: 'info' | 'check' | 'alert-triangle' | 'alert-circle' | 'compass' }
  > = {
    neutral: {
      bg: colors.surfaceSubtle,
      text: colors.textSecondary,
      iconColor: colors.textSecondary,
      border: colors.border,
      iconName: 'info',
    },
    success: {
      bg: colors.successSurface,
      text: colors.successText,
      iconColor: colors.success,
      border: colors.success,
      iconName: 'check',
    },
    warning: {
      bg: colors.warningSurface,
      text: colors.warningText,
      iconColor: colors.warning,
      border: colors.warning,
      iconName: 'alert-triangle',
    },
    danger: {
      bg: colors.dangerSurface,
      text: colors.dangerText,
      iconColor: colors.danger,
      border: colors.danger,
      iconName: 'alert-circle',
    },
    info: {
      bg: colors.infoSurface,
      text: colors.infoText,
      iconColor: colors.info,
      border: colors.info,
      iconName: 'info',
    },
    lantern: {
      bg: colors.lanternSurface,
      text: colors.lantern,
      iconColor: colors.lantern,
      border: colors.lantern,
      iconName: 'compass',
    },
  };

  const current = variantStyles[variant];
  const isSm = size === 'sm';

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
      style={[
        styles.badge,
        isSm ? styles.badgeSm : styles.badgeMd,
        {
          backgroundColor: current.bg,
          borderColor: current.border,
          borderRadius: radius.full,
          paddingHorizontal: isSm ? spacing.xs : spacing.sm,
        },
        style,
      ]}
    >
      {icon ? (
        <View style={styles.iconContainer}>
          <Icon name={current.iconName} size={isSm ? 10 : 12} color={current.iconColor} />
        </View>
      ) : null}
      <Text
        role="caption"
        tabular
        style={[
          styles.badgeText,
          isSm ? styles.badgeTextSm : styles.badgeTextMd,
          { color: current.text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconContainer: {
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontWeight: '600',
  },
  badgeSm: {
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  badgeMd: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeTextSm: {
    fontSize: 11,
  },
  badgeTextMd: {
    fontSize: 12,
  },
});
