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

/** Post a chat message to send-message Edge Function */
export async function sendChatMessage(
  userId: string,
  content: string,
  clientMessageId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    logger.warn('chat', 'sendChatMessage skipped: no auth session');
    return { ok: false, error: 'no_session' };
  }

  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) {
    logger.warn('chat', 'sendChatMessage skipped: no Supabase URL configured');
    return { ok: false, error: 'no_config' };
  }

  const clientSentAt = new Date().toISOString();

  try {
    const result = await traceNetworkCall('chat', 'send-message', async () => {
      const res = await fetch(`${base}/functions/v1/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          client_message_id: clientMessageId,
          client_sent_at: clientSentAt,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      return await res.json().catch(() => ({}));
    });

    return { ok: true };
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
