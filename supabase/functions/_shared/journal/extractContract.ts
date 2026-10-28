// supabase/functions/_shared/journal/extractContract.ts
// FP-05 Step 3 — pure contract for journal extraction (TECH-SPEC §4.3, §7.4, §11).
// Refs: FP-05 FR-4, FR-5, FR-6, FR-16; TECH-SPEC §4.1–4.3, §7.4, §10.5, §11; D5, D16, D20.
// Pure (jest-loadable): no Deno.env, no service client — the IO half lives in extract.ts / runChain.ts.

import { registerStubShape } from "../llm/stubShapes.ts";
import { escapePromptText } from "../prompts/delimiters.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

// ============================================================================
// Contract: the §4.3 journal response schema
// ============================================================================

/** One extracted insight from the journal entry. */
export interface ExtractInsight {
  text: string;
}

/** The extraction result — the §4.3 journal contract. */
export interface ExtractResult {
  insights: ExtractInsight[];
  vagueness_score: number;   // 0..1
  severity: "S1" | "S2" | "S3";
  openness_delta: number;    // -5..5
  admission_flag: boolean;
  /** FP-08 FR-5: the entry describes a negative behavior the writer keeps failing at. */
  habit_flag: boolean;
}

/** JSON Schema handed to the provider as the per-call §4.3 contract. */
export const EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      description: "Key insights extracted from the entry (1–10 items, 5–500 chars each).",
      items: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      minItems: 1,
      maxItems: 10,
    },
    vagueness_score: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "How vague the entry is: 0 = specific/dense, 1 = entirely vague.",
    },
    severity: {
      type: "string",
      enum: ["S1", "S2", "S3"],
      description: "Severity per §11 criteria: S1 crisis, S2 severe distress, S3 standard.",
    },
    openness_delta: {
      type: "integer",
      minimum: -5,
      maximum: 5,
      description: "Change in openness vs baseline: -5 closed .. +5 open.",
    },
    admission_flag: {
      type: "boolean",
      description: "True when the entry contains a substantive admission (quit intent, substance, harm).",
    },
    habit_flag: {
      type: "boolean",
      description:
        "True when the entry describes a negative behavior the writer keeps failing at (a recurring pattern, not a one-off bad day).",
    },
  },
  required: [
    "insights",
    "vagueness_score",
    "severity",
    "openness_delta",
    "admission_flag",
    "habit_flag",
  ],
  additionalProperties: false,
};

/** Structural validator for the parsed extraction response (the `isEvalResult` pattern). */
export function isExtractResult(parsed: unknown): parsed is ExtractResult {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.insights)) return false;
  for (const ins of o.insights) {
    if (typeof ins !== "object" || ins === null) return false;
    const i = ins as Record<string, unknown>;
    if (typeof i.text !== "string") return false;
  }
  if (typeof o.vagueness_score !== "number") return false;
  if (!["S1", "S2", "S3"].includes(o.severity as string)) return false;
  if (typeof o.openness_delta !== "number") return false;
  if (typeof o.admission_flag !== "boolean") return false;
  if (typeof o.habit_flag !== "boolean") return false;
  return true;
}

/** Bounds validator — returns empty array on success, else list of error strings.
 *  Enables the corrected-re-output pattern (one retry with the error list in the prompt). */
export function validateExtract(parsed: ExtractResult): string[] {
  const errors: string[] = [];
  if (parsed.insights.length < 1 || parsed.insights.length > 10) {
    errors.push(`insights count ${parsed.insights.length} not in [1, 10]`);
  }
  for (const ins of parsed.insights) {
    if (ins.text.length < 5 || ins.text.length > 500) {
      errors.push(`insight text length ${ins.text.length} not in [5, 500]`);
    }
  }
  if (parsed.vagueness_score < 0 || parsed.vagueness_score > 1) {
    errors.push(`vagueness_score ${parsed.vagueness_score} not in [0, 1]`);
  }
  if (parsed.openness_delta < -5 || parsed.openness_delta > 5) {
    errors.push(`openness_delta ${parsed.openness_delta} not in [-5, 5]`);
  }
  return errors;
}

/** Stub-mode canned answer (§4.1 dispatch): a clear S3 entry so the probe gate is exercised. */
export const EXTRACT_STUB_RESULT: ExtractResult = {
  insights: [{ text: "User reflected on a productive work session and plans to continue tomorrow." }],
  vagueness_score: 0.2,
  severity: "S3",
  openness_delta: 1,
  admission_flag: false,
  habit_flag: false,
};

// Register at import so the adapter dispatches this shape instead of asserting the §4.2 one.
registerStubShape(isExtractResult, EXTRACT_STUB_RESULT);

