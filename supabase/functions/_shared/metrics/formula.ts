// supabase/functions/_shared/metrics/formula.ts
// FP-07 Step 2 — the D9/D10 formula gate and the only JSONLogic evaluator in the system.
//
// Refs: FP-07 FR-4, FR-5, FR-18; TECH-SPEC §7.9.1–7.9.4, §10.4; decisions2 D9 / TECH-SPEC D10.
//
// Pure and import-free on purpose: this module is the whole evaluation surface (§10.4), so it
// must be auditable in one place and jest-loadable with zero Deno shims. The gate returns
// structured errors — never a boolean, never a throw — because those errors are the feedback
// the corrected re-output consumes. The evaluator re-validates defensively: an ungated tree is
// a programming error, not input to interpret.
//
// No `eval`, no `Function`, no string-to-code. Operators are looked up in a closed table and
// walked by hand.

export const FORMULA_OPERATORS = [
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
] as const;

export type FormulaOperator = (typeof FORMULA_OPERATORS)[number];

export const FORMULA_VARIABLES = [
  "doings_count",
  "hours_logged",
  "checkin_compliance_rate",
  "energy_avg",
  "impulse_failures",
  "journal_positive_mentions",
  "journal_negative_mentions",
  "quest_completions",
] as const;

export type FormulaVariable = (typeof FORMULA_VARIABLES)[number];

export interface FormulaBounds {
  max_depth: number;
  max_nodes: number;
  literal_abs_max: number;
}

export type FormulaErrorCode =
  | "invalid_node"
  | "invalid_operator"
  | "unknown_operator"
  | "invalid_variable"
  | "unknown_variable"
  | "literal_out_of_bounds"
  | "max_depth"
  | "max_nodes"
  | "arity"
  | "type";

export interface FormulaError {
  code: FormulaErrorCode;
  path: string;
  message: string;
}

export type FormulaValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: FormulaError[] };

export type FormulaValue = number | boolean;

export type FormulaVars = Readonly<Record<FormulaVariable, number>>;

type ValueType = "number" | "boolean";

interface VisitState {
  bounds: FormulaBounds;
  errors: FormulaError[];
  nodes: number;
}

interface OperatorNode {
  op: FormulaOperator;
  operands: unknown[];
}

function fail(state: VisitState, code: FormulaErrorCode, path: string, message: string): null {
  state.errors.push({ code, path, message });
  return null;
}

function isOperator(value: string): value is FormulaOperator {
  return (FORMULA_OPERATORS as readonly string[]).includes(value);
}

function isVariable(value: string): value is FormulaVariable {
  return (FORMULA_VARIABLES as readonly string[]).includes(value);
}

function normalizeOperator(value: unknown, state: VisitState, path: string): OperatorNode | null {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return fail(state, "invalid_node", path, "operator array is empty");
    }
    const head = value[0];
    if (typeof head !== "string") {
      return fail(state, "invalid_operator", path, "operator array must start with a string");
    }
    if (!isOperator(head)) {
      return fail(state, "unknown_operator", path, `operator "${head}" is not whitelisted`);
    }
    return { op: head, operands: value.slice(1) };
  }

  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length !== 1) {
      return fail(state, "invalid_operator", path, "operator object must have exactly one key");
    }
    const head = keys[0];
    if (!isOperator(head)) {
      return fail(state, "unknown_operator", path, `operator "${head}" is not whitelisted`);
    }
    const raw = (value as Record<string, unknown>)[head];
    return { op: head, operands: Array.isArray(raw) ? raw : [raw] };
  }

  return null;
}

function checkArity(
  node: OperatorNode,
  min: number,
  max: number,
  state: VisitState,
  path: string,
): boolean {
  if (node.operands.length < min || node.operands.length > max) {
    const expected = min === max ? `${min}` : `${min}..${max}`;
    fail(
      state,
      "arity",
      path,
      `operator "${node.op}" expects ${expected} operand(s), got ${node.operands.length}`,
    );
    return false;
  }
  return true;
}

