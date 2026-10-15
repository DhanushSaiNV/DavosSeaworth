// supabase/functions/_shared/pipeline/retrieveRules.ts
// Pipeline stage 3 — rule retrieval (pgvector cosine) + conflict filter.
// TECH-SPEC §5.2: top-5 rules for the domain by `<=>`, then the deterministic
// conflict filter that enforces PRD §2 "no contradictory advice".

import { supabaseService, getConfigNumber } from "../config.ts";

export type RuleTone = "aggressive" | "empathetic" | "neutral";

export interface RetrievedRule {
  id: string;
  text: string;
  domain: string;
  tone: RuleTone;
  priority: number;
}

export interface ConflictFilterResult {
  survivors: RetrievedRule[];
  droppedTone: RuleTone | null;
}

/**
 * TECH-SPEC §5.2 conflict filter — deterministic and pure.
 *
 * Group the retrieved rules by tone. If both `aggressive` and `empathetic` groups are
 * present, compare each group's maximum priority. When the two maxima are within
 * `window` points, drop the lower-priority group (the whole group). A tie keeps the
 * aggressive group. `window` is read from `config.conflict_priority_window` [SPEC].
 */
export function applyConflictFilter(
  rules: RetrievedRule[],
  window: number,
): ConflictFilterResult {
  const aggressive = rules.filter((r) => r.tone === "aggressive");
  const empathetic = rules.filter((r) => r.tone === "empathetic");

  // Conflict requires both opposing tone groups present.
  if (aggressive.length === 0 || empathetic.length === 0) {
    return { survivors: rules, droppedTone: null };
  }

  const maxAgg = Math.max(...aggressive.map((r) => r.priority));
  const maxEmp = Math.max(...empathetic.map((r) => r.priority));

  // Outside the window → no contradiction, keep everything.
  if (Math.abs(maxAgg - maxEmp) > window) {
    return { survivors: rules, droppedTone: null };
  }

  // Within the window → drop the lower-priority group; tie keeps aggressive.
  const droppedTone: RuleTone = maxAgg >= maxEmp ? "empathetic" : "aggressive";
  return { survivors: rules.filter((r) => r.tone !== droppedTone), droppedTone };
}

export interface RetrieveRulesOptions {
  domain: string;
  messageEmbedding: number[];
  matchCount?: number;
}

export interface RetrieveRulesResult {
  survivors: RetrievedRule[];
  retrieved: number;
  droppedTone: RuleTone | null;
  window: number;
}

/**
 * Top-`matchCount` rules for `domain` by pgvector cosine distance, then the §5.2
 * conflict filter. Returns the surviving rules (ids, texts, tone tags) only — the
 * 768-float embedding column returned by `match_rules` is intentionally dropped.
 */
export async function retrieveRules(opts: RetrieveRulesOptions): Promise<RetrieveRulesResult> {
  const { domain, messageEmbedding, matchCount = 5 } = opts;
  const window = await getConfigNumber("conflict_priority_window");

  const { data, error } = await supabaseService.rpc("match_rules", {
    query_embedding: messageEmbedding,
    match_domain: domain,
    match_count: matchCount,
  });
  if (error) throw new Error(`match_rules failed: ${error.message}`);

  // `match_rules` returns `setof rules`; map to the lean shape (drop `embedding`).
  const rules: RetrievedRule[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    text: r.text as string,
    domain: r.domain as string,
    tone: r.tone as RuleTone,
    priority: r.priority as number,
  }));

  const { survivors, droppedTone } = applyConflictFilter(rules, window);
  return { survivors, retrieved: rules.length, droppedTone, window };
}
