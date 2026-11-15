// supabase/functions/_shared/rag/executor.test.ts
// PRD §14.1 A (query validation), T7 (energy), T15's argument half (unknown key, anchor_plans
// dimension `status`). Every assertion names the same typed reason the SQL would raise.
//
// Refs: PRD §6.1, §14.1 A1-A6; PLAN.md §6.2, §6.4, §1.8 D2/D4/D6, §1.9 D9/D11.

import { isUnavailableReason, mapRpcError, validateEntry } from "./executor.ts";
import type {
  DatasetName,
  ExecutorContext,
  ExecutorFailure,
  Operation,
  PlanArguments,
  PlanEntry,
  Priority,
  RpcCall,
} from "./types.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeTruthy(): void;
  toBeNull(): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

function entry(
  dataset: string,
  op: string,
  args: Record<string, unknown> = {},
  priority: Priority = "primary",
): PlanEntry {
  return {
    dataset: dataset as DatasetName,
    op: op as Operation,
    priority,
    purpose: "test",
    arguments: args as PlanArguments,
  };
}

const RANGE = { date_from: "2026-01-01", date_to: "2026-01-10" };
const ctx: ExecutorContext = { todayLocal: "2026-01-10" };
const semanticCtx: ExecutorContext = {
  embedding: [0.1, 0.2, 0.3],
  memoryMinSimilarity: 0.35,
  rulesMinSimilarity: 0.4,
};

function reasonOf(input: PlanEntry, context: ExecutorContext = ctx): ExecutorFailure | null {
  const outcome = validateEntry(input, context);
  return outcome.ok ? null : outcome.reason;
}

function callOf(input: PlanEntry, context: ExecutorContext = ctx): RpcCall {
  const outcome = validateEntry(input, context);
  if (!outcome.ok) throw new Error(`expected a call, got ${outcome.reason}`);
  if (outcome.call.kind !== "rpc") throw new Error("expected an rpc call");
  return outcome.call;
}

