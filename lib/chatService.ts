// lib/chatService.ts
// Domain service for Chat messages, Realtime updates, and Edge Function invocation.
// Bridges Supabase messages table and send-message pipeline to UI ThreadMessage contract.

import { supabase } from './supabase';
import { logger } from './logger';
import { traceNetworkCall } from './observability';
import { enqueueSend } from './sendQueue';
import type { ThreadMessage } from '../fixtures/davos';

export interface MessageRow {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  unsavable: boolean;
  client_message_id: string | null;
  reply_to_message_id: string | null;
  client_sent_at: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export function formatMessageTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '12:00';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '12:00';
  }
}

export function toThreadMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'davos' : 'user',
    text: row.content,
    time: formatMessageTime(row.client_sent_at || row.created_at),
    sendState: 'sent',
  };
}

/** Fetch today's conversation messages from messages table */
export async function fetchTodayMessages(
  userId: string,
  planDate: string
): Promise<ThreadMessage[]> {
  if (!userId) return [];
  try {
    const startIso = `${planDate}T00:00:00.000Z`;
    const endIso = `${planDate}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from('messages')
      .select('id, user_id, role, content, unsavable, client_message_id, reply_to_message_id, client_sent_at, created_at, metadata')
      .eq('user_id', userId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true });

    if (error || !data) {
      return [];
    }

    return (data as MessageRow[]).map(toThreadMessage);
  } catch (err) {
    logger.warn('chat', 'Failed to fetch today messages', undefined, err);
    return [];
  }
}

/** Fetch a single message by ID (used as watchdog fallback if Realtime is delayed) */
export async function fetchSingleMessage(messageId: string): Promise<ThreadMessage | null> {
  if (!messageId) return null;
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('id, user_id, role, content, unsavable, client_message_id, reply_to_message_id, client_sent_at, created_at, metadata')
      .eq('id', messageId)
      .maybeSingle();

    if (error || !data) return null;
    return toThreadMessage(data as MessageRow);
  } catch (err) {
    logger.warn('chat', 'Failed to fetch single message', undefined, err);
    return null;
  }
}

/** Post a chat message to send-message Edge Function */
export async function sendChatMessage(
  userId: string,
  content: string,
  clientMessageId: string
): Promise<{ ok: boolean; error?: string; assistantMessageId?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    logger.warn('chat', 'sendChatMessage skipped: no auth session');
    return { ok: false, error: 'no_session' };
  }

  const clientSentAt = new Date().toISOString();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  try {
    const result = await traceNetworkCall('chat', 'send-message', async () => {
      const { data, error } = await supabase.functions.invoke('send-message', {
        headers: {
          apikey: anonKey,
        },
        body: {
          content,
          client_message_id: clientMessageId,
          client_sent_at: clientSentAt,
        },
      });

      if (error) {
        let errorMessage = error.message;
        if ('context' in error && error.context && typeof (error.context as any).json === 'function') {
          try {
            const errJson = await (error.context as any).json();
            if (errJson.error) errorMessage = errJson.error;
          } catch {}
        }
        throw new Error(errorMessage || 'Failed to send message');
      }

      return data as { user_message_id?: string; assistant_message_id?: string; status?: string };
    });

    return { ok: true, assistantMessageId: result?.assistant_message_id };
  } catch (err: any) {
    logger.error('chat', 'send-message pipeline invocation failed', undefined, err);
    // Enqueue to offline send queue for ordered replay on reconnect
    try {
      await enqueueSend({
        clientMessageId,
        content,
        clientSentAt,
        retryAt: 0,
        attempts: 0,
        reason: 'unknown',
      });
    } catch {}
    return { ok: false, error: err?.message || 'send_failed' };
  }
}

/** Subscribe to realtime messages for user */
export function subscribeToUserMessages(
  userId: string,
  onNewMessage: (msg: ThreadMessage) => void
): () => void {
  if (!userId) return () => {};

  const channel = supabase
    .channel(`messages_user_${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new) {
          const row = payload.new as MessageRow;
          onNewMessage(toThreadMessage(row));
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
