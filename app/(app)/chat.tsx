// app/(app)/chat.tsx
// Screen S1 (Thread) — Flow F1 (Check-in), F3 (Evening Session), F4 (Oath Trigger)
// Canonical assembly from existing components: StatusLine, DavosMessage, UserMessage,
// SystemLine, CheckInPrompt, ResponseRow, UndoToast, PlanList, Composer.
// Refs: design/DESIGN_PRD.md §0, §7.1, §7.3, §7.4, §11, §12, §13, §14; design/BREADBOARD.md F1, F3, F4; design/RECON.md §5
// Uses only theme/roles.ts. RN primitives only. No cards, no elevation.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
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
  CheckInItem,
  DoingRecord,
  PlanItem,
  ThreadMessage,
  createDoingRecord,
  initialMessages,
  sampleEveningPlanItems,
  samplePendingCheckInWithPlan,
  samplePlanItem,
  sampleTodayPlanItems,
} from '../../fixtures/davos';
import { computeCheckinStatus } from '../../lib/checkinCounts';
import { format24Hour } from '../../lib/timeFormat';
import { useAuth } from '../../lib/auth';
import { onCheckinTap, submitCheckIn } from '../../lib/checkins';
import { logImpulse } from '../../lib/impulse';
import { oathAdapter } from '../../lib/oathAdapter';
import { StatusLine } from '../../components/davos/StatusLine';
import { DavosMessage } from '../../components/davos/DavosMessage';
import { UserMessage } from '../../components/davos/UserMessage';
import { SystemLine } from '../../components/davos/SystemLine';
import { CheckInPrompt } from '../../components/davos/CheckInPrompt';
import {
  CheckInResponseOption,
} from '../../components/davos/ResponseRow';
import { UndoToast } from '../../components/davos/UndoToast';
import { PlanList } from '../../components/davos/PlanList';
import { Composer } from '../../components/davos/Composer';
import { SampleDataMarker } from '../../components/davos/SampleDataMarker';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';
type EveningStage = 'idle' | 'q1' | 'q2' | 'q3' | 'proposing_plan' | 'confirmed';

