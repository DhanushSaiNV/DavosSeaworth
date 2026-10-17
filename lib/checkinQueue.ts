// lib/checkinQueue.ts
// FP-04 Step 4 — pending check-in store (AsyncStorage + sendQueue pattern).
//
// Refs: FP-04 FR-2, FR-3; TECH-SPEC §8; D9.
// Entries are idempotent end-to-end via the window unique index (Step 1).

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface QueuedCheckIn {
  content: string;
  windowTs: number;
  retryAt: number;
  attempts: number;
}

const QUEUE_PREFIX = "checkin_queue_";

function queueKey(userId: string): string {
  return `${QUEUE_PREFIX}${userId}`;
}

/** Load the queue for a user. */
export async function loadQueue(userId: string): Promise<QueuedCheckIn[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Save the queue for a user. */
async function saveQueue(userId: string, entries: QueuedCheckIn[]): Promise<void> {
  await AsyncStorage.setItem(queueKey(userId), JSON.stringify(entries));
}

/** Enqueue a failed check-in submission. */
export async function enqueueCheckIn(
  userId: string,
  content: string,
  windowTs: number,
  nowMs: number,
): Promise<void> {
  const entries = await loadQueue(userId);
  entries.push({
    content,
    windowTs,
    retryAt: nowMs, // immediate first retry
    attempts: 0,
  });
  await saveQueue(userId, entries);
}

/** Flush the queue sequentially; stops at the first non-draining item. */
export async function flushQueue(
  userId: string,
  submitFn: (content: string, windowTs: number) => Promise<{ ok: boolean; error?: string }>,
  nowMs: number,
): Promise<{ drained: boolean; remaining: number }> {
  const entries = await loadQueue(userId);
  if (entries.length === 0) return { drained: true, remaining: 0 };

  // Exponential backoff: 1m, 2m, 4m, 8m, 15m (capped) — max 5 attempts
  const backoffMs = [60_000, 120_000, 240_000, 480_000, 900_000];

  let i = 0;
  for (; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.retryAt > nowMs) break; // not yet due

    // Check max attempts BEFORE calling submitFn
    if (entry.attempts >= backoffMs.length) {
      // max attempts reached — stop at this item (sendQueue pattern)
      break;
    }

    const { ok, error } = await submitFn(entry.content, entry.windowTs);
    if (ok) {
      // success — drop this entry, continue to next
      continue;
    }

    // failure — schedule retry with backoff
    const nextAttempt = entry.attempts + 1;
    const updated: QueuedCheckIn = {
      ...entry,
      retryAt: nowMs + backoffMs[nextAttempt],
      attempts: nextAttempt,
    };
    entries[i] = updated;
    await saveQueue(userId, entries);
    // stop at first non-draining item (sendQueue pattern)
    break;
  }

  // Remove successfully drained entries (0..i-1 if they all succeeded)
  const remaining = entries.slice(i);
  await saveQueue(userId, remaining);
  return { drained: remaining.length === 0, remaining: remaining.length };
}

/** Clear the queue (e.g., on logout). */
export async function clearQueue(userId: string): Promise<void> {
  await AsyncStorage.removeItem(queueKey(userId));
}

// Namespace export for convenient importing
export const checkinQueue = {
  loadQueue,
  enqueueCheckIn,
  flushQueue,
  clearQueue,
};