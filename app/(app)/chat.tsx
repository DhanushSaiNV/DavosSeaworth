// app/(app)/chat.tsx
// Screen S1 (Talk) — Conversation Stream and Action Zone (Redesign Mockup).
// Pure RN primitives only (FlatList, View, Text, Pressable, TextInput, Modal).
// Tokens via useTheme. Zero raw hex codes.

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { typography } from '../../theme/tokens/typography';
import {
  redesignConversationMessages,
  redesignPlanAnchors,
  redesignActivityEvents,
  redesignTrackerState,
  type ThreadMessage,
} from '../../fixtures/davos';
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
import { UrgeBanner } from '../../components/davos/UrgeBanner';
import { UrgeModal } from '../../components/davos/UrgeModal';
import { PlanEditorModal } from '../../components/davos/PlanEditorModal';
import { Composer } from '../../components/davos/Composer';
import { Toast } from '../../components/davos/Toast';

export default function ChatScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? 'user_dev';
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  const { snapshot } = useDayContext();

  // Conversation stream messages
  const [messages, setMessages] = useState<ThreadMessage[]>(
    redesignConversationMessages
  );
  const [draft, setDraft] = useState<string>('');
  const composerInputRef = useRef<TextInput | null>(null);
  const flatListRef = useRef<FlatList<any> | null>(null);

  // Action Zone Period Check-in State
  const [savedReport, setSavedReport] = useState<{
    text: string;
    energy: number;
    submittedAt?: string;
  } | null>(null);
  const [isEditingReport, setIsEditingReport] = useState<boolean>(false);
  const [undoSeconds, setUndoSeconds] = useState<number>(0);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Urge Flow State
  const [activeUrge, setActiveUrge] = useState<UrgeState | null>(null);
  const [urgeModalVisible, setUrgeModalVisible] = useState<boolean>(false);
  const [urgeCountdownText, setUrgeCountdownText] = useState<string>('10:00');
  const urgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shared Plan & Activity State
  const [planAnchors, setPlanAnchors] =
    useState<PlanAnchor[]>(redesignPlanAnchors);
  const [activityEvents, setActivityEvents] = useState<ActivityItem[]>(
    redesignActivityEvents
  );
  const [tracker, setTracker] = useState<TrackerState>(redesignTrackerState);
  const [planEditorVisible, setPlanEditorVisible] = useState<boolean>(false);

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
    setSavedReport({ text, energy, submittedAt: '18:04' });
    setIsEditingReport(false);
    setUndoSeconds(wasEditing ? 0 : 6);

    // Update Today Tracker
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

    // Update Deep Work Anchor in Plan
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

    // Add activity record
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

    void submitCheckIn(
      userId,
      `Period report 17:00–18:00 (Energy ${energy}/10): ${text}`,
      snapshot.now
    ).catch(() => {});

    showToast(
      wasEditing
        ? 'The existing period report was updated.'
        : 'Period report saved against the 17:00 window.'
    );
  };

  // 2. Undo Report Handler
  const handleUndoReport = () => {
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    setUndoSeconds(0);
    setSavedReport(null);
    setIsEditingReport(false);

    // Restore tracker
    setTracker(redesignTrackerState);

    // Restore Deep Work anchor
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

    // Remove activity record
    setActivityEvents((prev) =>
      prev.filter((item) => item.id !== 'report-current')
    );

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
    const startedAt = Date.now();
    const endsAt = startedAt + 600000;
    setActiveUrge({
      trigger,
      intensity,
      startedAt,
      endsAt,
      stage: 'hold',
    });
    setUrgeModalVisible(false);
    void logImpulse('app');
    showToast('Urge logged. The 10-minute hold is active.');
  };

  const handleExtendUrgeHold = () => {
    if (!activeUrge) return;
    setActiveUrge({
      ...activeUrge,
      endsAt: Date.now() + 600000,
      stage: 'hold',
    });
    setUrgeModalVisible(false);
    showToast('Hold extended by 10 minutes.');
  };

  const handleResolveUrge = (outcome: 'held' | 'yielded') => {
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
    setUrgeModalVisible(false);
    showToast(
      outcome === 'held'
        ? 'Urge recorded as resisted.'
        : 'Urge recorded as yielded.'
    );
  };

  // 5. Send Conversation Message Handler
  const handleSendMessage = (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    const newMsg: ThreadMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      text: trimmed,
      time: '18:04',
      sendState: 'sent',
    };

    setMessages((prev) => [...prev, newMsg]);
    setDraft('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 80);

    showToast('Message added to conversation.');
  };

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      {/* 1. Pure Conversation Stream */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.conversationContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.dateDivider}>
            <Text
              style={[
                styles.dateDividerText,
                typography.mono,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              Wednesday · 04 November
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
            <View
              style={[
                styles.speakerMark,
                { borderColor: colors.border },
              ]}>
              <Text
                style={[
                  styles.speakerMarkText,
                  typography.mono,
                  { color: colors.textSecondary },
                ]}>
                {msg.role === 'davos' ? 'D' : 'U'}
              </Text>
            </View>
            <View style={styles.messageContent}>
              <View style={styles.messageMeta}>
                <Text
                  style={[
                    styles.speakerName,
                    typography.mono,
                    { color: colors.textPrimary },
                  ]}
                  allowFontScaling={true}>
                  {msg.role === 'davos' ? 'DAVOS' : 'YOU'}
                </Text>
                <Text
                  style={[
                    styles.messageTime,
                    typography.mono,
                    { color: colors.textTertiary },
                  ]}
                  allowFontScaling={true}>
                  {msg.time}
                </Text>
              </View>
              <Text
                style={[
                  styles.messageText,
                  typeRoles.userText,
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
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.transcriptNote}>
            <View
              style={[
                styles.transcriptNoteBar,
                { backgroundColor: colors.border },
              ]}
            />
            <Text
              style={[
                styles.transcriptNoteText,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              Messages only · period reports and plan assessments are kept in
              Today.
            </Text>
          </View>
        }
      />

      {/* 2. Action Zone (Current Cadence Period Check-in) */}
      <ActionZone
        windowTime="17:00–18:00"
        submitByTime="SUBMIT BY 18:10"
        savedReport={savedReport}
        undoSecondsRemaining={undoSeconds}
        isEditing={isEditingReport}
        onSubmit={handleSubmitReport}
        onUndo={handleUndoReport}
        onEdit={handleEditReport}
        onCancelEdit={handleCancelReportEdit}
      />

      {/* 3. Sticky Urge Banner (Visible when hold is running) */}
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
          setPlanAnchors(updated);
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  speakerMark: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  speakerMarkText: {
    fontSize: 10,
  },
  messageContent: {
    flex: 1,
    minWidth: 0,
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
    marginBottom: 5,
  },
  speakerName: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  messageTime: {
    fontSize: 10,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  transcriptNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    marginLeft: 39,
  },
  transcriptNoteBar: {
    width: 15,
    height: 1,
  },
  transcriptNoteText: {
    fontSize: 10,
    lineHeight: 14,
  },
});
