// theme/index.ts
// Davos Design System — Core Tokens & Theme Engine
// Re-lit Dark Mode, OKLCH Ramps, 8dp Grid, System Typography, Restrained Motion

import { useColorScheme, ColorSchemeName } from 'react-native';
import {
  ThemeColors,
  lightColors,
  darkColors,
  neutralRamp,
  amberRamp,
  successRamp,
  warningRamp,
  dangerRamp,
  infoRamp,
} from './tokens/colors';
import { typography, tabularNums, type TypographyRole } from './tokens/typography';
import { spacing, radius, touchTarget, opticalOverrides, type SpacingKey, type RadiusKey } from './tokens/spacing';
import { motion, type MotionTokens } from './tokens/motion';
import { getElevation, type ElevationTokens, type ColorScheme } from './tokens/elevation';
import { iconOpticalOverrides } from './tokens/alignment-overrides/iconOverrides';

export type { ColorScheme, ThemeColors, SpacingKey, RadiusKey, TypographyRole, ElevationTokens, MotionTokens };
export {
  lightColors,
  darkColors,
  neutralRamp,
  amberRamp,
  successRamp,
  warningRamp,
  dangerRamp,
  infoRamp,
  typography,
  tabularNums,
  spacing,
  radius,
  touchTarget,
  opticalOverrides,
  motion,
  getElevation,
  iconOpticalOverrides,
};

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: ElevationTokens;
  motion: typeof motion;
  touchTarget: typeof touchTarget;
  isDark: boolean;
  colorScheme: ColorScheme;
}

export function getTheme(scheme: ColorScheme | ColorSchemeName | null | undefined): Theme {
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const colorScheme: ColorScheme = isDark ? 'dark' : 'light';

  return {
    colors,
    spacing,
    radius,
    typography,
    elevation: getElevation(colorScheme),
    motion,
    touchTarget,
    isDark,
    colorScheme,
  };
}

export function useTheme(): Theme {
  const systemScheme = useColorScheme();
  return getTheme(systemScheme);
}
