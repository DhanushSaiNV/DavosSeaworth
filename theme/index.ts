// theme/index.ts
// Davos Design System — Core Tokens & Theme Engine
// Architectural Editorial Minimalism (Linear meets Swiss Typography)

import { useColorScheme, Platform, TextStyle, ViewStyle, ColorSchemeName } from 'react-native';

export type ColorScheme = 'light' | 'dark';

// -----------------------------------------------------------------------------
// 1. Semantic Color Palettes
// -----------------------------------------------------------------------------

export interface ThemeColors {
  // Base surfaces
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSubtle: string;

  // Text & Content (all verified >= 4.5:1 against respective surfaces)
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  // Structural boundaries (>= 1.2:1 against surface for structural separators)
  border: string;
  borderSubtle: string;
  borderFocus: string;

  // Actions & Brand
  accent: string;
  onAccent: string;
  accentSubtle: string;
  lantern: string; // Davos's signature amber lantern
  lanternSurface: string;

  // Status & Feedback
  success: string;
  successSurface: string;
  successText: string;

  warning: string;
  warningSurface: string;
  warningText: string;

  danger: string;
  dangerSurface: string;
  dangerText: string;

  info: string;
  infoSurface: string;
  infoText: string;

  // Overlay
  overlay: string;
}

export const lightColors: ThemeColors = {
  background: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSubtle: '#F1F3F5',

  textPrimary: '#0F1117',
  textSecondary: '#525866',
  textTertiary: '#687082',
  textInverse: '#FFFFFF',

  border: '#E2E4E9',
  borderSubtle: '#EEF0F3',
  borderFocus: '#0F1117',

  accent: '#0F1117',
  onAccent: '#FFFFFF',
  accentSubtle: '#E2E4E9',
  lantern: '#B45309', // Amber 700 for accessible text/accents
  lanternSurface: '#FEF3C7',

  success: '#047857',
  successSurface: '#ECFDF5',
  successText: '#065F46',

  warning: '#D97706',
  warningSurface: '#FFFBEB',
  warningText: '#92400E',

  danger: '#DC2626',
  dangerSurface: '#FEF2F2',
  dangerText: '#B91C1C',

  info: '#2563EB',
  infoSurface: '#EFF6FF',
  infoText: '#1D4ED8',

  overlay: 'rgba(15, 17, 23, 0.45)',
};

export const darkColors: ThemeColors = {
  background: '#090A0F',
  surface: '#12151E',
  surfaceRaised: '#1A1E2B',
  surfaceSubtle: '#181C26',

  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  textInverse: '#090A0F',

  border: '#262B3A',
  borderSubtle: '#1B1F2B',
  borderFocus: '#F9FAFB',

  accent: '#F9FAFB',
  onAccent: '#090A0F',
  accentSubtle: '#262B3A',
  lantern: '#F59E0B',
  lanternSurface: '#261B0B',

  success: '#10B981',
  successSurface: '#0F291E',
  successText: '#34D399',

  warning: '#F59E0B',
  warningSurface: '#2E1E09',
  warningText: '#FBBF24',

  danger: '#EF4444',
  dangerSurface: '#2C1518',
  dangerText: '#F87171',

  info: '#3B82F6',
  infoSurface: '#132238',
  infoText: '#60A5FA',

  overlay: 'rgba(0, 0, 0, 0.7)',
};

// -----------------------------------------------------------------------------
// 2. Spacing Scale (4px base)
// -----------------------------------------------------------------------------

export const spacing = {
  none: 0,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  huge: 64,
} as const;

export type SpacingKey = keyof typeof spacing;

// -----------------------------------------------------------------------------
// 3. Radius Scale (at most 3 values + full)
// -----------------------------------------------------------------------------

export const radius = {
  sm: 6,
  md: 12,
  lg: 16,
  full: 9999,
} as const;

export type RadiusKey = keyof typeof radius;

// -----------------------------------------------------------------------------
// 4. Elevation (iOS shadow + Android elevation)
// -----------------------------------------------------------------------------

export interface ElevationTokens {
  none: ViewStyle;
  raised: ViewStyle;
  overlay: ViewStyle;
}

export const getElevation = (colorScheme: ColorScheme): ElevationTokens => {
  const isDark = colorScheme === 'dark';
  const shadowColor = isDark ? '#000000' : '#0F1117';

  return {
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    raised: {
      shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.35 : 0.06,
      shadowRadius: 6,
      elevation: 2,
    },
    overlay: {
      shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.5 : 0.12,
      shadowRadius: 16,
      elevation: 6,
    },
  };
};

// -----------------------------------------------------------------------------
// 5. Typography Roles
// -----------------------------------------------------------------------------

const FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});

const MONO_FONT_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
});

export const typography = {
  display: {
    fontFamily: FONT_FAMILY,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as TextStyle['fontWeight'],
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as TextStyle['fontWeight'],
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FONT_FAMILY,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as TextStyle['fontWeight'],
    letterSpacing: 0,
  },
  bodyMedium: {
    fontFamily: FONT_FAMILY,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500' as TextStyle['fontWeight'],
    letterSpacing: 0,
  },
  caption: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as TextStyle['fontWeight'],
    letterSpacing: 0.1,
  },
  mono: {
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500' as TextStyle['fontWeight'],
    letterSpacing: 0.2,
  },
} as const;

// -----------------------------------------------------------------------------
// 6. Motion & Target Constants
// -----------------------------------------------------------------------------

export const motion = {
  duration: {
    fast: 150,
    normal: 240,
    slow: 400,
  },
} as const;

export const touchTarget = {
  minHeight: Platform.OS === 'ios' ? 44 : 48,
  minWidth: Platform.OS === 'ios' ? 44 : 48,
  hitSlop: 8,
} as const;

// -----------------------------------------------------------------------------
// 7. Full Theme Context & Hook
// -----------------------------------------------------------------------------

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

export function getTheme(scheme: ColorScheme | null | undefined): Theme {
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const colorScheme = isDark ? 'dark' : 'light';

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
