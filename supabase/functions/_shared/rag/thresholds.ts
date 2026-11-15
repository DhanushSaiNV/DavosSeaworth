// supabase/functions/_shared/rag/thresholds.ts
// P2 — semantic thresholds are calibrated or the source is unavailable. Never zero.
//
// Refs: PRD §6.2 (tool B), §6.3 (tool C), §7.3 ("Unsupported / unavailable"), §14.1 T8;
// PLAN.md §1.5, §10 (the defect this closes), §11.4 (the prompt instruction), §15 gate G1.
//
// The defect: `p_min_similarity double precision default 0.0` meant an uncalibrated project
// silently retrieved "everything" with similarity >= 0. The SQL half removed the default and
// rejects `(0,1]`-outside values with `22023 similarity_threshold_invalid`; this file is the
// TypeScript half, and it fails **closed**: NULL, absent, non-numeric or out-of-range all mean
// the semantic source is `unavailable`, never a fallback threshold.
//
// Pure by design (the `windows.ts` precedent): no config read, no client. `dispatch.ts` reads the
// two rows and hands them here, which is also what lets `thresholds.test.ts` run under jest.

import type { ThresholdOutcome } from "./types.ts";

/** The two `config` keys of PLAN.md §10. Created NULL by `0042`. */
export const THRESHOLD_KEYS = {
  rules: "rag_rules_min_similarity",
  memory: "rag_memory_min_similarity",
} as const;

export type ThresholdSource = keyof typeof THRESHOLD_KEYS;

/**
 * One `config.value` (jsonb, so it arrives as whatever `JSON.parse` gives: `null`, a number, a
 * numeric string, or something malformed) → a usable threshold or the typed refusal.
 *
 * Accepted: a finite number in `(0, 1]`, or a string that parses to one. The SQL uses the same
 * open lower bound, so `0` is uncalibrated here exactly as it is invalid there.
 */
export function parseThreshold(raw: unknown): ThresholdOutcome {
  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string" && raw.trim().length > 0) {
    value = Number(raw);
  } else {
    return { ok: false, reason: "threshold_uncalibrated" };
  }
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    return { ok: false, reason: "threshold_uncalibrated" };
  }
  return { ok: true, value };
}

/**
 * Both thresholds from the `config` rows. A missing key is the same as a NULL one: unavailable.
 * Rows are accepted in any order and with duplicates (last wins) because the caller's query may
 * select more keys than these two.
 */
export function resolveThresholds(
  rows: ReadonlyArray<{ key: string; value: unknown }>,
): Record<ThresholdSource, ThresholdOutcome> {
  const byKey = new Map<string, unknown>();
  for (const row of rows) byKey.set(row.key, row.value);
  return {
    rules: parseThreshold(byKey.get(THRESHOLD_KEYS.rules)),
    memory: parseThreshold(byKey.get(THRESHOLD_KEYS.memory)),
  };
}

/** True when both semantic tools are calibrated — the precondition of gate G1 (PLAN.md §15). */
export function plannerThresholdsReady(
  resolved: Record<ThresholdSource, ThresholdOutcome>,
): boolean {
  return resolved.rules.ok && resolved.memory.ok;
}
