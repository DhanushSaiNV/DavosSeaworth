// supabase/functions/_shared/accountability/lockdown.ts
// FP-08 Step 2 — the lockdown rule's pure half (FR-6 … FR-8).
//
// Refs: FP-08 FR-6, FR-7, FR-8; TECH-SPEC §5.1–5.3, §11; D16, D21; PRD §3.3.
//
// Entry is D21's redundant-signal rule: extraction `give_up` ∨ `false_constraint` ∨ classifier
// `quit_signal` ≥ `quit_signal_threshold` — either signal arms. Exit is any of: a concession
// (before that turn's generation), the lazy circuit breaker (no job consumes it — lazy is
// total), or a journal S1/S2 (severity outranks accountability).
//
// The override is a stage 4–5 rule: persona forced `confrontation`; retrieval limited to the
// accountability domain set; a classified-domain mismatch generates one deterministic redirect
// instruction (redirect-not-refuse — the user's message always renders).

/** The default §11 pair; the live value comes from `config.lockdown_accountability_domains`. */
export const ACCOUNTABILITY_DOMAINS_DEFAULT = ["Career", "Discipline/Habits"] as const;

/** D21 forces this persona for every locked turn (§5.3's persona-key enum). */
export const LOCKDOWN_PERSONA = "confrontation";

export interface LockdownFlags {
  give_up?: boolean | null;
  false_constraint?: boolean | null;
}

/**
 * FR-6: any of the two extraction flags, or the classifier's redundant quit signal at/over the
 * threshold. A missing/non-numeric signal cannot arm.
 */
export function shouldEnterLockdown(
  flags: LockdownFlags | null | undefined,
  quitSignal: number | null | undefined,
  quitSignalThreshold = 0.75,
): boolean {
  if (flags?.give_up === true || flags?.false_constraint === true) return true;
  return typeof quitSignal === "number" && Number.isFinite(quitSignal) &&
    quitSignal >= quitSignalThreshold;
}

/**
 * FR-8's three exits, in one predicate. `severity` is the journal contract's label when the
 * caller is `journal_extract`; chat turns pass null. The breaker never expires a null start
 * (a locked row without a timestamp is tolerated rather than unlocked by accident).
 */
export function shouldExit(
  concession: boolean | null | undefined,
  startedAt: string | null | undefined,
  nowIso: string,
  breakerHours: number,
  severity: "S1" | "S2" | "S3" | null = null,
): boolean {
  if (concession === true) return true;
  if (severity === "S1" || severity === "S2") return true;
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return false;
  return now - started >= Math.max(0, breakerHours) * 3_600_000;
}

export interface EffectiveDomain {
  /** The domains retrieval must query. */
  domains: string[];
  /** True when the classified domain is outside the accountability set (redirect required). */
  mismatched: boolean;
}

/**
 * FR-7: the classified domain when it is inside the accountability set, else the set itself.
 * A null/empty classification is not a "mismatch" — there is no off-topic claim to redirect,
 * and the accountability rules are the right default (D7's fallback is `General`, which the
 * caller must not treat as evidence of an off-topic message).
 */
export function effectiveDomain(
  classifiedDomain: string | null | undefined,
  accountabilityDomains: readonly string[],
): EffectiveDomain {
  const domains = accountabilityDomains.length > 0
    ? [...accountabilityDomains]
    : [...ACCOUNTABILITY_DOMAINS_DEFAULT];
  const label = typeof classifiedDomain === "string" && classifiedDomain.length > 0
    ? classifiedDomain
    : null;
  if (label !== null && domains.includes(label)) {
    return { domains: [label], mismatched: false };
  }
  return { domains, mismatched: label !== null };
}

/**
 * The deterministic redirect instruction for a mismatched locked turn (FR-7, PRD §3.3:
 * redirect-not-refuse). Domains are enum values, never user text — nothing here needs the §10.5
 * delimiter treatment, and the instruction never asks the model to withhold the reply.
 */
export function buildRedirectInstruction(
  classifiedDomain: string | null | undefined,
  accountabilityDomains: readonly string[],
): string | null {
  const { domains, mismatched } = effectiveDomain(classifiedDomain, accountabilityDomains);
  if (!mismatched) return null;
  return [
    `The user's message is about ${classifiedDomain}, which is outside the accountability ` +
      "conversation you are holding with them.",
    "Acknowledge their point in one short sentence — do not pretend they did not raise it — " +
      "then bring the turn back to the domains that are on the table: " +
      domains.join(" and ") + ".",
    "Answer the accountability question, not the off-topic one.",
  ].join(" ");
}
