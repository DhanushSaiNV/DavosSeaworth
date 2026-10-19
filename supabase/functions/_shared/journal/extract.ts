// supabase/functions/_shared/journal/extract.ts
// FP-05 Step 3 — adapter-bound entry for journal extraction (TECH-SPEC §4.1, §4.3).
// Refs: FP-05 FR-4, FR-5, FR-16; TECH-SPEC §4.1, §4.3, §7.4.
// Impure (loads Deno.env via adapter): cannot be the module under test. The pure half is extractContract.ts.

import { generate } from "../llm/adapter.ts";
import { extractWith, type ExtractResult } from "./extractContract.ts";

/** Extract a journal entry — the function the handler and dev-smoke both call. */
export async function extractEntry(entryText: string): Promise<ExtractResult> {
  return extractWith(generate, entryText);
}