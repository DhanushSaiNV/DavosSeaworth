// supabase/functions/_shared/metrics/formula.test.ts
// FP-07 Step 2 — the gate/evaluator tables (AC-2, AC-3, AC-10 gate half).
// Refs: FP-07 FR-4, FR-5, FR-18; TECH-SPEC §7.9.1–7.9.4, §10.4.
//
// Deno sees no jest globals in this tree, so declare the small surface used here.

import {
  FORMULA_OPERATORS,
  FORMULA_VARIABLES,
  evaluateFormula,
  validateFormula,
  type FormulaBounds,
  type FormulaVars,
} from "./formula.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeTruthy(): void;
  toThrow(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;
declare const require: {
  (id: string): { readFileSync(path: string, encoding: string): string };
  resolve(id: string): string;
};

const BOUNDS: FormulaBounds = { max_depth: 6, max_nodes: 30, literal_abs_max: 1000 };
const VARS: FormulaVars = {
  doings_count: 7,
  hours_logged: 6,
  checkin_compliance_rate: 0.75,
  energy_avg: 5.5,
  impulse_failures: 2,
  journal_positive_mentions: 3,
  journal_negative_mentions: 1,
  quest_completions: 4,
};

const SPEC_OPERATORS = [
  "var",
  "+",
  "-",
  "*",
  "/",
  "%",
  ">",
  "<",
  ">=",
  "<=",
  "==",
  "!=",
  "if",
  "and",
  "or",
  "not",
  "min",
  "max",
];
const SPEC_VARIABLES = [
  "doings_count",
  "hours_logged",
  "checkin_compliance_rate",
  "energy_avg",
  "impulse_failures",
  "journal_positive_mentions",
  "journal_negative_mentions",
  "quest_completions",
];

function codeOf(tree: unknown): string {
  const result = validateFormula(tree, BOUNDS);
  return result.ok ? "ok" : result.errors[0].code;
}

function nestedNot(levels: number): unknown {
  let node: unknown = true;
  for (let i = 0; i < levels; i += 1) node = { not: node };
  return node;
}

function flatAnd(literals: number): unknown {
  return { and: Array.from({ length: literals }, () => true) };
}

describe("FP-07 formula gate", () => {
  it("pins the whitelist constants to the §7.9 text", () => {
    expect([...FORMULA_OPERATORS]).toEqual(SPEC_OPERATORS);
    expect([...FORMULA_VARIABLES]).toEqual(SPEC_VARIABLES);
  });

  it("accepts every whitelisted operator and variable", () => {
    const accepted = [
      { var: "doings_count" },
      { "+": [1, 2] },
      { "-": [1, 2] },
      { "*": [1, 2] },
      { "/": [1, 2] },
      { "%": [1, 2] },
      { ">": [1, 2] },
      { "<": [1, 2] },
      { ">=": [1, 2] },
      { "<=": [1, 2] },
      { "==": [1, 1] },
      { "!=": [1, 2] },
      { if: [true, 1, 0] },
      { and: [true, false] },
      { or: [true, false] },
      { not: true },
      { min: [1, 2] },
      { max: [1, 2] },
    ];
    for (const tree of accepted) {
      const result = validateFormula(tree, BOUNDS);
      expect(result.ok).toBe(true);
    }
    for (const variable of SPEC_VARIABLES) {
      expect(validateFormula({ var: variable }, BOUNDS).ok).toBe(true);
    }
    // The array shorthand is the same node shape.
    expect(validateFormula(["var", "doings_count"], BOUNDS).ok).toBe(true);
  });

  it("rejects every non-whitelisted operator", () => {
    for (const op of ["reduce", "cat", "while", "map", "filter", "in", "log"]) {
      expect(codeOf({ [op]: [1, 2] })).toBe("unknown_operator");
    }
  });

  it("rejects a malformed operator node", () => {
    expect(codeOf({})).toBe("invalid_operator");
    expect(codeOf({ "+": [1, 2], "-": [1, 2] })).toBe("invalid_operator");
    expect(codeOf([])).toBe("invalid_node");
    expect(codeOf([1, 2])).toBe("invalid_operator");
    expect(codeOf("doings_count")).toBe("invalid_node");
    expect(codeOf(42)).toBe("invalid_node");
    expect(codeOf(null)).toBe("invalid_node");
  });

  it("rejects non-whitelisted and injection-shaped variables", () => {
    for (const variable of [
      "trust_score",
      "profile.trust_score",
      "doings_count.__proto__",
      " doings_count",
      "doings_count ",
      "DOINGS_COUNT",
      "doings_count;drop table metrics",
    ]) {
      expect(codeOf({ var: variable })).toBe("unknown_variable");
    }
    expect(codeOf({ var: 1 })).toBe("invalid_variable");
    expect(codeOf({ var: ["doings_count", "fallback"] })).toBe("arity");
    expect(codeOf({ var: [] })).toBe("arity");
  });

  it("enforces the numeric literal bound at ±1000", () => {
    expect(validateFormula({ "+": [1000, 0] }, BOUNDS).ok).toBe(true);
    expect(validateFormula({ "+": [-1000, 0] }, BOUNDS).ok).toBe(true);
    expect(codeOf({ "+": [1001, 0] })).toBe("literal_out_of_bounds");
    expect(codeOf({ "+": [-1001, 0] })).toBe("literal_out_of_bounds");
    expect(codeOf({ "+": [Number.POSITIVE_INFINITY, 0] })).toBe("invalid_node");
  });

  it("enforces depth 6 inclusive and depth 7 exclusive", () => {
    // Root operator at depth 1, then one level per nested not.
    expect(validateFormula(nestedNot(5), BOUNDS).ok).toBe(true);
    expect(codeOf(nestedNot(6))).toBe("max_depth");
  });

  it("enforces 30 nodes inclusive and 31 exclusive", () => {
    expect(validateFormula(flatAnd(29), BOUNDS).ok).toBe(true);
    expect(codeOf(flatAnd(30))).toBe("max_nodes");
  });

  it("returns structured errors for arity and type failures", () => {
    const cases: Array<[unknown, string]> = [
      [{ "+": [1] }, "arity"],
      [{ "-": [1, 2, 3] }, "arity"],
      [{ not: [true, false] }, "arity"],
      [{ if: [true, 1] }, "arity"],
      [{ if: [true, 1, 0, 2] }, "arity"],
      [{ min: [1] }, "arity"],
      [{ "+": [1, true] }, "type"],
      [{ if: [1, 1, 0] }, "type"],
      [{ if: [true, 1, false] }, "type"],
      [{ and: [true, 1] }, "type"],
      [{ or: [false, 0] }, "type"],
      [{ not: [1] }, "type"],
      [{ "==": [1, true] }, "type"],
    ];
    for (const [tree, code] of cases) expect(codeOf(tree)).toBe(code);

    const result = validateFormula({ "+": [1, true] }, BOUNDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe("$.1");
      expect(result.errors[0].message.length).toBeGreaterThan(0);
    }
  });

  it("reports every independent error instead of stopping at the first", () => {
    const result = validateFormula({ "+": [{ var: "trust_score" }, 1001] }, BOUNDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes.includes("unknown_variable")).toBe(true);
      expect(codes.includes("literal_out_of_bounds")).toBe(true);
    }
  });
});

