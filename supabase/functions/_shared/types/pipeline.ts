// supabase/functions/_shared/types/pipeline.ts
// Shared types for pipeline stages — avoids coupling between pipeline and dev code.
// TECH-SPEC §5.2 (rule retrieval + conflict filter), §14 (implementation order).

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
