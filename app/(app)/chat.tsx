// app/(app)/chat.tsx
// Screen S1 (Thread) — Flow F1 (Check-in), F3 (Evening Session), F4 (Oath Trigger)
// Exact measurements per brief:
// Gutter x0–48 | Rail x48–72 (glyph centered at x=60) | Content x72→end.
// Beat = one View with marginTop BEAT_GAP (32), INNER_GAP (8) between rows.
// Single clock: zero Date.now() / new Date().

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import {
  radius,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import {
  BEAT_GAP,
  INNER_GAP,
  LINE,
  META_LINE,
  GLYPH_CHAT,
} from '../../theme/layout';
import {
  DoingRecord,
  PlanItem,
  ThreadMessage,
  createDoingRecord,
  sampleEveningPlanItems,
} from '../../fixtures/davos';
import { formatTime24, timeStringToMs, type GlyphState } from '../../domain/daySnapshot';
import { useAuth } from '../../lib/auth';
import { onCheckinTap, submitCheckIn } from '../../lib/checkins';
import { logImpulse } from '../../lib/impulse';
import { oathAdapter } from '../../lib/oathAdapter';
import { DavosMessage } from '../../components/davos/DavosMessage';
import { UserMessage } from '../../components/davos/UserMessage';
import { SystemLine } from '../../components/davos/SystemLine';
import {
  CheckInResponseOption,
  ResponseRow,
  URGE_OPTIONS,
  DEFAULT_CHECKIN_OPTIONS,
} from '../../components/davos/ResponseRow';
import { PlanList } from '../../components/davos/PlanList';
import { Composer } from '../../components/davos/Composer';
import { ThreadRow } from '../../components/davos/ThreadRow';
import { useDayContext } from '../../domain/DayContext';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';
type EveningStage = 'idle' | 'q1' | 'q2' | 'q3' | 'proposing_plan' | 'confirmed';

interface BeatRow {
  id: string;
  kind: 'davos' | 'user' | 'event' | 'response_strip' | 'plan_editor';
  time?: string;
  showTime: boolean;
  glyph?: GlyphState;
  tone: 'live' | 'resolved';
  text?: string;
  label?: string;
  isMetaRow?: boolean;
  showUndo?: boolean;
  sendState?: 'sent' | 'sending' | 'failed';
  action?: {
    label: string;
    onPress?: () => void;
    accessibilityLabel?: string;
  };
}

interface ThreadBeat {
  id: string;
  time: string;
  rows: BeatRow[];
}

export default function ChatScreen() {
  const router = useRouter();
  const { prompt: paramPrompt, evening: paramEvening, commitment: paramCommitment } =
    useLocalSearchParams<{ prompt?: string; evening?: string; commitment?: string }>();
  const { user } = useAuth();
  const userId = user?.id ?? 'user_dev';
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 600;

  // View state management (PRD §11)
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [errorMessage, setErrorMessage] = useState<'offline' | 'failed' | null>(null);

  // Day context for pure single source of truth (Blueprint §4.1, §4.2)
  const {
    snapshot,
    answerBeat,
    messages,
    setMessages,
    focusedBeatId,
    setFocusedBeatId,
  } = useDayContext();

  // Active check-in state (Blueprint §2.4)
  const [activePromptDismissed, setActivePromptDismissed] = useState<boolean>(false);
  const [awaitingFollowUpInterval, setAwaitingFollowUpInterval] = useState<string | null>(null);
  const [awaitingUrgeHold, setAwaitingUrgeHold] = useState<boolean>(false);
  const [activeAnswerOption, setActiveAnswerOption] = useState<CheckInResponseOption | null>(null);
  const [activeAnswerFollowUp, setActiveAnswerFollowUp] = useState<string | null>(null);

  // Flow F4: Oath commitment offer state
  const [pendingOathCommitment, setPendingOathCommitment] = useState<string | null>(
    paramCommitment ?? null
  );

  // Auto-scrolling & Jump-to-latest state (PRD B.1)
  const flatListRef = useRef<FlatList<any> | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setIsScrolledUp(distanceFromBottom > 80);
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToEnd({ animated });
    setIsScrolledUp(false);
  }, []);

  // Jump to focused beat if requested from Today panel
  useEffect(() => {
    if (focusedBeatId) {
      if (focusedBeatId === snapshot.activeBeatId) {
        scrollToBottom(true);
      }
      setFocusedBeatId(null);
    }
  }, [focusedBeatId, snapshot.activeBeatId, scrollToBottom, setFocusedBeatId]);

  // Composer input ref for programmatic focus (PRD A4)
  const composerInputRef = useRef<TextInput | null>(null);

  // Undo state: right-aligned meta "Undo" on answer row, gone after 6s (Task brief)
  const [undoActive, setUndoActive] = useState<boolean>(false);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flow F3: Evening session state
  const [eveningStage, setEveningStage] = useState<EveningStage>('idle');
  const [eveningPlan, setEveningPlan] = useState<PlanItem[]>(sampleEveningPlanItems);

  // Composer input & placeholder
  const [draft, setDraft] = useState<string>('');
  const [placeholder, setPlaceholder] = useState<string>('Message Davos');

  // Monotonic id generator using snapshot.now to avoid Date.now() outside DayProvider
  const idSeqRef = useRef<number>(0);
  const getNextId = useCallback(
    (prefix: string) => {
      idSeqRef.current += 1;
      return `${prefix}_${snapshot.now}_${idSeqRef.current}`;
    },
    [snapshot.now]
  );

  // Check for newly bound oath on return (BREADBOARD F4)
  const acknowledgedOathRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      oathAdapter.getBoundOath().then((bound) => {
        if (bound && acknowledgedOathRef.current !== bound.id) {
          acknowledgedOathRef.current = bound.id;
          const nowTime = formatTime24(snapshot.now);
          const ackMsg: ThreadMessage = {
            id: getNextId('msg_oath_ack'),
            role: 'davos',
            text: 'Oath bound. It cannot be edited or deleted.',
            time: nowTime,
          };
          setMessages((prev) => [...prev, ackMsg]);
          setPendingOathCommitment(null);
        }
      });
    }, [snapshot.now, getNextId, setMessages])
  );

  // Clean up undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  // Listen to check-in notification tap events
  useEffect(() => {
    return onCheckinTap((_windowTs) => {
      setActivePromptDismissed(false);
      scrollToBottom(true);
    });
  }, [scrollToBottom]);

  // Flow F1: Check-in response handler (Blueprint §2.4)
  const handleCheckInResponse = useCallback(
    (option: CheckInResponseOption) => {
      const activeBeat = snapshot.beats.find(
        (b) => b.planItem.id === snapshot.activeBeatId || b.state === 'due'
      );
      if (!activeBeat) return;

      const beatId = activeBeat.planItem.id;
      const beatText = activeBeat.planItem.text;

      if (option === 'did_it') {
        answerBeat(beatId, 'did_it');
        setActivePromptDismissed(true);
        setActiveAnswerOption('did_it');
        setActiveAnswerFollowUp(null);

        const doing = createDoingRecord({
          what: beatText,
          planItem: activeBeat.planItem as PlanItem,
        });

        // Submit to backend asynchronously
        void submitCheckIn(userId, `Did it: ${doing.what}`, snapshot.now).catch(() => {});

        // Show undo on answer row for 6 seconds (Brief)
        setUndoActive(true);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => {
          setUndoActive(false);
        }, 6000);
      } else if (option === 'partly') {
        answerBeat(beatId, 'partly');
        setActivePromptDismissed(true);
        setActiveAnswerOption('partly');
        setActiveAnswerFollowUp(null);
        setAwaitingFollowUpInterval('18:00');

        setUndoActive(true);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => {
          setUndoActive(false);
        }, 6000);

        setPlaceholder('What got in the way?');
        composerInputRef.current?.focus();
      } else if (option === 'didnt') {
        answerBeat(beatId, 'didnt');
        setActivePromptDismissed(true);
        setActiveAnswerOption('didnt');
        setActiveAnswerFollowUp(null);
        setAwaitingFollowUpInterval('18:00');

        setUndoActive(true);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => {
          setUndoActive(false);
        }, 6000);

        setPlaceholder('What got in the way?');
        composerInputRef.current?.focus();
      }
    },
    [snapshot.beats, snapshot.activeBeatId, snapshot.now, answerBeat, userId]
  );

  // "Something else" handler: focuses composer and commits nothing (Blueprint §2.4)
  const handleSomethingElse = useCallback(() => {
    setPlaceholder('What did you do?');
    composerInputRef.current?.focus();
  }, []);

  // Urge follow-up response (Held vs Gave in)
  const handleUrgeHoldResponse = useCallback(
    (option: string) => {
      const nowTime = formatTime24(snapshot.now);
      setAwaitingUrgeHold(false);

      if (option === 'held') {
        const holdMsg: ThreadMessage = {
          id: getNextId('msg_urge_held'),
          role: 'user',
          text: 'Resisted distraction urge',
          time: nowTime,
          sendState: 'sent',
        };
        setMessages((prev) => [...prev, holdMsg]);
      } else {
        const giveInMsg: ThreadMessage = {
          id: getNextId('msg_urge_yielded'),
          role: 'user',
          text: 'Gave in to urge',
          time: nowTime,
          sendState: 'sent',
        };
        setMessages((prev) => [...prev, giveInMsg]);
      }
    },
    [snapshot.now, getNextId, setMessages]
  );

  // Undo handler: right-aligned meta "Undo" on answer row, gone after 6s (Task brief)
  const handleUndo = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    setUndoActive(false);
    setActivePromptDismissed(false);
    setActiveAnswerOption(null);
    setActiveAnswerFollowUp(null);
    setAwaitingFollowUpInterval(null);

    // Revert active beat to pending
    const activeBeat = snapshot.beats.find(
      (b) => b.planItem.id === snapshot.activeBeatId || b.state === 'due'
    );
    if (activeBeat) {
      answerBeat(activeBeat.planItem.id, 'something_else');
    }
  }, [snapshot.beats, snapshot.activeBeatId, answerBeat]);

  // Flow F3: Start evening session
  const handleStartEveningSession = useCallback(() => {
    const nowTime = formatTime24(snapshot.now);
    const davosQ1: ThreadMessage = {
      id: getNextId('msg_d'),
      role: 'davos',
      text: 'What went well today? What slipped?',
      time: nowTime,
    };
    setMessages((prev) => [...prev, davosQ1]);
    setEveningStage('q1');
    setPlaceholder('What went well?');
    composerInputRef.current?.focus();
  }, [snapshot.now, getNextId, setMessages]);

  // Flow F3: Lock plan on confirm action
  const handleConfirmPlan = useCallback(
    (confirmedItems: PlanItem[]) => {
      setEveningPlan(confirmedItems);
      setEveningStage('confirmed');

      const nowTime = formatTime24(snapshot.now);
      const davosAck: ThreadMessage = {
        id: getNextId('msg_d'),
        role: 'davos',
        text: 'Plan locked. Reflection saved.',
        time: nowTime,
      };
      setMessages((prev) => [...prev, davosAck]);
    },
    [snapshot.now, getNextId, setMessages]
  );

  // Composer Send handler
  const handleSend = useCallback(
    (textToSend: string) => {
      const content = textToSend.trim();
      if (!content) return;

      const nowTime = formatTime24(snapshot.now);
      const userMsg: ThreadMessage = {
        id: getNextId('msg_u'),
        role: 'user',
        text: content,
        time: nowTime,
        sendState: 'sent',
      };

      setMessages((prev) => [...prev, userMsg]);
      setDraft('');

      const commitmentRegex = /^(?:i will|i promise|i commit|i vow|no more|always|never)\b/i;

      // If user was answering an open follow-up question
      if (awaitingFollowUpInterval) {
        setAwaitingFollowUpInterval(null);
        setActiveAnswerFollowUp(content);
        setPlaceholder('Message Davos');
        if (commitmentRegex.test(content)) {
          setPendingOathCommitment(content);
        }
        return;
      }

      if (commitmentRegex.test(content)) {
        setPendingOathCommitment(content);
      }

      // Flow F3 Evening session progression
      if (eveningStage === 'q1') {
        const q2Msg: ThreadMessage = {
          id: getNextId('msg_d'),
          role: 'davos',
          text: 'What is one lesson from today?',
          time: nowTime,
        };
        setMessages((prev) => [...prev, q2Msg]);
        setEveningStage('q2');
        setPlaceholder('One lesson');
        return;
      }

      if (eveningStage === 'q2') {
        const q3Msg: ThreadMessage = {
          id: getNextId('msg_d'),
          role: 'davos',
          text: 'What are tomorrow’s three things?',
          time: nowTime,
        };
        setMessages((prev) => [...prev, q3Msg]);
        setEveningStage('q3');
        setPlaceholder('Tomorrow’s three things');
        return;
      }

      if (eveningStage === 'q3') {
        const proposeMsg: ThreadMessage = {
          id: getNextId('msg_d'),
          role: 'davos',
          text: 'Here is your proposed plan for tomorrow. Edit in place or confirm.',
          time: nowTime,
        };
        setMessages((prev) => [...prev, proposeMsg]);
        setEveningStage('proposing_plan');
        setPlaceholder('Message Davos');
        return;
      }

      setPlaceholder('Message Davos');
      void submitCheckIn(userId, content, snapshot.now).catch(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? { ...m, sendState: 'failed' } : m))
        );
      });
    },
    [snapshot.now, getNextId, awaitingFollowUpInterval, eveningStage, userId, setMessages]
  );

  // Urge handler: demoted control with diamond glyph (Blueprint §2.2, §2.5)
  const handleUrge = useCallback(() => {
    void logImpulse('app');
    const nowTime = formatTime24(snapshot.now);

    const urgeEvent: ThreadMessage = {
      id: getNextId('msg_urge_sys'),
      role: 'system',
      text: 'Urge reported 17:40.',
      time: nowTime,
    };
    const davosTactic: ThreadMessage = {
      id: getNextId('msg_d'),
      role: 'davos',
      text: "Name the urge. Stay with me ten minutes. I'll check back.",
      time: nowTime,
    };
    setMessages((prev) => [...prev, urgeEvent, davosTactic]);

    // Check back after delay with "Did you hold?"
    setTimeout(() => {
      const holdQuestion: ThreadMessage = {
        id: getNextId('msg_hold_q'),
        role: 'davos',
        text: 'Did you hold?',
        time: formatTime24(snapshot.now),
      };
      setMessages((prev) => [...prev, holdQuestion]);
      setAwaitingUrgeHold(true);
    }, 1500);
  }, [snapshot.now, getNextId, setMessages]);

  // Empty state (First run)
  if (viewState === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <View style={styles.emptyContainer}>
          <Text
            style={[styles.emptyCopy, typeRoles.davosVoice, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            I’m Davos. Tell me when your day starts and when it ends.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Configure schedule"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={() => router.push('/(app)/settings')}>
            <Text
              style={[
                styles.actionButtonText,
                typeRoles.davosVoice,
                { color: colors.textPrimary, fontWeight: '500' },
              ]}
              allowFontScaling={true}>
              Set schedule (09:00 - 18:00)
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Active beat determination
  const activeBeat = snapshot.beats.find(
    (b) => b.planItem.id === snapshot.activeBeatId || b.state === 'due'
  );
  const showActivePrompt = Boolean(activeBeat);

  // One-offer rule: evening or oath offers wait if active checkin is pending
  const isEveningActive = eveningStage !== 'idle' && eveningStage !== 'confirmed';
  const hasOpenCheckin = Boolean(!activePromptDismissed || awaitingFollowUpInterval || isEveningActive);
  const isEveningTime = formatTime24(snapshot.now) >= '20:30' || paramEvening === 'true';
  const hasEveningOffer = !hasOpenCheckin && isEveningTime && eveningStage === 'idle';
  const hasOathOffer = !hasOpenCheckin && !hasEveningOffer && Boolean(pendingOathCommitment);

  // Construct structured Beats per brief:
  // "Beat = one View. marginTop BEAT_GAP between beats, INNER_GAP between rows
  // inside a beat (prompt, missed line, follow-up, answer all stay in the beat)."
  // Gutter time rules:
  // - Show time on first row of a beat
  // - On later rows only if >= 5 min later
  // - Event lines inherit the beat time
  // - Answer text = what user did ("Did it"), never plan title
  const beats: ThreadBeat[] = [
    // Beat 1: 15:00
    {
      id: 'beat_1500',
      time: '15:00',
      rows: [
        {
          id: 'b1_prompt',
          kind: 'davos',
          time: '15:00',
          showTime: true,
          tone: 'resolved',
          text: 'Plan says Team check-in & sprint alignment. Did you do it?',
          isMetaRow: false,
        },
        {
          id: 'b1_answer',
          kind: 'user',
          time: '15:00',
          showTime: false,
          glyph: 'done',
          tone: 'resolved',
          text: 'Did it', // Brief: Answer text = what the user did/typed ("Did it"), never the plan title
          isMetaRow: false,
        },
      ],
    },
    // Beat 2: 16:00
    {
      id: 'beat_1600',
      time: '16:00',
      rows: [
        {
          id: 'b2_prompt',
          kind: 'davos',
          time: '16:00',
          showTime: true,
          tone: 'resolved',
          text: 'Plan says Review test coverage & run regression drill. Did you do it?',
          isMetaRow: false,
        },
        {
          id: 'b2_missed',
          kind: 'event',
          time: '16:00',
          showTime: false, // inherits beat time, <5 min diff
          glyph: 'missed', // Event glyph sits ON label's row, vertically centered on its line
          tone: 'resolved',
          label: 'Check-in missed',
          isMetaRow: true,
        },
        {
          id: 'b2_fu',
          kind: 'davos',
          time: '16:00',
          showTime: false,
          tone: 'resolved',
          text: 'What got in the way?',
          isMetaRow: false,
        },
        {
          id: 'b2_answer',
          kind: 'user',
          time: '16:05',
          showTime: true, // >= 5 min later than 16:00!
          glyph: 'missed',
          tone: 'resolved',
          text: 'Got pulled into an urgent production bug.',
          isMetaRow: false,
        },
      ],
    },
    // Beat 3: 17:00
    {
      id: 'beat_1700',
      time: '17:00',
      rows: [
        {
          id: 'b3_prompt',
          kind: 'davos',
          time: '17:00',
          showTime: true,
          tone: 'resolved',
          text: 'Plan says Deep work on compiler slice. Did you do it?',
          isMetaRow: false,
        },
        {
          id: 'b3_answer',
          kind: 'user',
          time: '17:00',
          showTime: false,
          glyph: 'done',
          tone: 'resolved',
          text: 'Did it', // Brief: Answer text = what user did ("Did it"), never plan title
          isMetaRow: false,
        },
      ],
    },
    // Beat 4: 17:40 (Urge Beat)
    {
      id: 'beat_1740',
      time: '17:40',
      rows: [
        {
          id: 'b4_event',
          kind: 'event',
          time: '17:40',
          showTime: true,
          glyph: 'urge_held', // Event glyph sits ON label's row, vertically centered on line
          tone: 'resolved',
          label: 'Urge reported 17:40.',
          isMetaRow: true,
        },
        {
          id: 'b4_tactic',
          kind: 'davos',
          time: '17:40',
          showTime: false,
          tone: 'resolved',
          text: "Name the urge. Stay with me ten minutes. I'll check back.",
          isMetaRow: false,
        },
        {
          id: 'b4_hold_q',
          kind: 'davos',
          time: '17:50',
          showTime: true, // >= 5 min later (10 min later)
          tone: 'resolved',
          text: 'Did you hold?',
          isMetaRow: false,
        },
        {
          id: 'b4_answer',
          kind: 'user',
          time: '17:50',
          showTime: false,
          glyph: 'urge_held',
          tone: 'resolved',
          text: 'Resisted distraction urge',
          isMetaRow: false,
        },
      ],
    },
  ];

  // Beat 5: 18:00 (Due Beat)
  if (showActiveBeatOrAnswer(activePromptDismissed, activeAnswerOption)) {
    const beat5Rows: BeatRow[] = [
      {
        id: 'b5_prompt',
        kind: 'davos',
        time: '18:00',
        showTime: true,
        glyph: activePromptDismissed ? undefined : 'due',
        tone: activePromptDismissed ? 'resolved' : 'live',
        text: 'Plan says Spec review with team. Did you do it?',
        isMetaRow: false,
      },
    ];

    if (!activePromptDismissed) {
      // Pending prompt: response strip aligns to content x=72
      beat5Rows.push({
        id: 'b5_strip',
        kind: 'response_strip',
        showTime: false,
        tone: 'live',
        isMetaRow: false,
      });
    } else {
      // Answered: user answer row with right-aligned meta "Undo" (44pt target), gone after 6s
      const answerGlyph: GlyphState =
        activeAnswerOption === 'did_it'
          ? 'done'
          : activeAnswerOption === 'partly'
          ? 'partly'
          : 'missed';
      const answerText =
        activeAnswerOption === 'did_it'
          ? 'Did it'
          : activeAnswerOption === 'partly'
          ? 'Partly'
          : "Didn't";

      beat5Rows.push({
        id: 'b5_answer',
        kind: 'user',
        time: '18:04',
        showTime: false,
        glyph: answerGlyph,
        tone: 'resolved',
        text: answerText,
        showUndo: undoActive,
        isMetaRow: false,
      });

      if (activeAnswerOption === 'partly' || activeAnswerOption === 'didnt') {
        beat5Rows.push({
          id: 'b5_fu',
          kind: 'davos',
          time: '18:04',
          showTime: false,
          tone: 'resolved',
          text: 'What got in the way?',
          isMetaRow: false,
        });

        if (activeAnswerFollowUp) {
          beat5Rows.push({
            id: 'b5_fu_ans',
            kind: 'user',
            time: '18:04',
            showTime: false,
            tone: 'resolved',
            text: activeAnswerFollowUp,
            isMetaRow: false,
          });
        }
      }
    }

    beats.push({
      id: 'beat_1800',
      time: '18:00',
      rows: beat5Rows,
    });
  }

  // Render a single row inside a beat with exact 3-column grammar:
  // gutter x0–48 | rail x48–72 (glyph centered at x=60) | content x72→end.
  const renderBeatRow = (row: BeatRow) => {
    if (row.kind === 'response_strip') {
      return (
        <ThreadRow key={row.id}>
          <ResponseRow
            options={DEFAULT_CHECKIN_OPTIONS}
            onSelect={handleCheckInResponse}
            selectedOption={null}
            colorScheme={isDark ? 'dark' : 'light'}
          />
        </ThreadRow>
      );
    }

    if (row.kind === 'event') {
      return (
        <ThreadRow
          key={row.id}
          time={row.time}
          showTime={row.showTime}
          glyph={row.glyph}
          isMetaRow={true}>
          <SystemLine label={row.label} />
        </ThreadRow>
      );
    }

    if (row.kind === 'davos') {
      return (
        <ThreadRow
          key={row.id}
          time={row.time}
          showTime={row.showTime}
          glyph={row.glyph}
          isLive={row.tone === 'live'}>
          <DavosMessage text={row.text ?? ''} tone={row.tone} action={row.action} />
        </ThreadRow>
      );
    }

    if (row.kind === 'user') {
      return (
        <ThreadRow
          key={row.id}
          time={row.time}
          showTime={row.showTime}
          glyph={row.glyph}>
          <UserMessage
            text={row.text ?? ''}
            sendState={row.sendState ?? 'sent'}
            onUndo={row.showUndo ? handleUndo : undefined}
            showUndo={row.showUndo}
          />
        </ThreadRow>
      );
    }

    return null;
  };

  // Render a Beat as one View with INNER_GAP (8) between rows and BEAT_GAP (32) marginTop
  const renderBeat = ({ item: beat, index }: { item: ThreadBeat; index: number }) => {
    return (
      <View
        key={beat.id}
        style={[styles.beat, index > 0 && { marginTop: BEAT_GAP }]}>
        <View style={styles.beatRows}>
          {beat.rows.map(renderBeatRow)}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      {/* Thread list with 3-column grammar and bottom anchoring */}
      <FlatList
        ref={flatListRef}
        data={beats}
        keyExtractor={(item) => item.id}
        renderItem={renderBeat}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.streamContent}
        style={styles.streamList}
        ListFooterComponent={
          <View style={styles.footerContainer}>
            {/* Urge Hold follow-up question strip */}
            {awaitingUrgeHold && (
              <View style={{ marginTop: BEAT_GAP }}>
                <ThreadRow isLivePrompt={true}>
                  <Text
                    style={[
                      typeRoles.davosVoice,
                      { color: colors.textPrimary, lineHeight: LINE, fontWeight: '500' },
                    ]}
                    allowFontScaling={true}>
                    Did you hold?
                  </Text>
                  <ResponseRow
                    options={URGE_OPTIONS}
                    onSelect={handleUrgeHoldResponse}
                    colorScheme={isDark ? 'dark' : 'light'}
                  />
                </ThreadRow>
              </View>
            )}

            {/* Flow F3: Inline PlanList during evening session */}
            {(eveningStage === 'proposing_plan' || eveningStage === 'confirmed') && (
              <View style={styles.inlinePlanContainer}>
                <PlanList
                  initialItems={eveningPlan}
                  isLockedInitially={eveningStage === 'confirmed'}
                  onConfirm={handleConfirmPlan}
                />
              </View>
            )}

            {/* Evening Session Offer */}
            {hasEveningOffer && (
              <View style={{ marginTop: BEAT_GAP }}>
                <ThreadRow time="20:30" showTime={true} isLivePrompt={true}>
                  <DavosMessage
                    text="Evening reflection & planning."
                    tone="live"
                    action={{
                      label: 'Start',
                      accessibilityLabel: 'Start evening session',
                      onPress: handleStartEveningSession,
                    }}
                  />
                </ThreadRow>
              </View>
            )}

            {/* Oath offer */}
            {hasOathOffer && pendingOathCommitment && (
              <View style={{ marginTop: BEAT_GAP }}>
                <ThreadRow isLivePrompt={true}>
                  <DavosMessage
                    text={`Make this an Oath: "${pendingOathCommitment}"?`}
                    tone="live"
                    action={{
                      label: 'Draft an Oath',
                      accessibilityLabel: 'Draft an Oath',
                      onPress: () =>
                        router.push({
                          pathname: '/oath',
                          params: { draft: pendingOathCommitment },
                        }),
                    }}
                  />
                </ThreadRow>
              </View>
            )}

            {/* Tail Row: "After the last due beat, one tail row, replaced in place, never repeated:
                Next 20:30 · Evening reflection & planning (meta, textSecondary)." */}
            {eveningStage === 'idle' && !hasEveningOffer && (
              <View style={styles.tailRow}>
                <ThreadRow isMetaRow={true}>
                  <Text
                    style={[
                      styles.tailText,
                      typeRoles.meta,
                      { color: colors.textSecondary, lineHeight: META_LINE },
                    ]}
                    allowFontScaling={true}>
                    Next 20:30 · Evening reflection & planning
                  </Text>
                </ThreadRow>
              </View>
            )}
          </View>
        }
      />

      {/* Jump to latest control when user has scrolled up */}
      {isScrolledUp && (
        <View style={styles.jumpToLatestWrapper} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to latest message"
            hitSlop={touchTarget.hitSlop}
            style={[
              styles.jumpToLatestButton,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.controlBorder,
              },
            ]}
            onPress={() => scrollToBottom(true)}>
            <Text
              style={[
                styles.jumpToLatestText,
                typeRoles.meta,
                { color: colors.textPrimary, fontWeight: '400' },
              ]}
              allowFontScaling={true}>
              ↓ Jump to latest
            </Text>
          </Pressable>
        </View>
      )}

      {/* Composer at bottom: Urge occupies x0–72, input starts at x=72, Send at right edge */}
      <View style={styles.composerWrapper}>
        <Composer
          inputRef={composerInputRef}
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          onUrge={handleUrge}
          placeholder={placeholder}
          state={errorMessage === 'offline' ? 'offline' : 'enabled'}
        />
      </View>
    </View>
  );
}

function showActiveBeatOrAnswer(dismissed: boolean, answered: CheckInResponseOption | null): boolean {
  return true;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  emptyContainer: {
    padding: spacing.md,
    gap: spacing.md,
  },
  emptyCopy: {
    paddingHorizontal: spacing.none,
  },
  streamList: {
    flex: 1,
    width: '100%',
  },
  streamContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    width: '100%',
  },
  beat: {
    width: '100%',
  },
  beatRows: {
    width: '100%',
    gap: INNER_GAP, // 8: gap between rows inside a beat
  },
  footerContainer: {
    width: '100%',
  },
  tailRow: {
    marginTop: BEAT_GAP, // 32: gap to tail row after the last due beat
    width: '100%',
  },
  tailText: {
    paddingHorizontal: spacing.none,
  },
  inlinePlanContainer: {
    paddingVertical: spacing.xs,
    marginTop: BEAT_GAP,
  },
  actionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  actionButtonText: {
    paddingHorizontal: spacing.none,
  },
  composerWrapper: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  jumpToLatestWrapper: {
    position: 'absolute',
    bottom: 72,
    alignSelf: 'center',
    zIndex: 10,
  },
  jumpToLatestButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  jumpToLatestText: {
    paddingHorizontal: spacing.none,
  },
});
