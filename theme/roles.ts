// theme/roles.ts
// Semantic role mappings from PRD §12 and design/DESIGN.md §9 (TOKEN MAP).
// Aliases of existing tokens in theme/tokens/ for light and dark schemes.

import { darkColors, lightColors } from './tokens/colors';
import { typography } from './tokens/typography';

export { spacing, touchTarget } from './tokens/spacing';

export interface ColorRoles {
  surface: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  accent: string;
  onAccent: string;
  danger: string;
  focusRing: string;
  disabled: string;
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
  accent: lightColors.lantern, // Brand Amber role in light scheme (#A76505)
  onAccent: lightColors.onAccent,
  danger: lightColors.danger,
  focusRing: lightColors.borderFocus,
  disabled: lightColors.textTertiary, // Option 1: aliased to textTertiary (#596A82)
};

export const darkColorRoles: ColorRoles = {
  surface: darkColors.surface,
  textPrimary: darkColors.textPrimary,
  textSecondary: darkColors.textSecondary,
  divider: darkColors.borderSubtle,
  accent: darkColors.accent, // Brand Amber in dark scheme (#E2A63B)
  onAccent: darkColors.onAccent,
  danger: darkColors.danger,
  focusRing: darkColors.borderFocus,
  disabled: darkColors.textTertiary, // Option 1: aliased to textTertiary (#8E9CB2)
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
