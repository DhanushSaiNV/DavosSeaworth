// theme/tokens/typography.ts
// Platform system typography scale for Davos Seaworth.
// Constraints:
// 1. System fonts only (San Francisco on iOS, Roboto on Android).
// 2. ZERO letterSpacing on body text or any text style here (allowed only in alignment-overrides).
// 3. Tabular numerals for timers, money, counters, and telemetry.

import { Platform, TextStyle } from 'react-native';

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

export const tabularNums: { fontVariant: TextStyle['fontVariant'] } = {
  fontVariant: ['tabular-nums'],
};

export const typography = {
  display: {
    fontFamily: FONT_FAMILY,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as TextStyle['fontWeight'],
  },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as TextStyle['fontWeight'],
  },
  heading: {
    fontFamily: FONT_FAMILY,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as TextStyle['fontWeight'],
  },
  body: {
    fontFamily: FONT_FAMILY,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as TextStyle['fontWeight'],
  },
  bodyMedium: {
    fontFamily: FONT_FAMILY,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500' as TextStyle['fontWeight'],
  },
  bodyStrong: {
    fontFamily: FONT_FAMILY,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600' as TextStyle['fontWeight'],
  },
  label: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600' as TextStyle['fontWeight'],
  },
  caption: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as TextStyle['fontWeight'],
  },
  mono: {
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500' as TextStyle['fontWeight'],
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
};

export type TypographyRole = keyof typeof typography;
