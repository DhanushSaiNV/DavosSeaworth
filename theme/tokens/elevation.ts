// theme/tokens/elevation.ts
// Cross-platform elevation tokens for iOS and Android.

import { ViewStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export interface ElevationTokens {
  none: ViewStyle;
  raised: ViewStyle;
  overlay: ViewStyle;
}

export const getElevation = (colorScheme: ColorScheme): ElevationTokens => {
  const isDark = colorScheme === 'dark';
  const shadowColor = isDark ? '#000000' : '#0F1117';

  return {
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    raised: {
      shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.35 : 0.06,
      shadowRadius: 6,
      elevation: 2,
    },
    overlay: {
      shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.5 : 0.12,
      shadowRadius: 16,
      elevation: 6,
    },
  };
};
