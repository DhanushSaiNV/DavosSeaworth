// supabase/functions/_shared/llm/geminiSchema.test.ts
// Pins the Gemini responseSchema keyword filter against the shape that failed live
// (TECH-SPEC §4.1): `additionalProperties` is not part of Gemini's Schema proto.

import { toGeminiResponseSchema } from "./geminiSchema.ts";

describe("toGeminiResponseSchema", () => {
  it("strips additionalProperties at every depth — the live memory_extract failure", () => {
    const schema = {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              source_message_id: { type: "string" },
            },
            required: ["text", "source_message_id"],
            additionalProperties: false,
          },
          minItems: 0,
          maxItems: 32,
        },
        openness_delta: { type: "integer", minimum: -5, maximum: 5 },
      },
      required: ["facts", "openness_delta"],
      additionalProperties: false,
    };

    const out = toGeminiResponseSchema(schema);

    expect(JSON.stringify(out)).not.toContain("additionalProperties");
    expect(out.type).toBe("object");
    expect(out.required).toEqual(["facts", "openness_delta"]);

    const props = out.properties as Record<string, any>;
    expect(props.facts.minItems).toBe(0);
    expect(props.facts.maxItems).toBe(32);
    expect(props.facts.items.required).toEqual(["text", "source_message_id"]);
    expect(props.facts.items.properties.source_message_id).toEqual({ type: "string" });
    expect(props.openness_delta.minimum).toBe(-5);
    expect(props.openness_delta.maximum).toBe(5);
  });

  it("drops other JSON-Schema-only annotations Gemini rejects", () => {
    const out = toGeminiResponseSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "memory",
      type: "object",
      properties: { x: { type: "string" } },
      definitions: { Thing: { type: "string" } },
    });

    expect(out).toEqual({
      type: "object",
      properties: { x: { type: "string" } },
    });
  });

  it("keeps a field literally named additionalProperties inside a properties map", () => {
    const out = toGeminiResponseSchema({
      type: "object",
      properties: {
        additionalProperties: { type: "boolean", description: "a real field" },
      },
    });

    expect(out.properties).toEqual({
      additionalProperties: { type: "boolean", description: "a real field" },
    });
  });

  it("preserves enum, descriptions and anyOf branches", () => {
    const out = toGeminiResponseSchema({
      type: "object",
      properties: {
        persona: { type: "string", enum: ["a", "b"], description: "pick one" },
        value: {
          anyOf: [
            { type: "string", additionalProperties: false },
            { type: "integer" },
          ],
        },
      },
    });

    const props = out.properties as Record<string, any>;
    expect(props.persona).toEqual({ type: "string", enum: ["a", "b"], description: "pick one" });
    expect(props.value.anyOf).toEqual([{ type: "string" }, { type: "integer" }]);
  });

  it("does not mutate the caller's schema", () => {
    const schema = {
      type: "object",
      properties: { facts: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    };
    const snapshot = JSON.parse(JSON.stringify(schema));

    toGeminiResponseSchema(schema);

    expect(schema).toEqual(snapshot);
  });
});
