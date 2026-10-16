import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import {
  ActivityIndicator,
  AppState,
  FlatList,
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
  useFocusEffect(
    useCallback(() => {
      configureNotificationHandler(() => true);
      // Returning to the chat tab is also a good moment to drain the offline queue.
      flushRef.current?.();
      return () => configureNotificationHandler(() => false);
    }, []),
  );

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
    void send({
      clientMessageId: makeClientMessageId(),
      content,
      clientSentAt: new Date().toISOString(),
    });
  }, [draft, limits, thinking, send]);

  const onRetry = useCallback(
    (item: ChatItem) => {
      if (!limits || !item.clientMessageId || thinking) return;
      const existing = pending.find(
        (entry) => entry.clientMessageId === item.clientMessageId,
      );
      // An item still held by the device queue must fail back into the queue (re-gate it),
      // not into an in-memory failure it would then be duplicated by.
      const inQueue = queued.some((entry) => entry.clientMessageId === item.clientMessageId);
      // The same client_message_id is reused, so the server dedupes/repairs the turn
      // instead of running the pipeline twice.
      void send(
        {
          clientMessageId: item.clientMessageId,
          content: existing?.content ?? item.content,
          clientSentAt: existing?.clientSentAt ?? item.clientSentAt ?? new Date().toISOString(),
        },
        inQueue ? 'queue' : 'composer',
      );
    },
    [limits, thinking, pending, queued, send],
  );

  const renderItem = ({ item }: { item: ChatItem }) => {
    const isUser = item.role === 'user';
    const failed = item.state === 'failed';

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
              <Pressable onPress={() => onRetry(item)} hitSlop={8}>
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
              <Pressable onPress={() => onRetry(item)} disabled={!item.canRetry} hitSlop={8}>
                <Text style={[styles.retryText, !item.canRetry && styles.retryTextDisabled]}>
                  {item.canRetry ? 'Retry' : 'Retry (waiting…)'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading messages...</Text>
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
            <Pressable onPress={() => void loadConfig()} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        style={styles.threadList}
        contentContainerStyle={styles.threadContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No messages yet. Davos will speak first.</Text>
        }
      />

      <View style={styles.inputContainer}>
        {thinking ? (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color="#666" />
            <Text style={styles.thinkingText}>Davos is thinking…</Text>
          </View>
        ) : null}

        <View style={styles.composerRow}>
          <TextInput
            style={styles.input}
            placeholder={composerDisabled ? 'Davos will speak first' : 'Message Davos'}
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
  },
  threadList: {
    flex: 1,
    marginBottom: 16,
  },
  threadContent: {
    paddingBottom: 16,
  },
  emptyText: {
    color: '#999',
    textAlign: 'center',
    marginTop: 32,
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
    fontSize: 16,
  },
  assistantText: {
    color: '#111',
    fontSize: 16,
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
    color: '#999',
    marginTop: 4,
    alignSelf: 'flex-end',
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
    fontSize: 15,
    fontWeight: '600',
  },
});
