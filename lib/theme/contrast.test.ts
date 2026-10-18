// lib/theme/contrast.test.ts
// The accessibility floor, computed rather than eyeballed.
//
// Verifies every foreground/background token pair the design actually uses, in both schemes:
//   text tokens on background / surface / surfaceRaised        >= 4.5:1
//   semantic text on surface and on its own tinted *Surface     >= 4.5:1
//   onAccent on accent                                         >= 4.5:1
//   control boundaries (borderStrong, accent) on page surfaces  >= 3:1
//
// `border` is excluded on purpose: it is a decorative hairline between rows and never the only
// thing that identifies a control, so WCAG 1.4.11 (non-text contrast) does not apply to it. The
// control boundary token is `borderStrong`.
//
// Refs: DESIGN_DECISIONS.md §Stage 2/3, §verification.

import { palettes, type ColorScheme, type ThemeColors } from './tokens';

/** sRGB hex (#rgb or #rrggbb) -> [r, g, b] in 0..255. */
function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** Foreground tokens that must clear 4.5:1 on each page surface. */
const TEXT_ON_SURFACES: (keyof ThemeColors)[] = ['textPrimary', 'textSecondary', 'textMuted'];
const PAGE_SURFACES: (keyof ThemeColors)[] = ['background', 'surface', 'surfaceRaised'];

/** Semantic pairings: text tone -> the surfaces it is allowed to sit on. */
const SEMANTIC_ON_TINT: [keyof ThemeColors, keyof ThemeColors][] = [
  ['success', 'surface'],
  ['success', 'successSurface'],
  ['warning', 'surface'],
  ['warning', 'warningSurface'],
  ['danger', 'surface'],
  ['danger', 'dangerSurface'],
  ['info', 'surface'],
  ['info', 'infoSurface'],
];

/** Non-text contrast: anything that identifies a control boundary. */
const UI_ON_SURFACES: (keyof ThemeColors)[] = ['borderStrong', 'accent'];

const schemes: ColorScheme[] = ['light', 'dark'];

describe('theme contrast floor', () => {
  describe.each(schemes)('%s', (scheme) => {
    const colors = palettes[scheme];

    test.each(TEXT_ON_SURFACES.flatMap((fg) => PAGE_SURFACES.map((bg) => [fg, bg] as const)))(
      '%s on %s clears 4.5:1',
      (fg, bg) => {
        const ratio = contrastRatio(colors[fg], colors[bg]);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      },
    );

    test.each(SEMANTIC_ON_TINT)('%s on %s clears 4.5:1', (fg, bg) => {
      const ratio = contrastRatio(colors[fg], colors[bg]);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    test('onAccent on accent clears 4.5:1', () => {
      expect(contrastRatio(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    });

    test.each(UI_ON_SURFACES.flatMap((fg) => PAGE_SURFACES.map((bg) => [fg, bg] as const)))(
      '%s on %s clears 3:1',
      (fg, bg) => {
        const ratio = contrastRatio(colors[fg], colors[bg]);
        expect(ratio).toBeGreaterThanOrEqual(3);
      },
    );
  });

  test('relativeLuminance matches the WCAG reference values', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 4);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 2);
  });

  test('the two schemes define exactly the same roles', () => {
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
  });
});
