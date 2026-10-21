// supabase/functions/_shared/metrics/runEval.ts
// FP-07 Step 4 — the shared metric-evaluation runner (dispatcher handler + dev-smoke drill).
//
// Refs: FP-07 FR-2, FR-3, FR-6, FR-13; TECH-SPEC §7.9.5, §2.2–2.3, §7.1, §3.4, §11;
//       decisions2 D9 / TECH-SPEC D10, D12.
//
// The pure half (assembly, compliance, point building) stays at the top so jest can load this
// module without Deno shims. The impure half loads `loadGrid` and the service client
// dynamically — importing them at module scope would read `Deno.env` and make the assembly
// tables untestable (the `windows.ts` / `loadGrid.ts` split).
//
// Compliance is the one variable not in `metric_vars_daily`: it must use the frozen server
// grid, expected windows vs answered doings joined on the canonical `checkin_window`. A SQL
// twin would be a third grid implementation (FP-04 NFR-7).

import {
  evaluateFormula,
  validateFormula,
  type FormulaBounds,
  type FormulaVariable,
  type FormulaVars,
} from "./formula.ts";
import { parseFormulaBounds } from "./create.ts";
import {
  localWallToUtcMs,
  windowsForLocalDay,
  type Grid,
} from "../checkin/windows.ts";

export interface MetricVarsRow {
  doings_count?: unknown;
  hours_logged?: unknown;
  energy_avg?: unknown;
  impulse_failures?: unknown;
  journal_positive_mentions?: unknown;
  journal_negative_mentions?: unknown;
  quest_completions?: unknown;
}

export interface MetricVarsAssembly {
  vars: FormulaVars;
  zeroData: FormulaVariable[];
}

export interface MetricEvalMetric {
  id: string;
  name: string;
  formula: unknown;
}

export interface MetricPointRow {
  metric_id: string;
  computed_for: string;
  value: number;
}

export interface SkippedMetric {
  metricId: string;
  name: string;
  reason: string;
}

export interface BuiltMetricPoints {
  points: MetricPointRow[];
  skipped: SkippedMetric[];
}

const VARIABLES: readonly FormulaVariable[] = [
  "doings_count",
  "hours_logged",
  "checkin_compliance_rate",
  "energy_avg",
  "impulse_failures",
  "journal_positive_mentions",
  "journal_negative_mentions",
  "quest_completions",
];

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merge the seven SQL-native variables with the grid-derived compliance. A missing view row
 * (zero-activity day) or a null aggregate coalesces to 0 and is reported in `zeroData`, so the
 * run line can distinguish "no source data" from a real zero.
 */
export function assembleMetricVars(
  row: MetricVarsRow | null,
  compliance: number | null,
  expectedWindows: number,
): MetricVarsAssembly {
  const zeroData: FormulaVariable[] = [];
  const vars: Record<FormulaVariable, number> = {
    doings_count: 0,
    hours_logged: 0,
    checkin_compliance_rate: 0,
    energy_avg: 0,
    impulse_failures: 0,
    journal_positive_mentions: 0,
    journal_negative_mentions: 0,
    quest_completions: 0,
  };

  if (!row) {
    zeroData.push(...VARIABLES);
    return { vars, zeroData };
  }

  for (const key of [
    "doings_count",
    "hours_logged",
    "impulse_failures",
    "journal_positive_mentions",
    "journal_negative_mentions",
    "quest_completions",
  ] as const) {
    const value = num(row[key]);
    if (value === null) {
      zeroData.push(key);
    } else {
      vars[key] = value;
    }
  }

  const energy = num(row.energy_avg);
  if (energy === null) {
    zeroData.push("energy_avg");
  } else {
    vars.energy_avg = energy;
  }

  if (compliance === null || expectedWindows === 0) {
    zeroData.push("checkin_compliance_rate");
  } else {
    vars.checkin_compliance_rate = Math.min(1, Math.max(0, compliance));
  }

  return { vars, zeroData };
}

/** Answered canonical window starts ÷ expected windows; zero expected windows means 0. */
export function complianceFromWindows(
  expectedStarts: readonly number[],
  answeredStarts: Iterable<number>,
): number {
  if (expectedStarts.length === 0) return 0;
  const answered = new Set(answeredStarts);
  let hits = 0;
  for (const start of expectedStarts) {
    if (answered.has(start)) hits += 1;
  }
  return hits / expectedStarts.length;
}

/** Local noon of `YYYY-MM-DD` in the profile timezone — a safe anchor for the grid day. */
export function localDayNoonMs(date: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return localWallToUtcMs(timezone, y, mo, d, 12, 0);
}

/** Gate then evaluate every active metric; non-finite/boolean/invalid results are skipped. */
export function buildMetricPoints(
  metrics: readonly MetricEvalMetric[],
  vars: FormulaVars,
  computedFor: string,
  bounds: FormulaBounds,
): BuiltMetricPoints {
  const points: MetricPointRow[] = [];
  const skipped: SkippedMetric[] = [];

  for (const metric of metrics) {
    const validation = validateFormula(metric.formula, bounds);
    if (!validation.ok) {
      skipped.push({
        metricId: metric.id,
        name: metric.name,
        reason: `gate: ${validation.errors.map((e) => `${e.code}@${e.path}`).join(", ")}`,
      });
      continue;
    }
    let value: number | boolean;
    try {
      value = evaluateFormula(metric.formula, vars, bounds);
    } catch (error) {
      skipped.push({
        metricId: metric.id,
        name: metric.name,
        reason: error instanceof Error ? error.message : "evaluation threw",
      });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      skipped.push({ metricId: metric.id, name: metric.name, reason: "non-finite result" });
      continue;
    }
    points.push({ metric_id: metric.id, computed_for: computedFor, value });
  }

  return { points, skipped };
}

