// supabase/functions/_shared/memory/extractContract.ts
// FP-06 Step 3 — pure contract for chat long-term-memory extraction (TECH-SPEC §4.3, §7.6).
// Refs: FP-06 FR-4, FR-5, FR-6, FR-15; TECH-SPEC §4.1–4.3, §7.6, §10.5, §11; D5, D6, D20.
// Pure (jest-loadable): no Deno.env, no service client — the IO half lives in extract.ts /
// runExtract.ts (the journal extractContract/extract/runChain split, same reason).
//
// Provenance is what makes the purge trustworthy: a fact whose `source_message_id` is not
// one of the slice's message ids is a hard reject — never a rewrite. The purge handler
// (FP-06 Step 2) soft-deletes by `source_message_id`, so a fact citing anything else would
// survive the flag it exists to honor.

import { registerStubShapeFactory } from "../llm/stubShapes.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

// ============================================================================
// Contract: the §4.3 chunk response schema
// ============================================================================

/** One durable fact about the user, citing the message that reveals it. */
export interface ChunkFact {
  text: string;
  source_message_id: string;
}

/** The chunk extraction result — the §4.3 chat-memory contract. */
export interface ChatFactsResult {
  facts: ChunkFact[];
  openness_delta: number; // -5..5
}

/** One message of the slice handed to the extractor (rendered by `buildChatFactsPrompt`). */
export interface ChunkMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ISO-8601 — carried into the prompt so the model can weigh recency. */
  created_at?: string;
}

/** Bounds [SPEC readings]: 0–32 facts per slice (an 8-message window rarely holds more). */
export const MAX_FACTS_PER_SLICE = 32;
/** [SPEC reading] §4.3 family text bound, mirroring the journal contract's 5–500. */
export const MIN_FACT_CHARS = 5;
export const MAX_FACT_CHARS = 500;
/** The slice bound: at most this many messages per extraction call (prompt bound). */
export const SLICE_SIZE = 32;

/** JSON Schema handed to the provider as the per-call §4.3 contract. */
export const CHAT_FACTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      description:
        "Durable facts about the user worth remembering long-term (0–32 items, 5–500 chars each), each citing the id of the message that reveals it.",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          source_message_id: { type: "string" },
        },
        required: ["text", "source_message_id"],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: MAX_FACTS_PER_SLICE,
    },
    openness_delta: {
      type: "integer",
      minimum: -5,
      maximum: 5,
      description: "Change in openness vs baseline: -5 closed .. +5 open.",
    },
  },
  required: ["facts", "openness_delta"],
  additionalProperties: false,
};

/** Structural validator for the parsed response (the `isExtractResult` pattern). */
export function isChatFactsResult(parsed: unknown): parsed is ChatFactsResult {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.facts)) return false;
  for (const f of o.facts) {
    if (typeof f !== "object" || f === null) return false;
    const fact = f as Record<string, unknown>;
    if (typeof fact.text !== "string") return false;
    if (typeof fact.source_message_id !== "string") return false;
  }
  if (typeof o.openness_delta !== "number") return false;
  return true;
}

/**
 * Bounds + provenance validator — returns an empty array on success, else the error list
 * (the corrected-re-output pattern: one retry with the errors in the prompt). The
 * provenance arm is the hard reject: every `source_message_id` must be one of the slice's
 * message ids. Never a rewrite — an off-slice citation fails the call.
 */
export function validateChatFacts(
  parsed: ChatFactsResult,
  sliceIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  if (parsed.facts.length > MAX_FACTS_PER_SLICE) {
    errors.push(`facts count ${parsed.facts.length} exceeds ${MAX_FACTS_PER_SLICE}`);
  }
  for (const fact of parsed.facts) {
    if (fact.text.length < MIN_FACT_CHARS || fact.text.length > MAX_FACT_CHARS) {
      errors.push(`fact text length ${fact.text.length} not in [${MIN_FACT_CHARS}, ${MAX_FACT_CHARS}]`);
    }
    if (!sliceIds.has(fact.source_message_id)) {
      errors.push(
        `source_message_id ${fact.source_message_id} is not one of the slice's message ids (fact provenance is a hard reject, never a rewrite)`,
      );
    }
  }
  if (parsed.openness_delta < -5 || parsed.openness_delta > 5) {
    errors.push(`openness_delta ${parsed.openness_delta} not in [-5, 5]`);
  }
  return errors;
}

