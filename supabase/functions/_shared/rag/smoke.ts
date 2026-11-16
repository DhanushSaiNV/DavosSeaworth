// supabase/functions/_shared/rag/smoke.ts
// P4 — the hand-reviewed smoke set and the verdict rules for it (PRD §14.1 D, §14.2).
//
// Refs: PRD §14.1 D (the ten prompt kinds), §14.2 (what a human inspects), §14.3 (no evaluation
// platform); PLAN.md §15 (P4, gate G2's input), §16 (the cost ceiling), §10 (calibration);
// AGENTS.md §8 (owner content lives in `content/`, `status=draft`).
//
// Why this module exists: the smoke set is *data* (`content/rag-fixtures/smoke_prompts.json`) and
// the verdict is *code*. Keeping the rules here means a drill cannot mark a turn "pass" by
// inspection, and the same rules run in Jest without a database, a provider or a Deno runtime.
//
// What it deliberately cannot judge: whether the reply itself is good. "A retrieved rule was
// irrelevant and was ignored" and "the model abstained instead of inventing a hold count" are
// answer-level judgements, so a fixture names them in `manual_review` and the evaluator returns
// `warn` — never `pass` — until a human signs off.

import type { DatasetName } from "./types.ts";

/** PRD §14.1 D, one category per bullet, in the document's order. */
export const SMOKE_CATEGORIES = [
  "casual_no_retrieval",
  "general_concept_no_retrieval",
  "checkin_count_energy",
  "two_dataset_trend",
  "previous_context_memory",
  "decision_support_data_and_rules",
  "irrelevant_rule_ignored",
  "no_data_abstain",
  "stale_or_contradictory_memory",
  "excluded_data_request",
] as const;

export type SmokeCategory = typeof SMOKE_CATEGORIES[number];

/**
 * Strings that must never reach the evidence block, whatever the fixture. The registry cannot
 * return these columns at all, so a hit means a defect upstream of the prompt — exactly what
 * PRD §14.2's "no hidden or excluded fields surfaced" is checking for.
 */
export const NEVER_IN_EVIDENCE = [
  "embedding",
  "trust_score",
  "tactical_analysis",
  "unsavable",
  "user_id",
] as const;

/** PLAN.md §12.1 and §16: the per-turn ceiling and the evidence ceiling. */
export const DEFAULT_MAX_GENERATION_REQUESTS = 3;
export const DEFAULT_MAX_EVIDENCE_CHARS = 12000;

export interface SmokeExpectation {
  /** `none` = this prompt must produce zero tool calls (PRD §14.1 C1). */
  retrieval: "none" | "required";
  /** Advisory: the datasets a human judges appropriate. A different valid choice is a `warn`. */
  datasets: DatasetName[];
  /** Fixture-specific strings that must not appear in the evidence block. */
  must_not_quote: string[];
  /** Answer-level checks a human must make. Each one keeps the verdict at `warn`. */
  manual_review: string[];
}

export interface SmokePrompt {
  id: string;
  category: SmokeCategory;
  prompt: string;
  expect: SmokeExpectation;
}

export interface SmokeSet {
  status: "draft" | "approved";
  label: string;
  prompts: SmokePrompt[];
}

/** What one drill run observed. Produced by `ragSmokeRun.ts`, never written by hand. */
export interface SmokeObservation {
  promptId: string;
  planState: "none" | "ok" | "rejected" | "unavailable";
  reason?: string;
  requestedDatasets: DatasetName[];
  blocks: number;
  totalChars: number;
  generationRequests: number;
  /** The rendered evidence block exactly as the generation prompt received it. */
  evidenceText: string;
}

export type SmokeVerdict = "pass" | "warn" | "fail";

export interface SmokeResult {
  promptId: string;
  verdict: SmokeVerdict;
  notes: string[];
}

export type SmokeSetParse =
  | { ok: true; set: SmokeSet }
  | { ok: false; reason: string };

