// components/ui/Icon.tsx
// Unified Vector Icon component wrapping Feather & Ionicons from @expo/vector-icons
// Ensures consistent sizing (16/20/24), colors from theme, and a11y labels

import React from 'react';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

export type IconFamily = 'feather' | 'ionicons';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | number;

export interface IconProps {
  name: string;
  family?: IconFamily;
  size?: IconSize;
  color?: string;
  accessibilityLabel?: string;
}

const SIZE_MAP: Record<'xs' | 'sm' | 'md' | 'lg', number> = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
};

export function Icon({
  name,
  family = 'feather',
  size = 'md',
  color,
  accessibilityLabel,
}: IconProps) {
  const { colors } = useTheme();
  const resolvedSize = typeof size === 'number' ? size : SIZE_MAP[size] ?? 20;
  const resolvedColor = color ?? colors.textPrimary;

  if (family === 'ionicons') {
    return (
      <Ionicons
        // @ts-expect-error Name checked at callsite
        name={name}
        size={resolvedSize}
        color={resolvedColor}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  return (
    <Feather
      // @ts-expect-error Name checked at callsite
      name={name}
      size={resolvedSize}
      color={resolvedColor}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
