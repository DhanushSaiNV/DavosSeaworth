// supabase/functions/_shared/rag/dispatch.test.ts
// PRD §14.1 C1-C7: no-retrieval plans execute nothing, one call per entry, calls run
// concurrently, an invalid plan is rejected before any query, empty results stay empty, a
// failure never escalates to a service-role bypass.
//
// Refs: PRD §5.3 line 369, §14.1 C1-C7; PLAN.md §8.1, §11.3, §12.1.

import { dispatchPlan, trimPlan, type RagClient, type RagRpcResponse } from "./dispatch.ts";
import type { DatasetName, Operation, PlanArguments, PlanEntry, Priority } from "./types.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toMatchObject(expected: Record<string, unknown>): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: (done?: () => void) => void) => void;
declare const expect: (actual: unknown) => Expectation;
declare function setTimeout(fn: () => void, ms: number): unknown;

const RANGE = { date_from: "2026-01-08", date_to: "2026-01-09" };
const NOW_MS = Date.parse("2026-01-10T12:00:00Z");

const PROFILE = {
  timezone: "UTC",
  checkin_cadence_minutes: 60,
  checkin_active_hours_start: "08:00:00",
  checkin_active_hours_end: "12:00:00",
  profile_created_at: "2026-01-01T00:00:00Z",
};

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

interface RecordedCall {
  name: string;
  args?: Record<string, unknown>;
}

type Handler = (name: string, args?: Record<string, unknown>) => RagRpcResponse | Promise<RagRpcResponse>;

function fakeClient(handler: Handler): { client: RagClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: RagClient = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve(handler(name, args));
    },
  };
  return { client, calls };
}

/** The default handler: a valid profile, and no rows for anything else. */
function baseHandler(overrides: Record<string, RagRpcResponse> = {}): Handler {
  return (name) => {
    if (overrides[name]) return overrides[name];
    if (name === "read_schedule_profile") return { data: [PROFILE], error: null };
    return { data: [], error: null };
  };
}

describe("C1 — a no-retrieval plan executes zero tools", () => {
  it("returns an empty bundle and makes no RPC", async () => {
    const { client, calls } = fakeClient(baseHandler());
    const result = await dispatchPlan([], { client, nowMs: NOW_MS });
    expect(calls).toEqual([]);
    expect(result.rejected).toBe(false);
    expect(result.executed).toEqual([]);
    expect(result.bundle.blocks).toEqual([]);
    expect(result.bundle.total_chars).toBe(0);
  });
});

describe("C2 — one valid request executes one query", () => {
  it("reads the profile once and runs the dataset RPC", async () => {
    const { client, calls } = fakeClient(
      baseHandler({
        query_checkins: {
          data: [
            {
              id: "a",
              occurred_at: "2026-01-08T10:00:00Z",
              content: "hi",
              source: "app",
              energy: 5,
              checkin_window: null,
              total_count: 1,
            },
          ],
          error: null,
        },
      }),
    );

    const result = await dispatchPlan(
      [entry("checkins", "list", { limit: 20, filters: RANGE })],
      { client, nowMs: NOW_MS },
    );

    expect(calls.map((call) => call.name)).toEqual(["read_schedule_profile", "query_checkins"]);
    expect(result.rejected).toBe(false);
    expect(result.executed).toHaveLength(1);
    expect(result.bundle.blocks).toHaveLength(1);
    expect(result.bundle.blocks[0].state).toBe("ok");
    expect(result.bundle.blocks[0].row_count).toBe(1);
    expect(result.bundle.blocks[0].timezone).toBe("UTC");
  });

  it("normalises the count_memory_facts scalar into one n row", async () => {
    const { client } = fakeClient(
      baseHandler({ count_memory_facts: { data: 7, error: null } }),
    );
    const result = await dispatchPlan([entry("memory_facts", "count", {})], {
      client,
      nowMs: NOW_MS,
    });
    expect(result.bundle.blocks[0].row_count).toBe(7);
    expect(result.bundle.blocks[0].rows).toEqual([{ n: 7 }]);
  });
});

describe("C3 — independent requests run concurrently", () => {
  it("starts every query before any of them resolves", async () => {
    const started: string[] = [];
    const resolvers: Record<string, (response: RagRpcResponse) => void> = {};

    const { client } = fakeClient((name) => {
      if (name === "read_schedule_profile") return { data: [PROFILE], error: null };
      started.push(name);
      return new Promise<RagRpcResponse>((resolve) => {
        resolvers[name] = resolve;
      });
    });

    const promise = dispatchPlan(
      [
        entry("checkins", "list", { limit: 20, filters: RANGE }),
        entry("journal", "list", { limit: 20, filters: RANGE }),
      ],
      { client, nowMs: NOW_MS },
    );

    await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
    expect(started.sort()).toEqual(["query_checkins", "query_journal_entries"]);

    resolvers.query_checkins({ data: [], error: null });
    resolvers.query_journal_entries({ data: [], error: null });
    await promise;
  });
});

describe("C4 — an invalid plan is rejected before any query", () => {
  it("rejects the whole plan and reads nothing", async () => {
    const { client, calls } = fakeClient(baseHandler());
    const result = await dispatchPlan(
      [
        entry("checkins", "list", { limit: 20, filters: RANGE }),
        entry("journal", "list", { filters: RANGE }), // missing limit
      ],
      { client, nowMs: NOW_MS },
    );

    expect(calls).toEqual([]);
    expect(result.rejected).toBe(true);
    expect(result.executed).toEqual([]);
    expect(result.validation).toEqual([{ dataset: "journal", reason: "limit_required" }]);
    expect(result.bundle.bundle_incomplete).toBe(false);
  });

  it("rejects an unknown dataset and an unknown argument", async () => {
    const { client, calls } = fakeClient(baseHandler());
    const result = await dispatchPlan(
      [
        entry("doings", "list", { limit: 5 }),
        entry("checkins", "list", { limit: 5, filters: RANGE, order: "desc" }),
      ],
      { client, nowMs: NOW_MS },
    );
    expect(calls).toEqual([]);
    expect(result.validation.map((item) => item.reason)).toEqual([
      "unsupported_dataset",
      "unknown_argument",
    ]);
  });
});

