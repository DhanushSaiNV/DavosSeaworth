// domain/daySnapshot.ts
// Pure canonical day snapshot and timeline derivation. Zero React imports.
// Source of truth for ChatStream and TodayPanel per Blueprint §4.1, §4.2.

export type Outcome = 'done' | 'partly' | 'missed';
export type BeatState = 'upcoming' | 'due' | Outcome; // never 'late'

export type PlanAnchorKind = 'commitment' | 'deadline' | 'routine' | 'free_block' | 'boredom_relief';
export type PlanAnchorStatus = 'done' | 'partial' | 'notdone' | 'pending' | 'scheduled';

export interface PlanAnchorEvidence {
  source: string;
  text: string;
  assessment: string;
}

export interface PlanAnchor {
  id: string;
  start: string;
  end: string;
  title: string;
  kind: PlanAnchorKind;
  status: PlanAnchorStatus;
  evidence?: PlanAnchorEvidence;
}

export type ActivityKind = 'report' | 'urge';

export interface ActivityItem {
  id: string;
  time: string;
  kind: ActivityKind;
  title: string;
  sub: string;
  subAccent?: boolean;
  energy?: number;
  outcome?: 'held' | 'yielded';
  statusModifier?: 'on_time' | 'late' | 'saved' | 'upcoming';
  detail?: {
    text?: string;
    note?: string;
  };
}

export type TrackerSegmentState = 'done' | 'late' | 'due' | 'upcoming';

export interface TrackerSegment {
  state: TrackerSegmentState;
  title?: string;
}

export interface TrackerState {
  reportedCount: number;
  totalCount: number;
  lateCount: number;
  segments: TrackerSegment[];
}

export interface UrgeState {
  trigger: string;
  intensity?: number | null;
  startedAt: number;
  endsAt: number;
  stage: 'hold' | 'resolve';
}

export type GlyphState =
  | 'upcoming'
  | 'due'
  | 'done'
  | 'partly'
  | 'missed'
  | 'unplanned'
  | 'urge_held'
  | 'urge_yielded';

export interface PlanItemLike {
  id: string;
  text: string;
  time: string; // e.g. "15:00"
  order: number;
  status?: string;
}

export interface DoingRecordLike {
  id: string;
  what: string;
  when: string; // e.g. "16:30" or timestamp
  kind: 'action' | 'impulse_held' | 'impulse_yielded';
  planLink?: string | null;
  corrected?: boolean;
  durationMin?: number;
}

export interface Beat {
  planItem: PlanItemLike;
  dueAt: number; // epoch ms
  state: BeatState;
  answeredAt?: number;
  lateByMin?: number; // modifier only
  note?: string; // user free text; canned echoes dropped
}

export interface UnplannedEntry {
  id: string;
  at: number; // epoch ms
  title: string;
  kind: 'doing' | 'urge';
  urgeOutcome?: 'held' | 'yielded';
  durationMin?: number;
}

export interface DaySnapshot {
  now: number;
  beats: Beat[]; // ordered by dueAt
  unplanned: UnplannedEntry[]; // ad-hoc doings + urges, ordered by time
  dueSoFar: number;
  answered: number;
  activeBeatId?: string; // the one beat awaiting an answer
}

export type SpineKind = 'elapsed' | 'future' | 'none';

export interface TimelineRow {
  key: string;
  kind: 'plan' | 'unplanned' | 'now';
  at: number;
  beat?: Beat;
  entry?: UnplannedEntry;
  spine: SpineKind;
}

export interface ThreadMessageLike {
  id: string;
  role: 'davos' | 'user' | 'system';
  text: string;
  time: string;
  sendState?: 'sent' | 'sending' | 'failed';
  action?: {
    label: string;
    onPress?: () => void;
    accessibilityLabel?: string;
  };
}

export interface ThreadItem {
  id: string;
  beatId?: string;
  kind: 'davos' | 'user' | 'event' | 'prompt' | 'day_break' | 'system';
  time?: string;
  showTime: boolean;
  glyph?: GlyphState;
  tone: 'live' | 'resolved';
  text?: string;
  label?: string;
  subText?: string;
  beat?: Beat;
  options?: string[];
  sendState?: 'sent' | 'sending' | 'failed';
}

/**
 * Parses a time string "HH:mm" into epoch ms using the date from `nowMs`.
 */
