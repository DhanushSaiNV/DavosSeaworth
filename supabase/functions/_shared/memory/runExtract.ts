// supabase/functions/_shared/memory/runExtract.ts
// FP-06 Step 3 — the `memory_extract` handler's impure half: window-cutoff backlog
// derivation, ≤32-message slices, per-slice extraction, provenance-guarded fact writes and
// the batched embedding. The dispatcher registers the handler over this, and `dev-smoke`
// drives the same functions for the drill (the runChain.ts / runWatchdog.ts pattern — one
// implementation, no drill copy).
// Refs: FP-06 FR-4, FR-5, FR-6, FR-7, FR-8, FR-15; TECH-SPEC §2.2–2.3, §3.3, §4.1–4.3,
// §7.6, §11; D5, D6, D20.
// Impure (loads Deno.env via adapter/config): the pure decisions live in extractContract.ts.
//
// Caller discipline: only the `send-message` boundary hook inserts `memory_extract` jobs,
// and the job payload's `boundary` is the user-message count at that moment — for the log
// line. Everything fact-shaped happens at job time: the backlog is derived here, so a dead
// job's backlog self-heals at the next boundary. A re-run resumes rather than duplicates:
// each written fact cites its message, and cited messages leave the backlog.

import { getConfigNumber, supabaseService } from "../config.ts";
import { embed } from "../llm/adapter.ts";
import { extractChunk } from "./extract.ts";
import {
  deriveBacklog,
  sliceBacklog,
  type BacklogMessage,
  type ChunkFact,
} from "./extractContract.ts";

const RUN_LOG_TAG = "[memory-extract]";

/** The dispatcher's job row shape (structural — matches what the dispatcher passes in). */
export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
}

export interface BacklogReport {
  /** The oldest `created_at` of the newest `sliding_window_messages` rows; null when the thread is shorter than the window. */
  windowCutoff: string | null;
  /** Aged-out rows considered, before the unsavable + cited filters. */
  candidates: number;
  backlog: BacklogMessage[];
}

/** What one extraction run did — echoed by `dev-smoke ?action=memory-drill&leg=extract`. */
export interface ExtractRunReport {
  windowCutoff: string | null;
  candidates: number;
  slices: number;
  messages: number;
  facts: number;
  opennessDelta: number;
}

/** How many candidate ids ride one `in (...)` read — keeps the PostgREST URL bounded. */
const CITED_READ_BATCH = 100;

/**
 * Derive the backlog at job time (FR-4): the newest `sliding_window_messages` rows define
 * the raw window; its oldest row's `created_at` is the cutoff; aged-out rows are the user's
 * messages strictly older than it, all roles included (both halves of a memory live in the
 * thread). Cited messages are read in batches so a long thread cannot overflow the URL.
 */
