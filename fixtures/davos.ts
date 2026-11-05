// fixtures/davos.ts
// Fixture module for ORCA attributes and blocked data layer contracts (RECON.md §7, ORCA.md §1).
// All data derived from one consistent clock (PRD B1).
// Rules enforced:
// 1. Single clock: now = 18:15, next check-in = 19:00.
// 2. Active hours: 15:00 to 22:59 (per C.3). All plan items and check-ins fall inside active hours.
// 3. Next check-in time is identical in Thread, StatusLine, Today, and TodayPanel.
// 4. Late check-in (16:00) appears consistently in Thread, Today, and TodayPanel.
// 5. Nothing is logged after "now" (18:15).
// 6. Real dynamic date label calculation (no hardcoded weekdays).

import { computeCheckinStatus, type CheckinCountsResult, type NextOrDueInfo } from '../lib/checkinCounts';
import { format24Hour } from '../lib/timeFormat';
export { computeCheckinStatus, type CheckinCountsResult, type NextOrDueInfo };

export const FIXTURE_ACTIVE_START = '15:00';
export const FIXTURE_ACTIVE_END = '22:59';
export const FIXTURE_CLOCK_NOW = '18:15';
export const FIXTURE_NEXT_CHECKIN = '19:00';
export const FIXTURE_NOW = new Date(2026, 10, 3, 18, 4, 0, 0).getTime();

export interface PlanItem {
  id: string;
  text: string;
  time: string;
  order: number;
  status: 'pending' | 'done' | 'partly' | 'late' | 'missed';
}

export interface CheckInItem {
  id: string;
  interval: string;
  prompt: string;
  planItem: PlanItem | null;
  status: 'pending' | 'answered' | 'missed';
}

export interface DoingRecord {
  id: string;
  what: string;
  when: string;
  kind: 'action' | 'impulse_held' | 'impulse_yielded';
  planLink?: string | null;
  corrected?: boolean;
  durationMin?: number;
}

