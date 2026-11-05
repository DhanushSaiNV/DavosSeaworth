// domain/DayContext.tsx
// React Context providing single source of truth for DaySnapshot across Chat and TodayPanel.
// Wraps buildDaySnapshot and injects the clock (fixed in fixtures, live in production).

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  buildDaySnapshot,
  toTimeline,
  toThread,
  type DaySnapshot,
  type TimelineRow,
  type ThreadItem,
  type PlanItemLike,
  type DoingRecordLike,
  type ThreadMessageLike,
} from './daySnapshot';
import {
  sampleTodayPlanItems,
  sampleTodayDoings,
  initialMessages,
  FIXTURE_CLOCK_NOW,
  redesignPlanAnchors,
  redesignActivityEvents,
  redesignTrackerState,
} from '../fixtures/davos';
import type {
  PlanAnchor,
  ActivityItem,
  TrackerState,
  UrgeState,
} from './daySnapshot';

// Canonical fixture time: 18:04 on Tuesday, Nov 3, 2026
export const FIXTURE_NOW = new Date(2026, 10, 3, 18, 4, 0, 0).getTime();

export interface DayContextValue {
  snapshot: DaySnapshot;
  timeline: TimelineRow[];
  threadItems: ThreadItem[];
  focusedBeatId: string | null;
  setFocusedBeatId: (id: string | null) => void;
  answerBeat: (
    beatId: string,
    outcome: 'did_it' | 'partly' | 'didnt' | 'something_else',
    note?: string
  ) => void;
  messages: ThreadMessageLike[];
  setMessages: React.Dispatch<React.SetStateAction<ThreadMessageLike[]>>;
  // Shared Redesign State
  planAnchors: PlanAnchor[];
  setPlanAnchors: React.Dispatch<React.SetStateAction<PlanAnchor[]>>;
  activityEvents: ActivityItem[];
  setActivityEvents: React.Dispatch<React.SetStateAction<ActivityItem[]>>;
  tracker: TrackerState;
  setTracker: React.Dispatch<React.SetStateAction<TrackerState>>;
  savedReport: { text: string; energy: number; submittedAt?: string } | null;
  setSavedReport: React.Dispatch<
    React.SetStateAction<{ text: string; energy: number; submittedAt?: string } | null>
  >;
  activeUrge: UrgeState | null;
  setActiveUrge: React.Dispatch<React.SetStateAction<UrgeState | null>>;
  submitPeriodReport: (text: string, energy: number) => void;
  undoPeriodReport: () => void;
  startUrgeHold: (trigger: string, intensity: number | null) => void;
  extendUrgeHold: () => void;
  resolveUrge: (outcome: 'held' | 'yielded') => void;
}

const DayContext = createContext<DayContextValue | null>(null);

export interface DayProviderProps {
  fixedNow?: number;
  initialPlan?: PlanItemLike[];
  initialDoings?: DoingRecordLike[];
  initialMessagesList?: ThreadMessageLike[];
  children: React.ReactNode;
}

