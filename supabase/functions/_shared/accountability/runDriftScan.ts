// supabase/functions/_shared/accountability/runDriftScan.ts
// FP-08 Step 5 — the drift scan's impure half (FR-12, FR-13, FR-3).
//
// Refs: FP-08 FR-3, FR-12, FR-13; TECH-SPEC §5.3–5.4, §7.3, §7.5; D15, D24.
//
// Pure Postgres + TypeScript: no provider import, no model call. The scan owns four reads
// (doings, the metric view, journal flags, config) and writes at most a streak award, one
// `intervention` job per fired pattern, and a surfaced habit. Every write is deduped so the
// 10-minute tick and a retry are both no-ops:
//   * streak      — +2 once per local day (the `trust_events` lookup, via `applyStreakAward`);
//   * pattern job — one per `(user, reason, local_day)` **any status** (dead jobs still block:
//                   a pattern that already fired that day must not page the user twice);
//   * habit       — the live-description guard, then one confrontation per habit per local day
//                   (plus an existing message blocks it), so a stuck `detected` row re-arms.
//
// `loadDriftEvidence` is exported because the intervention handler rebuilds the same evidence
// server-side (§5.3's payload rule) instead of trusting the job payload.

import { getConfig, getConfigBoolean, getConfigNumber, supabaseService } from "../config.ts";
import { loadGrid } from "../checkin/loadGrid.ts";
import { localWallToUtcMs, windowsForLocalDay } from "../checkin/windows.ts";
import {
  DRIFT_REASONS,
  HABIT_CONFRONTATION_REASON,
  driftReason,
  evaluateDrift,
  type DriftDay,
  type DriftEvaluation,
  type DriftPattern,
  type DriftThresholds,
} from "./drift.ts";
import {
  buildDescription,
  shouldSurface,
  type HabitCounts,
  type HabitPattern,
  type HabitThresholds,
} from "./habits.ts";
import { STREAK_MIN_DAYS, streakDays } from "./streak.ts";
import { applyStreakAward } from "./applyRider.ts";
import type { DriftFacts } from "./interventions.ts";

/** The seven-day habit window both surfacing paths share (FR-13). */
const HABIT_WINDOW_DAYS = 7;

export interface DriftConfig {
  windowDays: number;
  lateStartHour: number;
  complianceThreshold: number;
  energyThreshold: number;
  habitThresholds: HabitThresholds;
}

export interface DriftEvidence {
  timezone: string;
  config: DriftConfig;
  evaluation: DriftEvaluation;
  /** Impulse failures in the trailing 7 days (the habit path's count). */
  impulses7d: number;
  /** `habit_flag` journal entries in the trailing 7 days (the journal habit path). */
  journalFlags7d: number;
  /** Consecutive complete days ending yesterday (the streak input). */
  streak: number;
  /** `YYYY-MM-DD` in the user's zone at the scan instant. */
  today: string;
}

export interface DriftUserReport {
  userId: string;
  timezone: string;
  patterns: DriftPattern[];
  streak: number;
  streak_awarded: boolean;
  habit: { surfaced: boolean; description: string | null; pattern: HabitPattern | null };
  errors: string[];
}

export interface DriftScanReport {
  skipped?: "disabled";
  users: number;
  patterns_fired: number;
  habits_surfaced: number;
  streaks_awarded: number;
  per_user: DriftUserReport[];
}

// ---------------------------------------------------------------------------
// local-day arithmetic (the windows.ts helpers are ms-based; these are labels)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in the zone at `ms`. */
export function localDateKey(timezone: string, ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Minutes since local midnight at `ms`; 0 on an unreadable zone. */
export function localMinutesOfDay(timezone: string, ms: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(ms));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return hour * 60 + minute;
  } catch {
    return 0;
  }
}

function dayParts(date: string): { y: number; mo: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, mo, d };
}

