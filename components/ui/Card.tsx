// components/ui/Card.tsx
// Structural Card / Surface primitive with elevation levels and hairline borders

import React from 'react';
import { View, ViewProps, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

export type CardElevation = 'none' | 'raised' | 'overlay';
export type CardVariant = 'default' | 'subtle' | 'lantern' | 'interactive';

export interface CardProps extends ViewProps {
  elevation?: CardElevation;
  variant?: CardVariant;
  padding?: number;
  bordered?: boolean;
}

export function Card({
  elevation = 'raised',
  variant = 'default',
  padding,
  bordered = true,
  style,
  children,
  ...rest
}: CardProps) {
  const { colors, radius, spacing, elevation: elevationTokens } = useTheme();

  const resolvedPadding = padding !== undefined ? padding : spacing.md;

  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case 'subtle':
        return {
          backgroundColor: colors.surfaceSubtle,
        };
      case 'lantern':
        return {
          backgroundColor: colors.lanternSurface,
          borderColor: colors.lantern,
        };
      case 'default':
      default:
        return {
          backgroundColor: colors.surface,
        };
    }
  };

  return (
    <View
      style={[
        styles.base,
        {
          borderRadius: radius.md,
          padding: resolvedPadding,
          borderColor: bordered ? colors.border : 'transparent',
          borderWidth: bordered ? StyleSheet.hairlineWidth : 0,
        },
        elevationTokens[elevation],
        getVariantStyle(),
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