describe("FP-07 formula evaluator", () => {
  it("resolves every variable and evaluates every operator", () => {
    expect(evaluateFormula({ var: "doings_count" }, VARS, BOUNDS)).toBe(7);
    expect(evaluateFormula({ var: "checkin_compliance_rate" }, VARS, BOUNDS)).toBe(0.75);
    expect(evaluateFormula({ "+": [1, 2] }, VARS, BOUNDS)).toBe(3);
    expect(evaluateFormula({ "-": [1, 2] }, VARS, BOUNDS)).toBe(-1);
    expect(evaluateFormula({ "*": [3, 4] }, VARS, BOUNDS)).toBe(12);
    expect(evaluateFormula({ "/": [8, 2] }, VARS, BOUNDS)).toBe(4);
    expect(evaluateFormula({ "%": [7, 3] }, VARS, BOUNDS)).toBe(1);
    expect(evaluateFormula({ ">": [2, 1] }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ "<": [2, 1] }, VARS, BOUNDS)).toBe(false);
    expect(evaluateFormula({ ">=": [2, 2] }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ "<=": [2, 1] }, VARS, BOUNDS)).toBe(false);
    expect(evaluateFormula({ "==": [2, 2] }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ "!=": [2, 2] }, VARS, BOUNDS)).toBe(false);
    expect(evaluateFormula({ "==": [true, true] }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ if: [true, 10, 20] }, VARS, BOUNDS)).toBe(10);
    expect(evaluateFormula({ if: [false, 10, 20] }, VARS, BOUNDS)).toBe(20);
    expect(evaluateFormula({ and: [true, true] }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ and: [true, false] }, VARS, BOUNDS)).toBe(false);
    expect(evaluateFormula({ or: [false, true] }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ or: [false, false] }, VARS, BOUNDS)).toBe(false);
    expect(evaluateFormula({ not: false }, VARS, BOUNDS)).toBe(true);
    expect(evaluateFormula({ min: [5, 2, 9] }, VARS, BOUNDS)).toBe(2);
    expect(evaluateFormula({ max: [5, 2, 9] }, VARS, BOUNDS)).toBe(9);
  });

  it("uses the vars argument, not a captured environment", () => {
    expect(evaluateFormula({ var: "energy_avg" }, { ...VARS, energy_avg: 9.5 }, BOUNDS)).toBe(9.5);
    expect(evaluateFormula(["var", "quest_completions"], VARS, BOUNDS)).toBe(4);
  });

  it("returns NaN for a non-finite result", () => {
    expect(Number.isNaN(evaluateFormula({ "+": [1, { "/": [1, 0] }] }, VARS, BOUNDS))).toBe(true);
    expect(Number.isNaN(evaluateFormula({ "%": [1, 0] }, VARS, BOUNDS))).toBe(true);
  });

  it("throws on an ungated tree rather than interpreting it", () => {
    expect(() => evaluateFormula({ reduce: [{ var: "doings_count" }, 0] }, VARS, BOUNDS)).toThrow();
    expect(() => evaluateFormula({ var: "trust_score" }, VARS, BOUNDS)).toThrow();
    expect(() => evaluateFormula({ "+": [1] }, VARS, BOUNDS)).toThrow();
  });

  it("contains no string-to-code surface", () => {
    const source = require("fs").readFileSync(require.resolve("./formula.ts"), "utf-8") as string;
    const withoutComments = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/\beval\s*\(/.test(withoutComments)).toBe(false);
    expect(/\bFunction\s*\(/.test(withoutComments)).toBe(false);
    expect(/\bnew\s+Function\b/.test(withoutComments)).toBe(false);
  });
});
