// supabase/functions/_shared/memory/boundary.ts
// FP-06 Step 4 — the pure half of the window-boundary trigger (TECH-SPEC §7.6).
// Refs: FP-06 FR-3; TECH-SPEC §7.6, §5.3 (the fresh-insert clause precedent), §11; D6.
// Pure (jest-loadable): the count query and the job insert live in send-message/index.ts.

/**
 * The boundary rule: a crossing happens when the user-message count is a positive
 * multiple of the window size. The count is Postgres `count(*)` over the user's
 * user-role rows in `messages` after the fresh row lands — all sources (chat and
 * check-in writes alike) — and it advances exactly once per real message because the
 * call sits in the fresh-insert branch only (duplicate sends, §5.1 repairs and offline
 * replays take the other branch).
 */
export function shouldExtractAtBoundary(count: number, windowSize: number): boolean {
  if (!Number.isFinite(count) || !Number.isFinite(windowSize)) return false;
  if (windowSize <= 0) return false;
  return count > 0 && count % windowSize === 0;
}

/** The `memory_extract` job payload: the user, and the boundary count for the run log. */
export function buildMemoryExtractPayload(
  userId: string,
  boundary: number,
): { user_id: string; boundary: number } {
  return { user_id: userId, boundary };
}
