// supabase/functions/_shared/metrics/create.test.ts
// FP-07 Step 3 — gate-before-persist and the config-bounds parser.
// Refs: FP-07 FR-9, FR-10; TECH-SPEC §7.9, §3.4; decisions2 D9 / TECH-SPEC D10.

import {
  insertValidatedMetric,
  parseFormulaBounds,
  type MetricDraft,
  type MetricInserter,
} from "./create.ts";
import type { FormulaBounds } from "./formula.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BOUNDS: FormulaBounds = { max_depth: 6, max_nodes: 30, literal_abs_max: 1000 };

const DRAFT: MetricDraft = {
  user_id: "00000000-0000-0000-0000-000000000000",
  name: "Test",
  domain: "Career",
  output_unit: "count",
  formula: { var: "doings_count" },
};

describe("FP-07 metric create helper", () => {
  it("parses the exact config shape", () => {
    expect(parseFormulaBounds({ max_depth: 6, max_nodes: 30, literal_abs_max: 1000 })).toEqual(
      BOUNDS,
    );
  });

  it("rejects every malformed bounds shape", () => {
    for (const raw of [
      null,
      [],
      {},
      { max_depth: 0, max_nodes: 30, literal_abs_max: 1000 },
      { max_depth: "6", max_nodes: 30, literal_abs_max: 1000 },
      { max_depth: 6, max_nodes: Number.NaN, literal_abs_max: 1000 },
      { max_depth: 6, max_nodes: 30, literal_abs_max: -1 },
    ]) {
      expect(parseFormulaBounds(raw)).toBeNull();
    }
  });

  it("refuses an invalid formula before the inserter is called", async () => {
    let called = false;
    const inserter: MetricInserter = async () => {
      called = true;
      return { id: "should-not-exist" };
    };
    const result = await insertValidatedMetric(
      { ...DRAFT, formula: { reduce: [{ var: "doings_count" }, 0] } },
      BOUNDS,
      inserter,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
      expect(result.errors[0].code).toBe("unknown_operator");
    }
    expect(called).toBe(false);
  });

  it("writes a valid formula as validated and returns the id", async () => {
    let row: Record<string, unknown> | null = null;
    const inserter: MetricInserter = async (candidate) => {
      row = candidate as unknown as Record<string, unknown>;
      return { id: "metric-1" };
    };
    const result = await insertValidatedMetric(DRAFT, BOUNDS, inserter);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metricId).toBe("metric-1");
    expect(row?.formula_status).toBe("validated");
    expect(row?.is_core).toBe(false);
    expect(row?.is_quest).toBe(false);
  });

  it("returns the insert error instead of throwing", async () => {
    const result = await insertValidatedMetric(DRAFT, BOUNDS, async () => ({
      error: { message: "db down" },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("insert");
      expect(result.detail).toBe("db down");
    }
  });
});