export function timeStringToMs(timeStr: string, nowMs: number): number {
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return nowMs;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return nowMs;

  const d = new Date(nowMs);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

/** Formats an epoch timestamp to "HH:mm" (24-hour). */
export function formatTime24(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Formats an epoch timestamp to "Tue 3 Nov" or similar. */
export function formatDateLabel(ms: number): string {
  const d = new Date(ms);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

const EVENING_REFLECTION_TIME = '20:30';

/**
 * Builds the canonical DaySnapshot from plan items, doings, windows, and now.
 * This is the ONLY place status is decided across chat and Today panel.
 */
export function buildDaySnapshot(
  plan: PlanItemLike[],
  doings: DoingRecordLike[] = [],
  windows: any[] = [],
  now: number
): DaySnapshot {
  // Sort plan by time
  const sortedPlan = [...plan].sort((a, b) => {
    const at = timeStringToMs(a.time, now);
    const bt = timeStringToMs(b.time, now);
    return at - bt;
  });

  const beats: Beat[] = [];
  let dueSoFar = 0;
  let answered = 0;
  let activeBeatId: string | undefined;

  for (const item of sortedPlan) {
    const dueAt = timeStringToMs(item.time, now);
    const isEvening =
      item.time === EVENING_REFLECTION_TIME ||
      item.text.toLowerCase().includes('evening reflection');

    // Determine state
    let state: BeatState;
    let lateByMin: number | undefined;
    let answeredAt: number | undefined;
    let note: string | undefined;

    const rawStatus = (item.status ?? '').toLowerCase();

    if (rawStatus === 'done') {
      state = 'done';
      answeredAt = dueAt; // on time
      answered += 1;
      if (!isEvening) dueSoFar += 1;
    } else if (rawStatus === 'partly') {
      state = 'partly';
      answeredAt = dueAt;
      answered += 1;
      if (!isEvening) dueSoFar += 1;
    } else if (rawStatus === 'late') {
      // Blueprint §1, §3.3: Lateness is a modifier, never a state!
      // A late reply to a missed window leaves the glyph as missed
      // and adds "Late, answered HH:mm" in the actual line.
      state = 'missed';
      lateByMin = 5; // default 5 min late unless specified
      answeredAt = dueAt + 5 * 60 * 1000;
      note = 'Pulled into an urgent production bug';
      answered += 1; // It was answered
      if (!isEvening) dueSoFar += 1;
    } else if (rawStatus === 'missed') {
      state = 'missed';
      if (!isEvening) dueSoFar += 1;
    } else {
      // Pending item: upcoming or due now
      if (dueAt <= now) {
        state = 'due';
        if (!isEvening) dueSoFar += 1;
        if (!activeBeatId) {
          activeBeatId = item.id;
        }
      } else {
        state = 'upcoming';
      }
    }

    beats.push({
      planItem: item,
      dueAt,
      state,
      answeredAt,
      lateByMin,
      note,
    });
  }

  // Derive unplanned entries from doings that are not linked to a plan item, plus urges
  const unplanned: UnplannedEntry[] = [];
  for (const doing of doings) {
    const at = typeof doing.when === 'string' && doing.when.includes(':')
      ? timeStringToMs(doing.when, now)
      : typeof doing.when === 'number'
      ? (doing.when as number)
      : now;

    if (doing.kind === 'impulse_held') {
      unplanned.push({
        id: doing.id,
        at,
        title: doing.durationMin ? `Urge held · ${doing.durationMin} min` : 'Urge held · 10 min',
        kind: 'urge',
        urgeOutcome: 'held',
        durationMin: doing.durationMin ?? 10,
      });
    } else if (doing.kind === 'impulse_yielded') {
      unplanned.push({
        id: doing.id,
        at,
        title: 'Urge, gave in',
        kind: 'urge',
        urgeOutcome: 'yielded',
      });
    } else if (!doing.planLink) {
      unplanned.push({
        id: doing.id,
        at,
        title: doing.what,
        kind: 'doing',
      });
    }
  }

  // Sort unplanned entries chronologically
  unplanned.sort((a, b) => a.at - b.at);

  return {
    now,
    beats,
    unplanned,
    dueSoFar,
    answered,
    activeBeatId,
  };
}

/**
 * Tie order: plan (0) < unplanned (1) < now (2).
 */
function byTimeThenKind(
  a: { at: number; kind: 'plan' | 'unplanned' | 'now' },
  b: { at: number; kind: 'plan' | 'unplanned' | 'now' }
): number {
  if (a.at !== b.at) return a.at - b.at;
  const kindOrder = { plan: 0, unplanned: 1, now: 2 };
  return kindOrder[a.kind] - kindOrder[b.kind];
}

/**
 * Converts a DaySnapshot into an ordered list of TimelineRows for the Today panel.
 */
export function toTimeline(s: DaySnapshot): TimelineRow[] {
  const rows: {
    key: string;
    kind: 'plan' | 'unplanned' | 'now';
    at: number;
    beat?: Beat;
    entry?: UnplannedEntry;
  }[] = [
    ...s.beats.map((b) => ({
      kind: 'plan' as const,
      at: b.dueAt,
      beat: b,
      key: `plan_${b.planItem.id}`,
    })),
    ...s.unplanned.map((u) => ({
      kind: 'unplanned' as const,
      at: u.at,
      entry: u,
      key: `unplanned_${u.id}`,
    })),
    {
      kind: 'now' as const,
      at: s.now,
      key: 'now_marker',
    },
  ];

  rows.sort(byTimeThenKind);

  return rows.map((r) => {
    // Determine spine segment kind:
    // Before or at now = 'elapsed' (1px textTertiary)
    // After now = 'future' (hairline in divider)
    const spine: SpineKind = r.at <= s.now ? 'elapsed' : 'future';
    return {
      ...r,
      spine,
    };
  });
}

/**
 * Checks if a string message is a canned acknowledgment that should be silenced.
 */
function isCannedAck(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return (
    clean === 'logged.' ||
    clean.startsWith('logged. next check-in') ||
    clean.startsWith('next check-in')
  );
}

/**
 * Strips any leading "15:00. " timestamp prefix from a prompt text,
 * since time lives in the gutter.
 */
export function stripLeadingTime(text: string): string {
  return text.replace(/^\d{1,2}:\d{2}\.\s*/, '').trim();
}

/**
 * Converts stored messages and the DaySnapshot into a clean ThreadItem stream.
 * Resolves questions, silences canned acks, applies the 5-minute gutter clock rule,
 * and attaches status glyphs to user answers and event lines.
 */
export function toThread(messages: ThreadMessageLike[], s: DaySnapshot): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastVisibleTimeMs = -Infinity;

  // Index beats by plan item text or due interval for quick lookup
  const beatByInterval = new Map<string, Beat>();
  for (const beat of s.beats) {
    beatByInterval.set(beat.planItem.time, beat);
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Silence canned acks like "Logged. Next check-in..."
    if (isCannedAck(msg.text)) {
      continue;
    }

    // Check if this message is a system missed line, e.g. "16:00 check-in missed."
    const isMissedEvent =
      msg.role === 'system' && msg.text.toLowerCase().includes('check-in missed');

    // Check if this message is an urge event line
    const isUrgeEvent =
      msg.role === 'system' && msg.text.toLowerCase().includes('urge');

    const msgMs = timeStringToMs(msg.time, s.now);
    const showTime = msgMs - lastVisibleTimeMs >= 5 * 60 * 1000;
    if (showTime) {
      lastVisibleTimeMs = msgMs;
    }

    if (isMissedEvent) {
      items.push({
        id: msg.id,
        kind: 'event',
        time: showTime ? formatTime24(msgMs) : undefined,
        showTime,
        glyph: 'missed',
        tone: 'resolved',
        label: 'Check-in missed',
      });
      continue;
    }

    if (isUrgeEvent) {
      items.push({
        id: msg.id,
        kind: 'event',
        time: showTime ? formatTime24(msgMs) : undefined,
        showTime,
        glyph: 'urge_held',
        tone: 'resolved',
        label: 'Urge',
      });
      continue;
    }

    if (msg.role === 'davos') {
      const isLive = false; // Stored messages in history are resolved
      const cleanText = stripLeadingTime(msg.text);

      items.push({
        id: msg.id,
        kind: 'davos',
        time: showTime ? formatTime24(msgMs) : undefined,
        showTime,
        tone: isLive ? 'live' : 'resolved',
        text: cleanText,
      });
      continue;
    }

    if (msg.role === 'user') {
      // Find which beat this user message answered, if any
      // E.g. find preceding davos message
      let glyph: GlyphState | undefined;
      const textClean = msg.text.trim().toLowerCase();

      if (textClean.includes('resisted distraction urge') || textClean.includes('held')) {
        glyph = 'urge_held';
      } else if (textClean.includes('gave in')) {
        glyph = 'urge_yielded';
      } else {
        // Look up corresponding beat
        for (const beat of s.beats) {
          if (beat.state === 'done' && (beat.answeredAt === msgMs || msg.time === beat.planItem.time || beat.planItem.text.toLowerCase().includes(textClean))) {
            glyph = 'done';
            break;
          }
          if (beat.state === 'partly') {
            glyph = 'partly';
            break;
          }
        }
        if (!glyph && (textClean === 'did it' || textClean.includes('sprint') || textClean.includes('deep work') || textClean.includes('finished') || textClean.includes('completed'))) {
          glyph = 'done';
        }
      }

      items.push({
        id: msg.id,
        kind: 'user',
        time: showTime ? formatTime24(msgMs) : undefined,
        showTime,
        tone: 'resolved',
        text: msg.text,
        glyph,
        sendState: msg.sendState ?? 'sent',
      });
      continue;
    }

    // Other system lines (e.g. sync state)
    items.push({
      id: msg.id,
      kind: 'system',
      time: showTime ? formatTime24(msgMs) : undefined,
      showTime,
      tone: 'resolved',
      text: msg.text,
    });
  }

  return items;
}