// ============================================================================
// Stub shape (dynamic — the canned facts must cite the slice's real ids)
// ============================================================================

/** The stub factory's context — the slice's message ids, oldest first. */
export interface ChatFactsStubContext {
  sliceIds: string[];
}

/**
 * Deterministic canned facts for stub mode: one citing the slice's first message and one
 * citing its last (both per-slice ids, so the provenance validator genuinely passes;
 * a static payload could not — this is the FP-06 Step 3 dynamic arm of `stubShapes`).
 */
export function chatFactsStubPayload(context: unknown): ChatFactsResult {
  const ctx = context as Partial<ChatFactsStubContext> | null | undefined;
  const ids = Array.isArray(ctx?.sliceIds)
    ? ctx!.sliceIds!.filter((x): x is string => typeof x === "string")
    : [];
  const facts: ChunkFact[] = [];
  if (ids.length > 0) {
    facts.push({ text: "The user shared an update about how the day has gone.", source_message_id: ids[0] });
  }
  if (ids.length > 1) {
    facts.push({ text: "The user mentioned a routine worth remembering.", source_message_id: ids[ids.length - 1] });
  }
  return { facts, openness_delta: 0 };
}

// Register at import so the adapter dispatches this shape instead of asserting the §4.2 one
// (validator identity — the FP-04 Step 3a lesson).
registerStubShapeFactory(isChatFactsResult, chatFactsStubPayload);

// ============================================================================
// Prompt
// ============================================================================

/**
 * System prompt for chunk extraction. The slice's messages are rendered with role markers
 * and ids inside `<user_message>` delimiters (§10.5); the injection guard rides every
 * prompt (§10, AGENTS.md §4.6).
 */
export const CHAT_FACTS_SYSTEM = `You are an internal memory-extraction module for a life-coaching app. Your output is
never shown to the person. Read the conversation slice inside the <user_message> tags and
extract the durable facts about the USER worth remembering long-term — life context, goals,
constraints, preferences, history. Each fact must cite, in source_message_id, the id of the
message that reveals it. Record only what the user's own words establish or clearly imply;
never record Davos's own phrasings, questions, or advice, and never invent facts. Return an
empty facts array when the slice holds nothing durable. Also give an openness delta for the
slice as a whole (-5 closed .. +5 open, 0 baseline).

${INJECTION_GUARD}`;

/** Render the slice, oldest first, with role markers and ids the model can cite. */
export function buildChatFactsPrompt(messages: ChunkMessage[]): string {
  const lines = messages.map((m) => {
    const when = m.created_at ? ` at ${m.created_at}` : "";
    return `<message id="${m.id}" role="${m.role}"${when}>\n${m.content}\n</message>`;
  });
  return `<user_message>\nConversation slice (oldest first):\n${lines.join("\n")}\n</user_message>`;
}

// ============================================================================
// The call (injected so the pure combinator is unit-testable)
// ============================================================================

export type ChunkGenerate = <T>(request: GenerateRequest<T>) => Promise<AdapterResult<T>>;

function defaultWarn(entry: { tag: string; reason: string; error?: string }): void {
  console.warn(JSON.stringify(entry));
}

const CHUNK_LOG_TAG = "[memory-extract]";

/**
 * Run one slice's extraction with bounded retry (§4.2): exactly one extra attempt on a
 * structural failure (parse, shape, bounds, or provenance), with the errors injected into
 * the retry prompt. Transport failures fail immediately — the adapter already exhausted
 * both tiers. Throws on final failure — the handler catches and marks the job failed.
 */
