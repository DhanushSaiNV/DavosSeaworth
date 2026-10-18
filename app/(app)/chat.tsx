import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { loadConfig, requireConfigBoolean, requireConfigNumber, useConfig } from '../../lib/config';
import { devForcePayload, useDevOverrides } from '../../lib/devOverrides';
import { makeClientMessageId } from '../../lib/ids';
import { configureNotificationHandler } from '../../lib/push';
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

export default function ChatScreen() {
  const { user } = useAuth();
  const config = useConfig();
  const devOverrides = useDevOverrides();

  const [rows, setRows] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<ChatError | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Option-message id → persona key, while a chip tap is in flight (chips disabled). */
  const [selectingChip, setSelectingChip] = useState<Record<string, string>>({});

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

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
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
      console.error('[chat] config error:', err);
      return null;
    }
  }, [config.status]);

  // Config failed, or is missing a key: there is nothing safe to fetch, so don't leave
  // the screen on a permanent spinner — render it so the banner (with Retry) is visible.
  useEffect(() => {
    if (config.status === 'error' || (config.status === 'loaded' && !limits)) {
      setLoading(false);
    }
  }, [config.status, limits]);

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
      console.warn('[chat] dev_overrides_enabled unavailable:', err);
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
      // dependency, so the effect re-runs on sign-in and never reads a stale id.
      flushRef.current?.();
      if (userId) void flushCheckins(userId);
      return () => configureNotificationHandler(() => false);
    }, [userId]),
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
    if (focusParam !== 'checkin' || !userId) return;
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
  }, [focusParam, windowTsParam, userId]);

  // FR-14: on chat open, the newest doing still missing energy offers the chips. Own rows only,
  // through the table's RLS policy — no API surface change.
  useEffect(() => {
    if (!userId) return;
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
          console.warn('[chat] null-energy doing lookup failed:', error.message);
          return;
        }
        const row = (data ?? [])[0] as { id: string } | undefined;
        if (!cancelled && row) setEnergyDoingId((prev) => prev ?? row.id);
      } catch (err) {
        console.warn('[chat] null-energy doing lookup threw:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Whether this window is answered lives in the pending store (FR-4, client-local state).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const at = await getLastCheckInResponseAt(userId);
      if (!cancelled) setLastAnsweredMs(at);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // The banner's visibility is a function of the clock; a local tick keeps it current with no
  // network traffic at all. Native has no banner — the OS notification is its surface.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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
        console.error('[chat] fetch failed:', error.message);
        return;
      }

      setRows(mergeRows([], (data ?? []) as Message[]));
    } catch (err) {
      console.error('[chat] fetch failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, limits]);

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
            console.error(
              `[chat] Realtime ${status} x${failures} with no successful rejoin — the subscription is not recovering; check the publication/RLS. Reconciling on every failure meanwhile:`,
              err?.message ?? 'no reason provided',
              (err as { cause?: unknown } | undefined)?.cause ?? ''
            );
          } else {
            console.warn(
              `[chat] Realtime ${status === 'TIMED_OUT' ? 'join timeout' : 'socket dropped'}:`,
              err?.message ?? 'no reason provided',
              (err as { cause?: unknown } | undefined)?.cause ?? ''
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
              console.warn('[chat] watchdog select failed:', error.message);
              return;
            }
            if (data) setRows((prev) => mergeRows(prev, [data as Message]));
          } catch (err) {
            console.warn('[chat] watchdog select threw:', err);
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
      args: { clientMessageId: string; content: string; clientSentAt: string },
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
          await fail(new Error('no_session'));
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
          const err = await res.json().catch(() => ({}));
          await fail(err);
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
      console.error('[chat] queue replay failed:', err);
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

  const thinking =
    pending.some((entry) => entry.state === 'sending' || entry.state === 'awaiting-reply') ||
    Object.keys(selectingChip).length > 0;

  // Retire optimistic entries once their turn has a rendered reply.
  useEffect(() => {
    setPending((prev) => {
      const next = pruneResolvedPending(prev, rows);
      return next.length === prev.length ? prev : next;
    });
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
      });
    }
  }, [draft, limits, thinking, send, checkInMode, checkInWindowTs, sendCheckIn]);

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
          console.warn('[chat] energy patch failed:', await res.text().catch(() => ''));
          return false;
        }
        return true;
      } catch (err) {
        console.warn('[chat] energy patch threw:', err);
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
      setEnergyBusy(true);
      setEnergyError(null);
      try {
        const ok = await patchEnergy(energyDoingId, value);
        if (ok) {
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

    return (
      <View
        style={[
          styles.messageContainer,
          isUser ? styles.userMessage : styles.assistantMessage,
          failed && styles.failedMessage,
        ]}>
        <Text style={[styles.messageText, isUser ? styles.userText : styles.assistantText]}>
          {item.content}
        </Text>

        {item.state === 'sending' ? <Text style={styles.metaText}>Sending…</Text> : null}
        {item.state === 'awaiting-reply' ? <Text style={styles.metaText}>Sent</Text> : null}
        {logged ? <Text style={styles.metaText}>✓ Logged</Text> : null}

        {item.state === 'queued' ? (
          <View style={styles.queueRow}>
            <Text style={styles.queueText}>
              {item.reason === 'offline'
                ? 'Queued — will send when you are back online.'
                : 'Not sent — waiting to retry.'}
            </Text>
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

        {failed ? (
          <View style={styles.failedRow}>
            <Text style={styles.failedText}>{item.error?.message ?? 'Not sent.'}</Text>
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

        <Text
          style={[styles.timestamp, isUser ? styles.userTimestamp : styles.assistantTimestamp]}>
          {formatTime(item.createdAt)}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </View>
    );
  }

  const composerDisabled = config.status !== 'loaded' || limits === null;
  const canSend = !composerDisabled && !thinking && draft.trim().length > 0;

  return (
    <View style={styles.container}>
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
      {bannerWindow ? (
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
      {checkInMode && checkInWindowTs !== null ? (
        <View style={styles.checkInHint}>
          <Text style={styles.checkInHintText}>
            Check-in{checkInWindowLabel ? `: ${checkInWindowLabel}` : ''} — straight to your log, not the chat
          </Text>
          <Pressable onPress={cancelCheckIn} accessibilityRole="button" hitSlop={8}>
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
        contentContainerStyle={styles.threadContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No messages yet. Davos will speak first.</Text>
          </View>
        }
      />

      <View style={styles.inputContainer}>
        {/* Energy chips (FR-14): offered after a check-in that carried no rating, or on open for
            the newest null-energy doing. The strip settles once the PATCH is confirmed. */}
        {energyDoingId !== null ? (
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
        ) : energySettled !== null ? (
          <View style={styles.energyStrip}>
            <Text style={styles.energyStripLabel}>{energyLabel(energySettled)}</Text>
          </View>
        ) : checkInNote ? (
          <View style={styles.energyStrip}>
            <Text style={styles.energyStripLabel}>{checkInNote}</Text>
          </View>
        ) : null}

        {thinking ? (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color="#666" />
            <Text style={styles.thinkingText}>Davos is thinking…</Text>
          </View>
        ) : null}

        <View style={styles.composerRow}>
          <TextInput
            style={styles.input}
            placeholder={
              composerDisabled
                ? 'Davos will speak first'
                : checkInMode
                  ? 'What did you do this hour?'
                  : 'Message Davos'
            }
            placeholderTextColor="#999"
            value={draft}
            onChangeText={setDraft}
            editable={!composerDisabled}
            multiline
            maxLength={limits?.maxChars}
          />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={checkInMode ? 'Send check-in' : 'Send message'}
            accessibilityState={{ disabled: !canSend }}
            style={[styles.sendButton, canSend ? styles.sendButtonEnabled : styles.sendButtonDisabled]}>
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 14,
  },
  threadList: {
    flex: 1,
    marginBottom: 16,
  },
  threadContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: '#999',
    textAlign: 'center',
  },
  messageContainer: {
    maxWidth: '80%',
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#000',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#f0f0f0',
  },
  failedMessage: {
    borderWidth: 1,
    borderColor: '#c0392b',
  },
  messageText: {
    fontSize: 16,
  },
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: '#111',
  },
  metaText: {
    fontSize: 10,
    color: '#bbb',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  chipsRow: {
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  chipChosen: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  chipLabelChosen: {
    color: '#fff',
  },
  chipOneLiner: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  failedRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  failedText: {
    color: '#ffd6d0',
    fontSize: 12,
    flexShrink: 1,
    marginRight: 8,
  },
  /** The offline-queue note: informational, not a failure, so it is not red. */
  queueRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queueText: {
    color: '#d8d8d8',
    fontSize: 12,
    flexShrink: 1,
    marginRight: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  retryTextDisabled: {
    color: '#bbb',
    textDecorationLine: 'none',
  },
  timestamp: {
    fontSize: 10,
    color: '#6b6b6b',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  /** Timestamps sit on both a dark (user) and a light (assistant) bubble, so the
      tone is chosen per bubble for legibility rather than a single fixed grey. */
  userTimestamp: {
    color: '#b3b3b3',
  },
  assistantTimestamp: {
    color: '#6b6b6b',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  noticeText: {
    color: '#666',
    fontSize: 12,
    flexShrink: 1,
    marginRight: 8,
  },
  /** The notice row sits on the plain white screen, so its action needs a dark tone
      (the bubble-scoped `retryText` is white and would be invisible here). */
  noticeRetryText: {
    color: '#111',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  banner: {
    backgroundColor: '#fdecea',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  bannerText: {
    color: '#c0392b',
    fontSize: 12,
    flexShrink: 1,
  },
  inputContainer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  thinkingText: {
    color: '#666',
    fontSize: 12,
    marginLeft: 8,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#f5f5f5',
    color: '#111',
    fontSize: 16,
  },
  sendButton: {
    marginLeft: 8,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonEnabled: {
    backgroundColor: '#000',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  checkInBanner: {
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#90caf9',
  },
  checkInBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    textAlign: 'center',
  },
  checkInHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ffb74d',
  },
  checkInHintText: {
    flexShrink: 1,
    marginRight: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#e65100',
  },
  checkInHintCancel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#e65100',
    textDecorationLine: 'underline',
  },
  energyStrip: {
    marginBottom: 10,
  },
  energyStripLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  energyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  energyChip: {
    marginRight: 6,
    marginBottom: 6,
  },
  energyErrorText: {
    fontSize: 12,
    color: '#c0392b',
    marginTop: 2,
  },
});
