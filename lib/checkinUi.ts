// lib/checkinUi.ts
// FP-04 Step 5 — pure predicates for the chat check-in surface: the §7.1 energy emoji map, the
// pending-window resolution (notification payload first, else the open grid window) and the web
// banner visibility rule.
//
// Refs: FP-04 FR-4, FR-14; TECH-SPEC §7.1, §9; D1, D9.
// Pure by design — the only import is the grid math — so jest loads it exactly like
// `lib/checkinGrid.ts`, with the side-effectful wiring left in `lib/checkins.ts` / the screen.

import {
  currentOpenWindow,
  windowsForLocalDay,
  utcToLocalLabel,
  DAY_MS,
  type Grid,
  type GridWindow,
} from "./checkinGrid";

/** The energy scale, ascending — also the chip order (FR-14). */
export const ENERGY_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * The §7.1 emoji map. TECH-SPEC §7.1 fixes only the ends of the scale (`😴`…`🔥`); this is the
 * as-built per-value reading, recorded back into §7.1 by the Step 5 write-back.
 */
const ENERGY_EMOJI: Record<number, string> = {
  1: "😴",
  2: "😫",
  3: "😰",
  4: "😕",
  5: "😐",
  6: "🙂",
  7: "😊",
  8: "😄",
  9: "🤩",
  10: "🔥",
};

/** The emoji for an energy value, or `''` when the value is off the 1–10 scale. */
export function energyEmoji(energy: number): string {
  return ENERGY_EMOJI[energy] ?? "";
}

/** The settled chip-strip reading — `Energy: 7 😊` (FR-14, "the strip settles once set"). */
export function energyLabel(energy: number): string {
  const emoji = energyEmoji(energy);
  return emoji ? `Energy: ${energy} ${emoji}` : `Energy: ${energy}`;
}

/**
 * Which window a check-in-mode composer should carry (FR-4). The notification's own window is
 * authoritative — a tap seconds *after* the window closed must still answer that interval, not
 * the hour that has just opened — and only when the open carried no window at all (a web banner
 * tap, or a link that lost its payload) does the currently-open grid window stand in.
 */
export function resolveCheckInWindowTs(args: {
  payloadWindowTs: number | null | undefined;
  grid: Grid | null;
  nowMs: number;
  userId: string;
}): number | null {
  const { payloadWindowTs, grid, nowMs, userId } = args;
  if (typeof payloadWindowTs === "number" && Number.isFinite(payloadWindowTs)) {
    // A notification fires at its window's *close*, so the window it names has always opened by
    // the time it can be tapped. A start still ahead of the clock is therefore a tampered or
    // desynced hint, not a window to answer — fall through to the open window (the server would
    // reject a future hint with `window_future` anyway).
    if (payloadWindowTs <= nowMs) return payloadWindowTs;
  }
  if (!grid) return null;
  return currentOpenWindow(grid, nowMs, userId)?.startMs ?? null;
}

/**
 * Web banner visibility (FR-4, AC-10): web only, inside an open window, and not already
 * answered. Client-local by design — the predicate is answered from the cached grid and the
 * pending store, with no server round-trip. Web is the *only* banner platform: native has the
 * OS notification as its in-place surface.
 */
export function shouldShowCheckinBanner(args: {
  platformOS: string;
  grid: Grid | null;
  nowMs: number;
  userId: string;
  lastAnsweredMs: number | null;
}): boolean {
  const { platformOS, grid, nowMs, userId, lastAnsweredMs } = args;
  if (platformOS !== "web") return false;
  if (!grid) return false;
  const open = currentOpenWindow(grid, nowMs, userId);
  if (!open) return false;
  // Answered means answered for *this* window; an earlier window's answer never hides a later
  // one, so the comparison is against the open window's own start.
  if (lastAnsweredMs !== null && lastAnsweredMs >= open.startMs) return false;
  return true;
}

export interface DueCheckinWindow {
  window: GridWindow;
  windowTime: string; // e.g. "17:00–18:00"
  submitByTime: string; // e.g. "SUBMIT BY 18:10"
}

/**
 * Resolves whether a check-in is currently due for the user.
 * Per PRD §3.1 and TECH-SPEC §7.1:
 * Check-ins occur strictly at the end of a cadence period (at closeMs).
 * A cadence period [startMs, closeMs] becomes due once it closes:
 *   nowMs >= closeMs && nowMs <= closeMs + graceMinutes (default 10m).
 * If the period has already been answered, it is not due.
 */
export function findDueCheckinWindow(args: {
  grid: Grid | null;
  nowMs: number;
  userId: string;
  answeredStarts: readonly number[];
  graceMinutes?: number;
}): DueCheckinWindow | null {
  const { grid, nowMs, userId, answeredStarts, graceMinutes = 10 } = args;
  if (!grid) return null;

  const graceMs = graceMinutes * 60_000;
  // Candidate windows: today and yesterday (to handle midnight edge)
  const candidates = [
    ...windowsForLocalDay(grid, nowMs - DAY_MS, userId),
    ...windowsForLocalDay(grid, nowMs, userId),
  ];

  for (const w of candidates) {
    if (nowMs >= w.closeMs && nowMs <= w.closeMs + graceMs) {
      const isAnswered = answeredStarts.some((start) => Math.abs(start - w.startMs) < 60_000);
      if (!isAnswered) {
        const startLabel = utcToLocalLabel(grid.timezone, w.startMs) || w.isoStart.slice(11, 16);
        const closeLabel = utcToLocalLabel(grid.timezone, w.closeMs) || w.isoClose.slice(11, 16);
        const graceLabel = utcToLocalLabel(grid.timezone, w.closeMs + graceMs) || '';
        return {
          window: w,
          windowTime: `${startLabel}–${closeLabel}`,
          submitByTime: graceLabel ? `SUBMIT BY ${graceLabel}` : `SUBMIT BY ${closeLabel}`,
        };
      }
    }
  }

  return null;
}

/**
 * Next scheduled check-in time label (the closeMs of the current or upcoming period).
 * Used by StatusLine and Header meta when no check-in is due now.
 */
export function findNextCheckinTime(args: {
  grid: Grid | null;
  nowMs: number;
  userId: string;
}): string | null {
  const { grid, nowMs, userId } = args;
  if (!grid) return null;

  const candidates = [
    ...windowsForLocalDay(grid, nowMs, userId),
    ...windowsForLocalDay(grid, nowMs + DAY_MS, userId),
  ];

  for (const w of candidates) {
    if (nowMs < w.closeMs) {
      return utcToLocalLabel(grid.timezone, w.closeMs) || w.isoClose.slice(11, 16);
    }
  }

  return null;
}
