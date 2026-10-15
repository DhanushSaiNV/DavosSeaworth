// supabase/functions/_shared/pipeline/classify.ts
// Pipeline stage 2 — classifier. FP-02 ships a *deterministic stub* (FR-7): no LLM
// call, no embedding. It emits the exact §6.3 output shape so the real embedding
// classifier (FP-03) can replace it without touching downstream stages.

/** §6.3 classifier output shape. */
export interface Classification {
  domain: string | null;
  domain_conf: number; // 0..1
  emotion: string | null;
  emotion_conf: number; // 0..1
  quit_signal: boolean;
  overall_conf: number; // min(domain_conf, emotion_conf)
}

/** Dev-only override params (explicitly labeled dev-only; honored by the caller only). */
export interface ClassifyOverrides {
  domain?: string;
  emotion?: string;
  overall_conf?: number;
}

const DEFAULT_DOMAIN = "Career";
const DEFAULT_EMOTION = "determined";
const DEFAULT_CONF = 0.8;

/**
 * Deterministic stub classifier. `text` is accepted for signature parity with the real
 * classifier but is intentionally unused in FP-02.
 */
export function classify(_text: string, overrides: ClassifyOverrides = {}): Classification {
  const domain = overrides.domain ?? DEFAULT_DOMAIN;
  const emotion = overrides.emotion ?? DEFAULT_EMOTION;

  // overall_conf = min(domain_conf, emotion_conf) [SPEC, §6.3]. With no per-label
  // override the stub uses a single confidence for both; a dev `overall_conf` forces
  // both labels to that value so the invariant holds.
  const conf = overrides.overall_conf ?? DEFAULT_CONF;
  const domain_conf = conf;
  const emotion_conf = conf;

  return {
    domain,
    domain_conf,
    emotion,
    emotion_conf,
    quit_signal: false, // stub: quit detection arrives with the FP-03 exemplar sets
    overall_conf: Math.min(domain_conf, emotion_conf),
  };
}
