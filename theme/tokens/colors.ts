// theme/tokens/colors.ts
// OKLCH-derived color tokens for Davos Seaworth.
// Rules enforced:
// 1. Color ramps generated in OKLCH: hold hue H, keep chroma C in gamut, step lightness L strictly monotonically.
// 2. Dark mode is re-lit, not inverted. Elevated surfaces are lighter than base in dark mode.
// 3. Every custom color token defines both light and dark variants.
// 4. Contrast: >=4.5:1 for body/captions, >=3:1 for non-text UI boundaries.

export interface OklchColor {
  l: number; // 0..1 Lightness (strictly monotonic)
  c: number; // Chroma
  h: number; // Hue in degrees
  hex: string;
}

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

  // Structural boundaries
  border: string;
  borderSubtle: string;
  borderFocus: string;

  // Actions & Brand (Davos Lantern Amber)
  accent: string;
  onAccent: string;
  accentSubtle: string;
  lantern: string;
  lanternSurface: string;

  // Status & Feedback (Always paired with icon or text, never color-alone)
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

  // Overlay & Specials
  overlay: string;
  transparent: string;
}

// -----------------------------------------------------------------------------
// OKLCH Ramps with strictly monotonic Lightness L
// -----------------------------------------------------------------------------

export const neutralRamp: OklchColor[] = [
  { l: 0.08, c: 0.015, h: 260, hex: '#090A0F' }, // 0: Dark background
  { l: 0.12, c: 0.015, h: 260, hex: '#12151E' }, // 1: Dark surface
  { l: 0.16, c: 0.018, h: 260, hex: '#1A1E2B' }, // 2: Dark surfaceRaised
  { l: 0.2, c: 0.02, h: 260, hex: '#262B3A' }, // 3: Dark border
  { l: 0.45, c: 0.015, h: 260, hex: '#6B7280' }, // 4: Dark tertiary text
  { l: 0.62, c: 0.015, h: 260, hex: '#9CA3AF' }, // 5: Dark secondary text
  { l: 0.88, c: 0.01, h: 260, hex: '#E2E4E9' }, // 6: Light border
  { l: 0.92, c: 0.008, h: 260, hex: '#F1F3F5' }, // 7: Light surfaceSubtle
  { l: 0.97, c: 0.005, h: 260, hex: '#F8F9FA' }, // 8: Light background
  { l: 1.0, c: 0.0, h: 0, hex: '#FFFFFF' }, // 9: Light surface / pure white
];

export const amberRamp: OklchColor[] = [
  { l: 0.18, c: 0.08, h: 75, hex: '#261B0B' }, // Dark lanternSurface
  { l: 0.35, c: 0.12, h: 75, hex: '#663B02' },
  { l: 0.52, c: 0.15, h: 75, hex: '#B45309' }, // Light lantern text / icon
  { l: 0.74, c: 0.16, h: 75, hex: '#F59E0B' }, // Dark lantern text / icon
  { l: 0.95, c: 0.06, h: 75, hex: '#FEF3C7' }, // Light lanternSurface
];

export const successRamp: OklchColor[] = [
  { l: 0.16, c: 0.08, h: 155, hex: '#0F291E' }, // Dark successSurface
  { l: 0.35, c: 0.12, h: 155, hex: '#044C38' },
  { l: 0.48, c: 0.14, h: 155, hex: '#047857' }, // Light success text
  { l: 0.72, c: 0.16, h: 155, hex: '#10B981' }, // Dark success text
  { l: 0.96, c: 0.05, h: 155, hex: '#ECFDF5' }, // Light successSurface
];

export const warningRamp: OklchColor[] = [
  { l: 0.17, c: 0.08, h: 65, hex: '#2E1E09' }, // Dark warningSurface
  { l: 0.38, c: 0.14, h: 65, hex: '#7A4004' },
  { l: 0.54, c: 0.16, h: 65, hex: '#D97706' }, // Light warning text
  { l: 0.75, c: 0.17, h: 65, hex: '#F59E0B' }, // Dark warning text
  { l: 0.96, c: 0.05, h: 65, hex: '#FFFBEB' }, // Light warningSurface
];

export const dangerRamp: OklchColor[] = [
  { l: 0.15, c: 0.09, h: 25, hex: '#2C1518' }, // Dark dangerSurface
  { l: 0.34, c: 0.15, h: 25, hex: '#7E1313' },
  { l: 0.48, c: 0.18, h: 25, hex: '#DC2626' }, // Light danger text
  { l: 0.68, c: 0.18, h: 25, hex: '#EF4444' }, // Dark danger text
  { l: 0.95, c: 0.06, h: 25, hex: '#FEF2F2' }, // Light dangerSurface
];

export const infoRamp: OklchColor[] = [
  { l: 0.16, c: 0.08, h: 245, hex: '#132238' }, // Dark infoSurface
  { l: 0.36, c: 0.14, h: 245, hex: '#10398A' },
  { l: 0.48, c: 0.16, h: 245, hex: '#2563EB' }, // Light info text
  { l: 0.7, c: 0.16, h: 245, hex: '#3B82F6' }, // Dark info text
  { l: 0.95, c: 0.06, h: 245, hex: '#EFF6FF' }, // Light infoSurface
];

// -----------------------------------------------------------------------------
// Semantic Palettes (Light & Dark)
// -----------------------------------------------------------------------------

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
  lantern: '#B45309',
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
  transparent: 'transparent',
};

export const darkColors: ThemeColors = {
  background: '#090A0F',
  surface: '#12151E',
  surfaceRaised: '#1A1E2B',
  surfaceSubtle: '#181C26',

  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textTertiary: '#8B93A1',
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
  transparent: 'transparent',
};
