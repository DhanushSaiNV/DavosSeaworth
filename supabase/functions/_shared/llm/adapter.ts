// supabase/functions/_shared/llm/adapter.ts
// Provider adapter for LLM calls (Gemini primary, Groq fallback) + embeddings
// Implements structured logging, stub mode, forced failures, and retry logic
//
// Step 8 adds two things the sync-degrade path depends on (TECH-SPECS §4.1):
//   * a hard per-call timeout (`config.llm_call_timeout_ms`) on every provider fetch, so
//     a hung socket cannot burn the 150 s synchronous budget; and
//   * a structured failure `kind` on every negative result, so the caller can tell a
//     transport failure (worth a retry job) from a structural one (§4.2 fallback reply).

import { createClient } from "npm:@supabase/supabase-js@2";
import { getConfigNumber } from "../config.ts";
import type { FailureKind } from "./errors.ts";
import { selectStubPayload } from "./stubShapes.ts";
import { toGeminiResponseSchema } from "./geminiSchema.ts";

// ============================================================================
// Types
// ============================================================================

export interface GenerateRequest<T = GenerateResponse> {
  system: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  schema?: Record<string, unknown>; // JSON Schema for structured output
  tier?: "primary" | "fallback"; // force specific tier
  /**
   * Per-call output budget for both providers. Defaults to the §4.2 generation
   * contract's short reply (1024). Async extraction overrides it: a §4.3 slice may
   * return up to 32 facts, and a reasoning fallback spends part of the budget before
   * the JSON body (the 2026-10-20 `memory_extract` failure).
   */
  maxTokens?: number;
  /**
   * Structural validator for the parsed response. Defaults to the §4.2 anchored
   * generation contract; extraction (§4.3) passes its own. One contract per call —
   * the adapter never re-shapes the payload.
   */
  validate?: (parsed: unknown) => parsed is T;
  /**
   * Stub-mode-only context for a dynamic stub shape (FP-06 Step 3): handed to the
   * factory a contract registered via `registerStubShapeFactory`. Never read outside
   * the stub branch — provider request bodies are built from `system` / `messages` /
   * `schema` alone (the §4.1 adapter contract).
   */
  stubContext?: unknown;
}

export interface GenerateResponse {
  tactical_analysis: string;
  direct_quote: string;
  persona: string;
  ui_metadata?: {
    persona_options?: Array<{ key: string; label: string; one_liner: string }>;
  };
}

/**
 * Default structural validator — the §4.2 anchored generation contract.
 * The adapter exposes this so a generic `generate<T>` with no `validate` keeps the
 * exact validation behaviour Steps 1/4/5 depend on.
 */
export function isGenerateResponse(parsed: unknown): parsed is GenerateResponse {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  return (
    typeof o.tactical_analysis === "string" &&
    typeof o.direct_quote === "string" &&
    typeof o.persona === "string"
  );
}

export interface AdapterResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  provider: "gemini" | "groq" | "stub";
  latencyMs: number;
  /**
   * Why a negative result happened. `transport` means a provider could not be reached
   * or did not answer in time — a later retry has a real chance (§4.1 sync degrade);
   * `parse`/`validation` mean the model answered but off-contract, which retrying
   * cannot fix (§4.2 bounded retry → `malformed_fallback_reply`).
   */
  kind?: FailureKind;
}

export interface EmbeddingResult {
  embeddings: number[][];
  dimension: number;
  model: string;
}

// ============================================================================
// Config & Secrets
// ============================================================================

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!GEMINI_API_KEY || !GROQ_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY or GROQ_API_KEY in Edge Function secrets");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ============================================================================
// Config helpers (read from config table at runtime)
// ============================================================================

async function getConfig(key: string): Promise<unknown> {
  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", key)
    .single();
  if (error || !data) return null;
  return data.value;
}

async function isStubMode(): Promise<boolean> {
  const val = await getConfig("llm_stub_mode");
  return val === true || val === "true";
}

async function isStubMalformed(): Promise<boolean> {
  const val = await getConfig("llm_stub_malformed");
  return val === true || val === "true";
}

async function getForceFail(): Promise<"none" | "primary" | "both"> {
  const val = await getConfig("llm_force_fail");
  if (val === "primary" || val === "both") return val as "primary" | "both";
  return "none";
}

async function isDevOverridesEnabled(): Promise<boolean> {
  const val = await getConfig("dev_overrides_enabled");
  return val !== false && val !== "false";
}

// ============================================================================
// Logging
// ============================================================================

interface LogEntry {
  ts: string;
  provider: "gemini" | "groq" | "stub";
  model: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
  requestId: string;
}

function logCall(entry: LogEntry) {
  // Structured log line for quota monitoring
  console.log(
    JSON.stringify({
      ...entry,
      // Don't log full prompts/responses, just metadata
    }),
  );
}

