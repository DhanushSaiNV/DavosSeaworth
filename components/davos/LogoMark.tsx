// components/davos/LogoMark.tsx
// Canonical component for Object: Shell brand mark (PRD §12).
// Renders the existing SVG logo mark from assets/ at 24px at the top of the rail.
// Uses existing BrandMark primitive drawing.

import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { BrandMark } from '../brand/BrandMark';

export interface LogoMarkProps {
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function LogoMark({
  size = 24,
  accessibilityLabel = 'Davos',
  style,
}: LogoMarkProps) {
  return (
    <View style={style}>
      <BrandMark
        size={size}
        accessibilityLabel={accessibilityLabel}
        decorative={false}
      />
    </View>
  );
}
