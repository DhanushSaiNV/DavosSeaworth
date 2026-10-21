// theme/tokens/colors.ts
// OKLCH-derived color tokens for Davos Seaworth.
// Rules enforced:
// 1. Color ramps generated in OKLCH: hold hue H, keep chroma C in gamut, step lightness L strictly monotonically.
// 2. Dark mode is re-lit, not inverted. Elevated surfaces are lighter than base in dark mode.
// 3. Every custom color token defines both light and dark variants.
// 4. Contrast: >=4.5:1 for body/captions, >=3:1 for non-text UI boundaries.
// 5. Brand alignment: Aligned to the Davos logo (assets/davos_logo/logo.svg) —
//    Brand Navy `#0F1B2D` and Brand Amber `#E2A63B`. Zero pure whites (#ffffff) or pure blacks (#000000).

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

  // Actions & Brand (Davos Lantern Amber #E2A63B & Deep Navy #0F1B2D)
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
  { l: 0.08, c: 0.02, h: 245, hex: '#090F19' }, // 0: Dark background (midnight navy, no pure black)
  { l: 0.12, c: 0.02, h: 245, hex: '#0E1624' }, // 1: Dark surfaceSubtle
  { l: 0.15, c: 0.022, h: 245, hex: '#131E30' }, // 2: Dark surface (Deep Navy #0F1B2D tone)
  { l: 0.19, c: 0.025, h: 245, hex: '#1A283E' }, // 3: Dark surfaceRaised
  { l: 0.65, c: 0.018, h: 245, hex: '#8E9CB2' }, // 4: Dark tertiary text
  { l: 0.72, c: 0.018, h: 245, hex: '#A3AFC2' }, // 5: Dark secondary text
  { l: 0.86, c: 0.01, h: 245, hex: '#D0D7E2' }, // 6: Light border
  { l: 0.93, c: 0.008, h: 245, hex: '#E8EDF3' }, // 7: Light surfaceSubtle
  { l: 0.96, c: 0.006, h: 245, hex: '#F0F3F7' }, // 8: Light background
  { l: 0.985, c: 0.004, h: 245, hex: '#FAFBFD' }, // 9: Light surface (crisp off-white paper, no pure white)
];

export const amberRamp: OklchColor[] = [
  { l: 0.18, c: 0.08, h: 75, hex: '#251C0C' }, // Dark lanternSurface
  { l: 0.35, c: 0.12, h: 75, hex: '#633B03' },
  { l: 0.5, c: 0.15, h: 75, hex: '#A76505' }, // Light lantern text / icon
  { l: 0.73, c: 0.15, h: 75, hex: '#E2A63B' }, // Brand Amber (#E2A63B from logo)
  { l: 0.96, c: 0.05, h: 75, hex: '#FEF7EC' }, // Light lanternSurface
];

export const successRamp: OklchColor[] = [
  { l: 0.16, c: 0.08, h: 155, hex: '#0A2117' }, // Dark successSurface
  { l: 0.35, c: 0.12, h: 155, hex: '#044C38' },
  { l: 0.48, c: 0.14, h: 155, hex: '#08663B' }, // Light success text
  { l: 0.72, c: 0.16, h: 155, hex: '#12B76A' }, // Dark success text
  { l: 0.96, c: 0.05, h: 155, hex: '#EBFBF3' }, // Light successSurface
];

export const warningRamp: OklchColor[] = [
  { l: 0.17, c: 0.08, h: 65, hex: '#241408' }, // Dark warningSurface
  { l: 0.38, c: 0.14, h: 65, hex: '#7A4004' },
  { l: 0.54, c: 0.16, h: 65, hex: '#B53D06' }, // Light warning text
  { l: 0.75, c: 0.17, h: 65, hex: '#F97316' }, // Dark warning text
  { l: 0.96, c: 0.05, h: 65, hex: '#FFF4ED' }, // Light warningSurface
];

export const dangerRamp: OklchColor[] = [
  { l: 0.15, c: 0.09, h: 25, hex: '#261215' }, // Dark dangerSurface
  { l: 0.34, c: 0.15, h: 25, hex: '#7E1313' },
  { l: 0.48, c: 0.18, h: 25, hex: '#B31924' }, // Light danger text
  { l: 0.68, c: 0.18, h: 25, hex: '#E5484D' }, // Dark danger text
  { l: 0.95, c: 0.06, h: 25, hex: '#FFF0F1' }, // Light dangerSurface
];

export const infoRamp: OklchColor[] = [
  { l: 0.16, c: 0.08, h: 245, hex: '#0C1D33' }, // Dark infoSurface
  { l: 0.36, c: 0.14, h: 245, hex: '#0A3C8A' },
  { l: 0.48, c: 0.16, h: 245, hex: '#0F52BA' }, // Light info text
  { l: 0.7, c: 0.16, h: 245, hex: '#388BFF' }, // Dark info text
  { l: 0.95, c: 0.06, h: 245, hex: '#EEF4FC' }, // Light infoSurface
];

// -----------------------------------------------------------------------------
// Semantic Palettes (Light & Dark)
// -----------------------------------------------------------------------------

