// app/(app)/chat.tsx
// Screen S1 (Thread) — Flow F1 (Check-in), F3 (Evening Session), F4 (Oath Trigger)
// Canonical assembly from existing components: StatusLine, DavosMessage, UserMessage,
// SystemLine, CheckInPrompt, ResponseRow, UndoToast, PlanList, Composer.
// Refs: design/DESIGN_PRD.md §0, §7.1, §7.3, §7.4, §11, §12, §13, §14; design/BREADBOARD.md F1, F3, F4; design/RECON.md §5
// Uses only theme/roles.ts. RN primitives only. No cards, no elevation.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import {
  CheckInItem,
  DoingRecord,
  PlanItem,
  StatusLineData,
  ThreadMessage,
  createDoingRecord,
  initialMessages,
  initialStatusLine,
  sampleEveningPlanItems,
  samplePendingCheckInWithPlan,
  samplePlanItem,
} from '../../fixtures/davos';
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
  ResponseRow,
} from '../../components/davos/ResponseRow';
import { UndoToast } from '../../components/davos/UndoToast';
import { PlanList } from '../../components/davos/PlanList';
import { Composer } from '../../components/davos/Composer';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';
type EveningStage = 'idle' | 'q1' | 'q2' | 'q3' | 'proposing_plan' | 'confirmed';

