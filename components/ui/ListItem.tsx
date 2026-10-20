// components/ui/ListItem.tsx
// High-precision List Item primitive for settings, menus, and structured views.
// States: default, pressed (subtle highlight), focused, disabled.
// Accessible: accessibilityRole="button", default accessibilityLabel, AX Dynamic Type support.

import React, { useState } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  ViewStyle,
  PressableProps,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Icon } from './Icon';
import { hapticImpactLight } from '../../lib/haptics';

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
  accessibilityLabel,
  onPress,
  onHoverIn,
  onHoverOut,
  ...rest
}: ListItemProps) {
  const { colors, spacing, touchTarget } = useTheme();
  const { fontScale } = useWindowDimensions();
  const isAxSize = fontScale >= 1.35;
  const [isHovered, setIsHovered] = useState(false);

  const isInteractive = Boolean(onPress) && !disabled;
  const effectiveLabel = accessibilityLabel || `${title}${subtitle ? ': ' + subtitle : ''}`;

  const handlePress: PressableProps['onPress'] = (e) => {
    if (!isInteractive) return;
    void hapticImpactLight();
    onPress?.(e);
  };

  return (
    <Pressable
      disabled={!isInteractive}
      onPress={handlePress}
      accessibilityRole={isInteractive ? accessibilityRole : undefined}
      accessibilityLabel={effectiveLabel}
      accessibilityState={{ disabled: !isInteractive }}
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
        styles.container,
        {
          paddingVertical: isAxSize ? spacing.sm : spacing.xs,
          paddingHorizontal: spacing.sm,
          backgroundColor:
            (pressed || isHovered) && isInteractive ? colors.surfaceSubtle : colors.surface,
          borderBottomColor: colors.borderSubtle,
          borderBottomWidth: bottomDivider ? StyleSheet.hairlineWidth : 0,
          minHeight: touchTarget.minHeight,
          cursor: isInteractive ? 'pointer' : 'auto',
        },
        isAxSize && styles.containerStacked,
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <View style={[styles.mainRow, isAxSize && styles.mainRowStacked]}>
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}

        <View style={styles.textColumn}>
          <Text
            role="bodyMedium"
            variant={destructive ? 'danger' : 'primary'}
            numberOfLines={isAxSize ? undefined : 1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text role="caption" variant="secondary" style={styles.subtitle} numberOfLines={isAxSize ? undefined : 2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {rightAccessory ? (
        <View style={[styles.rightAccessory, isAxSize && styles.rightAccessoryStacked]}>{rightAccessory}</View>
      ) : showChevron ? (
        <Icon name="chevron-right" size={16} color={colors.textTertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  containerStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  mainRowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
    marginRight: 0,
    gap: 6,
  },
  leftIcon: {
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
  rightAccessory: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rightAccessoryStacked: {
    alignItems: 'flex-start',
    marginTop: 4,
  },
  disabled: {
    opacity: 0.45,
  },
});