describe("A1 — unknown dataset, operation, argument, filter, dimension, metric, enum", () => {
  it("rejects a dataset outside the registry", () => {
    expect(reasonOf(entry("doings", "list", { limit: 5 }))).toBe("unsupported_dataset");
    expect(reasonOf(entry("rules", "list", { limit: 5 }))).toBe("unsupported_dataset");
    expect(reasonOf(entry("", "list", { limit: 5 }))).toBe("unsupported_dataset");
  });

  it("rejects an operation the dataset does not expose", () => {
    expect(reasonOf(entry("habits", "timeseries", { bucket: "day" }))).toBe(
      "unsupported_operation",
    );
    expect(reasonOf(entry("schedule_profile", "list", { limit: 1 }))).toBe(
      "unsupported_operation",
    );
    expect(reasonOf(entry("journal", "latest", { limit: 5 }))).toBe("unsupported_operation");
    expect(reasonOf(entry("checkins", "search", {}))).toBe("unsupported_operation");
  });

  it("rejects unknown argument keys rather than ignoring them (D9)", () => {
    for (const key of ["order", "cursor", "datetime_from", "datetime_to", "offset", "tz"]) {
      expect(reasonOf(entry("checkins", "list", { limit: 5, filters: RANGE, [key]: "x" }))).toBe(
        "unknown_argument",
      );
    }
  });

  it("rejects a filter key the dataset does not declare", () => {
    expect(reasonOf(entry("checkins", "list", { limit: 5, filters: { ...RANGE, mood: ["x"] } }))).toBe(
      "unsupported_filter",
    );
    expect(reasonOf(entry("habits", "list", { limit: 5, filters: { severity: ["S1"] } }))).toBe(
      "unsupported_filter",
    );
  });

  it("rejects a dimension the SQL does not allow (T15: anchor_plans `status`)", () => {
    expect(
      reasonOf(
        entry("anchor_plans", "aggregate", { filters: RANGE, group_by: ["status"] }),
      ),
    ).toBe("unsupported_dimension");
    expect(reasonOf(entry("checkins", "aggregate", { filters: RANGE, group_by: ["month"] }))).toBe(
      "unsupported_dimension",
    );
    expect(
      reasonOf(entry("daily_vars", "aggregate", { filters: RANGE, group_by: ["source"] })),
    ).toBe("unsupported_dimension");
  });

  it("accepts an empty group_by as 'no dimensions'", () => {
    const call = callOf(entry("checkins", "aggregate", { filters: RANGE, group_by: [] }));
    expect(call.args.p_dimensions).toBe(undefined);
  });

  it("rejects an unknown metric selector", () => {
    expect(
      reasonOf(
        entry("checkins", "aggregate", {
          filters: RANGE,
          metrics: [{ op: "sum", field: "content" }],
        }),
      ),
    ).toBe("unsupported_metric");
    expect(
      reasonOf(entry("checkins", "aggregate", { filters: RANGE, metrics: ["median"] })),
    ).toBe("unsupported_metric");
  });

  it("rejects enum values outside the live CHECK domains", () => {
    expect(
      reasonOf(entry("checkins", "list", { limit: 5, filters: { ...RANGE, source: ["sms"] } })),
    ).toBe("invalid_enum_value");
    expect(
      reasonOf(entry("journal", "count", { filters: { ...RANGE, severity: ["S4"] } })),
    ).toBe("invalid_enum_value");
    expect(
      reasonOf(entry("conversation", "count", { filters: { ...RANGE, role: ["system"] } })),
    ).toBe("invalid_enum_value");
    expect(
      reasonOf(entry("habits", "list", { limit: 5, filters: { status: ["gone"] } })),
    ).toBe("invalid_enum_value");
    expect(
      reasonOf(
        entry("metrics_catalog", "list", { limit: 5, filters: { archived_mode: "all" } }),
      ),
    ).toBe("invalid_enum_value");
  });

  it("passes opaque filters through where no CHECK exists (D4)", () => {
    const catalog = callOf(
      entry("metrics_catalog", "list", { limit: 5, filters: { domain: ["made_up"] } }),
    );
    expect(catalog.args.p_domain).toEqual(["made_up"]);

    const conversation = callOf(
      entry("conversation", "count", { filters: { ...RANGE, source: ["custom_surface"] } }),
    );
    expect(conversation.args.p_sources).toEqual(["custom_surface"]);

    const rules = callOf(
      entry("rules_search", "search", { limit: 5, filters: { domain_hints: ["made_up"] } }),
      semanticCtx,
    );
    expect(rules.args.p_domain_hints).toEqual(["made_up"]);
  });

  it("rejects a malformed filter value type", () => {
    expect(
      reasonOf(entry("checkins", "list", { limit: 5, filters: { ...RANGE, source: "app" } })),
    ).toBe("invalid_argument_type");
    expect(
      reasonOf(entry("checkins", "list", { limit: 5, filters: { ...RANGE, energy_min: "5" } })),
    ).toBe("invalid_argument_type");
    expect(
      reasonOf(entry("checkins", "list", { limit: 5, filters: { ...RANGE, has_window: "yes" } })),
    ).toBe("invalid_argument_type");
    expect(
      reasonOf(entry("checkins", "list", { limit: 5, filters: { ...RANGE, source: [] } })),
    ).toBe("invalid_argument_type");
    expect(
      reasonOf(
        entry("metric_series", "list", {
          limit: 5,
          filters: { metric_ids: ["not-a-uuid"] },
        }),
      ),
    ).toBe("invalid_argument_type");
  });

  it("rejects an unsupported bucket, including month outside metric_series", () => {
    expect(
      reasonOf(
        entry("checkins", "timeseries", { filters: RANGE, bucket: "month" }),
      ),
    ).toBe("unsupported_bucket");
    expect(
      reasonOf(entry("metric_series", "timeseries", { filters: { metric_names: ["m"] }, bucket: "month" })),
    ).toBe(null);
    expect(
      reasonOf(entry("checkins", "aggregate", { filters: RANGE, bucket: "day" })),
    ).toBe("unsupported_bucket");
  });
});

describe("A2 — identity, SQL and hidden columns cannot be requested", () => {
  it("rejects user_id, SQL fragments, arbitrary paths and hidden columns as filters", () => {
    for (const key of [
      "user_id",
      "sql",
      "where",
      "select",
      "formula",
      "trust_score",
      "embedding",
      "content",
      "metadata->>source",
    ]) {
      expect(
        reasonOf(entry("journal", "list", { limit: 5, filters: { ...RANGE, [key]: "x" } })),
      ).toBe("unsupported_filter");
    }
  });

  it("rejects a non-object arguments field", () => {
    expect(reasonOf(entry("checkins", "list", [] as unknown as Record<string, unknown>))).toBe(
      "invalid_argument_type",
    );
  });
});

