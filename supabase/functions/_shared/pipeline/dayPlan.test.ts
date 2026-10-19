// supabase/functions/_shared/pipeline/dayPlan.test.ts
// FP-05 Step 6 — unit tests for the day-plan resolver and renderer (TECH-SPEC §7.2, §5.1).
// Refs: FP-05 FR-12, FR-13, FR-14; PRD §3.1; D14.
// Jest globals declared inline (parseEnergy.test.ts precedent) so this tree loads under jest
// without importing the jest package (tsconfig excludes supabase/functions).

import {
  toMinutes,
  resolveCurrentFreeBlock,
  renderDayPlanPromptContext,
  type AnchorPlanAnchor,
  type DayPlanContextInput,
} from "./dayPlan.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// supabase/functions, and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  not: {
    toBeNull(): void;
    toContain(expected: unknown): void;
  };
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("toMinutes (HH:mm -> minutes since midnight)", () => {
  it("parses HH:MM", () => {
    expect(toMinutes("09:00")).toBe(540);
    expect(toMinutes("23:59")).toBe(1439);
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("13:30")).toBe(810);
  });
  it("parses H:MM (single-digit hour)", () => {
    expect(toMinutes("9:00")).toBe(540);
  });
  it("rejects invalid format", () => {
    expect(toMinutes("not-a-time")).toBe(-1);
    expect(toMinutes("25:00")).toBe(-1);
    expect(toMinutes("12:60")).toBe(-1);
    expect(toMinutes("")).toBe(-1);
  });
});

describe("resolveCurrentFreeBlock (finds containing free/boredom block)", () => {
  const anchors: readonly AnchorPlanAnchor[] = [
    { start: "07:00", end: "09:00", label: "Morning routine", kind: "routine" },
    { start: "09:00", end: "11:00", label: "Deep work", kind: "commitment" },
    { start: "11:00", end: "12:00", label: "Free block", kind: "free_block" },
    { start: "12:00", end: "13:00", label: "Lunch", kind: "routine" },
    { start: "13:00", end: "15:00", label: "Boredom relief", kind: "boredom_relief" },
    { start: "15:00", end: "17:00", label: "Meeting", kind: "deadline" },
  ];

  it("returns free_block when inside [start, end)", () => {
    // 11:30 UTC in UTC timezone = 11:30 local
    const ms = Date.parse("2026-10-19T11:30:00Z");
    const block = resolveCurrentFreeBlock(anchors, ms, "UTC");
    expect(block).not.toBeNull();
    expect(block?.label).toBe("Free block");
  });
  it("returns boredom_relief when inside [start, end)", () => {
    // 14:00 UTC in UTC timezone = 14:00 local
    const ms = Date.parse("2026-10-19T14:00:00Z");
    const block = resolveCurrentFreeBlock(anchors, ms, "UTC");
    expect(block).not.toBeNull();
    expect(block?.label).toBe("Boredom relief");
  });
  it("returns null when in commitment block", () => {
    // 10:00 UTC = 10:00 local (in commitment)
    const ms = Date.parse("2026-10-19T10:00:00Z");
    const block = resolveCurrentFreeBlock(anchors, ms, "UTC");
    expect(block).toBeNull();
  });
  it("returns null when in routine block", () => {
    // 08:00 UTC = 08:00 local (in routine)
    const ms = Date.parse("2026-10-19T08:00:00Z");
    const block = resolveCurrentFreeBlock(anchors, ms, "UTC");
    expect(block).toBeNull();
  });
  it("start inclusive, end exclusive: exactly at start returns block", () => {
    const ms = Date.parse("2026-10-19T11:00:00Z");
    const block = resolveCurrentFreeBlock(anchors, ms, "UTC");
    expect(block?.label).toBe("Free block");
  });
  it("start inclusive, end exclusive: exactly at end returns null", () => {
    const ms = Date.parse("2026-10-19T12:00:00Z");
    const block = resolveCurrentFreeBlock(anchors, ms, "UTC");
    expect(block).toBeNull();
  });
  it("ignores non-free/boredom kinds (commitment, deadline, routine)", () => {
    // 10:00 is in commitment, 16:00 in deadline
    const ms1 = Date.parse("2026-10-19T10:00:00Z");
    const ms2 = Date.parse("2026-10-19T16:00:00Z");
    expect(resolveCurrentFreeBlock(anchors, ms1, "UTC")).toBeNull();
    expect(resolveCurrentFreeBlock(anchors, ms2, "UTC")).toBeNull();
  });
  it("returns null for empty anchors", () => {
    const ms = Date.parse("2026-10-19T11:30:00Z");
    expect(resolveCurrentFreeBlock([], ms, "UTC")).toBeNull();
  });
  it("returns null for non-array anchors", () => {
    const ms = Date.parse("2026-10-19T11:30:00Z");
    expect(resolveCurrentFreeBlock(null as any, ms, "UTC")).toBeNull();
  });
  it("tolerates malformed anchor entries", () => {
    const badAnchors: readonly AnchorPlanAnchor[] = [
      { start: "bad", end: "time", label: "X", kind: "free_block" },
      { start: "11:00", end: "12:00", label: "Good", kind: "free_block" },
    ];
    const ms = Date.parse("2026-10-19T11:30:00Z");
    const block = resolveCurrentFreeBlock(badAnchors, ms, "UTC");
    expect(block?.label).toBe("Good");
  });
  it("handles UTC+5:30 (Asia/Kolkata) — 23:30Z = 05:00 next day", () => {
    // 23:30 UTC = 05:00 next day in UTC+5:30
    // Our anchors are for the day of the plan; this tests the time conversion
    const ms = Date.parse("2026-10-19T23:30:00Z");
    // In UTC+5:30 this is 05:00 on 2026-10-20, so no block matches
    const block = resolveCurrentFreeBlock(anchors, ms, "Asia/Kolkata");
    expect(block).toBeNull();
  });
  it("handles UTC-5 (America/New_York) — 02:00Z = 21:00 previous day", () => {
    // 02:00 UTC = 21:00 previous day in EST (UTC-5)
    const ms = Date.parse("2026-10-20T02:00:00Z");
    // 21:00 is outside our anchor range (07:00-17:00)
    const block = resolveCurrentFreeBlock(anchors, ms, "America/New_York");
    expect(block).toBeNull();
  });
});