export async function loadMemoryBacklog(userId: string): Promise<BacklogReport> {
  const windowSize = await getConfigNumber("sliding_window_messages");

  const { data: windowRows, error: windowError } = await supabaseService
    .from("messages")
    .select("id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(windowSize);
  if (windowError) throw new Error(`memory_extract: window read failed: ${windowError.message}`);
  if (!windowRows || windowRows.length < windowSize) {
    return { windowCutoff: null, candidates: 0, backlog: [] };
  }
  // Descending order: the last row is the window's oldest, i.e. the raw cutoff.
  const cutoff = windowRows[windowRows.length - 1].created_at as string;

  const { data: candidates, error: candidatesError } = await supabaseService
    .from("messages")
    .select("id, role, content, unsavable, created_at")
    .eq("user_id", userId)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (candidatesError) {
    throw new Error(`memory_extract: backlog read failed: ${candidatesError.message}`);
  }
  const rows = (candidates ?? []) as BacklogMessage[];
  const candidateIds = rows.map((m) => m.id);

  // Provenance guard: a fact row citing a message marks it extracted — purged rows still
  // count (a purged message never re-extracts).
  const cited = new Set<string>();
  for (let i = 0; i < candidateIds.length; i += CITED_READ_BATCH) {
    const batch = candidateIds.slice(i, i + CITED_READ_BATCH);
    const { data: citedRows, error: citedError } = await supabaseService
      .from("memory_facts")
      .select("source_message_id")
      .eq("user_id", userId)
      .in("source_message_id", batch);
    if (citedError) throw new Error(`memory_extract: cited-facts read failed: ${citedError.message}`);
    for (const row of citedRows ?? []) {
      if (typeof row.source_message_id === "string") cited.add(row.source_message_id);
    }
  }

  return {
    windowCutoff: cutoff,
    candidates: candidateIds.length,
    backlog: deriveBacklog(rows, cited),
  };
}

/**
 * The `memory_extract` handler. Idempotent (§2.2.4): a claimed job can be re-delivered
 * after a lease timeout — completed slices are protected by the per-message provenance
 * guard, so a re-run extracts only the remainder.
 *
 * Failure semantics (§4.1–4.2): a slice whose structural failure exhausts the bounded
 * retry (or whose transport fails) throws — the dispatcher marks the job failed with
 * backoff; a fresh sample may conform on the next attempt.
 */
export async function runMemoryExtract(
  payload: Record<string, unknown>,
  job: Job,
): Promise<ExtractRunReport> {
  const userId = typeof payload.user_id === "string" ? payload.user_id : null;
  if (!userId) throw new Error("memory_extract: missing user_id in payload");
  const boundary = typeof payload.boundary === "number" ? payload.boundary : null;

  const { windowCutoff, candidates, backlog } = await loadMemoryBacklog(userId);
  const slices = sliceBacklog(backlog);

  if (slices.length === 0) {
    console.log(
      JSON.stringify({
        tag: RUN_LOG_TAG,
        job: job.id,
        boundary,
        windowCutoff,
        candidates,
        slices: 0,
        messages: 0,
        facts: 0,
        outcome: "no-op",
      }),
    );
    return {
      windowCutoff,
      candidates,
      slices: 0,
      messages: 0,
      facts: 0,
      opennessDelta: 0,
    };
  }

  let factsWritten = 0;
  let messagesProcessed = 0;
  let opennessTotal = 0;

  for (const slice of slices) {
    const result = await extractChunk(slice); // provenance-gated inside the contract
    opennessTotal += result.openness_delta;
    messagesProcessed += slice.length;

    const facts: ChunkFact[] = result.facts;
    if (facts.length === 0) continue;

    const { data: inserted, error: insertError } = await supabaseService
      .from("memory_facts")
      .insert(
        facts.map((f) => ({
          user_id: userId,
          fact: f.text,
          fact_type: "chat" as const,
          source_message_id: f.source_message_id,
        })),
      )
      .select("id");
    if (insertError) throw new Error(`memory_extract: facts insert failed: ${insertError.message}`);

    const factIds = (inserted ?? []).map((r) => r.id as string);
    if (factIds.length > 0) {
      // One batched embed per slice over its fact texts (the journal pattern: on a failed
      // embed the frozen identity is stamped and the embedding is left for a later backfill).
      const embedRes = await embed(facts.map((f) => f.text));
      const modelStamp = embedRes.ok && embedRes.data?.model ? embedRes.data.model : FROZEN_EMBED_MODEL;
      const embeddings = embedRes.ok && embedRes.data?.embeddings ? embedRes.data.embeddings : [];

      for (let i = 0; i < factIds.length; i++) {
        const updateData: Record<string, unknown> = { embed_model: modelStamp };
        if (embeddings[i]) {
          updateData.embedding = embeddings[i];
        } else if (embeddings[0]) {
          updateData.embedding = embeddings[0];
        }
        const { error: stampError } = await supabaseService
          .from("memory_facts")
          .update(updateData)
          .eq("id", factIds[i]);
        if (stampError) throw new Error(`memory_extract: embed stamp failed: ${stampError.message}`);
      }
      factsWritten += factIds.length;
    }
  }

  // One structured log line per run (FR-6): the rider is logged, never applied (D20).
  console.log(
    JSON.stringify({
      tag: RUN_LOG_TAG,
      job: job.id,
      boundary,
      windowCutoff,
      candidates,
      slices: slices.length,
      messages: messagesProcessed,
      facts: factsWritten,
      openness_delta: opennessTotal,
      openness_delta_rider: "logged_not_applied",
    }),
  );

  return {
    windowCutoff,
    candidates,
    slices: slices.length,
    messages: messagesProcessed,
    facts: factsWritten,
    opennessDelta: opennessTotal,
  };
}

/**
 * The frozen embedding identity (D5) — the stamp used when the adapter could not answer
 * with its own model name. Never a tunable: changing it requires a re-embedding migration.
 */
const FROZEN_EMBED_MODEL = "gemini-embedding-001@768";
