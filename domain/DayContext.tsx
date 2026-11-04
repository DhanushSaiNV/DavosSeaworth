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
} from '../fixtures/davos';

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