// ============================================================================
// Prompt
// ============================================================================

/** System prompt for journal extraction — severity rubric inlined from §11. */
export const EXTRACT_SYSTEM = `You are an internal analysis module for a life-coaching app. Your output is never
shown to the person. Read the journal entry inside the <user_message> tags, then answer exactly
the schema with: insights (1–10 specific observations), a vagueness score (0–1), a severity label,
an openness delta (-5..5), an admission flag, and a habit flag.
A habit flag is true only when the entry describes a negative behavior the writer keeps failing
at — a recurring pattern, not a single bad day or a one-off lapse.

${INJECTION_GUARD}

Severity rubric (must be applied literally):
- S1 — Crisis: self-harm/suicidal ideation/intent to harm others. If present, severity MUST be S1.
- S2 — Severe distress: sustained hopelessness/withdrawal; substance-abuse admission; acute loss events. If present and no S1, severity MUST be S2.
- S3 — Standard: all other entries.

Vagueness score: 0 = concrete, specific, detailed; 1 = entirely vague, no specifics.
Openness delta: -5 (completely closed/defensive) to +5 (unusually open/vulnerable). Baseline is 0.
Admission flag: true only for a substantive admission (quit intent, substance use, self-harm disclosure, harm to others). Not for ordinary negative feelings.`;

export function buildExtractPrompt(entryText: string): string {
  return `<user_message>\n${escapePromptText(entryText)}\n</user_message>`;
}

// ============================================================================
// The call (injected so the pure combinator is unit-testable)
// ============================================================================

export type ExtractGenerate = <T>(request: GenerateRequest<T>) => Promise<AdapterResult<T>>;

function defaultWarn(entry: { tag: string; reason: string; error?: string }): void {
  console.warn(JSON.stringify(entry));
}

/**
 * Run the extraction with bounded retry (§4.2): exactly one extra attempt on structural failure.
 * Transport failures fail open immediately (the adapter already exhausted both tiers).
 * Throws on final failure — the handler catches and marks the job failed.
 */
export async function extractWith(
  gen: ExtractGenerate,
  entryText: string,
  opts: { warn?: (entry: { tag: string; reason: string; error?: string }) => void } = {},
): Promise<ExtractResult> {
  const warn = opts.warn ?? defaultWarn;
  const EXTRACT_LOG_TAG = "[journal-extract]";

  const request: GenerateRequest<ExtractResult> = {
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: buildExtractPrompt(entryText) }],
    schema: EXTRACT_SCHEMA,
    validate: isExtractResult,
  };

  let last: AdapterResult<ExtractResult> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await gen(request);
    last = res;
    if (res.ok) {
      // Bounds check (corrected-re-output pattern)
      if (!res.data) throw new Error("Extraction succeeded but data is missing");
      const errs = validateExtract(res.data);
      if (errs.length === 0) {
        return res.data;
      }
      // Structural failure → one retry with errors in the prompt
      if (attempt === 0) {
        warn({ tag: EXTRACT_LOG_TAG, reason: "validation", error: errs.join("; ") });
        // Inject errors into the user message for the retry
        const retryPrompt = buildExtractPrompt(entryText) + `\n\n[VALIDATION ERRORS — correct and re-output ONLY the JSON:\n${errs.join("\n")}\n]`;
        request.messages[0].content = retryPrompt;
        continue;
      }
      // Second failure → fail
      warn({ tag: EXTRACT_LOG_TAG, reason: "validation", error: errs.join("; ") });
      throw new Error(`Extraction validation failed after retry: ${errs.join("; ")}`);
    }
    if (res.kind === "transport") {
      // Transport failure — adapter already tried both tiers; fail open at once
      warn({ tag: EXTRACT_LOG_TAG, reason: "transport", error: res.error });
      throw new Error(`Extraction transport failure: ${res.error}`);
    }
    // Parse/validation failure on first attempt → one retry
    if (attempt === 0) {
      warn({ tag: EXTRACT_LOG_TAG, reason: res.kind ?? "parse", error: res.error });
      const retryPrompt = buildExtractPrompt(entryText) + `\n\n[VALIDATION ERROR — re-output ONLY valid JSON matching the schema.]`;
      request.messages[0].content = retryPrompt;
      continue;
    }
    warn({ tag: EXTRACT_LOG_TAG, reason: res.kind ?? "parse", error: res.error });
    throw new Error(`Extraction failed after retry: ${res.error}`);
  }
  // Should not reach here, but satisfy TS
  throw new Error(`Extraction failed: ${last?.error ?? "unknown"}`);
}