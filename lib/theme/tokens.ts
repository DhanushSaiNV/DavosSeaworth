// lib/theme/tokens.ts
// The single source of truth for every colour, size, radius, shadow and duration in the app.
//
// This is the ONLY module allowed to contain raw colour literals or numeric design values. Every
// screen and component reads from here, so a change to the system is a change in one file.
//
// Direction: "Ink & Paper" — the brand mark is a solid-ink portrait on white, so the accent IS the
// ink. Colour is spent only on semantics (success / warning / danger / info); everything else is
// paper, ink and hairlines. See DESIGN_DECISIONS.md §Stage 2.

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
  background: '#F5F3EF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  sunken: '#EDEAE4',
  border: '#DFDBD4',
  borderStrong: '#8A8478',
  textPrimary: '#15130F',
  textSecondary: '#5B554C',
  textMuted: '#6F6A62',
  accent: '#15130F',
  onAccent: '#FFFFFF',
  success: '#1B6B49',
  successSurface: '#E7F3EC',
  warning: '#8A5600',
  warningSurface: '#FBF1DE',
  danger: '#A62318',
  dangerSurface: '#FBEAE7',
  info: '#2F5A76',
  infoSurface: '#E8F0F5',
};

const dark: ThemeColors = {
  background: '#131211',
  surface: '#1C1B19',
  surfaceRaised: '#242220',
  sunken: '#0D0C0B',
  border: '#332F2B',
  borderStrong: '#726C63',
  textPrimary: '#F6F4F0',
  textSecondary: '#B6B0A6',
  textMuted: '#8F887C',
  accent: '#F6F4F0',
  onAccent: '#131211',
  success: '#4FBF8B',
  successSurface: '#12291F',
  warning: '#E0A33A',
  warningSurface: '#2E2413',
  danger: '#FF8A7A',
  dangerSurface: '#331A17',
  info: '#7FB4D6',
  infoSurface: '#16262F',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  high: {
    shadowColor: '#000',
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
  letterSpacing?: number;
}

/**
 * Type roles. One family — the platform system face (stated reason in DESIGN_DECISIONS.md: $0
 * budget, three platforms, instant first paint, no download). Hierarchy comes from size, weight
 * and leading, never from colour.
 */
export const typography: Record<TypeRole, TypeStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
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
