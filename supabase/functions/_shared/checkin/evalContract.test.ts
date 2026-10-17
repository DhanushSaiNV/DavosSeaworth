// supabase/functions/_shared/checkin/evalContract.test.ts
// FP-04 Step 3a — unit tests for the eval contract: the validator, the §4.1 stub-shape
// dispatch, the fail-open combinator (bounded retry, transport short-circuit, a thrown call),
// and the dev drill gate. FP-04 FR-12; AC-4 (eval half); AC-11 (stub half).
// Refs: TECH-SPEC §7.1, §4.1, §4.2, §4.3.
//
// Only the pure half is under test: importing `eval.ts` would pull in `_shared/llm/adapter.ts`,
// which reads `Deno.env` at module load and cannot load under jest (the `bands.ts` / `persona.ts`
// precedent). The binder is one adapter import and one config read; `deno check` covers it.

import {
  buildEvalUserMessage,
  EVAL_SCHEMA,
  EVAL_STUB_RESULT,
  EVAL_SYSTEM,
  evaluateWith,
  formatAnchorBlock,
  isEvalResult,
  type EvalGenerate,
  type EvalInput,
  type EvalResult,
  type EvalWarn,
} from "./evalContract.ts";
import { selectStubPayload } from "../llm/stubShapes.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes `supabase/functions`,
// and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeNull(): void;
  toContain(expected: string): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const INPUT: EvalInput = { text: "finished the report, drained 4", energy: 4, anchors: [] };

type Step = "throw" | AdapterResult<EvalResult>;

const ok = (data: EvalResult): AdapterResult<EvalResult> => ({
  ok: true,
  data,
  provider: "stub",
  latencyMs: 0,
});

const fail = (kind: "transport" | "parse" | "validation"): AdapterResult<EvalResult> => ({
  ok: false,
  error: `forced ${kind}`,
  provider: "gemini",
  latencyMs: 0,
  kind,
});

/** A scripted adapter stand-in that records its call count and last request. */
function scripted(steps: Step[]): {
  gen: EvalGenerate;
  calls: () => number;
  lastRequest: () => GenerateRequest<EvalResult> | null;
} {
  let n = 0;
  let last: GenerateRequest<EvalResult> | null = null;
  const gen: EvalGenerate = async <T>(request: GenerateRequest<T>): Promise<AdapterResult<T>> => {
    last = request as unknown as GenerateRequest<EvalResult>;
    const step = steps[n++];
    if (step === undefined) throw new Error("scripted generate: script exhausted");
    if (step === "throw") throw new Error("simulated pre-provider throw");
    return step as unknown as AdapterResult<T>;
  };
  return { gen, calls: () => n, lastRequest: () => last };
}

