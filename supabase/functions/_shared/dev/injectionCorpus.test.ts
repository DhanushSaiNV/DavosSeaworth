// supabase/functions/_shared/dev/injectionCorpus.test.ts
// Unit tests for the FP-10 injection corpus structure and invariants.
// Jest globals are declared inline because tsconfig excludes supabase/functions.

import { INJECTION_CORPUS, type InjectionClass, type InjectionEntryPoint } from "./injectionCorpus.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toMatch(expected: RegExp): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("injectionCorpus", () => {
  it("contains unique payload IDs", () => {
    const ids = INJECTION_CORPUS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("contains unique high-entropy markers prefixed with ZQWK-07-", () => {
    const markers = INJECTION_CORPUS.map((p) => p.marker);
    const uniqueMarkers = new Set(markers);
    expect(uniqueMarkers.size).toBe(markers.length);
    for (const marker of markers) {
      expect(marker.startsWith("ZQWK-07-")).toBe(true);
    }
  });

  it("covers all 6 injection classes", () => {
    const classes = new Set(INJECTION_CORPUS.map((p) => p.class));
    const expectedClasses: InjectionClass[] = [
      "direct_override",
      "delimiter_escape",
      "roleplay_hijack",
      "instruction_in_extracted_fact",
      "instruction_in_rule_text",
      "instruction_in_profile_field",
    ];
    for (const expected of expectedClasses) {
      expect(classes.has(expected)).toBe(true);
    }
  });

  it("covers key user-text entry points", () => {
    const entryPoints = new Set(INJECTION_CORPUS.map((p) => p.entryPoint));
    const expectedPoints: InjectionEntryPoint[] = [
      "chat",
      "checkin",
      "journal",
      "onboarding",
      "oath",
      "proactive_context",
    ];
    for (const pt of expectedPoints) {
      expect(entryPoints.has(pt)).toBe(true);
    }
  });

  it("every payload contains its designated marker in its text", () => {
    for (const payload of INJECTION_CORPUS) {
      expect(payload.text.includes(payload.marker)).toBe(true);
    }
  });
});
