// components/__tests__/StatusGlyph.test.tsx
// Unit tests and WCAG contrast floor assertions for StatusGlyph (Blueprint §5 Step 2).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StatusGlyph, type GlyphState } from '../StatusGlyph';
import { contrastRatio } from '../../lib/theme/contrast.test';
import { lightColors, darkColors } from '../../theme/tokens/colors';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('StatusGlyph', () => {
  const allStates: GlyphState[] = [
    'upcoming',
    'due',
    'done',
    'partly',
    'missed',
    'unplanned',
    'urge_held',
    'urge_yielded',
  ];

  describe.each([12, 16] as const)('at size %d', (size) => {
    test.each(allStates)('renders state "%s" with correct accessible role and label', (state) => {
      let tree: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<StatusGlyph state={state} size={size} colorScheme="light" />);
      });
      const root = tree!.root;
      const element = root.find((node) => node.props.accessibilityRole === 'image');
      expect(element).toBeDefined();
      expect(element.props.accessibilityLabel).toBeDefined();
      expect(typeof element.props.accessibilityLabel).toBe('string');
    });
  });

  describe('custom accessibility label override', () => {
    test('renders with custom label', () => {
      let tree: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <StatusGlyph state="missed" label="Check-in was missed" colorScheme="light" />
        );
      });
      const root = tree!.root;
      const element = root.find(
        (node) => node.props.accessibilityLabel === 'Check-in was missed'
      );
      expect(element).toBeDefined();
    });
  });

  describe('WCAG contrast floor verification for glyph tones (Blueprint §5 Step 2)', () => {
    const palettes = {
      light: lightColors,
      dark: darkColors,
    };

    describe.each(['light', 'dark'] as const)('%s scheme', (scheme) => {
      const colors = palettes[scheme];
      const surface = colors.surface;
      const background = colors.background;

      test('textPrimary clears 4.5:1 on surface and background (Due, Missed, Partly, Urge yielded)', () => {
        expect(contrastRatio(colors.textPrimary, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.textPrimary, background)).toBeGreaterThanOrEqual(4.5);
      });

      test('textSecondary clears 4.5:1 on surface and background (Done disc, Urge held, Unplanned)', () => {
        expect(contrastRatio(colors.textSecondary, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.textSecondary, background)).toBeGreaterThanOrEqual(4.5);
      });

      test('textTertiary clears 3:1 on surface and background (Upcoming ring)', () => {
        expect(contrastRatio(colors.textTertiary, surface)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(colors.textTertiary, background)).toBeGreaterThanOrEqual(3.0);
      });

      test('done glyph knocked-out check clears contrast on textSecondary disc', () => {
        // The check is in surface color knocked out on textSecondary
        const ratio = contrastRatio(surface, colors.textSecondary);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });
    });
  });
});
