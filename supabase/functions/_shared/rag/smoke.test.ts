// supabase/functions/_shared/rag/smoke.test.ts
// P4 — the smoke set's verdict rules and the §10 calibration arithmetic (PRD §14.1 D, §14.2;
// PLAN.md §10, §15, §16).
//
// The fixture file is loaded from `content/` on purpose: these cases are what keep the DRAFT set
// well-formed, so an edit to the JSON that breaks a category or a shape fails here rather than at
// the gate.
//
// Jest globals are declared inline (tsconfig excludes supabase/functions).

import {
  DEFAULT_MAX_EVIDENCE_CHARS,
  DEFAULT_MAX_GENERATION_REQUESTS,
  NEVER_IN_EVIDENCE,
  SMOKE_CATEGORIES,
  calibrationThreshold,
  evaluateObservation,
  parseSmokeSet,
  summarizeSmoke,
  type SmokeObservation,
  type SmokePrompt,
  type SmokeSet,
} from "./smoke.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: string): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeGreaterThan(expected: number): void;
  not: { toContain(expected: string): void };
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;
declare const require: (path: string) => unknown;

const FIXTURE = require("../../../../content/rag-fixtures/smoke_prompts.json");

function prompt(overrides: Partial<SmokePrompt> = {}): SmokePrompt {
  return {
    id: "p1",
    category: "casual_no_retrieval",
    prompt: "hello",
    expect: { retrieval: "none", datasets: [], must_not_quote: [], manual_review: [] },
    ...overrides,
  };
}

function observation(overrides: Partial<SmokeObservation> = {}): SmokeObservation {
  return {
    promptId: "p1",
    planState: "none",
    requestedDatasets: [],
    blocks: 0,
    totalChars: 0,
    generationRequests: 1,
    evidenceText: "",
    ...overrides,
  };
}

function setWith(prompts: unknown[]): unknown {
  return { status: "draft", label: "DRAFT", prompts };
}

function minimal(category: string, id: string, retrieval: "none" | "required") {
  return {
    id,
    category,
    prompt: "a prompt",
    expect: {
      retrieval,
      datasets: retrieval === "required" ? ["checkins"] : [],
      must_not_quote: [],
      manual_review: [],
    },
  };
}

function fullSet(): unknown {
  return setWith(SMOKE_CATEGORIES.map((category, index) =>
    minimal(category, `p${index}`, category.endsWith("no_retrieval") ? "none" : "required")
  ));
}

describe("the DRAFT fixture file (PRD §14.1 D)", () => {
  it("parses, and covers all ten categories exactly once", () => {
    const parsed = parseSmokeSet(FIXTURE);
    if (!parsed.ok) throw new Error(`fixture rejected: ${parsed.reason}`);
    expect(parsed.set.status).toBe("draft");
    expect(parsed.set.prompts.length).toBe(10);
    const categories = parsed.set.prompts.map((item) => item.category);
    expect(categories.slice().sort()).toEqual(SMOKE_CATEGORIES.slice().sort());
  });

  it("never expects datasets on a no-retrieval prompt", () => {
    const parsed = parseSmokeSet(FIXTURE);
    if (!parsed.ok) throw new Error(parsed.reason);
    for (const item of parsed.set.prompts) {
      if (item.expect.retrieval !== "none") continue;
      expect(item.expect.datasets.length).toBe(0);
    }
  });

  it("carries a manual review note wherever the verdict cannot be automatic", () => {
    const parsed = parseSmokeSet(FIXTURE);
    if (!parsed.ok) throw new Error(parsed.reason);
    for (const item of parsed.set.prompts) {
      // Every prompt in this set has at least one answer-level check; a prompt with none would
      // silently report `pass` for a turn nobody read.
      expect(item.expect.manual_review.length).toBeGreaterThan(0);
    }
  });
});

