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

/** Flush the queue sequentially; stops at the first item that must wait. */
export async function flushQueue(
  userId: string,
  submitFn: (
    content: string,
    windowTs: number,
  ) => Promise<{ ok: boolean; error?: string; permanent?: boolean }>,
  nowMs: number,
): Promise<{ drained: boolean; remaining: number }> {
  const entries = await loadQueue(userId);
  if (entries.length === 0) return { drained: true, remaining: 0 };

  // Exponential backoff: 1m, 2m, 4m, 8m, 15m (capped). `attempts` is diagnostics-only — like
  // `sendQueue`, a transient failure is never given up on. A **permanent** rejection is
  // different: a 4xx (a window gone stale, an off-grid hint) can never succeed on replay, so
  // it is dropped instead of retried — otherwise one stale check-in would sit at the head and
  // block every later one forever (the "stops at the first non-draining item" rule stops the
  // walk for a *retryable* item; a given-up item is consumed and the walk continues).
  const backoffMs = [60_000, 120_000, 240_000, 480_000, 900_000];

  const remaining: QueuedCheckIn[] = [];
  let stopped = false;
  for (const entry of entries) {
    if (stopped) {
      remaining.push(entry);
      continue;
    }
    if (entry.retryAt > nowMs) {
      // Not due yet — stop the walk here (sendQueue pattern).
      stopped = true;
      remaining.push(entry);
      continue;
    }

    const { ok, error, permanent } = await submitFn(entry.content, entry.windowTs);
    if (ok) continue; // drained — drop it

    if (permanent) {
      console.warn(`[checkin] dropping a permanently-rejected check-in (${error ?? "4xx"})`);
      continue;
    }

    // Transient failure — schedule a retry and stop the walk.
    const nextAttempt = entry.attempts + 1;
    remaining.push({
      ...entry,
      retryAt: nowMs + backoffMs[Math.min(nextAttempt, backoffMs.length - 1)],
      attempts: nextAttempt,
    });
    stopped = true;
  }

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