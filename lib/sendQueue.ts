// lib/sendQueue.ts
// Offline send queue (FP-02 Step 9 — FR-16, AC-8; TECH-SPECS §7.10).
//
// A composer message the server never accepted is persisted to the device and replayed, in
// tap order, once connectivity returns — so an offline tap, a killed app or a failed
// network call can no longer lose a message.
//
// Scope: this module owns storage, ordering, dedupe and the retry gate. It performs **no
// network I/O** — no HTTP client, no function invocation, no database handle. `chat.tsx`
// keeps `send()` and the replay triggers, because sending needs the `[SPEC]` limits, the dev
// forcer and the reply watchdog — and because a queue that cannot reach the network is pure
// enough to unit-test without React or a live backend.
//
// What deliberately does NOT live here: a turn the server **accepted**. That row is in
// `messages`; if its reply never arrived the thread renders it as an unanswered turn
// (`unansweredUserRows` in `lib/chat.ts`) whose Retry repairs it server-side (§5.1). The
// queue therefore holds only turns the server has not acknowledged — which is also what
// makes replay idempotent: every item carries the `client_message_id` it was minted with
// (FR-16), so the unique (user_id, client_message_id) index turns a duplicate replay into a
// no-op or a repair, never a second row.
//
// Per-user scoping is load-bearing: replay authenticates with the *current* session, so a
// single shared key would send user A's text as user B.
//
// Refs: FP-02 FR-16, AC-8; TECH-SPECS §3.2, §7.10, §11; D23; AGENTS.md §2 (no hardcoded
// [SPEC] values), §4.1.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { logger } from "./logger";

/**
 * Why an item is waiting. It selects the replay gate, so it is not cosmetic:
 *   `offline` — the device had no connectivity, so nothing was transmitted and a replay is
 *               safe as soon as the network returns.
 *   `unknown` — the request failed with no HTTP status after being sent (fetch error,
 *               abort, `chat_send_timeout_ms`), so the server may or may not have accepted
 *               it. Replaying can start a second pipeline run while the first is still
 *               alive, so it waits out `chat_retry_holdoff_ms` (Step 5a's rule).
 */
export type QueueReason = "offline" | "unknown";

export interface QueuedSend {
  clientMessageId: string;
  content: string;
  /** Tap time; the ordering truth reused verbatim on every replay (§3.2). */
  clientSentAt: string;
  /** Epoch ms from which a replay is allowed (0 = immediately). */
  retryAt: number;
  /** Replays attempted since enqueue; diagnostics only, never a cap. */
  attempts: number;
  reason: QueueReason;
}

const STORAGE_KEY_PREFIX = "davos.send_queue.v1";

