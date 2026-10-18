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

  test("markCheckInAnswered / getLastCheckInResponseAt use the per-user answered stamp", async () => {
    await checkinQueue.markCheckInAnswered(userId, 1_700_000_000_000);
    expect(mockSetItem).toHaveBeenCalledWith("checkin_last_answered_u1", "1700000000000");

    mockGetItem.mockResolvedValueOnce("1700000000000");
    expect(await checkinQueue.getLastCheckInResponseAt(userId)).toBe(1_700_000_000_000);

    // Never answered → null (the banner's "unanswered" reading).
    expect(await checkinQueue.getLastCheckInResponseAt(userId)).toBeNull();

    // A corrupted stamp must not surface as NaN (FR-4 predicate input).
    mockGetItem.mockResolvedValueOnce("not-a-number");
    expect(await checkinQueue.getLastCheckInResponseAt(userId)).toBeNull();
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
    // "a" drained and is gone; the failed "b" is the only stored entry, with backoff applied
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toBe("b");
    expect(saved[0].attempts).toBe(1);
    expect(saved[0].retryAt).toBeGreaterThan(1000);
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

  test("flushQueue drops a permanently-rejected item and keeps draining the rest", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([
        { content: "stale", windowTs: 1, retryAt: 0, attempts: 0 },
        { content: "good", windowTs: 2, retryAt: 0, attempts: 0 },
      ]),
    );
    const submitFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "window_stale", permanent: true })
      .mockResolvedValueOnce({ ok: true });

    const { drained, remaining } = await checkinQueue.flushQueue(userId, submitFn, Date.now());
    expect(drained).toBe(true);
    expect(remaining).toBe(0);
    // The 4xx was consumed, not retried — so the next item still got its turn.
    expect(submitFn).toHaveBeenCalledTimes(2);
  });

  test("flushQueue keeps retrying a transient failure (never a cap)", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([{ content: "a", windowTs: 1, retryAt: 0, attempts: 9 }]),
    );
    const submitFn = jest.fn().mockResolvedValue({ ok: false, error: "embed_unavailable" });
    const { drained, remaining } = await checkinQueue.flushQueue(userId, submitFn, Date.now());
    expect(drained).toBe(false);
    expect(remaining).toBe(1);
    expect(submitFn).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved[0].attempts).toBe(10); // counted, still queued
    expect(Number.isFinite(saved[0].retryAt)).toBe(true); // backoff is capped, never NaN
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
    expect(source).toMatch(/Platform\.OS === ['"]web['"]/);
    expect(source).toContain("return; // Step 5 banner is web's path");
  });

  test("the web branch still loads and publishes the grid (FR-4, AC-10)", () => {
    // Web schedules no notifications, but the in-app banner is web's only check-in surface and
    // reads `getGrid()`. Returning before the profile load left the grid null, so the banner
    // could never render — the regression this asserts against (caught in the Step 5 audit).
    const s = require("fs").readFileSync(require.resolve("./checkins.ts"), "utf-8");
    const gateAt = s.indexOf("Platform.OS === 'web'");
    const returnAt = s.indexOf("return; // Step 5 banner is web's path", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(gateAt);
    const branch = s.slice(gateAt, returnAt);
    expect(branch).toContain("loadProfileGrid(userId)");
    expect(branch).toContain("setLoadedGrid(");
  });
});

describe("Android channel/category registration (static source check)", () => {
  test("CHECKIN_CHANNEL_ID and CATEGORY_ID constants defined", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require.resolve("./checkins.ts"), "utf-8");
    // Versioned: Android freezes a channel's importance at creation, so raising it needs a
    // new id. The pre-drill `checkin` channel was created DEFAULT and could never peek.
    expect(source).toMatch(/CHECKIN_CHANNEL_ID = ['"]checkin_v2['"]/);
    expect(source).toMatch(/CHECKIN_CATEGORY_ID = ['"]checkin_reply['"]/);
  });

  test("ensureChannelAndCategory uses AndroidImportance.HIGH (a banner needs >= HIGH)", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require.resolve("./checkins.ts"), "utf-8");
    expect(source).toContain("AndroidImportance.HIGH");
    expect(source).not.toContain("AndroidImportance.DEFAULT");
  });
});

describe("notification presentation — a check-in is never suppressed (static source check)", () => {
  const read = (rel: string): string =>
    require("fs").readFileSync(require.resolve(rel), "utf-8");

  test("the foreground handler short-circuits a check-in BEFORE the chat-focus suppression", () => {
    const push = read("./push.ts");
    const checkinAt = push.indexOf("isCheckinNotification(notification)");
    const focusAt = push.indexOf("if (isChatFocused())");
    expect(checkinAt).toBeGreaterThan(-1);
    expect(focusAt).toBeGreaterThan(-1);
    // Order is the whole fix: a check-in must return before the focus test can suppress it.
    expect(checkinAt).toBeLessThan(focusAt);
  });

  test("the device zone is written only when it matches the device wall clock", () => {
    const sched = read("./checkins.ts");
    expect(sched).toContain("isTrustedDeviceZone(deviceTz)");
    expect(sched).toContain("utcToLocalLabel(deviceTz, Date.now())");
  });

  test("arm re-checks the notification permission (it is granted, not assumed)", () => {
    const sched = read("./checkins.ts");
    expect(sched).toContain("getPermissionsAsync");
    expect(sched).toContain("requestPermissionsAsync");
  });
});

describe("direct-reply content extraction (static source check)", () => {
  const source = (): string =>
    require("fs").readFileSync(require.resolve("./checkins.ts"), "utf-8");

  test("handleNotificationResponse reads response.userText", () => {
    expect(source()).toContain("response.userText");
  });

  test("the reply is posted with an ISO `windowTs` (the server's canonical wire form)", () => {
    expect(source()).toContain("windowTs: new Date(windowTs).toISOString()");
  });

  test("a consumed reply dismisses the notification (clears the Android send spinner)", () => {
    const s = source();
    expect(s).toContain("dismissNotificationAsync");
    expect(s).toContain("clearLastNotificationResponse");
  });

  test("a reply delivered after process death is replayed at arm (FR-3)", () => {
    expect(source()).toContain("getLastNotificationResponse()");
  });
});

describe("queue flush triggers (static source check)", () => {
  const source = (): string =>
    require("fs").readFileSync(require.resolve("./checkins.ts"), "utf-8");

  test("Realtime replay fires on SUBSCRIBED, not a transport event", () => {
    expect(source()).toMatch(/status === ['"]SUBSCRIBED['"]/);
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
    expect(s).toMatch(/AppState\.addEventListener\(['"]change['"]/); // foreground
    expect(s).toMatch(/export async function flushCheckins/); // focus / manual
  });
});