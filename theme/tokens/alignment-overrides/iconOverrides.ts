// theme/tokens/alignment-overrides/iconOverrides.ts
// Optical alignment override tokens for icons, glyphs, and perceived optical centers.
// Note: Per the design specification, this is the ONLY location where letterSpacing
// overrides are permitted (to compensate for icon font glyph kerning and optical center shifts).

export const iconOpticalOverrides = {
  iconPlayNudgeX: 1.5,
  iconNudgeY: 1.0,
  rowGapTightTweak: 2.0,
  /** Kerning override for icon font glyph pairings */
  iconKerningOverride: {
    letterSpacing: 0,
  },
} as const;

export type IconOpticalOverrides = typeof iconOpticalOverrides;
