// supabase/functions/_shared/rag/planner.ts
// P3 — the plan contract: what the model may ask for, and what is accepted back.
//
// Refs: PRD §5.1 (purpose), §5.2 (inputs), §5.3 (output contract and validation rules),
// §5.4 (behaviour rules), §4.4 (one planning call, combined with extraction), §14.1 C1/C4;
// PLAN.md §3 (planner rides the extraction response — no extra provider request), §11.2
// (planner schema, `priority` is required), §11.3 (the rank), §12.2, D8, D9.
//
// Pure: no adapter, no client, no config, no clock. Three exports matter:
//
//   buildPlannerInstruction()  the system-prompt appendix — the §5.4 rules plus a dataset
//                              catalogue generated from `registry.ts`, so the prompt cannot
//                              drift from the allowlist it describes;
//   buildPlannerSchema()       the JSON schema of the `rag_plan` block, also generated from
//                              the registry;
//   parsePlan()                the validator. It answers "is this a plan the executor may
//                              run?", never "is this a good plan".
//
// The split matters because the two halves are consumed at different times: the instruction and
// the schema go into the extraction request (one provider call for both stages, PLAN.md §3), and
// `parsePlan` runs on the parsed response. Argument-level validation is deliberately *not* here —
// `executor.ts` does that at dispatch, so a plan is never trusted twice over (PLAN.md §6.2).

import {
  DATASETS,
  REGISTRY,
  SEMANTIC_TOOLS,
  specFor,
} from "./registry.ts";
import type { FilterSpec } from "./registry.ts";
import type {
  AnswerMode,
  DatasetName,
  Operation,
  PlanEntry,
  Priority,
  RagIntent,
  RagPlan,
} from "./types.ts";

// ---------------------------------------------------------------------------- vocabularies

/** PRD §5.3 `intent`, "such as" — the PRD's list, closed. */
export const PLANNER_INTENTS: readonly RagIntent[] = [
  "conversation",
  "explanation",
  "personal_reflection",
  "personalized_advice",
  "progress_review",
  "decision_support",
  "factual_recall",
];

/** PRD §5.3 `answer_mode`, closed. */
export const ANSWER_MODES: readonly AnswerMode[] = [
  "conversational",
  "explanation",
  "personalized_analysis",
  "decision_support",
  "clarification",
];

/** PLAN.md §11.3 item 1. The order is the rank; `priorityRank` in `evidence.ts` is the same. */
export const PRIORITIES: readonly Priority[] = [
  "essential",
  "primary",
  "supporting",
  "optional",
];

/** PLAN.md §11.2: `purpose` is "<= 120 chars; which part of the user's question this answers". */
export const PURPOSE_MAX_CHARS = 120;

/** Every key a request object may carry. Anything else is rejected, never ignored (D9). */
export const PLAN_REQUEST_KEYS = ["dataset", "op", "priority", "purpose", "arguments"] as const;

/** Every operation any dataset exposes, in a stable order, for the schema's `op` enum. */
const ALL_OPERATIONS: readonly Operation[] = [
  "list",
  "count",
  "aggregate",
  "timeseries",
  "latest",
  "read_one",
  "search",
];

/** Every dimension any dataset allows, for the schema's `group_by` enum. */
const ALL_DIMENSIONS: readonly string[] = [
  ...new Set(
    [...DATASETS, ...SEMANTIC_TOOLS].flatMap((name) => [...specFor(name).dimensions]),
  ),
];

// ---------------------------------------------------------------------------- catalogue

function filterText(filter: FilterSpec): string {
  switch (filter.kind) {
    case "enum":
    case "scalar_enum":
      return `${filter.key} (one of: ${(filter.values ?? []).join(", ")})`;
    case "int": {
      const min = filter.min ?? 0;
      const max = filter.max ?? 0;
      return `${filter.key} (integer ${min}..${max})`;
    }
    case "bool":
      return `${filter.key} (true/false)`;
    case "uuid_list":
      return `${filter.key} (uuid list)`;
    default:
      return `${filter.key} (text list)`;
  }
}

/**
 * One catalogue line per dataset, generated from the registry. This is the only place the prompt
 * learns what exists: adding a filter to `registry.ts` updates the instruction and the schema
 * together, and a dataset the registry does not carry cannot be described.
 */
function catalogueLine(name: DatasetName): string {
  const spec = specFor(name);
  const bits: string[] = [`ops ${spec.ops.join("|")}`];

  const ranges = spec.ranges.map(
    (range) => `${range.from}+${range.to}${range.required ? " (required)" : ""}`,
  );
  if (ranges.length > 0) bits.push(`dates ${ranges.join(", ")}`);

  if (spec.filters.length > 0) {
    bits.push(`filters ${spec.filters.map(filterText).join(", ")}`);
  }
  if (spec.dimensions.length > 0) bits.push(`group_by ${spec.dimensions.join("|")}`);
  if (spec.buckets.length > 0) bits.push(`bucket ${spec.buckets.join("|")}`);
  bits.push(`limit 1..${spec.limitMax}`);
  if (spec.contentMaxRows !== undefined) {
    bits.push(`content is capped at ${spec.contentMaxRows} rows`);
  }
  if (spec.requiresOneOf !== undefined) {
    bits.push(`one of ${spec.requiresOneOf.join("/")} is required`);
  }
  return `- ${name}: ${bits.join("; ")}`;
}

