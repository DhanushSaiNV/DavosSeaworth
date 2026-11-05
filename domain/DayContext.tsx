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
  FIXTURE_NOW,
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
import {
  fetchUserScheduleProfile,
  fetchTodayAnchorPlan,
  saveTodayAnchorPlan,
  fetchTodayDoings,
  deriveTrackerFromGridAndDoings,
  correlateAnchorsWithDoings,
  mapDoingsToActivityItems,
  toDateString,
  type UserProfileSchedule,
  type DoingRow,
  type StoredAnchor,
} from '../lib/todayService';
import {
  loadActiveUrge,
  saveActiveUrge,
  resolveActiveUrge,
} from '../lib/urgeService';
import { submitCheckIn } from '../lib/checkins';
import { currentOpenWindow, utcToLocalLabel, type Grid } from '../lib/checkinGrid';

// Canonical fixture time: 18:04 on Tuesday, Nov 3, 2026
export { FIXTURE_NOW };

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
  activeWindow: { windowTime: string; submitByTime: string } | null;
  submitPeriodReport: (text: string, energy: number) => void;
  undoPeriodReport: () => void;
  startUrgeHold: (trigger: string, intensity: number | null) => void;
  extendUrgeHold: () => void;
  resolveUrge: (outcome: 'held' | 'yielded') => void;
  planDate: string;
  savePlan: (updatedAnchors: PlanAnchor[]) => Promise<void>;
  refreshDayData: () => Promise<void>;
}

const DayContext = createContext<DayContextValue | null>(null);

export interface DayProviderProps {
  fixedNow?: number;
  initialPlan?: PlanItemLike[];
  initialDoings?: DoingRecordLike[];
  initialMessagesList?: ThreadMessageLike[];
  userId?: string;
  useLive?: boolean;
  children: React.ReactNode;
}