describe("parseSmokeSet fails closed", () => {
  it("rejects anything that is not a plain object", () => {
    expect(parseSmokeSet(null)).toEqual({ ok: false, reason: "not_an_object" });
    expect(parseSmokeSet([])).toEqual({ ok: false, reason: "not_an_object" });
    expect(parseSmokeSet("set")).toEqual({ ok: false, reason: "not_an_object" });
  });

  it("rejects an unapproved or missing status and a missing label", () => {
    expect(parseSmokeSet({ status: "final", label: "x", prompts: [] })).toEqual({
      ok: false,
      reason: "bad_status",
    });
    expect(parseSmokeSet({ status: "draft", prompts: [] })).toEqual({
      ok: false,
      reason: "missing_label",
    });
    expect(parseSmokeSet({ status: "draft", label: "  ", prompts: [] })).toEqual({
      ok: false,
      reason: "missing_label",
    });
  });

  it("enforces PRD §14.1 D's 8-12 prompt range", () => {
    const tooFew = setWith([minimal("casual_no_retrieval", "p1", "none")]);
    expect(parseSmokeSet(tooFew)).toEqual({ ok: false, reason: "count_out_of_range" });
    const tooMany = setWith(
      Array.from({ length: 13 }, (_, i) => minimal("casual_no_retrieval", `p${i}`, "none")),
    );
    expect(parseSmokeSet(tooMany)).toEqual({ ok: false, reason: "count_out_of_range" });
  });

  it("rejects duplicate ids and unknown categories", () => {
    const duplicated = fullSet() as { prompts: unknown[] };
    duplicated.prompts[1] = minimal("general_concept_no_retrieval", "p0", "none");
    expect(parseSmokeSet(duplicated)).toEqual({ ok: false, reason: "duplicate_id:p0" });

    const unknown = fullSet() as { prompts: unknown[] };
    unknown.prompts[0] = minimal("not_a_category", "p0", "none");
    expect(parseSmokeSet(unknown)).toEqual({ ok: false, reason: "unknown_category:not_a_category" });
  });

  it("names a missing category rather than passing a partial set", () => {
    const partial = fullSet() as { prompts: unknown[] };
    partial.prompts = partial.prompts.slice(1);
    // Keep the count at ten so the failure is specifically the missing category.
    partial.prompts.push(minimal("checkin_count_energy", "extra", "required"));
    expect(parseSmokeSet(partial)).toEqual({
      ok: false,
      reason: "missing_category:casual_no_retrieval",
    });
  });

  it("rejects a self-contradictory retrieval expectation", () => {
    const noneWithData = fullSet() as { prompts: Array<Record<string, unknown>> };
    noneWithData.prompts[0] = {
      ...minimal("casual_no_retrieval", "p0", "none"),
      expect: {
        retrieval: "none",
        datasets: ["checkins"],
        must_not_quote: [],
        manual_review: [],
      },
    };
    expect(parseSmokeSet(noneWithData)).toEqual({ ok: false, reason: "none_with_datasets:p0" });

    const requiredWithout = fullSet() as { prompts: Array<Record<string, unknown>> };
    requiredWithout.prompts[2] = {
      ...minimal("checkin_count_energy", "p2", "required"),
      expect: {
        retrieval: "required",
        datasets: [],
        must_not_quote: [],
        manual_review: [],
      },
    };
    expect(parseSmokeSet(requiredWithout)).toEqual({
      ok: false,
      reason: "required_without_datasets:p2",
    });
  });

  it("rejects an unknown dataset name rather than trusting the fixture", () => {
    const bad = fullSet() as { prompts: Array<Record<string, unknown>> };
    bad.prompts[2] = {
      ...minimal("checkin_count_energy", "p2", "required"),
      expect: {
        retrieval: "required",
        datasets: ["doings"],
        must_not_quote: [],
        manual_review: [],
      },
    };
    expect(parseSmokeSet(bad)).toEqual({ ok: false, reason: "bad_datasets:p2" });
  });

  it("accepts an approved set as well as a draft", () => {
    const approved = { ...(fullSet() as Record<string, unknown>), status: "approved" };
    const parsed = parseSmokeSet(approved);
    expect(parsed.ok).toBe(true);
  });
});

