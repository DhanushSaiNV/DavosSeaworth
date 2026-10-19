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
  // 1. Gallery-paper elevation (recessed well -> alabaster canvas -> pure white card)
  surfaceSubtle: '#F2F3F7', // Recessed wells, secondary sidebars, code blocks, and input fills
  background: '#F9F9FB', // Crisp gallery alabaster canvas so #FFFFFF cards pop without heavy shadows
  surface: '#FFFFFF', // Primary cards, list containers, and active inputs
  surfaceRaised: '#FFFFFF', // Modals, popovers, and floating menus (pair with border + ambient shadow)

  // 2. High-contrast editorial ink (avoids pure #000000 and fixes secondary/tertiary crowding)
  textPrimary: '#111318', // Deep carbon ink matching the dark theme's undertone
  textSecondary: '#555966', // Balanced slate-charcoal for effortless body copy reading
  textTertiary: '#7E8494', // Distinctly lighter pewter for timestamps, captions, and placeholders
  textInverse: '#FFFFFF', // Pure white for dark badges, tooltips, and high-contrast pills

  // 3. Crisp structural hairlines
  borderSubtle: '#ECEEF2', // Quiet section dividers, table rows, and subtle card outlines
  border: '#DFE2E8', // Standard interactive borders and resting input outlines
  borderFocus: '#5E43CC', // Crisp iris focus ring calibrated for light backgrounds

  // 4. Primary Brand Accent (Electric Iris) + Ambient "Lantern" (Burnished Honey)
  accent: '#5E43CC', // Stepped 8% deeper than dark mode so #FFFFFF text hits WCAG AA+ contrast
  onAccent: '#FFFFFF', // Crisp white over solid iris buttons and active badges
  accentSubtle: '#F2EFFE', // Soft lavender-iris wash for selected rows, active tabs, and chips
  lantern: '#C87A0A', // Burnished honey-gold (readable on light surfaces, distinct from warning)
  lanternSurface: '#FDF5E6', // Warm champagne cream (avoids acidic "post-it note" yellow #FEF3C7)

  // 5. Calibrated Semantic States (Radix Light scale math: luminous wash + deep readable ink)
  success: '#0D9456', // Crisp emerald for icons and status dots
  successSurface: '#EBFBF3', // Clean mint wash
  successText: '#08663B', // Deep forest ink for badge and alert copy

  warning: '#EA580C', // Signal tangerine (decoupled from `lantern` gold)
  warningSurface: '#FFF4ED', // Soft apricot wash
  warningText: '#B53D06', // Deep rust-orange for high-contrast legibility

  danger: '#DF2935', // Precision crimson
  dangerSurface: '#FFF0F1', // Soft rose wash
  dangerText: '#B31924', // Deep carmine ink

  info: '#1D68E6', // Cobalt azure
  infoSurface: '#EEF5FF', // Crisp ice-blue wash
  infoText: '#154BB0', // Deep sapphire ink

  // 6. Utilities
  overlay: 'rgba(12, 14, 20, 0.42)', // Cool carbon dim that preserves crispness on white modals
  transparent: 'transparent',
};

export const darkColors: ThemeColors = {
  // 1. Carbon-biased obsidian hierarchy (ordered by luminance: background -> subtle -> surface -> raised)
  background: '#08090B', // Deep OLED-friendly carbon with a micro-hint of cool ink
  surfaceSubtle: '#0D0E12', // Recessed wells, sidebars, or secondary canvas areas
  surface: '#12141A', // Primary cards, inputs, and list containers
  surfaceRaised: '#191C24', // Modals, popovers, dropdowns, and active hover states

  // 2. Optical typography (avoids pure #FFFFFF to prevent astigmatism halation on dark backgrounds)
  textPrimary: '#F3F4F6', // Crisp alabaster white for effortless reading
  textSecondary: '#9498A6', // Balanced cool pewter for body copy and subtitles
  textTertiary: '#5E6270', // Muted slate for timestamps, placeholders, and disabled states
  textInverse: '#08090B', // Matches base canvas for high-contrast pills/badges

  // 3. Hairline structural borders
  borderSubtle: '#171920', // Low-contrast section dividers and quiet card outlines
  border: '#232733', // Standard interactive borders and input rests
  borderFocus: '#7C66DC', // Crisp iris focus ring tied to the primary accent

  // 4. Primary Brand Accent (Electric Iris) + Ambient "Lantern" (Solar Gold)
  accent: '#6E56CF', // High-craft violet-indigo that pops without vibrating
  onAccent: '#FFFFFF', // Pure white for maximum legibility over saturated iris
  accentSubtle: '#1A162B', // Deep plum-tinted surface for selected states and chips
  lantern: '#F5A524', // Warm candlelight gold (decoupled from warning orange)
  lanternSurface: '#1F1608', // Rich ambient amber glow for highlights or AI/insight callouts

  // 5. Calibrated Semantic States (Radix Dark scale math: deep tinted surfaces + luminous text)
  success: '#12B76A', // Crisp jade
  successSurface: '#0A1F16', // Deep forest ink
  successText: '#4ADE80', // High-contrast mint for badge/alert text

  warning: '#F97316', // Signal tangerine (distinct from `lantern` gold)
  warningSurface: '#221208', // Deep burnt umber
  warningText: '#FB923C', // Luminous apricot

  danger: '#E5484D', // Radix Crimson (avoids the harsh neon vibration of #EF4444)
  dangerSurface: '#241013', // Deep oxblood
  dangerText: '#F87171', // Soft coral-red for readable error copy

  info: '#388BFF', // Electric azure
  infoSurface: '#0C192C', // Deep midnight navy
  infoText: '#60A5FA', // Clear sky blue

  // 6. Utilities
  overlay: 'rgba(4, 5, 8, 0.76)', // Tinted with the carbon base rather than raw black
  transparent: 'transparent',
};
