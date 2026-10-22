// supabase/functions/_shared/accountability/runHistogram.ts
// FP-08 Step 8 — the impulse histogram's impure half (FR-21).
//
// Refs: FP-08 FR-20, FR-21; TECH-SPEC §7.8, §2.2–2.3, §8, §9; D22.
//
// Two legs share the `histogram_daily` job type:
//   * rebuild — `{user_id, computed_for}` from 0032's `histogram_eval_tick()` (01:00 local,
//     per user): bucket `impulse_failure` rows by user-local hour over the trailing
//     `histogram_window_days`, cold-start below `histogram_bucket_min_count`, cap the
//     qualifying buckets at top-2, and self-insert one fire job per bucket at
//     `bucket-start − preemptive_lead_minutes`. A time already passed is skipped.
//   * fire — `{user_id, leg:'fire', computed_for, bucket_hour, fire_at}`: deterministic text
//     from `templates.ts` with `rotateActivity`, one unprompted row
//     (`metadata.source='preemptive_block'`) and one high push deep-linking
//     `davos://chat?focus=alternative`.
//
// No provider import and no model call: the preemptive text is in-code (FR-21's recorded
// reading), so the only external call on the fire leg is the push. Both legs are idempotent:
// the rebuild dedupes on `(user, leg, computed_for, bucket_hour)` in **any** status, and the
// fire leg dedupes on the written row before it sends.

import { getConfigNumber, getConfigString, supabaseService } from "../config.ts";
import { localWallToUtcMs } from "../checkin/windows.ts";
import { FALLBACK_DOMAIN } from "../pipeline/persona.ts";
import { deliverIntervention } from "../checkin/runWatchdog.ts";
import {
  bucketByLocalHour,
  dayOrdinal,
  fireTime,
  qualifyingBuckets,
  rotateActivity,
  totalFailures,
  type Bucket,
  type HourBucketRow,
} from "./histogram.ts";
import { preemptiveText } from "./templates.ts";

/** FR-21's recorded reading: at most two preemptive pings per user-day. */
const FIRE_CAP = 2;

const DEEP_LINK = "davos://chat?focus=alternative";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asHour(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return n;
}

function dayParts(date: string): { y: number; mo: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

/** Shift a `YYYY-MM-DD` label by whole days. */
function shiftDate(date: string, deltaDays: number): string {
  const parts = dayParts(date);
  if (!parts) return date;
  return new Date(Date.UTC(parts.y, parts.mo - 1, parts.d + deltaDays)).toISOString().slice(0, 10);
}

function localMidnightMs(timezone: string, date: string): number | null {
  const parts = dayParts(date);
  if (!parts) return null;
  return localWallToUtcMs(timezone, parts.y, parts.mo, parts.d, 0, 0);
}

/** The zone's local date (`YYYY-MM-DD`) at `ms`; UTC when the zone is unreadable. */
function localDateKey(timezone: string, ms: number): string {
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

/** The zone's local hour (0–23) at `ms`; 0 when the zone is unreadable. */
function localHourOf(timezone: string, ms: number): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hourCycle: "h23",
      hour: "2-digit",
    }).formatToParts(new Date(ms)).find((part) => part.type === "hour")?.value;
    const n = Number(hour);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 0;
  } catch {
    return new Date(ms).getUTCHours();
  }
}

/** A local wall stamp `YYYY-MM-DDTHH:MM:00` → UTC ms, or null when it does not exist. */
function wallStampToUtcMs(timezone: string, stamp: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp);
  if (!match) return null;
  return localWallToUtcMs(
    timezone,
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

export interface HistogramConfig {
  windowDays: number;
  minCount: number;
  leadMinutes: number;
}

export interface ScheduledFire {
  job_id: string;
  bucket_hour: number;
  fire_at: string;
  activity: string | null;
}

export type HistogramRebuildReport =
  | { skipped: "no_profile" | "invalid_computed_for" | "no_grid"; buckets: Bucket[]; scheduled: [] }
  | {
    skipped?: "cold_start";
    computed_for: string;
    buckets: Bucket[];
    total: number;
    qualifying: Bucket[];
    scheduled: ScheduledFire[];
    past: number;
  };

export type HistogramFireOutcome =
  | {
    status: "written";
    assistant_message_id: string;
    activity: string | null;
    deep_link: string;
  }
  | { status: "duplicate"; assistant_message_id: string }
  | { status: "skipped"; reason: "invalid_payload" | "no_profile" };

async function readHistogramConfig(): Promise<HistogramConfig> {
  const [windowDays, minCount, leadMinutes] = await Promise.all([
    getConfigNumber("histogram_window_days"),
    getConfigNumber("histogram_bucket_min_count"),
    getConfigNumber("preemptive_lead_minutes"),
  ]);
  return {
    windowDays: Math.max(1, Math.floor(windowDays)),
    minCount: Math.max(1, Math.floor(minCount)),
    leadMinutes: Math.max(0, Math.round(leadMinutes)),
  };
}

interface ProfileRow {
  timezone: string | null;
  high_dopamine_activities: unknown;
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select("timezone, high_dopamine_activities")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`histogram: profile read failed: ${error.message}`);
  return (data as ProfileRow | null) ?? null;
}

function activitiesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function fireJobExists(args: {
  userId: string;
  computedFor: string;
  bucketHour: number;
}): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("jobs")
    .select("id")
    .eq("type", "histogram_daily")
    .eq("payload->>user_id", args.userId)
    .eq("payload->>leg", "fire")
    .eq("payload->>computed_for", args.computedFor)
    .eq("payload->>bucket_hour", String(args.bucketHour))
    .limit(1);
  if (error) throw new Error(`histogram fire dedupe failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The rebuild leg. `computeFor` defaults to the local day that just ended (the tick's own
 * `computed_for`), but the drill may pass any label. `nowMs` exists for the past-fire test.
 */
export async function runHistogramRebuild(args: {
  userId: string;
  computedFor?: string | null;
  nowMs?: number;
}): Promise<HistogramRebuildReport> {
  const profile = await loadProfile(args.userId);
  if (!profile) {
    console.log("[histogram]", JSON.stringify({ leg: "rebuild", user_id: args.userId, skipped: "no_profile" }));
    return { skipped: "no_profile", buckets: [], scheduled: [] };
  }
  const timezone = profile.timezone || "UTC";
  const nowMs = args.nowMs ?? Date.now();
  const computedFor = args.computedFor || shiftDate(localDateKey(timezone, nowMs), -1);
  if (!dayParts(computedFor)) {
    console.log(
      "[histogram]",
      JSON.stringify({ leg: "rebuild", user_id: args.userId, skipped: "invalid_computed_for" }),
    );
    return { skipped: "invalid_computed_for", buckets: [], scheduled: [] };
  }

  const config = await readHistogramConfig();
  const firstDay = shiftDate(computedFor, -(config.windowDays - 1));
  const startMs = localMidnightMs(timezone, firstDay);
  const endMs = localMidnightMs(timezone, shiftDate(computedFor, 1));
  if (startMs === null || endMs === null) {
    console.log("[histogram]", JSON.stringify({ leg: "rebuild", user_id: args.userId, skipped: "no_grid" }));
    return { skipped: "no_grid", buckets: [], scheduled: [] };
  }

  const { data, error } = await supabaseService
    .from("doings_logs")
    .select("logged_at")
    .eq("user_id", args.userId)
    .eq("kind", "impulse_failure")
    .gte("logged_at", new Date(startMs).toISOString())
    .lt("logged_at", new Date(endMs).toISOString());
  if (error) throw new Error(`histogram: impulse read failed: ${error.message}`);

  const rows: HourBucketRow[] = [];
  for (const row of data ?? []) {
    const at = Date.parse(String(row.logged_at));
    if (!Number.isFinite(at)) continue;
    rows.push({ local_date: localDateKey(timezone, at), local_hour: localHourOf(timezone, at) });
  }

  const buckets = bucketByLocalHour(rows, config.windowDays, computedFor);
  const total = totalFailures(buckets);
  if (total < config.minCount) {
    console.log(
      "[histogram]",
      JSON.stringify({ leg: "rebuild", user_id: args.userId, computed_for: computedFor, total, skipped: "cold_start" }),
    );
    return {
      skipped: "cold_start",
      computed_for: computedFor,
      buckets,
      total,
      qualifying: [],
      scheduled: [],
      past: 0,
    };
  }

  const qualifying = qualifyingBuckets(buckets, config.minCount, FIRE_CAP);
  const activities = activitiesOf(profile.high_dopamine_activities);
  const activity = rotateActivity(activities, dayOrdinal(computedFor));
  const scheduled: ScheduledFire[] = [];
  let past = 0;

  for (const bucket of qualifying) {
    const stamp = fireTime(bucket.hour, config.leadMinutes, computedFor);
    const at = wallStampToUtcMs(timezone, stamp);
    if (at === null || at <= nowMs) {
      past += 1;
      continue;
    }
    if (await fireJobExists({
      userId: args.userId,
      computedFor,
      bucketHour: bucket.hour,
    })) {
      continue;
    }
    const fireAt = new Date(at).toISOString();
    const { data: inserted, error: insertError } = await supabaseService
      .from("jobs")
      .insert({
        type: "histogram_daily",
        payload: {
          user_id: args.userId,
          leg: "fire",
          computed_for: computedFor,
          bucket_hour: bucket.hour,
          fire_at: fireAt,
        },
        next_retry_at: fireAt,
      })
      .select("id");
    if (insertError) throw new Error(`histogram fire insert failed: ${insertError.message}`);
    scheduled.push({
      job_id: String(inserted![0].id),
      bucket_hour: bucket.hour,
      fire_at: fireAt,
      activity,
    });
  }

  console.log(
    "[histogram]",
    JSON.stringify({
      leg: "rebuild",
      user_id: args.userId,
      computed_for: computedFor,
      total,
      qualifying: qualifying.length,
      scheduled: scheduled.length,
      past,
    }),
  );

  return { computed_for: computedFor, buckets, total, qualifying, scheduled, past };
}

async function findPreemptiveMessage(args: {
  userId: string;
  computedFor: string;
  bucketHour: number;
}): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", args.userId)
    .eq("metadata->>source", "preemptive_block")
    .eq("metadata->>computed_for", args.computedFor)
    .eq("metadata->>bucket", String(args.bucketHour))
    .limit(1);
  if (error) throw new Error(`histogram message dedupe failed: ${error.message}`);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** The fire leg: deterministic text, one unprompted row, one high push. */
export async function runHistogramFire(payload: Record<string, unknown>): Promise<HistogramFireOutcome> {
  const userId = asString(payload.user_id);
  const computedFor = asString(payload.computed_for);
  const bucketHour = asHour(payload.bucket_hour);
  if (!userId || !computedFor || bucketHour === null || !dayParts(computedFor)) {
    console.log("[histogram]", JSON.stringify({ leg: "fire", skipped: "invalid_payload" }));
    return { status: "skipped", reason: "invalid_payload" };
  }

  const profile = await loadProfile(userId);
  if (!profile) {
    console.log("[histogram]", JSON.stringify({ leg: "fire", user_id: userId, skipped: "no_profile" }));
    return { status: "skipped", reason: "no_profile" };
  }

  const existing = await findPreemptiveMessage({ userId, computedFor, bucketHour });
  if (existing) {
    console.log(
      "[histogram]",
      JSON.stringify({ leg: "fire", user_id: userId, duplicate: existing, bucket: bucketHour }),
    );
    return { status: "duplicate", assistant_message_id: existing };
  }

  const [config, persona] = await Promise.all([
    readHistogramConfig(),
    getConfigString("intervention_persona"),
  ]);
  const activity = rotateActivity(activitiesOf(profile.high_dopamine_activities), dayOrdinal(computedFor));
  const content = preemptiveText(activity, bucketHour, config.leadMinutes);

  const assistantMessageId = await deliverIntervention({
    userId,
    persona,
    content,
    metadata: {
      persona,
      domain: FALLBACK_DOMAIN,
      rule_ids: [],
      source: "preemptive_block",
      bucket: bucketHour,
      activity: activity,
      computed_for: computedFor,
    },
    deepLink: DEEP_LINK,
  });

  console.log(
    "[histogram]",
    JSON.stringify({
      leg: "fire",
      user_id: userId,
      computed_for: computedFor,
      bucket: bucketHour,
      activity,
      assistant_message_id: assistantMessageId,
    }),
  );

  return {
    status: "written",
    assistant_message_id: assistantMessageId,
    activity,
    deep_link: DEEP_LINK,
  };
}

/** Dispatcher entry: fire when the payload says so, otherwise rebuild. */
export async function runHistogram(payload: Record<string, unknown>): Promise<
  HistogramRebuildReport | HistogramFireOutcome
> {
  if (payload.leg === "fire") return runHistogramFire(payload);
  const userId = asString(payload.user_id);
  if (!userId) {
    console.log("[histogram]", JSON.stringify({ leg: "rebuild", skipped: "invalid_payload" }));
    return { skipped: "no_profile", buckets: [], scheduled: [] };
  }
  return runHistogramRebuild({
    userId,
    computedFor: asString(payload.computed_for),
  });
}
