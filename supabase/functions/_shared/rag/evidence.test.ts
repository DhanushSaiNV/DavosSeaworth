// supabase/functions/_shared/rag/evidence.test.ts
// T14 (allocator) and PLAN.md §11.1/§11.4: row_count from count(*), honest `complete`, and a
// deterministic budget that never drops an essential for a lower rank.
//
// Refs: PRD §7.2, §7.4, §14.1 T14; PLAN.md §11.1-§11.4.

import {
  allocateBundle,
  buildEvidenceBlock,
  DEFAULT_EVIDENCE_BUDGET,
  mergeBundles,
} from "./evidence.ts";
import type {
  DatasetName,
  EvidenceBlock,
  EvidenceBundle,
  EvidenceRow,
  Operation,
  PlanArguments,
  PlanEntry,
  Priority,
} from "./types.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toContain(expected: unknown): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeGreaterThan(expected: number): void;
  not: Expectation;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const RANGE = { date_from: "2026-01-01", date_to: "2026-01-10" };

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

function block(
  dataset: DatasetName,
  priority: Priority,
  rows: EvidenceRow[],
  overrides: Partial<EvidenceBlock> = {},
): EvidenceBlock {
  return {
    dataset,
    op: "list",
    retrieval_method: "sql_list",
    priority,
    purpose: "test",
    timezone: "UTC",
    day_basis: "profile_local_day",
    range: { from: "2026-01-01", to: "2026-01-10" },
    row_count: rows.length,
    rows_returned: rows.length,
    complete: true,
    state: rows.length === 0 ? "empty" : "ok",
    limitations: [],
    rows,
    ...overrides,
  };
}

function rows(n: number): EvidenceRow[] {
  return Array.from({ length: n }, (_, i) => ({ local_day: `2026-01-0${(i % 9) + 1}` }));
}

const sizeOf = (value: unknown) => JSON.stringify(value).length;

describe("buildEvidenceBlock — the §11.1 envelope", () => {
  it("takes row_count from total_count, never from rows.length", () => {
    const result = buildEvidenceBlock({
      entry: entry("checkins", "list", { limit: 20, filters: RANGE }),
      timezone: "UTC",
      rows: [
        {
          id: "a",
          occurred_at: "2026-01-02T10:00:00Z",
          content: "hello",
          source: "app",
          energy: 5,
          checkin_window: null,
        },
      ],
      totalCount: 37,
    });

    expect(result.row_count).toBe(37);
    expect(result.rows_returned).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.state).toBe("ok");
    expect(result.limitations.some((line) => line.includes("truncated"))).toBe(true);
  });

  it("is complete when every matching row was returned", () => {
    const result = buildEvidenceBlock({
      entry: entry("journal", "list", { limit: 10, filters: RANGE }),
      timezone: "UTC",
      rows: [{ id: "a", occurred_at: "2026-01-02T10:00:00Z", entry_date: "2026-01-02", severity: "S3" }],
      totalCount: 1,
    });
    expect(result.row_count).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.state).toBe("ok");
  });

  it("marks an empty result empty, not fabricated", () => {
    const result = buildEvidenceBlock({
      entry: entry("habits", "list", { limit: 10 }),
      timezone: "UTC",
      rows: [],
      totalCount: 0,
    });
    expect(result.state).toBe("empty");
    expect(result.row_count).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("marks a failed call unavailable with the typed reason", () => {
    const result = buildEvidenceBlock({
      entry: entry("memory_search", "search", { limit: 5 }),
      timezone: "UTC",
      rows: [],
      failure: "threshold_uncalibrated",
    });
    expect(result.state).toBe("unavailable");
    expect(result.reason).toBe("threshold_uncalibrated");
    expect(result.complete).toBe(false);
    expect(result.row_count).toBe(0);
  });

  it("reads a count from the row's n and keeps the projection honest", () => {
    const result = buildEvidenceBlock({
      entry: entry("checkins", "count", { filters: RANGE }),
      timezone: "UTC",
      rows: [{ n: 42 }],
      totalCount: 1,
    });
    expect(result.row_count).toBe(42);
    expect(result.rows_returned).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.retrieval_method).toBe("sql_count");
    expect(result.rows).toEqual([{ n: 42 }]);
  });

  it("computes coverage from the rows' own dates in the profile zone", () => {
    const result = buildEvidenceBlock({
      entry: entry("checkins", "list", { limit: 20, filters: RANGE }),
      timezone: "America/New_York",
      rows: [
        { id: "a", occurred_at: "2026-01-02T10:00:00Z", content: null, source: "app", energy: 5, checkin_window: null },
        { id: "b", occurred_at: "2026-01-05T10:00:00Z", content: null, source: "app", energy: 6, checkin_window: null },
      ],
      totalCount: 2,
    });
    expect(result.coverage).toEqual({
      requested_days: 10,
      days_with_data: 2,
      first_day_with_data: "2026-01-02",
    });
  });

  it("labels the schedule-estimated hours and the journal text exclusion", () => {
    const daily = buildEvidenceBlock({
      entry: entry("daily_vars", "list", { limit: 10, filters: RANGE }),
      timezone: "UTC",
      rows: [],
      totalCount: 0,
    });
    expect(daily.limitations.some((line) => line.includes("schedule-estimated"))).toBe(true);

    const journal = buildEvidenceBlock({
      entry: entry("journal", "list", { limit: 10, filters: RANGE }),
      timezone: "UTC",
      rows: [],
      totalCount: 0,
    });
    expect(journal.limitations.some((line) => line.includes("never returned"))).toBe(true);
  });

  it("flags metric_series timeseries truncation the SQL cannot report", () => {
    const result = buildEvidenceBlock({
      entry: entry("metric_series", "timeseries", {
        filters: { metric_names: ["focus"], date_from: "2026-01-01", date_to: "2026-12-31" },
        bucket: "day",
      }),
      timezone: "UTC",
      rows: [{ bucket_start: "2026-01-01", key: "focus", n: 1, metric_id: "m" }],
      totalCount: 1,
    });
    expect(result.complete).toBe(false);
    expect(result.limitations.some((line) => line.includes("capped at 60 day points"))).toBe(true);
  });
});

