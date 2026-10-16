// lib/sendQueue.test.ts
// Unit tests for the offline send queue (FP-02 Step 9 — FR-16, AC-8).
//
// `@react-native-async-storage/async-storage` is mocked for the same reason the app tests
// mock it: the store is device-only, so these tests exercise the pure helpers and the
// store's own bookkeeping. No network I/O is involved by design (see `lib/sendQueue.ts`).
//
// Refs: FP-02 FR-16, AC-8; TECH-SPECS §7.10; AGENTS.md §2.

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  dueItems,
  enqueueInto,
  enqueueSend,
  getSendQueue,
  loadSendQueue,
  markQueueAttempt,
  nextDueAt,
  parseQueue,
  parseQueuedSend,
  removeFrom,
  removeSend,
  resetSendQueueForTests,
  sortQueueAsc,
  storageKeyFor,
  type QueuedSend,
} from "./sendQueue";

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

function item(id: string, overrides: Partial<QueuedSend> = {}): QueuedSend {
  return {
    clientMessageId: id,
    content: `text ${id}`,
    clientSentAt: "2026-10-16T10:00:00.000Z",
    retryAt: 0,
    attempts: 0,
    reason: "offline",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  storage.removeItem.mockResolvedValue(undefined);
  resetSendQueueForTests();
});

describe("storageKeyFor", () => {
  it("scopes the queue to one user", () => {
    expect(storageKeyFor("user-a")).toBe("davos.send_queue.v1.user-a");
    expect(storageKeyFor("user-a")).not.toBe(storageKeyFor("user-b"));
  });
});

describe("parseQueuedSend", () => {
  it("accepts a well-formed entry", () => {
    expect(parseQueuedSend(item(ID_A))).toEqual(item(ID_A));
  });

  it("rejects entries that could never be replayed", () => {
    expect(parseQueuedSend(null)).toBeNull();
    expect(parseQueuedSend("nope")).toBeNull();
    expect(parseQueuedSend([item(ID_A)])).toBeNull();
    // The server validates client_message_id against a uuid regex, so a bad one would 400
    // on every replay and could never drain.
    expect(parseQueuedSend({ ...item(ID_A), clientMessageId: "not-a-uuid" })).toBeNull();
    // Empty text has nothing to send.
    expect(parseQueuedSend({ ...item(ID_A), content: "   " })).toBeNull();
  });

  it("coerces unusable fields instead of dropping the user's text", () => {
    const parsed = parseQueuedSend({
      clientMessageId: ID_A,
      content: "keep me",
      clientSentAt: "not a date",
      retryAt: Number.NaN,
      attempts: -3,
      reason: "??",
    });
    expect(parsed).toEqual({
      clientMessageId: ID_A,
      content: "keep me",
      clientSentAt: new Date(0).toISOString(),
      retryAt: 0,
      attempts: 0,
      // Unknown provenance is the conservative choice: it must wait out the holdoff.
      reason: "unknown",
    });
  });
});

describe("parseQueue", () => {
  it("parses, orders and dedupes a stored blob", () => {
    const raw = JSON.stringify([
      item(ID_B, { clientSentAt: "2026-10-16T10:00:02.000Z" }),
      item(ID_A, { clientSentAt: "2026-10-16T10:00:01.000Z" }),
      item(ID_B, { clientSentAt: "2026-10-16T10:00:09.000Z" }),
    ]);
    // Duplicate ids collapse to the first occurrence, so order stays as stored.
    expect(parseQueue(raw, 20).map((e) => e.clientMessageId)).toEqual([ID_A, ID_B]);
  });

  it("is empty for anything unreadable rather than failing to start", () => {
    expect(parseQueue(null, 20)).toEqual([]);
    expect(parseQueue("{not json", 20)).toEqual([]);
    expect(parseQueue('{"items":[]}', 20)).toEqual([]);
    expect(parseQueue(JSON.stringify([{ nope: true }]), 20)).toEqual([]);
  });

  it("keeps the newest items when a stale blob exceeds the cap", () => {
    const raw = JSON.stringify([
      item(ID_A, { clientSentAt: "2026-10-16T10:00:01.000Z" }),
      item(ID_B, { clientSentAt: "2026-10-16T10:00:02.000Z" }),
      item(ID_C, { clientSentAt: "2026-10-16T10:00:03.000Z" }),
    ]);
    expect(parseQueue(raw, 2).map((e) => e.clientMessageId)).toEqual([ID_B, ID_C]);
  });
});

describe("sortQueueAsc", () => {
  it("is oldest tap first and totally ordered", () => {
    const early = item(ID_A, { clientSentAt: "2026-10-16T10:00:01.000Z" });
    const late = item(ID_B, { clientSentAt: "2026-10-16T10:00:02.000Z" });
    // Same timestamp: the id breaks the tie so the walk can never stall on a coin flip.
    const tieA = item(ID_A, { clientSentAt: "2026-10-16T10:00:03.000Z" });
    const tieB = item(ID_B, { clientSentAt: "2026-10-16T10:00:03.000Z" });
    expect(sortQueueAsc([late, early]).map((e) => e.clientMessageId)).toEqual([ID_A, ID_B]);
    expect(sortQueueAsc([tieB, tieA]).map((e) => e.clientMessageId)).toEqual([ID_A, ID_B]);
  });
});

