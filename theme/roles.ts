// theme/roles.ts
// Semantic role mappings from PRD §12 and design/DESIGN.md §9 (TOKEN MAP).
// Aliases of existing tokens in theme/tokens/ for light and dark schemes.

import { darkColors, lightColors } from './tokens/colors';
import { typography } from './tokens/typography';

export { radius, spacing, touchTarget } from './tokens/spacing';

export interface ColorRoles {
  surface: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  accent: string;
  onAccent: string;
  brandAmber: string;
  danger: string;
  focusRing: string;
  disabled: string;
  transparent: string;
}

export interface TypeRoles {
  davosVoice: typeof typography.bodyMedium;
  userText: typeof typography.body;
  meta: typeof typography.caption;
  figure: typeof typography.mono;
  heading: typeof typography.heading;
}

export const lightColorRoles: ColorRoles = {
  surface: lightColors.surface,
  textPrimary: lightColors.textPrimary,
  textSecondary: lightColors.textSecondary,
  divider: lightColors.borderSubtle,
  accent: lightColors.accent, // Deep Navy (#0F1B2D)
  onAccent: lightColors.onAccent,
  brandAmber: '#E2A63B', // Brand Amber marker/fill only, never text on light
  danger: lightColors.danger,
  focusRing: lightColors.borderFocus,
  disabled: lightColors.textTertiary, // Aliased to textTertiary (#596A82)
  transparent: 'transparent',
};

export const darkColorRoles: ColorRoles = {
  surface: darkColors.surface,
  textPrimary: darkColors.textPrimary,
  textSecondary: darkColors.textSecondary,
  divider: darkColors.borderSubtle,
  accent: darkColors.accent, // Brand Amber (#E2A63B)
  onAccent: darkColors.onAccent,
  brandAmber: '#E2A63B',
  danger: darkColors.danger,
  focusRing: darkColors.borderFocus,
  disabled: darkColors.textTertiary, // Aliased to textTertiary (#8E9CB2)
  transparent: 'transparent',
};

export const typeRoles: TypeRoles = {
  davosVoice: typography.bodyMedium,
  userText: typography.body,
  meta: typography.caption,
  figure: typography.mono,
  heading: typography.heading,
};

export const colorRoles = {
  light: lightColorRoles,
  dark: darkColorRoles,
};
