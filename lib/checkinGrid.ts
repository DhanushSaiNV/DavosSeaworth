// lib/checkinGrid.ts
// FP-04 Step 4 — the client check-in grid: pure window arithmetic (jest-loadable twin of
// supabase/functions/_shared/checkin/windows.ts).
//
// Refs: FP-04 FR-1, FR-2, FR-3, NFR-7; TECH-SPEC §7.1 (frozen grid contract), §3.2; D1, D9.
// The server canonicalization (Step 2) and the client scheduler (Step 4) share one fixture.
// Drift between them is a stop condition (NFR-7).

export const DAY_MS = 86_400_000;

export type CadenceMinutes = 60 | 120;

export interface Grid {
  /** IANA zone; a null `profiles.timezone` reads as `'UTC'` (§7.1). */
  timezone: string;
  cadenceMinutes: CadenceMinutes;
  /** Profile-local wall clock, `'HH:MM'` or `'HH:MM:SS'` (a Postgres `time`). */
  activeStart: string;
  activeEnd: string;
}

export interface GridWindow {
  /** Unique id for scheduling/cancelling: `checkin_{userId}_{epochHour-of-window-start}`. */
  id: string;
  /** Window start in UTC ms. */
  startMs: number;
  /** Window close in UTC ms (the next emitted start, or start + cadence). */
  closeMs: number;
  /** Human-readable start in profile-local wall clock. */
  isoStart: string;
  /** Human-readable close in profile-local wall clock. */
  isoClose: string;
}

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
  // Accept HH:MM, HH:MM:SS, HH:MM:SS.fff — the DB `time` column can emit any of these.
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 60 + mi;
}

/** Build a `GridWindow` with the deterministic id and ISO labels. */
function toGridWindow(startMs: number, closeMs: number, userId: string): GridWindow {
  const epochHour = Math.floor(startMs / 3_600_000);
  return {
    id: `checkin_${userId}_${epochHour}`,
    startMs,
    closeMs,
    isoStart: new Date(startMs).toISOString(),
    isoClose: new Date(closeMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------- grid

/**
 * The emitted windows of the profile-local day containing `anchorMs`, ascending. Closes are the
 * next emitted start, else the window's own start + cadence.
 */
export function windowsForLocalDay(grid: Grid, anchorMs: number, userId: string): GridWindow[] {
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
  return starts.map((startMs, i) => {
    const closeMs = i + 1 < starts.length ? starts[i + 1] : startMs + cadence * 60_000;
    return toGridWindow(startMs, closeMs, userId);
  });
}

/**
 * Rolling next-24 h windows from `nowMs`, plus the currently-open window (if any).
 * Returns `{ windows, currentOpen }` where `windows` are all windows whose `closeMs`
 * falls in `(nowMs, nowMs + DAY_MS]` — i.e., the notifications that will fire in the next 24h.
 */
export function rollingWindows(grid: Grid, nowMs: number, userId: string): {
  windows: GridWindow[];
  currentOpen: GridWindow | null;
} {
  const anchors = [nowMs - DAY_MS, nowMs - DAY_MS / 2, nowMs, nowMs + DAY_MS / 2, nowMs + DAY_MS];
  const spans = new Map<number, GridWindow>();
  for (const anchor of anchors) {
    for (const w of windowsForLocalDay(grid, anchor, userId)) spans.set(w.startMs, w);
  }
  const all = [...spans.values()].sort((a, b) => a.startMs - b.startMs);
  const windows = all.filter((w) => w.closeMs > nowMs && w.closeMs <= nowMs + DAY_MS);
  const currentOpen = all.find((w) => w.startMs <= nowMs && nowMs < w.closeMs) ?? null;
  return { windows, currentOpen };
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
    for (const w of windowsForLocalDay(grid, anchor, "")) candidates.set(w.startMs, w);
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
 * Windows whose close falls in `(fromMs, toMs]`, ascending — the watchdog scan
 * (`now - watchdog_lookback_minutes` to `now - watchdog_grace_minutes`).
 * Mirrors `supabase/functions/_shared/checkin/windows.ts` exactly.
 */
export function windowsClosedBetween(grid: Grid, fromMs: number, toMs: number): GridWindow[] {
  const spans = new Map<number, GridWindow>();
  for (const anchor of [fromMs - grid.cadenceMinutes * 60_000, fromMs, toMs]) {
    for (const w of windowsForLocalDay(grid, anchor, "")) spans.set(w.startMs, w);
  }
  return [...spans.values()]
    .filter((w) => w.closeMs > fromMs && w.closeMs <= toMs)
    .sort((a, b) => a.startMs - b.startMs);
}