export const lightColors: ThemeColors = {
  // 1. Gallery-paper elevation (recessed well -> porcelain canvas -> paper card)
  // Guaranteed: no pure white (#FFFFFF)
  surfaceSubtle: '#E8EDF3', // Recessed wells, secondary sidebars, code blocks, input fills
  background: '#F0F3F7', // Soft gallery porcelain canvas tinted with deep navy undertone
  surface: '#FAFBFD', // Primary cards, list containers, active inputs (crisp paper, not pure white)
  surfaceRaised: '#F5F7FA', // Modals, popovers, floating menus (soft alabaster, not pure white)

  // 2. High-contrast editorial ink (matching logo #0F1B2D undertone, no pure #000000)
  textPrimary: '#0F1B2D', // Deep Navy brand ink matching the logo wordmark and stem
  textSecondary: '#415167', // Balanced cool navy slate for effortless body copy reading
  textTertiary: '#596A82', // Muted pewter slate clearing WCAG AA (>= 4.5:1) on all surfaces
  textInverse: '#F5F7FA', // Soft paper alabaster for dark badges, tooltips, and pills

  // 3. Crisp structural hairlines
  borderSubtle: '#E2E7EE', // Quiet section dividers, table rows, and subtle card outlines
  border: '#D0D7E2', // Standard interactive borders and resting input outlines
  borderFocus: '#0F1B2D', // Deep Navy focus ring matching primary brand ink

  // 4. Primary Brand Accent (Deep Navy #0F1B2D) + Ambient "Lantern" (Brand Amber #E2A63B)
  accent: '#0F1B2D', // Deep Navy brand ink from logo stem/wordmark
  onAccent: '#FAFBFD', // Crisp paper text over solid navy buttons (>= 16:1 contrast, not pure white)
  accentSubtle: '#E8EDF4', // Soft navy wash for selected rows, active tabs, and chips
  lantern: '#A76505', // Burnished amber-gold (>= 4.5:1 on light surfaces, harmonized with logo amber)
  lanternSurface: '#FEF7EC', // Warm champagne amber wash (not pure white)

  // 5. Calibrated Semantic States (Radix Light scale math: luminous wash + deep readable ink)
  success: '#0D9456', // Crisp emerald for icons and status dots
  successSurface: '#EBFBF3', // Clean mint wash
  successText: '#08663B', // Deep forest ink for badge and alert copy

  warning: '#EA580C', // Signal tangerine (decoupled from lantern gold)
  warningSurface: '#FFF4ED', // Soft apricot wash
  warningText: '#B53D06', // Deep rust-orange for high-contrast legibility

  danger: '#DF2935', // Precision crimson
  dangerSurface: '#FFF0F1', // Soft rose wash
  dangerText: '#B31924', // Deep carmine ink

  info: '#0F52BA', // Deep sapphire blue
  infoSurface: '#EEF4FC', // Crisp ice-blue wash
  infoText: '#0A3C8A', // Deep navy-sapphire ink

  // 6. Utilities
  overlay: 'rgba(15, 27, 45, 0.45)', // Cool Deep Navy #0F1B2D dim (preserves crispness on modals)
  transparent: 'transparent',
};

export const darkColors: ThemeColors = {
  // 1. Midnight-navy hierarchy (ordered by luminance: background -> subtle -> surface -> raised)
  // Guaranteed: no pure black (#000000)
  background: '#090F19', // Deep OLED-friendly midnight navy with #0F1B2D undertone
  surfaceSubtle: '#0E1624', // Recessed wells, sidebars, secondary canvas areas
  surface: '#131E30', // Primary cards, inputs, and list containers (#0F1B2D family)
  surfaceRaised: '#1A283E', // Modals, popovers, dropdowns, and floating menus

  // 2. Optical typography (avoids pure #FFFFFF to prevent astigmatism halation)
  textPrimary: '#F4F6F9', // Crisp alabaster paper for effortless reading
  textSecondary: '#A3AFC2', // Balanced cool pewter slate for body copy and subtitles
  textTertiary: '#8E9CB2', // Muted slate clearing WCAG AA (>= 4.5:1) on dark surfaces
  textInverse: '#090F19', // Matches base canvas for high-contrast pills/badges

  // 3. Hairline structural borders
  borderSubtle: '#192538', // Low-contrast section dividers and quiet card outlines
  border: '#25364F', // Standard interactive borders and input rests
  borderFocus: '#E2A63B', // Brand Amber focus ring from the logo

  // 4. Primary Brand Accent (Brand Amber #E2A63B) + Ambient "Lantern" (Solar Gold #E2A63B)
  accent: '#E2A63B', // Brand Amber circle from the logo — vibrant, beacon-like on dark surfaces
  onAccent: '#0F1B2D', // Deep Navy text over solid amber buttons (>= 8:1 contrast, no pure black)
  accentSubtle: '#241E14', // Subtle amber-tinted surface for selected chips and tabs
  lantern: '#E2A63B', // Exact Brand Amber from logo
  lanternSurface: '#251C0C', // Rich ambient amber glow for highlights and AI insights

  // 5. Calibrated Semantic States (Radix Dark scale math: deep tinted surfaces + luminous text)
  success: '#12B76A', // Crisp jade
  successSurface: '#0A2117', // Deep forest ink
  successText: '#4ADE80', // High-contrast mint for badge/alert text

  warning: '#F97316', // Signal tangerine (distinct from lantern gold)
  warningSurface: '#241408', // Deep burnt umber
  warningText: '#FB923C', // Luminous apricot

  danger: '#E5484D', // Radix Crimson
  dangerSurface: '#261215', // Deep oxblood
  dangerText: '#F87171', // Soft coral-red for readable error copy

  info: '#388BFF', // Electric azure
  infoSurface: '#0C1D33', // Deep midnight navy
  infoText: '#60A5FA', // Clear sky blue

  // 6. Utilities
  overlay: 'rgba(9, 15, 25, 0.78)', // Tinted with the midnight navy base rather than raw black
  transparent: 'transparent',
};