export default function ChatScreen() {
  const router = useRouter();
  const { prompt: paramPrompt, evening: paramEvening, commitment: paramCommitment } =
    useLocalSearchParams<{ prompt?: string; evening?: string; commitment?: string }>();
  const { user } = useAuth();
  const userId = user?.id ?? 'user_dev';
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  // View state management (PRD §11)
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [errorMessage, setErrorMessage] = useState<'offline' | 'failed' | null>(null);

  // Status line & plan item state driven by shared computeCheckinStatus (Step 0, C.1, C.2)
  const [todayPlan, setTodayPlan] = useState<PlanItem[]>(sampleTodayPlanItems);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [pendingCheckIn, setPendingCheckIn] = useState<CheckInItem | null>(
    samplePendingCheckInWithPlan
  );
  const [selectedResponse, setSelectedResponse] = useState<CheckInResponseOption | null>(null);

  // Follow-up question state (A.3)
  const [awaitingFollowUpInterval, setAwaitingFollowUpInterval] = useState<string | null>(null);

  // Flow F4: Oath commitment offer state (A.1)
  const [pendingOathCommitment, setPendingOathCommitment] = useState<string | null>(
    paramCommitment ?? null
  );

  // Auto-scrolling & Jump-to-latest state (PRD B.1)
  const flatListRef = useRef<FlatList<ThreadMessage> | null>(null);
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

  // On load and whenever messages or pendingCheckIn change, scroll to newest if user hasn't scrolled up
  useEffect(() => {
    if (!isScrolledUp) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [messages.length, pendingCheckIn, isScrolledUp]);

  // Composer input ref for programmatic focus (PRD A4)
  const composerInputRef = useRef<TextInput | null>(null);

  // Focus composer when in missed state
  useEffect(() => {
    if (pendingCheckIn?.status === 'missed') {
      composerInputRef.current?.focus();
    }
  }, [pendingCheckIn?.status]);

  // Synchronize prompt with route parameter if arriving from notification link (F1)
  useEffect(() => {
    if (paramPrompt && typeof paramPrompt === 'string') {
      setPendingCheckIn({
        id: `checkin_${Date.now()}`,
        interval: '14:00',
        prompt: paramPrompt,
        planItem: samplePlanItem,
        status: 'pending',
      });
    }
  }, [paramPrompt]);

  // Undo toast state (10s window per PRD §11 / BREADBOARD.md F1)
  const [undoActive, setUndoActive] = useState<boolean>(false);
  const [lastLoggedDoing, setLastLoggedDoing] = useState<DoingRecord | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flow F3: Evening session state
  const [eveningStage, setEveningStage] = useState<EveningStage>('idle');
  const [eveningPlan, setEveningPlan] = useState<PlanItem[]>(sampleEveningPlanItems);

  // Composer input & placeholder
  const [draft, setDraft] = useState<string>('');
  const [placeholder, setPlaceholder] = useState<string>('Message Davos');

  // Flow F4: Check for newly bound oath on return (BREADBOARD F4)
  const acknowledgedOathRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      oathAdapter.getBoundOath().then((bound) => {
        if (bound && acknowledgedOathRef.current !== bound.id) {
          acknowledgedOathRef.current = bound.id;
          const nowTime = format24Hour(new Date());
          const ackMsg: ThreadMessage = {
            id: `msg_${Date.now()}_oath_ack`,
            role: 'davos',
            text: 'Oath bound. It cannot be edited or deleted.',
            time: nowTime,
          };
          setMessages((prev) => [...prev, ackMsg]);
          setPendingOathCommitment(null);
        }
      });
    }, [])
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
      setPendingCheckIn(samplePendingCheckInWithPlan);
    });
  }, []);

  // Flow F1: Check-in response handler (PRD B.2, B.5, C.1)
  const handleCheckInResponse = useCallback(
    (option: CheckInResponseOption) => {
      if (!pendingCheckIn) return;
      setSelectedResponse(option);
      const checkInInterval = pendingCheckIn.interval;
      const nowTime = format24Hour(new Date());

      const promptText = pendingCheckIn.planItem
        ? `${pendingCheckIn.interval}. Plan says ${pendingCheckIn.planItem.text}. Did you do it?`
        : `${pendingCheckIn.interval}. What did you do this hour?`;

      const davosQuestionMsg: ThreadMessage = {
        id: `msg_${Date.now()}_q`,
        role: 'davos',
        text: promptText,
        time: pendingCheckIn.interval,
      };

      if (option === 'did_it') {
        setAwaitingFollowUpInterval(null);
        const doing = createDoingRecord({
          what: pendingCheckIn.planItem?.text ?? 'Hourly check-in',
          planItem: pendingCheckIn.planItem,
        });
        setLastLoggedDoing(doing);

        // PRD §11 Check-in error / offline: Log queued: "Saved here. Will sync."
        void submitCheckIn(userId, `Did it: ${doing.what}`, Date.now()).catch(() => {
          const queueNotice: ThreadMessage = {
            id: `msg_${Date.now()}_queued`,
            role: 'system',
            text: 'Saved here. Will sync.',
            time: nowTime,
          };
          setMessages((prev) => [...prev, queueNotice]);
        });

        const userMsg: ThreadMessage = {
          id: `msg_${Date.now()}_u`,
          role: 'user',
          text: 'Did it',
          time: nowTime,
          sendState: 'sent',
        };
        const routineAck: ThreadMessage = {
          id: `msg_${Date.now()}_ack`,
          role: 'system', // Routine ack is a quiet system line (B.2)
          text: 'Logged. Next check-in 19:00.',
          time: nowTime,
        };

        setMessages((prev) => [...prev, davosQuestionMsg, userMsg, routineAck]);
        setPendingCheckIn(null);
        setSelectedResponse(null);
        setTodayPlan((prev) =>
          prev.map((item) => (item.id === 'today_4' ? { ...item, status: 'done' } : item))
        );

        // Show undo toast
        setUndoActive(true);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => {
          setUndoActive(false);
          setLastLoggedDoing(null);
        }, 10000);
      } else if (option === 'partly') {
        setAwaitingFollowUpInterval(checkInInterval);
        const userMsg: ThreadMessage = {
          id: `msg_${Date.now()}_u`,
          role: 'user',
          text: 'Partly',
          time: nowTime,
          sendState: 'sent',
        };
        const davosQuestion: ThreadMessage = {
          id: `msg_${Date.now()}_d`,
          role: 'davos',
          text: 'What did you do?',
          time: nowTime,
        };
        setMessages((prev) => [...prev, davosQuestionMsg, userMsg, davosQuestion]);
        setPendingCheckIn(null);
        setSelectedResponse(null);
        setPlaceholder('What did you do?');
        composerInputRef.current?.focus();
      } else if (option === 'didnt') {
        setAwaitingFollowUpInterval(checkInInterval);
        const userMsg: ThreadMessage = {
          id: `msg_${Date.now()}_u`,
          role: 'user',
          text: "Didn't",
          time: nowTime,
          sendState: 'sent',
        };
        const davosQuestion: ThreadMessage = {
          id: `msg_${Date.now()}_d`,
          role: 'davos',
          text: 'What got in the way?',
          time: nowTime,
        };
        setMessages((prev) => [...prev, davosQuestionMsg, userMsg, davosQuestion]);
        setPendingCheckIn(null);
        setSelectedResponse(null);
        setPlaceholder('What got in the way?');
        composerInputRef.current?.focus();
      } else if (option === 'something_else') {
        setAwaitingFollowUpInterval(checkInInterval);
        const userMsg: ThreadMessage = {
          id: `msg_${Date.now()}_u`,
          role: 'user',
          text: 'Something else',
          time: nowTime,
          sendState: 'sent',
        };
        const davosQuestion: ThreadMessage = {
          id: `msg_${Date.now()}_d`,
          role: 'davos',
          text: 'What did you do?',
          time: nowTime,
        };
        setMessages((prev) => [...prev, davosQuestionMsg, userMsg, davosQuestion]);
        setPendingCheckIn(null);
        setSelectedResponse(null);
        setPlaceholder('What did you do?');
        composerInputRef.current?.focus();
      }
    },
    [pendingCheckIn, userId]
  );

  // Undo handler
  const handleUndo = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    setUndoActive(false);
    setMessages((prev) => prev.slice(0, -3));
    setPendingCheckIn(samplePendingCheckInWithPlan);
    setAwaitingFollowUpInterval(null);
    setSelectedResponse(null);
    setLastLoggedDoing(null);
    setTodayPlan(sampleTodayPlanItems);
  }, []);

  // Flow F3: Start evening session
  const handleStartEveningSession = useCallback(() => {
    const nowTime = format24Hour(new Date());
    const davosQ1: ThreadMessage = {
      id: `msg_${Date.now()}_d`,
      role: 'davos',
      text: 'What went well today? What slipped?',
      time: nowTime,
    };

    setMessages((prev) => [...prev, davosQ1]);
    setEveningStage('q1');
  }, []);

  // Flow F3: Lock plan on confirm action
  const handleConfirmPlan = useCallback((confirmedItems: PlanItem[]) => {
    setEveningPlan(confirmedItems);
    setEveningStage('confirmed');

    const nowTime = format24Hour(new Date());
    const davosAck: ThreadMessage = {
      id: `msg_${Date.now()}_d`,
      role: 'davos',
      text: 'Plan locked. Reflection saved.',
      time: nowTime,
    };
    setMessages((prev) => [...prev, davosAck]);
  }, []);

  // Composer Send handler
  const handleSend = useCallback(
    (textToSend: string) => {
      const content = textToSend.trim();
      if (!content) return;

      const nowTime = format24Hour(new Date());
      const userMsg: ThreadMessage = {
        id: `msg_${Date.now()}_u`,
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
        setPlaceholder('Message Davos');
        setTodayPlan((prev) =>
          prev.map((item) => (item.id === 'today_4' ? { ...item, status: 'done' } : item))
        );
        const routineAck: ThreadMessage = {
          id: `msg_${Date.now()}_ack`,
          role: 'system',
          text: 'Logged. Next check-in 19:00.',
          time: nowTime,
        };
        setMessages((prev) => [...prev, routineAck]);

        if (commitmentRegex.test(content)) {
          setPendingOathCommitment(content);
        }
        return;
      }

      // Check if user stated a commitment
      if (commitmentRegex.test(content)) {
        setPendingOathCommitment(content);
      }

      // Flow F3 Evening session progression
      if (eveningStage === 'q1') {
        const q2Msg: ThreadMessage = {
          id: `msg_${Date.now() + 1}_d`,
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
          id: `msg_${Date.now() + 1}_d`,
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
          id: `msg_${Date.now() + 1}_d`,
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
      void submitCheckIn(userId, content, Date.now()).catch(() => {
        // Error state handling per PRD §11: Send fails -> "Not sent. Retry."
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? { ...m, sendState: 'failed' } : m))
        );
      });
    },
    [awaitingFollowUpInterval, eveningStage, userId]
  );

  // Urge handler (strictly left of input inside Composer)
  const handleUrge = useCallback(() => {
    void logImpulse('app');
    const nowTime = format24Hour(new Date());
    const davosTactic: ThreadMessage = {
      id: `msg_${Date.now()}_d`,
      role: 'davos',
      text: "Name the urge. Stay with me ten minutes. I'll check back.",
      time: nowTime,
    };
    setMessages((prev) => [...prev, davosTactic]);
  }, []);

  // PRD §11: Empty state (First run)
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
              style={[styles.actionButtonText, typeRoles.davosVoice, { color: colors.textPrimary, fontWeight: '500' }]}
              allowFontScaling={true}>
              Set schedule (09:00 - 18:00)
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // PRD §11: Error / Offline state & Status line computation
  const isOffline = errorMessage === 'offline';
  const isPending = pendingCheckIn?.status === 'pending';
  const isAnswering = Boolean(awaitingFollowUpInterval);
  const statusCounts = computeCheckinStatus(todayPlan, {
    dueInterval: isPending ? pendingCheckIn?.interval : undefined,
  });
  const displayProgress = isOffline ? 'Offline · 2 waiting' : statusCounts.progressText;
  const isDueNow = statusCounts.nextOrDue.isDue;
  const displayNextTime = isAnswering
    ? (awaitingFollowUpInterval ?? statusCounts.nextOrDue.time)
    : statusCounts.nextOrDue.time;

  // One-Offer Rule Priority Calculation (PRD §12, design/DESIGN.md §6.3, AU42)
  // Priority: (1) open check-in question or follow-up, (2) evening session at scheduled time (20:30), (3) Oath offer.
  const isEveningActive = eveningStage !== 'idle' && eveningStage !== 'confirmed';
  const hasOpenCheckin = Boolean(pendingCheckIn || awaitingFollowUpInterval || isEveningActive);
  const isEveningTime = format24Hour(new Date()) >= '20:30' || paramEvening === 'true';
  const hasEveningOffer = !hasOpenCheckin && isEveningTime && eveningStage === 'idle';
  const hasOathOffer = !hasOpenCheckin && !hasEveningOffer && Boolean(pendingOathCommitment);

  // PRD §11: Loading state (Cached messages shown, status line "Syncing")
  if (viewState === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <StatusLine
          nextCheckIn={displayNextTime}
          progress="Syncing"
          syncState="normal"
        />
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            item.role === 'davos' ? (
              <DavosMessage text={item.text} time={item.time} action={item.action} />
            ) : item.role === 'user' ? (
              <UserMessage
                text={item.text}
                time={item.time}
                sendState={item.sendState ?? 'sent'}
              />
            ) : (
              <SystemLine text={item.text} />
            )
          }
          contentContainerStyle={styles.streamContent}
          style={styles.streamList}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      {/* 1. Status line at top (PRD §8, B.7, BREADBOARD F1, C.1, C.2, A.3) */}
      <StatusLine
        nextCheckIn={statusCounts.nextOrDue.time}
        progress={displayProgress}
        syncState={isOffline ? 'offline' : 'normal'}
        dueNow={isDueNow && !isAnswering ? displayNextTime : undefined}
        isPending={isDueNow && !isAnswering}
        isAnswering={isAnswering}
        answeringTime={awaitingFollowUpInterval ?? undefined}
      />

      {/* 2. Message stream using canonical DavosMessage, UserMessage, SystemLine (B.1 anchored to bottom) */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View style={styles.listHeaderContainer}>
            <SampleDataMarker screen="Davos Thread" />
            <View style={styles.dayDividerContainer}>
              <Text
                style={[styles.dayDividerText, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                Today
              </Text>
            </View>
          </View>
        }
        renderItem={({ item, index }) => {
          const prevItem = index > 0 ? messages[index - 1] : null;
          const showTime = !prevItem || prevItem.time !== item.time || prevItem.role !== item.role;

          if (item.role === 'davos') {
            return (
              <DavosMessage
                text={item.text}
                time={item.time}
                showTime={showTime}
                action={item.action}
              />
            );
          }
          if (item.role === 'user') {
            return (
              <UserMessage
                text={item.text}
                time={item.time}
                showTime={showTime}
                sendState={item.sendState ?? 'sent'}
                onRetry={() => {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === item.id ? { ...m, sendState: 'sent' } : m))
                  );
                }}
              />
            );
          }
          return <SystemLine text={item.text} />;
        }}
        ListFooterComponent={
          <>
            {/* Priority 1: Pending check-in prompt: last message in stream, response row left-aligned under it (PRD A1-A4, B.3) */}
            {pendingCheckIn && (
              <View style={styles.pendingCheckInContainer}>
                <CheckInPrompt
                  interval={pendingCheckIn.interval}
                  planItem={pendingCheckIn.planItem}
                  status={pendingCheckIn.status}
                  onSelectResponse={handleCheckInResponse}
                  selectedOption={selectedResponse}
                />
              </View>
            )}

            {/* Flow F3: Inline PlanList during evening session (BREADBOARD F3) */}
            {(eveningStage === 'proposing_plan' || eveningStage === 'confirmed') && (
              <View style={styles.inlinePlanContainer}>
                <PlanList
                  initialItems={eveningPlan}
                  isLockedInitially={eveningStage === 'confirmed'}
                  onConfirm={handleConfirmPlan}
                />
              </View>
            )}

            {/* Priority 2: Evening Session at scheduled time (20:30) as a normal Davos message with single [Start] */}
            {hasEveningOffer && (
              <DavosMessage
                text="Evening reflection & planning."
                time="20:30"
                action={{
                  label: 'Start',
                  accessibilityLabel: 'Start evening session',
                  onPress: handleStartEveningSession,
                }}
              />
            )}

            {/* Priority 3: Oath offer as a normal Davos message only after open question is answered, never beside another offer */}
            {hasOathOffer && pendingOathCommitment && (
              <DavosMessage
                text={`Make this an Oath: "${pendingOathCommitment}"?`}
                time={format24Hour(new Date())}
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
            )}
          </>
        }
        contentContainerStyle={styles.streamContent}
        style={styles.streamList}
      />

      {/* PRD B.1: Jump to latest control when user has scrolled up */}
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

      {/* 7. Undo control: visible for 10s after logging (BREADBOARD F1) */}
      {undoActive && lastLoggedDoing && (
        <UndoToast
          label={`Logged: ${lastLoggedDoing.what}`}
          timeout={10}
          onUndo={handleUndo}
          onExpire={() => setUndoActive(false)}
        />
      )}

      {/* 8. Canonical Composer (Urge strictly to left, Send to right) */}
      <View style={styles.composerWrapper}>
        <Composer
          inputRef={composerInputRef}
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          onUrge={handleUrge}
          placeholder={placeholder}
          state={isOffline ? 'offline' : 'enabled'}
        />
      </View>
    </View>
  );
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
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexGrow: 1,
    width: '100%',
  },
  listHeaderContainer: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    alignItems: 'flex-start',
    gap: spacing.xs,
    width: '100%',
  },
  dayDividerContainer: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  dayDividerText: {
    paddingHorizontal: spacing.none,
  },
  pendingCheckInContainer: {
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  inlinePlanContainer: {
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
  },
  actionTriggerRow: {
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  triggerText: {
    paddingHorizontal: spacing.none,
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
