// lib/checkinCounts.ts
// Pure canonical check-in counts and status derivation.
// Feeds the StatusLine (Chat, Today) and TodayPanel per PRD Step 0, C.1, C.2, and AU41.

export type CheckinItemStatus = 'pending' | 'done' | 'partly' | 'late' | 'missed';

export interface CheckinStatusItem {
  id: string;
  time: string; // e.g. "09:00", "11:00", "13:00", "14:00", "20:30"
  status: CheckinItemStatus;
  order?: number;
  text?: string;
}

export interface NextOrDueInfo {
  isDue: boolean;
  label: 'Due now' | 'Next check-in';
  time: string;
}

export interface CheckinCountsResult {
  /** Check-ins scheduled today (M), excluding evening reflection (20:30) */
  scheduledTotal: number;
  /** Check-ins answered on time */
  answeredOnTime: number;
  /** Check-ins answered late (a missed check-in answered after follow-up) */
  answeredLate: number;
  /** Total answered count (on-time + late) */
  answeredTotal: number;
  /** Missed check-ins */
  missedTotal: number;
  /**
   * Status progress wording:
   * "N of M answered", plus " · X missed" when any are missed.
   */
  progressText: string;
  /** Single next or due check-in reading feeding StatusLine and TodayPanel */
  nextOrDue: NextOrDueInfo;
  /** Formatted full status line text, e.g. "Due now 14:00 · 3 of 4 answered" */
  statusLineText: string;
}

/** Check-in times that are reflection ceremonies and not hourly check-ins */
const EVENING_REFLECTION_TIME = '20:30';

/**
 * Computes check-in counts and status from today's plan/checkin items.
 * Single source of truth feeding StatusLine, TodayPanel, and Today.
 */
export function computeCheckinStatus(
  items: CheckinStatusItem[],
  options?: {
    dueInterval?: string | null;
    isPending?: boolean;
    nextCheckInTime?: string;
  }
): CheckinCountsResult {
  // Check-ins scheduled today (M), excluding 20:30 evening reflection
  const checkins = items.filter(
    (item) => item.time !== EVENING_REFLECTION_TIME && !item.text?.toLowerCase().includes('evening reflection')
  );
  const scheduledTotal = checkins.length;

  let answeredOnTime = 0;
  let answeredLate = 0;
  let missedTotal = 0;

  for (const item of checkins) {
    if (item.status === 'done' || item.status === 'partly') {
      answeredOnTime += 1;
    } else if (item.status === 'late') {
      answeredLate += 1;
    } else if (item.status === 'missed') {
      missedTotal += 1;
    }
  }

  const answeredTotal = answeredOnTime + answeredLate;

  // Status wording: "N of M answered", plus " · X missed" when any are missed
  let progressText = `${answeredTotal} of ${scheduledTotal} answered`;
  if (missedTotal > 0) {
    progressText += ` · ${missedTotal} missed`;
  }

  // Next or due check-in calculation
  const pendingItems = checkins.filter((c) => c.status === 'pending');
  const hasPending = options?.isPending !== undefined ? options.isPending : pendingItems.length > 0;

  let nextOrDue: NextOrDueInfo;
  if (hasPending && (options?.dueInterval || pendingItems[0])) {
    const dueTime = options?.dueInterval || pendingItems[0]?.time || '14:00';
    nextOrDue = {
      isDue: true,
      label: 'Due now',
      time: dueTime,
    };
  } else {
    // If no check-in is pending, show next check-in
    nextOrDue = {
      isDue: false,
      label: 'Next check-in',
      time: options?.nextCheckInTime || '15:00',
    };
  }

  const statusLineText = `${nextOrDue.label} ${nextOrDue.time} · ${progressText}`;

  return {
    scheduledTotal,
    answeredOnTime,
    answeredLate,
    answeredTotal,
    missedTotal,
    progressText,
    nextOrDue,
    statusLineText,
  };
}
