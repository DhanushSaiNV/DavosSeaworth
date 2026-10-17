// lib/checkins.test.ts
// FP-04 Step 4 — scheduler/queue unit tests (jest).
//
// Refs: FP-04 FR-1, FR-2, FR-3; TECH-SPEC §8; D9.
// Real notification firing waits for Step 8 device drill.

import { checkinQueue } from "./checkinQueue";
import {
  windowsForLocalDay,
  rollingWindows,
  canonicalizeWindow,
  windowsClosedBetween,
  parseClock,
  isValidTimeZone,
  type Grid,
} from "./checkinGrid";

// Mock AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

describe("checkinQueue", () => {
  const userId = "u1";

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    mockRemoveItem.mockResolvedValue(undefined);
  });

  test("loadQueue returns empty array when no data", async () => {
    const queue = await checkinQueue.loadQueue(userId);
    expect(queue).toEqual([]);
  });

  test("loadQueue parses stored JSON", async () => {
    const stored = [{ content: "test", windowTs: 123, retryAt: 456, attempts: 0 }];
    mockGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const queue = await checkinQueue.loadQueue(userId);
    expect(queue).toEqual(stored);
  });

  test("enqueueCheckIn adds entry with immediate retryAt", async () => {
    await checkinQueue.enqueueCheckIn(userId, "hello", 1000, 2000);
    expect(mockSetItem).toHaveBeenCalledWith(
      "checkin_queue_u1",
      JSON.stringify([{ content: "hello", windowTs: 1000, retryAt: 2000, attempts: 0 }]),
    );
  });

  test("flushQueue drains on success", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([{ content: "a", windowTs: 1, retryAt: 0, attempts: 0 }]),
    );
    const submitFn = jest.fn().mockResolvedValue({ ok: true });
    const { drained, remaining } = await checkinQueue.flushQueue(userId, submitFn, Date.now());
    expect(drained).toBe(true);
    expect(remaining).toBe(0);
    expect(submitFn).toHaveBeenCalledWith("a", 1);
  });

  test("flushQueue stops at first failure and schedules retry", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([
        { content: "a", windowTs: 1, retryAt: 0, attempts: 0 },
        { content: "b", windowTs: 2, retryAt: 0, attempts: 0 },
      ]),
    );
    const submitFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true }) // first succeeds
      .mockResolvedValueOnce({ ok: false, error: "network" }); // second fails

    const { drained, remaining } = await checkinQueue.flushQueue(userId, submitFn, 1000);
    expect(drained).toBe(false);
    expect(remaining).toBe(1); // second entry remains
    expect(submitFn).toHaveBeenCalledTimes(2);
    // Verify the failed entry was updated with backoff (it's the second entry, index 1)
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved[1].attempts).toBe(1);
    expect(saved[1].retryAt).toBeGreaterThan(1000);
  });

  test("flushQueue respects retryAt (not due yet)", async () => {
    const future = Date.now() + 60_000;
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([{ content: "a", windowTs: 1, retryAt: future, attempts: 0 }]),
    );
    const submitFn = jest.fn();
    const { drained, remaining } = await checkinQueue.flushQueue(userId, submitFn, Date.now());
    expect(drained).toBe(false);
    expect(remaining).toBe(1);
    expect(submitFn).not.toHaveBeenCalled();
  });

  test("flushQueue gives up after max attempts (5)", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([{ content: "a", windowTs: 1, retryAt: 0, attempts: 5 }]),
    );
    const submitFn = jest.fn().mockResolvedValue({ ok: false });
    const { drained, remaining } = await checkinQueue.flushQueue(userId, submitFn, Date.now());
    expect(drained).toBe(false);
    expect(remaining).toBe(1);
    // Should not call submitFn since attempts >= 5 (checked before calling)
    expect(submitFn).not.toHaveBeenCalled();
  });

  test("clearQueue removes the key", async () => {
    await checkinQueue.clearQueue(userId);
    expect(mockRemoveItem).toHaveBeenCalledWith("checkin_queue_u1");
  });
});

