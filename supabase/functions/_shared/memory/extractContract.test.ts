// supabase/functions/_shared/memory/extractContract.test.ts
// FP-06 Step 3 — the chunk contract's pure half: validator bounds + provenance, the prompt,
// the stub factory, the bounded retry, backlog derivation and slicing (FR-4..FR-6, FR-15).
// Refs: FP-06 FR-4, FR-5, FR-6, FR-15; TECH-SPEC §4.2–4.3, §7.6.

import {
  buildChatFactsPrompt,
  chatFactsStubPayload,
  deriveBacklog,
  extractChunkWith,
  isChatFactsResult,
  MAX_FACT_CHARS,
  sliceBacklog,
  validateChatFacts,
  type BacklogMessage,
  type ChatFactsResult,
} from "./extractContract.ts";
import { selectStubPayload } from "../llm/stubShapes.ts";
import type { AdapterResult, GenerateRequest } from "../llm/adapter.ts";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";
const ID_FOREIGN = "99999999-9999-9999-9999-999999999999";

const good: ChatFactsResult = {
  facts: [{ text: "The user is training for a half marathon.", source_message_id: ID_A }],
  openness_delta: 1,
};

function msg(id: string, over: Partial<BacklogMessage> = {}): BacklogMessage {
  return {
    id,
    role: "user",
    content: "Some message content",
    unsavable: false,
    created_at: "2026-10-19T10:00:00.000Z",
    ...over,
  };
}

describe("isChatFactsResult (shape)", () => {
  it("accepts the canonical payload", () => {
    expect(isChatFactsResult(good)).toBe(true);
  });

  it("accepts an empty facts array", () => {
    expect(isChatFactsResult({ facts: [], openness_delta: 0 })).toBe(true);
  });

  it("rejects non-objects, missing fields, wrong types", () => {
    for (const bad of [
      null,
      "x",
      {},
      { facts: "no" },
      { facts: [{ text: "x" }], openness_delta: 0 },
      { facts: [{ source_message_id: ID_A }], openness_delta: 0 },
      { facts: [], openness_delta: "0" },
      { facts: [null], openness_delta: 0 },
    ]) {
      expect(isChatFactsResult(bad)).toBe(false);
    }
  });
});

describe("validateChatFacts (bounds + provenance)", () => {
  const slice = new Set([ID_A, ID_B]);

  it("passes a well-formed in-slice payload", () => {
    expect(validateChatFacts(good, slice)).toEqual([]);
  });

  it("rejects more than 32 facts", () => {
    const many = {
      facts: Array.from({ length: 33 }, () => ({
        text: "A durable fact about the user.",
        source_message_id: ID_A,
      })),
      openness_delta: 0,
    };
    expect(validateChatFacts(many, slice).join("; ")).toContain("exceeds 32");
  });

  it("rejects fact text outside 5–500 chars", () => {
    const short = { facts: [{ text: "hi", source_message_id: ID_A }], openness_delta: 0 };
    const long = { facts: [{ text: "x".repeat(501), source_message_id: ID_A }], openness_delta: 0 };
    expect(validateChatFacts(short, slice).join("; ")).toContain("fact text length 2");
    expect(validateChatFacts(long, slice).join("; ")).toContain(String(501));
    expect(5).toBeLessThanOrEqual(MAX_FACT_CHARS);
  });

  it("hard-rejects a foreign source_message_id — never a rewrite", () => {
    const foreign = { facts: [{ text: "A durable fact.", source_message_id: ID_FOREIGN }], openness_delta: 0 };
    const errs = validateChatFacts(foreign, slice);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("hard reject");
    expect(errs[0]).toContain(ID_FOREIGN);
  });

  it("rejects an out-of-range openness delta", () => {
    expect(validateChatFacts({ ...good, openness_delta: 6 }, slice).join("; ")).toContain("openness_delta");
  });
});

describe("buildChatFactsPrompt (role markers, ids, delimiters)", () => {
  it("wraps the slice in <user_message> and renders id + role per message", () => {
    const prompt = buildChatFactsPrompt([
      { id: ID_A, role: "user", content: "First content", created_at: "2026-10-19T10:00:00.000Z" },
      { id: ID_B, role: "assistant", content: "Second content" },
    ]);
    expect(prompt.startsWith("<user_message>")).toBe(true);
    expect(prompt.trimEnd().endsWith("</user_message>")).toBe(true);
    expect(prompt).toContain(`id="${ID_A}" role="user"`);
    expect(prompt).toContain(`id="${ID_B}" role="assistant"`);
    expect(prompt).toContain("First content");
    expect(prompt).toContain("Second content");
    expect(prompt.indexOf("First content")).toBeLessThan(prompt.indexOf("Second content"));
  });
});

describe("the stub factory (dynamic arm — cites the slice's real ids)", () => {
  it("emits facts citing the first and last slice ids", () => {
    const payload = chatFactsStubPayload({ sliceIds: [ID_A, ID_B] });
    expect(payload.facts.map((f) => f.source_message_id)).toEqual([ID_A, ID_B]);
    expect(isChatFactsResult(payload)).toBe(true);
  });

  it("emits zero facts for an empty slice and one for a single-message slice", () => {
    expect(chatFactsStubPayload({ sliceIds: [] }).facts).toEqual([]);
    expect(chatFactsStubPayload({ sliceIds: [ID_A] }).facts.length).toBe(1);
    expect(chatFactsStubPayload(null).facts).toEqual([]);
  });

  it("is registered against the contract validator (the adapter's dispatch key)", () => {
    const selected = selectStubPayload({
      validate: isChatFactsResult,
      stubContext: { sliceIds: [ID_A] },
    }) as ChatFactsResult;
    expect(selected.facts[0].source_message_id).toBe(ID_A);
  });
});

