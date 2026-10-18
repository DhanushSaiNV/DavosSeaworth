// components/ui/IconButton.tsx
// Dedicated Icon-only Button primitive with guaranteed tap target bounds (>=44pt) and states.

import React, { useState } from 'react';
import {
  Pressable,
  PressableProps,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme';
import { Icon, type IconName } from './Icon';
import { hapticImpactLight } from '../../lib/haptics';

export type IconButtonVariant = 'ghost' | 'surface' | 'primary' | 'destructive';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends Omit<PressableProps, 'children'> {
  icon: IconName;
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  disabled?: boolean;
  focused?: boolean;
  style?: ViewStyle | ((state: { pressed: boolean }) => ViewStyle);
}

export function IconButton({
  icon,
  accessibilityLabel,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled = false,
  focused = false,
  style,
  onPress,
  ...rest
}: IconButtonProps) {
  const { colors, radius, touchTarget } = useTheme();
  const [isFocused, setIsFocused] = useState(focused);
  const isDisabled = disabled || loading;

  const sizeDimensions: Record<IconButtonSize, { container: number; icon: number }> = {
    sm: { container: 36, icon: 16 },
    md: { container: 44, icon: 20 },
    lg: { container: 52, icon: 24 },
  };

  const dim = sizeDimensions[size];

  const getVariantStyles = (pressed: boolean) => {
    switch (variant) {
      case 'surface':
        return {
          backgroundColor: pressed ? colors.surfaceSubtle : colors.surface,
          borderWidth: 1,
          borderColor: isFocused ? colors.borderFocus : colors.border,
          iconColor: colors.textPrimary,
        };
      case 'primary':
        return {
          backgroundColor: pressed ? colors.textSecondary : colors.accent,
          borderWidth: isFocused ? 2 : 0,
          borderColor: colors.borderFocus,
          iconColor: colors.onAccent,
        };
      case 'destructive':
        return {
          backgroundColor: pressed ? colors.dangerText : colors.dangerSurface,
          borderWidth: 1,
          borderColor: colors.danger,
          iconColor: colors.danger,
        };
      case 'ghost':
      default:
        return {
          backgroundColor: pressed ? colors.surfaceSubtle : 'transparent',
          borderWidth: isFocused ? 1 : 0,
          borderColor: colors.borderFocus,
          iconColor: colors.textSecondary,
        };
    }
  };

  const handlePress: PressableProps['onPress'] = (e) => {
    if (isDisabled) return;
    void hapticImpactLight();
    onPress?.(e);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        disabled: isDisabled,
        busy: loading,
      }}
      disabled={isDisabled}
      onPress={handlePress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={(state) => {
        const v = getVariantStyles(state.pressed);
        const customStyle = typeof style === 'function' ? style(state) : style;

        return [
          styles.base,
          {
            width: dim.container,
            height: dim.container,
            minWidth: touchTarget.minTargetIos,
            minHeight: touchTarget.minTargetIos,
            borderRadius: radius.md,
            backgroundColor: v.backgroundColor,
            borderWidth: v.borderWidth,
            borderColor: v.borderColor,
            opacity: isDisabled ? 0.45 : 1,
            transform: [{ scale: state.pressed && !isDisabled ? 0.97 : 1 }],
          },
          customStyle,
        ];
      }}
      {...rest}
    >
      {(state) => {
        const v = getVariantStyles(state.pressed);
        if (loading) {
          return <ActivityIndicator size="small" color={v.iconColor} accessibilityLabel="Loading..." />;
        }
        return <Icon name={icon} size={dim.icon} color={v.iconColor} />;
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
