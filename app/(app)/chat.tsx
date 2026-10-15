import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { loadConfig, requireConfigNumber, useConfig } from '../../lib/config';
import { makeClientMessageId } from '../../lib/ids';
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
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString();
}

export default function ChatScreen() {
  const { user } = useAuth();
  const config = useConfig();

  const [rows, setRows] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<ChatError | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);

  const limits = useMemo<ChatLimits | null>(() => {
    if (config.status !== 'loaded') return null;
    try {
      return {
        maxChars: requireConfigNumber('chat_max_message_chars'),
        sendTimeoutMs: requireConfigNumber('chat_send_timeout_ms'),
        watchdogMs: requireConfigNumber('chat_realtime_watchdog_ms'),
        retryHoldoffMs: requireConfigNumber('chat_retry_holdoff_ms'),
        lastN: requireConfigNumber('chat_last_n'),
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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // First connect, and every reconnect: reconcile from the server.
          void fetchMessages();
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[chat] Realtime channel error');
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

  // Reconcile when the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchMessages();
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

  const send = useCallback(
    async (args: { clientMessageId: string; content: string; clientSentAt: string }) => {
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

      const fail = (error: unknown) => {
        const chatError = classifyError(error);
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

      try {
        const { data, error } = await supabase.functions.invoke('send-message', {
          body,
          timeout: limits.sendTimeoutMs,
        });

        if (error) {
          fail(error);
          return;
        }

        const assistantMessageId =
          (data as { assistant_message_id?: string | null } | null)?.assistant_message_id ?? null;

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
        fail(err);
      }
    },
    [user, limits, scheduleWatchdog, fetchMessages],
  );

  const thinking = pending.some(
    (entry) => entry.state === 'sending' || entry.state === 'awaiting-reply',
  );

  // Retire optimistic entries once their turn has a rendered reply.
  useEffect(() => {
    setPending((prev) => {
      const next = pruneResolvedPending(prev, rows);
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  const items = useMemo(
    () =>
      buildChatItems({
        rows,
        pending,
        retryHoldoffMs: limits?.retryHoldoffMs ?? 0,
        now,
      }),
    [rows, pending, limits, now],
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
      // The same client_message_id is reused, so the server dedupes/repairs the turn
      // instead of running the pipeline twice.
      void send({
        clientMessageId: item.clientMessageId,
        content: existing?.content ?? item.content,
        clientSentAt: existing?.clientSentAt ?? item.clientSentAt ?? new Date().toISOString(),
      });
    },
    [limits, thinking, pending, send],
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