describe("enqueueInto", () => {
  it("appends in tap order", () => {
    const first = item(ID_A, { clientSentAt: "2026-10-16T10:00:01.000Z" });
    const second = item(ID_B, { clientSentAt: "2026-10-16T10:00:02.000Z" });
    const { queue, accepted } = enqueueInto([first], second, 20);
    expect(accepted).toBe(true);
    expect(queue).toEqual([first, second]);
  });

  it("replaces an existing id in place (no duplicate bubble)", () => {
    const { queue, accepted } = enqueueInto(
      [item(ID_A)],
      item(ID_A, { content: "edited" }),
      20,
    );
    expect(accepted).toBe(true);
    expect(queue).toHaveLength(1);
    expect(queue[0].content).toBe("edited");
  });

  it("refuses a new item when full, without evicting anything", () => {
    const { queue, accepted } = enqueueInto([item(ID_A)], item(ID_B), 1);
    expect(accepted).toBe(false);
    expect(queue.map((e) => e.clientMessageId)).toEqual([ID_A]);
  });
});

describe("removeFrom / dueItems / nextDueAt", () => {
  it("removes exactly one id", () => {
    expect(removeFrom([item(ID_A), item(ID_B)], ID_A).map((e) => e.clientMessageId)).toEqual([
      ID_B,
    ]);
    expect(removeFrom([item(ID_A)], ID_C)).toHaveLength(1);
  });

  it("walks only items whose gate has opened, oldest first", () => {
    const now = Date.parse("2026-10-16T10:00:00.000Z");
    const ready = item(ID_A, { retryAt: 0 });
    const later = item(ID_B, { retryAt: now + 1000 });
    const alsoReady = item(ID_C, { retryAt: now - 1 });
    expect(dueItems([later, ready, alsoReady], now)).toEqual([ready, alsoReady]);
  });

  it("reports the earliest future gate, or null", () => {
    const now = 1_000;
    expect(nextDueAt([item(ID_A)], now)).toBeNull();
    expect(nextDueAt([item(ID_A, { retryAt: now + 500 }), item(ID_B, { retryAt: now + 250 })], now)).toBe(
      now + 250,
    );
  });
});

describe("store", () => {
  it("loads a user's queue and caps it at the configured limit", async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify([
        item(ID_A, { clientSentAt: "2026-10-16T10:00:01.000Z" }),
        item(ID_B, { clientSentAt: "2026-10-16T10:00:02.000Z" }),
        item(ID_C, { clientSentAt: "2026-10-16T10:00:03.000Z" }),
      ]),
    );

    await loadSendQueue("user-a", 2);

    expect(storage.getItem).toHaveBeenCalledWith(storageKeyFor("user-a"));
    expect(getSendQueue().map((e) => e.clientMessageId)).toEqual([ID_B, ID_C]);
    // A readable blob is left alone.
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("discards an unreadable blob and clears the key", async () => {
    storage.getItem.mockResolvedValue("{corrupt");
    await loadSendQueue("user-a", 20);
    expect(getSendQueue()).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(storageKeyFor("user-a"));

    // Valid JSON that is not a queue array is corrupt too — a later enqueue rewrites it.
    storage.removeItem.mockClear();
    resetSendQueueForTests();
    storage.getItem.mockResolvedValue('{"items":[]}');
    await loadSendQueue("user-b", 20);
    expect(getSendQueue()).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(storageKeyFor("user-b"));
  });

  it("enqueues, persists, and refuses before a load", async () => {
    // Nothing is loaded yet, so there is no key to write to — refusing beats writing one
    // user's text under another user's key.
    await expect(enqueueSend(item(ID_A))).resolves.toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();

    await loadSendQueue("user-a", 20);
    await expect(enqueueSend(item(ID_A))).resolves.toBe(true);
    expect(getSendQueue().map((e) => e.clientMessageId)).toEqual([ID_A]);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      storageKeyFor("user-a"),
      expect.stringContaining(ID_A),
    );
  });

  it("refuses once the cap is reached and reports it", async () => {
    await loadSendQueue("user-a", 1);
    await expect(enqueueSend(item(ID_A))).resolves.toBe(true);
    await expect(enqueueSend(item(ID_B))).resolves.toBe(false);
    expect(getSendQueue().map((e) => e.clientMessageId)).toEqual([ID_A]);
  });

  it("drops an acknowledged item and re-gates a failed replay", async () => {
    await loadSendQueue("user-a", 20);
    await enqueueSend(item(ID_A));

    await markQueueAttempt(ID_A, 12_345);
    expect(getSendQueue()[0]).toMatchObject({ attempts: 1, retryAt: 12_345 });

    await removeSend(ID_A);
    expect(getSendQueue()).toEqual([]);
    // An unknown id is a no-op, not an error.
    await expect(removeSend(ID_B)).resolves.toBeUndefined();
  });

  it("reloads from a different user's own key", async () => {
    storage.getItem.mockImplementation(async (key: string) =>
      key === storageKeyFor("user-b") ? JSON.stringify([item(ID_B)]) : JSON.stringify([item(ID_A)]),
    );

    await loadSendQueue("user-a", 20);
    expect(getSendQueue().map((e) => e.clientMessageId)).toEqual([ID_A]);

    await loadSendQueue("user-b", 20);
    expect(getSendQueue().map((e) => e.clientMessageId)).toEqual([ID_B]);
  });

  it("does not reload when nothing changed", async () => {
    await loadSendQueue("user-a", 20);
    await loadSendQueue("user-a", 20);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });
});
