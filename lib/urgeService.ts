// lib/urgeService.ts
// Persistent impulse hold state & resolution service.
// Persists active 10-minute hold in AsyncStorage so holds survive app restarts/backgrounding.
// Resolves via logImpulse Edge Function when yielded or logs resistance when held.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logImpulse } from './impulse';
import { logger } from './logger';
import type { UrgeState } from '../domain/daySnapshot';

const URGE_STORAGE_KEY_PREFIX = 'davos.active_urge.';
const HELD_URGES_KEY_PREFIX = 'davos.held_urges.';

export function getUrgeStorageKey(userId: string): string {
  return `${URGE_STORAGE_KEY_PREFIX}${userId}`;
}

export function getHeldUrgesStorageKey(userId: string): string {
  return `${HELD_URGES_KEY_PREFIX}${userId}`;
}

export async function recordHeldUrge(userId: string, trigger: string): Promise<void> {
  if (!userId) return;
  try {
    const key = getHeldUrgesStorageKey(userId);
    const raw = await AsyncStorage.getItem(key);
    const list: { timestamp: number; trigger: string }[] = raw ? JSON.parse(raw) : [];
    list.push({ timestamp: Date.now(), trigger });
    // Keep last 30 days
    const cutoff = Date.now() - 30 * 86_400_000;
    const filtered = list.filter((item) => item.timestamp >= cutoff);
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    logger.warn('chat', 'Failed to record held urge', undefined, err);
  }
}

export async function getHeldUrgesCount(userId: string, sinceMs: number): Promise<number> {
  if (!userId) return 0;
  try {
    const key = getHeldUrgesStorageKey(userId);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return 0;
    const list: { timestamp: number; trigger: string }[] = JSON.parse(raw);
    return list.filter((item) => item.timestamp >= sinceMs).length;
  } catch {
    return 0;
  }
}

export async function loadActiveUrge(userId: string): Promise<UrgeState | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(getUrgeStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UrgeState;
    if (!parsed || typeof parsed.startedAt !== 'number' || typeof parsed.endsAt !== 'number') {
      return null;
    }
    // If time elapsed while app was closed, transition to resolve stage
    if (Date.now() >= parsed.endsAt && parsed.stage === 'hold') {
      return { ...parsed, stage: 'resolve' };
    }
    return parsed;
  } catch (err) {
    logger.warn('chat', 'Failed to load active urge from storage', undefined, err);
    return null;
  }
}

export async function saveActiveUrge(
  userId: string,
  urge: UrgeState | null
): Promise<void> {
  if (!userId) return;
  try {
    const key = getUrgeStorageKey(userId);
    if (!urge) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(urge));
    }
  } catch (err) {
    logger.warn('chat', 'Failed to save active urge to storage', undefined, err);
  }
}

export async function resolveActiveUrge(
  userId: string,
  outcome: 'held' | 'yielded',
  trigger: string
): Promise<{ ok: boolean }> {
  try {
    await saveActiveUrge(userId, null);
    if (outcome === 'held') {
      await recordHeldUrge(userId, trigger);
      return { ok: true };
    }
    if (outcome === 'yielded') {
      const res = await logImpulse('app', trigger);
      return { ok: res.ok };
    }
    return { ok: true };
  } catch (err) {
    logger.error('chat', 'Failed to resolve active urge', undefined, err);
    return { ok: false };
  }
}
