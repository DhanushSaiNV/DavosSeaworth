// fixtures/davos.ts
// Fixture module for ORCA attributes and blocked data layer contracts (RECON.md §7, ORCA.md §1).

export interface PlanItem {
  id: string;
  text: string;
  time: string;
  order: number;
  status: 'pending' | 'done' | 'partly' | 'missed';
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
}

export interface ThreadMessage {
  id: string;
  role: 'davos' | 'user' | 'system';
  text: string;
  time: string;
  sendState?: 'sent' | 'sending' | 'failed';
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

export const initialStatusLine: StatusLineData = {
  nextCheckIn: '15:00',
  progress: '3 of 5 check-ins',
  syncState: 'normal',
};

export const samplePlanItem: PlanItem = {
  id: 'plan_1',
  text: 'Deep work',
  time: '14:00',
  order: 1,
  status: 'pending',
};

export const samplePendingCheckInWithPlan: CheckInItem = {
  id: 'checkin_14',
  interval: '14:00',
  prompt: '14:00. Plan says deep work. Did you do it?',
  planItem: samplePlanItem,
  status: 'pending',
};

export const samplePendingCheckInWithoutPlan: CheckInItem = {
  id: 'checkin_15',
  interval: '15:00',
  prompt: '15:00. What did you do this hour?',
  planItem: null,
  status: 'pending',
};

export const initialMessages: ThreadMessage[] = [
  {
    id: 'msg_1',
    role: 'davos',
    text: '13:00. Logged. Next check-in 14:00.',
    time: '13:00',
  },
  {
    id: 'msg_2',
    role: 'user',
    text: 'Worked on spec compilation.',
    time: '13:00',
    sendState: 'sent',
  },
];

export const sampleEveningPlanItems: PlanItem[] = [
  {
    id: 'plan_ev_1',
    text: 'Deep work: compiler AST and typecheck slice',
    time: '09:00',
    order: 1,
    status: 'pending',
  },
  {
    id: 'plan_ev_2',
    text: 'Review test coverage & run regression drill',
    time: '13:00',
    order: 2,
    status: 'pending',
  },
  {
    id: 'plan_ev_3',
    text: 'Team sync and architectural audit',
    time: '16:00',
    order: 3,
    status: 'pending',
  },
];

export const sampleTodayPlanItems: PlanItem[] = [
  {
    id: 'today_1',
    text: 'Morning workout & run',
    time: '07:00',
    order: 1,
    status: 'done',
  },
  {
    id: 'today_2',
    text: 'Deep work on compiler slice',
    time: '09:00',
    order: 2,
    status: 'done',
  },
  {
    id: 'today_3',
    text: 'Spec review with team',
    time: '14:00',
    order: 3,
    status: 'partly',
  },
  {
    id: 'today_4',
    text: 'Evening reflection & planning',
    time: '20:30',
    order: 4,
    status: 'pending',
  },
];

export const sampleTodayDoings: DoingRecord[] = [
  {
    id: 'doing_1',
    what: 'Ran 5k in park',
    when: '07:45',
    kind: 'action',
    planLink: 'today_1',
  },
  {
    id: 'doing_2',
    what: 'Wrote unstyled primitives for S1',
    when: '10:30',
    kind: 'action',
    planLink: 'today_2',
  },
  {
    id: 'doing_3',
    what: 'Finished parser AST pass',
    when: '12:00',
    kind: 'action',
    planLink: 'today_2',
  },
  {
    id: 'doing_4',
    what: 'Reviewed PRD with PM; skipped section 16',
    when: '14:45',
    kind: 'action',
    planLink: 'today_3',
  },
  {
    id: 'doing_5',
    what: 'Resisted distraction urge for 15 minutes',
    when: '15:10',
    kind: 'impulse_held',
    planLink: null,
  },
];

export function createDoingRecord(args: {
  what: string;
  planItem?: PlanItem | null;
}): DoingRecord {
  return {
    id: `doing_${Date.now()}`,
    what: args.what,
    when: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    kind: 'action',
    planLink: args.planItem?.id ?? null,
  };
}