/** Shift a `YYYY-MM-DD` label by whole days (labels are zone-free; UTC arithmetic is exact). */
export function shiftDate(date: string, deltaDays: number): string {
  const parts = dayParts(date);
  if (!parts) return date;
  const shifted = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/** The last `count` complete local days, oldest → newest (today excluded). */
export function completeDayKeys(timezone: string, nowMs: number, count: number): string[] {
  const today = localDateKey(timezone, nowMs);
  const keys: string[] = [];
  for (let offset = Math.max(1, count); offset >= 1; offset -= 1) {
    keys.push(shiftDate(today, -offset));
  }
  return keys;
}

/** Midnight UTC ms of a local date, or null when the wall time does not exist. */
function localMidnightMs(timezone: string, date: string): number | null {
  const parts = dayParts(date);
  if (!parts) return null;
  return localWallToUtcMs(timezone, parts.y, parts.mo, parts.d, 0, 0);
}

function localNoonMs(timezone: string, date: string): number | null {
  const parts = dayParts(date);
  if (!parts) return null;
  return localWallToUtcMs(timezone, parts.y, parts.mo, parts.d, 12, 0);
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

export async function readDriftConfig(): Promise<DriftConfig> {
  const [windowDays, lateStartHour, complianceThreshold, energyThreshold, rawThresholds] =
    await Promise.all([
      getConfigNumber("drift_window_days"),
      getConfigNumber("drift_late_start_hour"),
      getConfigNumber("drift_compliance_threshold"),
      getConfigNumber("drift_energy_threshold"),
      getConfig("habit_detection_thresholds"),
    ]);

  const record = typeof rawThresholds === "object" && rawThresholds !== null
    ? rawThresholds as Record<string, unknown>
    : {};
  const impulse = Number(record.impulse_failures_per_week);
  const journal = Number(record.journal_flags_per_week);

  return {
    windowDays: Math.max(1, Math.floor(windowDays)),
    lateStartHour: Number.isFinite(lateStartHour) ? lateStartHour : 10,
    complianceThreshold: Number.isFinite(complianceThreshold) ? complianceThreshold : 0.6,
    energyThreshold: Number.isFinite(energyThreshold) ? energyThreshold : 4,
    habitThresholds: {
      impulse_failures_per_week: Number.isFinite(impulse) ? impulse : 3,
      journal_flags_per_week: Number.isFinite(journal) ? journal : 3,
    },
  };
}

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

interface DoingRow {
  logged_at: string;
  checkin_window: string | null;
  kind: string;
}

interface EnergyRow {
  day: string;
  energy_avg: number | string | null;
}

/**
 * Build one user's evidence for the trailing complete days. Reads only; the caller decides
 * whether to write. `config` is injectable so the handler reuses the scan's read.
 */
export async function loadDriftEvidence(
  userId: string,
  nowMs: number,
  options: { timezone?: string; config?: DriftConfig } = {},
): Promise<DriftEvidence | null> {
  const timezone = options.timezone ?? "UTC";
  const config = options.config ?? (await readDriftConfig());
  const grid = await loadGrid(userId);
  if (!grid) return null;

  const days = completeDayKeys(timezone, nowMs, config.windowDays);
  if (days.length === 0) return null;
  const oldest = days[0];
  const windowStartMs = localMidnightMs(timezone, oldest);
  const todayStartMs = localMidnightMs(timezone, localDateKey(timezone, nowMs));
  if (windowStartMs === null || todayStartMs === null) return null;

  const { data: doingRows, error: doingError } = await supabaseService
    .from("doings_logs")
    .select("logged_at, checkin_window, kind")
    .eq("user_id", userId)
    .gte("logged_at", new Date(windowStartMs).toISOString())
    .lt("logged_at", new Date(todayStartMs).toISOString())
    .order("logged_at", { ascending: true });
  if (doingError) throw new Error(`doings_logs read failed: ${doingError.message}`);

  const byDay = new Map<string, DoingRow[]>();
  for (const row of (doingRows ?? []) as DoingRow[]) {
    const key = localDateKey(timezone, Date.parse(String(row.logged_at)));
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }

  const { data: energyRows, error: energyError } = await supabaseService
    .from("metric_vars_daily")
    .select("day, energy_avg")
    .eq("user_id", userId)
    .in("day", days);
  if (energyError) throw new Error(`metric_vars_daily read failed: ${energyError.message}`);

  const energyByDay = new Map<string, number | null>();
  for (const row of (energyRows ?? []) as EnergyRow[]) {
    const value = row.energy_avg === null || row.energy_avg === undefined
      ? null
      : Number(row.energy_avg);
    energyByDay.set(String(row.day), Number.isFinite(value as number) ? value as number : null);
  }

  const driftDays: DriftDay[] = [];
  for (const date of days) {
    const rows = byDay.get(date) ?? [];
    const doings = rows.filter((row) => row.kind === "doing");
    const first = doings.length > 0 ? Date.parse(String(doings[0].logged_at)) : Number.NaN;
    const answered = new Set(
      doings
        .map((row) => (row.checkin_window === null ? null : String(row.checkin_window)))
        .filter((value): value is string => value !== null)
        .map((value) => Date.parse(value))
        .filter((value) => Number.isFinite(value)),
    );

    const anchor = localNoonMs(timezone, date);
    let expected = 0;
    let answeredCount = 0;
    if (anchor !== null) {
      const windows = windowsForLocalDay(grid, anchor);
      expected = windows.length;
      answeredCount = windows.filter((window) => answered.has(window.startMs)).length;
    }

    driftDays.push({
      local_date: date,
      first_doing_minutes: Number.isFinite(first) ? localMinutesOfDay(timezone, first) : null,
      expected,
      answered: answeredCount,
      energy_avg: energyByDay.get(date) ?? null,
    });
  }

  const thresholds: DriftThresholds = {
    window_days: config.windowDays,
    late_start_hour: config.lateStartHour,
    compliance_threshold: config.complianceThreshold,
    energy_threshold: config.energyThreshold,
  };
  const evaluation = evaluateDrift(driftDays, thresholds);

  const since7d = new Date(nowMs - HABIT_WINDOW_DAYS * 86_400_000).toISOString();
  const { count: impulses, error: impulseError } = await supabaseService
    .from("doings_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "impulse_failure")
    .gte("logged_at", since7d);
  if (impulseError) throw new Error(`impulse count failed: ${impulseError.message}`);

  const { count: journalFlags, error: journalError } = await supabaseService
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("habit_flag", true)
    .gte("created_at", since7d);
  if (journalError) throw new Error(`journal flag count failed: ${journalError.message}`);

  const streak = streakDays(
    driftDays.map((day) => ({
      local_date: day.local_date,
      expected: day.expected,
      answered: day.answered,
    })),
    config.complianceThreshold,
  );

  return {
    timezone,
    config,
    evaluation,
    impulses7d: impulses ?? 0,
    journalFlags7d: journalFlags ?? 0,
    streak,
    today: localDateKey(timezone, nowMs),
  };
}

// ---------------------------------------------------------------------------
// evidence → the job's deterministic context (FR-14)
// ---------------------------------------------------------------------------

/** The payload context: numbers only, so §5.3's "never raw text in a job payload" holds. */
export function driftFactsFromEvidence(
  evidence: DriftEvidence,
  pattern: DriftPattern,
): DriftFacts {
  let expected = 0;
  let answered = 0;
  for (const day of evidence.evaluation.days) {
    expected += Math.max(0, day.expected);
    answered += Math.max(0, Math.min(day.expected, day.answered));
  }
  return {
    pattern,
    window_days: evidence.config.windowDays,
    late_start_hour: evidence.config.lateStartHour,
    late_days: evidence.evaluation.late_days,
    expected,
    answered,
    compliance_rate: evidence.evaluation.compliance_rate,
    energy_mean: evidence.evaluation.energy_mean,
    energized_days: evidence.evaluation.energized_days,
  };
}

// ---------------------------------------------------------------------------
// deduped writes
// ---------------------------------------------------------------------------

interface JobDedupe {
  reason: string;
  localDay: string;
  habitId?: string;
}

async function hasInterventionJob(userId: string, dedupe: JobDedupe): Promise<boolean> {
  let query = supabaseService
    .from("jobs")
    .select("id")
    .eq("type", "intervention")
    .eq("payload->>user_id", userId)
    .eq("payload->>reason", dedupe.reason)
    .eq("payload->>local_day", dedupe.localDay)
    .limit(1);
  if (dedupe.habitId) query = query.eq("payload->>habit_id", dedupe.habitId);
  const { data, error } = await query;
  if (error) throw new Error(`intervention dedupe failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function insertInterventionJob(payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseService.from("jobs").insert({
    type: "intervention",
    payload,
    next_retry_at: new Date().toISOString(),
  });
  if (error) throw new Error(`intervention insert failed: ${error.message}`);
}

async function findLiveHabit(
  userId: string,
  description: string,
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabaseService
    .from("habits")
    .select("id, status")
    .eq("user_id", userId)
    .eq("description", description)
    .in("status", ["detected", "confronted", "watch"])
    .limit(1);
  if (error) throw new Error(`habit guard failed: ${error.message}`);
  return (data ?? [])[0] ?? null;
}

async function hasConfrontationMessage(userId: string, habitId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>source", HABIT_CONFRONTATION_REASON)
    .eq("metadata->>habit_id", habitId)
    .limit(1);
  if (error) throw new Error(`confrontation dedupe failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function queueConfrontation(
  userId: string,
  habitId: string,
  localDay: string,
): Promise<boolean> {
  if (await hasConfrontationMessage(userId, habitId)) return false;
  if (await hasInterventionJob(userId, {
    reason: HABIT_CONFRONTATION_REASON,
    localDay,
    habitId,
  })) {
    return false;
  }
  await insertInterventionJob({
    user_id: userId,
    reason: HABIT_CONFRONTATION_REASON,
    habit_id: habitId,
    local_day: localDay,
  });
  return true;
}

// ---------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------

/**
 * One tick. Scans every complete profile (the 5-user plan and the FP-09 intake gate) and never
 * lets one user's failure stop the batch: a thrown read is caught per user and recorded in
 * that user's report.
 */
export async function runDriftScan(
  options: { nowMs?: number; userId?: string } = {},
): Promise<DriftScanReport> {
  // Fail-closed: an unreadable row skips the scan rather than running it.
  let enabled = false;
  try {
    enabled = await getConfigBoolean("drift_scan_enabled");
  } catch {
    enabled = false;
  }
  if (!enabled) {
    return {
      skipped: "disabled",
      users: 0,
      patterns_fired: 0,
      habits_surfaced: 0,
      streaks_awarded: 0,
      per_user: [],
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const config = await readDriftConfig();

  let profileQuery = supabaseService
    .from("profiles")
    .select("id, timezone")
    .eq("onboarding_stage", "complete")
    .order("id");
  if (options.userId) profileQuery = profileQuery.eq("id", options.userId);
  const { data: profiles, error: profileError } = await profileQuery;
  if (profileError) throw new Error(`profiles read failed: ${profileError.message}`);

  const perUser: DriftUserReport[] = [];
  let patternsFired = 0;
  let habitsSurfaced = 0;
  let streaksAwarded = 0;

  for (const profile of (profiles ?? []) as Array<{ id: string; timezone: string | null }>) {
    const userId = String(profile.id);
    const timezone = profile.timezone || "UTC";
    const report: DriftUserReport = {
      userId,
      timezone,
      patterns: [],
      streak: 0,
      streak_awarded: false,
      habit: { surfaced: false, description: null, pattern: null },
      errors: [],
    };
    perUser.push(report);

    try {
      const evidence = await loadDriftEvidence(userId, nowMs, { timezone, config });
      if (!evidence) {
        report.errors.push("no usable grid");
        continue;
      }
      report.streak = evidence.streak;

      // FR-3/FR-12: the streak award, once per local day, through the single writer.
      if (evidence.streak >= STREAK_MIN_DAYS) {
        const award = await applyStreakAward({
          userId,
          streak: evidence.streak,
          timezone,
          nowMs,
        });
        report.streak_awarded = award.awarded;
        if (award.awarded) streaksAwarded += 1;
      }

      // FR-12: one reason-tagged job per fired pattern, deduped on (user, pattern, local day).
      for (const pattern of evidence.evaluation.fired) {
        const reason = driftReason(pattern);
        if (await hasInterventionJob(userId, { reason, localDay: evidence.today })) continue;
        await insertInterventionJob({
          user_id: userId,
          reason,
          local_day: evidence.today,
          context: driftFactsFromEvidence(evidence, pattern),
        });
        report.patterns.push(pattern);
        patternsFired += 1;
      }

      // FR-13: habit surfacing (impulse wins when both fire — `shouldSurface`).
      const counts: HabitCounts = {
        impulse_failures: evidence.impulses7d,
        journal_flags: evidence.journalFlags7d,
      };
      const surface = shouldSurface(counts, evidence.config.habitThresholds);
      if (surface.surface && surface.pattern) {
        const description = buildDescription(surface.pattern, counts, HABIT_WINDOW_DAYS);
        const live = await findLiveHabit(userId, description);
        if (!live) {
          const { data: inserted, error: insertError } = await supabaseService
            .from("habits")
            .insert({ user_id: userId, description, status: "detected" })
            .select("id")
            .single();
          if (insertError || !inserted) {
            throw new Error(`habit insert failed: ${insertError?.message ?? "no row"}`);
          }
          habitsSurfaced += 1;
          report.habit = { surfaced: true, description, pattern: surface.pattern };
          await queueConfrontation(userId, String(inserted.id), evidence.today);
        } else {
          // A stuck `detected` row (its confrontation job died before writing) re-arms on the
          // next scan — deduped, so one row and one job, ever.
          if (live.status === "detected") {
            await queueConfrontation(userId, live.id, evidence.today);
          }
          report.habit = { surfaced: false, description, pattern: surface.pattern };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push(message);
      console.error(`[drift-scan] user ${userId} failed: ${message}`);
    }
  }

  console.log(
    JSON.stringify({
      tag: "[drift-scan]",
      users: perUser.length,
      patterns_fired: patternsFired,
      habits_surfaced: habitsSurfaced,
      streaks_awarded: streaksAwarded,
    }),
  );

  return {
    users: perUser.length,
    patterns_fired: patternsFired,
    habits_surfaced: habitsSurfaced,
    streaks_awarded: streaksAwarded,
    per_user: perUser,
  };
}

/** The kill switch is fail-closed: an unreadable row skips the scan rather than running it. */
export { DRIFT_REASONS, HABIT_CONFRONTATION_REASON, HABIT_WINDOW_DAYS };
