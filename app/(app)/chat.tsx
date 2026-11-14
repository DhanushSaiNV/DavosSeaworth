// app/(app)/chat.tsx
// Screen S1 (Talk) — Conversation Stream and Action Zone (Redesign Mockup).
// Pure RN primitives only (FlatList, View, Text, Pressable, TextInput, Modal).
// Tokens via useTheme. Zero raw hex codes.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import {
  redesignConversationMessages,
  type ThreadMessage,
} from '../../fixtures/davos';
import {
  fetchSingleMessage,
  fetchTodayMessages,
  sendChatMessage,
  subscribeToUserMessages,
} from '../../lib/chatService';
import { loadSendQueue } from '../../lib/sendQueue';
import { makeClientMessageId } from '../../lib/ids';
import type {
  PlanAnchor,
  ActivityItem,
  TrackerState,
  UrgeState,
} from '../../domain/daySnapshot';
import { useAuth } from '../../lib/auth';
import { submitCheckIn } from '../../lib/checkins';
import { logImpulse } from '../../lib/impulse';
import { oathAdapter } from '../../lib/oathAdapter';
import { useDayContext } from '../../domain/DayContext';
import { ActionZone } from '../../components/davos/ActionZone';
import { CatchupStrip } from '../../components/davos/CatchupStrip';
import { UrgeBanner } from '../../components/davos/UrgeBanner';
import { UrgeModal } from '../../components/davos/UrgeModal';
import { PlanEditorModal } from '../../components/davos/PlanEditorModal';
import { Composer } from '../../components/davos/Composer';
import { Toast } from '../../components/davos/Toast';
import { DavosThinking } from '../../components/davos/DavosThinking';
import { hapticSelection } from '../../lib/haptics';