export interface ThreadMessage {
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

export interface StatusLineData {
  nextCheckIn: string;
  progress: string;
  syncState: 'normal' | 'offline';
}

export interface ReflectionRecord {
  date: string;
  summary: string;
  answers: {
    q1?: string;
    q2?: string;
    q3?: string;
  };
  status: 'draft' | 'saved';
}

// 2. Plan items for Today (all inside active hours 15:00-22:59; 16:00 late per C.1)
export const sampleTodayPlanItems: PlanItem[] = [
  {
    id: 'today_1',
    text: 'Team check-in & sprint alignment',
    time: '15:00',
    order: 1,
    status: 'done',
  },
  {
    id: 'today_2',
    text: 'Review test coverage & run regression drill',
    time: '16:00',
    order: 2,
    status: 'late',
  },
  {
    id: 'today_3',
    text: 'Deep work on compiler slice',
    time: '17:00',
    order: 3,
    status: 'done',
  },
  {
    id: 'today_4',
    text: 'Spec review with team',
    time: '18:00',
    order: 4,
    status: 'pending',
  },
  {
    id: 'today_5',
    text: 'Evening reflection & planning',
    time: '20:30',
    order: 5,
    status: 'pending',
  },
];

// 1. Shared status line data derived from single computeCheckinStatus function (PRD Step 0, C.1, C.2, AU41)
const initialComputedCounts = computeCheckinStatus(sampleTodayPlanItems, { dueInterval: '18:00' });
export const initialStatusLine: StatusLineData = {
  nextCheckIn: initialComputedCounts.nextOrDue.time,
  progress: initialComputedCounts.progressText,
  syncState: 'normal',
};

export const samplePlanItem: PlanItem = sampleTodayPlanItems[3]; // 'Spec review with team' at 18:00

// 3. Pending check-in for 18:00 (question and options agree per PRD A4)
export const samplePendingCheckInWithPlan: CheckInItem = {
  id: 'checkin_18',
  interval: '18:00',
  prompt: '18:00. Plan says Spec review with team. Did you do it?',
  planItem: samplePlanItem,
  status: 'pending',
};

export const samplePendingCheckInWithoutPlan: CheckInItem = {
  id: 'checkin_18_noplan',
  interval: '18:00',
  prompt: '18:00. What did you do this hour?',
  planItem: null,
  status: 'pending',
};

// 4. Thread messages (all answered/missed check-ins have questions above them, urge exchange at 17:40, quiet system acks)
export const initialMessages: ThreadMessage[] = [
  {
    id: 'msg_15_q',
    role: 'davos',
    text: '15:00. Plan says Team check-in & sprint alignment. Did you do it?',
    time: '15:00',
  },
  {
    id: 'msg_1',
    role: 'user',
    text: 'Did it',
    time: '15:15',
    sendState: 'sent',
  },
  {
    id: 'msg_2',
    role: 'system',
    text: 'Logged. Next check-in 16:00.',
    time: '15:15',
  },
  {
    id: 'msg_16_q',
    role: 'davos',
    text: '16:00. Plan says Review test coverage & run regression drill. Did you do it?',
    time: '16:00',
  },
  {
    id: 'msg_3',
    role: 'system',
    text: '16:00 check-in missed.',
    time: '16:00',
  },
  {
    id: 'msg_4',
    role: 'davos',
    text: 'What got in the way?',
    time: '16:00',
  },
  {
    id: 'msg_5',
    role: 'user',
    text: 'Got pulled into an urgent production bug.',
    time: '16:05',
    sendState: 'sent',
  },
  {
    id: 'msg_6',
    role: 'system',
    text: 'Logged. Next check-in 17:00.',
    time: '16:06',
  },
  {
    id: 'msg_17_q',
    role: 'davos',
    text: '17:00. Plan says Deep work on compiler slice. Did you do it?',
    time: '17:00',
  },
  {
    id: 'msg_7',
    role: 'user',
    text: 'Did it',
    time: '17:05',
    sendState: 'sent',
  },
  {
    id: 'msg_8',
    role: 'system',
    text: 'Logged. Next check-in 18:00.',
    time: '17:05',
  },
  {
    id: 'msg_urge_sys',
    role: 'system',
    text: 'Urge reported 17:40.',
    time: '17:40',
  },
  {
    id: 'msg_urge_davos',
    role: 'davos',
    text: "Name the urge. Stay with me ten minutes. I'll check back.",
    time: '17:40',
  },
  {
    id: 'msg_urge_hold_q',
    role: 'davos',
    text: 'Did you hold?',
    time: '17:50',
  },
  {
    id: 'msg_urge_hold_a',
    role: 'user',
    text: 'Resisted distraction urge',
    time: '17:50',
    sendState: 'sent',
  },
  {
    id: 'msg_urge_ack',
    role: 'system',
    text: 'Logged.',
    time: '17:50',
  },
];

// 5. Evening session plan proposals
export const sampleEveningPlanItems: PlanItem[] = [
  {
    id: 'plan_ev_1',
    text: 'Deep work: compiler AST and typecheck slice',
    time: '15:00',
    order: 1,
    status: 'pending',
  },
  {
    id: 'plan_ev_2',
    text: 'Review test coverage & run regression drill',
    time: '17:00',
    order: 2,
    status: 'pending',
  },
  {
    id: 'plan_ev_3',
    text: 'Team sync and architectural audit',
    time: '19:00',
    order: 3,
    status: 'pending',
  },
];

// 6. Logged items for today (all strictly before now = 18:15, inside active hours)
export const sampleTodayDoings: DoingRecord[] = [
  {
    id: 'doing_1',
    what: 'Completed sprint alignment with team',
    when: '15:15',
    kind: 'action',
    planLink: 'today_1',
  },
  {
    id: 'doing_2',
    what: 'Wrote compiler parser slice',
    when: '16:30',
    kind: 'action',
    planLink: null, // Detached -> "Also logged"
  },
  {
    id: 'doing_3',
    what: 'Finished deep work block',
    when: '17:05',
    kind: 'action',
    planLink: 'today_3',
  },
  {
    id: 'doing_4',
    what: 'Resisted distraction urge',
    when: '17:40',
    kind: 'impulse_held',
    planLink: null,
    durationMin: 10,
  },
];

/**
 * Shared canonical grouping function for Today and TodayPanel (C4).
 */
export interface GroupedDoings {
  linked: Map<string, DoingRecord[]>;
  unlinked: DoingRecord[];
  planGroups: { planItem: PlanItem; doings: DoingRecord[] }[];
  unlinkedDoings: DoingRecord[];
}

export function groupDoingsByPlan(
  items: PlanItem[],
  doings: DoingRecord[]
): GroupedDoings {
  const linked = new Map<string, DoingRecord[]>();
  for (const item of items) {
    linked.set(item.id, []);
  }
  const unlinked: DoingRecord[] = [];
  for (const doing of doings) {
    if (doing.planLink && linked.has(doing.planLink)) {
      linked.get(doing.planLink)!.push(doing);
    } else {
      unlinked.push(doing);
    }
  }
  const planGroups = items.map((planItem) => ({
    planItem,
    doings: linked.get(planItem.id) ?? [],
  }));
  return { linked, unlinked, planGroups, unlinkedDoings: unlinked };
}

let nextDoingId = 1;

export function createDoingRecord(args: {
  what: string;
  planItem?: PlanItem | null;
  when?: string;
  id?: string;
}): DoingRecord {
  return {
    id: args.id ?? `doing_${nextDoingId++}`,
    what: args.what,
    when: args.when ?? FIXTURE_CLOCK_NOW,
    kind: 'action',
    planLink: args.planItem?.id ?? null,
  };
}

/**
 * Computes human-readable date labels from real dates (PRD B2, AU28).
 * Today, Yesterday, then <Weekday> · <Mon> <Day>.
 * Fixes hardcoded date strings and the "Wednesday · Oct 30" error.
 */
export function formatDayLabel(
  dateString: string,
  referenceDate: Date = new Date(2026, 10, 3, 18, 4, 0, 0)
): string {
  const parts = dateString.split('-').map(Number);
  const year = parts[0];
  const monthIndex = parts[1] - 1;
  const day = parts[2];
  const targetDate = new Date(year, monthIndex, day);

  const refDateNorm = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const targetDateNorm = new Date(year, monthIndex, day);
  const diffDays = Math.round(
    (refDateNorm.getTime() - targetDateNorm.getTime()) / (1000 * 60 * 60 * 24)
  );

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const formattedDate = `${monthNames[monthIndex]} ${day}`;

  if (diffDays === 0) {
    return `Today · ${formattedDate}`;
  }
  if (diffDays === 1) {
    return `Yesterday · ${formattedDate}`;
  }

  const weekdayNames = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  ];
  const weekday = weekdayNames[targetDate.getDay()];
  return `${weekday} · ${formattedDate}`;
}