export interface MetricDayReport {
  viewRow: MetricVarsRow | null;
  compliance: number;
  expectedWindows: number;
  answeredWindows: number;
  vars: FormulaVars;
  zeroData: FormulaVariable[];
}

/**
 * Read one user/day's variables. Impure: dynamic imports keep the pure tables above
 * jest-loadable.
 */
export async function readMetricDay(userId: string, computedFor: string): Promise<MetricDayReport> {
  const { supabaseService } = await import("../config.ts");
  const { loadGrid } = await import("../checkin/loadGrid.ts");

  const grid: Grid | null = await loadGrid(userId);
  if (!grid) throw new Error(`metric_eval: no usable grid for user ${userId}`);
  const noonMs = localDayNoonMs(computedFor, grid.timezone);
  if (noonMs === null) throw new Error(`metric_eval: invalid computed_for "${computedFor}"`);

  const expected = windowsForLocalDay(grid, noonMs);
  const expectedStarts = expected.map((w) => w.startMs);

  let answered: number[] = [];
  if (expectedStarts.length > 0) {
    const expectedIso = expectedStarts.map((ms) => new Date(ms).toISOString());
    const { data, error } = await supabaseService
      .from("doings_logs")
      .select("checkin_window")
      .eq("user_id", userId)
      .eq("kind", "doing")
      .in("checkin_window", expectedIso);
    if (error) throw new Error(`metric_eval: answered doings read failed: ${error.message}`);
    answered = (data ?? [])
      .map((row) => Date.parse(row.checkin_window as string))
      .filter((ms) => Number.isFinite(ms));
  }

  const compliance = complianceFromWindows(expectedStarts, answered);

  const { data: viewRow, error: viewError } = await supabaseService
    .from("metric_vars_daily")
    .select(
      "doings_count,hours_logged,energy_avg,impulse_failures,journal_positive_mentions,journal_negative_mentions,quest_completions",
    )
    .eq("user_id", userId)
    .eq("day", computedFor)
    .maybeSingle();
  if (viewError) throw new Error(`metric_eval: metric_vars_daily read failed: ${viewError.message}`);

  const { vars, zeroData } = assembleMetricVars(
    (viewRow as MetricVarsRow | null) ?? null,
    compliance,
    expectedStarts.length,
  );
  return {
    viewRow: (viewRow as MetricVarsRow | null) ?? null,
    compliance,
    expectedWindows: expectedStarts.length,
    answeredWindows: answered.length,
    vars,
    zeroData,
  };
}

export interface MetricEvalReport extends MetricDayReport {
  userId: string;
  computedFor: string;
  disabled: boolean;
  metrics: number;
  evaluated: number;
  pointsWritten: number;
  skipped: SkippedMetric[];
}

/** The shared runner: kill switch, variables, evaluation, upsert, one structured line. */
export async function runMetricEval(
  userId: string,
  computedFor: string,
): Promise<MetricEvalReport> {
  const { getConfig, getConfigBoolean, supabaseService } = await import("../config.ts");

  let enabled = false;
  try {
    enabled = await getConfigBoolean("metric_eval_enabled");
  } catch (error) {
    console.warn(
      `[metric-eval] disabled: ${
        error instanceof Error ? error.message : "metric_eval_enabled read failed"
      }`,
    );
  }

  if (!enabled) {
    // The kill switch is a true no-op: no grid load, no data reads. Report zeroed values.
    console.log(
      `[metric-eval] user=${userId} date=${computedFor} disabled=true metrics=0 points=0 zero_data=none skipped=0`,
    );
    return {
      viewRow: null,
      compliance: 0,
      expectedWindows: 0,
      answeredWindows: 0,
      vars: assembleMetricVars(null, null, 0).vars,
      zeroData: [],
      userId,
      computedFor,
      disabled: true,
      metrics: 0,
      evaluated: 0,
      pointsWritten: 0,
      skipped: [],
    };
  }

  const day = await readMetricDay(userId, computedFor);

  const bounds = parseFormulaBounds(await getConfig("metric_formula_bounds"));
  if (!bounds) throw new Error("metric_eval: config.metric_formula_bounds is missing or malformed");

  const { data: metricRows, error: metricError } = await supabaseService
    .from("metrics")
    .select("id,name,formula")
    .eq("user_id", userId)
    .eq("formula_status", "validated")
    .is("archived_at", null)
    .order("created_at");
  if (metricError) throw new Error(`metric_eval: metrics read failed: ${metricError.message}`);

  const metrics = (metricRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    formula: row.formula as unknown,
  }));
  const built = buildMetricPoints(metrics, day.vars, computedFor, bounds);
  for (const skip of built.skipped) {
    console.warn(
      `[metric-eval] skipped metric=${skip.metricId} name=${JSON.stringify(skip.name)} reason=${skip.reason}`,
    );
  }

  if (built.points.length > 0) {
    const { error: upsertError } = await supabaseService
      .from("metric_points")
      .upsert(built.points, { onConflict: "metric_id,computed_for" });
    if (upsertError) throw new Error(`metric_eval: upsert failed: ${upsertError.message}`);
  }

  console.log(
    `[metric-eval] user=${userId} date=${computedFor} metrics=${metrics.length} points=${built.points.length} zero_data=${
      day.zeroData.join(",") || "none"
    } skipped=${built.skipped.length}`,
  );

  return {
    ...day,
    userId,
    computedFor,
    disabled: false,
    metrics: metrics.length,
    evaluated: built.points.length,
    pointsWritten: built.points.length,
    skipped: built.skipped,
  };
}