// ============================================================================
// Fetch helper
// ============================================================================

/**
 * POST a JSON body with a hard per-call timeout.
 *
 * `AbortSignal.timeout` is what keeps a hung provider socket from burning the 150 s
 * synchronous invocation budget (TECH-SPECS §1 / §4.1): without it a stalled TCP
 * connection leaves the invocation to be killed mid-pipeline, and the turn is orphaned
 * because the user row is already committed. The timeout comes from
 * `config.llm_call_timeout_ms`, never a hardcoded constant (AGENTS.md §2).
 *
 * A thrown `fetch` (DNS failure, TLS error, abort) is normalised into a result so the
 * caller's provider-selection logic stays declarative — and so a network blip is a
 * *transport* failure the sync-degrade path can handle, not an unhandled rejection.
 */
async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<
  | { ok: true; res: Response }
  | { ok: false; error: string; kind: FailureKind }
> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: true, res };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `network/timeout after ${timeoutMs}ms: ${msg}`,
      kind: "transport",
    };
  }
}

// ============================================================================
// Canned responses for stub mode
// ============================================================================

const STUB_GENERATE_RESPONSE: GenerateResponse = {
  tactical_analysis: "STUB: User is asking about productivity. Detected domain: Career, emotion: determined, high confidence. Auto-adopting mentor_tough persona. No rule conflicts.",
  direct_quote: "STUB: Here's your concrete next step — block 9-11am for deep work on the project. No phone, no email. Just you and the code.",
  persona: "mentor_tough",
  ui_metadata: {
    persona_options: [
      { key: "mentor_tough", label: "Tough Mentor", one_liner: "Direct, accountability-focused" },
      { key: "trainer", label: "Trainer", one_liner: "Structured, progressive" },
    ],
  },
};

const STUB_EMBEDDING: number[] = Array(768).fill(0).map((_, i) => Math.sin(i * 0.1));

/** §4.2 replies are short; extraction opts into a larger budget via `request.maxTokens`. */
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

// ============================================================================
// Provider: Gemini
// ============================================================================

async function callGemini<T>(
  request: GenerateRequest<T>,
  requestId: string,
  timeoutMs: number,
): Promise<AdapterResult<T>> {
  const start = Date.now();
  const model = "gemini-3.5-flash-lite"; // TECH-SPEC §4.1 primary
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const contents = request.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Build system instruction
  const systemInstruction = request.system
    ? { parts: [{ text: request.system }] }
    : undefined;

  const generationConfig: Record<string, unknown> = {
    temperature: 0.3,
    maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    responseMimeType: "application/json",
  };

  const body: Record<string, unknown> = {
    contents,
    generationConfig,
  };

  if (systemInstruction) body.systemInstruction = systemInstruction;
  // Gemini's Schema proto rejects JSON-Schema annotations it does not know (notably
  // `additionalProperties`); translate the caller's contract to the accepted subset.
  if (request.schema) generationConfig.responseSchema = toGeminiResponseSchema(request.schema);

  const posted = await postJson(
    url,
    body,
    { "Content-Type": "application/json" },
    timeoutMs,
  );

  const latencyMs = Date.now() - start;

  if (!posted.ok) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: posted.error, requestId });
    return { ok: false, error: `Gemini ${posted.error}`, provider: "gemini", latencyMs, kind: posted.kind };
  }

  const res = posted.res;

  if (!res.ok) {
    const errText = await res.text();
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `HTTP ${res.status}: ${errText}`, requestId });
    // A 4xx from our own request shape would not be helped by a retry, but it is also
    // not something the user can act on, and both providers share the request builder —
    // treating any HTTP failure as transport lets the retry job absorb a bad window
    // (e.g. a 429 quota spike) without stranding the turn.
    return { ok: false, error: `Gemini HTTP ${res.status}`, provider: "gemini", latencyMs, kind: "transport" };
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `Response body not JSON: ${e}`, requestId });
    return { ok: false, error: "Gemini response body was not JSON", provider: "gemini", latencyMs, kind: "transport" };
  }

  const text = (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)
    ?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: "No text in response", requestId });
    return { ok: false, error: "No text in Gemini response", provider: "gemini", latencyMs, kind: "transport" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `JSON parse failed: ${e}`, requestId });
    return { ok: false, error: "Failed to parse Gemini JSON", provider: "gemini", latencyMs, kind: "parse" };
  }

  // Structural validation (caller-supplied, else the §4.2 contract)
  const validate = request.validate ?? (isGenerateResponse as (p: unknown) => p is T);
  if (!validate(parsed)) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: "Structural validation failed", requestId });
    return { ok: false, error: "Gemini response failed structural validation", provider: "gemini", latencyMs, kind: "validation" };
  }

  logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: true, requestId });
  return { ok: true, data: parsed, provider: "gemini", latencyMs };
}

