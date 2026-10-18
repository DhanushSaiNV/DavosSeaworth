// supabase/functions/_shared/checkin/windows.ts
// FP-04 Step 2 — the server check-in grid: window generation and `windowTs` canonicalization.
//
// Refs: FP-04 FR-1 (the twin of the client grid), FR-5, FR-8, FR-15, NFR-5, NFR-7;
// TECH-SPEC §7.1 (the frozen grid contract), §3.2; D9.
//
// Why this half is its own module (and `loadGrid.ts` is the other half): this is pure
// arithmetic — no `Deno.env`, no service client — so `windows.test.ts` can load it under jest.
// `loadGrid.ts` performs the four-column `profiles` read and cannot (the `bands.ts` /
// `persona.ts` precedent).
//
// The contract (§7.1, frozen in Step 1):
//   * windows step from `checkin_active_hours_start` by `checkin_cadence_minutes` **in
//     profile-local wall time** — never epoch hour, so a UTC+5:30 profile still gets
//     08:00-local windows;
//   * a window is emitted only when its close (start + cadence) is <= `checkin_active_hours_end`
//     — no overnight windows, so a 23:00 start with a 23:59 end yields **none**;
//   * `checkin_window` stores the window **start**; the notification fires at its **close**;
//   * the snap tolerance is inclusive: |hint - start| <= cadence/2 (a tie goes to the
//     **earlier** start, so the resolution is deterministic);
//   * a null `profiles.timezone` reads as `'UTC'` (the loader substitutes it).
//
// Daylight saving: a local wall-clock label is mapped to an instant with a two-pass offset
// correction, and a label that does not exist (the spring-forward gap) is **skipped** — the
// clock reads 03:00 next, so that day simply has no 02:00 window. A repeated label (the
// fall-back hour) resolves to its **earlier** instant. A window's close is the next emitted
// start (else its own start + cadence), which is the *wall-clock* close in every case: across a
// transition it is the instant gap that varies, never the label.

export const DAY_MS = 86_400_000;

export type CadenceMinutes = 60 | 120;

export interface Grid {
  /** IANA zone; `loadGrid` substitutes `'UTC'` when `profiles.timezone` is null. */
  timezone: string;
  cadenceMinutes: CadenceMinutes;
  /** Profile-local wall clock, `'HH:MM'` or `'HH:MM:SS'` (a Postgres `time`). */
  activeStart: string;
  activeEnd: string;
}

export interface GridWindow {
  startMs: number;
  closeMs: number;
}

/** Why a hint was rejected. Each maps to a 400 the client can act on (and a gate can assert). */
export type WindowFailure =
  | "window_malformed"
  | "window_future"
  | "window_stale"
  | "window_off_grid";

export type WindowResolution =
  | { ok: true; window: GridWindow; snappedMs: number }
  | { ok: false; reason: WindowFailure };

// ---------------------------------------------------------------------------- wall clock

interface WallParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    // `hourCycle: 'h23'` (never alongside `hour12`) so midnight formats as "00", not "24".
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** True when the platform's ICU knows the zone. Guards a bogus `profiles.timezone`. */
export function isValidTimeZone(timezone: string): boolean {
  try {
    formatterFor(timezone).format(0);
    return true;
  } catch {
    return false;
  }
}

function wallParts(timezone: string, ms: number): WallParts | null {
  try {
    const parts = formatterFor(timezone).formatToParts(new Date(ms));
    const value = (type: string) => parts.find((p) => p.type === type)?.value;
    const out: WallParts = {
      y: Number(value("year")),
      mo: Number(value("month")),
      d: Number(value("day")),
      h: Number(value("hour")),
      mi: Number(value("minute")),
      s: Number(value("second")),
    };
    return Object.values(out).every((n) => Number.isFinite(n)) ? out : null;
  } catch {
    return null;
  }
}

/** The zone's offset from UTC at `ms`. Offsets are whole seconds, so this is exact. */
function offsetMs(timezone: string, ms: number): number | null {
  const w = wallParts(timezone, ms);
  if (!w) return null;
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - ms;
}

