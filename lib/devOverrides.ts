// lib/devOverrides.ts
// Dev-only tier/domain forcer for FP-02 Step 6 (FR-7, FR-10): lets the owner pin the
// classifier's confidence band and/or domain so every tier can be exercised on a real
// device. Stored on the device (AsyncStorage), read back by the composer, which attaches
// it to the `send-message` payload as `dev_force`.
//
// DEV-ONLY SURFACE (AGENTS.md §2): two independent gates must both be open before the
// forcer is rendered or attached — a dev build (`__DEV__`) and the runtime
// `dev_overrides_enabled` config flag. The server re-checks the flag itself, so a
// production build that skipped the client gate still cannot force anything.
//
// Refs: FP-02 FR-7, FR-10, FR-11; TECH-SPECS §5.3, §11; AGENTS.md §2.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { logger } from "./logger";

/** Tiers the forcer can pin, matching `send-message`'s `dev_force` vocabulary. */
export type DevForceTier = "none" | "high" | "medium" | "low" | "fallback";

export const DEV_FORCE_TIERS: readonly DevForceTier[] = [
  "none",
  "high",
  "medium",
  "low",
  "fallback",
];

export interface DevOverrides {
  /** `none` = derive the band normally. */
  tier: DevForceTier;
  /** Classifier domain override; `""` = no override. */
  domain: string;
}

export interface DevForcePayload {
  tier?: string;
  domain?: string;
}

const STORAGE_KEY = "davos.dev_overrides.v1";

const NONE: DevOverrides = { tier: "none", domain: "" };

let current: DevOverrides = NONE;
let loaded = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: DevOverrides): void {
  current = next;
  for (const listener of listeners) listener();
}

/**
 * Pure: accept only a known tier and a string domain. Anything else (corrupt or
 * hand-edited storage) degrades to "no override" rather than throwing on app start.
 */
export function parseDevOverrides(raw: unknown): DevOverrides {
  if (!raw || typeof raw !== "object") return NONE;
  const o = raw as Record<string, unknown>;
  const tier =
    typeof o.tier === "string" && (DEV_FORCE_TIERS as readonly string[]).includes(o.tier)
      ? (o.tier as DevForceTier)
      : "none";
  const domain = typeof o.domain === "string" ? o.domain.trim() : "";
  return { tier, domain };
}

/** True when anything is actually pinned. */
export function isDevOverridesActive(overrides: DevOverrides): boolean {
  return overrides.tier !== "none" || overrides.domain.length > 0;
}

/**
 * Pure: the `dev_force` object `send-message` accepts, or null. Null when the surface is
 * off, or when nothing is pinned — a `tier: "none"` placeholder is never sent, so an
 * ordinary turn can never look like an override request.
 */
export function devForcePayload(
  overrides: DevOverrides,
  enabled: boolean,
): DevForcePayload | null {
  if (!enabled) return null;
  const payload: DevForcePayload = {};
  if (overrides.tier !== "none") payload.tier = overrides.tier;
  if (overrides.domain.length > 0) payload.domain = overrides.domain;
  return Object.keys(payload).length > 0 ? payload : null;
}

/** Read the stored override once. A read failure leaves the forcer at "none". */
export async function loadDevOverrides(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    emit(raw ? parseDevOverrides(JSON.parse(raw) as unknown) : NONE);
    loaded = true;
  } catch (err) {
    // Never block the app on a dev-only preference.
    logger.warn("dev", "devOverrides load failed", undefined, err);
  }
}

/** Merge and persist a change. The value is validated by `parseDevOverrides`. */
export async function setDevOverrides(next: Partial<DevOverrides>): Promise<void> {
  const merged = parseDevOverrides({ ...current, ...next });
  emit(merged);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (err) {
    logger.warn("dev", "devOverrides persist failed", undefined, err);
  }
}

export function getDevOverrides(): DevOverrides {
  return current;
}

/** Reactive read for the composer and the settings forcer. */
export function useDevOverrides(): DevOverrides {
  return useSyncExternalStore(subscribe, getDevOverrides, getDevOverrides);
}

/** Test helper: forget the cache and subscribers. */
export function resetDevOverridesForTests(): void {
  current = NONE;
  loaded = false;
  listeners.clear();
}
