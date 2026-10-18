// lib/theme/ThemeProvider.tsx
// Supplies the active palette to the tree and the two hooks every screen uses:
//
//   const { colors } = useTheme();
//   const styles = useThemedStyles(createStyles);   // createStyles(theme) lives at module scope
//
// The scheme follows the OS (`useColorScheme`); `mode` on the provider is an override hook for a
// future manual toggle, defaulting to "follow the system".
//
// Refs: DESIGN_DECISIONS.md §Stage 2/3.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { palettes, type ColorScheme, type ThemeColors } from './tokens';

export interface Theme {
  scheme: ColorScheme;
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({
  children,
  mode = 'system',
}: {
  children: ReactNode;
  /** `system` follows the OS appearance; the explicit values force a scheme (test/preview). */
  mode?: 'system' | ColorScheme;
}) {
  const system = useColorScheme();
  const scheme: ColorScheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const theme = useMemo<Theme>(
    () => ({ scheme, colors: palettes[scheme], isDark: scheme === 'dark' }),
    [scheme],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    // Fail loudly in development, degrade gracefully in production: a missing provider must never
    // blank the whole app for a real user.
    if (__DEV__) {
      throw new Error('useTheme must be used within a ThemeProvider');
    }
    return { scheme: 'light', colors: palettes.light, isDark: false };
  }
  return theme;
}

/**
 * Memoised theme-dependent stylesheet. `factory` must be a module-level function so the memo keys
 * on the theme alone.
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

/**
 * The OS "reduce motion" switch. Entrances and reveals collapse to an instant state change when it
 * is on; nothing in the app relies on motion to convey state.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {
        // Not supported (web/older runtimes): motion stays on.
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      if (alive) setReduced(value);
    });
    return () => {
      alive = false;
      // `remove()` exists on the subscription; guard for older RN signatures.
      (sub as { remove?: () => void })?.remove?.();
    };
  }, []);

  return reduced;
}
