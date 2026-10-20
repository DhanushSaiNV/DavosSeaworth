// supabase/functions/_shared/llm/geminiSchema.ts
// Provider schema translation for Gemini (TECH-SPEC §4.1).
//
// Callers hand the adapter plain JSON Schema (the §4.2/§4.3 contracts). Gemini's
// `generationConfig.responseSchema` is not JSON Schema — it is the restricted Schema
// proto — and it rejects annotations it does not know with HTTP 400. The live failure
// (2026-10-20, `memory_extract`) was `additionalProperties`, which every extraction
// contract uses to close its objects. The caller's validator still checks the full
// contract; this module only reduces the wire copy to the keywords Gemini accepts.
//
// Pure (no Deno.env): jest-loadable, so the keyword table is pinned by a test.

/**
 * Keywords accepted by Gemini's Schema proto. Anything else (notably
 * `additionalProperties`, `$schema`, `$id`, `$defs`, `$ref`) is dropped.
 *
 * `properties` is handled specially: its keys are field names, not keywords, so the
 * filter applies to each field's schema, never to the map itself.
 */
const GEMINI_SCHEMA_KEYWORDS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "items",
  "minProperties",
  "maxProperties",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "anyOf",
  "propertyOrdering",
  "default",
  "example",
]);

/**
 * Return a Gemini-safe copy of a caller's JSON Schema. Never mutates `schema`.
 */
export function toGeminiResponseSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return convertSchemaNode(schema) as Record<string, unknown>;
}

function convertSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertSchemaNode);
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (!GEMINI_SCHEMA_KEYWORDS.has(key)) continue;

    if (key === "properties") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const fields: Record<string, unknown> = {};
      for (const [field, fieldSchema] of Object.entries(value as Record<string, unknown>)) {
        fields[field] = convertSchemaNode(fieldSchema);
      }
      out.properties = fields;
      continue;
    }

    if (key === "items" || key === "anyOf") {
      out[key] = convertSchemaNode(value);
      continue;
    }

    // Scalars, string lists (`required`, `enum`), and opaque values (`default`,
    // `example`) are provider data, not schema nodes — copy as-is.
    out[key] = value;
  }

  return out;
}
