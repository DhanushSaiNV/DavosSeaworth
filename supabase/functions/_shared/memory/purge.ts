// supabase/functions/_shared/memory/purge.ts
// FP-06 Step 7 — the `purge_memory` runner, shared by the dispatcher and the memory drill
// (the `runExtract.ts` precedent: one implementation, one set of guarantees, drillable via
// `dev-smoke ?action=memory-drill&leg=purge`).
//
// Refs: FP-06 FR-1, FR-2; TECH-SPEC §7.6; D6.
//
// The whole job is one guarded UPDATE (pure SQL — no model call, no row delete, no
// re-embed): soft-delete every fact derived from the flagged message by provenance, leave
// already-purged rows and oath facts alone. Embeddings stay stale-but-excluded because
// every retrieval arm filters `purged_at is null` (§3.3).

import { supabaseService } from "../config.ts";

/** What one purge run did. `purged: 0` on a re-run is the idempotency contract. */
export interface PurgeReport {
  messageId: string;
  purged: number;
}

/**
 * Soft-delete the facts derived from `payload.message_id` (FR-2). Idempotent: the
 * `purged_at is null` filter makes a re-delivered job a no-op.
 */
export async function runPurgeMemory(payload: Record<string, unknown>): Promise<PurgeReport> {
  const messageId = typeof payload.message_id === "string" ? payload.message_id : "";
  if (!messageId) throw new Error("purge_memory: missing message_id in payload");

  const { data, error } = await supabaseService
    .from("memory_facts")
    .update({ purged_at: new Date().toISOString() })
    .eq("source_message_id", messageId)
    .is("purged_at", null)
    .neq("fact_type", "oath")
    .select("id");
  if (error) throw new Error(`purge_memory: update failed: ${error.message}`);

  return { messageId, purged: data?.length ?? 0 };
}
