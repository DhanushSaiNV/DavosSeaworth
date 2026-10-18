// components/ui/Button.tsx
// Core Interactive Button primitive with tactile feedback, states, and accessibility

import React from 'react';
import {
  Pressable,
  PressableProps,
  ActivityIndicator,
  StyleSheet,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  children?: React.ReactNode;
  style?: ViewStyle | ((state: { pressed: boolean }) => ViewStyle);
  titleStyle?: TextStyle;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconRight,
  fullWidth = false,
  children,
  style,
  titleStyle,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  ...rest
}: ButtonProps) {
  const { colors, radius, spacing, touchTarget } = useTheme();

  const isDisabled = disabled || loading;

  const sizeStyles: Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number }> = {
    sm: { height: 36, paddingHorizontal: spacing.sm, fontSize: 13 },
    md: { height: 44, paddingHorizontal: spacing.md, fontSize: 15 },
    lg: { height: 52, paddingHorizontal: spacing.lg, fontSize: 16 },
  };

  const currentSize = sizeStyles[size];

  const getVariantStyles = (pressed: boolean): { container: ViewStyle; textVariant: 'primary' | 'secondary' | 'inverse' | 'danger' } => {
    switch (variant) {
      case 'secondary':
        return {
          container: {
            backgroundColor: pressed ? colors.surfaceSubtle : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          },
          textVariant: 'primary',
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: pressed ? colors.surfaceSubtle : 'transparent',
            borderWidth: 0,
          },
          textVariant: 'primary',
        };
      case 'destructive':
        return {
          container: {
            backgroundColor: pressed ? colors.dangerText : colors.danger,
            borderWidth: 0,
          },
          textVariant: 'inverse',
        };
      case 'primary':
      default:
        return {
          container: {
            backgroundColor: pressed ? colors.textSecondary : colors.accent,
            borderWidth: 0,
          },
          textVariant: 'inverse',
        };
    }
  };

  return (
    <Pressable
      disabled={isDisabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{
        disabled: isDisabled,
        busy: loading,
        ...accessibilityState,
      }}
      hitSlop={size === 'sm' ? touchTarget.hitSlop : 4}
      style={(state) => [
        styles.base,
        {
          height: currentSize.height,
          paddingHorizontal: currentSize.paddingHorizontal,
          borderRadius: radius.md,
        },
        fullWidth && styles.fullWidth,
        getVariantStyles(state.pressed).container,
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'destructive' ? colors.onAccent : colors.textPrimary}
        />
      ) : (
        <View style={styles.contentRow}>
          {icon ? <View style={styles.iconLeft}>{icon}</View> : null}
          {title ? (
            <Text
              role="bodyMedium"
              variant={getVariantStyles(false).textVariant}
              style={[{ fontSize: currentSize.fontSize }, titleStyle]}
            >
              {title}
            </Text>
          ) : (
            children
          )}
          {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
  disabled: {
    opacity: 0.45,
  },
});