// ============================================================================
// Provider: Groq (fallback)
// ============================================================================

async function callGroq<T>(
  request: GenerateRequest<T>,
  requestId: string,
  timeoutMs: number,
): Promise<AdapterResult<T>> {
  const start = Date.now();
  const model = "openai/gpt-oss-120b"; // JSON-mode capable mid-tier
  const url = "https://api.groq.com/openai/v1/chat/completions";

  // Groq has no schema-enforced structured output (JSON mode only), so the contract is
  // embedded in the prompt on every call. TECH-SPEC §4.1's "schema embedded in prompt".
  let systemPrompt = request.system || "";
  if (request.schema) {
    systemPrompt += "\n\nRespond ONLY with valid JSON matching this schema: " + JSON.stringify(request.schema);
  }

  const body = {
    model,
    messages: systemPrompt ? [{ role: "system", content: systemPrompt }, ...request.messages] : request.messages,
    temperature: 0.3,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" }, // JSON mode
  };

  const posted = await postJson(
    url,
    body,
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    timeoutMs,
  );

  const latencyMs = Date.now() - start;

  if (!posted.ok) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: posted.error, requestId });
    return { ok: false, error: `Groq ${posted.error}`, provider: "groq", latencyMs, kind: posted.kind };
  }

  const res = posted.res;

  if (!res.ok) {
    const errText = await res.text();
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: `HTTP ${res.status}: ${errText}`, requestId });
    return { ok: false, error: `Groq HTTP ${res.status}`, provider: "groq", latencyMs, kind: "transport" };
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: `Response body not JSON: ${e}`, requestId });
    return { ok: false, error: "Groq response body was not JSON", provider: "groq", latencyMs, kind: "transport" };
  }

  const text = (data.choices as Array<{ message?: { content?: string } }> | undefined)
    ?.[0]?.message?.content;

  if (!text) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: "No text in response", requestId });
    return { ok: false, error: "No text in Groq response", provider: "groq", latencyMs, kind: "transport" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: `JSON parse failed: ${e}`, requestId });
    return { ok: false, error: "Failed to parse Groq JSON", provider: "groq", latencyMs, kind: "parse" };
  }

  const validate = request.validate ?? (isGenerateResponse as (p: unknown) => p is T);
  if (!validate(parsed)) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: "Structural validation failed", requestId });
    return { ok: false, error: "Groq response failed structural validation", provider: "groq", latencyMs, kind: "validation" };
  }

  logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: true, requestId });
  return { ok: true, data: parsed, provider: "groq", latencyMs };
}

// ============================================================================
// Embeddings (Gemini only)
// ============================================================================