export default function ChatScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? 'user_dev';
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  const {
    snapshot,
    planDate,
    planAnchors,
    setPlanAnchors,
    savePlan,
    activityEvents,
    tracker,
    savedReport,
    activeUrge,
    setActiveUrge,
    activeWindow,
    missedWindows,
    activeCatchupWindow,
    setActiveCatchupWindow,
    isCatchupStripDismissed,
    dismissCatchupStrip,
    submitPeriodReport,
    undoPeriodReport,
    startUrgeHold,
    extendUrgeHold,
    resolveUrge,
    focusedBeatId,
    setFocusedBeatId,
  } = useDayContext();

  // Conversation stream messages (live when authenticated, fixture when in tests/dev)
  const [messages, setMessages] = useState<ThreadMessage[]>(() =>
    user?.id ? [] : redesignConversationMessages
  );
  const [draft, setDraft] = useState<string>('');
  const [isWaitingForReply, setIsWaitingForReply] = useState<boolean>(false);
  const composerInputRef = useRef<TextInput | null>(null);
  const flatListRef = useRef<FlatList<any> | null>(null);

  // Initialize offline send queue for authenticated user
  useEffect(() => {
    if (!user?.id) return;
    void loadSendQueue(user.id, 20);
  }, [user?.id]);

  // Safety watchdog: clear waiting indicator after 35s in case of degraded connection
  useEffect(() => {
    if (!isWaitingForReply) return;
    const timer = setTimeout(() => {
      setIsWaitingForReply(false);
    }, 35000);
    return () => clearTimeout(timer);
  }, [isWaitingForReply]);

  // Auto-scroll when loading indicator appears
  useEffect(() => {
    if (isWaitingForReply) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 60);
    }
  }, [isWaitingForReply]);

  // Fallback watchdog for assistant reply if Realtime websocket drops or lags
  const scheduleReplyWatchdog = useCallback((assistantMessageId: string) => {
    setTimeout(async () => {
      setMessages((current) => {
        if (current.some((m) => m.id === assistantMessageId)) return current;
        void fetchSingleMessage(assistantMessageId).then((replyMsg) => {
          if (replyMsg) {
            setIsWaitingForReply(false);
            setMessages((latest) => {
              if (latest.some((m) => m.id === replyMsg.id)) return latest;
              return [...latest, replyMsg];
            });
            setTimeout(() => {
              flatListRef.current?.scrollToEnd({ animated: true });
            }, 80);
          }
        });
        return current;
      });
    }, 2500);
  }, []);

  // Subscribe to live messages when authenticated
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    void fetchTodayMessages(user.id, planDate).then((fetched) => {
      if (cancelled) return;
      setMessages(fetched);
    });

    const unsubscribe = subscribeToUserMessages(user.id, (incoming) => {
      if (cancelled) return;
      if (incoming.role === 'davos') {
        setIsWaitingForReply(false);
      }
      setMessages((prev) => {
        const existingIdx = prev.findIndex(
          (m) =>
            m.id === incoming.id ||
            (m.role === incoming.role &&
              m.text === incoming.text &&
              m.sendState === 'sending')
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = incoming;
          return updated;
        }
        return [...prev, incoming];
      });
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.id, planDate]);

  // Action Zone Period Check-in Local Edit State
  const [isEditingReport, setIsEditingReport] = useState<boolean>(false);
  const [undoSeconds, setUndoSeconds] = useState<number>(0);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Urge Flow Modal State
  const [urgeModalVisible, setUrgeModalVisible] = useState<boolean>(false);
  const [urgeCountdownText, setUrgeCountdownText] = useState<string>('10:00');
  const urgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Plan editor visibility
  const [planEditorVisible, setPlanEditorVisible] = useState<boolean>(false);

  // Dynamic date divider label
  const chatDateLabel = useMemo(() => {
    const d = snapshot.now ? new Date(snapshot.now) : new Date();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    return `${weekday} · ${day} ${month}`;
  }, [snapshot.now]);

  // Focused beat derivation for cross-view alignment
  const focusedItem = useMemo(() => {
    if (!focusedBeatId) return null;
    const matchAnchor = planAnchors.find(
      (a) => a.id === focusedBeatId || a.title === focusedBeatId
    );
    if (matchAnchor) {
      return {
        title: matchAnchor.title,
        time: `${matchAnchor.start}–${matchAnchor.end}`,
      };
    }
    const matchActivity = activityEvents.find((a) => a.id === focusedBeatId);
    if (matchActivity) {
      return { title: matchActivity.title, time: matchActivity.time };
    }
    const matchBeat = snapshot.beats.find(
      (b) => b.planItem.id === focusedBeatId || b.planItem.text === focusedBeatId
    );
    if (matchBeat) {
      return { title: matchBeat.planItem.text, time: matchBeat.planItem.time };
    }
    return { title: 'Selected item', time: '' };
  }, [focusedBeatId, planAnchors, activityEvents, snapshot.beats]);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 2400);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
      if (urgeIntervalRef.current) clearInterval(urgeIntervalRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // Undo countdown tick
  useEffect(() => {
    if (undoSeconds > 0) {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
      undoIntervalRef.current = setInterval(() => {
        setUndoSeconds((prev) => {
          if (prev <= 1) {
            if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    }
  }, [undoSeconds]);

  // Urge hold timer tick
  useEffect(() => {
    if (activeUrge && activeUrge.stage === 'hold') {
      const updateTimer = () => {
        const remainingMs = Math.max(0, activeUrge.endsAt - Date.now());
        const totalSec = Math.ceil(remainingMs / 1000);
        const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const ss = String(totalSec % 60).padStart(2, '0');
        setUrgeCountdownText(`${mm}:${ss}`);

        if (totalSec === 0) {
          setActiveUrge((prev) =>
            prev ? { ...prev, stage: 'resolve' } : null
          );
          setUrgeModalVisible(true);
        }
      };

      updateTimer();
      urgeIntervalRef.current = setInterval(updateTimer, 1000);
      return () => {
        if (urgeIntervalRef.current) clearInterval(urgeIntervalRef.current);
      };
    }
  }, [activeUrge]);

  // 1. Submit Period Report Handler
  const handleSubmitReport = (text: string, energy: number) => {
    const wasEditing = isEditingReport;
    const isMissed = Boolean(activeCatchupWindow);
    const winTime = isMissed
      ? activeCatchupWindow!.windowTime
      : activeWindow?.windowTime ?? 'current window';
    const targetStartMs = isMissed ? activeCatchupWindow!.window.startMs : undefined;

    submitPeriodReport(text, energy, targetStartMs);
    setIsEditingReport(false);
    setUndoSeconds(wasEditing || isMissed ? 0 : 6);

    if (!user?.id) {
      void submitCheckIn(
        userId,
        `Period report ${winTime} (Energy ${energy}/10): ${text}`,
        targetStartMs ?? snapshot.now
      ).catch(() => {});
    }

    showToast(
      wasEditing
        ? 'The existing period report was updated.'
        : isMissed
        ? `Late report saved for ${winTime}.`
        : `Period report saved against ${winTime}.`
    );
  };

  // 2. Undo Report Handler
  const handleUndoReport = () => {
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    setUndoSeconds(0);
    setIsEditingReport(false);
    undoPeriodReport();
    showToast('Report submission undone.');
  };

  // 3. Edit Report Handler
  const handleEditReport = () => {
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    setUndoSeconds(0);
    setIsEditingReport(true);
  };

  const handleCancelReportEdit = () => {
    setIsEditingReport(false);
    showToast('Report edit discarded.');
  };

  // 4. Urge Flow Handlers
  const handleOpenUrgeModal = () => {
    setUrgeModalVisible(true);
  };

  const handleStartUrgeHold = (
    trigger: string,
    intensity: number | null
  ) => {
    startUrgeHold(trigger, intensity);
    setUrgeModalVisible(false);
    showToast('Urge logged. The 10-minute hold is active.');
  };

  const handleExtendUrgeHold = () => {
    extendUrgeHold();
    setUrgeModalVisible(false);
    showToast('Hold extended by 10 minutes.');
  };

  const handleResolveUrge = (outcome: 'held' | 'yielded') => {
    resolveUrge(outcome);
    setUrgeModalVisible(false);
    showToast(
      outcome === 'held'
        ? 'Urge recorded as resisted.'
        : 'Urge recorded as yielded.'
    );
  };

  // 5. Send Conversation Message Handler
  const handleSendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    const clientMessageId = makeClientMessageId();

    const newMsg: ThreadMessage = {
      id: clientMessageId,
      role: 'user',
      text: trimmed,
      time: timeStr,
      sendState: user?.id ? 'sending' : 'sent',
    };

    setMessages((prev) => [...prev, newMsg]);
    setDraft('');
    setIsWaitingForReply(true);
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 80);

    if (user?.id) {
      const res = await sendChatMessage(user.id, trimmed, clientMessageId);
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === clientMessageId ? { ...m, sendState: 'sent' } : m
          )
        );
        if (res.assistantMessageId) {
          scheduleReplyWatchdog(res.assistantMessageId);
        }
      } else {
        setIsWaitingForReply(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === clientMessageId ? { ...m, sendState: 'failed' } : m
          )
        );
        showToast('Message queued for retry.');
      }
    } else {
      setTimeout(() => {
        setIsWaitingForReply(false);
        const replyMsg: ThreadMessage = {
          id: `davos_reply_${Date.now()}`,
          role: 'davos',
          text: `Acknowledged: "${trimmed}". Let's stay anchored to your core priority today.`,
          time: timeStr,
          sendState: 'sent',
        };
        setMessages((prev) => [...prev, replyMsg]);
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 80);
      }, 1500);
    }
  };

  // 6. Retry Failed Message Handler
  const handleRetryMessage = async (failedMsg: ThreadMessage) => {
    if (!user?.id || failedMsg.sendState !== 'failed') return;
    setIsWaitingForReply(true);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === failedMsg.id ? { ...m, sendState: 'sending' } : m
      )
    );
    const res = await sendChatMessage(user.id, failedMsg.text, failedMsg.id);
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id ? { ...m, sendState: 'sent' } : m
        )
      );
      if (res.assistantMessageId) {
        scheduleReplyWatchdog(res.assistantMessageId);
      }
    } else {
      setIsWaitingForReply(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id ? { ...m, sendState: 'failed' } : m
        )
      );
      showToast('Message queued for retry.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      {/* Contextual Focus Banner when an anchor is selected in Today */}
      {focusedItem && (
        <View
          style={[
            styles.focusBanner,
            {
              backgroundColor: colors.surfaceSubtle,
              borderBottomColor: colors.borderSubtle,
            },
          ]}>
          <Text
            style={[
              styles.focusBannerText,
              typeRoles.meta,
              { color: colors.textSecondary },
            ]}
            allowFontScaling={true}>
            Focusing {focusedItem.time ? `${focusedItem.time} · ` : ''}
            {focusedItem.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear beat focus"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={styles.clearFocusBtn}
            onPress={() => setFocusedBeatId(null)}>
            <Text
              style={[
                styles.clearFocusText,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}>
              Clear ✕
            </Text>
          </Pressable>
        </View>
      )}

      {/* 1. Pure Conversation Stream */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.conversationContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyConversation}>
            <Text
              style={[
                styles.emptyConversationText,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              No messages yet today. Davos speaks first at your scheduled check-in.
            </Text>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.dateDivider}>
            <Text
              style={[
                styles.dateDividerText,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              {chatDateLabel}
            </Text>
            <View
              style={[
                styles.dividerLine,
                { backgroundColor: colors.borderSubtle },
              ]}
            />
          </View>
        }
        renderItem={({ item: msg }) => (
          <View
            style={[
              styles.messageItem,
              { borderBottomColor: colors.borderSubtle },
            ]}>
            <View style={styles.messageContent}>
              <View style={styles.messageMeta}>
                <Text
                  style={[
                    styles.speakerName,
                    typeRoles.meta,
                    {
                      color:
                        msg.role === 'davos'
                          ? colors.textPrimary
                          : colors.textSecondary,
                      fontWeight: '700',
                    },
                  ]}
                  allowFontScaling={true}>
                  {msg.role === 'davos'
                    ? (msg as any).metadata?.source === 'anchor_plan'
                      ? 'DAVOS · ANCHOR PLAN'
                      : 'DAVOS'
                    : 'YOU'}
                </Text>
                <Text
                  style={[
                    styles.messageTime,
                    typeRoles.figure,
                    { color: colors.textTertiary },
                  ]}
                  allowFontScaling={true}>
                  {msg.time}
                </Text>
              </View>
              <Text
                style={[
                  styles.messageText,
                  msg.role === 'davos'
                    ? typeRoles.davosVoice
                    : typeRoles.userText,
                  {
                    color:
                      msg.role === 'davos'
                        ? colors.textPrimary
                        : colors.textSecondary,
                  },
                ]}
                allowFontScaling={true}>
                {msg.text}
              </Text>
              {msg.sendState === 'failed' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry sending message"
                  style={styles.retryAffordance}
                  onPress={() => handleRetryMessage(msg)}>
                  <Text
                    style={[
                      styles.retryText,
                      typeRoles.meta,
                      { color: colors.danger, fontWeight: '600' },
                    ]}
                    allowFontScaling={true}>
                    Failed to send · Tap to retry
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={{ paddingTop: spacing.xs, paddingBottom: spacing.sm }}>
            {isWaitingForReply && <DavosThinking />}
          </View>
        }
      />

      {/* 2. Catch-up Strip for unlogged past periods */}
      {!isCatchupStripDismissed && missedWindows.length > 0 && (
        <CatchupStrip
          missedWindows={missedWindows}
          activeWindowTime={activeCatchupWindow?.windowTime}
          onSelectWindow={(win) => setActiveCatchupWindow(win)}
          onDismiss={dismissCatchupStrip}
        />
      )}

      {/* 3. Action Zone (Current Cadence Period Check-in or Active Missed Catch-up Window) */}
      {activeCatchupWindow ? (
        <ActionZone
          windowTime={activeCatchupWindow.windowTime}
          submitByTime="LATE REPORT"
          savedReport={savedReport}
          undoSecondsRemaining={undoSeconds}
          isEditing={isEditingReport}
          isMissed={true}
          onDismiss={() => setActiveCatchupWindow(null)}
          onSubmit={handleSubmitReport}
          onUndo={handleUndoReport}
          onEdit={handleEditReport}
          onCancelEdit={handleCancelReportEdit}
        />
      ) : activeWindow ? (
        <ActionZone
          windowTime={activeWindow.windowTime}
          submitByTime={activeWindow.submitByTime}
          savedReport={savedReport}
          undoSecondsRemaining={undoSeconds}
          isEditing={isEditingReport}
          onSubmit={handleSubmitReport}
          onUndo={handleUndoReport}
          onEdit={handleEditReport}
          onCancelEdit={handleCancelReportEdit}
        />
      ) : null}

      {/* 3. Evening Journal Quick Action */}
      <View style={[styles.journalBar, { borderTopColor: colors.borderSubtle }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open evening journal"
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle }}
          style={({ pressed }) => [
            styles.journalBarBtn,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => {
            void hapticSelection();
            router.push('/journal');
          }}>
          <Text
            style={[styles.journalBarText, typeRoles.meta, { color: colors.accent }]}
            allowFontScaling={true}>
            ✎ Evening Journal & Overnight Plan
          </Text>
        </Pressable>
      </View>

      {/* 4. Sticky Urge Banner (Visible when hold is running) */}
      <UrgeBanner
        visible={Boolean(activeUrge)}
        title={
          activeUrge?.stage === 'resolve'
            ? 'Urge hold complete'
            : 'Urge hold active'
        }
        trigger={activeUrge?.trigger || ''}
        countdown={urgeCountdownText}
        onOpen={handleOpenUrgeModal}
      />

      {/* 4. Composer at Bottom */}
      <Composer
        inputRef={composerInputRef}
        value={draft}
        onChangeText={setDraft}
        onSend={handleSendMessage}
        onUrge={handleOpenUrgeModal}
        isUrgeActive={Boolean(activeUrge)}
        placeholder="Talk to Davos…"
      />

      {/* 5. Modals and Overlays */}
      <UrgeModal
        visible={urgeModalVisible}
        stage={activeUrge ? activeUrge.stage : 'log'}
        trigger={activeUrge?.trigger || ''}
        intensity={activeUrge?.intensity || null}
        countdown={urgeCountdownText}
        onClose={() => setUrgeModalVisible(false)}
        onStartHold={handleStartUrgeHold}
        onExtendHold={handleExtendUrgeHold}
        onResolve={handleResolveUrge}
      />

      <PlanEditorModal
        visible={planEditorVisible}
        initialAnchors={planAnchors}
        onClose={() => setPlanEditorVisible(false)}
        onSave={(updated) => {
          if (savePlan) {
            void savePlan(updated);
          } else {
            setPlanAnchors(updated);
          }
          setPlanEditorVisible(false);
          showToast('Planned anchors updated. Period reports were not changed.');
        }}
      />

      <Toast message={toastMessage} visible={toastVisible} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    flexDirection: 'column',
  },
  conversationContent: {
    paddingHorizontal: spacing.md,
    paddingTop: 24,
    paddingBottom: 16,
    flexGrow: 1,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 22,
  },
  dateDividerText: {
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  messageItem: {
    marginBottom: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  messageContent: {
    width: '100%',
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
    marginBottom: 5,
  },
  speakerName: {
    fontSize: 11,
    letterSpacing: 0.8,
  },
  messageTime: {
    fontSize: 10,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  focusBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
  },
  focusBannerText: {
    fontSize: 10,
    flex: 1,
  },
  clearFocusBtn: {
    minHeight: 32,
    justifyContent: 'center',
    paddingLeft: spacing.xs,
  },
  clearFocusText: {
    fontSize: 10,
  },
  emptyConversation: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyConversationText: {
    fontSize: 11,
    textAlign: 'center',
  },
  journalBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journalBarBtn: {
    minHeight: 36,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journalBarText: {
    fontSize: 12,
    fontWeight: '500',
  },
  retryAffordance: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  retryText: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
