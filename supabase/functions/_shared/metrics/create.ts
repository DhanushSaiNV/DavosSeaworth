// supabase/functions/_shared/metrics/create.ts
// FP-07 Step 3 — the gate-before-persist write path for metrics.
//
// Refs: FP-07 FR-9, FR-10; TECH-SPEC §7.9, §3.4; decisions2 D9 / TECH-SPEC D10.
//
// This is the only function in FP-07 that inserts into `metrics`. The formula is validated
// before any service client is loaded, so a rejected formula can never reach the table — the
// gate is the whole injection surface (§10.4). Bounds are passed in by the call site (which
// reads `metric_formula_bounds` at runtime), never hardcoded here.
//
// The service client is imported dynamically so the pure rejection path stays jest-loadable
// (the `evalContract.ts` / `eval.ts` split, without a second module).

import { validateFormula, type FormulaBounds, type FormulaError } from "./formula.ts";

export interface MetricDraft {
  user_id: string;
  name: string;
  domain: string;
  output_unit: string;
  formula: unknown;
  is_core?: boolean;
  is_quest?: boolean;
  quest_status?: "active" | "completed" | "expired" | "failed" | null;
  quest_deadline?: string | null;
}

export type CreateMetricResult =
  | { ok: true; metricId: string }
  | { ok: false; stage: "validation"; errors: FormulaError[] }
  | { ok: false; stage: "insert"; errors: []; detail: string };

export interface MetricRow extends MetricDraft {
  formula_status: "validated";
}

export type MetricInserter = (
  row: MetricRow,
) => Promise<{ id?: string; error?: { message: string } }>;

/** Parse the three [SPEC] bounds from `config.metric_formula_bounds`; null on any miss. */
export function parseFormulaBounds(raw: unknown): FormulaBounds | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const maxDepth = value.max_depth;
  const maxNodes = value.max_nodes;
  const literalAbsMax = value.literal_abs_max;
  if (
    typeof maxDepth !== "number" ||
    !Number.isFinite(maxDepth) ||
    maxDepth < 1 ||
    typeof maxNodes !== "number" ||
    !Number.isFinite(maxNodes) ||
    maxNodes < 1 ||
    typeof literalAbsMax !== "number" ||
    !Number.isFinite(literalAbsMax) ||
    literalAbsMax < 0
  ) {
    return null;
  }
  return {
    max_depth: maxDepth,
    max_nodes: maxNodes,
    literal_abs_max: literalAbsMax,
  };
}

/**
 * Gate then insert one metric. A validation failure returns the structured errors and does
 * not load a service client; an insert failure returns the database detail. The row is always
 * written as `formula_status='validated'` — `proposed`/`rejected` are reserved for the
 * proposal/manual acceptance flows (FP-07 recorded reading).
 */
export async function insertValidatedMetric(
  draft: MetricDraft,
  bounds: FormulaBounds,
  insertRow?: MetricInserter,
): Promise<CreateMetricResult> {
  const validation = validateFormula(draft.formula, bounds);
  if (!validation.ok) {
    return { ok: false, stage: "validation", errors: validation.errors };
  }

  const row: MetricRow = {
    ...draft,
    formula_status: "validated",
    is_core: draft.is_core ?? false,
    is_quest: draft.is_quest ?? false,
    quest_status: draft.quest_status ?? null,
    quest_deadline: draft.quest_deadline ?? null,
  };

  const insert: MetricInserter = insertRow ?? (async (candidate) => {
    const { supabaseService } = await import("../config.ts");
    const { data, error } = await supabaseService
      .from("metrics")
      .insert(candidate)
      .select("id")
      .single();
    return { id: data?.id as string | undefined, error: error ?? undefined };
  });

  const result = await insert(row);
  if (result.error || !result.id) {
    return {
      ok: false,
      stage: "insert",
      errors: [],
      detail: result.error?.message ?? "metrics insert returned no row",
    };
  }
  return { ok: true, metricId: result.id };
}
