// supabase/functions/_shared/pipeline/classify.ts
// Pipeline stage 2 — classifier (TECH-SPEC §6, D19).
//
// FP-02 shipped a *deterministic stub* (FR-7): no LLM call, no embedding, but the exact
// §6.3 output shape so the real embedding classifier could replace it without touching
// downstream stages. FP-03 Step 4 adds that classifier's *pure* half below; the impure half
// (config reads + the `match_exemplars` RPC) lives in `classifyReal.ts`.
//
// The stub stays exported as `classify` and unchanged — `classifier_mode='stub'` is the
// rollback (FR-11).

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

// ===========================================================================
// FP-03 — real embedding classifier, pure half (§6.2–§6.4, D19).
//
// Everything below is PURE: no I/O and no imports. The impure half (the `config` reads and
// the `match_exemplars` RPC round) lives in `classifyReal.ts`, because `_shared/config.ts`
// touches `Deno.env` at import time and a Deno-only import here would make this module
// unloadable by jest (`classify.test.ts` covers `composeClassification`).
// ===========================================================================

/** The three exemplar sets (§6.4, `exemplars.set_kind` — GLOSSARY §14). */
export type SetKind = "domain" | "emotion" | "quit_signal";

export const SET_KINDS: readonly SetKind[] = ["domain", "emotion", "quit_signal"];

/** One `match_exemplars` row: the max cosine similarity for a `(set_kind, label)` pair. */
export interface ExemplarMatch {
  setKind: SetKind;
  label: string;
  sim: number;
}

/** The [SPEC] bounds stage 2 needs. `classifyReal` reads these from `config` — never literals. */
export interface ClassifyThresholds {
  /** `config.quit_signal_threshold` [SPEC] — §6.3. */
  quitSignalThreshold: number;
  /** `config.energy_exhausted_max` [SPEC] — §6.2. */
  energyExhaustedMax: number;
  /** `config.energy_determined_min` [SPEC] — §6.2. */
  energyDeterminedMin: number;
}

/** Energy-forced emotion labels (must exist in `config.emotion_labels`, FR-2). */
const EXHAUSTED = "exhausted";
const DETERMINED = "determined";

/** §6.4 D7 block: no labels, zero confidences, no quit signal. */
export function D7Fallback(): Classification {
  return {
    domain: null,
    domain_conf: 0,
    emotion: null,
    emotion_conf: 0,
    quit_signal: false,
    overall_conf: 0,
  };
}

/**
 * Apply dev-only overrides to an already-composed block (FR-14, AC-10).
 *
 * The stub folds overrides in as it builds (see `classify` above); the real classifier cannot,
 * so the orchestrator applies them afterwards with the *same* semantics: a `domain`/`emotion`
 * override replaces that label, and `overall_conf` forces **both** per-label confidences so the
 * `overall_conf = min(domain_conf, emotion_conf)` invariant still holds. `quit_signal` is not
 * overridable — the dev drill drives the tier, never the lockdown arm (D21).
 *
 * Pure: the input block is not mutated. Called only from the real branch, so the stub's own
 * byte-for-byte behaviour (the FP-02 drill) is untouched.
 */
export function applyOverrides(
  block: Classification,
  overrides: ClassifyOverrides = {},
): Classification {
  const domain = overrides.domain ?? block.domain;
  const emotion = overrides.emotion ?? block.emotion;
  const conf = overrides.overall_conf;
  const domain_conf = conf ?? block.domain_conf;
  const emotion_conf = conf ?? block.emotion_conf;

  return {
    domain,
    domain_conf,
    emotion,
    emotion_conf,
    quit_signal: block.quit_signal,
    overall_conf: Math.min(domain_conf, emotion_conf),
  };
}

/**
 * Cosine similarities are clamped into the `0..1` the §6.3 contract documents. A negative
 * similarity cannot change a routing outcome (it sits below every band, so stage 4 takes the
 * D7 fallback either way) and a value above 1 is impossible for cosine — but keeping the block
 * inside its own documented range means no band comparison ever sees an out-of-domain value.
 */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Highest-similarity row of a set, or null when the set has no rows. Ties break on the
 * lexicographically lower label, so the block never depends on the RPC's row order (NFR-3). */
function topOf(rows: ExemplarMatch[]): ExemplarMatch | null {
  let best: ExemplarMatch | null = null;
  for (const row of rows) {
    if (best === null) best = row;
    else if (row.sim > best.sim) best = row;
    else if (row.sim === best.sim && row.label < best.label) best = row;
  }
  return best;
}

/** Best similarity for one label inside a set (0 when that label has no rows). */
function bestFor(rows: ExemplarMatch[], label: string): number {
  let best = 0;
  for (const row of rows) {
    if (row.label === label && row.sim > best) best = row.sim;
  }
  return clamp01(best);
}

/**
 * §6.3 composition — pure, deterministic, no I/O (NFR-3).
 *
 * `rows` are the per-label aggregates from `match_exemplars`. It returns the classifier block
 * only: the D7 *route* is stage 4's decision (§6.4 maps a null label or
 * `overall_conf < confidence_bands.low_low` to `fallback` in `persona.ts`), never this one's.
 *
 * Energy override (§6.2, FR-8): energy ≤ `energyExhaustedMax` forces `exhausted`, energy ≥
 * `energyDeterminedMin` forces `determined`, both overriding the embedding argmax, and the
 * forced label's own best similarity becomes `emotion_conf`. When a misconfigured pair
 * overlaps, exhausted wins — fixed precedence, unit-tested, and the live gate asserts the
 * configured order. Stage 2 never throws (§5.1), so this validates nothing.
 */
export function composeClassification(
  rows: ExemplarMatch[],
  energy: number | null | undefined,
  thresholds: ClassifyThresholds,
): Classification {
  const domainRows = rows.filter((r) => r.setKind === "domain");
  const emotionRows = rows.filter((r) => r.setKind === "emotion");
  const quitRows = rows.filter((r) => r.setKind === "quit_signal");

  const domainTop = topOf(domainRows);
  const emotionTop = topOf(emotionRows);

  const domain = domainTop === null ? null : domainTop.label;
  const domain_conf = domainTop === null ? 0 : clamp01(domainTop.sim);

  let forced: string | null = null;
  if (typeof energy === "number" && Number.isFinite(energy)) {
    if (energy <= thresholds.energyExhaustedMax) forced = EXHAUSTED;
    else if (energy >= thresholds.energyDeterminedMin) forced = DETERMINED;
  }

  const emotion = forced ?? (emotionTop === null ? null : emotionTop.label);
  let emotion_conf: number;
  if (forced !== null) {
    emotion_conf = bestFor(emotionRows, forced);
  } else {
    emotion_conf = emotionTop === null ? 0 : clamp01(emotionTop.sim);
  }

  const quitTop = topOf(quitRows);
  const quit_signal = quitTop !== null && quitTop.sim >= thresholds.quitSignalThreshold;

  return {
    domain,
    domain_conf,
    emotion,
    emotion_conf,
    quit_signal,
    overall_conf: Math.min(domain_conf, emotion_conf),
  };
}
