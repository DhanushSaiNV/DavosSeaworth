// components/ui/Button.tsx
// Core Interactive Button primitive with tactile feedback, states, and accessibility.
// All states: default, pressed (scale 0.98, 110ms), focused, disabled, loading, error.

import React, { useState } from 'react';
import {
  Pressable,
  PressableProps,
  StyleSheet,
  View,
  ViewStyle,
  TextStyle,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { LoadingMark } from './LoadingMark';
import { hapticImpactLight, hapticImpactMedium } from '../../lib/haptics';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  error?: boolean;
  focused?: boolean;
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
  error = false,
  focused = false,
  icon,
  iconRight,
  fullWidth = false,
  children,
  style,
  titleStyle,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  onPress,
  ...rest
}: ButtonProps) {
  const { colors, radius, spacing, touchTarget } = useTheme();
  const [isFocused, setIsFocused] = useState(focused);
  const { fontScale } = useWindowDimensions();
  const isAxSize = fontScale >= 1.35;

  const isDisabled = disabled || loading;

  const sizeStyles: Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number }> = {
    sm: { height: Math.max(36, touchTarget.minTargetIos - 8), paddingHorizontal: spacing.sm, fontSize: 13 },
    md: { height: Math.max(44, touchTarget.minTargetIos), paddingHorizontal: spacing.md, fontSize: 15 },
    lg: { height: Math.max(52, touchTarget.minTargetAndroid + 4), paddingHorizontal: spacing.lg, fontSize: 16 },
  };

  const currentSize = sizeStyles[size];

  const getVariantStyles = (pressed: boolean): { container: ViewStyle; textVariant: 'primary' | 'secondary' | 'inverse' | 'danger' } => {
    if (error) {
      return {
        container: {
          backgroundColor: pressed ? colors.dangerSurface : colors.surface,
          borderWidth: 1.5,
          borderColor: colors.danger,
        },
        textVariant: 'danger',
      };
    }

    switch (variant) {
      case 'secondary':
        return {
          container: {
            backgroundColor: pressed ? colors.surfaceSubtle : colors.surface,
            borderWidth: 1,
            borderColor: isFocused ? colors.borderFocus : colors.border,
          },
          textVariant: 'primary',
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: pressed ? colors.surfaceSubtle : 'transparent',
            borderWidth: isFocused ? 1 : 0,
            borderColor: colors.borderFocus,
          },
          textVariant: 'primary',
        };
      case 'destructive':
        return {
          container: {
            backgroundColor: pressed ? colors.dangerText : colors.danger,
            borderWidth: isFocused ? 2 : 0,
            borderColor: colors.textPrimary,
          },
          textVariant: 'inverse',
        };
      case 'primary':
      default:
        return {
          container: {
            backgroundColor: pressed ? colors.textSecondary : colors.accent,
            borderWidth: isFocused ? 2 : 0,
            borderColor: colors.borderFocus,
          },
          textVariant: 'inverse',
        };
    }
  };

  const effectiveLabel = accessibilityLabel || title || (typeof children === 'string' ? children : 'Action');

  const handlePress: PressableProps['onPress'] = (e) => {
    if (isDisabled) return;
    if (variant === 'destructive') {
      void hapticImpactMedium();
    } else {
      void hapticImpactLight();
    }
    onPress?.(e);
  };

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={effectiveLabel}
      accessibilityState={{
        disabled: isDisabled,
        busy: loading,
        ...accessibilityState,
      }}
      disabled={isDisabled}
      onPress={handlePress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={(state) => {
        const variantStyle = getVariantStyles(state.pressed);
        const resolvedCustomStyle = typeof style === 'function' ? style(state) : style;

        return [
          styles.base,
          {
            height: isAxSize ? undefined : currentSize.height,
            minHeight: currentSize.height,
            paddingHorizontal: currentSize.paddingHorizontal,
            paddingVertical: isAxSize ? spacing.xs : 0,
            borderRadius: radius.md,
            opacity: isDisabled ? 0.45 : 1,
            transform: [{ scale: state.pressed && !isDisabled ? 0.98 : 1 }],
          },
          fullWidth && styles.fullWidth,
          variantStyle.container,
          resolvedCustomStyle,
        ];
      }}
      {...rest}
    >
      {(state) => {
        const variantStyle = getVariantStyles(state.pressed);

        if (loading) {
          // The button already announces `busy`, so the mark itself stays out of the a11y tree.
          return (
            <LoadingMark
              size={28}
              color={variantStyle.textVariant === 'inverse' ? colors.onAccent : colors.accent}
              decorative
            />
          );
        }

        if (children) {
          return <View style={[styles.contentRow, isAxSize && styles.contentStacked]}>{children}</View>;
        }

        return (
          <View style={[styles.contentRow, isAxSize && styles.contentStacked]}>
            {icon && <View style={styles.iconSlot}>{icon}</View>}
            <Text
              role="bodyMedium"
              variant={variantStyle.textVariant}
              style={[
                styles.title,
                { fontSize: currentSize.fontSize },
                titleStyle,
              ]}
            >
              {title}
            </Text>
            {iconRight && <View style={styles.iconRightSlot}>{iconRight}</View>}
          </View>
        );
      }}
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
  contentStacked: {
    flexDirection: 'column',
    gap: 4,
  },
  iconSlot: {
    marginRight: 8,
  },
  iconRightSlot: {
    marginLeft: 8,
  },
  title: {
    textAlign: 'center',
  },
});
