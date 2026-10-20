// supabase/functions/_shared/llm/stubShapes.ts
// FP-04 Step 3a — schema-selected stub-shape dispatch (TECH-SPEC §4.1, FP-04 FR-12).
//
// The adapter's stub branch carries one canned §4.2 payload. A caller with its own per-call
// contract (§4.3 family) would then have its validator reject that payload, and the stub would
// answer `kind:'validation'` — a stub that cannot exercise the very path it exists to exercise.
// This module is the dispatch table that fixes that.
//
// Selection is by the requested **validator** (function identity), because that is exactly what
// the adapter applies to the canned payload. A contract module registers its own payload at
// import time:
//
//     registerStubShape(isEvalResult, EVAL_STUB_RESULT);
//
// The adapter falls back to the §4.2 payload when nothing matches, so every unregistered caller
// (a generic `generate` with no validator, the §4.3 extraction) keeps today's behaviour.
//
// FP-06 Step 3 adds the dynamic arm: `registerStubShapeFactory(validate, factory)`. A contract
// whose canned answer must reference per-call inputs (the chat-memory contract's facts cite the
// slice's message ids — a static payload cannot) registers a factory instead; the adapter hands
// it `request.stubContext`, which the caller set alongside its validator. A registered *payload*
// is an object; a function entry is a factory. Stub mode is the only path that reads
// `stubContext` — provider request bodies are built from `system`/`messages`/`schema` alone.
//
// Pure and I/O-free — a `WeakMap` and nothing else, no `Deno.env`, no client — so both this
// module and a registration load under jest (the `bands.ts` / `windows.ts` split, same reason).

/** A caller's per-call structural validator — what the adapter applies to the canned payload. */
export type StubValidator = (parsed: unknown) => boolean;

/** A dynamic canned payload: built per call from the caller-supplied `stubContext`. */
export type StubPayloadFactory = (context: unknown) => unknown;

const registry = new WeakMap<StubValidator, unknown | StubPayloadFactory>();

/** Register the canned payload a stub-mode call with `validate` must receive (§4.1). */
export function registerStubShape<T>(
  validate: (parsed: unknown) => parsed is T,
  payload: T,
): void {
  registry.set(validate, payload);
}

/**
 * Register a factory instead of a static payload, for a contract whose canned answer must
 * reference per-call inputs. The factory receives `GenerateRequest.stubContext` and returns
 * the canned payload the adapter then runs the caller's validator against.
 */
export function registerStubShapeFactory(
  validate: StubValidator,
  factory: StubPayloadFactory,
): void {
  registry.set(validate, factory);
}

/**
 * The canned payload registered for this request's validator, or `null` when none is — and
 * `null` is what keeps the adapter's §4.2 default in place for every existing caller.
 */
export function selectStubPayload(request: {
  validate?: StubValidator;
  stubContext?: unknown;
}): unknown | null {
  const validate = request.validate;
  if (typeof validate !== "function") return null;
  if (!registry.has(validate)) return null;
  const entry = registry.get(validate)!;
  if (typeof entry === "function") {
    return (entry as StubPayloadFactory)(request.stubContext);
  }
  return entry;
}
