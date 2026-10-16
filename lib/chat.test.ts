// lib/chat.test.ts
// Unit tests for the pure chat-thread logic (no React Native involved).
// Refs: FP-02 FR-5, FR-16, FR-17; TECH-SPECS §3.2, §7.10, §9.

import {
  buildChatItems,
  classifyError,
  dedupeAssistantRows,
  mergeRows,
  nextRetryAt,
  personaChoices,
  personaOptionsOf,
  pruneResolvedPending,
  retryDelayFor,
  sortMessagesAsc,
  type Message,
  type PendingSend,
} from "./chat";
import { makeClientMessageId } from "./ids";

// The jest preset stubs native modules, so `expo-crypto`'s getRandomValues would leave
// the array untouched and every id would come out identical. Fill from Web Crypto
// instead, which keeps the uuid shape/uniqueness assertions meaningful. (babel hoists
// jest.mock above the imports, so its position here is a lint preference only.)
jest.mock("expo-crypto", () => ({
  getRandomValues: (array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
    globalThis.crypto.getRandomValues(array);
    return array;
  },
}));

const T = (seconds: number) => `2026-10-15T10:00:${String(seconds).padStart(2, "0")}.000Z`;

function msg(
  partial: Partial<Message> & Pick<Message, "id" | "role" | "content">,
): Message {
  return {
    user_id: "user-1",
    unsavable: false,
    client_message_id: null,
    reply_to_message_id: null,
    client_sent_at: null,
    metadata: {},
    created_at: T(0),
    ...partial,
  };
}

describe("classifyError", () => {
  it("buckets HTTP statuses and transport failures", () => {
    expect(classifyError({ context: { status: 401 } }).kind).toBe("auth");
    expect(classifyError({ context: { status: 400 } }).kind).toBe("client");
    expect(classifyError({ context: { status: 503 } }).kind).toBe("server");
    // A fetch failure or the client-side timeout surfaces as FunctionsFetchError,
    // which carries no status.
    expect(classifyError(new Error("Failed to send a request to the Edge Function")).kind).toBe(
      "network",
    );
    expect(classifyError(new Error("Aborted")).kind).toBe("network");

    // Only an unknown outcome is held off; a fast server error can be retried at once.
    expect(retryDelayFor("network", 150000)).toBe(150000);
    expect(retryDelayFor("server", 150000)).toBe(0);
    // A rejected request gets a short anti-spam gap; auth is handled by the banner.
    expect(retryDelayFor("client", 150000)).toBe(3000);
    expect(retryDelayFor("auth", 150000)).toBe(0);
  });
});