// -----------------------------------------------------------------------------
// Redesign Mockup Dataset (Exact match to davos_chat_today_redesign.html)
// -----------------------------------------------------------------------------

import type { PlanAnchor, ActivityItem, TrackerState } from '../domain/daySnapshot';

export const redesignConversationMessages: ThreadMessage[] = [
  {
    id: 'msg_d_1706',
    role: 'davos',
    text: 'The production issue interrupted the regression drill. Your report says the critical path was verified, but the remaining edge cases still need work. I’m treating that plan item as partly completed, not as a missed check-in.',
    time: '17:06',
  },
  {
    id: 'msg_u_1708',
    role: 'user',
    text: 'That’s accurate. I had to switch to the production bug, but I didn’t want to lose the regression work completely.',
    time: '17:08',
    sendState: 'sent',
  },
  {
    id: 'msg_d_1709',
    role: 'davos',
    text: 'Keep the unfinished cases visible. The next hour is allocated to the compiler slice. I’ll use your next period report to assess that plan block; you don’t need to mark the block complete yourself.',
    time: '17:09',
  },
  {
    id: 'msg_u_1752',
    role: 'user',
    text: 'I had the urge to switch to YouTube, but stayed with the compiler work for ten minutes.',
    time: '17:52',
    sendState: 'sent',
  },
  {
    id: 'msg_d_1753',
    role: 'davos',
    text: 'You interrupted the automatic response. Your urge record is separate from the activity report. When this hour closes, report what actually happened and your current energy.',
    time: '17:53',
  },
];