export function plannerCatalogue(): string {
  return [...DATASETS, ...SEMANTIC_TOOLS].map(catalogueLine).join("\n");
}

// ---------------------------------------------------------------------------- instruction

/**
 * The planning appendix. Appended to `EXTRACTION_SYSTEM` on a planner-eligible turn, so the
 * `INJECTION_GUARD` already in that prompt covers it and is not repeated here.
 *
 * Rules 1-10 are PRD §5.4 verbatim in intent. The priority paragraph is PLAN.md §11.3 item 1 and
 * exists because the allocator spends a fixed character budget by rank: a plan that marks
 * everything `essential` cannot be served.
 */
export function buildPlannerInstruction(): string {
  return `Retrieval plan — decide what evidence this turn needs before it is answered.

You are not answering the question. You are deciding which approved datasets, if any, the
answer depends on. Return the plan in the "rag_plan" field of this same response.

Rules:
1. Request personal data only when the answer materially depends on it.
2. Use the structured datasets for counts, trends, comparisons, schedules and known records.
3. Use memory_search for recalled personal context that no structured filter can express.
4. Use rules_search for decisions, recommendations and behaviour guidance when a principle
   could materially improve the answer.
5. Do not request rules for every ordinary message. Most turns need none.
6. Request only the dimensions and date ranges the question needs.
7. Prefer aggregate or timeseries over raw-row list for trend questions.
8. Never infer an unavailable metric from a nearby one.
9. Never request raw message or journal text; those datasets return metadata only.
10. An empty result is evidence that the data is missing, not permission to guess.

Available datasets and what each accepts:
${plannerCatalogue()}

Every request carries a priority, because a fixed evidence budget is spent in rank order:
- essential: the answer is wrong without it.
- primary: the answer is materially better with it.
- supporting: useful context.
- optional: nice to have; dropped first.
Mark at most one request essential. Dates are YYYY-MM-DD, resolved in the person's profile
timezone. "purpose" is one short sentence naming the part of the question the request answers,
never your reasoning. If no retrieval is needed, set retrieval_required to false and leave
retrieval_requests empty.`;
}

// ---------------------------------------------------------------------------- schema

function argumentsSchema(): Record<string, unknown> {
  return {
    type: "object",
    description:
      "Validated per dataset; unknown keys are rejected. See the dataset catalogue.",
    properties: {
      filters: {
        type: "object",
        description:
          "Allowlisted filter keys for the chosen dataset. Values are arrays for list filters " +
          "and scalars for single-valued ones.",
      },
      group_by: {
        type: "array",
        items: { type: "string", enum: [...ALL_DIMENSIONS] },
        maxItems: 3,
      },
      bucket: { type: "string", enum: ["day", "week", "month"] },
      metrics: {
        type: "array",
        description: 'Metric selectors such as [{"op":"count"}] or [{"op":"avg","field":"energy"}].',
        items: {
          type: "object",
          properties: {
            op: { type: "string" },
            field: { type: "string" },
          },
          required: ["op"],
        },
      },
      limit: { type: "integer", minimum: 1 },
    },
  };
}

/**
 * The JSON schema of the `rag_plan` block, for the extraction request's structured output.
 *
 * `dataset`, `op`, `priority`, `intent` and `answer_mode` are closed enums; `arguments` is an open
 * object because the fifteen datasets share no filter vocabulary and Gemini's restricted Schema
 * proto cannot express a per-dataset union without duplicating the registry into the wire schema
 * (D14). The catalogue in the instruction carries the per-dataset detail, and `executor.ts`
 * rejects anything the catalogue did not allow.
 *
 * `maxRequests` comes from `config.rag_max_plan_requests` — never hardcoded. When it is absent the
 * schema omits `maxItems` and the dispatcher's deterministic trim is the only ceiling.
 */
export function buildPlannerSchema(options: { maxRequests?: number } = {}): Record<string, unknown> {
  const maxRequests = options.maxRequests;
  return {
    type: "object",
    properties: {
      intent: { type: "string", enum: [...PLANNER_INTENTS] },
      retrieval_required: { type: "boolean" },
      retrieval_requests: {
        type: "array",
        ...(maxRequests !== undefined && maxRequests > 0 ? { maxItems: maxRequests } : {}),
        items: {
          type: "object",
          properties: {
            dataset: {
              type: "string",
              enum: [...DATASETS, ...SEMANTIC_TOOLS],
            },
            op: { type: "string", enum: [...ALL_OPERATIONS] },
            priority: { type: "string", enum: [...PRIORITIES] },
            purpose: { type: "string", minLength: 1, maxLength: PURPOSE_MAX_CHARS },
            arguments: argumentsSchema(),
          },
          required: ["dataset", "op", "priority", "purpose"],
        },
      },
      answer_mode: { type: "string", enum: [...ANSWER_MODES] },
    },
    required: ["intent", "retrieval_required", "retrieval_requests", "answer_mode"],
  };
}

