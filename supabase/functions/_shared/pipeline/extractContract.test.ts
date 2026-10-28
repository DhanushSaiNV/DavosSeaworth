// supabase/functions/_shared/pipeline/extractContract.test.ts
// FP-09 Step 2 — the §4.3 chat contract extension: golden unflagged prompt, the
// optional onboarding block, per-field fail-open, and the stub factory (FR-2, AC-2).
// Refs: FP-09 FR-2, AC-2; TECH-SPEC §4.1–4.3, §7.6, §7.7; D6, D14, D17, D22.
// Jest globals declared inline so this tree loads without importing the jest package.

import { INJECTION_GUARD } from "../prompts/guardrails.ts";
import { selectStubPayload } from "../llm/stubShapes.ts";
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_STUB_RESULT,
  EXTRACTION_SYSTEM,
  buildExtractionSchema,
  buildExtractionSystem,
  isExtractionResult,
  normalizeOnboardingBlock,
  type ExtractionResult,
} from "./extractContract.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toContain(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BASE: ExtractionResult = {
  intent_flags: {
    give_up: false,
    false_constraint: false,
    concession: false,
    quit_commitment: false,
    admission: false,
  },
  openness_delta: 0,
  topic: "work",
};

// The exact FP-08 baseline. This literal is the golden floor: any edit to the base
// prompt fails here before it can change a non-onboarding turn.
const GOLDEN_UNFLAGGED_PROMPT = `You are an internal analysis module for a life-coaching app. Your output is never
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

describe("§4.3 base contract (golden floor)", () => {
  it("keeps the unflagged system prompt byte-identical", () => {
    expect(EXTRACTION_SYSTEM).toBe(GOLDEN_UNFLAGGED_PROMPT);
    expect(buildExtractionSystem(false)).toBe(GOLDEN_UNFLAGGED_PROMPT);
    expect(buildExtractionSystem(false).includes("onboarding")).toBe(false);
  });

  it("keeps the unflagged schema frozen and free of the onboarding property", () => {
    expect(buildExtractionSchema(false)).toBe(EXTRACTION_SCHEMA);
    const properties = (EXTRACTION_SCHEMA as { properties: Record<string, unknown> })
      .properties;
    expect(properties.onboarding).toBeUndefined();
  });

  it("appends the onboarding appendix only when flagged", () => {
    const flagged = buildExtractionSystem(true);
    expect(flagged.startsWith(EXTRACTION_SYSTEM)).toBe(true);
    expect(flagged).toContain("wake_time / sleep_time");
    expect(flagged).toContain("routine_summary");
    expect(flagged).toContain("high_dopamine_activities");
    expect(flagged).toContain("baseline_facts");
    expect(flagged).toContain("anchor-plan");
  });

  it("adds one optional onboarding object to the flagged schema", () => {
    const base = EXTRACTION_SCHEMA as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const flagged = buildExtractionSchema(true) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const onboarding = flagged.properties.onboarding as {
      properties: Record<string, unknown>;
    };
    expect(flagged.required).toEqual(base.required);
    expect(Object.keys(onboarding.properties).sort()).toEqual(
      [
        "wake_time",
        "sleep_time",
        "routine_summary",
        "high_dopamine_activities",
        "baseline_facts",
      ].sort(),
    );
  });
});

describe("isExtractionResult (tolerant structural validator)", () => {
  it("accepts the base result with no onboarding block", () => {
    expect(isExtractionResult(BASE)).toBe(true);
    expect(isExtractionResult({ ...BASE, onboarding: null })).toBe(true);
  });

  it("accepts a malformed field value so the sanitizer can fail open", () => {
    expect(
      isExtractionResult({
        ...BASE,
        onboarding: { wake_time: "7:00", high_dopamine_activities: ["x"] },
      }),
    ).toBe(true);
  });

  it("rejects a non-object onboarding block", () => {
    expect(isExtractionResult({ ...BASE, onboarding: "block" })).toBe(false);
    expect(isExtractionResult({ ...BASE, onboarding: [] })).toBe(false);
  });

  it("still rejects a missing base field", () => {
    expect(isExtractionResult({ intent_flags: BASE.intent_flags, topic: "x" })).toBe(false);
    expect(isExtractionResult({ ...BASE, topic: 4 })).toBe(false);
  });
});

describe("normalizeOnboardingBlock (per-field fail-open)", () => {
  it("keeps a valid block and trims string fields", () => {
    const result = normalizeOnboardingBlock({
      wake_time: "07:00",
      sleep_time: "23:30",
      routine_summary: "  Morning walk, focused work, evening review.  ",
      high_dopamine_activities: ["  short video clips  ", "sweets"],
      baseline_facts: ["  Works as a software engineer  "],
    });
    expect(result.warnings).toEqual([]);
    expect(result.block).toEqual({
      wake_time: "07:00",
      sleep_time: "23:30",
      routine_summary: "Morning walk, focused work, evening review.",
      high_dopamine_activities: ["short video clips", "sweets"],
      baseline_facts: ["Works as a software engineer"],
    });
  });

  it("skips a malformed HH:mm with one warning and keeps the other fields", () => {
    const result = normalizeOnboardingBlock({
      wake_time: "7:00",
      sleep_time: "24:00",
      routine_summary: "Morning walk.",
    });
    expect(result.warnings).toEqual([
      { field: "wake_time", code: "invalid_time" },
      { field: "sleep_time", code: "invalid_time" },
    ]);
    expect(result.block).toEqual({ routine_summary: "Morning walk." });
  });

  it("skips an empty or oversized routine summary", () => {
    expect(normalizeOnboardingBlock({ routine_summary: "   " })).toEqual({
      block: null,
      warnings: [{ field: "routine_summary", code: "invalid_length" }],
    });
    expect(normalizeOnboardingBlock({ routine_summary: "x".repeat(1001) })).toEqual({
      block: null,
      warnings: [{ field: "routine_summary", code: "invalid_length" }],
    });
  });

  it("drops the whole activities field when any item or the count is bad", () => {
    expect(
      normalizeOnboardingBlock({ high_dopamine_activities: ["short video clips", "x"] }),
    ).toEqual({
      block: null,
      warnings: [{ field: "high_dopamine_activities", code: "invalid_activity" }],
    });
    expect(normalizeOnboardingBlock({ high_dopamine_activities: [] })).toEqual({
      block: null,
      warnings: [{ field: "high_dopamine_activities", code: "invalid_length" }],
    });
    expect(
      normalizeOnboardingBlock({
        high_dopamine_activities: ["a2345", "b2345", "c2345", "d2345", "e2345", "f2345"],
      }),
    ).toEqual({
      block: null,
      warnings: [{ field: "high_dopamine_activities", code: "too_many" }],
    });
  });

  it("drops only the invalid baseline facts and keeps valid ones", () => {
    const result = normalizeOnboardingBlock({
      baseline_facts: ["Works as a software engineer", "four", "x".repeat(501)],
    });
    expect(result.block).toEqual({
      baseline_facts: ["Works as a software engineer"],
    });
    expect(result.warnings).toEqual([
      { field: "baseline_facts", code: "invalid_fact", index: 1 },
      { field: "baseline_facts", code: "invalid_fact", index: 2 },
    ]);
  });

  it("caps baseline facts at five, dedupes, and warns once for the overflow", () => {
    const result = normalizeOnboardingBlock({
      baseline_facts: [
        "Works as a software engineer",
        "Training for a half marathon",
        "Lives in Bengaluru",
        "Has two siblings",
        "Wakes before seven",
        "Runs a small side project",
      ],
    });
    expect(result.warnings).toEqual([{ field: "baseline_facts", code: "too_many" }]);
    expect(result.block?.baseline_facts?.length).toBe(5);

    const deduped = normalizeOnboardingBlock({
      baseline_facts: ["Training for a half marathon", "Training for a half marathon"],
    });
    expect(deduped.warnings).toEqual([]);
    expect(deduped.block?.baseline_facts).toEqual(["Training for a half marathon"]);
  });

  it("returns null for an absent block and warns on a structurally invalid one", () => {
    expect(normalizeOnboardingBlock(undefined)).toEqual({ block: null, warnings: [] });
    expect(normalizeOnboardingBlock(null)).toEqual({ block: null, warnings: [] });
    expect(normalizeOnboardingBlock("nope")).toEqual({
      block: null,
      warnings: [{ field: "onboarding", code: "invalid_type" }],
    });
  });

  it("ignores unknown fields without inventing a block", () => {
    expect(normalizeOnboardingBlock({ favorite_color: "blue" })).toEqual({
      block: null,
      warnings: [],
    });
  });
});

describe("stub factory (validator identity)", () => {
  it("emits a populated, valid block when the turn is flagged", () => {
    const payload = selectStubPayload({
      validate: isExtractionResult,
      stubContext: { onboarding: true },
    });
    expect(isExtractionResult(payload)).toBe(true);
    const result = payload as ExtractionResult;
    expect(result.onboarding?.wake_time).toBe("07:00");
    expect(normalizeOnboardingBlock(result.onboarding).warnings).toEqual([]);
    expect(normalizeOnboardingBlock(result.onboarding).block?.baseline_facts?.length).toBe(2);
  });

  it("emits the base result when unflagged", () => {
    const payload = selectStubPayload({ validate: isExtractionResult });
    expect(payload).toEqual(EXTRACTION_STUB_RESULT);
    expect((payload as ExtractionResult).onboarding).toBeUndefined();
    const explicitFalse = selectStubPayload({
      validate: isExtractionResult,
      stubContext: { onboarding: false },
    });
    expect(explicitFalse).toEqual(EXTRACTION_STUB_RESULT);
  });
});