function visit(value: unknown, depth: number, path: string, state: VisitState): ValueType | null {
  state.nodes += 1;
  if (state.nodes > state.bounds.max_nodes) {
    return fail(
      state,
      "max_nodes",
      path,
      `formula exceeds the ${state.bounds.max_nodes}-node bound`,
    );
  }
  if (depth > state.bounds.max_depth) {
    return fail(
      state,
      "max_depth",
      path,
      `formula exceeds the ${state.bounds.max_depth}-level depth bound`,
    );
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail(state, "invalid_node", path, "numeric literals must be finite");
    }
    if (Math.abs(value) > state.bounds.literal_abs_max) {
      return fail(
        state,
        "literal_out_of_bounds",
        path,
        `numeric literal ${value} exceeds ±${state.bounds.literal_abs_max}`,
      );
    }
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "string" || value === null || value === undefined) {
    return fail(state, "invalid_node", path, "only numbers and booleans are literal operands");
  }

  const node = normalizeOperator(value, state, path);
  if (!node) {
    // normalizeOperator only returns null after recording the reason, or for an unsupported
    // value (arrays/objects are handled above; a function/symbol can never arrive from JSON).
    if (state.errors.length === 0) {
      return fail(state, "invalid_node", path, "unsupported formula node");
    }
    return null;
  }

  if (node.op === "var") {
    if (!checkArity(node, 1, 1, state, path)) return null;
    const operand = node.operands[0];
    if (typeof operand !== "string") {
      return fail(state, "invalid_variable", path, "var operand must be a bare string");
    }
    if (!isVariable(operand)) {
      return fail(
        state,
        "unknown_variable",
        path,
        `variable "${operand}" is not in the §7.9 whitelist`,
      );
    }
    return "number";
  }

  switch (node.op) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%": {
      if (!checkArity(node, 2, 2, state, path)) return null;
      for (let i = 0; i < node.operands.length; i += 1) {
        const type = visit(node.operands[i], depth + 1, `${path}.${i}`, state);
        if (type !== null && type !== "number") {
          fail(state, "type", `${path}.${i}`, `operator "${node.op}" requires numeric operands`);
        }
      }
      return "number";
    }
    case ">":
    case "<":
    case ">=":
    case "<=": {
      if (!checkArity(node, 2, 2, state, path)) return null;
      for (let i = 0; i < node.operands.length; i += 1) {
        const type = visit(node.operands[i], depth + 1, `${path}.${i}`, state);
        if (type !== null && type !== "number") {
          fail(state, "type", `${path}.${i}`, `operator "${node.op}" requires numeric operands`);
        }
      }
      return "boolean";
    }
    case "==":
    case "!=": {
      if (!checkArity(node, 2, 2, state, path)) return null;
      const left = visit(node.operands[0], depth + 1, `${path}.0`, state);
      const right = visit(node.operands[1], depth + 1, `${path}.1`, state);
      if (left !== null && right !== null && left !== right) {
        fail(state, "type", path, `operator "${node.op}" requires both operands to have one type`);
      }
      return "boolean";
    }
    case "if": {
      if (!checkArity(node, 3, 3, state, path)) return null;
      const condition = visit(node.operands[0], depth + 1, `${path}.0`, state);
      if (condition !== null && condition !== "boolean") {
        fail(state, "type", `${path}.0`, 'operator "if" requires a boolean condition');
      }
      const whenTrue = visit(node.operands[1], depth + 1, `${path}.1`, state);
      const whenFalse = visit(node.operands[2], depth + 1, `${path}.2`, state);
      if (whenTrue !== null && whenFalse !== null && whenTrue !== whenFalse) {
        fail(state, "type", path, 'operator "if" branches must have the same type');
        return null;
      }
      return whenTrue ?? whenFalse;
    }
    case "and":
    case "or": {
      if (!checkArity(node, 2, Number.POSITIVE_INFINITY, state, path)) return null;
      for (let i = 0; i < node.operands.length; i += 1) {
        const type = visit(node.operands[i], depth + 1, `${path}.${i}`, state);
        if (type !== null && type !== "boolean") {
          fail(state, "type", `${path}.${i}`, `operator "${node.op}" requires boolean operands`);
        }
      }
      return "boolean";
    }
    case "not": {
      if (!checkArity(node, 1, 1, state, path)) return null;
      const type = visit(node.operands[0], depth + 1, `${path}.0`, state);
      if (type !== null && type !== "boolean") {
        fail(state, "type", `${path}.0`, 'operator "not" requires a boolean operand');
      }
      return "boolean";
    }
    case "min":
    case "max": {
      if (!checkArity(node, 2, Number.POSITIVE_INFINITY, state, path)) return null;
      for (let i = 0; i < node.operands.length; i += 1) {
        const type = visit(node.operands[i], depth + 1, `${path}.${i}`, state);
        if (type !== null && type !== "number") {
          fail(state, "type", `${path}.${i}`, `operator "${node.op}" requires numeric operands`);
        }
      }
      return "number";
    }
    default: {
      // Exhaustive by construction; kept as a runtime stop if the whitelist and switch drift.
      return fail(state, "unknown_operator", path, `operator "${node.op}" is not implemented`);
    }
  }
}

/**
 * Validate a JSONLogic tree against the §7.9 whitelists and bounds. Never throws and never
 * returns a bare boolean: callers get `ok` plus the structured error list that feeds the
 * corrected re-output and the `[metric-gate]` line.
 */
