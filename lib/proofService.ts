// lib/proofService.ts
// Domain service for Screen S3 (Proof / Ledger).
// Queries 7-day doings_logs, computes weekly metrics, and groups records into LedgerDay[].

import { supabase } from './supabase';
import { logger } from './logger';
import { fetchUserScheduleProfile, type DoingRow, toDateString } from './todayService';
import { getHeldUrgesCount } from './urgeService';
import { windowsForLocalDay, utcToLocalLabel, type Grid } from './checkinGrid';
import { formatDayLabel, type DoingRecord } from '../fixtures/davos';

export interface LedgerDay {
  date: string;
  label: string;
  doings: DoingRecord[];
}

export interface ProofMetrics {
  checkinsRatio: string;
  onTimePercent: string;
  urgesHeld: number;
  weekRangeLabel: string;
  ledgerDays: LedgerDay[];
}

/** Formats a 7-day range label (e.g. "Oct 30 – Nov 5") */
export function formatWeekRangeLabel(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  return startMonth === endMonth
    ? `${startMonth} ${start.getDate()} – ${end.getDate()}`
    : `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}`;
}

export async function fetchProofData(
  userId: string,
  nowMs: number = Date.now()
): Promise<ProofMetrics> {
  const startMs = nowMs - 6 * 86_400_000;
  const startIso = new Date(startMs).toISOString();
  const weekRangeLabel = formatWeekRangeLabel(startMs, nowMs);

  if (!userId) {
    return {
      checkinsRatio: '0 of 0',
      onTimePercent: '—',
      urgesHeld: 0,
      weekRangeLabel,
      ledgerDays: [],
    };
  }

  try {
    const [profile, doingsRes, urgesHeld] = await Promise.all([
      fetchUserScheduleProfile(userId),
      supabase
        .from('doings_logs')
        .select('id, user_id, kind, content, energy, source, logged_at, checkin_window')
        .eq('user_id', userId)
        .gte('logged_at', startIso)
        .order('logged_at', { ascending: true }),
      getHeldUrgesCount(userId, startMs),
    ]);

    const doings: DoingRow[] = (doingsRes.data as DoingRow[]) || [];

    // Calculate total scheduled check-in windows up to now
    const grid: Grid = {
      timezone: profile.timezone,
      cadenceMinutes: profile.checkin_cadence_minutes,
      activeStart: profile.checkin_active_hours_start,
      activeEnd: profile.checkin_active_hours_end,
    };

    let totalWindows = 0;
    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
      const dayAnchor = nowMs - dayOffset * 86_400_000;
      const dayWins = windowsForLocalDay(grid, dayAnchor, userId);
      const pastOrCurrentWins = dayWins.filter((w) => w.startMs <= nowMs);
      totalWindows += pastOrCurrentWins.length;
    }

    const reportDoings = doings.filter((d) => d.kind === 'doing');
    const answeredCount = reportDoings.length;

    // Check-in ratio
    const checkinsRatio = `${answeredCount} of ${Math.max(answeredCount, totalWindows)}`;

    // On-time percentage calculation
    let onTimeCount = 0;
    for (const d of reportDoings) {
      if (d.checkin_window) {
        const winStart = new Date(d.checkin_window).getTime();
        const logged = new Date(d.logged_at).getTime();
        const grace = (profile.checkin_cadence_minutes + 10) * 60_000;
        if (logged - winStart <= grace) {
          onTimeCount++;
        }
      } else {
        onTimeCount++;
      }
    }

    const onTimePercent =
      answeredCount > 0 ? `${Math.round((onTimeCount / answeredCount) * 100)}%` : '—';

    // Group doings into days
    const dayMap = new Map<string, DoingRecord[]>();
    const nowRef = new Date(nowMs);

    // Initialize all 7 days so days with no doings still appear in ledger if desired,
    // or keep only days that have doings / today
    for (const d of doings) {
      const dateStr = toDateString(new Date(d.logged_at));
      const record: DoingRecord = {
        id: d.id,
        what: d.content || (d.kind === 'impulse_failure' ? 'Impulse yielded' : 'Cadence report'),
        when: utcToLocalLabel(profile.timezone, new Date(d.logged_at).getTime()) || '12:00',
        kind: d.kind === 'impulse_failure' ? 'impulse_yielded' : 'action',
        planLink: null,
      };

      const existing = dayMap.get(dateStr) || [];
      existing.push(record);
      dayMap.set(dateStr, existing);
    }

    // Sort days descending (today first)
    const sortedDateKeys = Array.from(dayMap.keys()).sort((a, b) => b.localeCompare(a));
    const ledgerDays: LedgerDay[] = sortedDateKeys.map((dateStr) => ({
      date: dateStr,
      label: formatDayLabel(dateStr, nowRef),
      doings: dayMap.get(dateStr) || [],
    }));

    return {
      checkinsRatio,
      onTimePercent,
      urgesHeld,
      weekRangeLabel,
      ledgerDays,
    };
  } catch (err) {
    logger.error('app', 'Failed to fetch proof data', undefined, err);
    return {
      checkinsRatio: '0 of 0',
      onTimePercent: '—',
      urgesHeld: 0,
      weekRangeLabel,
      ledgerDays: [],
    };
  }
}
