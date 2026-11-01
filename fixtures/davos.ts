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
