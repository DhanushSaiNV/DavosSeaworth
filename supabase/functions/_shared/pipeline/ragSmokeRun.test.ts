// supabase/functions/_shared/pipeline/ragSmokeRun.test.ts
// P4 — the smoke loop's orchestration, with every side effect faked (PRD §14.1 D, §14.2;
// PLAN.md §15 P4).
//
// The point of these cases is the contract between the runner and the drill: a throw costs one
// prompt and not the run, the ledger is read after the turn it belongs to, and the evaluator's
// options are forwarded rather than re-implemented here.
//
// Jest globals are declared inline (tsconfig excludes supabase/functions).

import { runSmoke, type SmokeRunnerDeps, type SmokeTurn } from "./ragSmokeRun.ts";
import { SMOKE_CATEGORIES, type SmokePrompt, type SmokeSet } from "../rag/smoke.ts";
import type { DatasetName, RagPlan } from "../rag/types.ts";
import type { RagProbe } from "./ragTurn.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: string): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

function entry(dataset: DatasetName): RagPlan["retrieval_requests"][number] {
  return {
    dataset,
    op: "list",
    priority: "primary",
    purpose: "smoke",
    arguments: {},
  };
}

function plan(datasets: DatasetName[]): RagPlan {
  return {
    intent: "conversation",
    retrieval_required: datasets.length > 0,
    retrieval_requests: datasets.map(entry),
    answer_mode: "conversational",
  };
}

function probe(overrides: Partial<RagProbe> = {}): RagProbe {
  return {
    enabled: true,
    plan: "ok",
    requests: 1,
    blocks: 1,
    omitted: 0,
    bundle_incomplete: false,
    total_chars: 100,
    trimmed: 0,
    refined: false,
    generation_requests: 2,
    ...overrides,
  };
}

function turn(datasets: DatasetName[], overrides: Partial<RagProbe> = {}): SmokeTurn {
  return {
    plan: plan(datasets),
    evidenceContext: "evidence",
    probe: probe(overrides),
  };
}

function promptOf(category: string, id: string, datasets: DatasetName[]): SmokePrompt {
  return {
    id,
    category: category as SmokePrompt["category"],
    prompt: `prompt ${id}`,
    expect: {
      retrieval: datasets.length === 0 ? "none" : "required",
      datasets,
      must_not_quote: [],
      manual_review: [],
    },
  };
}

function setOf(prompts: SmokePrompt[]): SmokeSet {
  return { status: "draft", label: "DRAFT", prompts };
}

/** Ten prompts, one per category, so `runSmoke` is exercised on a realistic set. */
function fullSet(): SmokeSet {
  return setOf(SMOKE_CATEGORIES.map((category, index) =>
    promptOf(
      category,
      `p${index}`,
      category.endsWith("no_retrieval") ? [] : ["checkins" as DatasetName],
    )
  ));
}

function deps(overrides: Partial<SmokeRunnerDeps> = {}): SmokeRunnerDeps {
  return {
    planFor: async () => ({ rawPlan: { anything: true } }),
    runTurn: async () => turn(["checkins"]),
    requestsSpent: () => 2,
    ...overrides,
  };
}

