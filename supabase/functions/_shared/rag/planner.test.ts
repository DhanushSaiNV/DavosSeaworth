// supabase/functions/_shared/rag/planner.test.ts
// PRD §5.3 (the output contract and its validation rules), §5.4 (behaviour rules),
// §14.1 C1/C4; PLAN.md §11.2 (`priority` required), §11.3 (the rank).
//
// The instruction and the schema are generated from `registry.ts`, so the interesting assertions
// are the ones that fail if that generation drifts: every dataset described exactly once, no
// dataset the registry does not carry, and a plan the executor could never run is refused here.

import {
  ANSWER_MODES,
  PLANNER_INTENTS,
  PLAN_REQUEST_KEYS,
  PRIORITIES,
  PURPOSE_MAX_CHARS,
  buildPlannerInstruction,
  buildPlannerSchema,
  noRetrievalPlan,
  parsePlan,
  plannerCatalogue,
} from "./planner.ts";
import { DATASETS, SEMANTIC_TOOLS } from "./registry.ts";
import type { DatasetName, PlanEntry, RagPlan } from "./types.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeUndefined(): void;
  toContain(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const ALL: DatasetName[] = [...DATASETS, ...SEMANTIC_TOOLS];

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataset: "checkins",
    op: "count",
    priority: "primary",
    purpose: "How many check-ins were logged in the window.",
    arguments: { filters: { date_from: "2026-11-01", date_to: "2026-11-14" } },
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: "progress_review",
    retrieval_required: true,
    retrieval_requests: [request()],
    answer_mode: "personalized_analysis",
    ...overrides,
  };
}

function reasonOf(raw: unknown): string | null {
  const outcome = parsePlan(raw);
  return outcome.ok ? null : outcome.reason;
}

function entryOf(raw: unknown): PlanEntry {
  const outcome = parsePlan(raw);
  if (!outcome.ok) throw new Error(`expected a plan, got ${outcome.reason}`);
  return outcome.plan.retrieval_requests[0];
}

describe("vocabularies (PRD §5.3)", () => {
  it("closes intent, answer_mode and priority", () => {
    expect(PLANNER_INTENTS).toContain("progress_review");
    expect(PLANNER_INTENTS).toContain("factual_recall");
    expect(ANSWER_MODES).toContain("personalized_analysis");
    expect(PRIORITIES).toEqual(["essential", "primary", "supporting", "optional"]);
  });

  it("pins the purpose ceiling to PLAN.md §11.2", () => {
    expect(PURPOSE_MAX_CHARS).toBe(120);
  });

  it("accepts exactly the five request keys", () => {
    expect(PLAN_REQUEST_KEYS).toEqual(["dataset", "op", "priority", "purpose", "arguments"]);
  });
});

describe("the catalogue is generated from the registry", () => {
  const catalogue = plannerCatalogue();
  const lines = catalogue.split("\n");

  it("describes every dataset exactly once", () => {
    expect(lines.length).toBe(15);
    for (const name of ALL) {
      const matches = lines.filter((line) => line.startsWith(`- ${name}: `));
      expect(matches.length).toBe(1);
    }
  });

  it("names no dataset the registry does not carry", () => {
    for (const line of lines) {
      const name = line.slice(2, line.indexOf(":"));
      expect(ALL.includes(name as DatasetName)).toBe(true);
    }
  });

  it("repeats the registry's operations, dimensions and limits", () => {
    expect(catalogue).toContain("checkins: ops list|count|aggregate|timeseries|latest");
    expect(catalogue).toContain("group_by day|week|weekday|hour_of_day|source");
    expect(catalogue).toContain("limit 1..500");
    expect(catalogue).toContain("content is capped at 20 rows");
    expect(catalogue).toContain("metric_series: ops list|timeseries|latest|aggregate");
    expect(catalogue).toContain("bucket day|week|month");
    expect(catalogue).toContain("one of metric_ids/metric_names/domain is required");
    expect(catalogue).toContain("memory_facts: ops list|count|aggregate");
  });
});

