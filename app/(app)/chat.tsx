import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../../theme';
import { LoadingDot, LoadingMark } from '../../components/ui';
import {
  INITIAL_METRIC_CHIP_STATE,
  ONBOARDING_STEPS,
  canConfirmMetric,
  metricChipReducer,
  metricChoiceLabels,
  onboardingStageFromRows,
  onboardingStepIndex,
  onboardingStepLabel,
  type MetricChipState,
  type OnboardingStage,
} from '../../lib/onboarding';
import { readOnboardingStage } from '../../lib/onboardingStage';
import { BRAND_AMBER, BrandMark } from '../../components/brand';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { loadConfig, requireConfigBoolean, requireConfigNumber, useConfig } from '../../lib/config';
import { devForcePayload, useDevOverrides } from '../../lib/devOverrides';
import { makeClientMessageId } from '../../lib/ids';
import { configureNotificationHandler } from '../../lib/push';
import { hapticSelection, hapticImpactLight } from '../../lib/haptics';
import {
  dueItems,
  enqueueSend,
  getSendQueue,
  loadSendQueue,
  markQueueAttempt,
  removeSend,
  useSendQueue,
  type QueueReason,
} from '../../lib/sendQueue';
import {
  buildChatItems,
  classifyError,
  errorStatus,
  mergeRows,
  nextRetryAt,
  pruneResolvedPending,
  retryDelayFor,
  type ChatError,
  type ChatItem,
  type Message,
  type PendingSend,
} from '../../lib/chat';
import {
  armCheckins,
  flushCheckins,
  getGrid,
  getLastCheckInResponseAt,
  onGridLoaded,
  syncDeviceTimezone,
  takePendingTapWindowTs,
  utcToLocalLabel,
} from '../../lib/checkins';
import {
  ENERGY_VALUES,
  energyEmoji,
  energyLabel,
  resolveCheckInWindowTs,
  shouldShowCheckinBanner,
} from '../../lib/checkinUi';
import { currentOpenWindow } from '../../lib/checkinGrid';
import { checkinQueue } from '../../lib/checkinQueue';
import { logger } from '../../lib/logger';
import {
  beginFlag,
  canMarkUnsavable,
  flagErrorFor,
  flagFailed,
  flagPayload,
  flagSucceeded,
  IDLE_FLAG,
  isFlagBusy,
  showsUnsavableMarker,
  type FlagState,
} from '../../lib/memoryFlag';
import { acceptOutcome, questCardFor, type QuestCardAction } from '../../lib/questCard';
import { getActiveOathRequestId, oathCardsForRows, type OathCard } from '../../lib/oathCard';
import { traceNetworkCall } from '../../lib/observability';
import { logImpulse } from '../../lib/impulse';
import {
  impulseAckText,
  impulseButtonDisabled,
  impulseButtonLabel,
  nextImpulseState,
  type ImpulseState,
} from '../../lib/impulseButton';

/** [SPEC] values read from `config`, never hardcoded (AGENTS.md §2). */
interface ChatLimits {
  maxChars: number;
  sendTimeoutMs: number;
  watchdogMs: number;
  retryHoldoffMs: number;
  lastN: number;
  /** `chat_queue_max_items` — cap on the device offline queue (Step 9). */
  queueMaxItems: number;
}

/** Where a send came from: the composer (text only in memory) or the device queue. */
type SendOrigin = 'composer' | 'queue';

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString();
}

export interface ChatScreenProps {
  /** `app` is the tab-shell thread; `interview` hides app-only surfaces (FP-09 FR-9). */
  mode?: 'app' | 'interview';
  /** Interview only: called once the profile stage is `complete`. */
  onComplete?: () => void;
}