describe("checkinGrid — arm/cancel idempotency (static logic)", () => {
  const userId = "u1";
  const grid: Grid = { timezone: "UTC", cadenceMinutes: 60, activeStart: "08:00", activeEnd: "22:00" };

  test("windowsForLocalDay produces deterministic IDs", () => {
    const anchor = new Date("2026-01-15T12:00:00Z").getTime();
    const ws1 = windowsForLocalDay(grid, anchor, userId);
    const ws2 = windowsForLocalDay(grid, anchor, userId);
    expect(ws1.map((w) => w.id)).toEqual(ws2.map((w) => w.id));
    // ID format: checkin_{userId}_{epochHour}
    expect(ws1[0].id).toMatch(/^checkin_u1_\d+$/);
  });

  test("rollingWindows returns next-24h windows", () => {
    const now = new Date("2026-01-15T12:00:00Z").getTime();
    const { windows } = rollingWindows(grid, now, userId);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => w.closeMs > now && w.closeMs <= now + 86_400_000)).toBe(true);
  });

  test("canonicalizeWindow tie goes to earlier window", () => {
    const now = new Date("2026-01-15T12:30:00Z").getTime();
    const hint = new Date("2026-01-15T12:30:00Z").getTime(); // exactly halfway
    const res = canonicalizeWindow(grid, hint, now);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.window.isoStart).toBe("2026-01-15T12:00:00.000Z");
    }
  });

  test("windowsClosedBetween matches watchdog scan", () => {
    const from = new Date("2026-01-15T10:00:00Z").getTime();
    const to = new Date("2026-01-15T14:00:00Z").getTime();
    const ws = windowsClosedBetween(grid, from, to);
    expect(ws.map((w) => w.isoClose)).toEqual([
      "2026-01-15T11:00:00.000Z",
      "2026-01-15T12:00:00.000Z",
      "2026-01-15T13:00:00.000Z",
      "2026-01-15T14:00:00.000Z",
    ]);
  });
});

describe("web gate — no scheduling on web (static source check)", () => {
  test("Platform.OS gate present in checkins.ts", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require.resolve("./checkins.ts"), "utf-8");
    expect(source).toContain("Platform.OS === \"web\"");
    expect(source).toContain("return; // Step 5 banner is web's path");
  });
});

describe("Android channel/category registration (static source check)", () => {
  test("CHECKIN_CHANNEL_ID and CATEGORY_ID constants defined", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require.resolve("./checkins.ts"), "utf-8");
    expect(source).toContain('CHECKIN_CHANNEL_ID = "checkin"');
    expect(source).toContain('CHECKIN_CATEGORY_ID = "checkin_reply"');
  });

  test("ensureChannelAndCategory uses AndroidImportance.DEFAULT", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require.resolve("./checkins.ts"), "utf-8");
    expect(source).toContain("AndroidImportance.DEFAULT");
  });
});

describe("direct-reply content extraction (static source check)", () => {
  test("handleNotificationResponse reads response.userText", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require.resolve("./checkins.ts"), "utf-8");
    expect(source).toContain("response.userText");
  });
});

describe("queue flush triggers (static source check)", () => {
  const source = (): string =>
    require("fs").readFileSync(require.resolve("./checkins.ts"), "utf-8");

  test("Realtime replay fires on SUBSCRIBED, not a transport event", () => {
    expect(source()).toContain('status === "SUBSCRIBED"');
  });

  test("the replay is trigger-driven only — no timer (never poll or spin)", () => {
    const s = source();
    expect(s).not.toContain("setInterval");
    expect(s).not.toContain("setTimeout");
  });

  test("the flush triggers are all wired", () => {
    const s = source();
    expect(s).toContain("NetInfo.addEventListener"); // connectivity
    expect(s).toContain('.subscribe((status)'); // Realtime
    expect(s).toContain('AppState.addEventListener("change"'); // foreground
    expect(s).toMatch(/export async function flushCheckins/); // focus / manual
  });
});