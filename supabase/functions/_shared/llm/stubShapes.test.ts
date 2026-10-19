// supabase/functions/_shared/llm/stubShapes.test.ts
// FP-04 Step 3a — the stub-shape dispatch table (§4.1). FP-04 FR-12; AC-11 (stub half).
//
// Pure: this suite imports `stubShapes.ts` only, never the adapter. Everything the adapter does
// with a selected payload (validate + return) is a two-line branch covered by `deno check` and
// the diff; what is worth a test is the selection rule itself.

import { registerStubShape, registerStubShapeFactory, selectStubPayload } from "./stubShapes.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes `supabase/functions`,
// and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("stub-shape dispatch (§4.1)", () => {
  it("returns null when the request carries no validator", () => {
    expect(selectStubPayload({})).toBeNull();
  });

  it("returns null for a validator that registered nothing (the §4.2 default stands)", () => {
    expect(selectStubPayload({ validate: (p: unknown) => p !== null })).toBeNull();
  });

  it("returns the payload registered against that exact validator", () => {
    const validate = (p: unknown): p is { n: number } =>
      typeof p === "object" && p !== null && typeof (p as { n?: unknown }).n === "number";
    const payload = { n: 7 };
    registerStubShape(validate, payload);
    expect(selectStubPayload({ validate })).toBe(payload);
  });

  it("does not leak a registration to a different validator", () => {
    const a = (p: unknown): p is number => typeof p === "number";
    const b = (p: unknown): p is number => typeof p === "number";
    registerStubShape(a, 1);
    expect(selectStubPayload({ validate: a })).toBe(1);
    expect(selectStubPayload({ validate: b })).toBeNull();
  });

  it("runs a registered factory with the request's stubContext (FP-06 Step 3 dynamic arm)", () => {
    const validate = (p: unknown): p is { n: number } =>
      typeof p === "object" && p !== null && typeof (p as { n?: unknown }).n === "number";
    registerStubShapeFactory(validate, (ctx) => ({ n: (ctx as { n?: number } | null)?.n ?? -1 }));
    expect(selectStubPayload({ validate, stubContext: { n: 9 } })).toEqual({ n: 9 });
    expect(selectStubPayload({ validate })).toEqual({ n: -1 });
  });

  it("a factory registration replaces a static one for the same validator", () => {
    const validate = (p: unknown): p is string => typeof p === "string";
    registerStubShape(validate, "static");
    expect(selectStubPayload({ validate })).toBe("static");
    registerStubShapeFactory(validate, () => "dynamic");
    expect(selectStubPayload({ validate })).toBe("dynamic");
  });
});