describe("A3 — limits and date ranges", () => {
  it("requires a limit for list and rejects an excessive one", () => {
    expect(reasonOf(entry("journal", "list", { filters: RANGE }))).toBe("limit_required");
    expect(reasonOf(entry("checkins", "list", { limit: 0, filters: RANGE }))).toBe(
      "limit_out_of_range",
    );
    expect(reasonOf(entry("checkins", "list", { limit: 501, filters: RANGE }))).toBe(
      "limit_out_of_range",
    );
    expect(reasonOf(entry("checkins", "list", { limit: 1.5, filters: RANGE }))).toBe(
      "invalid_argument_type",
    );
  });

  it("requires both ends of a range, in order, within 366 days", () => {
    expect(reasonOf(entry("checkins", "count", {}))).toBe("date_range_required");
    expect(reasonOf(entry("checkins", "count", { filters: { date_from: "2026-01-01" } }))).toBe(
      "date_range_incomplete",
    );
    expect(
      reasonOf(entry("checkins", "count", { filters: { date_from: "2026-01-10", date_to: "2026-01-01" } })),
    ).toBe("date_range_inverted");
    expect(
      reasonOf(
        entry("checkins", "count", {
          filters: { date_from: "2026-01-01", date_to: "2027-01-03" },
        }),
      ),
    ).toBe("date_range_too_large");
    expect(
      reasonOf(
        entry("checkins", "count", {
          filters: { date_from: "2026-01-01", date_to: "2027-01-02" },
        }),
        {},
      ),
    ).toBe(null);
  });

  it("rejects a malformed date", () => {
    expect(
      reasonOf(entry("checkins", "count", { filters: { date_from: "2026-02-30", date_to: "2026-03-01" } })),
    ).toBe("invalid_argument_type");
    expect(
      reasonOf(entry("checkins", "count", { filters: { date_from: "01/01/2026", date_to: "2026-01-02" } })),
    ).toBe("invalid_argument_type");
  });

  it("clamps a future range only where the date is timestamp-derived", () => {
    const future = { date_from: "2026-01-01", date_to: "2026-01-11" };
    expect(reasonOf(entry("checkins", "count", { filters: future }))).toBe("date_range_in_future");
    expect(reasonOf(entry("impulse_events", "count", { filters: future }))).toBe(
      "date_range_in_future",
    );
    expect(reasonOf(entry("daily_vars", "list", { limit: 5, filters: future }))).toBe(
      "date_range_in_future",
    );
    expect(reasonOf(entry("conversation", "count", { filters: future }))).toBe(
      "date_range_in_future",
    );
    // Stored calendar dates may point forward.
    expect(reasonOf(entry("journal", "count", { filters: future }))).toBe(null);
    expect(reasonOf(entry("anchor_plans", "list", { limit: 5, filters: future }))).toBe(null);
    expect(
      reasonOf(entry("quests", "list", { limit: 5, filters: { deadline_from: "2026-01-01", deadline_to: "2026-01-11" } })),
    ).toBe(null);
  });

  it("does not apply the future clamp without a server date", () => {
    expect(
      reasonOf(
        entry("checkins", "count", { filters: { date_from: "2026-01-01", date_to: "2026-01-11" } }),
        {},
      ),
    ).toBe(null);
  });
});

describe("A4 — dataset-specific caps", () => {
  it("clamps latest above 20 instead of rejecting it", () => {
    const call = callOf(entry("checkins", "latest", { limit: 500, filters: RANGE }));
    expect(call.args.p_limit).toBe(20);
  });

  it("clamps the check-in list to the 20-row content cap", () => {
    const call = callOf(entry("checkins", "list", { limit: 500, filters: RANGE }));
    expect(call.args.p_limit).toBe(20);
  });

  it("caps the memory-fact list at 50", () => {
    expect(reasonOf(entry("memory_facts", "list", { limit: 51 }))).toBe("limit_out_of_range");
    const call = callOf(entry("memory_facts", "list", { limit: 50 }));
    expect(call.args.p_limit).toBe(50);
  });

  it("caps semantic memory at 5 and rules at 20", () => {
    expect(reasonOf(entry("memory_search", "search", { limit: 6 }), semanticCtx)).toBe(
      "limit_out_of_range",
    );
    expect(reasonOf(entry("rules_search", "search", { limit: 21 }), semanticCtx)).toBe(
      "limit_out_of_range",
    );
  });

  it("caps daily_vars at 366 and rejects a larger limit", () => {
    expect(reasonOf(entry("daily_vars", "list", { limit: 367, filters: RANGE }))).toBe(
      "limit_out_of_range",
    );
    expect(reasonOf(entry("daily_vars", "list", { limit: 366, filters: RANGE }))).toBe(null);
  });
});