export function validateFormula(tree: unknown, bounds: FormulaBounds): FormulaValidation {
  const state: VisitState = { bounds, errors: [], nodes: 0 };
  // A formula must be an operator object; a bare literal is not a formula.
  if (tree === null || typeof tree !== "object") {
    return {
      ok: false,
      errors: [{ code: "invalid_node", path: "$", message: "formula must be a JSONLogic object" }],
    };
  }
  if (!Array.isArray(tree) && Object.keys(tree as Record<string, unknown>).length !== 1) {
    return {
      ok: false,
      errors: [
        { code: "invalid_operator", path: "$", message: "formula must have exactly one operator key" },
      ],
    };
  }
  visit(tree, 1, "$", state);
  return state.errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors: state.errors };
}

function lookupVars(vars: FormulaVars, name: FormulaVariable): number {
  const value = (vars as Record<string, unknown>)[name];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function evalNode(value: unknown, vars: FormulaVars): FormulaValue {
  if (typeof value === "string") {
    // A bare string is not a literal; it can only be reached through a malformed var node,
    // which validateFormula rejects before we get here.
    throw new Error("evaluateFormula: bare string node");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  const node = normalizeOperator(value, { bounds: { max_depth: 0, max_nodes: 0, literal_abs_max: 0 }, errors: [], nodes: 0 }, "$");
  if (!node) throw new Error("evaluateFormula: invalid node");

  if (node.op === "var") {
    const name = node.operands[0];
    if (typeof name !== "string" || !isVariable(name)) {
      throw new Error("evaluateFormula: invalid variable");
    }
    return lookupVars(vars, name);
  }

  const args = node.operands;
  const num = (i: number): number => {
    const v = evalNode(args[i], vars);
    if (typeof v !== "number") throw new Error(`evaluateFormula: ${node.op} operand ${i} is not numeric`);
    return v;
  };
  const bool = (i: number): boolean => {
    const v = evalNode(args[i], vars);
    if (typeof v !== "boolean") throw new Error(`evaluateFormula: ${node.op} operand ${i} is not boolean`);
    return v;
  };

  switch (node.op) {
    case "+":
      return num(0) + num(1);
    case "-":
      return num(0) - num(1);
    case "*":
      return num(0) * num(1);
    case "/":
      return num(0) / num(1);
    case "%":
      return num(0) % num(1);
    case ">":
      return num(0) > num(1);
    case "<":
      return num(0) < num(1);
    case ">=":
      return num(0) >= num(1);
    case "<=":
      return num(0) <= num(1);
    case "==":
      return eqNode(args[0], args[1], vars);
    case "!=":
      return !eqNode(args[0], args[1], vars);
    case "if":
      return bool(0) ? evalNode(args[1], vars) : evalNode(args[2], vars);
    case "and": {
      for (const raw of args) {
        const v = evalNode(raw, vars);
        if (typeof v !== "boolean") throw new Error("evaluateFormula: and operand is not boolean");
        if (!v) return false;
      }
      return true;
    }
    case "or": {
      for (const raw of args) {
        const v = evalNode(raw, vars);
        if (typeof v !== "boolean") throw new Error("evaluateFormula: or operand is not boolean");
        if (v) return true;
      }
      return false;
    }
    case "not": {
      const v = evalNode(args[0], vars);
      if (typeof v !== "boolean") throw new Error("evaluateFormula: not operand is not boolean");
      return !v;
    }
    case "min":
      return Math.min(...args.map((_, i) => num(i)));
    case "max":
      return Math.max(...args.map((_, i) => num(i)));
    default:
      throw new Error(`evaluateFormula: operator "${node.op}" is not implemented`);
  }
}

function eqNode(left: unknown, right: unknown, vars: FormulaVars): boolean {
  const a = evalNode(left, vars);
  const b = evalNode(right, vars);
  if (typeof a !== typeof b) {
    throw new Error("evaluateFormula: equality operands must have one type");
  }
  return a === b;
}

/**
 * Evaluate a tree that has already been gated. Re-validates first and throws on any invalid
 * tree — the evaluator is never the first line of defense (§10.4). A non-finite top-level
 * number becomes NaN so the caller can skip it with one warning.
 */
export function evaluateFormula(
  tree: unknown,
  vars: FormulaVars,
  bounds: FormulaBounds,
): FormulaValue {
  const validation = validateFormula(tree, bounds);
  if (!validation.ok) {
    throw new Error(
      `evaluateFormula: invalid formula (${validation.errors.map((e) => e.code).join(", ")})`,
    );
  }
  const result = evalNode(tree, vars);
  if (typeof result === "number" && !Number.isFinite(result)) {
    return Number.NaN;
  }
  return result;
}
