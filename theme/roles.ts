// theme/roles.ts
// Semantic role mappings from PRD §12 and design/DESIGN.md §9 (TOKEN MAP).
// Aliases of existing tokens in theme/tokens/ for light and dark schemes.

import { darkColors, lightColors, type ThemeColors } from './tokens/colors';
import { typography } from './tokens/typography';

export { radius, spacing, touchTarget } from './tokens/spacing';

export interface ColorRoles extends ThemeColors {
  divider: string;
  controlBorder: string;
  brandAmber: string;
  focusRing: string;
  disabled: string;
}

export interface TypeRoles {
  davosVoice: typeof typography.bodyMedium;
  userText: typeof typography.body;
  meta: typeof typography.caption;
  figure: typeof typography.figure;
  figureLarge: typeof typography.figureLarge;
  heading: typeof typography.heading;
  title: typeof typography.title;
}

export const lightColorRoles: ColorRoles = {
  ...lightColors,
  divider: lightColors.borderSubtle,
  controlBorder: lightColors.textTertiary, // #596A82, clears >= 3:1 on light surface (5.33:1)
  brandAmber: lightColors.lantern, // #A76505 from amberRamp, clears >= 3:1 on light surface (4.50:1)
  focusRing: lightColors.borderFocus,
  disabled: lightColors.textTertiary, // Aliased to textTertiary (#596A82)
};

export const darkColorRoles: ColorRoles = {
  ...darkColors,
  divider: darkColors.borderSubtle,
  controlBorder: darkColors.textTertiary, // #8E9CB2, clears >= 3:1 on dark surface (6.01:1)
  brandAmber: darkColors.lantern, // #E2A63B from amberRamp, clears >= 3:1 on dark surface (7.76:1)
  danger: darkColors.dangerText, // Next lighter/higher contrast token in dangerRamp (#F87171), clears >= 4.5:1 on dark surface (6.04:1)
  focusRing: darkColors.borderFocus,
  disabled: darkColors.textTertiary, // Aliased to textTertiary (#8E9CB2)
};

export const typeRoles: TypeRoles = {
  davosVoice: typography.bodyMedium,
  userText: typography.body,
  meta: typography.caption,
  figure: typography.figure,
  figureLarge: typography.figureLarge,
  heading: typography.heading,
  title: typography.title,
};

export const colorRoles = {
  light: lightColorRoles,
  dark: darkColorRoles,
};
