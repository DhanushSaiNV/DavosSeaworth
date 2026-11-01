// theme/index.ts
// Davos Design System — Core Tokens, Roles & Theme Engine
// Re-lit Dark Mode, OKLCH Ramps, 8dp Grid, System Typography, Restrained Motion

import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useColorScheme, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ThemeColors,
  lightColors,
  darkColors,
  neutralRamp,
  amberRamp,
  successRamp,
  warningRamp,
  dangerRamp,
  infoRamp,
} from './tokens/colors';
import { typography, tabularNums, type TypographyRole } from './tokens/typography';
import { spacing, radius, touchTarget, opticalOverrides, type SpacingKey, type RadiusKey } from './tokens/spacing';
import { motion, type MotionTokens } from './tokens/motion';
import { getElevation, type ElevationTokens, type ColorScheme } from './tokens/elevation';
import { iconOpticalOverrides } from './tokens/alignment-overrides/iconOverrides';
import { colorRoles, type ColorRoles, typeRoles, type TypeRoles } from './roles';

export type { ColorScheme, ThemeColors, SpacingKey, RadiusKey, TypographyRole, ElevationTokens, MotionTokens, ColorRoles, TypeRoles };
export {
  lightColors,
  darkColors,
  neutralRamp,
  amberRamp,
  successRamp,
  warningRamp,
  dangerRamp,
  infoRamp,
  typography,
  tabularNums,
  spacing,
  radius,
  touchTarget,
  opticalOverrides,
  motion,
  getElevation,
  iconOpticalOverrides,
  colorRoles,
  typeRoles,
};

export type AppearancePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'davos_theme_appearance';

export interface Theme {
  colors: ColorRoles;
  roles: ColorRoles;
  rawColors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  typeRoles: typeof typeRoles;
  elevation: ElevationTokens;
  motion: typeof motion;
  touchTarget: typeof touchTarget;
  isDark: boolean;
  colorScheme: 'light' | 'dark';
  appearance: AppearancePreference;
  setAppearance: (pref: AppearancePreference) => Promise<void>;
}

export function getTheme(scheme: ColorScheme | ColorSchemeName | null | undefined): Theme {
  const isDark = scheme === 'dark';
  const colorScheme: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const rawColors = isDark ? darkColors : lightColors;
  const roles = colorRoles[colorScheme];

  return {
    colors: roles,
    roles,
    rawColors,
    spacing,
    radius,
    typography,
    typeRoles,
    elevation: getElevation(colorScheme),
    motion,
    touchTarget,
    isDark,
    colorScheme,
    appearance: 'system',
    setAppearance: async () => {},
  };
}

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<AppearancePreference>('system');

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (!isMounted) return;
        if (saved === 'system' || saved === 'light' || saved === 'dark') {
          setAppearanceState(saved);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const setAppearance = async (next: AppearancePreference) => {
    setAppearanceState(next);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
  };

  const resolvedScheme: 'light' | 'dark' = useMemo(() => {
    if (appearance === 'system') {
      return systemScheme === 'dark' ? 'dark' : 'light';
    }
    return appearance;
  }, [appearance, systemScheme]);

  const value = useMemo<Theme>(() => {
    const isDark = resolvedScheme === 'dark';
    const rawColors = isDark ? darkColors : lightColors;
    const roles = colorRoles[resolvedScheme];

    return {
      colors: roles,
      roles,
      rawColors,
      spacing,
      radius,
      typography,
      typeRoles,
      elevation: getElevation(resolvedScheme),
      motion,
      touchTarget,
      isDark,
      colorScheme: resolvedScheme,
      appearance,
      setAppearance,
    };
  }, [resolvedScheme, appearance]);

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  const systemScheme = useColorScheme();

  if (context) {
    return context;
  }

  // Graceful fallback if called outside ThemeProvider (e.g. isolated test)
  return getTheme(systemScheme);
}

export function ThemeOverride({ scheme, children }: { scheme: 'light' | 'dark'; children: ReactNode }) {
  const value = useMemo(() => getTheme(scheme), [scheme]);
  return React.createElement(ThemeContext.Provider, { value }, children);
}

