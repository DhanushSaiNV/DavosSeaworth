// supabase/functions/_shared/journal/anchorContract.ts
// FP-05 Step 5 — pure contract for anchor plan generation (TECH-SPEC §7.2, §4.2, §7.9).
// Refs: FP-05 FR-9, FR-10, FR-11, FR-16; TECH-SPEC §3.4, §4.2, §7.2, §7.9, §10.5; D14, D16.
// Pure (jest-loadable): no Deno.env, no service client — the IO half lives in anchor.ts / runChain.ts.

import { registerStubShape } from "../llm/stubShapes.ts";
import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

// ============================================================================
// Contract: the §4.2-anchored schema extended with the plan
// ============================================================================

/** Anchor kinds per §3.4. */
export type AnchorKind = "commitment" | "deadline" | "routine" | "free_block" | "boredom_relief";

/** One anchor in the day plan. */
export interface AnchorPlanAnchor {
  start: string;      // HH:mm 24h user-local
  end: string;        // HH:mm 24h user-local
  label: string;      // ≤ 80 chars
  kind: AnchorKind;
}

/** The anchor plan result — §4.2 generation contract extended with anchors[]. */
export interface AnchorPlanResult {
  tactical_analysis: string;
  direct_quote: string;
  persona: string;
  anchors: AnchorPlanAnchor[];
}

/** JSON Schema handed to the provider as the per-call contract. */
export const ANCHOR_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tactical_analysis: { type: "string", description: "Internal reasoning — never shown to the person." },
    direct_quote: { type: "string", description: "Davos's summary in his voice, concise, referencing the anchors." },
    persona: { type: "string", description: "The locked persona key (from config anchor_plan_persona)." },
    anchors: {
      type: "array",
      description: "Day plan anchors (1–12 items).",
      items: {
        type: "object",
        properties: {
          start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Start HH:mm 24h user-local" },
          end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "End HH:mm 24h user-local" },
          label: { type: "string", maxLength: 80, description: "Short label for the block" },
          kind: { type: "string", enum: ["commitment", "deadline", "routine", "free_block", "boredom_relief"] },
        },
        required: ["start", "end", "label", "kind"],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 12,
    },
  },
  required: ["tactical_analysis", "direct_quote", "persona", "anchors"],
  additionalProperties: false,
};

/** Structural validator for the parsed anchor plan response. */
export function isAnchorPlanResult(parsed: unknown): parsed is AnchorPlanResult {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  if (typeof o.tactical_analysis !== "string") return false;
  if (typeof o.direct_quote !== "string") return false;
  if (typeof o.persona !== "string") return false;
  if (!Array.isArray(o.anchors)) return false;
  const anchors = o.anchors as Array<Record<string, unknown>>;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (typeof anchor !== "object" || anchor === null) return false;
    if (typeof anchor.start !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(anchor.start)) return false;
    if (typeof anchor.end !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(anchor.end)) return false;
    if (typeof anchor.label !== "string" || anchor.label.length === 0 || anchor.label.length > 80) return false;
    if (!["commitment", "deadline", "routine", "free_block", "boredom_relief"].includes(anchor.kind as string)) return false;
    // start < end
    const [sh, sm] = anchor.start.split(":").map(Number);
    const [eh, em] = anchor.end.split(":").map(Number);
    if (sh * 60 + sm >= eh * 60 + em) return false;
  }
  // Pairwise overlap check
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i];
      const b = anchors[j];
      const [ash, asm] = (a.start as string).split(":").map(Number);
      const [aeh, aem] = (a.end as string).split(":").map(Number);
      const [bsh, bsm] = (b.start as string).split(":").map(Number);
      const [beh, bem] = (b.end as string).split(":").map(Number);
      const aStart = ash * 60 + asm;
      const aEnd = aeh * 60 + aem;
      const bStart = bsh * 60 + bsm;
      const bEnd = beh * 60 + bem;
      if (aStart < bEnd && bStart < aEnd) return false;
    }
  }
  return true;
}

/** Bounds validator — returns empty array on success, else list of error strings.
 *  Enables the corrected-re-output pattern (one retry with the error list in the prompt). */
