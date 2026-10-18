// lib/haptics.ts
// Haptic vocabulary abstraction for Davos Seaworth.
// Enforces rules from the design specification:
// - selectionAsync: changing values (steppers, chips, segmented control)
// - impactAsync(Light/Medium): snap, collision, tactile latch
// - notificationAsync(Success/Warning/Error): task outcomes only
// - BANNED: no haptics on scroll, keystroke, hover, or routine background saves
// - Settings toggle: reads 'davos_haptics_enabled' from AsyncStorage

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

export const HAPTICS_STORAGE_KEY = 'davos_haptics_enabled';

let hapticsEnabledCache = true;

// Initialize cache from AsyncStorage
AsyncStorage.getItem(HAPTICS_STORAGE_KEY)
  .then((val) => {
    if (val !== null) {
      hapticsEnabledCache = val === 'true';
    }
  })
  .catch(() => {
    // Fail safe to enabled
    hapticsEnabledCache = true;
  });

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  hapticsEnabledCache = enabled;
  try {
    await AsyncStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Non-fatal
  }
}

export function isHapticsEnabled(): boolean {
  return hapticsEnabledCache;
}

export async function hapticSelection(): Promise<void> {
  if (!hapticsEnabledCache || Platform.OS === 'web') return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // Non-fatal if unsupported
  }
}

export async function hapticImpactLight(): Promise<void> {
  if (!hapticsEnabledCache || Platform.OS === 'web') return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Non-fatal
  }
}

export async function hapticImpactMedium(): Promise<void> {
  if (!hapticsEnabledCache || Platform.OS === 'web') return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Non-fatal
  }
}

export async function hapticNotifySuccess(): Promise<void> {
  if (!hapticsEnabledCache || Platform.OS === 'web') return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Non-fatal
  }
}

export async function hapticNotifyWarning(): Promise<void> {
  if (!hapticsEnabledCache || Platform.OS === 'web') return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Non-fatal
  }
}

export async function hapticNotifyError(): Promise<void> {
  if (!hapticsEnabledCache || Platform.OS === 'web') return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Non-fatal
  }
}