describe("A5 — check-in content stays capped", () => {
  it("keeps content in the payload only for checkins, at the 20-row cap", () => {
    const call = callOf(entry("checkins", "list", { limit: 100, filters: RANGE }));
    expect(call.project).toContain("content");
    expect(call.args.p_limit).toBe(20);
  });

  it("never projects journal or conversation text", () => {
    const journal = callOf(entry("journal", "list", { limit: 10, filters: RANGE }));
    expect(journal.project).not.toContain("content");
    const conversation = callOf(entry("conversation", "list", { limit: 10, filters: RANGE }));
    expect(conversation.project).not.toContain("content");
  });
});

describe("A6 — hidden columns and secrets", () => {
  it("never projects formulas, embeddings or trust scores", () => {
    const catalog = callOf(entry("metrics_catalog", "list", { limit: 5 }));
    expect(catalog.project).not.toContain("formula");
    const rules = callOf(entry("rules_search", "search", { limit: 5 }), semanticCtx);
    expect(rules.project).not.toContain("embedding");
    expect(rules.project).not.toContain("embed_model");
    const profile = callOf(entry("schedule_profile", "read_one"));
    expect(profile.project).not.toContain("trust_score");
    expect(profile.project).not.toContain("lockdown_started_at");
  });
});

describe("T7 — energy bounds fail before dispatch", () => {
  it("rejects 0 and 11", () => {
    expect(
      reasonOf(entry("checkins", "count", { filters: { ...RANGE, energy_min: 0 } })),
    ).toBe("energy_out_of_range");
    expect(
      reasonOf(entry("checkins", "count", { filters: { ...RANGE, energy_max: 11 } })),
    ).toBe("energy_out_of_range");
  });

  it("rejects an inverted energy range", () => {
    expect(
      reasonOf(entry("checkins", "count", { filters: { ...RANGE, energy_min: 8, energy_max: 3 } })),
    ).toBe("energy_range_inverted");
    expect(
      reasonOf(entry("checkins", "count", { filters: { ...RANGE, energy_min: 3, energy_max: 8 } })),
    ).toBe(null);
  });
});

describe("T8 — semantic tools never fall back to zero", () => {
  it("requires an embedding", () => {
    expect(reasonOf(entry("memory_search", "search", { limit: 5 }), { memoryMinSimilarity: 0.3 })).toBe(
      "missing_embedding",
    );
  });

  it("treats a missing, zero, negative or above-one threshold as uncalibrated", () => {
    for (const threshold of [null, undefined, 0, -1, 1.5, Number.NaN]) {
      expect(
        reasonOf(entry("memory_search", "search", { limit: 5 }), {
          embedding: [0.1, 0.2],
          memoryMinSimilarity: threshold as number | null | undefined,
        }),
      ).toBe("threshold_uncalibrated");
    }
  });

  it("passes the injected embedding and calibrated threshold through", () => {
    const call = callOf(entry("memory_search", "search", { limit: 5 }), semanticCtx);
    expect(call.args.p_query_embedding).toBe("[0.1,0.2,0.3]");
    expect(call.args.p_min_similarity).toBe(0.35);
    expect(call.args.p_op).toBe(undefined);

    const rules = callOf(entry("rules_search", "search", { limit: 5 }), semanticCtx);
    expect(rules.args.p_min_similarity).toBe(0.4);
  });

  it("rejects a malformed embedding", () => {
    expect(
      reasonOf(entry("memory_search", "search", { limit: 5 }), {
        embedding: "not-a-vector",
        memoryMinSimilarity: 0.3,
      }),
    ).toBe("missing_embedding");
  });
});

