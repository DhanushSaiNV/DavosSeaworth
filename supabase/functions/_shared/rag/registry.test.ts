// supabase/functions/_shared/rag/registry.test.ts
// The registry is a transcription of the SQL validation branches; this file asserts it stayed one.
//
// Refs: PRD §6.1 (lines 480-610), §14.1 A1/A4/A6; PLAN.md §1.8 D2/D4/D6, §1.9 D7/D8.

import {
  DATASETS,
  REGISTRY,
  RPC_PARAMS,
  SEMANTIC_TOOLS,
  acceptsParam,
  effectiveLimit,
  isDatasetName,
  rpcFor,
  specFor,
} from "./registry.ts";
import type { Bucket, DatasetName, Operation } from "./types.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeNull(): void;
  toBeGreaterThan(expected: number): void;
  toContain(expected: unknown): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

/** Transcribed from the `p_op not in (...)` branches of 0046. */
const EXPECTED_OPS: Record<DatasetName, Operation[]> = {
  checkins: ["list", "count", "aggregate", "timeseries", "latest"],
  impulse_events: ["count", "aggregate", "timeseries", "list"],
  checkin_compliance: ["aggregate", "timeseries"],
  journal: ["count", "aggregate", "timeseries", "list"],
  anchor_plans: ["list", "aggregate", "latest"],
  habits: ["list", "aggregate"],
  metrics_catalog: ["list", "aggregate"],
  metric_series: ["list", "timeseries", "latest", "aggregate"],
  quests: ["list", "aggregate"],
  daily_vars: ["list", "timeseries", "aggregate"],
  conversation: ["count", "aggregate", "timeseries", "list"],
  memory_facts: ["list", "count", "aggregate"],
  schedule_profile: ["read_one"],
  memory_search: ["search"],
  rules_search: ["search"],
};

/** Transcribed from the `p_dimensions <@ array[...]` branches of 0044-0046. */
const EXPECTED_DIMS: Record<DatasetName, string[]> = {
  checkins: ["day", "week", "weekday", "hour_of_day", "source"],
  impulse_events: ["day", "week", "weekday", "hour_of_day", "source"],
  checkin_compliance: ["day", "week", "weekday"],
  journal: ["day", "week", "severity", "habit_flag"],
  anchor_plans: ["day", "kind"],
  habits: ["status", "detected_day"],
  metrics_catalog: ["domain", "formula_status", "is_quest", "quest_status"],
  metric_series: ["day", "week", "metric_id", "domain"],
  quests: ["quest_status", "domain", "deadline_day"],
  daily_vars: ["day", "week", "weekday"],
  conversation: ["day", "hour_of_day", "role", "source"],
  memory_facts: ["fact_type", "created_day"],
  schedule_profile: [],
  memory_search: [],
  rules_search: [],
};

/** Transcribed from the `p_bucket not in (...)` branches. */
const EXPECTED_BUCKETS: Record<DatasetName, Bucket[]> = {
  checkins: ["day", "week"],
  impulse_events: ["day", "week"],
  checkin_compliance: ["day", "week"],
  journal: ["day", "week"],
  anchor_plans: [],
  habits: [],
  metrics_catalog: [],
  metric_series: ["day", "week", "month"],
  quests: [],
  daily_vars: ["day", "week"],
  conversation: ["day", "week"],
  memory_facts: [],
  schedule_profile: [],
  memory_search: [],
  rules_search: [],
};

const ALL: DatasetName[] = [...DATASETS, ...SEMANTIC_TOOLS];

describe("registry shape", () => {
  it("is 13 datasets plus 2 semantic tools, with no duplicates", () => {
    expect(DATASETS.length).toBe(13);
    expect(SEMANTIC_TOOLS).toEqual(["memory_search", "rules_search"]);
    expect(new Set(ALL).size).toBe(15);
    expect(Object.keys(REGISTRY).length).toBe(15);
  });

  it("agrees with the SQL on every operation list", () => {
    for (const dataset of ALL) {
      expect(specFor(dataset).ops).toEqual(EXPECTED_OPS[dataset]);
    }
  });

  it("agrees with the SQL on every dimension list", () => {
    for (const dataset of ALL) {
      expect(specFor(dataset).dimensions).toEqual(EXPECTED_DIMS[dataset]);
    }
  });

  it("agrees with the SQL on every bucket list, and only metric_series has month", () => {
    for (const dataset of ALL) {
      expect(specFor(dataset).buckets).toEqual(EXPECTED_BUCKETS[dataset]);
    }
    expect(specFor("metric_series").buckets).toContain("month");
    expect(specFor("checkins").buckets).not.toContain("month");
    expect(specFor("daily_vars").buckets).not.toContain("month");
  });

  it("maps every declared operation to a real RPC, except checkin_compliance", () => {
    for (const dataset of ALL) {
      const spec = specFor(dataset);
      for (const op of spec.ops) {
        const rpc = rpcFor(dataset, op);
        if (dataset === "checkin_compliance") {
          expect(rpc).toBeNull();
        } else {
          expect(typeof rpc).toBe("string");
          expect(RPC_PARAMS[rpc as string] !== undefined).toBe(true);
        }
      }
    }
  });

  it("isDatasetName accepts the registry and nothing else", () => {
    for (const dataset of ALL) expect(isDatasetName(dataset)).toBe(true);
    expect(isDatasetName("doings")).toBe(false);
    expect(isDatasetName("rules")).toBe(false);
    expect(isDatasetName(null)).toBe(false);
    expect(isDatasetName(42)).toBe(false);
  });
});

