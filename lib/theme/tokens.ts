// lib/theme/tokens.ts
// The single source of truth for every colour, size, radius, shadow and duration in the app.
//
// This is the ONLY module allowed to contain raw colour literals or numeric design values. Every
// screen and component reads from here, so a change to the system is a change in one file.
//
// Direction: Brand Navy `#0F1B2D` & Brand Amber `#E2A63B` from `assets/davos_logo/logo.svg`.
// Zero pure whites (#ffffff) and zero pure blacks (#000000).

export type ColorScheme = 'light' | 'dark';

/**
 * The semantic colour contract. Components never name a raw hex; they name a role.
 *
 * Guaranteed legibility pairs are enforced mechanically by `lib/theme/contrast.test.ts`:
 *   textPrimary / textSecondary / textMuted  on background, surface, surfaceRaised  >= 4.5:1
 *   onAccent                                 on accent                             >= 4.5:1
 *   success / warning / danger / info        on surface and on their own *Surface  >= 4.5:1
 *   borderStrong / accent                    on background and surface             >= 3:1   (UI)
 * `border` is a decorative hairline only: it never identifies a control, so 1.4.11 does not apply.
 */
export interface ThemeColors {
  /** The page. */
  background: string;
  /** A raised entry, field or panel sitting on the page. */
  surface: string;
  /** One step above `surface` (a sheet, a popover, a pressed row). */
  surfaceRaised: string;
  /** A well: at-rest inputs, tick backgrounds, inset fills. */
  sunken: string;
  /** Decorative hairline. Separators only — never a control boundary. */
  border: string;
  /** A control boundary (input outline, outline button, chip edge). Meets 3:1. */
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  /** Metadata: timestamps, counts. Still meets 4.5:1 on background and surface. */
  textMuted: string;
  /** The brand ink. The primary action and the active affordance. */
  accent: string;
  onAccent: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  info: string;
  infoSurface: string;
}

const light: ThemeColors = {
  background: '#F0F3F7',
  surface: '#FAFBFD',
  surfaceRaised: '#F5F7FA',
  sunken: '#E8EDF3',
  border: '#E2E7EE',
  borderStrong: '#596A82',
  textPrimary: '#0F1B2D',
  textSecondary: '#415167',
  textMuted: '#596A82',
  accent: '#0F1B2D',
  onAccent: '#FAFBFD',
  success: '#0D9456',
  successSurface: '#EBFBF3',
  warning: '#EA580C',
  warningSurface: '#FFF4ED',
  danger: '#DF2935',
  dangerSurface: '#FFF0F1',
  info: '#0F52BA',
  infoSurface: '#EEF4FC',
};

const dark: ThemeColors = {
  background: '#090F19',
  surface: '#131E30',
  surfaceRaised: '#1A283E',
  sunken: '#0E1624',
  border: '#192538',
  borderStrong: '#8E9CB2',
  textPrimary: '#F4F6F9',
  textSecondary: '#A3AFC2',
  textMuted: '#8E9CB2',
  accent: '#E2A63B',
  onAccent: '#0F1B2D',
  success: '#12B76A',
  successSurface: '#0A2117',
  warning: '#F97316',
  warningSurface: '#241408',
  danger: '#E5484D',
  dangerSurface: '#261215',
  info: '#388BFF',
  infoSurface: '#0C1D33',
};

export const palettes: Record<ColorScheme, ThemeColors> = { light, dark };

/** 4 px base. Every gap in the app is one of these. */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export type Spacing = typeof spacing;

/** Three radii plus pill. No component invents a fourth. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 999,
} as const;

/** Three elevations. Most surfaces use none — borders and contrast carry the depth. */
export const elevation = {
  none: {},
  low: {
    shadowColor: '#0A121E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  high: {
    shadowColor: '#0A121E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

export type TypeRole =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'micro';

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
}

/**
 * Type roles. One family — the platform system face (stated reason in DESIGN_DECISIONS.md: $0
 * budget, three platforms, instant first paint, no download). Hierarchy comes from size, weight
 * and leading, never from colour.
 */
export const typography: Record<TypeRole, TypeStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
};

/** Tabular figures for anything that lines up in a column (times, counts, clocks, steppers). */
export const tabularNums = { fontVariant: ['tabular-nums'] as const };

/** Durations in ms. UI transitions 120–240; a single larger reveal may reach 320. */
export const motion = {
  instant: 0,
  fast: 140,
  base: 200,
  slow: 320,
} as const;

/**
 * Minimum touch target. 48 satisfies both iOS' 44 pt guidance and Android's 48 dp floor, so one
 * number covers every platform; `hitSlop` extends small visual controls to it.
 */
export const touch = {
  min: 48,
  hitSlop: 8,
  /** Minimum gap between adjacent targets so a mis-tap cannot hit the neighbour. */
  gap: 8,
} as const;