export function DayProvider({
  fixedNow,
  initialPlan = sampleTodayPlanItems,
  initialDoings = sampleTodayDoings,
  initialMessagesList = initialMessages,
  userId,
  useLive = false,
  children,
}: DayProviderProps) {
  const [now, setNow] = useState<number>(fixedNow ?? (useLive ? Date.now() : FIXTURE_NOW));
  const planDate = toDateString(new Date(now));
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
  const [activeWindow, setActiveWindow] = useState<{
    windowTime: string;
    submitByTime: string;
  } | null>({
    windowTime: '17:00–18:00',
    submitByTime: 'SUBMIT BY 18:10',
  });
  const [profile, setProfile] = useState<UserProfileSchedule | null>(null);

  // Live data sync
  const refreshDayData = async () => {
    if (!useLive || !userId) return;
    try {
      const planDate = toDateString(new Date(now));
      const [userProfile, storedAnchors, doingsRows, storedUrge] = await Promise.all([
        fetchUserScheduleProfile(userId),
        fetchTodayAnchorPlan(userId, planDate),
        fetchTodayDoings(userId, planDate),
        loadActiveUrge(userId),
      ]);

      setProfile(userProfile);
      if (storedUrge) {
        setActiveUrge(storedUrge);
      }

      // 1. Tracker calculation
      const liveTracker = deriveTrackerFromGridAndDoings(userProfile, doingsRows, now);
      setTracker(liveTracker);

      // 2. Plan Anchors
      if (storedAnchors.length > 0) {
        const correlated = correlateAnchorsWithDoings(storedAnchors, doingsRows, userProfile, now);
        setPlanAnchors(correlated);
      } else {
        setPlanAnchors([]);
      }

      // 3. Activity events
      if (doingsRows.length > 0) {
        const activities = mapDoingsToActivityItems(doingsRows, userProfile);
        setActivityEvents(activities);
      } else {
        setActivityEvents([]);
      }

      // 4. Saved report for currently open window
      const grid: Grid = {
        timezone: userProfile.timezone,
        cadenceMinutes: userProfile.checkin_cadence_minutes,
        activeStart: userProfile.checkin_active_hours_start,
        activeEnd: userProfile.checkin_active_hours_end,
      };
      const openWin = currentOpenWindow(grid, now, userId);
      if (openWin) {
        const startLabel =
          utcToLocalLabel(userProfile.timezone, openWin.startMs) ||
          openWin.isoStart.slice(0, 5);
        const closeLabel =
          utcToLocalLabel(userProfile.timezone, openWin.closeMs) ||
          openWin.isoClose.slice(0, 5);
        const graceLabel =
          utcToLocalLabel(
            userProfile.timezone,
            openWin.closeMs + 10 * 60 * 1000
          ) || '';
        setActiveWindow({
          windowTime: `${startLabel}–${closeLabel}`,
          submitByTime: graceLabel
            ? `SUBMIT BY ${graceLabel}`
            : `SUBMIT BY ${closeLabel}`,
        });

        const matchDoing = doingsRows.find((d) => {
          if (d.checkin_window) {
            const wStart = new Date(d.checkin_window).getTime();
            return Math.abs(wStart - openWin.startMs) < 60_000;
          }
          const loggedMs = new Date(d.logged_at).getTime();
          return loggedMs >= openWin.startMs && loggedMs <= openWin.closeMs + 900_000;
        });

        if (matchDoing) {
          const loggedTime = utcToLocalLabel(userProfile.timezone, new Date(matchDoing.logged_at).getTime()) || '';
          setSavedReport({
            text: matchDoing.content || '',
            energy: matchDoing.energy || 7,
            submittedAt: loggedTime,
          });
        } else {
          setSavedReport(null);
        }
      } else {
        setSavedReport(null);
      }
    } catch {
      // Graceful fallback on network/config error
    }
  };

  useEffect(() => {
    if (useLive && userId) {
      void refreshDayData();
    }
  }, [useLive, userId, now]);

  const savePlan = async (updatedAnchors: PlanAnchor[]) => {
    setPlanAnchors(updatedAnchors);
    if (useLive && userId) {
      const planDate = toDateString(new Date(now));
      const stored: StoredAnchor[] = updatedAnchors.map((a) => ({
        start: a.start,
        end: a.end,
        label: a.title,
        kind: a.kind,
      }));
      await saveTodayAnchorPlan(planDate, stored);
      await refreshDayData();
    }
  };

  const submitPeriodReport = (text: string, energy: number) => {
    const formattedNow = utcToLocalLabel(profile?.timezone || 'UTC', now) || '18:04';
    setSavedReport({ text, energy, submittedAt: formattedNow });

    if (useLive && userId) {
      const grid: Grid = {
        timezone: profile?.timezone || 'UTC',
        cadenceMinutes: profile?.checkin_cadence_minutes || 60,
        activeStart: profile?.checkin_active_hours_start || '08:00',
        activeEnd: profile?.checkin_active_hours_end || '22:00',
      };
      const openWin = currentOpenWindow(grid, now, userId);
      const windowTs = openWin ? openWin.startMs : now;
      void submitCheckIn(userId, text, windowTs).then(() => {
        void refreshDayData();
      });
      return;
    }

    // Fixture fallback mode for unit tests
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
    if (!useLive) {
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
    }
  };

  const startUrgeHold = (trigger: string, intensity: number | null) => {
    const startedAt = Date.now();
    const endsAt = startedAt + 600000;
    const newUrge: UrgeState = {
      trigger,
      intensity,
      startedAt,
      endsAt,
      stage: 'hold',
    };
    setActiveUrge(newUrge);
    if (userId) {
      void saveActiveUrge(userId, newUrge);
    }
  };

  const extendUrgeHold = () => {
    setActiveUrge((prev) => {
      if (!prev) return null;
      const updated: UrgeState = {
        ...prev,
        endsAt: prev.endsAt + 600000,
        stage: 'hold',
      };
      if (userId) {
        void saveActiveUrge(userId, updated);
      }
      return updated;
    });
  };

  const resolveUrge = (outcome: 'held' | 'yielded') => {
    if (!activeUrge) return;
    const trigger = activeUrge.trigger;
    const intensity = activeUrge.intensity;

    if (userId) {
      void resolveActiveUrge(userId, outcome, trigger).then(() => {
        if (useLive) void refreshDayData();
      });
    }

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
    activeWindow,
    submitPeriodReport,
    undoPeriodReport,
    startUrgeHold,
    extendUrgeHold,
    resolveUrge,
    planDate,
    savePlan,
    refreshDayData,
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