export function ChatScreen({ mode = 'app', onComplete }: ChatScreenProps = {}) {
  const isInterview = mode === 'interview';
  const { user } = useAuth();
  const config = useConfig();
  const devOverrides = useDevOverrides();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { colors, isDark } = theme;
  const styles = useMemo(() => getChatStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [rows, setRows] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [composerFocused, setComposerFocused] = useState(false);
  const [sendHovered, setSendHovered] = useState(false);
  const [banner, setBanner] = useState<ChatError | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Option-message id → persona key, while a chip tap is in flight (chips disabled). */
  const [selectingChip, setSelectingChip] = useState<Record<string, string>>({});
  /** Interview only: the profile stage, with the row stamp as the offline fallback. */
  const [stage, setStage] = useState<OnboardingStage | null>(null);
  /** Metric chip state per assistant option row (FP-09 FR-8). */
  const [metricChips, setMetricChips] = useState<Record<string, MetricChipState>>({});

  // FP-08 Step 6 (FR-17): the Side Quest card's tap state, keyed by the offer row id. The
  // persisted accepted/declined state comes from the row metadata; this only carries the
  // in-flight tap and its result until the refetch lands.
  const [questActions, setQuestActions] = useState<Record<string, QuestCardAction>>({});
  const questBusyRef = useRef<Set<string>>(new Set());

  // FP-06 flag affordance (FR-14): one attempt at a time per screen; the marker itself
  // comes from the row column, never from this state.
  const [flag, setFlag] = useState<FlagState>(IDLE_FLAG);
  /** Which bubble's long-press menu is open, by server row id. */
  const [flagMenuFor, setFlagMenuFor] = useState<string | null>(null);
  /** Single-flight gate: a state update alone cannot stop a same-tick double tap. */
  const flagBusyRef = useRef(false);

  // Check-in mode state (Step 5; FR-4, FR-9, FR-14)
  // Oath Confirm Affordance (D26, FP-08 FR-10)
  const [oathConfirming, setOathConfirming] = useState(false);

  // Check-in mode state (Step 5; FR-4, FR-9, FR-14)
  const [checkInMode, setCheckInMode] = useState(false);
  const [checkInWindowTs, setCheckInWindowTs] = useState<number | null>(null);
  /** A transient note for a check-in handed to the pending store (offline). */
  const [checkInNote, setCheckInNote] = useState<string | null>(null);
  /** The doing awaiting an energy tap (FR-14); null once energy is known or not offered. */
  const [energyDoingId, setEnergyDoingId] = useState<string | null>(null);
  const [energyBusy, setEnergyBusy] = useState(false);
  const [energySettled, setEnergySettled] = useState<number | null>(null);
  const [energyError, setEnergyError] = useState<string | null>(null);
  /** The last window answered, for the web banner route (FR-4). */
  const [lastAnsweredMs, setLastAnsweredMs] = useState<number | null>(null);
  /** FR-20's in-app impulse button. */
  const [impulseState, setImpulseState] = useState<ImpulseState>('idle');

  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(now)),
    [now],
  );

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
  /** The thread list's height at its last layout, to detect a keyboard-driven shrink. */
  const listHeightRef = useRef(0);
  /** True while the reader is on the newest message, so a shrink may re-pin the bottom. */
  const followBottomRef = useRef(true);
  /**
   * The keyboard shrinks the thread list through KeyboardAvoidingView's padding, which
   * moves the composer up but leaves the list's scroll offset where it was. Follow the
   * raised bottom edge so the newest message rises with the composer - unless the reader
   * had deliberately scrolled back into history.
   */
  const onThreadLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    const previousHeight = listHeightRef.current;
    listHeightRef.current = nextHeight;
    if (previousHeight > 0 && nextHeight < previousHeight && followBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

  const onThreadScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    followBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
  }, []);

  /** The thread's content height at its last measure, to tell growth from re-measure. */
  const contentHeightRef = useRef(0);
  /**
   * Pin the newest message only when the thread actually grew (a message arrived or was
   * sent) and the reader is following the bottom. Android re-measures cells while the
   * user scrolls, which fires this callback without new content - scrolling to the end
   * on every call would drag the reader back down mid-scroll.
   */
  const onThreadContentSizeChange = useCallback((_width: number, height: number) => {
    const previousHeight = contentHeightRef.current;
    contentHeightRef.current = height;
    const firstMeasure = previousHeight === 0;
    if (!firstMeasure && !(height > previousHeight && followBottomRef.current)) return;
    listRef.current?.scrollToEnd({ animated: !firstMeasure });
  }, []);
  /**
   * Consecutive Realtime transport failures with no intervening `SUBSCRIBED`. One is
   * routine on mobile (a socket drop reports for every joined channel); a run of them
   * means the subscription is not healing and the thread is going stale — which looks
   * identical in the log otherwise.
   */
  const channelErrorCountRef = useRef(0);
  /**
   * NetInfo's link state. `true` is only a hint — the request can still fail (captive
   * portal, dead server, no DNS), and every failed send is queued regardless. `false` is
   * treated as authoritative: nothing was transmitted, so the message is queued as
   * `offline` and replayed the moment the link returns, with no holdoff.
   */
  const offlineRef = useRef(false);
  /** Guards the replay walk so two triggers can never run it concurrently. */
  const flushingRef = useRef(false);
  /** The current replay walk, for the NetInfo listener (which is bound once). */
  const flushRef = useRef<(() => void) | null>(null);
  /**
   * Check-in sends, keyed by `client_message_id`. A check-in must be re-sent to
   * `submit-checkin` with its original window (FR-4), so the window travels with the attempt
   * rather than being re-derived from the clock at retry time.
   */
  const checkInWindowsRef = useRef<Map<string, number>>(new Map());

  /**
   * The device offline queue (Step 9, FR-16). Source of truth for every message the server
   * has not acknowledged, so an offline tap survives both a failed request and an app kill.
   */
  const queued = useSendQueue();

  const limits = useMemo<ChatLimits | null>(() => {
    if (config.status !== 'loaded') return null;
    try {
      return {
        maxChars: requireConfigNumber('chat_max_message_chars'),
        sendTimeoutMs: requireConfigNumber('chat_send_timeout_ms'),
        watchdogMs: requireConfigNumber('chat_realtime_watchdog_ms'),
        retryHoldoffMs: requireConfigNumber('chat_retry_holdoff_ms'),
        lastN: requireConfigNumber('chat_last_n'),
        queueMaxItems: requireConfigNumber('chat_queue_max_items'),
      };
    } catch (err) {
      // Fail closed: no defaults, composer stays disabled, banner shows the reason.
      logger.error('chat', 'config error', undefined, err);
      return null;
    }
  }, [config.status]);

  // Config failed, or is missing a key: there is nothing safe to fetch. Render the screen
  // so the banner (with Retry) is visible instead of leaving a permanent spinner.
  const configBlocked =
    config.status === 'error' || (config.status === 'loaded' && !limits);

  /**
   * Dev-only forcer (Step 6): both gates must be open — a dev build and the runtime
   * `dev_overrides_enabled` flag. The server re-checks the flag itself, so this is
   * convenience, never enforcement. Fail closed on a missing or mistyped key.
   */
  const devEnabled = useMemo(() => {
    if (!__DEV__ || config.status !== 'loaded') return false;
    try {
      return requireConfigBoolean('dev_overrides_enabled');
    } catch (err) {
      logger.warn('chat', 'dev_overrides_enabled unavailable', undefined, err);
      return false;
    }
  }, [config.status]);

  /**
   * Configure Expo notification handler for foreground suppression (Step 7).
   * When the chat screen is focused, suppress the OS notification banner/sound/badge.
   * The message arrives via Realtime instead (TECH-SPECS §7.10).
   * Uses `useFocusEffect` so other tabs (chat still mounted) still receive banners.
   */
  const userId = user?.id ?? null;

  useFocusEffect(
    useCallback(() => {
      configureNotificationHandler(() => true);
      // Returning to the chat tab (or a change of signed-in user) drains both stores: the offline
      // chat queue and the check-in pending store (the §7.10 "focus" trigger). `userId` is a
      // dependency, so the effect re-runs on sign-in and never reads a stale id. Intake has no
      // check-in surface, so it drains only the chat queue.
      flushRef.current?.();
      if (!isInterview && userId) void flushCheckins(userId);
      return () => configureNotificationHandler(() => false);
    }, [isInterview, userId]),
  );

  // FP-09 FR-9: the interview's device-TZ sync. The `(app)` shell (and its scheduler) never
  // mounts during intake, so this is the only place `profiles.timezone` gets the device zone.
  useEffect(() => {
    if (!isInterview || !userId) return;
    void syncDeviceTimezone(userId).catch((err) =>
      logger.warn('checkin', 'interview timezone sync failed', undefined, err),
    );
  }, [isInterview, userId]);

  // FP-09 FR-9/FR-10: a focus-time profile re-read catches completion (a `select-metrics`
  // response on another surface, or a resume after the response was lost) and feeds the
  // five-step indicator. A read failure keeps the row-derived stage and never blocks the thread.
  useFocusEffect(
    useCallback(() => {
      if (!isInterview || !userId) return;
      let cancelled = false;
      void (async () => {
        try {
          const next = await readOnboardingStage(userId);
          if (cancelled) return;
          setStage(next);
          if (next === 'complete') onComplete?.();
        } catch (err) {
          logger.warn('chat', 'interview stage read failed', undefined, err);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [isInterview, userId, onComplete]),
  );

  // The cached grid resolves *after* this screen's first render, so the banner would otherwise
  // wait for its next clock tick to notice. Refreshing `now` re-evaluates the banner memo as soon
  // as the grid lands (§7.1).
  useEffect(() => onGridLoaded(() => setNow(Date.now())), []);

  // Deep-link / query params: `focus=checkin` opens the composer in check-in mode (FR-4). The
  // notification's link carries the window (`&windowTs=`); a link that lost it falls back to the
  // notification response, consumed **once** so a double-invoked effect cannot re-read it and
  // resolve a different window.
  const params = useLocalSearchParams<{ focus?: string; windowTs?: string }>();
  const focusParam = params.focus;
  const windowTsParam = params.windowTs;
  const consumedTapWindowRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (isInterview || focusParam !== 'checkin' || !userId) return;
    const fromParam =
      windowTsParam !== undefined && windowTsParam !== '' ? Number(windowTsParam) : Number.NaN;
    let payloadWindowTs: number | null;
    if (Number.isFinite(fromParam)) {
      payloadWindowTs = fromParam;
    } else {
      if (consumedTapWindowRef.current === undefined) {
        consumedTapWindowRef.current = takePendingTapWindowTs();
      }
      payloadWindowTs = consumedTapWindowRef.current ?? null;
    }
    const windowTs = resolveCheckInWindowTs({
      payloadWindowTs,
      grid: getGrid(),
      nowMs: Date.now(),
      userId,
    });
    if (windowTs === null) return; // nothing to answer — stay in normal chat
    setCheckInNote(null);
    setCheckInWindowTs(windowTs);
    setCheckInMode(true);
  }, [isInterview, focusParam, windowTsParam, userId]);

  // A tap that cold-started the process arrives with no route link of its own: Expo hands it
  // back as the launch response, and `lib/checkins.ts` records that window (it cannot navigate
  // before the router exists). Nothing changes the params for the effect above to watch, so
  // consume the recorded window once on mount and open check-in mode anyway (FR-2, FR-4).
  // Runs *after* the param effect, which owns the value whenever the link did arrive.
  useEffect(() => {
    if (isInterview || !userId || focusParam === 'checkin') return;
    if (consumedTapWindowRef.current !== undefined) return; // already consumed this mount
    const pending = takePendingTapWindowTs();
    consumedTapWindowRef.current = pending;
    if (pending === null) return;
    const windowTs = resolveCheckInWindowTs({
      payloadWindowTs: pending,
      grid: getGrid(),
      nowMs: Date.now(),
      userId,
    });
    if (windowTs === null) return; // nothing to answer — stay in normal chat
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setCheckInNote(null);
      setCheckInWindowTs(windowTs);
      setCheckInMode(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isInterview, focusParam, userId]);

  // FR-14: on chat open, the newest doing still missing energy offers the chips. Own rows only,
  // through the table's RLS policy — no API surface change.
  useEffect(() => {
    if (isInterview || !userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('doings_logs')
          .select('id')
          .eq('user_id', userId)
          .eq('kind', 'doing')
          .is('energy', null)
          .in('source', ['checkin_reply', 'chat'])
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) {
          logger.warn('chat', 'null-energy doing lookup failed', { error: error.message });
          return;
        }
        const row = (data ?? [])[0] as { id: string } | undefined;
        if (!cancelled && row) setEnergyDoingId((prev) => prev ?? row.id);
      } catch (err) {
        logger.warn('chat', 'null-energy doing lookup threw', undefined, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isInterview, userId]);

  // Whether this window is answered lives in the pending store (FR-4, client-local state).
  useEffect(() => {
    if (isInterview || !userId) return;
    let cancelled = false;
    void (async () => {
      const at = await getLastCheckInResponseAt(userId);
      if (!cancelled) setLastAnsweredMs(at);
    })();
    return () => {
      cancelled = true;
    };
  }, [isInterview, userId]);

  // The banner's visibility is a function of the clock; a local tick keeps it current with no
  // network traffic at all. Native has no banner — the OS notification is its surface.
  useEffect(() => {
    if (isInterview || Platform.OS !== 'web') return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isInterview]);

  const fetchMessages = useCallback(async () => {
    // The page size is a [SPEC] value; the subscription effect re-runs once it resolves.
    if (!user || !limits) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', user.id)
        // Newest first, then ordered ascending for render. (The pre-5b query took the
        // OLDEST 50, so a long thread silently dropped the newest messages.)
        .order('created_at', { ascending: false })
        .limit(limits.lastN);

      if (error) {
        logger.error('chat', 'fetch failed', { error: error.message });
        return;
      }

      setRows(mergeRows([], (data ?? []) as Message[]));
    } catch (err) {
      logger.error('chat', 'fetch threw', undefined, err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, limits]);

  /**
   * FR-17: the card's accept/decline tap. `accept-quest` owns the atomic consume and the
   * metric write; the client only renders the response. The invoke is traced (AGENTS.md §7.8)
   * and the screen never logs raw console output.
   */
  const onQuestAnswer = useCallback(async (messageId: string, accepted: boolean) => {
    if (questBusyRef.current.has(messageId)) return;
    questBusyRef.current.add(messageId);
    setQuestActions((prev) => ({ ...prev, [messageId]: { pending: true } }));
    try {
      const invoked = await traceNetworkCall('chat', 'accept-quest', () =>
        supabase.functions.invoke('accept-quest', {
          body: { message_id: messageId, accepted },
        }),
      );
      let body: unknown = invoked.data;
      let status: number | undefined;
      if (invoked.error) {
        const context = (invoked.error as { context?: Response }).context;
        status = context?.status;
        if (context) {
          try {
            body = await context.json();
          } catch {
            // Keep the invoke's own data; the outcome mapper falls back to error.
          }
        }
        logger.warn('chat', 'accept-quest returned an error', {
          status: status ?? null,
          message: invoked.error.message,
        });
      } else {
        status = 200;
      }
      const outcome = acceptOutcome(status, body);
      setQuestActions((prev) => ({
        ...prev,
        [messageId]: {
          result: outcome.state,
          metricId: outcome.metricId,
          error: outcome.error,
        },
      }));
      if (!invoked.error || outcome.state === 'accepted' || outcome.state === 'declined') {
        void fetchMessages();
      }
    } catch (err) {
      logger.error('chat', 'accept-quest threw', undefined, err);
      setQuestActions((prev) => ({
        ...prev,
        [messageId]: { result: 'error', error: 'Could not reach the server. Try again.' },
      }));
    } finally {
      questBusyRef.current.delete(messageId);
    }
  }, [fetchMessages]);

  /** The offer rows' cards, keyed by message id (persisted state + the local tap result). */
  const questCards = useMemo(() => {
    const cards = new Map<string, NonNullable<ReturnType<typeof questCardFor>>>();
    for (const row of rows) {
      if (row.role !== 'assistant') continue;
      const card = questCardFor(row.metadata, questActions[row.id]);
      if (card) cards.set(row.id, card);
    }
    return cards;
  }, [rows, questActions]);

  /** Oath cards, keyed by assistant message id (D26 confirm affordance). */
  const oathCards = useMemo(() => oathCardsForRows(rows), [rows]);
  /** Active unconsumed oath request ID at the tail of the thread (thread position rule). */
  const activeOathRequestId = useMemo(() => getActiveOathRequestId(rows), [rows]);

  useEffect(() => {
    if (!activeOathRequestId && oathConfirming) {
      setOathConfirming(false);
    }
  }, [activeOathRequestId, oathConfirming]);

  // Subscribe to Realtime inserts.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`messages:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setRows((prev) => mergeRows(prev, [incoming]));
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          channelErrorCountRef.current = 0;
          // First connect, and every rejoin after a socket drop: reconcile from the server.
          void fetchMessages();
          // A live socket means real connectivity: replay anything the queue is holding.
          // `flushQueue` is read through a ref so this subscription is bound once.
          flushRef.current?.();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // A dropped WebSocket (network flap, backgrounding, lapsed heartbeat) reports
          // here for *every* joined channel — it is a transport event, not a subscription
          // failure. Both layers rejoin on their own: the realtime client reconnects the
          // socket, and the phoenix channel reschedules its join after a join timeout
          // (`@supabase/phoenix` `joinPush.receive('timeout')` → `rejoinTimer`), which
          // `@supabase/realtime-js` surfaces as `TIMED_OUT`. So this is expected on mobile
          // and self-healing: warn with the underlying reason, then reconcile.
          // `err.cause` carries the raw CloseEvent/Event (see `normalizeChannelError`).
          const failures = (channelErrorCountRef.current += 1);
          if (failures >= 3) {
            // Not healing. A permanently broken subscription (publication or RLS
            // regression) is invisible otherwise, so escalate above the routine warning.
            logger.error(
              'chat',
              `Realtime ${status} x${failures} with no successful rejoin — the subscription is not recovering; check the publication/RLS`,
              { status, failures, reason: err?.message, cause: (err as { cause?: unknown } | undefined)?.cause }
            );
          } else {
            logger.warn(
              'chat',
              `Realtime ${status === 'TIMED_OUT' ? 'join timeout' : 'socket dropped'}`,
              { status, failures, reason: err?.message, cause: (err as { cause?: unknown } | undefined)?.cause }
            );
          }
          void fetchMessages();
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, fetchMessages]);

  // Reconcile when the app returns to the foreground, and replay the offline queue: coming
  // back from the background is when a phone most often has a network again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void fetchMessages();
      flushRef.current?.();
    });
    return () => subscription.remove();
  }, [fetchMessages]);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => clearWatchdog, [clearWatchdog]);

  /**
   * Realtime usually delivers the assistant row in well under a second. If it has not
   * arrived after `chat_realtime_watchdog_ms`, fetch it directly rather than leaving the
   * "thinking" indicator up forever.
   */
  const scheduleWatchdog = useCallback(
    (assistantMessageId: string, waitMs: number) => {
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        void (async () => {
          try {
            const { data, error } = await supabase
              .from('messages')
              .select('*')
              .eq('id', assistantMessageId)
              .maybeSingle();
            if (error) {
              logger.warn('chat', 'watchdog select failed', { error: error.message });
              return;
            }
            if (data) setRows((prev) => mergeRows(prev, [data as Message]));
          } catch (err) {
            logger.warn('chat', 'watchdog select threw', undefined, err);
          }
        })();
      }, waitMs);
    },
    [clearWatchdog],
  );

  /**
   * Send one turn. `origin` selects what happens to a lost connection (Step 9): `composer`
   * means the text is only in memory, so a network failure persists it to the device queue;
   * `queue` means it is already stored, so a failure just re-opens its retry gate.
   */
  const send = useCallback(
    async (
      args: {
        clientMessageId: string;
        content: string;
        clientSentAt: string;
        oathConfirmed?: boolean;
        oathRequestId?: string | null;
      },
      origin: SendOrigin = 'composer'
    ) => {
      if (!user || !limits) return;
      const { clientMessageId, content, clientSentAt } = args;

      setBanner(null);
      setPending((prev) => {
        const exists = prev.some((entry) => entry.clientMessageId === clientMessageId);
        const updated = prev.map((entry) =>
          entry.clientMessageId === clientMessageId
            ? {
                ...entry,
                content,
                clientSentAt,
                state: 'sending' as const,
                reason: undefined,
                error: undefined,
                retryAt: 0,
              }
            : entry
        );
        if (exists) return updated;
        return [
          ...updated,
          {
            clientMessageId,
            content,
            clientSentAt,
            state: 'sending' as const,
            retryAt: 0,
          },
        ];
      });

      const body: Record<string, unknown> = {
        content,
        client_message_id: clientMessageId,
      };
      if (clientSentAt) body.client_sent_at = clientSentAt;
      if (args.oathConfirmed && args.oathRequestId) {
        body.oath_confirmed = true;
        body.oath_request_id = args.oathRequestId;
      }
      // Dev-only forcer: absent entirely when nothing is pinned (Step 6).
      const devForce = devForcePayload(devOverrides, devEnabled);
      if (devForce) body.dev_force = devForce;

      /**
       * Hand the turn to the device queue. `offline` means nothing was transmitted (NetInfo
       * reports no link), so a replay is safe at once; `unknown` means the request went out
       * and its outcome is unknown, so it must wait out `chat_retry_holdoff_ms` — a resend
       * must not start a second pipeline run while the first may still be alive (§7.10).
       */
      const queueAs = async (reason: QueueReason) => {
        const retryAt = reason === 'offline' ? 0 : Date.now() + limits.retryHoldoffMs;

        if (origin === 'queue') {
          // Already stored: record the attempt and re-open its gate.
          await markQueueAttempt(clientMessageId, retryAt);
        } else {
          // A tap can land in the same tick the composer enabled, before the queue has
          // finished loading. Loading again is a no-op once it has, and it keeps a
          // not-yet-ready queue from being reported as a full one.
          await loadSendQueue(user.id, limits.queueMaxItems);
          const stored = await enqueueSend({
            clientMessageId,
            content,
            clientSentAt,
            retryAt,
            attempts: 0,
            reason,
          });
          if (!stored) {
            // Queue full. Keep the text on screen as an actionable failure rather than
            // dropping it into a queue that has no room for it.
            setPending((prev) =>
              prev.map((entry) =>
                entry.clientMessageId === clientMessageId
                  ? {
                      ...entry,
                      state: 'failed' as const,
                      retryAt: Date.now(),
                      error: {
                        kind: 'client' as const,
                        message: `Too many messages are already waiting to send (${limits.queueMaxItems}).`,
                      },
                    }
                  : entry
              )
            );
            return;
          }
        }

        // The queue owns this turn now: drop the in-memory copy so it is never drawn twice.
        // The render list prefers `pending`, so a stale entry here would hold the bubble on
        // "sending" instead of showing it as queued.
        setPending((prev) => prev.filter((e) => e.clientMessageId !== clientMessageId));
      };

      /**
       * A failed attempt, routed two ways (Step 9):
       *
       *   - **Lost connection** (`kind === 'network'` — no HTTP status) means the turn is
       *     *unacknowledged*, so it belongs in the device queue and replays in tap order on
       *     reconnect.
       *   - **Everything else** keeps the §7.10 policy. A rejected request (4xx) must not be
       *     replayed verbatim, a 5xx failed fast and stays retryable at once, and a 401 is a
       *     session problem no queue can fix. Leaving the queue is deliberate: only a lost
       *     connection is worth retrying on its own.
       */
      const fail = async (error: unknown) => {
        const chatError = classifyError(error);

        if (chatError.kind === 'network') {
          await queueAs(offlineRef.current ? 'offline' : 'unknown');
          return;
        }

        if (origin === 'queue') await removeSend(clientMessageId);

        const retryAt = Date.now() + retryDelayFor(chatError.kind, limits.retryHoldoffMs);
        setPending((prev) =>
          prev.map((entry) =>
            entry.clientMessageId === clientMessageId
              ? { ...entry, state: 'failed' as const, error: chatError, retryAt }
              : entry
          )
        );
        if (chatError.kind === 'auth') setBanner(chatError);
      };

      // Known-offline shortcut: NetInfo reports no link, so nothing can be transmitted. Queue
      // at once instead of spending up to `chat_send_timeout_ms` proving it — the bubble must
      // read "queued" immediately and the composer must stay free for the next message.
      if (offlineRef.current) {
        await queueAs('offline');
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('send-message', {
          body,
          timeout: limits.sendTimeoutMs,
        });

        if (error) {
          await fail(error);
          return;
        }

        const assistantMessageId =
          (data as { assistant_message_id?: string | null } | null)?.assistant_message_id ?? null;

        // Acknowledged: the row is the server's truth now, so the device queue must stop
        // holding it. An unanswered turn is still recoverable — the thread renders it as an
        // orphan whose Retry repairs it server-side (§5.1).
        await removeSend(clientMessageId);

        setPending((prev) =>
          prev.map((entry) =>
            entry.clientMessageId === clientMessageId
              ? { ...entry, state: 'awaiting-reply' as const, error: undefined, retryAt: 0 }
              : entry
          )
        );

        if (assistantMessageId) {
          scheduleWatchdog(assistantMessageId, limits.watchdogMs);
        } else {
          // A duplicate turn that has no reply yet (pre-5a rows): reconcile from source.
          void fetchMessages();
        }
      } catch (err) {
        await fail(err);
      }
    },
    [user, limits, scheduleWatchdog, fetchMessages, devOverrides, devEnabled],
  );

  /**
   * Send a check-in. It targets `submit-checkin`, never `send-message` (FR-4), and resolves off
   * the HTTP response: on-track → the `logged` terminal state (FR-9 writes no `messages` row, so
   * no Realtime reconciliation exists); intervention → the normal `awaiting-reply` flow, whose
   * user row reconciles through the same `client_message_id` machinery.
   *
   * A failure never enters the *chat* send queue: that queue replays through `send-message`, which
   * would file the text as a chat turn. A check-in the server did not accept goes to the
   * per-user check-in pending store, replayed into `submit-checkin` with this same window by the
   * scheduler's triggers — idempotent end-to-end through the window unique index (FR-3, FR-8).
   */
  const sendCheckIn = useCallback(
    async (args: { clientMessageId: string; content: string; clientSentAt: string; windowTs: number }) => {
      if (!user || !limits) return;
      const { clientMessageId, content, clientSentAt, windowTs } = args;

      checkInWindowsRef.current.set(clientMessageId, windowTs);
      setBanner(null);
      setCheckInNote(null);
      setEnergyError(null);
      setPending((prev) => {
        const exists = prev.some((entry) => entry.clientMessageId === clientMessageId);
        const updated = prev.map((entry) =>
          entry.clientMessageId === clientMessageId
            ? {
                ...entry,
                content,
                clientSentAt,
                state: 'sending' as const,
                reason: undefined,
                error: undefined,
                retryAt: 0,
              }
            : entry
        );
        if (exists) return updated;
        return [
          ...updated,
          { clientMessageId, content, clientSentAt, state: 'sending' as const, retryAt: 0 },
        ];
      });

      const body: Record<string, unknown> = {
        content,
        client_message_id: clientMessageId,
        capture: 'chat',
        windowTs: new Date(windowTs).toISOString(),
      };
      if (clientSentAt) body.client_sent_at = clientSentAt;
      // Dev-only forcer: absent entirely when nothing is pinned (Step 6).
      const devForce = devForcePayload(devOverrides, devEnabled);
      if (devForce) body.dev_force = devForce;

      /**
       * Hand the check-in to the pending store, where the scheduler replays it into
       * `submit-checkin`. Safe at once when nothing was transmitted (`offline`); an
       * unknown-outcome request waits out the holdoff first — the window unique index makes
       * either replay a no-op, but the wait avoids re-submitting while the first may be live.
       */
      const queueAs = async (reason: QueueReason) => {
        const retryAt = reason === 'offline' ? 0 : Date.now() + limits.retryHoldoffMs;
        await checkinQueue.enqueueCheckIn(user.id, content, windowTs, retryAt);
        checkInWindowsRef.current.delete(clientMessageId);
        setPending((prev) => prev.filter((e) => e.clientMessageId !== clientMessageId));
        setCheckInNote(
          'Saved — your check-in goes in as soon as you are back online. Tap a value once it lands.'
        );
        setCheckInMode(false);
        setCheckInWindowTs(null);
      };

      const fail = async (error: unknown) => {
        const chatError = classifyError(error);

        if (chatError.kind === 'network') {
          await queueAs(offlineRef.current ? 'offline' : 'unknown');
          return;
        }

        const retryAt = Date.now() + retryDelayFor(chatError.kind, limits.retryHoldoffMs);
        setPending((prev) =>
          prev.map((entry) =>
            entry.clientMessageId === clientMessageId
              ? { ...entry, state: 'failed' as const, error: chatError, retryAt }
              : entry
          )
        );
        if (chatError.kind === 'auth') setBanner(chatError);
      };

      // Known-offline shortcut: NetInfo reports no link, so nothing can be transmitted.
      if (offlineRef.current) {
        await queueAs('offline');
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          // `auth`, not a transport failure: this path's `network` branch parks the check-in in
          // the pending store behind the offline copy, promising a replay that no queue can make
          // — nothing but a new sign-in produces a session. The chat path reaches the same bucket
          // through `functions.invoke`'s 401; a raw `fetch` has to say so itself.
          await fail({ context: { status: 401 } });
          return;
        }

        const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/submit-checkin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          // Transmitted *and* answered: a 4xx is a rejection and a 5xx is a dead function, so both
          // belong to the user as a visible, retryable failure. Passing the parsed body instead
          // left the status unreadable (it is on the response, not in the body), `classifyError`
          // fell through to `network`, and this path's network branch silently parked the check-in
          // in the pending store behind the offline copy — a replay a 4xx could never satisfy.
          logger.warn('chat', `check-in rejected: ${res.status}`, { status: res.status });
          await fail({ context: { status: res.status } });
          return;
        }

        const data = (await res.json()) as {
          status: 'ok' | 'duplicate';
          doing_id: string;
          energy: number | null;
          eval_ran: boolean;
          intervention: boolean;
          user_message_id?: string;
          assistant_message_id?: string;
        };

        if (data.intervention) {
          // The user row arrives via Realtime and reconciles on `client_message_id`; the reply
          // follows it, with the §7.10 watchdog as the fallback for a slow/absent delivery.
          setPending((prev) =>
            prev.map((entry) =>
              entry.clientMessageId === clientMessageId
                ? { ...entry, state: 'awaiting-reply' as const, error: undefined, retryAt: 0 }
                : entry
            )
          );
          if (data.assistant_message_id) {
            scheduleWatchdog(data.assistant_message_id, limits.watchdogMs);
          }
        } else {
          // On-track: a client-terminal state. No `messages` row is written by design (FR-9),
          // so nothing will ever arrive to resolve this bubble — `pruneResolvedPending` drops it.
          setPending((prev) =>
            prev.map((entry) =>
              entry.clientMessageId === clientMessageId
                ? { ...entry, state: 'logged' as const, error: undefined, retryAt: 0 }
                : entry
            )
          );
          if (data.energy === null || data.energy === undefined) {
            // No energy in the text: the chips strip supplies it (FR-6, FR-14).
            setEnergyDoingId(data.doing_id);
          } else {
            // The text already carried its rating — nothing left to ask for.
            setEnergySettled(data.energy);
            setEnergyDoingId(null);
          }
        }

        await checkinQueue.markCheckInAnswered(user.id, windowTs);
        checkInWindowsRef.current.delete(clientMessageId);
        setLastAnsweredMs(windowTs);
        setCheckInMode(false);
        setCheckInWindowTs(null);
        // FR-1 / AC-9: a submission re-arms the rolling set — the same call the layout makes on
        // open, and the reason a window is always pre-scheduled before it closes. It is a no-op
        // when the 24 h set is already complete (the deterministic id makes re-arm idempotent),
        // and on web it still republishes the grid the banner reads.
        void armCheckins(user.id);
      } catch (err) {
        await fail(err);
      }
    },
    [user, limits, scheduleWatchdog, devOverrides, devEnabled],
  );

  /**
   * Replay the device queue, oldest tap first, one turn at a time (Step 9, AC-8).
   *
   * Sequential by design: each item is a whole pipeline run, so walking them in parallel
   * would fan LLM calls out against the §12 budget and could deliver them out of order. The
   * walk stops at the first item that does not leave the queue — a failure that leaves one
   * waiting will almost certainly hit the next one too, and each retry is gated by that
   * item's own `retryAt`, so a walk cannot spin.
   */
  const flushQueue = useCallback(async () => {
    if (!user || !limits || offlineRef.current || flushingRef.current) return;
    flushingRef.current = true;
    try {
      for (;;) {
        const next = dueItems(getSendQueue(), Date.now())[0];
        if (!next) return;
        await send(
          {
            clientMessageId: next.clientMessageId,
            content: next.content,
            clientSentAt: next.clientSentAt,
          },
          'queue'
        );
        // Still stored → the attempt failed (or the link dropped again): stop here.
        if (getSendQueue().some((entry) => entry.clientMessageId === next.clientMessageId)) {
          return;
        }
      }
    } catch (err) {
      // A replay must never take the screen down: the item stays queued and retries later.
      logger.error('chat', 'queue replay failed', undefined, err);
    } finally {
      flushingRef.current = false;
    }
  }, [user, limits, send]);

  useEffect(() => {
    flushRef.current = () => void flushQueue();
    return () => {
      flushRef.current = null;
    };
  }, [flushQueue]);

  /**
   * Load this user's offline queue once the `[SPEC]` cap is available (Step 9). The key is
   * per user, because a replay authenticates with the *current* session — sharing one key
   * would send one user's text as another.
   */
  useEffect(() => {
    if (!user || !limits) return;
    void loadSendQueue(user.id, limits.queueMaxItems).then(() => flushRef.current?.());
  }, [user, limits]);

  /**
   * Connectivity signals (Step 9). `isConnected === false` is authoritative: nothing was
   * transmitted, so queued items are marked `offline` and become replayable at once. A
   * `true`/`null` reading is only a hint — a captive portal, dead DNS or a downed server
   * still fails the request, which is why the send path queues whatever actually fails.
   *
   * The link returning is the primary replay trigger, so no poll is needed.
   */
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const wasOffline = offlineRef.current;
      offlineRef.current = state.isConnected === false;
      if (wasOffline && !offlineRef.current) flushRef.current?.();
    });
    void NetInfo.fetch()
      .then((state) => {
        offlineRef.current = state.isConnected === false;
      })
      .catch(() => {
        // Keep the optimistic default: a failed probe must never disable sending.
      });
    return () => unsubscribe();
  }, []);

  /**
   * Medium-tier chip tap → `select-persona` (FR-11). The server re-runs stages 3–5 with
   * the persona locked and writes a secondary reply, which Realtime renders. The whole
   * option set is disabled while the call is in flight and stays disabled afterwards
   * (the server allows one secondary reply per turn), so a double tap can never produce
   * a second reply.
   */
  const onSelectPersona = useCallback(
    async (optionMessageId: string, personaKey: string) => {
      if (!user || !limits) return;
      setBanner(null);
      setSelectingChip((prev) => ({ ...prev, [optionMessageId]: personaKey }));

      try {
        const { data, error } = await supabase.functions.invoke('select-persona', {
          body: { message_id: optionMessageId, persona_key: personaKey },
          timeout: limits.sendTimeoutMs,
        });

        if (error) {
          setBanner(classifyError(error));
          return;
        }

        const assistantMessageId =
          (data as { assistant_message_id?: string | null } | null)?.assistant_message_id ??
          null;
        if (assistantMessageId) {
          scheduleWatchdog(assistantMessageId, limits.watchdogMs);
        } else {
          void fetchMessages();
        }
      } catch (err) {
        setBanner(classifyError(err));
      } finally {
        setSelectingChip((prev) => {
          const next = { ...prev };
          delete next[optionMessageId];
          return next;
        });
      }
    },
    [user, limits, scheduleWatchdog, fetchMessages],
  );

  /**
   * FP-09 FR-8: Confirm on a metric chip set. The server validates the row + keys against
   * its own stored options, writes the preset rows through the gate, then flips the stage.
   * The local strip settles from the response; a `duplicate` (a lost response replayed) is
   * the same terminal state. In interview mode completion replaces the route.
   */
  const onConfirmMetrics = useCallback(
    async (
      optionMessageId: string,
      options: NonNullable<ChatItem['metricOptions']>,
      selected: readonly string[],
    ) => {
      if (!user || !limits || !canConfirmMetric(selected)) return;
      setBanner(null);
      const names = metricChoiceLabels(options, selected);
      setMetricChips((prev) => ({
        ...prev,
        [optionMessageId]: metricChipReducer(
          prev[optionMessageId] ?? INITIAL_METRIC_CHIP_STATE,
          { type: 'begin' },
        ),
      }));

      try {
        const { data, error } = await supabase.functions.invoke('select-metrics', {
          body: { message_id: optionMessageId, keys: [...selected] },
          timeout: limits.sendTimeoutMs,
        });

        if (error) {
          let message = classifyError(error).message;
          const context = (error as { context?: Response }).context;
          if (context) {
            try {
              const body = (await context.json()) as { error?: unknown };
              if (typeof body.error === 'string' && body.error.length > 0) {
                message = body.error;
              }
            } catch {
              // Keep the classified message.
            }
          }
          setMetricChips((prev) => ({
            ...prev,
            [optionMessageId]: metricChipReducer(
              prev[optionMessageId] ?? INITIAL_METRIC_CHIP_STATE,
              { type: 'fail', message },
            ),
          }));
          return;
        }

        const status =
          (data as { status?: unknown } | null)?.status === 'duplicate' ? 'duplicate' : 'ok';
        setMetricChips((prev) => ({
          ...prev,
          [optionMessageId]: metricChipReducer(
            prev[optionMessageId] ?? INITIAL_METRIC_CHIP_STATE,
            { type: 'settle', status, names },
          ),
        }));

        if (isInterview) {
          onComplete?.();
        } else {
          void fetchMessages();
        }
      } catch (err) {
        logger.error('chat', 'select-metrics threw', undefined, err);
        setMetricChips((prev) => ({
          ...prev,
          [optionMessageId]: metricChipReducer(
            prev[optionMessageId] ?? INITIAL_METRIC_CHIP_STATE,
            { type: 'fail', message: 'Could not save your metrics. Try again.' },
          ),
        }));
      }
    },
    [user, limits, isInterview, onComplete, fetchMessages],
  );

  const thinking =
    pending.some((entry) => entry.state === 'sending' || entry.state === 'awaiting-reply') ||
    Object.keys(selectingChip).length > 0;

  /**
   * Long-press → "Mark Unsavable" (FP-06 FR-14, TECH-SPEC §7.6). The POST is
   * single-flight; on ok the row is re-read so the persistent marker derives from the
   * row's own `unsavable` column — a reload and a Realtime re-delivery render the same
   * truth. Nothing is enqueued and no message row or metadata is written client-side:
   * the server flips the column and enqueues exactly one purge job.
   */
  const onMarkUnsavable = useCallback(
    async (messageId: string) => {
      if (!user || !limits || flagBusyRef.current) return;
      flagBusyRef.current = true;
      setFlag((prev) => beginFlag(prev, messageId));
      setBanner(null);

      try {
        const { error } = await supabase.functions.invoke('flag-unsavable', {
          body: flagPayload(messageId),
          timeout: limits.sendTimeoutMs,
        });
        const status = error ? errorStatus(error) : undefined;
        if (error) {
          setFlag((prev) => flagFailed(prev, messageId, status));
          logger.warn('chat', 'flag-unsavable failed', { messageId, status });
          return;
        }

        // Re-read the row: the marker derives from `messages.unsavable`, nothing else.
        const { data: row } = await supabase
          .from('messages')
          .select('*')
          .eq('id', messageId)
          .maybeSingle();
        if (row) setRows((prev) => mergeRows(prev, [row as Message]));
        setFlag((prev) => flagSucceeded(prev, messageId));
        setFlagMenuFor((prev) => (prev === messageId ? null : prev));
        logger.debug('chat', 'message marked unsavable', { messageId });
      } catch (err) {
        const status = errorStatus(err);
        setFlag((prev) => flagFailed(prev, messageId, status));
        logger.warn('chat', 'flag-unsavable failed', { messageId, status });
      } finally {
        flagBusyRef.current = false;
      }
    },
    [user, limits],
  );

  // Retire optimistic entries once their turn has a rendered reply.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setPending((prev) => {
        const next = pruneResolvedPending(prev, rows);
        return next.length === prev.length ? prev : next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  /**
   * Drop queued items the server turns out to have accepted. A request whose *response* was
   * lost (timeout, dropped connection) may still have been delivered, so a server row is
   * proof of acceptance and the local copy must go before it is replayed (AC-8's "exactly
   * once" — the unique index would make the replay a no-op, but replaying an answered turn
   * is pointless work and would leave a stale queued bubble on screen).
   */
  useEffect(() => {
    if (queued.length === 0) return;
    const committed = new Set(
      rows
        .filter((row) => row.role === 'user' && row.client_message_id)
        .map((row) => row.client_message_id as string),
    );
    for (const entry of queued) {
      if (committed.has(entry.clientMessageId)) void removeSend(entry.clientMessageId);
    }
  }, [rows, queued]);

  /**
   * What the thread draws for unacknowledged turns. `pending` wins for an id: during a
   * replay the item stays stored (so a crash mid-attempt cannot lose it) while its attempt
   * lives in `pending`, and the in-flight state is the truthful one to show.
   */
  const renderPending = useMemo<PendingSend[]>(() => {
    if (!user) return [];
    const pendingIds = new Set(pending.map((entry) => entry.clientMessageId));
    const fromQueue: PendingSend[] = queued
      .filter((entry) => !pendingIds.has(entry.clientMessageId))
      .map((entry) => ({
        clientMessageId: entry.clientMessageId,
        content: entry.content,
        clientSentAt: entry.clientSentAt,
        state: 'queued' as const,
        retryAt: entry.retryAt,
        reason: entry.reason,
      }));
    return [...pending, ...fromQueue];
  }, [pending, queued, user]);

  const items = useMemo(
    () =>
      buildChatItems({
        rows,
        pending: renderPending,
        retryHoldoffMs: limits?.retryHoldoffMs ?? 0,
        now,
      }),
    [rows, renderPending, limits, now],
  );

  // The profile read is authoritative; the newest row stamp keeps the indicator meaningful
  // before the read lands or when it fails (the row lags a boundary by one exchange).
  const indicatorStage = useMemo<OnboardingStage>(
    () => stage ?? onboardingStageFromRows(rows) ?? 'intro',
    [stage, rows],
  );
  const indicatorIndex = onboardingStepIndex(indicatorStage);
  const indicatorLabel = onboardingStepLabel(indicatorStage);

  // Wake up when a holdoff-gated Retry becomes available.
  useEffect(() => {
    const at = nextRetryAt(items, now);
    if (at === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(50, at - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [items, now]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchMessages();
  }, [fetchMessages]);

  const onSend = useCallback(() => {
    const content = draft.trim();
    if (!content || !limits || thinking) return;
    setDraft('');
    const shouldConfirmOath = oathConfirming && activeOathRequestId !== null;
    const reqId = shouldConfirmOath ? activeOathRequestId : null;
    if (shouldConfirmOath) {
      setOathConfirming(false);
    }
    if (checkInMode && checkInWindowTs !== null) {
      void sendCheckIn({
        clientMessageId: makeClientMessageId(),
        content,
        clientSentAt: new Date().toISOString(),
        windowTs: checkInWindowTs,
      });
    } else {
      void send({
        clientMessageId: makeClientMessageId(),
        content,
        clientSentAt: new Date().toISOString(),
        oathConfirmed: shouldConfirmOath,
        oathRequestId: reqId,
      });
    }
  }, [
    draft,
    limits,
    thinking,
    send,
    checkInMode,
    checkInWindowTs,
    sendCheckIn,
    oathConfirming,
    activeOathRequestId,
  ]);

  /** FR-20: the in-app "Impulse lost" button. Strictly a log — no turn, no model call. */
  const onImpulseLost = useCallback(async () => {
    if (!user || impulseState === 'logging' || impulseState === 'logged') return;
    hapticImpactLight();
    setImpulseState('logging');
    const result = await logImpulse('app');
    setImpulseState((current) =>
      nextImpulseState(current, result.ok ? { ok: true } : { ok: false }),
    );
  }, [user, impulseState]);

  // Clear the acknowledgement after a beat so the button is usable again.
  useEffect(() => {
    if (impulseState !== 'logged' && impulseState !== 'error') return;
    const timer = setTimeout(() => setImpulseState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [impulseState]);

  // FR-21: the preemptive push deep-links `davos://chat?focus=alternative`; scroll to the
  // newest preemptive row (the `focus=checkin` route pattern).
  const alternativeScrolledRef = useRef(false);
  useEffect(() => {
    if (focusParam !== 'alternative' || !userId || alternativeScrolledRef.current) return;
    const target = [...rows]
      .reverse()
      .find(
        (row) =>
          row.role === 'assistant' && row.metadata?.source === 'preemptive_block',
      );
    if (!target) return;
    const index = items.findIndex((item) => item.messageId === target.id);
    if (index < 0) return;
    alternativeScrolledRef.current = true;
    followBottomRef.current = false;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
    });
  }, [focusParam, userId, rows, items]);

  const onRetry = useCallback(
    (item: ChatItem) => {
      if (!limits || !item.clientMessageId || thinking) return;
      const existing = pending.find(
        (entry) => entry.clientMessageId === item.clientMessageId,
      );
      const content = existing?.content ?? item.content;
      const clientSentAt = existing?.clientSentAt ?? item.clientSentAt ?? new Date().toISOString();

      // A check-in retry must go back to `submit-checkin` with its original window — re-sending
      // it through `send-message` would file the text as a chat turn (FR-4).
      const checkInWindowTs = checkInWindowsRef.current.get(item.clientMessageId);
      if (checkInWindowTs !== undefined) {
        void sendCheckIn({ clientMessageId: item.clientMessageId, content, clientSentAt, windowTs: checkInWindowTs });
        return;
      }

      // An item still held by the device queue must fail back into the queue (re-gate it),
      // not into an in-memory failure it would then be duplicated by.
      const inQueue = queued.some((entry) => entry.clientMessageId === item.clientMessageId);
      // The same client_message_id is reused, so the server dedupes/repairs the turn
      // instead of running the pipeline twice.
      void send(
        { clientMessageId: item.clientMessageId, content, clientSentAt },
        inQueue ? 'queue' : 'composer',
      );
    },
    [limits, thinking, pending, queued, send, sendCheckIn],
  );

  /** PATCH the doing's energy (FR-14). Resolves `true` only on a confirmed write. */
  const patchEnergy = useCallback(
    async (doingId: string, energy: number): Promise<boolean> => {
      if (!user || !limits) return false;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return false;

        const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/submit-checkin`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ doing_id: doingId, energy }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          logger.warn('chat', 'energy patch failed', { error: errText, status: res.status });
          return false;
        }
        return true;
      } catch (err) {
        logger.warn('chat', 'energy patch threw', undefined, err);
        return false;
      }
    },
    [user, limits]
  );

  /**
   * One tap consumes the set: the whole strip disables while the PATCH is in flight, settles on
   * success and re-enables with an inline error on failure — the server value wins on reload
   * either way (FR-14).
   */
  const pickEnergy = useCallback(
    async (value: number) => {
      if (energyBusy || energyDoingId === null) return;
      void hapticSelection();
      setEnergyBusy(true);
      setEnergyError(null);
      try {
        const ok = await patchEnergy(energyDoingId, value);
        if (ok) {
          void hapticImpactLight();
          setEnergySettled(value);
          setEnergyDoingId(null);
        } else {
          setEnergyError('Could not save that just now — tap a value to try again.');
        }
      } finally {
        setEnergyBusy(false);
      }
    },
    [energyBusy, energyDoingId, patchEnergy],
  );

  /**
   * The window the web banner offers (FR-4, AC-10). Derived from `now`, so the banner appears
   * and retires with its window without any network traffic; native never shows it.
   */
  const bannerWindow = useMemo(() => {
    if (!userId) return null;
    const grid = getGrid();
    const visible = shouldShowCheckinBanner({
      platformOS: Platform.OS,
      grid,
      nowMs: now,
      userId,
      lastAnsweredMs,
    });
    if (!visible || !grid) return null;
    return currentOpenWindow(grid, now, userId);
  }, [userId, now, lastAnsweredMs]);

  /** The window the check-in composer is answering, labelled in the profile zone. */
  const checkInWindowLabel = useMemo(() => {
    if (checkInWindowTs === null) return null;
    const grid = getGrid();
    if (!grid) return null;
    return utcToLocalLabel(grid.timezone, checkInWindowTs);
  }, [checkInWindowTs]);

  const cancelCheckIn = useCallback(() => {
    setCheckInMode(false);
    setCheckInWindowTs(null);
    setDraft('');
  }, []);

  const renderItem = ({ item }: { item: ChatItem }) => {
    const isUser = item.role === 'user';
    const failed = item.state === 'failed';
    const logged = item.state === 'logged';
    const flaggable = canMarkUnsavable(item);
    const menuOpen = flagMenuFor !== null && flagMenuFor === item.messageId;
    const flagBusy = isFlagBusy(flag, item.messageId ?? '');
    const flagError = flagErrorFor(flag, item.messageId);
    const quest = item.messageId ? questCards.get(item.messageId) : undefined;
    const oath = item.messageId ? oathCards.get(item.messageId) : undefined;
    const isEligibleOath = Boolean(activeOathRequestId && item.messageId === activeOathRequestId);
    const metricState = item.metricOptions
      ? (metricChips[item.key] ?? INITIAL_METRIC_CHIP_STATE)
      : null;

    return (
      <Pressable
        onLongPress={flaggable ? () => setFlagMenuFor(item.messageId ?? null) : undefined}
        delayLongPress={400}
        accessibilityHint={flaggable ? 'Long press to mark this message unsavable' : undefined}
        style={[
          styles.messageContainer,
          isWide && styles.messageContainerWide,
          isUser ? styles.userMessage : styles.assistantMessage,
          failed && styles.failedMessage,
        ]}>
        <Text
          selectable={Platform.OS === 'web'}
          style={[
            styles.messageText,
            isWide && styles.messageTextWide,
            isUser ? styles.userText : styles.assistantText,
          ]}>
          {item.content}
        </Text>

        {/* Delivery state lives on each bubble (pattern: ticks, not prose). The mark is
            "in flight"; one grey tick is "sent, reply pending"; two blue ticks are the
            terminal "logged" state for check-ins. */}
        {item.state === 'sending' ? (
          <View style={styles.stateRow}>
            <LoadingDot size={16} color={isUser ? (isDark ? colors.textPrimary : colors.onAccent) : colors.textTertiary} decorative />
          </View>
        ) : null}
        {item.state === 'awaiting-reply' ? (
          <Text style={styles.tickText} accessibilityLabel="Sent">
            ✓
          </Text>
        ) : null}
        {logged ? (
          <Text style={[styles.tickText, styles.tickTextLogged]} accessibilityLabel="Logged">
            ✓✓
          </Text>
        ) : null}

        {item.state === 'queued' ? (
          <View style={styles.queueRow}>
            <View style={styles.queueLabel}>
              {/* Conventional "pending send" clock; the label disambiguates it from a
                  time reference (an ambiguous icon gets a short label). */}
              <Text style={styles.queueGlyph} accessibilityLabel="Pending">
                🕓
              </Text>
              <Text style={styles.queueText}>
                {item.reason === 'offline' ? 'Queued (offline)' : 'Waiting to retry'}
              </Text>
            </View>
            {/* A queued turn is safely resendable (its client_message_id makes it
                idempotent), so the user can replay it now instead of waiting; the holdoff
                still gates the unknown-outcome case. */}
            {item.canRetry && item.clientMessageId ? (
              <Pressable
                onPress={() => onRetry(item)}
                accessibilityRole="button"
                accessibilityLabel="Send now"
                hitSlop={8}>
                <Text style={styles.retryText}>Send now</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {item.personaOptions ? (
          <View style={styles.chipsRow}>
            {item.personaOptions.map((option) => {
              const chosen = item.chosenPersonaKey === option.key;
              // One tap consumes the whole set, so every chip is disabled once the turn
              // has resolved — or while this client's tap is still in flight.
              const disabled = Boolean(item.chosenPersonaKey) || selectingChip[item.key] !== undefined;
              return (
                <Pressable
                  key={option.key}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Select persona: ${option.label}`}
                  accessibilityState={{ disabled, selected: chosen }}
                  onPress={() => void onSelectPersona(item.key, option.key)}
                  style={[
                    styles.chip,
                    chosen && styles.chipChosen,
                    disabled && !chosen && styles.chipDisabled,
                  ]}>
                  <Text style={[styles.chipLabel, chosen && styles.chipLabelChosen]}>
                    {option.label}
                  </Text>
                  {option.one_liner ? (
                    <Text style={[styles.chipOneLiner, chosen && styles.chipLabelChosen]}>
                      {option.one_liner}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* FP-09 FR-8: the multi-select metric proposal. The row metadata is the list; the
            local strip only overlays selection/in-flight/settled state. */}
        {isInterview && item.metricOptions && metricState ? (
          <View style={styles.metricBlock}>
            {metricState.phase === 'settled' && metricState.settlement ? (
              <Text style={styles.metricSettled}>
                Chosen: {metricState.settlement.names.join(' · ')}
              </Text>
            ) : (
              <>
                <View style={styles.chipsRow}>
                  {item.metricOptions.map((option) => {
                    const selected = metricState.selected.includes(option.key);
                    const locked =
                      metricState.phase === 'confirming' || metricState.phase === 'settled';
                    return (
                      <Pressable
                        key={option.key}
                        disabled={locked}
                        accessibilityRole="button"
                        accessibilityLabel={`Select metric: ${option.label}`}
                        accessibilityState={{ disabled: locked, selected }}
                        onPress={() =>
                          setMetricChips((prev) => ({
                            ...prev,
                            [item.key]: metricChipReducer(prev[item.key] ?? INITIAL_METRIC_CHIP_STATE, {
                              type: 'toggle',
                              key: option.key,
                              options: item.metricOptions ?? [],
                            }),
                          }))
                        }
                        style={[
                          styles.chip,
                          selected && styles.chipChosen,
                          locked && !selected && styles.chipDisabled,
                        ]}>
                        <Text style={[styles.chipLabel, selected && styles.chipLabelChosen]}>
                          {option.label}
                        </Text>
                        <Text style={styles.chipOneLiner}>
                          {option.domain} · {option.output_unit}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.metricActions}>
                  <Pressable
                    disabled={
                      !canConfirmMetric(metricState.selected) ||
                      metricState.phase === 'confirming'
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Confirm metric selection"
                    accessibilityState={{
                      disabled:
                        !canConfirmMetric(metricState.selected) ||
                        metricState.phase === 'confirming',
                    }}
                    onPress={() =>
                      void onConfirmMetrics(item.key, item.metricOptions ?? [], metricState.selected)
                    }
                    style={[
                      styles.metricConfirm,
                      (!canConfirmMetric(metricState.selected) ||
                        metricState.phase === 'confirming') &&
                        styles.metricConfirmDisabled,
                    ]}>
                    <Text style={styles.metricConfirmText}>
                      {metricState.phase === 'confirming' ? 'Saving…' : 'Confirm'}
                    </Text>
                  </Pressable>
                  {metricState.error ? (
                    <Text style={styles.metricError}>{metricState.error}</Text>
                  ) : null}
                </View>
              </>
            )}
          </View>
        ) : null}

        {/* FP-08 FR-17: the Side Quest card. The row's metadata is the source of the offer
            and of the persisted accepted/declined state; `questActions` only overlays the
            in-flight tap. Accept and decline both go through `accept-quest`. */}
        {!isUser && quest ? (
          <View style={styles.questCard}>
            <Text style={styles.questEyebrow}>SIDE QUEST</Text>
            <Text style={styles.questTitle}>{quest.offer.name}</Text>
            <Text style={styles.questMeta}>
              {quest.offer.domain} · {quest.offer.output_unit} · {quest.offer.deadline_days} days
            </Text>
            {quest.offer.rationale ? (
              <Text style={styles.questRationale}>{quest.offer.rationale}</Text>
            ) : null}
            {quest.state === 'offer' || quest.state === 'accepting' ? (
              <View style={styles.questActions}>
                <Pressable
                  disabled={quest.state === 'accepting'}
                  accessibilityRole="button"
                  accessibilityLabel={`Accept quest: ${quest.offer.name}`}
                  accessibilityState={{ disabled: quest.state === 'accepting' }}
                  onPress={() => void onQuestAnswer(item.messageId!, true)}
                  style={[
                    styles.questAccept,
                    quest.state === 'accepting' && styles.questAcceptDisabled,
                  ]}>
                  <Text style={styles.questAcceptText}>
                    {quest.state === 'accepting' ? 'Accepting…' : 'Accept'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={quest.state === 'accepting'}
                  accessibilityRole="button"
                  accessibilityLabel="Decline quest"
                  onPress={() => void onQuestAnswer(item.messageId!, false)}>
                  <Text style={styles.questDeclineText}>Not now</Text>
                </Pressable>
              </View>
            ) : quest.state === 'accepted' ? (
              <Text style={styles.questStateText}>
                Quest active on your dashboard
                {quest.metricId ? ` · metric ${quest.metricId.slice(0, 8)}…` : ''}
              </Text>
            ) : quest.state === 'declined' ? (
              <Text style={styles.questStateText}>Declined — the offer is closed.</Text>
            ) : (
              <Text style={styles.questErrorText}>{quest.error ?? 'Something went wrong.'}</Text>
            )}
          </View>
        ) : null}

        {/* Oath Confirm Affordance (D26, FP-08 FR-10) */}
        {!isUser && oath ? (
          <View style={[styles.oathCard, oath.state === 'sealed' && styles.oathCardSealed]}>
            <View style={styles.oathHeader}>
              <Text style={styles.oathEyebrow}>THE OATH</Text>
              <Text
                style={
                  oath.state === 'sealed'
                    ? styles.oathStatusSealed
                    : styles.oathStatusDemanded
                }>
                {oath.state === 'sealed' ? 'SEALED' : 'DEMANDED'}
              </Text>
            </View>
            <Text style={styles.oathDescription}>
              {oath.state === 'sealed'
                ? 'Your commitment has been recorded verbatim as permanent, non-purgeable memory.'
                : 'Davos has demanded your binding commitment. Words confirmed as your Oath cannot be purged.'}
            </Text>
            {oath.state === 'demanded' ? (
              isEligibleOath ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    oathConfirming
                      ? 'Cancel oath confirmation'
                      : 'Seal next message as oath'
                  }
                  onPress={() => setOathConfirming((prev) => !prev)}
                  style={[
                    styles.oathButton,
                    oathConfirming && styles.oathButtonActive,
                  ]}>
                  <Text
                    style={[
                      styles.oathButtonText,
                      oathConfirming && styles.oathButtonTextActive,
                    ]}>
                    {oathConfirming ? 'Cancel Oath Mode' : 'Seal Next Message as Oath'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.oathSupersededText}>
                  This demand was superseded by later messages.
                </Text>
              )
            ) : null}
          </View>
        ) : null}

        {failed ? (
          <View style={styles.failedRow}>
            <View style={styles.failedGroup}>
              <View style={styles.failedBadge}>
                <Text style={styles.failedBadgeText}>!</Text>
              </View>
              <Text style={styles.failedText}>{item.error?.message ?? 'Not sent.'}</Text>
            </View>
            {item.error?.kind !== 'auth' && item.clientMessageId ? (
              <Pressable
                onPress={() => onRetry(item)}
                disabled={!item.canRetry}
                accessibilityRole="button"
                accessibilityLabel={item.canRetry ? 'Retry sending' : 'Retry sending, waiting'}
                accessibilityState={{ disabled: !item.canRetry }}
                hitSlop={8}>
                <Text style={[styles.retryText, !item.canRetry && styles.retryTextDisabled]}>
                  {item.canRetry ? 'Retry' : 'Retry (waiting…)'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* FP-06 FR-14: the flag affordance. The long-press menu offers one action; the
            marker below derives from the row's `unsavable` column, never from this state. */}
        {menuOpen ? (
          <View style={styles.flagMenu}>
            <Pressable
              disabled={flagBusy}
              accessibilityRole="button"
              accessibilityLabel="Mark unsavable"
              accessibilityState={{ disabled: flagBusy }}
              onPress={() => void onMarkUnsavable(item.messageId as string)}
              hitSlop={8}>
              <Text style={[styles.flagAction, flagBusy && styles.flagActionDisabled]}>
                {flagBusy ? 'Marking…' : 'Mark Unsavable'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => setFlagMenuFor(null)}
              hitSlop={8}>
              <Text style={styles.flagCancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        {flagError ? (
          <View style={styles.flagErrorRow}>
            <Text style={styles.flagErrorText}>{flagError.message}</Text>
            {flagError.retryable && item.messageId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry marking unsavable"
                onPress={() => void onMarkUnsavable(item.messageId as string)}
                hitSlop={8}>
                <Text style={styles.flagRetry}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {showsUnsavableMarker(item) ? (
          <View style={styles.flagMarker}>
            <Text style={styles.flagMarkerText}>Unsavable</Text>
          </View>
        ) : null}

        <Text
          style={[styles.timestamp, isUser ? styles.userTimestamp : styles.assistantTimestamp]}>
          {formatTime(item.createdAt)}
        </Text>
      </Pressable>
    );
  };

  if (loading && !configBlocked) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingMark size="large" />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </View>
    );
  }

  const composerDisabled = config.status !== 'loaded' || limits === null;
  const canSend = !composerDisabled && !thinking && draft.trim().length > 0;

  return (
    // The composer needs explicit help on both native platforms: it is not inside a scroll
    // responder, and Android runs edge-to-edge, so `adjustResize` no longer shrinks the
    // window - the keyboard would simply cover the composer. iOS has always needed it;
    // web lets the browser handle it. The offset is 0 because this view's own frame already
    // ends at the tab bar's top, which is exactly the gap the padding must not add.
    <KeyboardAvoidingView
      style={[
        styles.container,
        { paddingTop: insets.top + (isWide ? 24 : 16) },
        isWide && styles.containerWide,
      ]}
      behavior={Platform.OS === 'web' ? undefined : 'padding'}>
      <View style={styles.chatHeader}>
        <View style={styles.chatLogoWrapper}>
          <BrandMark size={28} decorative />
        </View>
        <View style={styles.chatIdentity}>
          <Text style={styles.chatHeaderTitle} accessibilityRole="header">
            Davos
          </Text>
          <Text style={styles.chatHeaderSubtitle}>Life Mentor · Observant & Steadfast</Text>
        </View>
        <Text style={styles.chatHeaderDate}>{dateLabel}</Text>
      </View>

      {isInterview ? (
        <View
          style={styles.stageIndicator}
          accessibilityRole="progressbar"
          accessibilityLabel={`Onboarding step ${indicatorIndex + 1} of ${ONBOARDING_STEPS.length}: ${indicatorLabel}`}>
          <View style={styles.stageDots}>
            {ONBOARDING_STEPS.map((step, index) => (
              <View
                key={step.stage}
                style={[styles.stageDot, index <= indicatorIndex && styles.stageDotActive]}
              />
            ))}
          </View>
          <Text style={styles.stageLabel}>
            Step {indicatorIndex + 1} of {ONBOARDING_STEPS.length} · {indicatorLabel}
          </Text>
        </View>
      ) : null}

      {banner ? (
        <View style={[styles.notice, styles.banner]}>
          <Text style={styles.bannerText}>{banner.message}</Text>
        </View>
      ) : null}

      {composerDisabled ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {config.status === 'loading'
              ? 'Loading configuration…'
              : (config.error ?? 'Chat configuration is unavailable.')}
          </Text>
          {config.status === 'error' ? (
            <Pressable
              onPress={() => void loadConfig()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading configuration"
              hitSlop={8}>
              <Text style={styles.noticeRetryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Web in-app check-in banner (FR-4, AC-10) — web's substitute for notifications: no OS
          notification exists on the platform, so the persistent banner is the check-in surface. */}
      {!isInterview && bannerWindow ? (
        <Pressable
          onPress={() => {
            setCheckInNote(null);
            setCheckInWindowTs(bannerWindow.startMs);
            setCheckInMode(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Check in for this hour"
          style={styles.checkInBanner}
          hitSlop={8}>
          <Text style={styles.checkInBannerText}>
            What did you do this hour? · tap to check in
          </Text>
        </Pressable>
      ) : null}

      {/* Check-in mode hint (a native notification tap, or the web banner): the composer now
          writes to `submit-checkin` for this window instead of the chat thread (FR-4). */}
      {!isInterview && checkInMode && checkInWindowTs !== null ? (
        <View style={styles.checkInHint}>
          <Text style={styles.checkInHintText}>
            Check-in{checkInWindowLabel ? `: ${checkInWindowLabel}` : ''} — straight to your log, not the chat
          </Text>
          <Pressable
            onPress={cancelCheckIn}
            accessibilityRole="button"
            accessibilityLabel="Dismiss check-in"
            hitSlop={8}
          >
            <Text style={styles.checkInHintCancel}>Not now</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        style={styles.threadList}
        contentContainerStyle={[
          styles.threadContent,
          Platform.OS === 'web' && isWide && styles.threadContentWeb,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BRAND_AMBER}
            colors={[BRAND_AMBER]}
            progressBackgroundColor={colors.surface}
          />
        }
        onLayout={onThreadLayout}
        onScroll={onThreadScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onThreadContentSizeChange}
        onScrollToIndexFailed={(info) => {
          // The target row is not measured yet (a deep link on a cold thread). Land near it
          // and let the next layout settle; the reader can still see the block.
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          });
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No messages yet. Davos will speak first.</Text>
          </View>
        }
      />

      <View style={styles.inputContainer}>
        {/* Energy chips (FR-14): offered after a check-in that carried no rating, or on open for
            the newest null-energy doing. The strip settles once the PATCH is confirmed. */}
        {!isInterview && energyDoingId !== null ? (
          <View style={styles.energyStrip}>
            <Text style={styles.energyStripLabel}>
              {energyBusy ? 'Saving…' : 'How was your energy? Tap 1–10.'}
            </Text>
            <View style={styles.energyRow}>
              {ENERGY_VALUES.map((value) => (
                <Pressable
                  key={value}
                  disabled={energyBusy}
                  accessibilityRole="button"
                  accessibilityLabel={`Energy ${value} of 10`}
                  accessibilityState={{ disabled: energyBusy, selected: energySettled === value }}
                  onPress={() => void pickEnergy(value)}
                  style={[styles.chip, styles.energyChip, energyBusy && styles.chipDisabled]}
                  hitSlop={6}>
                  <Text style={styles.chipLabel}>
                    {energyEmoji(value)} {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            {energyError ? <Text style={styles.energyErrorText}>{energyError}</Text> : null}
          </View>
        ) : !isInterview && energySettled !== null ? (
          <View style={styles.energyStrip}>
            <Text style={styles.energyStripLabel}>{energyLabel(energySettled)}</Text>
          </View>
        ) : !isInterview && checkInNote ? (
          <View style={styles.energyStrip}>
            <Text style={styles.energyStripLabel}>{checkInNote}</Text>
          </View>
        ) : null}

        {thinking ? (
          <View style={styles.thinkingRow}>
            <LoadingMark size="small" />
            <Text style={styles.thinkingText}>Davos is thinking…</Text>
          </View>
        ) : null}

        {!isInterview && impulseAckText(impulseState) ? (
          <View style={styles.impulseAck}>
            <Text style={styles.impulseAckText}>{impulseAckText(impulseState)}</Text>
          </View>
        ) : null}

        {oathConfirming && activeOathRequestId ? (
          <View style={styles.oathComposerBanner}>
            <View style={styles.oathComposerBannerTextCol}>
              <Text style={styles.oathComposerBannerTitle}>SEALING BINDING OATH</Text>
              <Text style={styles.oathComposerBannerSubtitle}>
                Your message will be sealed verbatim as permanent, non-purgeable memory.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel oath confirmation"
              onPress={() => setOathConfirming(false)}
              style={styles.oathCancelButton}>
              <Text style={styles.oathCancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.composerRow,
            { borderColor: composerFocused ? colors.borderFocus : colors.border },
          ]}>
          {!isInterview ? (
            <Pressable
              onPress={() => void onImpulseLost()}
              disabled={impulseButtonDisabled(impulseState)}
              accessibilityRole="button"
              accessibilityLabel="Log an impulse"
              accessibilityState={{ disabled: impulseButtonDisabled(impulseState) }}
              style={[
                styles.impulseButton,
                impulseButtonDisabled(impulseState) && styles.impulseButtonDisabled,
                impulseState === 'logged' && styles.impulseButtonLogged,
              ]}>
              <Text style={styles.impulseButtonText}>{impulseButtonLabel(impulseState)}</Text>
            </Pressable>
          ) : null}
          <TextInput
            style={styles.input}
            placeholder={
              composerDisabled
                ? 'Davos will speak first'
                : oathConfirming
                  ? 'Type your solemn oath…'
                  : checkInMode
                    ? 'What did you do this hour?'
                    : 'Message Davos'
            }
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            editable={!composerDisabled}
            multiline
            maxLength={limits?.maxChars}
            accessibilityLabel={checkInMode ? 'Check-in response' : 'Message Davos'}
          />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            onHoverIn={() => setSendHovered(true)}
            onHoverOut={() => setSendHovered(false)}
            accessibilityRole="button"
            accessibilityLabel={
              oathConfirming
                ? 'Seal oath'
                : checkInMode
                  ? 'Send check-in'
                  : 'Send message'
            }
            accessibilityState={{ disabled: !canSend }}
            style={[
              styles.sendButton,
              canSend ? styles.sendButtonEnabled : styles.sendButtonDisabled,
              sendHovered && canSend && styles.sendButtonHovered,
              oathConfirming && canSend && styles.sendButtonOath,
            ]}>
            <Text
              style={[
                styles.sendButtonText,
                oathConfirming && styles.sendButtonOathText,
              ]}>
              {oathConfirming ? 'Seal' : 'Send'}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** The `(app)/chat` route: the same screen in tab-shell mode. */
export default function ChatRoute() {
  return <ChatScreen />;
}

function getChatStyles(theme: Theme) {
  const { colors, radius, spacing, isDark } = theme;

  // Refined chat bubble color system:
  // - Light mode: User is Deep Navy (accent) with crisp paper text (#FAFBFD); Davos is Crisp Paper (#FAFBFD) with Deep Navy ink.
  // - Dark mode: User is elevated rich slate-navy (#1C2A3E) with crisp alabaster text (#F4F6F9); Davos is resting midnight navy (#131E30) with alabaster text.
  // Guarantees high contrast, no eye strain, and 100% visible text across every bubble element.
  const userBubbleBg = isDark ? '#1C2A3E' : colors.accent;
  const userBubbleBorder = isDark ? '#2B3E5B' : colors.accent;
  const userBubbleText = isDark ? colors.textPrimary : colors.onAccent;
  const userBubbleSubtext = isDark ? 'rgba(244, 246, 249, 0.72)' : 'rgba(250, 251, 253, 0.75)';
  const userBubbleLoggedTick = isDark ? '#70B8FF' : '#85C4FF';
  const userBubbleDivider = isDark ? 'rgba(244, 246, 249, 0.2)' : 'rgba(250, 251, 253, 0.2)';
  const userBubbleError = isDark ? '#FF9498' : '#FFD1D4';
  const userBubbleMarkerBorder = isDark ? 'rgba(244, 246, 249, 0.35)' : 'rgba(250, 251, 253, 0.35)';
  const userBubbleRetry = isDark ? colors.accent : '#F5B853';

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      padding: spacing.md,
    },
    containerWide: {
      width: '100%',
      maxWidth: 960,
      alignSelf: 'center',
      paddingHorizontal: spacing.lg,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
    },
    chatHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: spacing.sm,
      marginBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    chatLogoWrapper: {
      marginRight: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatIdentity: {
      flex: 1,
      minWidth: 0,
    },
    chatHeaderTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    chatHeaderSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    chatHeaderDate: {
      fontSize: 12,
      color: colors.textTertiary,
      marginLeft: spacing.sm,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      marginTop: spacing.sm,
      color: colors.textSecondary,
      fontSize: 14,
    },
    threadList: {
      flex: 1,
      marginBottom: spacing.md,
    },
    threadContent: {
      flexGrow: 1,
      paddingBottom: spacing.md,
    },
    threadContentWeb: {
      paddingRight: spacing.sm,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
    },
    emptyText: {
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 22,
    },
    messageContainer: {
      maxWidth: '82%',
      marginBottom: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.lg,
    },
    messageContainerWide: {
      maxWidth: '72%',
    },
    userMessage: {
      alignSelf: 'flex-end',
      backgroundColor: userBubbleBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: userBubbleBorder,
      borderBottomRightRadius: 4,
    },
    assistantMessage: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? colors.borderSubtle : colors.border,
      borderBottomLeftRadius: 4,
    },
    failedMessage: {
      borderWidth: 1,
      borderColor: colors.danger,
    },
    messageText: {
      fontSize: 15,
      lineHeight: 22,
    },
    messageTextWide: {
      fontSize: 16,
      lineHeight: 24,
    },
    userText: {
      color: userBubbleText,
    },
    assistantText: {
      color: colors.textPrimary,
    },
    stateRow: {
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    tickText: {
      fontSize: 12,
      color: userBubbleSubtext,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    tickTextLogged: {
      color: userBubbleLoggedTick,
    },
    flagMenu: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: 6,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: userBubbleDivider,
    },
    flagAction: {
      fontSize: 13,
      fontWeight: '600',
      color: userBubbleText,
    },
    flagActionDisabled: {
      opacity: 0.6,
    },
    flagCancel: {
      fontSize: 13,
      color: userBubbleSubtext,
    },
    flagErrorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: 6,
    },
    flagErrorText: {
      flexShrink: 1,
      fontSize: 12,
      color: userBubbleError,
      opacity: 0.95,
    },
    flagRetry: {
      fontSize: 12,
      fontWeight: '600',
      color: userBubbleText,
    },
    flagMarker: {
      alignSelf: 'flex-start',
      marginTop: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: userBubbleMarkerBorder,
    },
    flagMarkerText: {
      fontSize: 10,
      color: userBubbleText,
      opacity: 0.9,
    },
    chipsRow: {
      marginTop: 10,
    },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      marginBottom: spacing.xs,
      backgroundColor: colors.surface,
      cursor: 'pointer',
    },
    chipChosen: {
      backgroundColor: colors.accentSubtle,
      borderColor: colors.accent,
    },
    chipDisabled: {
      opacity: 0.5,
      cursor: 'auto',
    },
    chipLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    chipLabelChosen: {
      color: colors.textPrimary,
    },
    chipOneLiner: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    metricBlock: {
      marginTop: 10,
    },
    metricActions: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginTop: 2,
    },
    metricConfirm: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    metricConfirmDisabled: {
      opacity: 0.5,
    },
    metricConfirmText: {
      color: colors.onAccent,
      fontSize: 14,
      fontWeight: '600',
    },
    metricError: {
      color: colors.danger,
      fontSize: 12,
      marginLeft: spacing.sm,
      flexShrink: 1,
    },
    metricSettled: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 10,
    },
    stageIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    stageDots: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stageDot: {
      width: 22,
      height: 4,
      borderRadius: 2,
      marginRight: 4,
      backgroundColor: colors.border,
    },
    stageDotActive: {
      backgroundColor: colors.accent,
    },
    stageLabel: {
      marginLeft: 'auto',
      fontSize: 12,
      color: colors.textSecondary,
    },
    failedRow: {
      marginTop: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    failedGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
    },
    failedBadge: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 6,
    },
    failedBadgeText: {
      color: colors.onAccent,
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 14,
    },
    failedText: {
      color: colors.dangerText,
      fontSize: 12,
      flexShrink: 1,
      marginRight: spacing.xs,
    },
    queueRow: {
      marginTop: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    queueLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
    },
    queueGlyph: {
      fontSize: 12,
      marginRight: 4,
    },
    queueText: {
      color: userBubbleSubtext,
      fontSize: 12,
      flexShrink: 1,
      marginRight: spacing.xs,
    },
    retryText: {
      color: userBubbleRetry,
      fontSize: 12,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    retryTextDisabled: {
      color: userBubbleSubtext,
      textDecorationLine: 'none',
      opacity: 0.5,
    },
    timestamp: {
      fontSize: 10,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    userTimestamp: {
      color: userBubbleSubtext,
    },
    assistantTimestamp: {
      color: colors.textTertiary,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: spacing.xs,
    },
    noticeText: {
      color: colors.textSecondary,
      fontSize: 12,
      flexShrink: 1,
      marginRight: spacing.xs,
    },
    noticeRetryText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    banner: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.danger,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.xs,
      marginBottom: spacing.xs,
    },
    bannerText: {
      color: colors.dangerText,
      fontSize: 12,
      flexShrink: 1,
    },
    inputContainer: {
      paddingTop: spacing.sm,
      // KeyboardAvoidingView's `padding` behavior replaces the container's bottom padding
      // with the keyboard overlap, so the composer keeps its normal gap here instead.
      paddingBottom: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle,
    },
    thinkingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: spacing.xs,
    },
    thinkingText: {
      color: colors.textSecondary,
      fontSize: 12,
      marginLeft: spacing.xs,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      borderWidth: 1,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      padding: 6,
    },
    impulseButton: {
      marginRight: spacing.xs,
      height: 44,
      paddingHorizontal: 10,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    impulseButtonDisabled: {
      opacity: 0.55,
    },
    impulseButtonLogged: {
      borderColor: colors.accent,
    },
    impulseButtonText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    impulseAck: {
      paddingHorizontal: spacing.xs,
      paddingBottom: 4,
    },
    impulseAckText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      borderWidth: 0,
      paddingHorizontal: spacing.xs,
      paddingTop: 10,
      paddingBottom: 10,
      backgroundColor: colors.transparent,
      color: colors.textPrimary,
      fontSize: 15,
      ...Platform.select({
        web: {
          outlineStyle: 'none' as any,
        },
      }),
    },
    sendButton: {
      marginLeft: spacing.xs,
      height: 44,
      paddingHorizontal: 20,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    sendButtonEnabled: {
      backgroundColor: colors.accent,
    },
    sendButtonDisabled: {
      backgroundColor: colors.accent,
      opacity: 0.35,
      cursor: 'auto',
    },
    sendButtonHovered: {
      opacity: 0.9,
    },
    sendButtonText: {
      color: colors.onAccent,
      fontSize: 15,
      fontWeight: '600',
    },
    checkInBanner: {
      backgroundColor: colors.infoSurface,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.info,
      cursor: 'pointer',
    },
    checkInBannerText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.infoText,
      textAlign: 'center',
    },
    checkInHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.lanternSurface,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.lantern,
    },
    checkInHintText: {
      flexShrink: 1,
      marginRight: spacing.xs,
      fontSize: 13,
      fontWeight: '600',
      color: colors.lantern,
    },
    checkInHintCancel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.lantern,
      textDecorationLine: 'underline',
    },
    energyStrip: {
      marginBottom: spacing.xs,
    },
    energyStripLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: spacing.xs,
    },
    energyRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    energyChip: {
      marginRight: 6,
      marginBottom: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    energyErrorText: {
      fontSize: 12,
      color: colors.dangerText,
      marginTop: 2,
    },
    // FP-08 FR-17: the Side Quest card, rendered inside the assistant bubble.
    questCard: {
      marginTop: 10,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: spacing.sm,
      gap: 3,
    },
    questEyebrow: {
      fontSize: 10,
      letterSpacing: 1.2,
      fontWeight: '700',
      color: colors.accent,
    },
    questTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    questMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    questRationale: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    questActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.xs,
    },
    questAccept: {
      borderRadius: radius.md,
      paddingVertical: 8,
      paddingHorizontal: 14,
      backgroundColor: colors.accent,
    },
    questAcceptDisabled: {
      opacity: 0.6,
    },
    questAcceptText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.onAccent,
    },
    questDeclineText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    questStateText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: spacing.xs,
    },
    questErrorText: {
      fontSize: 12,
      color: colors.dangerText,
      marginTop: spacing.xs,
    },
    // Oath Confirm Affordance (D26, FP-08 FR-10)
    oathCard: {
      marginTop: 10,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: spacing.sm,
      gap: 4,
    },
    oathCardSealed: {
      borderColor: colors.borderSubtle,
      opacity: 0.9,
    },
    oathHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    oathEyebrow: {
      fontSize: 10,
      letterSpacing: 1.2,
      fontWeight: '700',
      color: colors.accent,
    },
    oathStatusDemanded: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      color: colors.warning,
    },
    oathStatusSealed: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      color: colors.success,
    },
    oathDescription: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    oathButton: {
      marginTop: 6,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
      alignSelf: 'flex-start',
    },
    oathButtonActive: {
      backgroundColor: colors.accent,
    },
    oathButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.accent,
    },
    oathButtonTextActive: {
      color: colors.onAccent,
    },
    oathSupersededText: {
      marginTop: 4,
      fontSize: 11,
      fontStyle: 'italic',
      color: colors.textTertiary,
    },
    oathComposerBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.accent,
      borderTopLeftRadius: radius.md,
      borderTopRightRadius: radius.md,
      marginBottom: -1,
    },
    oathComposerBannerTextCol: {
      flex: 1,
      gap: 2,
    },
    oathComposerBannerTitle: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      color: colors.accent,
    },
    oathComposerBannerSubtitle: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    oathCancelButton: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      marginLeft: 8,
    },
    oathCancelButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
    },
    sendButtonOath: {
      backgroundColor: colors.accent,
    },
    sendButtonOathText: {
      color: colors.onAccent,
      fontWeight: '700',
    },
  });
}