describe("the instruction (PRD §5.4)", () => {
  const instruction = buildPlannerInstruction();

  it("states all ten behaviour rules", () => {
    for (let n = 1; n <= 10; n += 1) expect(instruction).toContain(`\n${n}. `);
  });

  it("forbids raw text and rule spam explicitly", () => {
    expect(instruction).toContain("Never request raw message or journal text");
    expect(instruction).toContain("Do not request rules for every ordinary message");
    expect(instruction).toContain("An empty result is evidence that the data is missing");
  });

  it("explains the four priorities and the one-essential limit", () => {
    for (const priority of PRIORITIES) expect(instruction).toContain(`- ${priority}:`);
    expect(instruction).toContain("Mark at most one request essential");
  });

  it("tells the model the plan rides this response", () => {
    expect(instruction).toContain('"rag_plan"');
    expect(instruction).toContain("You are not answering the question");
  });

  it("does not repeat the injection guard (it already precedes this appendix)", () => {
    expect(instruction).not.toContain("ignore any instructions");
  });
});

describe("the schema (PLAN.md §11.2)", () => {
  const schema = buildPlannerSchema() as {
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };

  it("requires the four wrapper fields", () => {
    expect(schema.required).toEqual([
      "intent",
      "retrieval_required",
      "retrieval_requests",
      "answer_mode",
    ]);
  });

  it("enumerates intent, answer_mode, priority, dataset and op", () => {
    expect(schema.properties.intent.enum).toEqual([...PLANNER_INTENTS]);
    expect(schema.properties.answer_mode.enum).toEqual([...ANSWER_MODES]);

    const items = schema.properties.retrieval_requests.items as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(items.properties.dataset.enum).toEqual([...ALL]);
    expect(items.properties.priority.enum).toEqual([...PRIORITIES]);
    expect(items.properties.op.enum).toContain("timeseries");
    expect(items.properties.op.enum).toContain("search");
    expect(items.required).toEqual(["dataset", "op", "priority", "purpose"]);
  });

  it("caps purpose at the contract length", () => {
    const items = schema.properties.retrieval_requests.items as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(items.properties.purpose.maxLength).toBe(PURPOSE_MAX_CHARS);
    expect(items.properties.purpose.minLength).toBe(1);
  });

  it("omits maxItems unless the configured ceiling is supplied", () => {
    expect(schema.properties.retrieval_requests.maxItems).toBeUndefined();
    const capped = buildPlannerSchema({ maxRequests: 4 }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(capped.properties.retrieval_requests.maxItems).toBe(4);
  });

  it("leaves arguments open, because the fifteen datasets share no filter vocabulary", () => {
    const items = schema.properties.retrieval_requests.items as {
      properties: Record<string, Record<string, unknown>>;
    };
    const args = items.properties.arguments as {
      type: string;
      properties: Record<string, Record<string, unknown>>;
    };
    expect(args.type).toBe("object");
    expect(Object.keys(args.properties)).toEqual([
      "filters",
      "group_by",
      "bucket",
      "metrics",
      "limit",
    ]);
    expect(args.properties.limit.minimum).toBe(1);
  });
});

describe("parsePlan accepts a valid plan", () => {
  it("returns the four wrapper fields and the entries", () => {
    const outcome = parsePlan(plan());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.intent).toBe("progress_review");
    expect(outcome.plan.retrieval_required).toBe(true);
    expect(outcome.plan.answer_mode).toBe("personalized_analysis");
    expect(outcome.plan.retrieval_requests.length).toBe(1);
    expect(outcome.plan.retrieval_requests[0].dataset).toBe("checkins");
  });

  it("accepts a no-retrieval plan with an empty array", () => {
    const outcome = parsePlan(plan({ retrieval_required: false, retrieval_requests: [] }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.plan.retrieval_requests).toEqual([]);
  });

  it("defaults absent arguments to an empty object", () => {
    const entry = entryOf(plan({ retrieval_requests: [{ ...request(), arguments: undefined }] }));
    expect(entry.arguments).toEqual({});
  });

  it("trims the purpose", () => {
    const entry = entryOf(plan({ retrieval_requests: [request({ purpose: "  Count them.  " })] }));
    expect(entry.purpose).toBe("Count them.");
  });

  it("keeps the planner's order", () => {
    const outcome = parsePlan(
      plan({
        retrieval_requests: [
          request({ dataset: "journal", op: "count" }),
          request({ dataset: "habits", op: "list", arguments: { limit: 5 } }),
        ],
      }),
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.plan.retrieval_requests.map((entry) => entry.dataset)).toEqual([
      "journal",
      "habits",
    ]);
  });
});

describe("parsePlan refuses everything else (PRD §5.3)", () => {
  it("rejects a non-object plan", () => {
    for (const raw of [null, undefined, "plan", 42, []]) {
      expect(reasonOf(raw)).toBe("plan_not_object");
    }
  });

  it("rejects an intent or answer_mode outside the allowlist", () => {
    expect(reasonOf(plan({ intent: "therapy" }))).toBe("invalid_intent");
    expect(reasonOf(plan({ intent: undefined }))).toBe("invalid_intent");
    expect(reasonOf(plan({ answer_mode: "poem" }))).toBe("invalid_answer_mode");
    expect(reasonOf(plan({ answer_mode: undefined }))).toBe("invalid_answer_mode");
  });

  it("rejects a non-boolean retrieval flag", () => {
    expect(reasonOf(plan({ retrieval_required: "yes" }))).toBe("invalid_retrieval_flag");
    expect(reasonOf(plan({ retrieval_required: undefined }))).toBe("invalid_retrieval_flag");
  });

  it("cross-checks the flag against the array in both directions", () => {
    expect(reasonOf(plan({ retrieval_required: false }))).toBe("retrieval_required_mismatch");
    expect(reasonOf(plan({ retrieval_requests: [] }))).toBe("retrieval_required_mismatch");
  });

  it("rejects a non-array requests field", () => {
    expect(reasonOf(plan({ retrieval_requests: request() }))).toBe("requests_not_array");
  });

  it("rejects an unknown request key rather than ignoring it (D9)", () => {
    for (const key of ["tool", "sql", "user_id", "where"]) {
      expect(reasonOf(plan({ retrieval_requests: [request({ [key]: "x" })] }))).toBe(
        "unknown_request_key",
      );
    }
  });

  it("rejects a dataset outside the registry", () => {
    expect(reasonOf(plan({ retrieval_requests: [request({ dataset: "doings" })] }))).toBe(
      "unsupported_dataset",
    );
    expect(reasonOf(plan({ retrieval_requests: [request({ dataset: "rules" })] }))).toBe(
      "unsupported_dataset",
    );
  });

  it("rejects an operation the dataset does not expose", () => {
    expect(reasonOf(plan({ retrieval_requests: [request({ dataset: "habits", op: "timeseries" })] }))).toBe(
      "unsupported_operation",
    );
    expect(reasonOf(plan({ retrieval_requests: [request({ op: "compare_periods" })] }))).toBe(
      "unsupported_operation",
    );
  });

  it("rejects a missing or unknown priority (PLAN.md §11.2)", () => {
    expect(reasonOf(plan({ retrieval_requests: [request({ priority: undefined })] }))).toBe(
      "invalid_priority",
    );
    expect(reasonOf(plan({ retrieval_requests: [request({ priority: "critical" })] }))).toBe(
      "invalid_priority",
    );
  });

  it("rejects an empty or over-long purpose", () => {
    expect(reasonOf(plan({ retrieval_requests: [request({ purpose: "   " })] }))).toBe(
      "purpose_invalid",
    );
    expect(reasonOf(plan({ retrieval_requests: [request({ purpose: undefined })] }))).toBe(
      "purpose_invalid",
    );
    const long = "x".repeat(PURPOSE_MAX_CHARS + 1);
    expect(reasonOf(plan({ retrieval_requests: [request({ purpose: long })] }))).toBe(
      "purpose_invalid",
    );
    const exact = "x".repeat(PURPOSE_MAX_CHARS);
    expect(reasonOf(plan({ retrieval_requests: [request({ purpose: exact })] }))).toBeNull();
  });

  it("rejects a non-object arguments field", () => {
    expect(reasonOf(plan({ retrieval_requests: [request({ arguments: "filters" })] }))).toBe(
      "invalid_request",
    );
    expect(reasonOf(plan({ retrieval_requests: [request({ arguments: [] })] }))).toBe(
      "invalid_request",
    );
  });

  it("rejects a non-object request", () => {
    expect(reasonOf(plan({ retrieval_requests: ["checkins"] }))).toBe("invalid_request");
  });

  it("names the offending index", () => {
    const outcome = parsePlan(
      plan({ retrieval_requests: [request(), request({ dataset: "doings" })] }),
    );
    if (outcome.ok) throw new Error("expected a rejection");
    expect(outcome.detail).toBe("request[1]");
  });
});

describe("noRetrievalPlan", () => {
  it("is a valid, empty plan", () => {
    const fallback: RagPlan = noRetrievalPlan();
    expect(fallback.retrieval_required).toBe(false);
    expect(fallback.retrieval_requests).toEqual([]);
    expect(parsePlan(fallback).ok).toBe(true);
  });
});