// ---------------------------------------------------------------------------- validation

/**
 * Why a plan was refused. The two `unsupported_*` members are spelled exactly as the executor's
 * reasons so a caller can log one vocabulary for both stages.
 */
export type PlanFailure =
  | "plan_not_object"
  | "invalid_intent"
  | "invalid_answer_mode"
  | "invalid_retrieval_flag"
  | "retrieval_required_mismatch"
  | "requests_not_array"
  | "invalid_request"
  | "unknown_request_key"
  | "invalid_priority"
  | "purpose_invalid"
  | "unsupported_dataset"
  | "unsupported_operation";

export type PlanOutcome =
  | { ok: true; plan: RagPlan }
  | { ok: false; reason: PlanFailure; detail?: string };

function refuse(reason: PlanFailure, detail?: string): PlanOutcome {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(raw: unknown): PlanEntry | PlanFailure {
  if (!isPlainObject(raw)) return "invalid_request";

  // An unknown request key is a rejection, not an omission (D9): a model that emits `tool` or
  // `sql` is following a different contract, and running the rest of its plan would hide that.
  for (const key of Object.keys(raw)) {
    if (!(PLAN_REQUEST_KEYS as readonly string[]).includes(key)) return "unknown_request_key";
  }

  const dataset = raw.dataset;
  if (typeof dataset !== "string" || !(dataset in REGISTRY)) return "unsupported_dataset";

  const spec = specFor(dataset as DatasetName);
  const op = raw.op;
  if (typeof op !== "string" || !spec.ops.includes(op as Operation)) return "unsupported_operation";

  const priority = raw.priority;
  if (typeof priority !== "string" || !PRIORITIES.includes(priority as Priority)) {
    return "invalid_priority";
  }

  const purpose = raw.purpose;
  if (typeof purpose !== "string") return "purpose_invalid";
  const trimmed = purpose.trim();
  if (trimmed.length === 0 || trimmed.length > PURPOSE_MAX_CHARS) return "purpose_invalid";

  const args = raw.arguments;
  if (args !== undefined && args !== null && !isPlainObject(args)) return "invalid_request";

  return {
    dataset: dataset as DatasetName,
    op: op as Operation,
    priority: priority as Priority,
    purpose: trimmed,
    arguments: (args ?? {}) as PlanEntry["arguments"],
  };
}

/**
 * PRD §5.3, in order. The wrapper is checked before the requests so a malformed envelope never
 * produces a half-validated array, and `retrieval_required` is cross-checked against the array in
 * both directions: a plan that says "no retrieval" while asking for two datasets would otherwise
 * execute queries the model has disowned, and one that says "retrieval required" with nothing
 * requested would let the answer imply evidence that was never gathered.
 */
export function parsePlan(raw: unknown): PlanOutcome {
  if (!isPlainObject(raw)) return refuse("plan_not_object");

  const intent = raw.intent;
  if (typeof intent !== "string" || !PLANNER_INTENTS.includes(intent as RagIntent)) {
    return refuse("invalid_intent", typeof intent === "string" ? intent : undefined);
  }

  const answerMode = raw.answer_mode;
  if (typeof answerMode !== "string" || !ANSWER_MODES.includes(answerMode as AnswerMode)) {
    return refuse("invalid_answer_mode", typeof answerMode === "string" ? answerMode : undefined);
  }

  const required = raw.retrieval_required;
  if (typeof required !== "boolean") return refuse("invalid_retrieval_flag");

  const requests = raw.retrieval_requests;
  if (!Array.isArray(requests)) return refuse("requests_not_array");

  if (!required && requests.length > 0) return refuse("retrieval_required_mismatch");
  if (required && requests.length === 0) return refuse("retrieval_required_mismatch");

  const entries: PlanEntry[] = [];
  for (let i = 0; i < requests.length; i += 1) {
    const parsed = parseRequest(requests[i]);
    if (typeof parsed === "string") return refuse(parsed, `request[${i}]`);
    entries.push(parsed);
  }

  return {
    ok: true,
    plan: {
      intent: intent as RagIntent,
      retrieval_required: required,
      retrieval_requests: entries,
      answer_mode: answerMode as AnswerMode,
    },
  };
}

/**
 * A plan that cannot be read is the same as a plan that asked for nothing: the turn is answered
 * without evidence and the caller records the reason (PRD line 369, "record a non-sensitive
 * validation event"). Exported so the caller never re-implements that mapping.
 */
export function noRetrievalPlan(intent: RagIntent = "conversation"): RagPlan {
  return {
    intent,
    retrieval_required: false,
    retrieval_requests: [],
    answer_mode: "conversational",
  };
}