export function validateAnchorPlan(parsed: AnchorPlanResult): string[] {
  const errors: string[] = [];
  if (parsed.anchors.length < 1 || parsed.anchors.length > 12) {
    errors.push(`anchors count ${parsed.anchors.length} not in [1, 12]`);
  }
  for (let i = 0; i < parsed.anchors.length; i++) {
    const a = parsed.anchors[i];
    const [sh, sm] = a.start.split(":").map(Number);
    const [eh, em] = a.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin >= endMin) {
      errors.push(`anchor ${i}: start ${a.start} not before end ${a.end}`);
    }
    if (a.label.length > 80) {
      errors.push(`anchor ${i}: label length ${a.label.length} > 80`);
    }
  }
  // Pairwise overlap check
  for (let i = 0; i < parsed.anchors.length; i++) {
    for (let j = i + 1; j < parsed.anchors.length; j++) {
      const a = parsed.anchors[i];
      const b = parsed.anchors[j];
      const [ash, asm] = a.start.split(":").map(Number);
      const [aeh, aem] = a.end.split(":").map(Number);
      const [bsh, bsm] = b.start.split(":").map(Number);
      const [beh, bem] = b.end.split(":").map(Number);
      const aStart = ash * 60 + asm;
      const aEnd = aeh * 60 + aem;
      const bStart = bsh * 60 + bsm;
      const bEnd = beh * 60 + bem;
      if (aStart < bEnd && bStart < aEnd) {
        errors.push(`anchors ${i} and ${j} overlap: ${a.start}-${a.end} vs ${b.start}-${b.end}`);
      }
    }
  }
  return errors;
}

/** Stub-mode canned answer (§4.1 dispatch): a simple valid plan. */
export const ANCHOR_PLAN_STUB_RESULT: AnchorPlanResult = {
  tactical_analysis: "STUB: Plan generated for tomorrow with one free block.",
  direct_quote: "STUB: Here's your plan — 9-11am deep work, 11-12 free block, 1-3pm meeting.",
  persona: "mentor_tough",
  anchors: [
    { start: "09:00", end: "11:00", label: "Deep work on project", kind: "commitment" },
    { start: "11:00", end: "12:00", label: "Free block", kind: "free_block" },
    { start: "13:00", end: "15:00", label: "Team meeting", kind: "deadline" },
  ],
};

// Register at import so the adapter dispatches this shape instead of asserting the §4.2 one.
registerStubShape(isAnchorPlanResult, ANCHOR_PLAN_STUB_RESULT);

// ============================================================================
// Pure calendar helper
// ============================================================================

/** Compute the next calendar day from a YYYY-MM-DD string using UTC math.
 *  No timezone drift — month/year boundaries wrap cleanly. */