describe("evaluateObservation (PRD §14.1 C1, §14.2; PLAN.md §12.1, §16)", () => {
  it("passes a no-retrieval turn that asked for nothing and rendered nothing", () => {
    const result = evaluateObservation(prompt(), observation());
    expect(result.verdict).toBe("pass");
    expect(result.notes).toEqual([]);
  });

  it("fails a no-retrieval prompt that asked for data", () => {
    const result = evaluateObservation(
      prompt(),
      observation({ planState: "ok", requestedDatasets: ["checkins"] }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain("asked for data on a no-retrieval prompt");
  });

  it("fails a no-retrieval prompt that produced a block anyway", () => {
    const result = evaluateObservation(prompt(), observation({ blocks: 1 }));
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain("evidence block");
  });

  it("fails a rejected plan and an unavailable retrieval", () => {
    const rejected = evaluateObservation(
      prompt({ expect: { ...prompt().expect, retrieval: "required", datasets: ["checkins"] } }),
      observation({ planState: "rejected", reason: "priority_invalid" }),
    );
    expect(rejected.verdict).toBe("fail");
    expect(rejected.notes.join(" ")).toContain("priority_invalid");

    const unavailable = evaluateObservation(
      prompt({ expect: { ...prompt().expect, retrieval: "required", datasets: ["checkins"] } }),
      observation({ planState: "unavailable", reason: "config_error" }),
    );
    expect(unavailable.verdict).toBe("fail");
    expect(unavailable.notes.join(" ")).toContain("config_error");
  });

  it("does not blame a rejected plan for asking for nothing", () => {
    const result = evaluateObservation(
      prompt({ expect: { ...prompt().expect, retrieval: "required", datasets: ["checkins"] } }),
      observation({ planState: "rejected" }),
    );
    expect(result.notes.join(" ")).not.toContain("asked for no data");
  });

  it("fails a retrieval-required prompt that asked for nothing", () => {
    const result = evaluateObservation(
      prompt({ expect: { ...prompt().expect, retrieval: "required", datasets: ["checkins"] } }),
      observation({ planState: "none" }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain("asked for no data");
  });

  it("warns, never fails, when the model picked a different but valid dataset", () => {
    const result = evaluateObservation(
      prompt({
        expect: {
          ...prompt().expect,
          retrieval: "required",
          datasets: ["checkins"],
        },
      }),
      observation({ planState: "ok", requestedDatasets: ["daily_vars"], blocks: 1 }),
    );
    expect(result.verdict).toBe("warn");
    expect(result.notes.join(" ")).toContain("expected dataset(s) not requested: checkins");
    expect(result.notes.join(" ")).toContain("outside the fixture's expectation: daily_vars");
  });

  it("warns when a plan asked for data and no block came back", () => {
    const result = evaluateObservation(
      prompt({ expect: { ...prompt().expect, retrieval: "required", datasets: ["checkins"] } }),
      observation({ planState: "ok", requestedDatasets: ["checkins"], blocks: 0 }),
    );
    expect(result.verdict).toBe("warn");
    expect(result.notes.join(" ")).toContain("no block was produced");
  });

  it("fails over the provider-request ceiling and honours an override", () => {
    const over = evaluateObservation(prompt(), observation({ generationRequests: 4 }));
    expect(over.verdict).toBe("fail");
    expect(over.notes.join(" ")).toContain("ceiling of 3");

    const raised = evaluateObservation(
      prompt(),
      observation({ generationRequests: 4 }),
      { maxGenerationRequests: 5 },
    );
    expect(raised.verdict).toBe("pass");
  });

  it("fails over the evidence-character ceiling and honours an override", () => {
    const over = evaluateObservation(prompt(), observation({ totalChars: 12001 }));
    expect(over.verdict).toBe("fail");
    expect(over.notes.join(" ")).toContain("ceiling of 12000");

    const exact = evaluateObservation(prompt(), observation({ totalChars: 12000 }));
    expect(exact.verdict).toBe("pass");

    const raised = evaluateObservation(prompt(), observation({ totalChars: 13000 }), {
      maxEvidenceChars: 14000,
    });
    expect(raised.verdict).toBe("pass");
  });

  it("fails on any field name the evidence must never contain", () => {
    for (const forbidden of NEVER_IN_EVIDENCE) {
      const result = evaluateObservation(
        prompt(),
        observation({ evidenceText: `data: {"${forbidden}":1}` }),
      );
      expect(result.verdict).toBe("fail");
      expect(result.notes.join(" ")).toContain(forbidden);
    }
  });

  it("matches a fixture-forbidden string case-insensitively", () => {
    const result = evaluateObservation(
      prompt({
        expect: { ...prompt().expect, must_not_quote: ["Held off"] },
      }),
      observation({ evidenceText: "data: [{\"note\":\"held off 3 times\"}]" }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain("Held off");
  });

  it("never returns pass while a manual review item is open", () => {
    const result = evaluateObservation(
      prompt({
        expect: { ...prompt().expect, manual_review: ["the reply states the day basis"] },
      }),
      observation(),
    );
    expect(result.verdict).toBe("warn");
    expect(result.notes.join(" ")).toContain("manual review: the reply states the day basis");
  });

  it("a failure outranks a warning even when a manual item is open", () => {
    const result = evaluateObservation(
      prompt({ expect: { ...prompt().expect, manual_review: ["read the reply"] } }),
      observation({ generationRequests: 9 }),
    );
    expect(result.verdict).toBe("fail");
  });

  it("refuses an observation belonging to another prompt", () => {
    const result = evaluateObservation(prompt(), observation({ promptId: "other" }));
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain("observation is for other");
  });

  it("exposes the documented ceilings", () => {
    expect(DEFAULT_MAX_GENERATION_REQUESTS).toBe(3);
    expect(DEFAULT_MAX_EVIDENCE_CHARS).toBe(12000);
  });
});

describe("summarizeSmoke", () => {
  it("counts warnings separately and blocks only on a failure", () => {
    const summary = summarizeSmoke([
      { promptId: "a", verdict: "pass", notes: [] },
      { promptId: "b", verdict: "warn", notes: [] },
    ]);
    expect(summary).toEqual({ pass: 1, warn: 1, fail: 0, blocking: false });

    const blocked = summarizeSmoke([
      { promptId: "a", verdict: "warn", notes: [] },
      { promptId: "b", verdict: "fail", notes: [] },
    ]);
    expect(blocked.blocking).toBe(true);
    expect(blocked.fail).toBe(1);
  });
});

describe("calibrationThreshold (PLAN.md §10)", () => {
  it("takes the minimum true positive minus 0.02, to two decimals", () => {
    expect(calibrationThreshold([0.81, 0.64, 0.72])).toBe(0.62);
    expect(calibrationThreshold([0.9])).toBe(0.88);
  });

  it("returns null when nothing was judged", () => {
    expect(calibrationThreshold([])).toBeNull();
    expect(calibrationThreshold([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("returns null when the arithmetic leaves the range SQL accepts", () => {
    // 0.01 - 0.02 is negative; a zero threshold is the v4 defect §10 exists to prevent.
    expect(calibrationThreshold([0.01])).toBeNull();
    expect(calibrationThreshold([0.02])).toBeNull();
  });

  it("is deterministic for equal inputs", () => {
    expect(calibrationThreshold([0.5, 0.5])).toBe(0.48);
  });
});

describe("the fixture and the evaluator agree", () => {
  it("every fixture prompt can be evaluated to a non-pass verdict without an observation", () => {
    const parsed = parseSmokeSet(FIXTURE);
    if (!parsed.ok) throw new Error(parsed.reason);
    for (const item of parsed.set.prompts) {
      const result = evaluateObservation(item, {
        promptId: item.id,
        planState: "rejected",
        requestedDatasets: [],
        blocks: 0,
        totalChars: 0,
        generationRequests: 0,
        evidenceText: "",
      });
      expect(result.verdict).toBe("fail");
    }
  });

  it("accepts a fully clean run of the whole set as warn-or-better", () => {
    const parsed = parseSmokeSet(FIXTURE);
    if (!parsed.ok) throw new Error(parsed.reason);
    const results = parsed.set.prompts.map((item) =>
      evaluateObservation(item, {
        promptId: item.id,
        planState: item.expect.retrieval === "none" ? "none" : "ok",
        requestedDatasets: item.expect.datasets,
        blocks: item.expect.retrieval === "none" ? 0 : 1,
        totalChars: 100,
        generationRequests: 2,
        evidenceText: "no_relevant_evidence",
      })
    );
    const summary = summarizeSmoke(results);
    expect(summary.fail).toBe(0);
    expect(summary.blocking).toBe(false);
  });
});

// Keeps the type import honest without a value use.
export type SmokeFixtureTypeCheck = SmokeSet;