describe("renderDayPlanPromptContext (builds the prompt rider)", () => {
  const anchors: readonly AnchorPlanAnchor[] = [
    { start: "09:00", end: "11:00", label: "Deep work", kind: "commitment" },
    { start: "11:00", end: "12:00", label: "Free block", kind: "free_block" },
    { start: "13:00", end: "15:00", label: "Boredom relief", kind: "boredom_relief" },
  ];

  const baseInput: DayPlanContextInput = {
    anchors,
    currentFreeBlock: null,
    energy: null,
  };

  it("renders anchors block with time, label, kind", () => {
    const out = renderDayPlanPromptContext(baseInput);
    expect(out).toContain("09:00-11:00 Deep work (commitment)");
    expect(out).toContain("11:00-12:00 Free block (free_block)");
    expect(out).toContain("13:00-15:00 Boredom relief (boredom_relief)");
  });
  it("renders the rescheduling contract: complete set, today only, approval, no mutation", () => {
    const out = renderDayPlanPromptContext(baseInput);
    expect(out).toContain("Rescheduling: this list is today only, and it is the complete set of blocks.");
    expect(out).toContain("Moving or cancelling any block needs the user's conversational approval.");
    expect(out).toContain(
      "You cannot edit the plan and nothing said in chat changes it — never imply it did.",
    );
    // The previous text mixed speakers: "your approval" addressed the model while "I don't mutate"
    // spoke as the assistant *inside a system prompt*. Both are gone.
    expect(out).not.toContain("moves require your conversational approval");
    expect(out).not.toContain("I don't mutate");
  });
  it("renders the unknown-block correction rule (false-premise guard)", () => {
    const out = renderDayPlanPromptContext(baseInput);
    expect(out).toContain(
      "If they refer to a block, task or time that is not listed, say in one blunt sentence that it is not in today's plan, and do not guess what they meant.",
    );
  });
  it("renders the fuzzy-match rule (typos and paraphrases still resolve)", () => {
    const out = renderDayPlanPromptContext(baseInput);
    expect(out).toContain("If it plausibly matches a listed block, treat it as that block.");
  });
  it("forces the anchor match into tactical_analysis before the reply", () => {
    const out = renderDayPlanPromptContext(baseInput);
    expect(out).toContain(
      "When the message concerns the plan, begin tactical_analysis with the listed anchor it refers to, or NONE.",
    );
  });
  it("does not dispute the user's facts about what they are actually doing", () => {
    const out = renderDayPlanPromptContext(baseInput);
    expect(out).toContain("If the user says what they are actually doing, believe them");
  });
  it("keeps the chars oracle the drill and the live gate rely on", () => {
    const one: readonly AnchorPlanAnchor[] = [
      { start: "20:02", end: "23:52", label: "Post a moview session.", kind: "free_block" },
    ];
    const base = renderDayPlanPromptContext({ anchors: one, currentFreeBlock: null, energy: null });
    // Base moved 184 -> 732 with the 2026-10-19 wording change; the +75 / +46 band deltas did not.
    expect(base.length).toBe(732);
    const low = renderDayPlanPromptContext({ anchors: one, currentFreeBlock: one[0], energy: 2 });
    const high = renderDayPlanPromptContext({ anchors: one, currentFreeBlock: one[0], energy: 9 });
    const mid = renderDayPlanPromptContext({ anchors: one, currentFreeBlock: one[0], energy: 5 });
    expect(low.length - base.length).toBe(75);
    expect(high.length - base.length).toBe(46);
    expect(mid.length - base.length).toBe(0);
  });
  it("no JIT line when energy null", () => {
    const out = renderDayPlanPromptContext({ ...baseInput, energy: null });
    expect(out).not.toContain("Energy low");
    expect(out).not.toContain("Energy high");
  });
  it("no JIT line when not in free/boredom block", () => {
    const out = renderDayPlanPromptContext({ ...baseInput, energy: 2 });
    expect(out).not.toContain("Energy low");
    expect(out).not.toContain("Energy high");
  });
  it("JIT low energy (1-3) in free block", () => {
    const out = renderDayPlanPromptContext({
      ...baseInput,
      currentFreeBlock: anchors[1],
      energy: 2,
    });
    expect(out).toContain("Energy low (1–3)");
    expect(out).toContain("low-cognitive task or a boredom-relief item");
  });
  it("JIT high energy (8-10) in free block", () => {
    const out = renderDayPlanPromptContext({
      ...baseInput,
      currentFreeBlock: anchors[1],
      energy: 9,
    });
    expect(out).toContain("Energy high (8–10)");
    expect(out).toContain("tackle a heavy task now");
  });
  it("no JIT line for mid energy (4-7) in free block", () => {
    const out = renderDayPlanPromptContext({
      ...baseInput,
      currentFreeBlock: anchors[1],
      energy: 5,
    });
    expect(out).not.toContain("Energy low");
    expect(out).not.toContain("Energy high");
  });
  it("JIT line in boredom_relief block", () => {
    const out = renderDayPlanPromptContext({
      ...baseInput,
      currentFreeBlock: anchors[2],
      energy: 2,
    });
    expect(out).toContain("Energy low (1–3)");
  });
  it("empty anchors renders 'none saved yet'", () => {
    const out = renderDayPlanPromptContext({ ...baseInput, anchors: [] });
    expect(out).toContain("Today's plan anchors: none saved yet.");
  });
});

describe("Golden-string test: no-plan fixture produces exact FP-04 prompt (conceptual)", () => {
  it("documenting the rider gating requirement", () => {
    // The actual golden-string test is in the live gate script.
    // Here we just assert the renderer produces deterministic output.
    const input: DayPlanContextInput = {
      anchors: [{ start: "09:00", end: "10:00", label: "Work", kind: "commitment" }],
      currentFreeBlock: null,
      energy: null,
    };
    const out1 = renderDayPlanPromptContext(input);
    const out2 = renderDayPlanPromptContext(input);
    expect(out1).toBe(out2);
  });
});