describe("runSmoke", () => {
  it("runs every prompt in order and keeps the observations", async () => {
    const set = fullSet();
    const seen: string[] = [];
    const result = await runSmoke(
      set,
      deps({
        planFor: async (prompt) => {
          seen.push(prompt.id);
          return { rawPlan: prompt.id };
        },
      }),
    );
    expect(seen).toEqual(set.prompts.map((item) => item.id));
    expect(result.observations.length).toBe(set.prompts.length);
    expect(result.results.length).toBe(set.prompts.length);
  });

  it("turns the plan's requests into the observed dataset list", async () => {
    const set = setOf([promptOf("two_dataset_trend", "p1", ["checkins", "daily_vars"])]);
    const result = await runSmoke(
      set,
      deps({ runTurn: async () => turn(["checkins", "daily_vars"]) }),
    );
    expect(result.observations[0].requestedDatasets).toEqual(["checkins", "daily_vars"]);
  });

  it("carries the probe's plan state and reason through to the verdict", async () => {
    const set = setOf([promptOf("checkin_count_energy", "p1", ["checkins"])]);
    const result = await runSmoke(
      set,
      deps({
        runTurn: async () => turn([], { plan: "rejected", reason: "priority_invalid", blocks: 0 }),
      }),
    );
    expect(result.observations[0].planState).toBe("rejected");
    expect(result.observations[0].reason).toBe("priority_invalid");
    expect(result.results[0].verdict).toBe("fail");
    expect(result.results[0].notes.join(" ")).toContain("priority_invalid");
  });

  it("omits the reason key when the probe has none", async () => {
    const set = setOf([promptOf("casual_no_retrieval", "p1", [])]);
    const result = await runSmoke(
      set,
      deps({ runTurn: async () => turn([], { plan: "none", blocks: 0, requests: 0 }) }),
    );
    expect("reason" in result.observations[0]).toBe(false);
  });

  it("reads the ledger after the turn it belongs to", async () => {
    const set = setOf([promptOf("casual_no_retrieval", "p1", [])]);
    let spent = 0;
    const result = await runSmoke(
      set,
      deps({
        runTurn: async () => {
          spent += 2;
          return turn([], { plan: "none", blocks: 0 });
        },
        requestsSpent: () => spent,
      }),
    );
    expect(result.observations[0].generationRequests).toBe(2);
  });

  it("costs one prompt, not the run, when planning throws", async () => {
    const set = setOf([
      promptOf("casual_no_retrieval", "p1", []),
      promptOf("general_concept_no_retrieval", "p2", []),
      promptOf("checkin_count_energy", "p3", ["checkins"]),
    ]);
    const result = await runSmoke(
      set,
      deps({
        planFor: async (prompt) => {
          if (prompt.id === "p1") throw new Error("provider down");
          return { rawPlan: null };
        },
        runTurn: async () => turn([], { plan: "none", blocks: 0 }),
      }),
    );
    expect(result.results.length).toBe(3);
    expect(result.results[0].verdict).toBe("fail");
    expect(result.results[0].notes.join(" ")).toContain("provider down");
    expect(result.results[1].verdict).toBe("pass");
    expect(result.observations.length).toBe(2);
    expect(result.summary.blocking).toBe(true);
  });

  it("costs one prompt, not the run, when the turn throws", async () => {
    const set = setOf([
      promptOf("checkin_count_energy", "p1", ["checkins"]),
      promptOf("casual_no_retrieval", "p2", []),
    ]);
    const result = await runSmoke(
      set,
      deps({
        runTurn: async () => {
          throw new Error("dispatch failed");
        },
      }),
    );
    expect(result.results[0].notes.join(" ")).toContain("dispatch failed");
    expect(result.results[1].verdict).toBe("fail");
    expect(result.summary.fail).toBe(2);
  });

  it("forwards the evaluator's ceilings instead of hardcoding them", async () => {
    const set = setOf([promptOf("checkin_count_energy", "p1", ["checkins"])]);
    const strict = await runSmoke(set, deps({ requestsSpent: () => 4 }));
    expect(strict.results[0].verdict).toBe("fail");

    const raised = await runSmoke(set, deps({ requestsSpent: () => 4 }), {
      maxGenerationRequests: 4,
    });
    expect(raised.results[0].verdict).toBe("pass");
  });

  it("reports a clean set as non-blocking", async () => {
    // The fake planner echoes the fixture's own expectation, which is what a correct run looks
    // like: this case is about the summary, not about the model's judgement.
    const result = await runSmoke(fullSet(), {
      planFor: async (prompt) => ({ rawPlan: prompt.expect.datasets }),
      runTurn: async (rawPlan) => {
        const datasets = rawPlan as DatasetName[];
        return turn(datasets, {
          plan: datasets.length > 0 ? "ok" : "none",
          blocks: datasets.length > 0 ? 1 : 0,
        });
      },
      requestsSpent: () => 2,
    });
    expect(result.summary.blocking).toBe(false);
    expect(result.summary.fail).toBe(0);
  });
});