describe("registry parameter agreement (D7)", () => {
  it("every range parameter exists on the RPC that will receive it", () => {
    for (const dataset of ALL) {
      const spec = specFor(dataset);
      for (const op of spec.ops) {
        const rpc = rpcFor(dataset, op);
        if (rpc === null) continue;
        for (const range of spec.ranges) {
          expect(acceptsParam(rpc, range.pFrom)).toBe(true);
          expect(acceptsParam(rpc, range.pTo)).toBe(true);
        }
      }
    }
  });

  it("every filter parameter exists on the RPC that will receive it", () => {
    for (const dataset of ALL) {
      const spec = specFor(dataset);
      for (const op of spec.ops) {
        const rpc = rpcFor(dataset, op);
        if (rpc === null) continue;
        for (const filter of spec.filters) {
          expect(acceptsParam(rpc, filter.param)).toBe(true);
        }
      }
    }
  });

  it("p_op is only on the ten query_* functions", () => {
    for (const [rpc, params] of Object.entries(RPC_PARAMS)) {
      expect(params.includes("p_op")).toBe(rpc.startsWith("query_"));
    }
  });

  it("count_memory_facts has neither p_limit nor p_dimensions", () => {
    expect(acceptsParam("count_memory_facts", "p_limit")).toBe(false);
    expect(acceptsParam("count_memory_facts", "p_dimensions")).toBe(false);
    expect(acceptsParam("count_memory_facts", "p_from")).toBe(true);
  });

  it("read_schedule_profile takes no arguments", () => {
    expect(RPC_PARAMS.read_schedule_profile).toEqual([]);
    expect(acceptsParam("read_schedule_profile", "p_op")).toBe(false);
  });
});

describe("registry limits (PRD §14.1 A4/A5, D2)", () => {
  it("caps check-in content at 20 rows and records the 280-char truncation", () => {
    expect(specFor("checkins").contentMaxRows).toBe(20);
    expect(specFor("checkins").payload).toContain("content");
    expect(
      specFor("checkins").limitations?.some((line) => line.includes("280")),
    ).toBe(true);
  });

  it("memory facts list at 50, semantic memory at 5, rules at 20", () => {
    expect(specFor("memory_facts").limitMax).toBe(50);
    expect(specFor("memory_search").limitMax).toBe(5);
    expect(specFor("rules_search").limitMax).toBe(20);
  });

  it("daily_vars is the one 366-day dataset", () => {
    expect(specFor("daily_vars").limitMax).toBe(366);
    expect(specFor("checkins").limitMax).toBe(500);
  });

  it("effectiveLimit clamps latest to 20 and the check-in list to the content cap", () => {
    expect(effectiveLimit(specFor("checkins"), "latest", 500)).toBe(20);
    expect(effectiveLimit(specFor("checkins"), "list", 500)).toBe(20);
    expect(effectiveLimit(specFor("checkins"), "list", 10)).toBe(10);
    expect(effectiveLimit(specFor("journal"), "list", 100)).toBe(100);
    expect(effectiveLimit(specFor("metric_series"), "latest", 100)).toBe(20);
    expect(effectiveLimit(specFor("metric_series"), "timeseries", 100)).toBe(100);
  });
});

describe("registry exclusions (PRD §14.1 A6)", () => {
  const forbidden = ["embedding", "embed_model", "embedding_model", "trust_score", "lockdown_started_at"];

  it("no payload carries a hidden column", () => {
    for (const dataset of ALL) {
      for (const column of specFor(dataset).payload) {
        expect(forbidden.includes(column)).toBe(false);
      }
    }
  });

  it("journal and conversation never expose text", () => {
    expect(specFor("journal").payload).not.toContain("content");
    expect(specFor("conversation").payload).not.toContain("content");
    expect(
      specFor("journal").limitations?.some((line) => line.includes("never returned")),
    ).toBe(true);
  });

  it("metrics_catalog never exposes a formula", () => {
    expect(specFor("metrics_catalog").payload).not.toContain("formula");
    expect(
      specFor("metrics_catalog").limitations?.some((line) => line.includes("never returned")),
    ).toBe(true);
  });

  it("only checkins exposes content, and only capped", () => {
    const withContent = ALL.filter((dataset) => specFor(dataset).payload.includes("content"));
    expect(withContent).toEqual(["checkins"]);
  });
});

describe("registry honest limitations", () => {
  it("states the schedule-history, hours-logged and quest-deadline caveats", () => {
    const compliance = specFor("checkin_compliance").limitations ?? [];
    expect(compliance.some((line) => line.includes("current check-in schedule"))).toBe(true);
    expect(
      specFor("daily_vars").limitations?.some((line) => line.includes("schedule-estimated")),
    ).toBe(true);
    expect(
      specFor("quests").limitations?.some((line) => line.includes("not a completion date")),
    ).toBe(true);
    expect(
      specFor("habits").limitations?.some((line) => line.includes("current state")),
    ).toBe(true);
  });

  it("states the semantic-memory caveats", () => {
    expect(
      specFor("memory_search").limitations?.some((line) => line.includes("not proof of relevance")),
    ).toBe(true);
    expect(
      specFor("rules_search").limitations?.some((line) => line.includes("never evidence")),
    ).toBe(true);
  });
});
