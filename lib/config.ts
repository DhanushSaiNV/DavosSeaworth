// lib/config.ts
// Client-side reader for the `config` table (AGENTS.md §2: [SPEC] values are read at
// runtime, never hardcoded).
//
// Loaded once per app session (`loadConfig()` from `app/(app)/_layout.tsx`), memoized in
// module scope, then read synchronously. Fail-closed: if the table cannot be read or a
// key is missing, the read throws — it never falls back to a hardcoded default, and the
// composer stays disabled until the configuration is available.
//
// Refs: FP-02 FR-17; TECH-SPECS §11 (registry), §9; D1.

import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

export type ConfigStatus = "idle" | "loading" | "loaded" | "error";

export interface ConfigSnapshot {
  status: ConfigStatus;
  /** Present only when `status === "error"`. */
  error: string | null;
}

const IDLE: ConfigSnapshot = { status: "idle", error: null };
const LOADING: ConfigSnapshot = { status: "loading", error: null };

let snapshot: ConfigSnapshot = IDLE;
let values: Record<string, unknown> | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ConfigSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribeConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getConfigSnapshot(): ConfigSnapshot {
  return snapshot;
}

/** Pure: turn `select key, value` rows into a lookup map. Exported for tests. */
export function parseConfigRows(
  rows: { key: string; value: unknown }[],
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

/** Pure: jsonb numbers arrive as numbers, but tolerate a numeric string. Exported for tests. */
export function coerceConfigNumber(key: string, raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") {
    throw new Error(`config key "${key}" is missing`);
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`config key "${key}" is not numeric`);
  }
  return value;
}

/** Pure: jsonb booleans arrive as booleans; anything else is a misconfiguration. */
export function coerceConfigBoolean(key: string, raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new Error(`config key "${key}" is missing or not a boolean`);
  }
  return raw;
}

/** Retry schedule for the initial load: 3 attempts with 1 s / 2 s / 4 s gaps. */
const MAX_LOAD_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Fetch the whole config table once. Safe to call repeatedly: after a success it is a
 * no-op, while it is in flight it returns the same promise.
 *
 * A transient failure (DNS blip, cold start, brief outage) is retried with exponential
 * backoff before the snapshot becomes `error`; a later call retries from scratch.
 */
export async function loadConfig(): Promise<void> {
  if (values) return;
  if (inflight) return inflight;

  emit(LOADING);
  inflight = (async () => {
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt += 1) {
      try {
        const { data, error } = await supabase.from("config").select("key, value");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          throw new Error("config table returned no rows");
        }
        values = parseConfigRows(data as { key: string; value: unknown }[]);
        inflight = null;
        emit({ status: "loaded", error: null });
        return;
      } catch (err) {
        if (attempt === MAX_LOAD_ATTEMPTS) {
          inflight = null;
          const message = err instanceof Error ? err.message : String(err);
          emit({ status: "error", error: message });
          return;
        }
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  })();

  return inflight;
}

/** Reactive config availability for screens that must not render with defaults. */
export function useConfig(): ConfigSnapshot {
  return useSyncExternalStore(subscribeConfig, getConfigSnapshot, getConfigSnapshot);
}

export function requireConfigNumber(key: string): number {
  if (!values) throw new Error(`config not loaded (cannot read "${key}")`);
  return coerceConfigNumber(key, values[key]);
}

export function requireConfigString(key: string): string {
  if (!values) throw new Error(`config not loaded (cannot read "${key}")`);
  const raw = values[key];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`config key "${key}" is missing or empty`);
  }
  return raw;
}

/**
 * Read a boolean flag (e.g. `dev_overrides_enabled`). Fail-closed: only a real JSON
 * `true` enables the behaviour — anything else throws, so a missing or mistyped key can
 * never silently switch a dev-only surface on.
 */
export function requireConfigBoolean(key: string): boolean {
  if (!values) throw new Error(`config not loaded (cannot read "${key}")`);
  return coerceConfigBoolean(key, values[key]);
}

/** Test helper: forget the cached table and subscribers. */
export function resetConfigStore(): void {
  snapshot = IDLE;
  values = null;
  inflight = null;
  listeners.clear();
}
