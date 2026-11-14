// lib/todayService.ts
// Domain service for Day agenda, Anchor plans, Cadence tracker, and Activity timeline.
// Handles Supabase queries, RPC calls, window grid derivation, and client-side plan correlation.

import { supabase } from './supabase';
import { logger } from './logger';
import {
  windowsForLocalDay,
  currentOpenWindow,
  utcToLocalLabel,
  type Grid,
  type GridWindow,
  type CadenceMinutes,
} from './checkinGrid';
import type {
  PlanAnchor,
  PlanAnchorKind,
  ActivityItem,
  TrackerState,
  TrackerSegment,
} from '../domain/daySnapshot';

export interface StoredAnchor {
  id?: string;
  start: string;
  end: string;
  label: string;
  kind: string;
}

export interface UserProfileSchedule {
  id: string;
  checkin_cadence_minutes: CadenceMinutes;
  checkin_active_hours_start: string;
  checkin_active_hours_end: string;
  timezone: string;
}

export interface DoingRow {
  id: string;
  user_id: string;
  kind: 'doing' | 'impulse_failure';
  content: string | null;
  energy: number | null;
  source: string;
  logged_at: string;
  checkin_window: string | null;
}

/** Formats a Date object to YYYY-MM-DD in local or given timezone */
export function toDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fetch user's cadence and schedule profile */
export async function fetchUserScheduleProfile(
  userId: string
): Promise<UserProfileSchedule> {
  const fallback: UserProfileSchedule = {
    id: userId,
    checkin_cadence_minutes: 60,
    checkin_active_hours_start: '08:00',
    checkin_active_hours_end: '22:00',
    timezone: 'UTC',
  };

  if (!userId) return fallback;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end, timezone')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return fallback;
    }

    const cadence = (data.checkin_cadence_minutes === 120 ? 120 : 60) as CadenceMinutes;
    return {
      id: data.id,
      checkin_cadence_minutes: cadence,
      checkin_active_hours_start: data.checkin_active_hours_start || '08:00',
      checkin_active_hours_end: data.checkin_active_hours_end || '22:00',
      timezone: data.timezone || 'UTC',
    };
  } catch (err) {
    logger.warn('chat', 'Error fetching user schedule profile, using fallback', undefined, err);
    return fallback;
  }
}

/** Fetch today's anchor plan from anchor_plans table */
export async function fetchTodayAnchorPlan(
  userId: string,
  planDate: string
): Promise<StoredAnchor[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('anchor_plans')
      .select('anchors')
      .eq('user_id', userId)
      .eq('plan_date', planDate)
      .maybeSingle();

    if (error || !data || !Array.isArray(data.anchors)) {
      return [];
    }
    return data.anchors as StoredAnchor[];
  } catch (err) {
    logger.warn('chat', 'Failed to fetch anchor plan', undefined, err);
    return [];
  }
}