describe("allocateBundle — T14", () => {
  it("omits every essential that cannot fit and forbids all optionals", () => {
    const essentialA = block("checkins", "essential", rows(3));
    const essentialB = block("journal", "essential", rows(3));
    const essentialC = block("habits", "essential", rows(3));
    const optional = block("rules_search", "optional", rows(1));

    const bundle = allocateBundle([essentialA, essentialB, essentialC, optional], 80);

    expect(bundle.omitted_essential).toEqual(["checkins", "journal", "habits"]);
    expect(bundle.bundle_incomplete).toBe(true);
    expect(bundle.blocks).toEqual([]);
    expect(bundle.total_chars).toBe(0);
  });

  it("keeps an essential and drops the optional that would displace it", () => {
    const essential = block("checkins", "essential", rows(2));
    const optional = block("rules_search", "optional", rows(2));

    const bundle = allocateBundle([essential, optional], sizeOf(essential) + 5);

    expect(bundle.blocks.map((item) => item.dataset)).toEqual(["checkins"]);
    expect(bundle.bundle_incomplete).toBe(false);
  });

  it("never drops an essential while a lower rank survives", () => {
    const essential = block("checkins", "essential", rows(1));
    const primary = block("journal", "primary", rows(1));

    const bundle = allocateBundle([primary, essential], sizeOf(essential) + 5);

    expect(bundle.blocks.map((item) => item.priority)).toEqual(["essential"]);
    expect(bundle.bundle_incomplete).toBe(true);
  });

  it("truncates at row granularity and says so", () => {
    const full = block("checkins", "essential", rows(10));
    const budget = sizeOf(block("checkins", "essential", rows(5), {
      complete: false,
      rows_returned: 5,
      limitations: ["this block was truncated to fit the evidence budget"],
    })) + 40;

    const bundle = allocateBundle([full], budget);

    expect(bundle.blocks.length).toBe(1);
    const kept = bundle.blocks[0];
    expect(kept.rows_returned).toBeLessThanOrEqual(10);
    expect(kept.rows_returned).toBeGreaterThan(0);
    expect(kept.complete).toBe(false);
    expect(kept.limitations.some((line) => line.includes("truncated"))).toBe(true);
    expect(bundle.total_chars).toBeLessThanOrEqual(budget);
  });

  it("spends at most the configured budget", () => {
    const blocks = [
      block("checkins", "essential", rows(5)),
      block("journal", "primary", rows(5)),
      block("habits", "supporting", rows(5)),
      block("rules_search", "optional", rows(5)),
    ];
    const bundle = allocateBundle(blocks, DEFAULT_EVIDENCE_BUDGET);
    expect(bundle.total_chars).toBeLessThanOrEqual(DEFAULT_EVIDENCE_BUDGET);
    expect(bundle.total_chars).toBeGreaterThan(0);
  });

  it("presents kept blocks in planner order, not rank order", () => {
    const supporting = block("habits", "supporting", rows(1));
    const essential = block("checkins", "essential", rows(1));

    const bundle = allocateBundle([supporting, essential], DEFAULT_EVIDENCE_BUDGET);

    expect(bundle.blocks.map((item) => item.dataset)).toEqual(["habits", "checkins"]);
  });

  it("is deterministic for equal ranks", () => {
    const first = block("checkins", "primary", rows(2));
    const second = block("journal", "primary", rows(2));
    const bundle = allocateBundle([first, second], sizeOf(first) + 5);
    expect(bundle.blocks.map((item) => item.dataset)).toEqual(["checkins"]);
  });

  it("always produces a bundle for an empty block list", () => {
    const bundle = allocateBundle([], DEFAULT_EVIDENCE_BUDGET);
    expect(bundle.blocks).toEqual([]);
    expect(bundle.omitted_essential).toEqual([]);
    expect(bundle.bundle_incomplete).toBe(false);
    expect(bundle.total_chars).toBe(0);
  });
});