describe("sortMessagesAsc", () => {
  it("orders by client_sent_at when present, falling back to created_at", () => {
    const first = msg({
      id: "a",
      role: "user",
      content: "second by send time",
      created_at: T(0),
      client_sent_at: T(5),
    });
    const second = msg({ id: "b", role: "user", content: "first by created_at", created_at: T(1) });

    expect(sortMessagesAsc([first, second]).map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("dedupeAssistantRows", () => {
  it("keeps the earliest primary reply and always renders secondary replies", () => {
    const user = msg({ id: "u1", role: "user", content: "hi", client_message_id: "cmid-1" });
    const primary = msg({
      id: "p1",
      role: "assistant",
      content: "answer",
      reply_to_message_id: "u1",
      created_at: T(1),
    });
    const rivalPrimary = msg({
      id: "p2",
      role: "assistant",
      content: "duplicate answer",
      reply_to_message_id: "u1",
      created_at: T(2),
    });
    const secondary = msg({
      id: "s1",
      role: "assistant",
      content: "persona reply",
      reply_to_message_id: null,
      created_at: T(3),
    });

    const out = dedupeAssistantRows(sortMessagesAsc([user, primary, rivalPrimary, secondary]));
    expect(out.map((m) => m.id)).toEqual(["u1", "p1", "s1"]);
  });
});

describe("mergeRows", () => {
  it("is idempotent when Realtime redelivers the same row", () => {
    const user = msg({ id: "u1", role: "user", content: "hi", client_message_id: "cmid-1" });
    const reply = msg({
      id: "p1",
      role: "assistant",
      content: "answer",
      reply_to_message_id: "u1",
      created_at: T(1),
    });

    const first = mergeRows([], [user, reply]);
    expect(first.map((m) => m.id)).toEqual(["u1", "p1"]);
    expect(mergeRows(first, [reply])).toHaveLength(2);
  });
});

describe("buildChatItems", () => {
  const holdoff = 150000;

  it("renders an optimistic bubble, then a durable row once it commits", () => {
    const pending: PendingSend[] = [
      {
        clientMessageId: "cmid-1",
        content: "hello",
        clientSentAt: T(0),
        state: "sending",
        retryAt: 0,
      },
    ];

    const optimistic = buildChatItems({ rows: [], pending, retryHoldoffMs: holdoff, now: 0 });
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0]).toMatchObject({ key: "cmid-1", state: "sending", canRetry: false });

    const committed = msg({
      id: "u1",
      role: "user",
      content: "hello",
      client_message_id: "cmid-1",
      client_sent_at: T(0),
    });
    const durable = buildChatItems({
      rows: [committed],
      pending,
      retryHoldoffMs: holdoff,
      now: 0,
    });
    // One bubble only — the optimistic entry gives way to the server row.
    expect(durable).toHaveLength(1);
    expect(durable[0]).toMatchObject({ key: "cmid-1", state: "sent" });

    // Once the primary reply lands the optimistic entry is retired.
    const reply = msg({
      id: "p1",
      role: "assistant",
      content: "answer",
      reply_to_message_id: "u1",
      created_at: T(1),
    });
    expect(pruneResolvedPending(pending, [committed, reply])).toHaveLength(0);
    // ...but it is kept while the turn is still unanswered.
    expect(pruneResolvedPending(pending, [committed])).toHaveLength(1);
  });

  it("self-heals an orphaned composer row as a holdoff-gated failure", () => {
    const orphan = msg({
      id: "u9",
      role: "user",
      content: "never answered",
      client_message_id: "cmid-9",
      created_at: T(0),
    });
    const createdAt = Date.parse(T(0));

    const early = buildChatItems({
      rows: [orphan],
      pending: [],
      retryHoldoffMs: holdoff,
      now: createdAt + 1000,
    });
    expect(early[0].state).toBe("failed");
    expect(early[0].canRetry).toBe(false);
    expect(nextRetryAt(early, createdAt + 1000)).toBe(createdAt + holdoff);

    const late = buildChatItems({
      rows: [orphan],
      pending: [],
      retryHoldoffMs: holdoff,
      now: createdAt + holdoff + 1,
    });
    expect(late[0].canRetry).toBe(true);
    expect(nextRetryAt(late, createdAt + holdoff + 1)).toBeNull();

    // A turn this client still has in flight is not an orphan.
    const inFlight = buildChatItems({
      rows: [orphan],
      pending: [
        {
          clientMessageId: "cmid-9",
          content: "never answered",
          clientSentAt: T(0),
          state: "awaiting-reply",
          retryAt: 0,
        },
      ],
      retryHoldoffMs: holdoff,
      now: createdAt + holdoff + 1,
    });
    expect(inFlight[0].state).toBe("sent");
  });
});

describe("offline queue rendering (Step 9)", () => {
  const holdoff = 150000;

  it("renders a queued message as a replayable bubble, not a failure", () => {
    const queued: PendingSend[] = [
      {
        clientMessageId: "cmid-q",
        content: "typed offline",
        clientSentAt: T(0),
        state: "queued",
        retryAt: 0,
        reason: "offline",
      },
    ];

    const items = buildChatItems({ rows: [], pending: queued, retryHoldoffMs: holdoff, now: 0 });
    // Nothing was transmitted, so the gate is already open — the user can replay it now or
    // let the queue do it.
    expect(items[0]).toMatchObject({ state: "queued", reason: "offline", canRetry: true });
    expect(items[0].error).toBeUndefined();
  });

  it("holds an unknown-outcome message until the holdoff elapses", () => {
    const queued: PendingSend[] = [
      {
        clientMessageId: "cmid-u",
        content: "maybe delivered",
        clientSentAt: T(0),
        state: "queued",
        retryAt: Date.parse(T(0)) + holdoff,
        reason: "unknown",
      },
    ];

    const early = buildChatItems({ rows: [], pending: queued, retryHoldoffMs: holdoff, now: 0 });
    expect(early[0]).toMatchObject({ state: "queued", canRetry: false });
    // The screen wakes on this to unlock the replay button.
    expect(nextRetryAt(early, 0)).toBe(Date.parse(T(0)) + holdoff);

    const late = buildChatItems({
      rows: [],
      pending: queued,
      retryHoldoffMs: holdoff,
      now: Date.parse(T(0)) + holdoff + 1,
    });
    expect(late[0].canRetry).toBe(true);
    expect(nextRetryAt(late, Date.parse(T(0)) + holdoff + 1)).toBeNull();
  });

  it("gives way to the server row and is retired once the turn resolves", () => {
    const queued: PendingSend[] = [
      {
        clientMessageId: "cmid-q",
        content: "typed offline",
        clientSentAt: T(0),
        state: "queued",
        retryAt: 0,
        reason: "offline",
      },
    ];
    const committed = msg({
      id: "u1",
      role: "user",
      content: "typed offline",
      client_message_id: "cmid-q",
      client_sent_at: T(0),
    });
    const reply = msg({
      id: "p1",
      role: "assistant",
      content: "answer",
      reply_to_message_id: "u1",
      created_at: T(1),
    });

    // The request may have been delivered even though its response was lost, so the row
    // must replace the queued bubble rather than sitting next to it.
    const items = buildChatItems({
      rows: [committed],
      pending: queued,
      retryHoldoffMs: holdoff,
      now: 0,
    });
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe("sent");
    expect(pruneResolvedPending(queued, [committed, reply])).toHaveLength(0);
  });
});

describe("persona chips (Medium tier)", () => {
  const holdoff = 150000;
  const OPTIONS = {
    persona_options: [
      { key: "mentor_tough", label: "Tough love", one_liner: "Straight to it" },
      { key: "therapist_empath", label: "Gentle" },
    ],
  };

  it("reads chips off an assistant row and drops malformed entries", () => {
    const optionMessage = msg({
      id: "a1",
      role: "assistant",
      content: "Which mode?",
      reply_to_message_id: "u1",
      metadata: {
        persona_options: [
          { key: "mentor_tough", label: "Tough love", one_liner: "Straight to it" },
          { key: "therapist_empath", label: "Gentle" },
          { key: "no-label", label: 7 },
          null,
        ],
      },
      created_at: T(1),
    });

    expect(personaOptionsOf(optionMessage)).toEqual([
      { key: "mentor_tough", label: "Tough love", one_liner: "Straight to it" },
      { key: "therapist_empath", label: "Gentle", one_liner: "" },
    ]);

    // Chips are an assistant-row concept, and an empty set is no set at all.
    expect(
      personaOptionsOf(msg({ id: "u1", role: "user", content: "hi", metadata: OPTIONS })),
    ).toBeNull();
    expect(personaOptionsOf(msg({ id: "a2", role: "assistant", content: "no chips" }))).toBeNull();
    expect(
      personaOptionsOf(
        msg({ id: "a3", role: "assistant", content: "empty", metadata: { persona_options: [] } }),
      ),
    ).toBeNull();
  });

  it("spends the whole option set once its secondary reply lands", () => {
    const user = msg({
      id: "u1",
      role: "user",
      content: "I keep stalling",
      client_message_id: "cmid-1",
    });
    const optionMessage = msg({
      id: "a1",
      role: "assistant",
      content: "Which mode?",
      reply_to_message_id: "u1",
      metadata: OPTIONS,
      created_at: T(1),
    });
    const secondary = msg({
      id: "s1",
      role: "assistant",
      content: "gentle answer",
      reply_to_message_id: null,
      persona_key: "therapist_empath",
      secondary_reply_to_message_id: "u1",
      metadata: { persona: "therapist_empath", route: "options", source: "pipeline_secondary" },
      created_at: T(2),
    });

    const before = buildChatItems({
      rows: [user, optionMessage],
      pending: [],
      retryHoldoffMs: holdoff,
      now: 0,
    });
    const offered = before.find((item) => item.key === "a1");
    expect(offered?.personaOptions).toHaveLength(2);
    expect(offered?.chosenPersonaKey).toBeUndefined();

    const after = buildChatItems({
      rows: [user, optionMessage, secondary],
      pending: [],
      retryHoldoffMs: holdoff,
      now: 0,
    });
    // The secondary reply always renders, next to the primary it belongs to.
    expect(after.map((item) => item.key)).toEqual(["cmid-1", "a1", "s1"]);
    expect(after.find((item) => item.key === "a1")?.chosenPersonaKey).toBe("therapist_empath");
    expect(personaChoices([user, optionMessage, secondary]).get("u1")).toBe("therapist_empath");
    // The anchor is a user-message id, so nothing is keyed by the option message itself.
    expect(personaChoices([user, optionMessage, secondary]).has("a1")).toBe(false);
  });
});

describe("makeClientMessageId", () => {
  it("produces unique RFC 4122 v4 uuids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => makeClientMessageId()));
    expect(ids.size).toBe(500);
    expect(makeClientMessageId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