export const redesignPlanAnchors: PlanAnchor[] = [
  {
    id: 'prep',
    start: '14:00',
    end: '15:00',
    title: 'Prepare sprint agenda',
    kind: 'commitment',
    status: 'done',
    evidence: {
      source: 'Source · period report · 15:00',
      text: '“Reviewed the sprint backlog and wrote down blockers for the team.”',
      assessment: 'Davos assessment: The reported preparation matches the planned agenda work.',
    },
  },
  {
    id: 'team',
    start: '15:00',
    end: '16:00',
    title: 'Team check-in & sprint alignment',
    kind: 'commitment',
    status: 'done',
    evidence: {
      source: 'Source · period report · 16:00',
      text: '“Joined the team check-in, aligned owners, blockers and next sprint priorities.”',
      assessment: 'Davos assessment: The report contains direct evidence that the planned meeting took place.',
    },
  },
  {
    id: 'regression',
    start: '16:00',
    end: '17:00',
    title: 'Review test coverage & run regression drill',
    kind: 'commitment',
    status: 'partial',
    evidence: {
      source: 'Source · period report · 17:00 · late',
      text: '“An urgent production bug took priority. I verified the critical path, but the regression drill remains unfinished.”',
      assessment: 'Davos assessment: Some relevant work was completed, but the planned drill was not finished.',
    },
  },
  {
    id: 'deepwork',
    start: '17:00',
    end: '18:00',
    title: 'Deep work on compiler slice',
    kind: 'free_block',
    status: 'pending',
    evidence: {
      source: 'Evidence status',
      text: 'No report has been submitted for this period yet.',
      assessment: 'Davos will assess this anchor from the activity report, not from a direct completion toggle.',
    },
  },
  {
    id: 'spec',
    start: '18:15',
    end: '19:00',
    title: 'Spec review with team',
    kind: 'commitment',
    status: 'scheduled',
  },
  {
    id: 'reflection',
    start: '20:30',
    end: '21:00',
    title: 'Evening reflection & planning',
    kind: 'routine',
    status: 'scheduled',
  },
];

export const redesignActivityEvents: ActivityItem[] = [
  {
    id: 'report-1500',
    time: '15:00',
    kind: 'report',
    title: '14:00–15:00',
    sub: 'Energy 6/10 · submitted 15:00',
    energy: 6,
    statusModifier: 'on_time',
    detail: {
      text: '“Reviewed the sprint backlog and wrote down blockers for the team.”',
      note: 'One-hour activity report. This record is available as evidence for overlapping plan anchors.',
    },
  },
  {
    id: 'report-1600',
    time: '16:00',
    kind: 'report',
    title: '15:00–16:00',
    sub: 'Energy 7/10 · submitted 16:00',
    energy: 7,
    statusModifier: 'on_time',
    detail: {
      text: '“Joined the team check-in, aligned owners, blockers and next sprint priorities.”',
      note: 'This report is evidence for the 15:00–16:00 team check-in anchor.',
    },
  },
  {
    id: 'report-1700',
    time: '17:00',
    kind: 'report',
    title: '16:00–17:00',
    sub: 'Energy 5/10 · submitted 17:05',
    subAccent: true,
    energy: 5,
    statusModifier: 'late',
    detail: {
      text: '“An urgent production bug took priority. I verified the critical path, but the regression drill remains unfinished.”',
      note: 'This is still a valid doing record for the original period. Its late status describes reporting time, not plan completion.',
    },
  },
  {
    id: 'urge-1740',
    time: '17:40',
    kind: 'urge',
    title: 'Distraction urge held',
    sub: '10-minute hold · 17:40–17:50',
    outcome: 'held',
    detail: {
      text: 'Trigger: YouTube distraction. Outcome: resisted.',
      note: 'Urge events are recorded independently; they are not check-in reports and do not directly set plan completion.',
    },
  },
  {
    id: 'next-1900',
    time: '19:00',
    kind: 'report',
    title: '18:00–19:00',
    sub: 'Opens at 19:00',
    statusModifier: 'upcoming',
    detail: {
      text: 'The next cadence report asks what happened during 18:00–19:00, along with current energy.',
    },
  },
];

export const redesignTrackerState: TrackerState = {
  reportedCount: 3,
  totalCount: 5,
  lateCount: 1,
  segments: [
    { state: 'done', title: 'Reported' },
    { state: 'done', title: 'Reported' },
    { state: 'late', title: 'Reported late' },
    { state: 'due', title: 'Due' },
    { state: 'upcoming', title: 'Upcoming' },
  ],
};