describe("mergeBundles — the one refinement round (PLAN.md §12.2)", () => {
  function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
    return {
      blocks: [],
      omitted_essential: [],
      bundle_incomplete: false,
      total_chars: 0,
      limitations: [],
      ...overrides,
    };
  }

  it("appends the second round after the first, in arrival order", () => {
    const first = bundle({ blocks: [block("checkins", "primary", rows(1))] });
    const second = bundle({ blocks: [block("journal", "primary", rows(1))] });
    const merged = mergeBundles(first, second);
    expect(merged.blocks.map((item) => item.dataset)).toEqual(["checkins", "journal"]);
  });

  it("sums total_chars so the allocator's spend is visible across both rounds", () => {
    expect(mergeBundles(bundle({ total_chars: 400 }), bundle({ total_chars: 250 })).total_chars)
      .toBe(650);
  });

  it("keeps an incomplete first round incomplete after a clean second", () => {
    const merged = mergeBundles(bundle({ bundle_incomplete: true }), bundle());
    expect(merged.bundle_incomplete).toBe(true);
    expect(mergeBundles(bundle(), bundle({ bundle_incomplete: true })).bundle_incomplete).toBe(true);
    expect(mergeBundles(bundle(), bundle()).bundle_incomplete).toBe(false);
  });

  it("unions omitted essentials without duplicates", () => {
    const merged = mergeBundles(
      bundle({ omitted_essential: ["checkins" as DatasetName, "habits" as DatasetName] }),
      bundle({ omitted_essential: ["habits" as DatasetName, "journal" as DatasetName] }),
    );
    expect(merged.omitted_essential).toEqual(["checkins", "habits", "journal"]);
  });

  it("dedupes limitations and keeps the first round's order", () => {
    const merged = mergeBundles(
      bundle({ limitations: ["a", "b"] }),
      bundle({ limitations: ["b", "c"] }),
    );
    expect(merged.limitations).toEqual(["a", "b", "c"]);
  });

  it("never mutates either input", () => {
    const first = bundle({ blocks: [block("checkins", "primary", rows(1))] });
    const second = bundle({ blocks: [block("journal", "primary", rows(1))] });
    mergeBundles(first, second);
    expect(first.blocks.length).toBe(1);
    expect(second.blocks.length).toBe(1);
  });
});