/** The storage key for a user's queue. Exported for tests and for the demo replay script. */
export function storageKeyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}.${userId}`;
}

/** Mirrors the server's `client_message_id` validation (`send-message` UUID_RE). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An item that cannot be ordered sorts to the front rather than being thrown away. */
const EPOCH_ISO = new Date(0).toISOString();

function timeMs(iso: unknown): number {
  if (typeof iso !== "string") return NaN;
  return Date.parse(iso);
}

/**
 * Pure: validate one stored entry, or null when it is unusable. `clientSentAt` is coerced
 * to the epoch rather than rejecting the entry — losing the user's text is worse than
 * replaying it out of order, and it can only be missing when the blob was hand-edited or
 * partially written.
 */
export function parseQueuedSend(raw: unknown): QueuedSend | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const clientMessageId = typeof o.clientMessageId === "string" ? o.clientMessageId : "";
  if (!UUID_RE.test(clientMessageId)) return null;
  if (typeof o.content !== "string" || o.content.trim().length === 0) return null;

  const clientSentAt = Number.isNaN(timeMs(o.clientSentAt)) ? EPOCH_ISO : (o.clientSentAt as string);
  const retryAt =
    typeof o.retryAt === "number" && Number.isFinite(o.retryAt) && o.retryAt > 0 ? o.retryAt : 0;
  const attempts =
    typeof o.attempts === "number" && Number.isInteger(o.attempts) && o.attempts > 0
      ? o.attempts
      : 0;
  const reason: QueueReason = o.reason === "offline" ? "offline" : "unknown";

  return { clientMessageId, content: o.content, clientSentAt, retryAt, attempts, reason };
}

/** Pure: oldest tap first. `clientMessageId` breaks ties so the order is total. */
export function sortQueueAsc(list: QueuedSend[]): QueuedSend[] {
  return [...list].sort((a, b) => {
    const delta = timeMs(a.clientSentAt) - timeMs(b.clientSentAt);
    if (delta !== 0 && !Number.isNaN(delta)) return delta;
    if (a.clientMessageId === b.clientMessageId) return 0;
    return a.clientMessageId < b.clientMessageId ? -1 : 1;
  });
}

/**
 * Pure: parse a stored blob (or null) into a bounded, ordered, deduped queue.
 *
 * Load-time truncation keeps the **newest** `max` items: a stale blob is the only way to
 * exceed the cap here, and the oldest taps are the least likely to still matter. Enqueue is
 * stricter — see `enqueueInto`.
 */
export function parseQueue(raw: unknown, max: number): QueuedSend[] {
  if (typeof raw !== "string" && (!raw || typeof raw !== "object")) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const parsed: QueuedSend[] = [];
  for (const entry of value) {
    const item = parseQueuedSend(entry);
    if (!item) continue;
    if (seen.has(item.clientMessageId)) continue;
    seen.add(item.clientMessageId);
    parsed.push(item);
  }

  const ordered = sortQueueAsc(parsed);
  return max > 0 && ordered.length > max ? ordered.slice(-max) : ordered;
}

/**
 * Pure: add or replace an item by `clientMessageId`, keeping tap order.
 *
 * A full queue **refuses the new item** instead of evicting the oldest. Eviction would
 * silently discard a message the user believes is waiting; refusing lets the caller say so
 * and keep the text on screen, and it never touches what is already stored.
 */
export function enqueueInto(
  list: QueuedSend[],
  item: QueuedSend,
  max: number,
): { queue: QueuedSend[]; accepted: boolean } {
  const without = list.filter((entry) => entry.clientMessageId !== item.clientMessageId);
  const replacing = without.length !== list.length;
  if (!replacing && without.length >= max) return { queue: list, accepted: false };
  return { queue: sortQueueAsc([...without, item]), accepted: true };
}

/** Pure: drop one item. */
export function removeFrom(list: QueuedSend[], clientMessageId: string): QueuedSend[] {
  return list.filter((entry) => entry.clientMessageId !== clientMessageId);
}

/** Pure: items whose retry gate has opened — the replay walk's work list, in order. */
export function dueItems(list: QueuedSend[], now: number): QueuedSend[] {
  return sortQueueAsc(list).filter((entry) => entry.retryAt <= now);
}

/** Pure: earliest future retry gate, or null when nothing is waiting. */
export function nextDueAt(list: QueuedSend[], now: number): number | null {
  let earliest = Number.POSITIVE_INFINITY;
  for (const entry of list) {
    if (entry.retryAt > now && entry.retryAt < earliest) earliest = entry.retryAt;
  }
  return Number.isFinite(earliest) ? earliest : null;
}

// ============================================================================
// Store
// ============================================================================

let queue: QueuedSend[] = [];
let currentUserId: string | null = null;
let currentMax = 0;
let loaded = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

async function persist(): Promise<void> {
  if (!currentUserId) return;
  try {
    await AsyncStorage.setItem(storageKeyFor(currentUserId), JSON.stringify(queue));
  } catch (err) {
    // The in-memory queue is still correct for this session; a storage failure only costs
    // durability, so it must never surface as a send error.
    logger.warn("chat", "sendQueue persist failed", undefined, err);
  }
}

/**
 * Pure: true when a stored blob is not a readable queue array. A corrupt blob would
 * otherwise be re-parsed on every launch, so it is cleared rather than tolerated.
 */
function isCorruptBlob(raw: string): boolean {
  try {
    return !Array.isArray(JSON.parse(raw) as unknown);
  } catch {
    return true;
  }
}

/**
 * Load a user's queue. Call once the `config` limits are available, because the cap is a
 * `[SPEC]` value (`chat_queue_max_items`) rather than a constant.
 *
 * Called again for a different user it reloads from that user's own key. An unreadable or
 * corrupt blob is discarded (and the key cleared) so the app can never be stuck failing to
 * start on its own queue.
 */
export async function loadSendQueue(userId: string, maxItems: number): Promise<void> {
  if (loaded && userId === currentUserId && maxItems === currentMax) return;

  currentUserId = userId;
  currentMax = maxItems;
  loaded = true;

  const key = storageKeyFor(userId);
  try {
    const raw = await AsyncStorage.getItem(key);
    queue = raw ? parseQueue(raw, maxItems) : [];
    if (raw && isCorruptBlob(raw)) {
      await AsyncStorage.removeItem(key);
    }
  } catch (err) {
    logger.warn("chat", "sendQueue load failed", undefined, err);
    queue = [];
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Nothing more to do: the in-memory queue is empty either way.
    }
  }
  emit();
}

export function getSendQueue(): QueuedSend[] {
  return queue;
}

/** Reactive read for the chat screen. */
export function useSendQueue(): QueuedSend[] {
  return useSyncExternalStore(subscribe, getSendQueue, getSendQueue);
}

/**
 * Persist an unsent message. Returns false when the queue is full — the caller keeps the
 * bubble on screen and tells the user, rather than the item vanishing without a trace.
 */
export async function enqueueSend(item: QueuedSend): Promise<boolean> {
  if (!currentUserId) {
    logger.warn("chat", "sendQueue enqueue before load; message not queued");
    return false;
  }
  const { queue: next, accepted } = enqueueInto(queue, item, currentMax);
  if (!accepted) {
    logger.warn("chat", `sendQueue is full (${currentMax}); refusing ${item.clientMessageId}`);
    return false;
  }
  queue = next;
  emit();
  await persist();
  return true;
}

/** Drop an item — called as soon as the server acknowledges the turn. */
export async function removeSend(clientMessageId: string): Promise<void> {
  const next = removeFrom(queue, clientMessageId);
  if (next.length === queue.length) return;
  queue = next;
  emit();
  await persist();
}

/**
 * Record a failed replay: bump the attempt count and open the next retry gate. The item
 * stays queued — only a server acknowledgement removes it.
 */
export async function markQueueAttempt(
  clientMessageId: string,
  retryAt: number,
): Promise<void> {
  let changed = false;
  const next = queue.map((entry) => {
    if (entry.clientMessageId !== clientMessageId) return entry;
    changed = true;
    return { ...entry, attempts: entry.attempts + 1, retryAt };
  });
  if (!changed) return;
  queue = next;
  emit();
  await persist();
}

/** Test helper: forget the cache and subscribers. */
export function resetSendQueueForTests(): void {
  queue = [];
  currentUserId = null;
  currentMax = 0;
  loaded = false;
  listeners.clear();
}

/**
 * Drop a user's queued sends from both storage and memory (account reset/delete,
 * Decision 27). Unlike `resetSendQueueForTests` this touches one user's persisted key and
 * keeps the module usable: the next `loadSendQueue` re-reads an empty blob.
 */
export async function clearSendQueue(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKeyFor(userId));
  } catch (err) {
    logger.warn("chat", "sendQueue clear failed", undefined, err);
  }
  if (currentUserId !== userId) return;
  queue = [];
  emit();
}