export async function extractChunkWith(
  gen: ChunkGenerate,
  messages: ChunkMessage[],
  opts: { warn?: (entry: { tag: string; reason: string; error?: string }) => void } = {},
): Promise<ChatFactsResult> {
  const warn = opts.warn ?? defaultWarn;
  const sliceIds = new Set(messages.map((m) => m.id));

  const request: GenerateRequest<ChatFactsResult> = {
    system: CHAT_FACTS_SYSTEM,
    messages: [{ role: "user", content: buildChatFactsPrompt(messages) }],
    schema: CHAT_FACTS_SCHEMA,
    validate: isChatFactsResult,
    stubContext: { sliceIds: messages.map((m) => m.id) } satisfies ChatFactsStubContext,
  };

  let last: AdapterResult<ChatFactsResult> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await gen(request);
    last = res;
    if (res.ok) {
      if (!res.data) throw new Error("Chunk extraction succeeded but data is missing");
      const errs = validateChatFacts(res.data, sliceIds);
      if (errs.length === 0) {
        return res.data;
      }
      if (attempt === 0) {
        warn({ tag: CHUNK_LOG_TAG, reason: "validation", error: errs.join("; ") });
        request.messages[0].content =
          buildChatFactsPrompt(messages) +
          `\n\n[VALIDATION ERRORS — correct and re-output ONLY the JSON:\n${errs.join("\n")}\n]`;
        continue;
      }
      warn({ tag: CHUNK_LOG_TAG, reason: "validation", error: errs.join("; ") });
      throw new Error(`Chunk extraction validation failed after retry: ${errs.join("; ")}`);
    }
    if (res.kind === "transport") {
      warn({ tag: CHUNK_LOG_TAG, reason: "transport", error: res.error });
      throw new Error(`Chunk extraction transport failure: ${res.error}`);
    }
    if (attempt === 0) {
      warn({ tag: CHUNK_LOG_TAG, reason: res.kind ?? "parse", error: res.error });
      request.messages[0].content =
        buildChatFactsPrompt(messages) +
        `\n\n[VALIDATION ERROR — re-output ONLY valid JSON matching the schema.]`;
      continue;
    }
    warn({ tag: CHUNK_LOG_TAG, reason: res.kind ?? "parse", error: res.error });
    throw new Error(`Chunk extraction failed after retry: ${res.error}`);
  }
  throw new Error(`Chunk extraction failed: ${last?.error ?? "unknown"}`);
}

// ============================================================================
// Backlog derivation + slicing (pure — consumed by runExtract.ts at job time)
// ============================================================================

/** One aged-out message candidate, as read from `messages`. */
export interface BacklogMessage extends ChunkMessage {
  role: "user" | "assistant";
  unsavable: boolean;
  created_at: string;
}

/**
 * The backlog (FR-4): candidates older than the sliding-window cutoff, minus flagged
 * messages (`unsavable=true` — step 7.6's extraction skip) and minus messages some fact
 * row already cites (`source_message_id`), because a cited message was extracted even if
 * its facts were later purged — a purged message never re-extracts. Oldest first, ties by
 * id, so slices are stable across runs.
 */
export function deriveBacklog(
  candidates: BacklogMessage[],
  citedMessageIds: ReadonlySet<string>,
): BacklogMessage[] {
  return candidates
    .filter((m) => m.unsavable !== true)
    .filter((m) => !citedMessageIds.has(m.id))
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** Split the backlog into ≤ `size`-message slices (the prompt bound; oldest first). */
export function sliceBacklog<T>(messages: T[], size: number = SLICE_SIZE): T[][] {
  const slices: T[][] = [];
  for (let i = 0; i < messages.length; i += size) {
    slices.push(messages.slice(i, i + size));
  }
  return slices;
}
