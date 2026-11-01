// app/(app)/chat.tsx
// Screen S1 (Thread) — Vertical Slice of Flow F1 (Hourly Check-in)
// Refs: design/DESIGN_PRD.md §0, §7, §11, §12, §13, §14; design/BREADBOARD.md F1; design/RECON.md §5

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { spacing, touchTarget } from '../../theme/tokens/spacing';
import {
  CheckInItem,
  DoingRecord,
  StatusLineData,
  ThreadMessage,
  createDoingRecord,
  initialMessages,
  initialStatusLine,
  samplePendingCheckInWithPlan,
  samplePendingCheckInWithoutPlan,
} from '../../fixtures/davos';
import { useAuth } from '../../lib/auth';
import { onCheckinTap, submitCheckIn } from '../../lib/checkins';
import { logImpulse } from '../../lib/impulse';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';

export default function ChatScreen() {
  const { user } = useAuth();
  const userId = user?.id ?? 'user_dev';

  // State management for S1 Thread view states (PRD §11)
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [errorMessage, setErrorMessage] = useState<'offline' | 'failed' | null>(null);

  // Thread, status line, and pending check-in state
  const [statusLine, setStatusLine] = useState<StatusLineData>(initialStatusLine);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [pendingCheckIn, setPendingCheckIn] = useState<CheckInItem | null>(
    samplePendingCheckInWithPlan
  );

  // Undo toast state (10-second timer per BREADBOARD.md F1)
  const [undoActive, setUndoActive] = useState<boolean>(false);
  const [lastLoggedDoing, setLastLoggedDoing] = useState<DoingRecord | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composer input & state
  const [draft, setDraft] = useState<string>('');
  const [placeholder, setPlaceholder] = useState<string>('Message Davos');
  const inputRef = useRef<TextInput | null>(null);

  // Clean up undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  // Listen to live or cold-start check-in notification tap events (RECON.md §3.2)
  useEffect(() => {
    return onCheckinTap((_windowTs) => {
      // Re-arm pending check-in for the tapped window
      setPendingCheckIn(samplePendingCheckInWithPlan);
    });
  }, []);

  // Flow F1 Behaviour: [Did it] logs a Doing, acknowledges, and starts 10s undo control
  const handleDidIt = useCallback(() => {
    if (!pendingCheckIn) return;

    const doing = createDoingRecord({
      what: pendingCheckIn.planItem?.text ?? 'Hourly check-in',
      planItem: pendingCheckIn.planItem,
    });
    setLastLoggedDoing(doing);

    // Call submitCheckIn data layer hook where available
    void submitCheckIn(userId, `Did it: ${doing.what}`, Date.now()).catch(() => {});

    // Add user response and Davos acknowledgement to message stream
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    // Show undo control for 10 seconds
    setUndoActive(true);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = setTimeout(() => {
      setUndoActive(false);
      setLastLoggedDoing(null);
    }, 10000);
  }, [pendingCheckIn, userId]);

  // Undo logged Doing within 10s window
  const handleUndo = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    setUndoActive(false);
    // Remove last acknowledgement from stream and restore check-in prompt
    setMessages((prev) => prev.slice(0, -2));
    setPendingCheckIn(samplePendingCheckInWithPlan);
    setLastLoggedDoing(null);
  }, []);

  // Flow F1 Behaviour: [Partly] focuses composer with "What did you do?"
  const handlePartly = useCallback(() => {
    setPlaceholder('What did you do?');
    inputRef.current?.focus();
  }, []);

  // Flow F1 Behaviour: [Something else] focuses composer with "What did you do?"
  const handleSomethingElse = useCallback(() => {
    setPlaceholder('What did you do?');
    inputRef.current?.focus();
  }, []);

  // Flow F1 Behaviour: [Didn't] shows Davos's single follow-up question
  const handleDidnt = useCallback(() => {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      text: 'Missed. What got in the way?',
      time: nowTime,
    };

    setMessages((prev) => [...prev, userMsg, davosQuestion]);
    setPendingCheckIn(null);
    setPlaceholder('What got in the way?');
    inputRef.current?.focus();
  }, []);

  // Composer submit handler (Send)
  const handleSend = useCallback(() => {
    const content = draft.trim();
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
    setPlaceholder('Message Davos');

    // Submit check-in or regular message
    void submitCheckIn(userId, content, Date.now()).catch(() => {
      setViewState('error');
      setErrorMessage('failed');
    });
  }, [draft, userId]);

  // Urge button handler (positioned strictly to the LEFT of TextInput per PRD §8 / BREADBOARD F2)
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

  // Render individual message in plain Text (no bubbles, no cards, no avatars per PRD §14 #1 & #2)
  const renderMessageItem = ({ item }: { item: ThreadMessage }) => {
    const isDavos = item.role === 'davos';
    const isUser = item.role === 'user';

    return (
      <View style={styles.messageRow}>
        <Text style={styles.messageText}>
          {isDavos ? `Davos: ${item.text}` : isUser ? `You: ${item.text}` : item.text}
        </Text>
      </View>
    );
  };

  // Flow F1 rule: with no Plan item for the interval, response row is replaced by focused composer
  const hasPlanItem = pendingCheckIn?.planItem !== null && pendingCheckIn?.planItem !== undefined;

  // View state copy per PRD §11
  if (viewState === 'loading') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>Syncing</Text>
      </View>
    );
  }

  if (viewState === 'empty') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>
          First run: Davos introduces himself and asks when you start and stop
        </Text>
      </View>
    );
  }

  if (viewState === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>
          {errorMessage === 'offline' ? 'Offline. 2 waiting.' : 'Not sent. Retry.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry sending message"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={() => setViewState('populated')}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. Status line as Text at the top (PRD §8, BREADBOARD F1) */}
      <View style={styles.statusLineContainer}>
        <Text style={styles.statusLineText}>
          Next check-in {statusLine.nextCheckIn} · {statusLine.progress}
        </Text>
      </View>

      {/* 2. Message stream as plain Text (PRD §14 Do-not #1 & #2: unboxed, no cards, no bubbles) */}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessageItem}
        contentContainerStyle={styles.streamContent}
        style={styles.streamList}
      />

      {/* 3. Pending check-in prompt and response row (BREADBOARD F1) */}
      {pendingCheckIn && pendingCheckIn.status === 'pending' && (
        <View style={styles.pendingCheckInContainer}>
          <Text style={styles.promptText}>{pendingCheckIn.prompt}</Text>

          {/* Response row: only rendered when interval has a Plan item */}
          {hasPlanItem ? (
            <View style={styles.responseRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Did it"
                hitSlop={touchTarget.hitSlop}
                style={styles.responseButton}
                onPress={handleDidIt}>
                <Text>Did it</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Partly"
                hitSlop={touchTarget.hitSlop}
                style={styles.responseButton}
                onPress={handlePartly}>
                <Text>Partly</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Didn't"
                hitSlop={touchTarget.hitSlop}
                style={styles.responseButton}
                onPress={handleDidnt}>
                <Text>Didn't</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Something else"
                hitSlop={touchTarget.hitSlop}
                style={styles.responseButton}
                onPress={handleSomethingElse}>
                <Text>Something else</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      {/* 4. Undo control: visible for 10s after logging (BREADBOARD F1) */}
      {undoActive && lastLoggedDoing && (
        <View style={styles.undoRow}>
          <Text style={styles.undoText}>Logged: {lastLoggedDoing.what}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo check-in log"
            hitSlop={touchTarget.hitSlop}
            style={styles.undoButton}
            onPress={handleUndo}>
            <Text>Undo</Text>
          </Pressable>
        </View>
      )}

      {/* 5. Composer: Urge to the LEFT, TextInput in middle, Send to the RIGHT (PRD §8, BREADBOARD F1 & F2) */}
      <View style={styles.composerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report or resist an urge"
          hitSlop={touchTarget.hitSlop}
          style={styles.composerButton}
          onPress={handleUrge}>
          <Text>Urge</Text>
        </Pressable>

        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          accessibilityLabel="Message Davos input"
          style={styles.input}
          onSubmitEditing={handleSend}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          hitSlop={touchTarget.hitSlop}
          style={styles.composerButton}
          onPress={handleSend}>
          <Text>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Layout only using spacing scale tokens; no colours, borders, shadows, or custom fonts
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusLineContainer: {
    paddingVertical: spacing.xs,
  },
  statusLineText: {
    paddingHorizontal: spacing.none,
  },
  streamList: {
    flex: 1,
  },
  streamContent: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  messageRow: {
    paddingVertical: spacing.xxs,
  },
  messageText: {
    paddingHorizontal: spacing.none,
  },
  pendingCheckInContainer: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  promptText: {
    paddingBottom: spacing.xxs,
  },
  responseRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  responseButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  undoText: {
    paddingHorizontal: spacing.none,
  },
  undoButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  composerButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  stateText: {
    paddingVertical: spacing.md,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