const DATASETS: readonly DatasetName[] = [
  "checkins",
  "impulse_events",
  "checkin_compliance",
  "journal",
  "anchor_plans",
  "habits",
  "metrics_catalog",
  "metric_series",
  "quests",
  "daily_vars",
  "conversation",
  "memory_facts",
  "schedule_profile",
  "memory_search",
  "rules_search",
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDatasetArray(value: unknown): value is DatasetName[] {
  return isStringArray(value) && value.every((item) => (DATASETS as readonly string[]).includes(item));
}

/**
 * Validate the fixture file. A malformed smoke set is a defect in the fixture, not a reason to
 * skip the gate, so this fails closed with a named reason instead of coercing.
 */
export function parseSmokeSet(raw: unknown): SmokeSetParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  const set = raw as Record<string, unknown>;

  if (set.status !== "draft" && set.status !== "approved") {
    return { ok: false, reason: "bad_status" };
  }
  if (typeof set.label !== "string" || set.label.trim() === "") {
    return { ok: false, reason: "missing_label" };
  }
  if (!Array.isArray(set.prompts)) {
    return { ok: false, reason: "prompts_not_array" };
  }
  // PRD §14.1 D: "approximately 8-12 prompts", not a benchmark.
  if (set.prompts.length < 8 || set.prompts.length > 12) {
    return { ok: false, reason: "count_out_of_range" };
  }

  const seenIds = new Set<string>();
  const seenCategories = new Set<string>();
  const prompts: SmokePrompt[] = [];

  for (const entry of set.prompts) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "prompt_not_object" };
    }
    const item = entry as Record<string, unknown>;

    if (typeof item.id !== "string" || item.id.trim() === "") {
      return { ok: false, reason: "missing_id" };
    }
    if (seenIds.has(item.id)) return { ok: false, reason: `duplicate_id:${item.id}` };
    seenIds.add(item.id);

    if (typeof item.category !== "string" ||
      !(SMOKE_CATEGORIES as readonly string[]).includes(item.category)) {
      return { ok: false, reason: `unknown_category:${String(item.category)}` };
    }
    seenCategories.add(item.category);

    if (typeof item.prompt !== "string" || item.prompt.trim() === "") {
      return { ok: false, reason: `missing_prompt:${item.id}` };
    }

    const expect = item.expect;
    if (typeof expect !== "object" || expect === null) {
      return { ok: false, reason: `missing_expect:${item.id}` };
    }
    const e = expect as Record<string, unknown>;
    if (e.retrieval !== "none" && e.retrieval !== "required") {
      return { ok: false, reason: `bad_retrieval:${item.id}` };
    }
    if (!isDatasetArray(e.datasets)) {
      return { ok: false, reason: `bad_datasets:${item.id}` };
    }
    if (!isStringArray(e.must_not_quote)) {
      return { ok: false, reason: `bad_must_not_quote:${item.id}` };
    }
    if (!isStringArray(e.manual_review)) {
      return { ok: false, reason: `bad_manual_review:${item.id}` };
    }
    // A no-retrieval prompt that names datasets is self-contradictory: the fixture would be
    // asserting both "ask for nothing" and "ask for these".
    if (e.retrieval === "none" && (e.datasets as string[]).length > 0) {
      return { ok: false, reason: `none_with_datasets:${item.id}` };
    }
    if (e.retrieval === "required" && (e.datasets as string[]).length === 0) {
      return { ok: false, reason: `required_without_datasets:${item.id}` };
    }

    prompts.push({
      id: item.id,
      category: item.category as SmokeCategory,
      prompt: item.prompt,
      expect: {
        retrieval: e.retrieval,
        datasets: e.datasets as DatasetName[],
        must_not_quote: e.must_not_quote,
        manual_review: e.manual_review,
      },
    });
  }

  for (const category of SMOKE_CATEGORIES) {
    if (!seenCategories.has(category)) {
      return { ok: false, reason: `missing_category:${category}` };
    }
  }

  return {
    ok: true,
    set: { status: set.status, label: set.label, prompts },
  };
}

/**
 * The verdict for one observation (PRD §14.1 C1/C5, §14.2; PLAN.md §12.1, §16).
 *
 * Failures are the checks that are deterministic given the observation. Everything that needs a
 * human reading the reply lands in `warn` via `manual_review`, so a drill can never report a clean
 * pass for a turn nobody read.
 */
