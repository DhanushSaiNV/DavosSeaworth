// supabase/functions/_shared/checkin/parseEnergy.test.ts
// Unit tests for the §7.1 energy parse and the FR-7 capture→source map — FP-04 AC-2 (unit level).
// Refs: TECH-SPEC §7.1, §3.2; FP-04 FR-6, FR-7; GLOSSARY §14 (`Doings source`).
//
// This tree is type-checked by `deno check` and executed by jest (`bands.test.ts` precedent),
// so the jest globals are declared rather than imported.

import { parseEnergy, sourceForCapture } from "./parseEnergy.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toBeNull(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("parseEnergy (AC-2 table)", () => {
  it("reads a trailing standalone integer 1-10", () => {
    expect(parseEnergy("finished the report, drained 4")).toBe(4);
    expect(parseEnergy("energy 10")).toBe(10);
    expect(parseEnergy("1")).toBe(1);
    expect(parseEnergy("10")).toBe(10);
  });

  it("returns null when there is no trailing 1-10 integer", () => {
    expect(parseEnergy("worked 10 hrs")).toBeNull();
    expect(parseEnergy("level 0")).toBeNull();
    expect(parseEnergy("score 11")).toBeNull();
    expect(parseEnergy("no number here")).toBeNull();
    expect(parseEnergy("")).toBeNull();
  });

  it("tolerates trailing whitespace", () => {
    expect(parseEnergy("drained 4   ")).toBe(4);
    expect(parseEnergy("drained 4\t")).toBe(4);
  });

  it("requires a word boundary, so a digit glued to a word is not energy", () => {
    // Without `\b`, "around4" would parse as 4 — the field would read a number the user
    // never offered as a score.
    expect(parseEnergy("around4")).toBeNull();
  });
});

describe("sourceForCapture (FR-7)", () => {
  it("maps the notification reply to `checkin_reply` and the chat path to `chat`", () => {
    expect(sourceForCapture("reply")).toBe("checkin_reply");
    expect(sourceForCapture("chat")).toBe("chat");
  });
});