function collector(): { warns: EvalWarn[]; warn: (e: EvalWarn) => void } {
  const warns: EvalWarn[] = [];
  return { warns, warn: (e) => warns.push(e) };
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe("isEvalResult", () => {
  it("accepts exactly the two-boolean eval shape", () => {
    expect(isEvalResult({ deviation: true, intervention: false })).toBe(true);
    expect(isEvalResult({ deviation: false, intervention: true })).toBe(true);
  });

  it("rejects anything off-contract", () => {
    expect(isEvalResult(null)).toBe(false);
    expect(isEvalResult("deviation")).toBe(false);
    expect(isEvalResult({})).toBe(false);
    expect(isEvalResult({ deviation: true })).toBe(false);
    expect(isEvalResult({ intervention: true })).toBe(false);
    expect(isEvalResult({ deviation: 1, intervention: false })).toBe(false);
    expect(isEvalResult({ deviation: false, intervention: "no" })).toBe(false);
    expect(isEvalResult([])).toBe(false);
  });
});

describe("EVAL_SCHEMA", () => {
  it("is the two-boolean contract and nothing else", () => {
    expect(EVAL_SCHEMA.type).toBe("object");
    expect(EVAL_SCHEMA.additionalProperties).toBe(false);
    expect(EVAL_SCHEMA.required).toEqual(["deviation", "intervention"]);
    const props = EVAL_SCHEMA.properties as Record<string, { type: string }>;
    expect(props.deviation.type).toBe("boolean");
    expect(props.intervention.type).toBe("boolean");
  });
});

describe("stub-shape dispatch (§4.1, AC-11 stub half)", () => {
  it("selects the registered eval payload for the eval validator — zero network", () => {
    expect(selectStubPayload({ validate: isEvalResult })).toBe(EVAL_STUB_RESULT);
  });

  it("the selected payload satisfies the validator it was registered for", () => {
    expect(isEvalResult(EVAL_STUB_RESULT)).toBe(true);
  });

  it("an unregistered validator still gets the §4.2 default (null here)", () => {
    expect(selectStubPayload({ validate: (p: unknown) => p !== null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

describe("evaluateWith — success (§7.1)", () => {
  it("returns the eval result on a clean call, in one provider call", async () => {
    const f = scripted([ok({ deviation: true, intervention: true })]);
    const r = await evaluateWith(f.gen, INPUT);
    expect(r).toEqual({ deviation: true, intervention: true });
    expect(f.calls()).toBe(1);
  });
});

describe("evaluateWith — fail-open (§7.1, FR-12)", () => {
  it("fails open on a transport failure without retrying", async () => {
    const f = scripted([fail("transport")]);
    const { warns, warn } = collector();
    const r = await evaluateWith(f.gen, INPUT, { warn });
    expect(r).toEqual({ deviation: false, intervention: false });
    expect(f.calls()).toBe(1);
    expect(warns.length).toBe(1);
    expect(warns[0].reason).toBe("transport");
  });

  it("retries exactly once on a structural failure, then fails open", async () => {
    const f = scripted([fail("parse"), fail("validation")]);
    const { warns, warn } = collector();
    const r = await evaluateWith(f.gen, INPUT, { warn });
    expect(r).toEqual({ deviation: false, intervention: false });
    expect(f.calls()).toBe(2);
    expect(warns.length).toBe(1);
    expect(warns[0].reason).toBe("validation");
  });

  it("recovers when the single retry succeeds", async () => {
    const f = scripted([fail("parse"), ok({ deviation: false, intervention: true })]);
    const r = await evaluateWith(f.gen, INPUT);
    expect(r).toEqual({ deviation: false, intervention: true });
    expect(f.calls()).toBe(2);
  });

  it("never throws when the provider call itself throws (e.g. a missing config key)", async () => {
    const f = scripted(["throw"]);
    const { warns, warn } = collector();
    const r = await evaluateWith(f.gen, INPUT, { warn });
    expect(r).toEqual({ deviation: false, intervention: false });
    expect(f.calls()).toBe(1);
    expect(warns[0].reason).toBe("thrown");
  });
});

describe("evaluateWith — dev drill gate (FR-12)", () => {
  it("forces intervention with no provider call, only when dev overrides are enabled", async () => {
    const f = scripted([ok({ deviation: false, intervention: false })]);
    const r = await evaluateWith(f.gen, INPUT, {
      forceIntervention: true,
      devOverridesEnabled: true,
    });
    expect(r).toEqual({ deviation: false, intervention: true });
    expect(f.calls()).toBe(0);
  });

  it("ignores the drill flag when dev overrides are off (fail-closed)", async () => {
    const f = scripted([ok({ deviation: false, intervention: false })]);
    const r = await evaluateWith(f.gen, INPUT, {
      forceIntervention: true,
      devOverridesEnabled: false,
    });
    expect(r).toEqual({ deviation: false, intervention: false });
    expect(f.calls()).toBe(1);
  });

  it("does not short-circuit when the flag is absent", async () => {
    const f = scripted([ok({ deviation: true, intervention: false })]);
    const r = await evaluateWith(f.gen, INPUT, { devOverridesEnabled: true });
    expect(r).toEqual({ deviation: true, intervention: false });
    expect(f.calls()).toBe(1);
  });
});

describe("prompt assembly (§4.6 injection guard)", () => {
  it("wraps the doing in <user_message> tags and sends the eval contract", async () => {
    const f = scripted([ok(EVAL_STUB_RESULT)]);
    await evaluateWith(f.gen, INPUT);
    const req = f.lastRequest();
    expect(req).toBeTruthy();
    const r = req!;
    expect(r.system).toContain(INJECTION_GUARD);
    expect(r.validate).toBe(isEvalResult);
    expect(r.schema).toBe(EVAL_SCHEMA);
    expect(r.messages[0].content).toContain(
      "<user_message>\nfinished the report, drained 4\n</user_message>",
    );
    expect(r.messages[0].content).toContain("Energy: 4/10");
  });

  it("renders a missing energy as not reported", () => {
    expect(buildEvalUserMessage({ text: "shipped it", energy: null, anchors: [] })).toContain(
      "Energy: not reported",
    );
  });

  it("formats anchors, and reads an empty plan as a fact", () => {
    expect(buildEvalUserMessage(INPUT)).toContain("Today's plan anchors: none saved yet.");
    const block = formatAnchorBlock([
      { label: "Deep work", start: "09:00", end: "11:00", kind: "commitment" },
      { label: "Call mum" },
    ]);
    expect(block).toContain("- 09:00-11:00 Deep work (commitment)");
    expect(block).toContain("- Call mum");
  });

  it("EVAL_SYSTEM embeds the injection guard", () => {
    expect(EVAL_SYSTEM).toContain(INJECTION_GUARD);
  });
});