export function evaluateObservation(
  prompt: SmokePrompt,
  observation: SmokeObservation,
  options: { maxGenerationRequests?: number; maxEvidenceChars?: number } = {},
): SmokeResult {
  const maxRequests = options.maxGenerationRequests ?? DEFAULT_MAX_GENERATION_REQUESTS;
  const maxChars = options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
  const notes: string[] = [];
  let verdict: SmokeVerdict = "pass";

  const fail = (note: string): void => {
    verdict = "fail";
    notes.push(note);
  };
  const warn = (note: string): void => {
    if (verdict !== "fail") verdict = "warn";
    notes.push(note);
  };

  if (observation.promptId !== prompt.id) {
    fail(`observation is for ${observation.promptId}, not ${prompt.id}`);
    return { promptId: prompt.id, verdict, notes };
  }

  // A rejected or unavailable plan is retrieval that did not run. Both are legitimate runtime
  // states, but neither is a pass for a prompt that asked for data (PRD §7.4).
  if (observation.planState === "rejected") {
    fail(`plan rejected${observation.reason === undefined ? "" : `: ${observation.reason}`}`);
  }
  if (observation.planState === "unavailable") {
    fail(`retrieval unavailable${observation.reason === undefined ? "" : `: ${observation.reason}`}`);
  }

  const requested = observation.requestedDatasets;
  // A rejected or unavailable plan already failed above; its request list is not observable
  // (`noRetrievalPlan()` stands in), so do not also claim the turn "asked for no data".
  const planProducedARequest =
    observation.planState === "ok" || observation.planState === "none";

  if (prompt.expect.retrieval === "none") {
    if (requested.length > 0) {
      fail(`asked for data on a no-retrieval prompt: ${requested.join(", ")}`);
    }
    if (observation.blocks > 0) {
      fail(`produced ${observation.blocks} evidence block(s) on a no-retrieval prompt`);
    }
  } else if (requested.length === 0 && planProducedARequest) {
    fail("asked for no data on a retrieval-required prompt");
  }

  if (requested.length > 0 && observation.blocks === 0 && observation.planState === "ok") {
    warn("requested data but no block was produced; check that the empty result is real");
  }

  const missing = prompt.expect.datasets.filter((dataset) => !requested.includes(dataset));
  const extra = requested.filter((dataset) => !prompt.expect.datasets.includes(dataset));
  if (prompt.expect.retrieval === "required" && missing.length > 0) {
    warn(`expected dataset(s) not requested: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    warn(`requested dataset(s) outside the fixture's expectation: ${extra.join(", ")}`);
  }

  if (observation.generationRequests > maxRequests) {
    fail(`${observation.generationRequests} provider requests exceeds the ceiling of ${maxRequests}`);
  }
  if (observation.totalChars > maxChars) {
    fail(`${observation.totalChars} evidence chars exceeds the ceiling of ${maxChars}`);
  }

  const haystack = observation.evidenceText.toLowerCase();
  for (const forbidden of NEVER_IN_EVIDENCE) {
    if (haystack.includes(forbidden)) {
      fail(`evidence contains a forbidden field name: ${forbidden}`);
    }
  }
  for (const quote of prompt.expect.must_not_quote) {
    if (haystack.includes(quote.toLowerCase())) {
      fail(`evidence contains a fixture-forbidden string: ${quote}`);
    }
  }

  for (const check of prompt.expect.manual_review) {
    warn(`manual review: ${check}`);
  }

  return { promptId: prompt.id, verdict, notes };
}

/** Roll the per-prompt verdicts up for the gate line. `warn` is never counted as a pass. */
export function summarizeSmoke(results: readonly SmokeResult[]): {
  pass: number;
  warn: number;
  fail: number;
  blocking: boolean;
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const result of results) {
    if (result.verdict === "pass") pass += 1;
    else if (result.verdict === "warn") warn += 1;
    else fail += 1;
  }
  return { pass, warn, fail, blocking: fail > 0 };
}

/**
 * PLAN.md §10's calibration arithmetic, in code so the number is not hand-rounded:
 * `min(similarity of true positives) - 0.02`, two decimal places.
 *
 * Returns `null` when the fixture has no judged-relevant pair, or when the result leaves the
 * `(0, 1]` range SQL accepts (`0045`), because in both cases there is no threshold to write — and
 * a silent zero is exactly the v4 defect §10 exists to prevent.
 */
export function calibrationThreshold(similarities: readonly number[]): number | null {
  const usable = similarities.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  const raw = Math.min(...usable) - 0.02;
  const rounded = Math.round(raw * 100) / 100;
  if (!(rounded > 0) || rounded > 1) return null;
  return rounded;
}
