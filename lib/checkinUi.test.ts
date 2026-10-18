// lib/checkinUi.test.ts
// FP-04 Step 5 — unit tests for the pure check-in UI predicates (no React Native involved).
//
// Refs: FP-04 FR-4, FR-14; TECH-SPEC §7.1, §9. The chip state machine and the banner predicate
// are the two Step 5 behaviours a device/browser is otherwise needed to observe.

import {
  ENERGY_VALUES,
  energyEmoji,
  energyLabel,
  resolveCheckInWindowTs,
  shouldShowCheckinBanner,
} from "./checkinUi";
import type { Grid } from "./checkinGrid";

// UTC keeps the grid arithmetic DST-free, so the expected instants are literal.
const grid: Grid = {
  timezone: "UTC",
  cadenceMinutes: 60,
  activeStart: "08:00",
  activeEnd: "20:00",
};

const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 15, hour, minute);
const WINDOW_10 = at(10);
const WINDOW_09 = at(9);

describe("energy emoji map (FR-14, §7.1)", () => {
  it("maps the whole 1–10 scale and nothing else", () => {
    expect(ENERGY_VALUES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ENERGY_VALUES.map(energyEmoji)).toEqual([
      "😴",
      "😫",
      "😰",
      "😕",
      "😐",
      "🙂",
      "😊",
      "😄",
      "🤩",
      "🔥",
    ]);
    expect(energyEmoji(0)).toBe("");
    expect(energyEmoji(11)).toBe("");
  });

  it("labels the settled strip", () => {
    expect(energyLabel(7)).toBe("Energy: 7 😊");
    expect(energyLabel(10)).toBe("Energy: 10 🔥");
  });
});

describe("check-in window resolution (FR-4)", () => {
  it("prefers the notification payload over the clock", () => {
    // A tap one minute after the window closed still answers the window it asked about,
    // not the hour that has just opened.
    expect(
      resolveCheckInWindowTs({
        payloadWindowTs: WINDOW_10,
        grid,
        nowMs: at(11, 1),
        userId: "u1",
      }),
    ).toBe(WINDOW_10);
  });

  it("falls back to the currently-open window", () => {
    expect(
      resolveCheckInWindowTs({ payloadWindowTs: null, grid, nowMs: at(10, 30), userId: "u1" }),
    ).toBe(WINDOW_10);
    // A non-finite payload is not a window either.
    expect(
      resolveCheckInWindowTs({
        payloadWindowTs: Number.NaN,
        grid,
        nowMs: at(10, 30),
        userId: "u1",
      }),
    ).toBe(WINDOW_10);
  });

  it("never carries a window that has not opened yet", () => {
    // A notification fires at its window's close, so a start still ahead of the clock is a
    // tampered/desynced hint — the open window stands in instead.
    expect(
      resolveCheckInWindowTs({
        payloadWindowTs: at(14),
        grid,
        nowMs: at(10, 30),
        userId: "u1",
      }),
    ).toBe(WINDOW_10);
    // The window that just closed is still the one the tap answers (start < now).
    expect(
      resolveCheckInWindowTs({
        payloadWindowTs: WINDOW_10,
        grid,
        nowMs: at(11, 0),
        userId: "u1",
      }),
    ).toBe(WINDOW_10);
  });

  it("resolves to nothing outside active hours or without a grid", () => {
    expect(
      resolveCheckInWindowTs({ payloadWindowTs: null, grid, nowMs: at(21), userId: "u1" }),
    ).toBeNull();
    expect(
      resolveCheckInWindowTs({ payloadWindowTs: null, grid: null, nowMs: at(10, 30), userId: "u1" }),
    ).toBeNull();
  });
});

describe("web banner predicate (FR-4, AC-10)", () => {
  it("is web-only", () => {
    expect(
      shouldShowCheckinBanner({
        platformOS: "ios",
        grid,
        nowMs: at(10, 30),
        userId: "u1",
        lastAnsweredMs: null,
      }),
    ).toBe(false);
    expect(
      shouldShowCheckinBanner({
        platformOS: "android",
        grid,
        nowMs: at(10, 30),
        userId: "u1",
        lastAnsweredMs: null,
      }),
    ).toBe(false);
  });

  it("shows inside an open, unanswered window", () => {
    expect(
      shouldShowCheckinBanner({
        platformOS: "web",
        grid,
        nowMs: at(10, 30),
        userId: "u1",
        lastAnsweredMs: null,
      }),
    ).toBe(true);
  });

  it("hides once the open window has been answered", () => {
    expect(
      shouldShowCheckinBanner({
        platformOS: "web",
        grid,
        nowMs: at(10, 30),
        userId: "u1",
        lastAnsweredMs: WINDOW_10,
      }),
    ).toBe(false);
    // An earlier window's answer never hides a later one.
    expect(
      shouldShowCheckinBanner({
        platformOS: "web",
        grid,
        nowMs: at(10, 30),
        userId: "u1",
        lastAnsweredMs: WINDOW_09,
      }),
    ).toBe(true);
  });

  it("hides outside active hours and without a grid", () => {
    expect(
      shouldShowCheckinBanner({
        platformOS: "web",
        grid,
        nowMs: at(21),
        userId: "u1",
        lastAnsweredMs: null,
      }),
    ).toBe(false);
    expect(
      shouldShowCheckinBanner({
        platformOS: "web",
        grid: null,
        nowMs: at(10, 30),
        userId: "u1",
        lastAnsweredMs: null,
      }),
    ).toBe(false);
  });
});
