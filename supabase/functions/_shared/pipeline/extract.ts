// supabase/functions/_shared/pipeline/extract.ts
// Pipeline stage 1 — Context/State Extraction (sync, LLM-lite). §4.3 per-turn sync
// extraction contract. Runs in parallel with stage 2.
//
// FP-02 consumes none of these fields yet — the contract is carried for stability so
// later features (trust/topic/lockdown) need no stage-1 rework (FP-02 §2).

import { generate, type AdapterResult } from "../llm/adapter.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";

/** §4.3 per-turn sync extraction contract. */
export interface IntentFlags {
  give_up: boolean;
  false_constraint: boolean;
  concession: boolean;
  quit_commitment: boolean;
  admission: boolean;
}

export interface ExtractionResult {
  intent_flags: IntentFlags;
  openness_delta: number; // int -5..5
  topic: string;
}

const INTENT_FLAG_KEYS: Array<keyof IntentFlags> = [
  "give_up",
  "false_constraint",
  "concession",
  "quit_commitment",
  "admission",
];

export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intent_flags: {
      type: "object",
      properties: Object.fromEntries(INTENT_FLAG_KEYS.map((k) => [k, { type: "boolean" }])),
      required: INTENT_FLAG_KEYS,
    },
    openness_delta: { type: "integer", minimum: -5, maximum: 5 },
    topic: { type: "string" },
  },
  required: ["intent_flags", "openness_delta", "topic"],
};

export function isExtractionResult(parsed: unknown): parsed is ExtractionResult {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  const flags = o.intent_flags as Record<string, unknown> | undefined;
  if (typeof flags !== "object" || flags === null) return false;
  if (!INTENT_FLAG_KEYS.every((k) => typeof flags[k] === "boolean")) return false;
  if (typeof o.openness_delta !== "number") return false;
  return typeof o.topic === "string";
}

const EXTRACTION_SYSTEM = `You are an internal analysis module for a life-coaching app. Your output is never
shown to the user. Extract the structured signals from the user's message exactly as
specified by the schema.

${INJECTION_GUARD}

Intent flags — set true only when clearly present:
- give_up: the person signals they are abandoning a goal or effort.
- false_constraint: the person states a limiting belief presented as an external fact
  that is actually self-imposed ("I have no time", "I'm just not that kind of person").
- concession: the person concedes a point raised with them.
- quit_commitment: the person commits to quitting a bad habit or behavior.
- admission: the person acknowledges a truth about themselves.

openness_delta: your read of how much candor this message shows, from -5 (guarded) to
5 (highly open). topic: a short noun phrase for what the message is about.`;

/**
 * Stage 1. Returns the adapter result as-is; callers treat failure as non-fatal
 * (the fields are not consumed in FP-02, so a failed extraction must not block a reply).
 */
export async function extract(text: string): Promise<AdapterResult<ExtractionResult>> {
  return generate<ExtractionResult>({
    system: EXTRACTION_SYSTEM,
    messages: [{ role: "user", content: `<user_message>\n${text}\n</user_message>` }],
    schema: EXTRACTION_SCHEMA,
    validate: isExtractionResult,
  });
}