describe("D7 — arguments are assembled against the RPC's real parameter list", () => {
  it("sends no p_op to the memory functions", () => {
    const list = callOf(entry("memory_facts", "list", { limit: 10 }));
    expect(list.args.p_op).toBe(undefined);
    expect(list.rpc).toBe("list_memory_facts");

    const count = callOf(entry("memory_facts", "count", { filters: { fact_types: ["chat"] } }));
    expect(count.rpc).toBe("count_memory_facts");
    expect(count.args.p_op).toBe(undefined);
    expect(count.args.p_limit).toBe(undefined);
    expect(count.args.p_fact_types).toEqual(["chat"]);

    const summary = callOf(
      entry("memory_facts", "aggregate", { group_by: ["fact_type"] }),
    );
    expect(summary.rpc).toBe("summarize_memory_facts");
    expect(summary.args.p_dimensions).toEqual(["fact_type"]);
  });

  it("rejects a limit on count_memory_facts and a group_by on count", () => {
    expect(reasonOf(entry("memory_facts", "count", { limit: 10 }))).toBe("unknown_argument");
    expect(reasonOf(entry("memory_facts", "count", { group_by: ["fact_type"] }))).toBe(
      "unsupported_dimension",
    );
  });

  it("sends no arguments at all to read_schedule_profile", () => {
    const call = callOf(entry("schedule_profile", "read_one"));
    expect(call.rpc).toBe("read_schedule_profile");
    expect(call.args).toEqual({});
    expect(reasonOf(entry("schedule_profile", "read_one", { limit: 1 }))).toBe("unknown_argument");
  });
});

describe("metric_series selectors and projections", () => {
  it("requires one of metric_ids, metric_names or domain", () => {
    expect(reasonOf(entry("metric_series", "list", { limit: 5 }))).toBe("metric_selector_required");
    expect(reasonOf(entry("metric_series", "timeseries", { bucket: "day" }))).toBe(
      "metric_selector_required",
    );
    expect(reasonOf(entry("metric_series", "list", { limit: 5, filters: { metric_names: ["m"] } }))).toBe(
      null,
    );
  });

  it("projects the facet and bucket columns the rows actually carry", () => {
    const aggregate = callOf(
      entry("checkins", "aggregate", { filters: RANGE, group_by: ["day"] }),
    );
    expect(aggregate.project).toContain("dimension");
    expect(aggregate.project).toContain("key");

    const series = callOf(
      entry("metric_series", "timeseries", { filters: { metric_names: ["m"] }, bucket: "day" }),
    );
    expect(series.project).toContain("bucket_start");
    expect(series.project).toContain("metric_id");

    const count = callOf(entry("checkins", "count", { filters: RANGE }));
    expect(count.project).toEqual(["n"]);
  });
});

describe("checkin_compliance", () => {
  it("emits a grid call, not an RPC", () => {
    const outcome = validateEntry(
      entry("checkin_compliance", "timeseries", { filters: RANGE, bucket: "week" }),
      ctx,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.call.kind === "compliance") {
      expect(outcome.call.from).toBe("2026-01-01");
      expect(outcome.call.to).toBe("2026-01-10");
      expect(outcome.call.op).toBe("timeseries");
    } else {
      throw new Error("expected a compliance call");
    }
  });

  it("requires a range and rejects a limit", () => {
    expect(reasonOf(entry("checkin_compliance", "aggregate", {}))).toBe("date_range_required");
    expect(
      reasonOf(entry("checkin_compliance", "aggregate", { filters: RANGE, limit: 10 })),
    ).toBe("unknown_argument");
  });
});

describe("SQLSTATE mapping", () => {
  it("maps the contract's own codes to the same typed reasons", () => {
    expect(mapRpcError("42501", "not_authenticated")).toBe("not_authenticated");
    expect(mapRpcError("22023", "timezone_unavailable")).toBe("timezone_unavailable");
    expect(mapRpcError("22023", "range_too_large: 2001 answered windows, cap 2000")).toBe(
      "range_too_large",
    );
    expect(mapRpcError("22023", "grid_unavailable")).toBe("grid_unavailable");
    expect(mapRpcError("22023", "limit_out_of_range")).toBe("invalid_argument_type");
    expect(mapRpcError("42883", "function does not exist")).toBe("invalid_argument_type");
    expect(mapRpcError("XX000", "boom")).toBe("rpc_failed");
    expect(mapRpcError(null, null)).toBe("rpc_failed");
  });

  it("classifies only state failures as unavailable", () => {
    expect(isUnavailableReason("threshold_uncalibrated")).toBe(true);
    expect(isUnavailableReason("timezone_unavailable")).toBe(true);
    expect(isUnavailableReason("range_too_large")).toBe(true);
    expect(isUnavailableReason("unsupported_dataset")).toBe(false);
    expect(isUnavailableReason("limit_required")).toBe(false);
    expect(isUnavailableReason("invalid_enum_value")).toBe(false);
  });
});
