// supabase/functions/_shared/accountability/histogram.ts
// FP-08 Step 2 — the urge histogram's pure half (FR-21).
//
// Refs: FP-08 FR-21; TECH-SPEC §7.8, §11; D22.
//
// The caller (`runHistogram.ts`) does the timezone work — every row arrives with its user-local
// `local_date`/`local_hour` and the rebuild passes the local day that just ended. Nothing here
// re-implements grid or timezone math (FP-04 NFR-7's spirit: one owner per rule).
//
// The anti-spam reading (FR-21's recorded reading): qualifying buckets are capped at the top 2
// per user-day, by count, with the earlier hour winning ties (deterministic).

export interface HourBucketRow {
  /** `YYYY-MM-DD`, user-local. */
  local_date: string;
  /** 0–23, user-local. */
  local_hour: number;
}

export interface Bucket {
  hour: number;
  count: number;
}

function dateMs(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Bucket the rows that fall inside the inclusive trailing window ending `endLocalDate`.
 * Hours are 0–23; an out-of-range hour is ignored rather than wrapped (a caller bug should not
 * invent a bucket).
 */
export function bucketByLocalHour(
  rows: HourBucketRow[],
  windowDays: number,
  endLocalDate: string,
): Bucket[] {
  const end = dateMs(endLocalDate);
  if (!Number.isFinite(end) || !Number.isFinite(windowDays) || windowDays <= 0) return [];
  const start = end - (Math.round(windowDays) - 1) * 86_400_000;
  const counts = new Array<number>(24).fill(0);
  for (const row of Array.isArray(rows) ? rows : []) {
    const at = dateMs(row.local_date);
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const hour = Math.round(row.local_hour);
    if (hour < 0 || hour > 23) continue;
    counts[hour] += 1;
  }
  return counts.map((count, hour) => ({ hour, count }));
}

/** Total failures in the window — the cold-start gate (`histogram_bucket_min_count`). */
export function totalFailures(buckets: Bucket[]): number {
  return (Array.isArray(buckets) ? buckets : []).reduce((sum, bucket) => sum + bucket.count, 0);
}

/**
 * FR-21: buckets at/over `minCount`, sorted by count descending then hour ascending, capped at
 * `cap` (default 2). A non-positive cap yields no fires.
 */
export function qualifyingBuckets(buckets: Bucket[], minCount: number, cap = 2): Bucket[] {
  if (!Number.isFinite(cap) || cap <= 0) return [];
  return (Array.isArray(buckets) ? buckets : [])
    .filter((bucket) => bucket.count >= minCount && bucket.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, Math.round(cap));
}

/**
 * The fire time for a bucket: the bucket's local start (`HH:00`) minus the lead minutes,
 * returned as a local wall-clock stamp `YYYY-MM-DDTHH:MM:00`. Wall-clock arithmetic only — the
 * caller converts it to a `timestamptz` with the profile's zone. A lead that crosses midnight
 * rolls the date backwards.
 */
export function fireTime(bucketHour: number, leadMinutes: number, localDate: string): string {
  const hour = Math.max(0, Math.min(23, Math.round(bucketHour)));
  const lead = Number.isFinite(leadMinutes) ? Math.max(0, Math.round(leadMinutes)) : 0;
  const start = Date.parse(`${localDate}T${String(hour).padStart(2, "0")}:00:00Z`);
  if (!Number.isFinite(start)) return `${localDate}T${String(hour).padStart(2, "0")}:00:00`;
  const fire = new Date(start - lead * 60_000);
  return `${fire.toISOString().slice(0, 10)}T${fire.toISOString().slice(11, 16)}:00`;
}

/**
 * The rotating activity: `high_dopamine_activities[dayOrdinal mod length]`. An empty (or
 * malformed) list returns null — the fire leg then sends the generic alternative text (the
 * item-10 seam recorded in FR-21).
 */
export function rotateActivity(activities: string[] | null | undefined, dayOrdinal: number): string | null {
  if (!Array.isArray(activities) || activities.length === 0) return null;
  const usable = activities.filter((item) => typeof item === "string" && item.trim().length > 0);
  if (usable.length === 0) return null;
  const ordinal = Number.isFinite(dayOrdinal) ? Math.trunc(dayOrdinal) : 0;
  const index = ((ordinal % usable.length) + usable.length) % usable.length;
  return usable[index];
}

/** `YYYY-MM-DD` → an ordinal day number (days since epoch), for `rotateActivity`. */
export function dayOrdinal(localDate: string): number {
  const parsed = dateMs(localDate);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
}
