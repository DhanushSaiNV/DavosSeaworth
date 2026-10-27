// supabase/functions/_shared/pipeline/generate.prompt.test.ts
// FP-09 Step 3 — the prompt-builder branch that keeps the interview rule-free without
// changing the unflagged FP-08 prompt (FR-4, AC-2).
//
// Refs: FP-09 FR-4, AC-2; TECH-SPEC §4.2, §5.1, §7.7; D17.
// Jest globals are declared inline (tsconfig excludes supabase/functions).

import { buildSystemPrompt, type GenerateStageInput } from "./generatePrompt.ts";
import { buildOnboardingInstruction, stagePlan, type StageCounts } from "../onboarding/state.ts";

interface Expectation {
  toContain(expected: string): void;
  not: {
    toContain(expected: string): void;
    toMatch(pattern: RegExp): void;
  };
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: string) => Expectation;

const COUNTS: StageCounts = { intro: 1, baseline: 3, goals: 3, routine: 4, metric_selection: 0 };

const BASE: GenerateStageInput = {
  route: "auto",
  persona: "mentor_tough",
  domain: "Health",
  rules: [],
  userText: "I wake at six thirty.",
};

const INTERVIEW = buildOnboardingInstruction({
  stage: "baseline",
  plan: stagePlan("baseline", COUNTS),
  action: { kind: "question", n: 2 },
  advanceTo: null,
  config: COUNTS,
});

describe("buildSystemPrompt (FP-09 Step 3)", () => {
  it("keeps the unflagged branch exactly on the rules path", () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain(
      "Relevant coaching rules: none retrieved for this turn.",
    );
  });

  it("removes the rules block entirely on an interview turn", () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      omitRules: true,
      interviewContext: INTERVIEW,
    });
    expect(prompt).not.toContain("Relevant coaching rules");
    expect(prompt).not.toContain("none retrieved");
    expect(prompt).toContain("Onboarding interview");
  });

  it("keeps the interview prompt free of habit/watch/impulse vocabulary", () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      omitRules: true,
      interviewContext: INTERVIEW,
    });
    expect(prompt).not.toMatch(/habit|watch|impulse/i);
  });

  it("places the interview instruction before the memory block", () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      omitRules: true,
      interviewContext: INTERVIEW,
      memoryContext: "<recalled_memory>MEMORY_SENTINEL</recalled_memory>",
    });
    const interviewAt = prompt.indexOf("Onboarding interview");
    const memoryAt = prompt.indexOf("MEMORY_SENTINEL");
    expect(prompt).toContain("Onboarding interview");
    expect(prompt).toContain("MEMORY_SENTINEL");
    if (interviewAt < 0 || memoryAt < 0 || interviewAt >= memoryAt) {
      throw new Error("interview instruction must precede the memory block");
    }
  });
});
