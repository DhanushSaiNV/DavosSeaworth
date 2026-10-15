// supabase/functions/_shared/llm/adapter.ts
// Provider adapter for LLM calls (Gemini primary, Groq fallback) + embeddings
// Implements structured logging, stub mode, forced failures, and retry logic

import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================================
// Types
// ============================================================================

export interface GenerateRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  schema?: Record<string, unknown>; // JSON Schema for structured output
  tier?: "primary" | "fallback"; // force specific tier
}

export interface GenerateResponse {
  tactical_analysis: string;
  direct_quote: string;
  persona: string;
  ui_metadata?: {
    persona_options?: Array<{ key: string; label: string; one_liner: string }>;
  };
}

export interface AdapterResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  provider: "gemini" | "groq" | "stub";
  latencyMs: number;
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

// ============================================================================
// Provider: Gemini
// ============================================================================

async function callGemini(
  request: GenerateRequest,
  requestId: string,
): Promise<AdapterResult<GenerateResponse>> {
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

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };

  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (request.schema) body.generationConfig.responseSchema = request.schema;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `HTTP ${res.status}: ${errText}`, requestId });
    return { ok: false, error: `Gemini HTTP ${res.status}`, provider: "gemini", latencyMs };
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: "No text in response", requestId });
    return { ok: false, error: "No text in Gemini response", provider: "gemini", latencyMs };
  }

  let parsed: GenerateResponse;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `JSON parse failed: ${e}`, requestId });
    return { ok: false, error: "Failed to parse Gemini JSON", provider: "gemini", latencyMs };
  }

  // Validate required fields
  if (!parsed.tactical_analysis || !parsed.direct_quote || !parsed.persona) {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: "Missing required fields", requestId });
    return { ok: false, error: "Missing required fields in Gemini response", provider: "gemini", latencyMs };
  }

  logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: true, requestId });
  return { ok: true, data: parsed, provider: "gemini", latencyMs };
}

// ============================================================================
// Provider: Groq (fallback)
// ============================================================================

async function callGroq(
  request: GenerateRequest,
  requestId: string,
): Promise<AdapterResult<GenerateResponse>> {
  const start = Date.now();
  const model = "openai/gpt-oss-120b"; // JSON-mode capable mid-tier
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const messages = [
    ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
    ...request.messages,
  ];

  // For Groq, we use JSON mode (not schema) - embed schema in system prompt if needed
  let systemPrompt = request.system || "";
  if (request.schema && !systemPrompt.includes("JSON")) {
    systemPrompt += "\n\nRespond ONLY with valid JSON matching this schema: " + JSON.stringify(request.schema);
  }

  const body = {
    model,
    messages: systemPrompt ? [{ role: "system", content: systemPrompt }, ...request.messages] : request.messages,
    temperature: 0.3,
    max_tokens: 1024,
    response_format: { type: "json_object" }, // JSON mode
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: `HTTP ${res.status}: ${errText}`, requestId });
    return { ok: false, error: `Groq HTTP ${res.status}`, provider: "groq", latencyMs };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: "No text in response", requestId });
    return { ok: false, error: "No text in Groq response", provider: "groq", latencyMs };
  }

  let parsed: GenerateResponse;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: `JSON parse failed: ${e}`, requestId });
    return { ok: false, error: "Failed to parse Groq JSON", provider: "groq", latencyMs };
  }

  if (!parsed.tactical_analysis || !parsed.direct_quote || !parsed.persona) {
    logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: false, error: "Missing required fields", requestId });
    return { ok: false, error: "Missing required fields in Groq response", provider: "groq", latencyMs };
  }

  logCall({ ts: new Date().toISOString(), provider: "groq", model, latencyMs, ok: true, requestId });
  return { ok: true, data: parsed, provider: "groq", latencyMs };
}

// ============================================================================
// Embeddings (Gemini only)
// ============================================================================

async function callGeminiEmbed(texts: string[]): Promise<AdapterResult<EmbeddingResult>> {
  const start = Date.now();
  const model = "gemini-embedding-001"; // Frozen identity (D5); stamped as gemini-embedding-001@768
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      })),
    }),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    logCall({ ts: new Date().toISOString(), provider: "gemini", model, latencyMs, ok: false, error: `HTTP ${res.status}: ${errText}`, requestId: "embed" });
    return { ok: false, error: `Gemini embed HTTP ${res.status}`, provider: "gemini", latencyMs };
  }

  const data = await res.json();
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

export async function generate(
  request: GenerateRequest,
): Promise<AdapterResult<GenerateResponse>> {
  const requestId = crypto.randomUUID();
  const stubMode = await isStubMode();
  const forceFail = await getForceFail();

  // Stub mode: return canned response immediately
  if (stubMode) {
    logCall({ ts: new Date().toISOString(), provider: "stub", model: "stub", latencyMs: 0, ok: true, requestId });
    return { ok: true, data: STUB_GENERATE_RESPONSE, provider: "stub", latencyMs: 0 };
  }

  // Forced failure testing
  if (forceFail === "primary" || forceFail === "both") {
    logCall({ ts: new Date().toISOString(), provider: "gemini", model: "gemini-3.5-flash-lite", latencyMs: 0, ok: false, error: "Forced primary failure", requestId });
    if (forceFail === "both") {
      logCall({ ts: new Date().toISOString(), provider: "groq", model: "openai/gpt-oss-120b", latencyMs: 0, ok: false, error: "Forced fallback failure", requestId });
      return { ok: false, error: "Both providers forced to fail", provider: "gemini", latencyMs: 0 };
    }
    // Primary forced to fail: skip it and use the fallback directly.
    return callGroq(request, requestId);
  }

  // Try primary (Gemini)
  const primaryResult = await callGemini(request, requestId);

  if (primaryResult.ok) return primaryResult;

  // Primary failed - try fallback (Groq)
  const fallbackResult = await callGroq(request, requestId);
  if (!fallbackResult.ok) {
    return {
      ...fallbackResult,
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

  return callGeminiEmbed(texts);
}

// Re-export types
export type { GenerateRequest, GenerateResponse, AdapterResult, EmbeddingResult };