async function callGeminiEmbed(
  texts: string[],
  timeoutMs: number,
): Promise<AdapterResult<EmbeddingResult>> {
  const start = Date.now();
  const model = "gemini-embedding-001"; // Frozen identity (D5); stamped as gemini-embedding-001@768
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${GEMINI_API_KEY}`;

  const posted = await postJson(
    url,
    {
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      })),
    },
    { "Content-Type": "application/json" },
    timeoutMs,
  );

  const latencyMs = Date.now() - start;

  if (!posted.ok) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: posted.error, requestId: "embed" });
    return { ok: false, error: `Gemini embed ${posted.error}`, provider: "gemini", latencyMs, kind: posted.kind };
  }

  const res = posted.res;

  if (!res.ok) {
    const errText = await res.text();
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `HTTP ${res.status}: ${errText}`, requestId: "embed" });
    return { ok: false, error: `Gemini embed HTTP ${res.status}`, provider: "gemini", latencyMs, kind: "transport" };
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `Response body not JSON: ${e}`, requestId: "embed" });
    return { ok: false, error: "Gemini embed response body was not JSON", provider: "gemini", latencyMs, kind: "transport" };
  }

  const raw = (data.embeddings ?? data.responses) as
    | Array<{ values?: number[]; embedding?: { values?: number[] } }>
    | undefined;
  const embeddings = raw?.map((e) => e.values ?? e.embedding?.values);

  if (!embeddings || embeddings.length !== texts.length || embeddings.some((e) => !e || e.length !== 768)) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: "Invalid embedding dimension", requestId: "embed" });
    return {
      ok: false,
      error: `Invalid embedding dimension (keys=${Object.keys(data).join(",")}, count=${embeddings?.length ?? "n/a"}, dims=${embeddings?.map((e) => e?.length).join("/") ?? "n/a"})`,
      provider: "gemini",
      latencyMs,
      kind: "validation",
    };
  }

  logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: true, requestId: "embed" });
  return {
    ok: true,
    data: { embeddings: embeddings as number[][], dimension: 768, model: "gemini-embedding-001@768" },
    provider: "gemini",
    latencyMs,
  };
}

// ============================================================================
// Public API
// ============================================================================

export async function generate<T = GenerateResponse>(
  request: GenerateRequest<T>,
): Promise<AdapterResult<T>> {
  const requestId = crypto.randomUUID();
  const stubMode = await isStubMode();
  const forceFail = await getForceFail();

  // Stub mode: return canned response immediately (zero network)
  if (stubMode) {
    // Dev-only: simulate a structural parse failure to exercise the §4.2 retry.
    if (await isStubMalformed()) {
      logCall({ ts: new Date().toISOString(), provider: "stub", model: "stub", latencyMs: 0, ok: false, error: "Stub malformed output (dev-only)", requestId });
      return { ok: false, error: "Stub malformed JSON (dev-only simulation)", provider: "stub", latencyMs: 0, kind: "parse" };
    }
    // Stub-shape dispatch (§4.1, FP-04 Step 3a): a caller with its own per-call contract
    // (§4.3 family) registers its canned payload against its validator, so the stub exercises
    // that path instead of failing it. With nothing registered the §4.2 payload stands, and a
    // caller validator that cannot accept it is still surfaced as a failure rather than lied
    // about — today's behaviour for every existing caller.
    const payload = selectStubPayload(request) ?? STUB_GENERATE_RESPONSE;
    if (request.validate && !request.validate(payload)) {
      logCall({ ts: new Date().toISOString(), provider: "stub", model: "stub", latencyMs: 0, ok: false, error: "Stub payload fails caller validator", requestId });
      return { ok: false, error: "Stub response does not satisfy the caller validator", provider: "stub", latencyMs: 0, kind: "validation" };
    }
    logCall({ ts: new Date().toISOString(), provider: "stub", model: "stub", latencyMs: 0, ok: true, requestId });
    return { ok: true, data: payload as unknown as T, provider: "stub", latencyMs: 0 };
  }

  // Forced failure testing (dev-only override, gated by `dev_overrides_enabled`)
  if (forceFail === "both") {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model: "gemini-3.5-flash-lite", latencyMs: 0, ok: false, error: "Forced primary failure", requestId });
    logCall({ ts: new Date().toISOString(), provider: "groq", model: "openai/gpt-oss-120b", latencyMs: 0, ok: false, error: "Forced fallback failure", requestId });
    // A total outage is the one condition that degrades to the holding reply + retry
    // job (§4.1), so it must be reported as a transport failure, not a structural one.
    return { ok: false, error: "Both providers forced to fail", provider: "gemini", latencyMs: 0, kind: "transport" };
  }

  const timeoutMs = await getConfigNumber("llm_call_timeout_ms");

  if (forceFail === "primary") {
    // Primary forced to fail: skip it and use the fallback directly.
    return callGroq(request, requestId, timeoutMs);
  }

  // Explicit tier (TECH-SPECS §4.1). The interface has exposed `tier` since Step 1;
  // honouring it keeps a caller from believing it picked a provider when it did not.
  if (request.tier === "fallback") return callGroq(request, requestId, timeoutMs);
  if (request.tier === "primary") return callGemini(request, requestId, timeoutMs);

  // Try primary (Gemini)
  const primaryResult = await callGemini(request, requestId, timeoutMs);

  if (primaryResult.ok) return primaryResult;

  // Primary failed - try fallback (Groq)
  const fallbackResult = await callGroq(request, requestId, timeoutMs);
  if (!fallbackResult.ok) {
    return {
      ...fallbackResult,
      // A transport failure anywhere means at least one provider was unreachable or over
      // budget, so the next attempt has a real chance. A purely structural failure means
      // both models answered but off-contract, which retrying cannot fix (§4.2).
      kind: primaryResult.kind === "transport" || fallbackResult.kind === "transport"
        ? "transport"
        : fallbackResult.kind,
      error: `primary(${primaryResult.error ?? "unknown"}); fallback(${fallbackResult.error ?? "unknown"})`,
    };
  }
  return fallbackResult;
}

export async function embed(texts: string[]): Promise<AdapterResult<EmbeddingResult>> {
  const stubMode = await isStubMode();

  if (stubMode) {
    logCall({ ts: new Date().toISOString(), provider: "stub", model: "stub", latencyMs: 0, ok: true, requestId: "embed" });
    return {
      ok: true,
      data: { embeddings: [STUB_EMBEDDING], dimension: 768, model: "gemini-embedding-001@768" },
      provider: "stub",
      latencyMs: 0,
    };
  }

  const timeoutMs = await getConfigNumber("llm_call_timeout_ms");
  return callGeminiEmbed(texts, timeoutMs);
}

// Types are exported inline at their declarations above.