export function DayProvider({
  fixedNow = FIXTURE_NOW,
  initialPlan = sampleTodayPlanItems,
  initialDoings = sampleTodayDoings,
  initialMessagesList = initialMessages,
  children,
}: DayProviderProps) {
  const [now, setNow] = useState<number>(fixedNow);
  const [plan, setPlan] = useState<PlanItemLike[]>(initialPlan);
  const [doings, setDoings] = useState<DoingRecordLike[]>(initialDoings);
  const [messages, setMessages] = useState<ThreadMessageLike[]>(initialMessagesList);
  const [focusedBeatId, setFocusedBeatId] = useState<string | null>(null);

  // Shared redesign state
  const [planAnchors, setPlanAnchors] = useState<PlanAnchor[]>(redesignPlanAnchors);
  const [activityEvents, setActivityEvents] = useState<ActivityItem[]>(redesignActivityEvents);
  const [tracker, setTracker] = useState<TrackerState>(redesignTrackerState);
  const [savedReport, setSavedReport] = useState<{
    text: string;
    energy: number;
    submittedAt?: string;
  } | null>(null);
  const [activeUrge, setActiveUrge] = useState<UrgeState | null>(null);

  const submitPeriodReport = (text: string, energy: number) => {
    setSavedReport({ text, energy, submittedAt: '18:04' });
    setTracker((prev) => ({
      ...prev,
      reportedCount: 4,
      lateCount: 1,
      segments: [
        { state: 'done', title: 'Reported' },
        { state: 'done', title: 'Reported' },
        { state: 'late', title: 'Reported late' },
        { state: 'done', title: 'Reported' },
        { state: 'upcoming', title: 'Upcoming' },
      ],
    }));

    setPlanAnchors((prev) =>
      prev.map((anchor) => {
        if (anchor.id === 'deepwork') {
          return {
            ...anchor,
            status: 'done',
            evidence: {
              source: 'Source · period report · 18:04',
              text: `“${text}”`,
              assessment:
                'Davos assessment: The report contains activity evidence that appears consistent with this planned focus block.',
            },
          };
        }
        return anchor;
      })
    );

    const newActivityEvent: ActivityItem = {
      id: 'report-current',
      time: '18:00',
      kind: 'report',
      title: '17:00–18:00',
      sub: `Energy ${energy}/10 · submitted 18:04`,
      statusModifier: 'saved',
      detail: {
        text: `“${text}”`,
        note: 'One doing record for the 17:00 window. Editing updates this same window; this report can be evidence for overlapping planned anchors.',
      },
    };

    setActivityEvents((prev) => {
      const filtered = prev.filter((item) => item.id !== 'report-current');
      return [
        ...filtered.slice(0, 4),
        newActivityEvent,
        ...filtered.slice(4),
      ];
    });
  };

  const undoPeriodReport = () => {
    setSavedReport(null);
    setTracker(redesignTrackerState);
    setPlanAnchors((prev) =>
      prev.map((anchor) => {
        if (anchor.id === 'deepwork') {
          return {
            ...anchor,
            status: 'pending',
            evidence: {
              source: 'Evidence status',
              text: 'No report has been submitted for this period yet.',
              assessment:
                'Davos will assess this anchor from the activity report, not from a direct completion toggle.',
            },
          };
        }
        return anchor;
      })
    );
    setActivityEvents((prev) =>
      prev.filter((item) => item.id !== 'report-current')
    );
  };

  const startUrgeHold = (trigger: string, intensity: number | null) => {
    const startedAt = Date.now();
    const endsAt = startedAt + 600000;
    setActiveUrge({
      trigger,
      intensity,
      startedAt,
      endsAt,
      stage: 'hold',
    });
  };

  const extendUrgeHold = () => {
    setActiveUrge((prev) =>
      prev
        ? {
            ...prev,
            endsAt: Date.now() + 600000,
            stage: 'hold',
          }
        : null
    );
  };

  const resolveUrge = (outcome: 'held' | 'yielded') => {
    if (!activeUrge) return;
    const trigger = activeUrge.trigger;
    const intensity = activeUrge.intensity;

    const newUrgeActivity: ActivityItem = {
      id: `urge-${Date.now()}`,
      time: '18:14',
      kind: 'urge',
      title: trigger,
      sub: `${outcome === 'held' ? 'Held for 10 minutes' : 'Gave in'}${
        intensity ? ` · intensity ${intensity}/10` : ''
      }`,
      outcome,
      detail: {
        text: `Trigger: ${trigger}. Outcome: ${
          outcome === 'held' ? 'resisted' : 'yielded'
        }.`,
        note: 'Urge events are independent from cadence reports and plan assessments.',
      },
    };

    setActivityEvents((prev) => [
      ...prev.slice(0, 4),
      newUrgeActivity,
      ...prev.slice(4),
    ]);

    setActiveUrge(null);
  };

  // In production (when fixedNow is not explicitly passed or in live mode),
  // align clock to minute boundary:
  useEffect(() => {
    if (__DEV__ && fixedNow === FIXTURE_NOW) {
      // Keep fixed fixture time for deterministic dev & tests
      return;
    }
    const update = () => setNow(Date.now());
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [fixedNow]);

  const snapshot = useMemo(() => {
    return buildDaySnapshot(plan, doings, [], now);
  }, [plan, doings, now]);

  const timeline = useMemo(() => {
    return toTimeline(snapshot);
  }, [snapshot]);

  const threadItems = useMemo(() => {
    return toThread(messages, snapshot);
  }, [messages, snapshot]);

  const answerBeat = (
    beatId: string,
    outcome: 'did_it' | 'partly' | 'didnt' | 'something_else',
    note?: string
  ) => {
    setPlan((prev) =>
      prev.map((item) => {
        if (item.id === beatId) {
          if (outcome === 'did_it') return { ...item, status: 'done' };
          if (outcome === 'partly') return { ...item, status: 'partly' };
          if (outcome === 'didnt') return { ...item, status: 'missed' };
          return item;
        }
        return item;
      })
    );

    // If there is an associated doing, log it
    if (outcome === 'did_it') {
      const targetItem = plan.find((p) => p.id === beatId);
      if (targetItem) {
        setDoings((prev) => [
          ...prev,
          {
            id: `doing_${now}_${Math.random().toString(36).slice(2, 6)}`,
            what: targetItem.text,
            when: '18:04',
            kind: 'action',
            planLink: beatId,
          },
        ]);
      }
    }
  };

  const value: DayContextValue = {
    snapshot,
    timeline,
    threadItems,
    focusedBeatId,
    setFocusedBeatId,
    answerBeat,
    messages,
    setMessages,
    planAnchors,
    setPlanAnchors,
    activityEvents,
    setActivityEvents,
    tracker,
    setTracker,
    savedReport,
    setSavedReport,
    activeUrge,
    setActiveUrge,
    submitPeriodReport,
    undoPeriodReport,
    startUrgeHold,
    extendUrgeHold,
    resolveUrge,
  };

  return <DayContext.Provider value={value}>{children}</DayContext.Provider>;
}

export function useDaySnapshot(): DaySnapshot {
  const ctx = useContext(DayContext);
  if (!ctx) {
    throw new Error('useDaySnapshot must be used within a DayProvider');
  }
  return ctx.snapshot;
}

export function useDayContext(): DayContextValue {
  const ctx = useContext(DayContext);
  if (!ctx) {
    throw new Error('useDayContext must be used within a DayProvider');
  }
  return ctx;
}
