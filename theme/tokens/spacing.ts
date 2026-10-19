// theme/tokens/spacing.ts
// 8dp Base Grid Spacing Scale for Davos Seaworth.
// Rules:
// 1. Core spacing scale is strictly multiples of 8dp.
// 2. Optical overrides are allowed only as named tokens in opticalOverrides.

export const spacing = {
  none: 0,
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  xxl: 48,
  huge: 64,
  // Backward compatibility aliases mapped to 8dp or documented overrides
  xxs: 4,
} as const;

export const opticalOverrides = {
  xxs: 4,
  compact: 12,
  iconPlayNudgeX: 1.5,
  rowGapTightTweak: 2.0,
  iconNudgeY: 1.0,
} as const;

export type SpacingKey = keyof typeof spacing;

export const radius = {
  sm: 6,
  md: 12,
  lg: 16,
  full: 9999,
} as const;

export type RadiusKey = keyof typeof radius;

export const touchTarget = {
  minHeight: 48,
  minWidth: 48,
  minTargetIos: 44,
  minTargetAndroid: 48,
  hitSlop: 8,
} as const;