/** Save daily anchor plan via save_anchor_plan RPC */
export async function saveTodayAnchorPlan(
  planDate: string,
  anchors: StoredAnchor[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('save_anchor_plan', {
      p_plan_date: planDate,
      p_anchors: anchors,
    });

    if (error) {
      logger.error('chat', 'RPC save_anchor_plan failed', undefined, error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err: any) {
    logger.error('chat', 'Exception calling save_anchor_plan', undefined, err);
    return { ok: false, error: err?.message || 'unknown_error' };
  }
}

/** Fetch today's doings logs */
export async function fetchTodayDoings(
  userId: string,
  planDate: string
): Promise<DoingRow[]> {
  if (!userId) return [];
  try {
    const startIso = `${planDate}T00:00:00.000Z`;
    const endIso = `${planDate}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from('doings_logs')
      .select('id, user_id, kind, content, energy, source, logged_at, checkin_window')
      .eq('user_id', userId)
      .gte('logged_at', startIso)
      .lte('logged_at', endIso)
      .order('logged_at', { ascending: true });

    if (error || !data) {
      return [];
    }
    return data as DoingRow[];
  } catch (err) {
    logger.warn('chat', 'Failed to fetch today doings', undefined, err);
    return [];
  }
}

/** Pure window grid derivation: calculates TrackerState for today */
export function deriveTrackerFromGridAndDoings(
  profile: UserProfileSchedule,
  doings: DoingRow[],
  nowMs: number = Date.now()
): TrackerState {
  const grid: Grid = {
    timezone: profile.timezone,
    cadenceMinutes: profile.checkin_cadence_minutes,
    activeStart: profile.checkin_active_hours_start,
    activeEnd: profile.checkin_active_hours_end,
  };

  const windows = windowsForLocalDay(grid, nowMs, profile.id);
  if (windows.length === 0) {
    return { reportedCount: 0, totalCount: 0, lateCount: 0, segments: [] };
  }

  let reportedCount = 0;
  let lateCount = 0;

  const segments: TrackerSegment[] = windows.map((w) => {
    // Check if this window was reported
    const matchingDoing = doings.find((d) => {
      if (d.checkin_window) {
        const windowStart = new Date(d.checkin_window).getTime();
        return Math.abs(windowStart - w.startMs) < 60_000;
      }
      const loggedMs = new Date(d.logged_at).getTime();
      return loggedMs >= w.startMs && loggedMs <= w.closeMs + 900_000; // 15 min grace
    });

    const isReported = Boolean(matchingDoing);
    const startLabel = utcToLocalLabel(profile.timezone, w.startMs) || '';
    const closeLabel = utcToLocalLabel(profile.timezone, w.closeMs) || '';
    const title = `${startLabel}–${closeLabel}`;

    if (isReported) {
      reportedCount++;
      const loggedMs = matchingDoing ? new Date(matchingDoing.logged_at).getTime() : 0;
      const isLate = loggedMs > w.closeMs + 600_000; // >10 min past close
      if (isLate) lateCount++;
      return {
        state: isLate ? 'late' : 'done',
        title: isLate ? `${title} (late)` : `${title} (done)`,
      };
    }

    if (nowMs < w.startMs) {
      return { state: 'upcoming', title: `${title} (upcoming)` };
    }

    if (nowMs >= w.startMs && nowMs <= w.closeMs) {
      return { state: 'due', title: `${title} (due)` };
    }

    // Window closed without report
    lateCount++;
    return { state: 'late', title: `${title} (missed)` };
  });

  return {
    reportedCount,
    totalCount: windows.length,
    lateCount,
    segments,
  };
}

/** Correlates stored anchors with today's doings to compute UI PlanAnchor[] (Option 6A) */
export function correlateAnchorsWithDoings(
  storedAnchors: StoredAnchor[],
  doings: DoingRow[],
  profile: UserProfileSchedule,
  nowMs: number = Date.now()
): PlanAnchor[] {
  const currentClock = utcToLocalLabel(profile.timezone, nowMs) || '12:00';

  return storedAnchors.map((sa, idx) => {
    const id = sa.id || `anchor_${idx}_${sa.start.replace(':', '')}`;
    const title = sa.label || (sa as any).title || 'Focus';
    const isPast = sa.end <= currentClock;
    const isCurrent = sa.start <= currentClock && currentClock < sa.end;

    // Find overlapping doing
    const matchingDoing = doings.find((d) => {
      const doingTime = utcToLocalLabel(profile.timezone, new Date(d.logged_at).getTime()) || '';
      return doingTime >= sa.start && doingTime <= sa.end;
    });

    let status: PlanAnchor['status'] = 'scheduled';
    let evidence: PlanAnchor['evidence'] | undefined = undefined;

    if (matchingDoing) {
      status = 'done';
      const doingTime = utcToLocalLabel(profile.timezone, new Date(matchingDoing.logged_at).getTime()) || '';
      evidence = {
        source: `Source · period report · ${doingTime}`,
        text: matchingDoing.content ? `“${matchingDoing.content}”` : '',
        assessment: 'Activity logged during planned block matches focus.',
      };
    } else if (isPast) {
      status = 'pending';
    } else if (isCurrent) {
      status = 'pending';
    } else {
      status = 'scheduled';
    }

    return {
      id,
      start: sa.start,
      end: sa.end,
      title,
      kind: (sa.kind as PlanAnchorKind) || 'commitment',
      status,
      evidence,
    };
  });
}

/** Maps raw doings_logs rows into UI ActivityItem[] */
export function mapDoingsToActivityItems(
  doings: DoingRow[],
  profile: UserProfileSchedule
): ActivityItem[] {
  return doings.map((d) => {
    const time = utcToLocalLabel(profile.timezone, new Date(d.logged_at).getTime()) || '12:00';
    const isUrge = d.kind === 'impulse_failure';

    return {
      id: d.id,
      time,
      kind: isUrge ? 'urge' : 'report',
      title: isUrge ? (d.content || 'Urge logged') : (d.content || 'Period report'),
      sub: isUrge
        ? 'Impulse logged · yielded'
        : d.energy
        ? `Energy ${d.energy}/10`
        : 'Logged activity',
      energy: d.energy ?? undefined,
      outcome: isUrge ? 'yielded' : 'held',
      detail: {
        text: d.content || undefined,
      },
    };
  });
}
