// lib/checkinSettings.test.ts
// FP-04 Step 7 — unit tests for the pure check-in settings logic (no React Native involved).
//
// Refs: FP-04 FR-17, FR-1; TECH-SPEC §7.1, §9; migration 0026 (the RPC contract).
// These carry Step 7's Verify: the validation mirror of the RPC, the RPC arg shape, and the
// re-arm input (a profile change produces a new id set) — the three claims a device would
// otherwise be needed to observe.

import { rollingWindows, windowsForLocalDay, type Grid } from './checkinGrid';
import {
  ACTIVE_HOURS_STEP_MINUTES,
  CADENCE_OPTIONS,
  cadenceLabel,
  formatClockLabel,
  gridFromPrefs,
  prefsFromGrid,
  prefsToRpcArgs,
  shiftClock,
  validateCheckinPrefs,
  type CheckinPrefs,
} from './checkinSettings';

// UTC keeps the grid arithmetic DST-free, so the expected instants are literal.
const HOURS_08_22: Pick<CheckinPrefs, 'activeStart' | 'activeEnd'> = {
  activeStart: '08:00',
  activeEnd: '22:00',
};

const prefs = (cadenceMinutes: 60 | 120): CheckinPrefs => ({ cadenceMinutes, ...HOURS_08_22 });

describe('cadence option model (FR-17)', () => {
  it('offers exactly the schema enum, labelled', () => {
    expect(CADENCE_OPTIONS).toEqual([60, 120]);
    expect(CADENCE_OPTIONS.map(cadenceLabel)).toEqual(['Hourly', 'Every 2 hours']);
  });
});

describe('active-hours clock math (FR-17)', () => {
  it('formats minutes since midnight, clamped into the day', () => {
    expect(formatClockLabel(0)).toBe('00:00');
    expect(formatClockLabel(570)).toBe('09:30');
    expect(formatClockLabel(23 * 60 + 59)).toBe('23:59');
    expect(formatClockLabel(-30)).toBe('00:00');
    expect(formatClockLabel(24 * 60)).toBe('23:59');
  });

  it('steps in half-hour increments without wrapping past midnight', () => {
    expect(ACTIVE_HOURS_STEP_MINUTES).toBe(30);
    expect(shiftClock('08:00', 30)).toBe('08:30');
    expect(shiftClock('08:00', -60)).toBe('07:00');
    // Clamped, never wrapped: the RPC rejects start >= end, so an overnight value is useless.
    expect(shiftClock('00:00', -30)).toBe('00:00');
    expect(shiftClock('23:30', 30)).toBe('23:59');
  });

  it('returns a malformed label unchanged (it is never repaired by guessing)', () => {
    expect(shiftClock('8:0', 30)).toBe('8:0');
    expect(shiftClock('', 30)).toBe('');
  });
});

describe('grid <-> form conversion', () => {
  it('normalizes a Postgres `time` into HH:MM', () => {
    const grid: Grid = {
      timezone: 'UTC',
      cadenceMinutes: 120,
      activeStart: '08:00:00',
      activeEnd: '22:00:00',
    };
    expect(prefsFromGrid(grid)).toEqual(prefs(120));
  });

  it('refuses a malformed row instead of inventing a value', () => {
    const grid: Grid = {
      timezone: 'UTC',
      cadenceMinutes: 60,
      activeStart: 'not-a-time',
      activeEnd: '22:00',
    };
    expect(prefsFromGrid(grid)).toBeNull();
  });

  it('round-trips through the grid the scheduler arms', () => {
    expect(gridFromPrefs(prefs(60), 'Asia/Kolkata')).toEqual({
      timezone: 'Asia/Kolkata',
      cadenceMinutes: 60,
      activeStart: '08:00',
      activeEnd: '22:00',
    });
  });
});

describe('validation mirror of `update_checkin_prefs` (FR-17)', () => {
  it('accepts the option set inside the active hours', () => {
    expect(validateCheckinPrefs(prefs(60))).toEqual({ ok: true });
    expect(validateCheckinPrefs(prefs(120))).toEqual({ ok: true });
  });

  it('rejects a cadence outside the enum', () => {
    expect(validateCheckinPrefs({ ...prefs(60), cadenceMinutes: 90 as 60 })).toEqual({
      ok: false,
      reason: 'cadence_invalid',
    });
  });

  it('rejects reversed and equal hours (no overnight window)', () => {
    expect(validateCheckinPrefs({ ...prefs(60), activeStart: '22:00', activeEnd: '08:00' })).toEqual(
      { ok: false, reason: 'hours_order' },
    );
    expect(validateCheckinPrefs({ ...prefs(60), activeStart: '08:00', activeEnd: '08:00' })).toEqual(
      { ok: false, reason: 'hours_order' },
    );
  });

  it('rejects a malformed label before the order test', () => {
    expect(validateCheckinPrefs({ ...prefs(60), activeStart: '25:00' })).toEqual({
      ok: false,
      reason: 'hours_malformed',
    });
  });
});

describe('the RPC arguments (the wire shape migration 0026 declares)', () => {
  it('carries exactly the four parameters, with the timezone passed through unchanged', () => {
    expect(prefsToRpcArgs(prefs(120), 'Asia/Kolkata')).toEqual({
      p_cadence: 120,
      p_start: '08:00',
      p_end: '22:00',
      p_tz: 'Asia/Kolkata',
    });
  });
});

describe('the re-arm input — a profile change produces a new id set (FR-1, AC-9)', () => {
  const nowMs = Date.UTC(2026, 9, 15, 10, 30);
  const userId = 'u1';

  it('emits the frozen counts per cadence', () => {
    const hour = windowsForLocalDay(gridFromPrefs(prefs(60), 'UTC'), nowMs, userId);
    const two = windowsForLocalDay(gridFromPrefs(prefs(120), 'UTC'), nowMs, userId);
    expect(hour).toHaveLength(14); // 08:00 … 21:00
    expect(two).toHaveLength(7); // 08:00, 10:00 … 20:00
  });

  it('re-arms a different set of deterministic ids', () => {
    const before = rollingWindows(gridFromPrefs(prefs(60), 'UTC'), nowMs, userId).windows.map(
      (w) => w.id,
    );
    const after = rollingWindows(gridFromPrefs(prefs(120), 'UTC'), nowMs, userId).windows.map(
      (w) => w.id,
    );
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toEqual(before);
    // Every id is the deterministic check-in key the scheduler cancels/schedules by.
    for (const id of [...before, ...after]) expect(id.startsWith(`checkin_${userId}_`)).toBe(true);
  });

  it('keeps every window inside the chosen active hours', () => {
    for (const cadence of CADENCE_OPTIONS) {
      const windows = windowsForLocalDay(gridFromPrefs(prefs(cadence), 'UTC'), nowMs, userId);
      const startMinutes = windows.map((w) => {
        const [h, m] = w.isoStart.split('T')[1].slice(0, 5).split(':').map(Number);
        return h * 60 + m;
      });
      // The last window's close (start + cadence) stays within the end boundary: no overnight.
      const lastStart = Math.max(...startMinutes);
      expect(startMinutes[0]).toBe(8 * 60);
      expect(lastStart + cadence).toBeLessThanOrEqual(22 * 60);
    }
  });
});