describe("extractChunkWith (bounded retry)", () => {
  const messages = [{ id: ID_A, role: "user" as const, content: "hello there" }];
  const calls: GenerateRequest<ChatFactsResult>[] = [];
  const ok = (data: ChatFactsResult): AdapterResult<ChatFactsResult> => ({
    ok: true,
    data,
    provider: "stub",
    latencyMs: 0,
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("returns the data on a clean first attempt", async () => {
    const out = await extractChunkWith(async (req) => {
      calls.push(req);
      return ok(good);
    }, messages);
    expect(out).toEqual(good);
    expect(calls.length).toBe(1);
    expect(calls[0].stubContext).toEqual({ sliceIds: [ID_A] });
    expect(typeof calls[0].validate).toBe("function");
  });

  it("retries once on a foreign citation, then fails hard — no rewrite", async () => {
    const foreign: ChatFactsResult = {
      facts: [{ text: "A durable fact.", source_message_id: ID_FOREIGN }],
      openness_delta: 0,
    };
    await expect(
      extractChunkWith(async (req) => {
        calls.push(req);
        return ok(foreign);
      }, messages, { warn: () => {} }),
    ).rejects.toThrow(/validation failed after retry/);
    expect(calls.length).toBe(2);
    expect(calls[1].messages[0].content).toContain("VALIDATION ERRORS");
  });

  it("retries once on a parse failure and can succeed on the retry", async () => {
    const out = await extractChunkWith(async (req) => {
      calls.push(req);
      if (calls.length === 1) {
        return { ok: false, error: "bad json", provider: "stub", latencyMs: 0, kind: "parse" };
      }
      return ok(good);
    }, messages, { warn: () => {} });
    expect(out).toEqual(good);
    expect(calls.length).toBe(2);
  });

  it("fails immediately on transport — no retry", async () => {
    await expect(
      extractChunkWith(async (req) => {
        calls.push(req);
        return {
          ok: false,
          error: "network down",
          provider: "stub",
          latencyMs: 0,
          kind: "transport",
        };
      }, messages, { warn: () => {} }),
    ).rejects.toThrow(/transport failure/);
    expect(calls.length).toBe(1);
  });
});

describe("deriveBacklog (window candidates -> backlog)", () => {
  it("drops unsavable rows — flagged text is never extracted", () => {
    const backlog = deriveBacklog(
      [msg(ID_A), msg(ID_B, { unsavable: true })],
      new Set(),
    );
    expect(backlog.map((m) => m.id)).toEqual([ID_A]);
  });

  it("drops cited rows — a purged message never re-extracts (cited rows still count)", () => {
    const backlog = deriveBacklog([msg(ID_A), msg(ID_B)], new Set([ID_A]));
    expect(backlog.map((m) => m.id)).toEqual([ID_B]);
  });

  it("includes both roles — both halves of a memory live in the thread", () => {
    const backlog = deriveBacklog(
      [msg(ID_A, { role: "user" }), msg(ID_B, { role: "assistant" })],
      new Set(),
    );
    expect(backlog.length).toBe(2);
  });

  it("sorts oldest first with a deterministic id tiebreak", () => {
    const backlog = deriveBacklog(
      [
        msg(ID_B, { created_at: "2026-10-19T10:00:00.000Z" }),
        msg(ID_A, { created_at: "2026-10-18T10:00:00.000Z" }),
        msg(ID_FOREIGN, { created_at: "2026-10-19T10:00:00.000Z" }),
      ],
      new Set(),
    );
    expect(backlog[0].id).toBe(ID_A);
    expect(backlog[1].id).toBe(ID_B);
    expect(backlog[2].id).toBe(ID_FOREIGN);
  });
});

describe("sliceBacklog (resume semantics)", () => {
  it("slices at 32 messages, remainder last", () => {
    const backlog = Array.from({ length: 33 }, (_, i) =>
      msg(`00000000-0000-0000-0000-${String(i).padStart(12, "0")}`));
    const slices = sliceBacklog(backlog);
    expect(slices.length).toBe(2);
    expect(slices[0].length).toBe(32);
    expect(slices[1].length).toBe(1);
  });

  it("is empty for an empty backlog — the no-op job run", () => {
    expect(sliceBacklog([])).toEqual([]);
  });

  it("resume: a re-run over a half-completed backlog extracts only the remainder", () => {
    // Slice 1's messages produced facts; slice 2's did not. The cited set now hides slice 1.
    const done = Array.from({ length: 32 }, (_, i) =>
      msg(`10000000-0000-0000-0000-${String(i).padStart(12, "0")}`));
    const remainder = [msg(`20000000-0000-0000-0000-000000000000`)];
    const cited = new Set(done.map((m) => m.id));
    const backlog = deriveBacklog([...done, ...remainder], cited);
    expect(sliceBacklog(backlog).length).toBe(1);
    expect(sliceBacklog(backlog)[0][0].id).toBe(remainder[0].id);
  });
});