/** `'HH:MM'` in the zone — the fixture's human-readable label for an instant. */
export function utcToLocalLabel(timezone: string, ms: number): string | null {
  const w = wallParts(timezone, ms);
  if (!w) return null;
  return `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
}

/**
 * The instant at which the zone's wall clock reads `y-mo-d h:mi`, or null when that reading does
 * not exist (inside the spring-forward gap). Two correction passes: the first uses the offset at
 * the naive instant, the second the offset at the corrected instant. The round-trip check is
 * what rejects a non-existent label — and what makes the fall-back hour resolve to the earlier
 * occurrence (pass one lands on the pre-transition offset).
 */
export function localWallToUtcMs(
  timezone: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): number | null {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const first = offsetMs(timezone, naive);
  if (first === null) return null;
  let guess = naive - first;
  const second = offsetMs(timezone, guess);
  if (second !== null && second !== first) guess = naive - second;

  const w = wallParts(timezone, guess);
  if (!w || w.y !== y || w.mo !== mo || w.d !== d || w.h !== h || w.mi !== mi) return null;
  return guess;
}

/** Minutes since local midnight for a Postgres `time` string, or null when malformed. */
export function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 60 + mi;
}

// ---------------------------------------------------------------------------- grid

/**
 * The emitted windows of the profile-local day containing `anchorMs`, ascending. Closes are the
 * next emitted start, else the window's own start + cadence.
 */
export function windowsForLocalDay(grid: Grid, anchorMs: number): GridWindow[] {
  const startMin = parseClock(grid.activeStart);
  const endMin = parseClock(grid.activeEnd);
  if (startMin === null || endMin === null || endMin <= startMin) return [];

  const day = wallParts(grid.timezone, anchorMs);
  if (!day) return [];

  const cadence = grid.cadenceMinutes;
  const starts: number[] = [];
  // `label + cadence <= endMin` is the no-overnight rule, compared as wall-clock labels.
  for (let label = startMin; label + cadence <= endMin; label += cadence) {
    const ms = localWallToUtcMs(
      grid.timezone,
      day.y,
      day.mo,
      day.d,
      Math.floor(label / 60),
      label % 60,
    );
    if (ms === null) continue; // a non-existent local time: the clock skipped it
    starts.push(ms);
  }

  starts.sort((a, b) => a - b);
  return starts.map((startMs, i) => ({
    startMs,
    closeMs: i + 1 < starts.length ? starts[i + 1] : startMs + cadence * 60_000,
  }));
}

/**
 * Resolve a client `windowTs` hint to the canonical grid window (FR-5).
 *
 * Order matters and is deliberate: the hint's own bounds are checked **before** the snap (a
 * 27 h-old hint is stale whatever it is near), and the resolved start's bounds **after** it (a
 * hint just before the next start snaps forward into the future, which is a `window_future`).
 */
export function canonicalizeWindow(grid: Grid, hintMs: number, nowMs: number): WindowResolution {
  if (!Number.isFinite(hintMs) || !Number.isFinite(nowMs)) {
    return { ok: false, reason: "window_malformed" };
  }
  if (hintMs > nowMs) return { ok: false, reason: "window_future" };
  if (nowMs - hintMs > DAY_MS) return { ok: false, reason: "window_stale" };

  // The candidate days: an emitted start within cadence/2 of the hint can be on the hint's
  // local day or the one either side of it, and a legitimate late reply is up to 24 h old.
  const candidates = new Map<number, GridWindow>();
  for (const anchor of [
    hintMs - DAY_MS,
    hintMs - DAY_MS / 2,
    hintMs,
    hintMs + DAY_MS / 2,
    hintMs + DAY_MS,
    nowMs,
  ]) {
    for (const w of windowsForLocalDay(grid, anchor)) candidates.set(w.startMs, w);
  }
  if (candidates.size === 0) return { ok: false, reason: "window_off_grid" };

  const tolerance = (grid.cadenceMinutes * 60_000) / 2;
  let best: GridWindow | null = null;
  let bestDistance = Infinity;
  // Ascending, and only a strictly smaller distance replaces — so a tie keeps the earlier
  // start (the interval that just ended, not the one that is about to open).
  for (const w of [...candidates.values()].sort((a, b) => a.startMs - b.startMs)) {
    const distance = Math.abs(hintMs - w.startMs);
    if (distance < bestDistance) {
      best = w;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > tolerance) return { ok: false, reason: "window_off_grid" };
  if (best.startMs > nowMs) return { ok: false, reason: "window_future" };
  if (nowMs - best.startMs > DAY_MS) return { ok: false, reason: "window_stale" };

  return { ok: true, window: best, snappedMs: best.startMs - hintMs };
}

/**
 * Windows whose close falls in `(fromMs, toMs]`, ascending — the Step 6 watchdog scan
 * (`now - watchdog_lookback_minutes` to `now - watchdog_grace_minutes`).
 */
export function windowsClosedBetween(grid: Grid, fromMs: number, toMs: number): GridWindow[] {
  const spans = new Map<number, GridWindow>();
  for (const anchor of [fromMs - grid.cadenceMinutes * 60_000, fromMs, toMs]) {
    for (const w of windowsForLocalDay(grid, anchor)) spans.set(w.startMs, w);
  }
  return [...spans.values()]
    .filter((w) => w.closeMs > fromMs && w.closeMs <= toMs)
    .sort((a, b) => a.startMs - b.startMs);
}
