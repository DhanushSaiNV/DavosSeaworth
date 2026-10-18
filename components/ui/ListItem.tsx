// components/ui/ListItem.tsx
// High-precision List Item primitive for settings, menus, and structured views

import React from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  ViewStyle,
  PressableProps,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Icon } from './Icon';

export interface ListItemProps extends Omit<PressableProps, 'children'> {
  title: string;
  subtitle?: string;
  leftIcon?: React.ReactNode;
  rightAccessory?: React.ReactNode;
  showChevron?: boolean;
  destructive?: boolean;
  bottomDivider?: boolean;
  style?: ViewStyle;
}

export function ListItem({
  title,
  subtitle,
  leftIcon,
  rightAccessory,
  showChevron = false,
  destructive = false,
  bottomDivider = true,
  disabled = false,
  style,
  accessibilityRole = 'button',
  onPress,
  ...rest
}: ListItemProps) {
  const { colors, spacing, touchTarget } = useTheme();

  const isInteractive = Boolean(onPress) && !disabled;

  return (
    <Pressable
      disabled={!isInteractive}
      onPress={onPress}
      accessibilityRole={isInteractive ? accessibilityRole : undefined}
      hitSlop={touchTarget.hitSlop}
      style={({ pressed }) => [
        styles.container,
        {
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md,
          backgroundColor: pressed && isInteractive ? colors.surfaceSubtle : colors.surface,
          borderBottomColor: colors.borderSubtle,
          borderBottomWidth: bottomDivider ? StyleSheet.hairlineWidth : 0,
        },
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}

      <View style={styles.textColumn}>
        <Text
          role="bodyMedium"
          variant={destructive ? 'danger' : 'primary'}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text role="caption" variant="secondary" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {rightAccessory ? (
        <View style={styles.rightAccessory}>{rightAccessory}</View>
      ) : showChevron ? (
        <Icon name="chevron-right" size="sm" color={colors.textTertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
  },
  leftIcon: {
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    justifyContent: 'center',
  },
  subtitle: {
    marginTop: 2,
  },
  rightAccessory: {
    marginLeft: 12,
  },
  disabled: {
    opacity: 0.5,
  },
});
