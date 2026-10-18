// components/ui/Text.tsx
// Core Typography primitive adhering to Swiss design hierarchy and WCAG contrast

import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet, TextStyle } from 'react-native';
import { useTheme } from '../../theme';

export type TypographyRole = 'display' | 'title' | 'body' | 'bodyMedium' | 'caption' | 'mono';

export type TextVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'lantern'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info'
  | 'inverse';

export interface TextProps extends Omit<RNTextProps, 'role'> {
  role?: TypographyRole;
  accessibilityRole?: RNTextProps['accessibilityRole'];
  variant?: TextVariant;
  align?: TextStyle['textAlign'];
  tabular?: boolean;
}

export function Text({
  role = 'body',
  variant = 'primary',
  align,
  tabular = false,
  style,
  children,
  ...rest
}: TextProps) {
  const { colors, typography } = useTheme();

  const colorMap: Record<TextVariant, string> = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    lantern: colors.lantern,
    danger: colors.dangerText,
    success: colors.successText,
    warning: colors.warningText,
    info: colors.infoText,
    inverse: colors.textInverse,
  };

  const roleStyle = typography[role] || typography.body;
  const color = colorMap[variant] || colors.textPrimary;

  return (
    <RNText
      style={[
        roleStyle,
        { color },
        align ? { textAlign: align } : null,
        tabular ? styles.tabular : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