export default function ChatScreen() {
  const router = useRouter();
  const { prompt: paramPrompt } = useLocalSearchParams<{ prompt?: string }>();
  const { user } = useAuth();
  const userId = user?.id ?? 'user_dev';
  const colors = colorRoles.light;

  // View state management (PRD §11)
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [errorMessage, setErrorMessage] = useState<'offline' | 'failed' | null>(null);

  // Status line, thread messages, and pending check-in state
  const [statusLine, setStatusLine] = useState<StatusLineData>(initialStatusLine);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [pendingCheckIn, setPendingCheckIn] = useState<CheckInItem | null>(
    samplePendingCheckInWithPlan
  );
  const [selectedResponse, setSelectedResponse] = useState<CheckInResponseOption | null>(null);

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

  useEffect(() => {
    oathAdapter.getBoundOath().then((bound) => {
      if (bound && acknowledgedOathRef.current !== bound.id) {
        acknowledgedOathRef.current = bound.id;
        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const ackMsg: ThreadMessage = {
          id: `msg_${Date.now()}_oath_ack`,
          role: 'davos',
          text: 'Oath bound. It cannot be edited or deleted.',
          time: nowTime,
        };
        setMessages((prev) => [...prev, ackMsg]);
      }
    });
  }, []);

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

  // Flow F1: Check-in response handler
  const handleCheckInResponse = useCallback(
    (option: CheckInResponseOption) => {
      if (!pendingCheckIn) return;
      setSelectedResponse(option);
      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (option === 'did_it') {
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
          text: `Did it: ${doing.what}`,
          time: nowTime,
          sendState: 'sent',
        };
        const davosAck: ThreadMessage = {
          id: `msg_${Date.now()}_d`,
          role: 'davos',
          text: 'Logged. Next check-in 15:00.',
          time: nowTime,
        };

        setMessages((prev) => [...prev, userMsg, davosAck]);
        setPendingCheckIn(null);
        setSelectedResponse(null);

        // Show undo toast
        setUndoActive(true);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => {
          setUndoActive(false);
          setLastLoggedDoing(null);
        }, 10000);
      } else if (option === 'partly') {
        setPlaceholder('What did you do?');
        composerInputRef.current?.focus();
      } else if (option === 'didnt') {
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
        setMessages((prev) => [...prev, userMsg, davosQuestion]);
        setPendingCheckIn(null);
        setSelectedResponse(null);
        setPlaceholder('What got in the way?');
        composerInputRef.current?.focus();
      } else if (option === 'something_else') {
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
    setMessages((prev) => prev.slice(0, -2));
    setPendingCheckIn(samplePendingCheckInWithPlan);
    setSelectedResponse(null);
    setLastLoggedDoing(null);
  }, []);

  // Flow F3: Start evening session
  const handleStartEveningSession = useCallback(() => {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userMsg: ThreadMessage = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        text: content,
        time: nowTime,
        sendState: 'sent',
      };

      setMessages((prev) => [...prev, userMsg]);
      setDraft('');

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
    [eveningStage, userId]
  );

  // Urge handler (strictly left of input inside Composer)
  const handleUrge = useCallback(() => {
    void logImpulse('app');
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
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
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Set schedule (09:00 - 18:00)
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // PRD §11: Loading state (Cached messages shown, status line "Syncing")
  if (viewState === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <StatusLine
          nextCheckIn={statusLine.nextCheckIn}
          progress="Syncing"
          syncState="normal"
          colorScheme="light"
        />
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            item.role === 'davos' ? (
              <DavosMessage text={item.text} time={item.time} colorScheme="light" />
            ) : item.role === 'user' ? (
              <UserMessage
                text={item.text}
                time={item.time}
                sendState={item.sendState ?? 'sent'}
                colorScheme="light"
              />
            ) : (
              <SystemLine text={item.text} colorScheme="light" />
            )
          }
          contentContainerStyle={styles.streamContent}
        />
      </View>
    );
  }

  // PRD §11: Error / Offline state
  const isOffline = errorMessage === 'offline';
  const hasPlanItem = pendingCheckIn?.planItem !== null && pendingCheckIn?.planItem !== undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* 1. Status line at top (PRD §8, BREADBOARD F1) */}
      <StatusLine
        nextCheckIn={statusLine.nextCheckIn}
        progress={isOffline ? 'Offline · 2 waiting' : statusLine.progress}
        syncState={isOffline ? 'offline' : 'normal'}
        colorScheme="light"
      />

      {/* 2. Message stream using canonical DavosMessage, UserMessage, SystemLine */}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          if (item.role === 'davos') {
            return (
              <DavosMessage
                text={item.text}
                time={item.time}
                colorScheme="light"
              />
            );
          }
          if (item.role === 'user') {
            return (
              <UserMessage
                text={item.text}
                time={item.time}
                sendState={item.sendState ?? 'sent'}
                onRetry={() => {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === item.id ? { ...m, sendState: 'sent' } : m))
                  );
                }}
                colorScheme="light"
              />
            );
          }
          return <SystemLine text={item.text} colorScheme="light" />;
        }}
        ListFooterComponent={
          <>
            {/* 3. Pending check-in prompt: last message in stream, response row left-aligned under it (PRD A1-A4) */}
            {pendingCheckIn && (
              <View style={styles.pendingCheckInContainer}>
                <CheckInPrompt
                  interval={pendingCheckIn.interval}
                  planItem={pendingCheckIn.planItem}
                  status={pendingCheckIn.status}
                  onSelectResponse={handleCheckInResponse}
                  selectedOption={selectedResponse}
                  colorScheme="light"
                />
              </View>
            )}

            {/* 4. Flow F3: Inline PlanList during evening session (BREADBOARD F3) */}
            {(eveningStage === 'proposing_plan' || eveningStage === 'confirmed') && (
              <View style={styles.inlinePlanContainer}>
                <PlanList
                  initialItems={eveningPlan}
                  isLockedInitially={eveningStage === 'confirmed'}
                  onConfirm={handleConfirmPlan}
                  colorScheme="light"
                />
              </View>
            )}

            {/* 5. Trigger for Evening Session when idle (PRD §7.3) */}
            {eveningStage === 'idle' && !pendingCheckIn && (
              <View style={styles.actionTriggerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start evening session"
                  hitSlop={touchTarget.hitSlop}
                  style={[styles.actionButton, { borderColor: colors.divider }]}
                  onPress={handleStartEveningSession}>
                  <Text
                    style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    Start evening session (20:30)
                  </Text>
                </Pressable>
              </View>
            )}

            {/* 6. Flow F4: Davos asks "Make this an Oath?" -> [Draft an Oath] (BREADBOARD F4) */}
            {!pendingCheckIn && eveningStage === 'idle' && (
              <View style={styles.actionTriggerRow}>
                <Text
                  style={[styles.triggerText, typeRoles.davosVoice, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  Make this an Oath?
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Draft an Oath"
                  hitSlop={touchTarget.hitSlop}
                  style={[styles.actionButton, { borderColor: colors.divider }]}
                  onPress={() => router.push('/oath')}>
                  <Text
                    style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    Draft an Oath
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        }
        contentContainerStyle={styles.streamContent}
        style={styles.streamList}
      />

      {/* 7. Undo control: visible for 10s after logging (BREADBOARD F1) */}
      {undoActive && lastLoggedDoing && (
        <UndoToast
          label={`Logged: ${lastLoggedDoing.what}`}
          timeout={10}
          onUndo={handleUndo}
          onExpire={() => setUndoActive(false)}
          colorScheme="light"
        />
      )}

      {/* 8. Canonical Composer (Urge strictly to left, Send to right) */}
      <Composer
        inputRef={composerInputRef}
        value={draft}
        onChangeText={setDraft}
        onSend={handleSend}
        onUrge={handleUrge}
        placeholder={placeholder}
        state={isOffline ? 'offline' : 'enabled'}
        colorScheme="light"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  },
  streamContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  pendingCheckInContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  inlinePlanContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionTriggerRow: {
    paddingHorizontal: spacing.sm,
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
});
