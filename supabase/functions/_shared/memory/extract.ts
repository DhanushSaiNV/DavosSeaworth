// supabase/functions/_shared/memory/extract.ts
// FP-06 Step 3 — adapter-bound entry for chat-memory chunk extraction (TECH-SPEC §4.1, §4.3).
// Refs: FP-06 FR-4, FR-5, FR-15; TECH-SPEC §4.1–4.3, §7.6.
// Impure (loads Deno.env via adapter): cannot be the module under test. The pure half is
// extractContract.ts (the journal extract.ts/extractContract.ts split).

import { generate } from "../llm/adapter.ts";
import {
  extractChunkWith,
  type ChatFactsResult,
  type ChunkMessage,
} from "./extractContract.ts";

/** Extract one slice of aged-out messages — the function the handler and dev-smoke both call. */
export async function extractChunk(messages: ChunkMessage[]): Promise<ChatFactsResult> {
  return extractChunkWith(generate, messages);
}
