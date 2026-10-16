// supabase/functions/_shared/pipeline/classifyReal.ts
// Pipeline stage 2 — real embedding classifier, impure half (TECH-SPEC §6.2–§6.4, D19).
//
// This is the side-effecting cartel: three `config` reads plus one `match_exemplars` RPC
// round. The scoring itself is `composeClassification` in `classify.ts`, which stays pure so
// jest can load it (`_shared/config.ts` touches `Deno.env` at import time).
//
// Stage 2 is non-fatal (§5.1, FR-12): every failure path degrades to the §6.4 D7 block and
// one structured warning. The caller is the one that knows the mode (FR-11, `classifier_mode`)
// and the route (§6.4) — neither is this module's business.

import { getConfigNumber, supabaseService } from "../config.ts";
import {
  composeClassification,
  D7Fallback,
  SET_KINDS,
  type ClassifyThresholds,
  type Classification,
  type ExemplarMatch,
  type SetKind,
} from "./classify.ts";

export interface ClassifyRealOptions {
  /** The message embedding (768-d) — already computed for stage 1, reused here (§5.1). */
  embedding: number[];
  /** `profiles.latest_energy`, present on check-in turns only (§6.1). */
  energy?: number | null;
}

/** `match_exemplars` returns `text` columns; guard before narrowing to the union. */
const KNOWN_KINDS = new Set<string>(SET_KINDS);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stage 2 is non-fatal (§5.1): a config misconfiguration or a failed RPC degrades to
 * `D7Fallback()` plus one structured warning line. The line deliberately carries no
 * `requestId`, so the adapter's `requestId === "embed"` accounting (verify-step11.py's log
 * parse) is unaffected. The distinct `reason` values are what the gates assert on.
 */
function warnFallback(reason: string, detail: string | null): Classification {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      stage: "classify",
      ok: false,
      reason,
      detail,
    }),
  );
  return D7Fallback();
}

/** The three [SPEC] bounds, read concurrently — one round-trip each, all in parallel. */
async function readThresholds(): Promise<ClassifyThresholds> {
  const [quitSignalThreshold, energyExhaustedMax, energyDeterminedMin] = await Promise.all([
    getConfigNumber("quit_signal_threshold"),
    getConfigNumber("energy_exhausted_max"),
    getConfigNumber("energy_determined_min"),
  ]);
  return { quitSignalThreshold, energyExhaustedMax, energyDeterminedMin };
}

/** Map the RPC rows to the lean shape, dropping anything the classifier cannot use. */
function toExemplarMatches(data: unknown): ExemplarMatch[] {
  const rows: ExemplarMatch[] = [];
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const kind = raw.set_kind;
    const label = raw.label;
    const sim = typeof raw.sim === "number" ? raw.sim : Number.NaN;
    if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) continue;
    if (typeof label !== "string" || !Number.isFinite(sim)) continue;
    rows.push({ setKind: kind as SetKind, label, sim });
  }
  return rows;
}

/**
 * Classify one message against the seeded exemplar corpus.
 *
 * Returns the §6.3 block, or the §6.4 D7 block when the thresholds cannot be read or the RPC
 * yields nothing (an empty corpus is a legitimate state — `clear-exemplars`, or before the
 * BG-04 seed lands).
 */
export async function classifyReal(opts: ClassifyRealOptions): Promise<Classification> {
  const { embedding, energy } = opts;

  let thresholds: ClassifyThresholds;
  try {
    thresholds = await readThresholds();
  } catch (err) {
    return warnFallback("thresholds_unreadable", errorMessage(err));
  }

  try {
    const { data, error } = await supabaseService.rpc("match_exemplars", {
      query_embedding: embedding,
    });
    if (error) return warnFallback("match_exemplars_failed", error.message);

    const rows = toExemplarMatches(data);
    if (rows.length === 0) return warnFallback("exemplars_empty", null);

    return composeClassification(rows, energy, thresholds);
  } catch (err) {
    return warnFallback("match_exemplars_threw", errorMessage(err));
  }
}