export function nextDayDate(entryDateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entryDateStr);
  if (!m) throw new Error(`Invalid entry_date format: ${entryDateStr}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const next = new Date(Date.UTC(y, mo, d + 1));
  const y2 = next.getUTCFullYear();
  const mo2 = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(next.getUTCDate()).padStart(2, "0");
  return `${y2}-${mo2}-${d2}`;
}

// ============================================================================
// Prompt
// ============================================================================

/** System prompt for anchor plan generation. */
export const ANCHOR_PLAN_SYSTEM = `You are an internal planning module for a life-coaching app. Your output is never
shown to the person. Build tomorrow's day plan from the journal entry, the extraction output,
the person's routine, wake/sleep times, active habits, and goals. Answer exactly the schema.

${INJECTION_GUARD}

Input you will receive (all times are in the person's local timezone):
- Journal entry (inside <user_message> tags)
- Extraction output: insights, vagueness score, severity, openness delta, admission flag
- Routine (fixed weekly commitments)
- Wake time / Sleep time
- Active habits (status not cancelled/quit_committed)
- Non-archived metrics (goals)
- Tomorrow's date (YYYY-MM-DD)

Instructions:
- Hard commitments, deadlines, and routines become anchors.
- Free blocks and boredom-relief items are scheduled by the plan itself — you decide when they fit.
- The plan must cover the waking day (wake_time to sleep_time) with no gaps.
- Each anchor: start/end as HH:mm 24h, label ≤ 80 chars, kind ∈ {commitment, deadline, routine, free_block, boredom_relief}.
- 1–12 anchors total. No overlaps. start < end for each.
- The direct_quote is Davos's summary in his voice: concise, referencing the anchors.
- Persona is locked via config (anchor_plan_persona).`;

export interface AnchorPlanInput {
  entryText: string;
  extraction: {
    insights: { text: string }[];
    vagueness_score: number;
    severity: "S1" | "S2" | "S3";
    openness_delta: number;
    admission_flag: boolean;
  };
  routine: Record<string, unknown>;
  wake_time: string | null;
  sleep_time: string | null;
  habits: Array<{ description: string; status: string }>;
  metrics: Array<{ name: string; target: unknown }>;
  timezone: string;
  plan_date: string; // YYYY-MM-DD (tomorrow)
}

export function buildAnchorPlanPrompt(input: AnchorPlanInput): string {
  const habitLines = input.habits.length > 0
    ? input.habits.map(h => `- ${h.description} (${h.status})`).join("\n")
    : "No active habits.";
  const metricLines = input.metrics.length > 0
    ? input.metrics.map(m => `- ${m.name}: ${JSON.stringify(m.target)}`).join("\n")
    : "No active goals.";
  const routineStr = JSON.stringify(input.routine, null, 2);

  return (
    `<user_message>\n${input.entryText}\n</user_message>\n\n` +
    `Extraction:\n` +
    `- Insights: ${input.extraction.insights.map(i => i.text).join("; ")}\n` +
    `- Vagueness: ${input.extraction.vagueness_score}\n` +
    `- Severity: ${input.extraction.severity}\n` +
    `- Openness delta: ${input.extraction.openness_delta}\n` +
    `- Admission: ${input.extraction.admission_flag}\n\n` +
    `Routine:\n${routineStr}\n\n` +
    `Wake: ${input.wake_time ?? "not set"}\n` +
    `Sleep: ${input.sleep_time ?? "not set"}\n\n` +
    `Active habits:\n${habitLines}\n\n` +
    `Goals:\n${metricLines}\n\n` +
    `Timezone: ${input.timezone}\n` +
    `Plan date: ${input.plan_date}`
  );
}

// ============================================================================
// The call (injected so the pure combinator is unit-testable)
// ============================================================================

export type AnchorPlanGenerate = <T>(request: GenerateRequest<T>) => Promise<AdapterResult<T>>;

function defaultWarn(entry: { tag: string; reason: string; error?: string }): void {
  console.warn(JSON.stringify(entry));
}

/**
 * Run the anchor plan generation with one corrected re-output (§7.9).
 * On validator failure: exactly one retry with error list in prompt.
 * Second failure → fail-soft (throw).
 * Transport failures fail open immediately.
 */
export async function anchorPlanWith(
  gen: AnchorPlanGenerate,
  input: AnchorPlanInput,
  opts: { warn?: (entry: { tag: string; reason: string; error?: string }) => void } = {},
): Promise<AnchorPlanResult> {
  const warn = opts.warn ?? defaultWarn;
  const ANCHOR_LOG_TAG = "[anchor-plan]";

  const request: GenerateRequest<AnchorPlanResult> = {
    system: ANCHOR_PLAN_SYSTEM,
    messages: [{ role: "user", content: buildAnchorPlanPrompt(input) }],
    schema: ANCHOR_PLAN_SCHEMA,
    validate: isAnchorPlanResult,
  };

  let correctedRetries = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await gen(request);
    if (res.ok) {
      if (!res.data) throw new Error("Anchor plan generation succeeded but data is missing");
      const errs = validateAnchorPlan(res.data);
      if (errs.length === 0) {
        return { ...res.data, correctedRetries }; // attach for logging
      }
      // First validator failure → one corrected re-output
      if (attempt === 0) {
        correctedRetries = 1;
        warn({ tag: ANCHOR_LOG_TAG, reason: "validation", error: errs.join("; ") });
        const retryPrompt = buildAnchorPlanPrompt(input) + `\n\n[VALIDATION ERRORS — correct and re-output ONLY the JSON:\n${errs.join("\n")}\n]`;
        request.messages[0].content = retryPrompt;
        continue;
      }
      // Second failure → fail-soft
      warn({ tag: ANCHOR_LOG_TAG, reason: "validation", error: errs.join("; ") });
      throw new Error(`Anchor plan validation failed after retry: ${errs.join("; ")}`);
    }
    if (res.kind === "transport") {
      // Transport failure — fail-soft (no plan row, warning logged)
      warn({ tag: ANCHOR_LOG_TAG, reason: "transport", error: res.error });
      throw new Error(`Anchor plan transport failure: ${res.error}`);
    }
    // Parse/validation failure on first attempt → one retry
    if (attempt === 0) {
      warn({ tag: ANCHOR_LOG_TAG, reason: res.kind ?? "parse", error: res.error });
      const retryPrompt = buildAnchorPlanPrompt(input) + `\n\n[VALIDATION ERROR — re-output ONLY valid JSON matching the schema.]`;
      request.messages[0].content = retryPrompt;
      continue;
    }
    warn({ tag: ANCHOR_LOG_TAG, reason: res.kind ?? "parse", error: res.error });
    throw new Error(`Anchor plan failed after retry: ${res.error}`);
  }
  throw new Error(`Anchor plan failed: unexpected loop exit`);
}

// Attach correctedRetries to the result type for logging
declare module "./anchorContract.ts" {
  interface AnchorPlanResult {
    correctedRetries?: number;
  }
}