describe("C6 — empty results are passed as empty", () => {
  it("never fabricates a row", async () => {
    const { client } = fakeClient(baseHandler());
    const result = await dispatchPlan([entry("habits", "list", { limit: 10 })], {
      client,
      nowMs: NOW_MS,
    });
    const block = result.bundle.blocks[0];
    expect(block.state).toBe("empty");
    expect(block.rows).toEqual([]);
    expect(block.row_count).toBe(0);
  });
});

describe("C7 — a tool failure never escalates", () => {
  it("marks one block unavailable and still runs the other", async () => {
    const { client } = fakeClient(
      baseHandler({
        query_checkins: { data: null, error: { code: "22023", message: "timezone_unavailable" } },
        query_journal_entries: {
          data: [{ id: "j", occurred_at: "2026-01-08T10:00:00Z", entry_date: "2026-01-08", severity: "S3", total_count: 1 }],
          error: null,
        },
      }),
    );

    const result = await dispatchPlan(
      [
        entry("checkins", "list", { limit: 20, filters: RANGE }),
        entry("journal", "list", { limit: 20, filters: RANGE }),
      ],
      { client, nowMs: NOW_MS },
    );

    expect(result.rejected).toBe(false);
    expect(result.bundle.blocks[0].state).toBe("unavailable");
    expect(result.bundle.blocks[0].reason).toBe("timezone_unavailable");
    expect(result.bundle.blocks[1].state).toBe("ok");
  });

  it("turns an uncalibrated semantic source into an unavailable block, not a zero threshold", async () => {
    const { client } = fakeClient(
      baseHandler({
        query_journal_entries: { data: [], error: null },
      }),
    );

    const result = await dispatchPlan(
      [
        entry("memory_search", "search", { limit: 5 }),
        entry("journal", "count", { filters: RANGE }),
      ],
      { client, nowMs: NOW_MS, embedding: [0.1, 0.2] },
    );

    expect(result.rejected).toBe(false);
    expect(result.bundle.blocks[0].state).toBe("unavailable");
    expect(result.bundle.blocks[0].reason).toBe("threshold_uncalibrated");
    expect(result.bundle.blocks[1].state).toBe("empty");
  });
});

describe("compliance dispatch (§8.1)", () => {
  it("reads the profile, reads the answered windows, and builds grid rows", async () => {
    const { client, calls } = fakeClient(
      baseHandler({
        list_answered_windows: {
          data: [{ local_day: "2026-01-08", answered_count: 1, answered_starts: ["2026-01-08T08:00:00Z"] }],
          error: null,
        },
      }),
    );

    const result = await dispatchPlan(
      [entry("checkin_compliance", "timeseries", { filters: RANGE, bucket: "day" })],
      { client, nowMs: NOW_MS },
    );

    expect(calls.map((call) => call.name)).toEqual([
      "read_schedule_profile",
      "list_answered_windows",
    ]);
    const block = result.bundle.blocks[0];
    expect(block.retrieval_method).toBe("sql_grid");
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0]).toMatchObject({ local_day: "2026-01-08", answered: 1, scheduled: 4 });
    expect(block.limitations.some((line) => line.includes("current check-in schedule"))).toBe(true);
  });

  it("makes the block unavailable when the profile read fails", async () => {
    const { client } = fakeClient(
      baseHandler({
        read_schedule_profile: { data: null, error: { code: "22023", message: "timezone_unavailable" } },
      }),
    );
    const result = await dispatchPlan(
      [entry("checkin_compliance", "aggregate", { filters: RANGE })],
      { client, nowMs: NOW_MS },
    );
    expect(result.bundle.blocks[0].state).toBe("unavailable");
    expect(result.bundle.blocks[0].reason).toBe("timezone_unavailable");
  });
});

describe("the request ceiling (PRD line 369)", () => {
  it("trims deterministically by rank and records the trim", async () => {
    const { client } = fakeClient(baseHandler());
    const plan = [
      entry("checkins", "count", { filters: RANGE }, "optional"),
      entry("journal", "count", { filters: RANGE }, "supporting"),
      entry("habits", "list", { limit: 5 }, "primary"),
      entry("quests", "list", { limit: 5 }, "essential"),
    ];

    const result = await dispatchPlan(plan, { client, nowMs: NOW_MS, maxRequests: 2 });

    expect(result.trimmed).toBe(2);
    expect(result.executed.map((item) => item.entry.priority)).toEqual(["primary", "essential"]);
    expect(
      result.bundle.limitations.some((line) => line.includes("request ceiling")),
    ).toBe(true);
  });

  it("keeps planner order after trimming", () => {
    const plan = [
      entry("checkins", "count", { filters: RANGE }, "optional"),
      entry("journal", "count", { filters: RANGE }, "essential"),
      entry("habits", "list", { limit: 5 }, "primary"),
    ];
    const trimmed = trimPlan(plan, 2);
    expect(trimmed.trimmed).toBe(1);
    expect(trimmed.entries.map((item) => item.dataset)).toEqual(["journal", "habits"]);
  });
});
