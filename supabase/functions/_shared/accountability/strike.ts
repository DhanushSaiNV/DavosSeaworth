// supabase/functions/_shared/accountability/strike.ts
// FP-08 Step 2 — the Strike's pure half: the claim-check, the S1/S2 snooze, and the evidence
// shape (FR-19).
//
// Refs: FP-08 FR-19; TECH-SPEC §7.5, §4.2, §2.2; D11, D24; PRD §3.2.
//
// The claim-check is the Strike's post-generation guard. It extracts *candidate* numeric claims
// from the model's `direct_quote` (numbers adjacent to time units, quantities, explicit dates,
// goal/deadline figures) and licenses each one against the exact context the model was fed —
// provenance, not "the number appears somewhere". A claim that fails is a violation; the
// caller (§4.2's one bounded retry) asks for one corrected re-output quoting the violation,
// and a second violation falls to the deterministic template (`templates.ts`).
//
// Regex is used only to *recognise candidates*, never to rewrite the model's text (AGENTS.md
// §5.1's ban is on post-processing output; FR-19 specifies the candidate extraction).

export type ClaimKind = "duration" | "quantity" | "date" | "goal";

export interface NumericClaim {
  /** The matched substring. */
  raw: string;
  kind: ClaimKind;
  /** Numeric value for duration/quantity/goal claims. */
  value?: number;
  /** Normalized unit: minute|hour|day|week|month|year for durations; a quantity noun otherwise. */
  unit?: string;
  /** `YYYY-MM-DD` for full dates; `MM-DD` when the claim omits the year. */
  date?: string;
}

export interface StrikeGroundTruth {
  doings_count: number;
  hours_logged: number;
  missed_windows: number;
  impulse_failures: number;
  /** `YYYY-MM-DD`. */
  watch_started_at: string;
  /** `YYYY-MM-DD`. */
  strike_at: string;
  /** The ground-truth window, `YYYY-MM-DD`. */
  window: { start: string; end: string };
}

export interface EvidenceContext {
  ground_truth: StrikeGroundTruth;
  /** The cited `match_facts` texts; empty means unverified mode. */
  verified_goals: string[];
}

export type ClaimViolationReason = "unsourced" | "goal_claim_without_goals" | "date_unsourced";

export interface ClaimViolation {
  claim: NumericClaim;
  reason: ClaimViolationReason;
  detail: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DURATION_UNITS: Record<string, string> = {
  minute: "minute", minutes: "minute", min: "minute", mins: "minute",
  hour: "hour", hours: "hour", hr: "hour", hrs: "hour",
  day: "day", days: "day",
  week: "week", weeks: "week",
  month: "month", months: "month",
  year: "year", years: "year",
};

const QUANTITY_UNITS: Record<string, string> = {
  doing: "doings", doings: "doings",
  "check-in": "checkins", "check-ins": "checkins", checkin: "checkins", checkins: "checkins",
  window: "windows", windows: "windows",
  impulse: "impulses", impulses: "impulses",
  "impulse failure": "impulses", "impulse failures": "impulses",
  failure: "failures", failures: "failures",
  entry: "entries", entries: "entries",
};

const DURATION_RE = /\b(\d{1,4}(?:[.,]\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi;
const QUANTITY_RE = /\b(\d{1,4})\s*(doings?|check-?ins?|windows?|impulse\s+failures?|impulses?|failures?|entries?)\b/gi;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const MONTH_DATE_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi;
const DAY_MONTH_DATE_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s*(\d{4}))?\b/gi;
const GOAL_RE = /\b(\d{1,5}(?:[.,]\d+)?)[-\s]?(hours?|days?|weeks?|months?|years?)?\s+(deadlines?|goals?|targets?)\b/gi;

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseIsoDate(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

interface Span {
  start: number;
  end: number;
  claim: NumericClaim;
}

/** Every candidate claim in the text, deduped by span (the longest match at a position wins). */
export function extractNumericClaims(text: string): NumericClaim[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const spans: Span[] = [];
  const push = (start: number, end: number, claim: NumericClaim) => {
    spans.push({ start, end, claim });
  };

  for (const match of text.matchAll(ISO_DATE_RE)) {
    const date = parseIsoDate(match[1], match[2], match[3]);
    if (date) push(match.index ?? 0, (match.index ?? 0) + match[0].length, { raw: match[0], kind: "date", date });
  }
  for (const match of text.matchAll(MONTH_DATE_RE)) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const day = Number(match[2]);
    if (month && day >= 1 && day <= 31) {
      const year = match[3] ? Number(match[3]) : null;
      const date = year ? `${year}-${pad2(month)}-${pad2(day)}` : `${pad2(month)}-${pad2(day)}`;
      push(match.index ?? 0, (match.index ?? 0) + match[0].length, { raw: match[0], kind: "date", date });
    }
  }
  for (const match of text.matchAll(DAY_MONTH_DATE_RE)) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (month && day >= 1 && day <= 31) {
      const year = match[3] ? Number(match[3]) : null;
      const date = year ? `${year}-${pad2(month)}-${pad2(day)}` : `${pad2(month)}-${pad2(day)}`;
      push(match.index ?? 0, (match.index ?? 0) + match[0].length, { raw: match[0], kind: "date", date });
    }
  }
  for (const match of text.matchAll(SLASH_DATE_RE)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const year = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : null;
    const date = year ? `${year}-${pad2(month)}-${pad2(day)}` : `${pad2(month)}-${pad2(day)}`;
    push(match.index ?? 0, (match.index ?? 0) + match[0].length, { raw: match[0], kind: "date", date });
  }
  for (const match of text.matchAll(GOAL_RE)) {
    push(match.index ?? 0, (match.index ?? 0) + match[0].length, {
      raw: match[0],
      kind: "goal",
      value: toNumber(match[1]),
      unit: match[2] ? DURATION_UNITS[match[2].toLowerCase()] : "count",
    });
  }
  for (const match of text.matchAll(DURATION_RE)) {
    push(match.index ?? 0, (match.index ?? 0) + match[0].length, {
      raw: match[0],
      kind: "duration",
      value: toNumber(match[1]),
      unit: DURATION_UNITS[match[2].toLowerCase()],
    });
  }
  for (const match of text.matchAll(QUANTITY_RE)) {
    const unitRaw = match[2].toLowerCase().replace(/\s+/g, " ");
    push(match.index ?? 0, (match.index ?? 0) + match[0].length, {
      raw: match[0],
      kind: "quantity",
      value: Number(match[1]),
      unit: QUANTITY_UNITS[unitRaw] ?? unitRaw,
    });
  }

  // Longest match at each start position wins (e.g. "400-hour deadline" is one goal claim,
  // not also a duration claim), then keep only non-overlapping spans left to right.
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: NumericClaim[] = [];
  let cursor = -1;
  for (const span of spans) {
    if (span.start < cursor) continue;
    kept.push(span.claim);
    cursor = span.end;
  }
  return kept;
}

function daysBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.floor((to - from) / 86_400_000);
}

function hasVerifiedNumber(context: EvidenceContext, claim: NumericClaim): boolean {
  if (context.verified_goals.length === 0) return false;
  const token = claim.raw.match(/\d{1,5}(?:[.,]\d+)?/)?.[0];
  if (!token) return false;
  const variants = new Set([token.replace(",", "."), token.replace(".", ","), token]);
  return context.verified_goals.some((goal) =>
    [...variants].some((variant) => goal.includes(variant))
  );
}

/**
 * The provenance rule (FR-19): a duration/count figure is licensed by the ground-truth field
 * that carries its unit; a date by `watch_started_at` / `strike_at` / the window's edges; a
 * goal/deadline figure only under verified mode, from a cited goal text. A verified goal text
 * licenses any figure it actually contains (the "cited row" rule).
 */
export function checkClaims(directQuote: string, context: EvidenceContext): ClaimViolation[] {
  const claims = extractNumericClaims(directQuote);
  const gt = context.ground_truth;
  const violations: ClaimViolation[] = [];
  const windowDays = daysBetween(gt.window.start, gt.window.end) + 1;
  const watchDays = daysBetween(gt.watch_started_at, gt.strike_at);
  const licensedDates = [gt.watch_started_at, gt.strike_at, gt.window.start, gt.window.end]
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const claim of claims) {
    if (claim.kind === "date") {
      const licensed = licensedDates.some((date) =>
        claim.date === date || (claim.date !== undefined && claim.date.length === 5 && date.endsWith(claim.date))
      ) || (claim.raw.length > 0 && context.verified_goals.some((goal) => goal.includes(claim.raw)));
      if (!licensed) {
        violations.push({
          claim,
          reason: "date_unsourced",
          detail: `date ${claim.date} is not licensed by watch_starts/strike_at/window`,
        });
      }
      continue;
    }

    if (claim.kind === "goal") {
      if (context.verified_goals.length === 0) {
        violations.push({
          claim,
          reason: "goal_claim_without_goals",
          detail: "goal/deadline figure quoted in unverified mode",
        });
      } else if (!hasVerifiedNumber(context, claim)) {
        violations.push({
          claim,
          reason: "unsourced",
          detail: `goal figure ${claim.value} does not appear in any cited goal`,
        });
      }
      continue;
    }

    let licensedBy: string | null = null;
    if (claim.kind === "duration") {
      if (claim.unit === "hour" && claim.value === gt.hours_logged) licensedBy = "hours_logged";
      if (claim.unit === "day" && (claim.value === windowDays || claim.value === watchDays)) {
        licensedBy = claim.value === windowDays ? "window" : "watch_days";
      }
    } else if (claim.kind === "quantity") {
      const field: Record<string, number | undefined> = {
        doings: gt.doings_count,
        windows: gt.missed_windows,
        checkins: gt.missed_windows,
        impulses: gt.impulse_failures,
        failures: gt.impulse_failures,
      };
      if (claim.value !== undefined && field[claim.unit ?? ""] === claim.value) {
        licensedBy = `ground_truth.${claim.unit}`;
      }
    }

    if (licensedBy === null && hasVerifiedNumber(context, claim)) licensedBy = "verified_goal";
    if (licensedBy === null) {
      violations.push({
        claim,
        reason: "unsourced",
        detail: `no ground-truth field carries ${claim.value} ${claim.unit ?? ""}`.trim(),
      });
    }
  }

  return violations;
}

export type EvidenceMode = "verified" | "unverified";

/** FR-19: verified mode requires at least one cited goal; otherwise the hard ban applies. */
export function evidenceMode(verifiedGoals: string[]): EvidenceMode {
  return arrayLength(verifiedGoals) > 0 ? "verified" : "unverified";
}

function arrayLength(value: string[] | null | undefined): number {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0).length : 0;
}

/** The assembled evidence, one shape the prompt builder and the claim-check both read. */
export function assembleEvidence(context: EvidenceContext): EvidenceContext & { mode: EvidenceMode } {
  return {
    ground_truth: context.ground_truth,
    verified_goals: [...context.verified_goals],
    mode: evidenceMode(context.verified_goals),
  };
}

export interface SeverityEvent {
  severity: "S1" | "S2" | "S3";
  /** ISO timestamp of the journal entry's `created_at`. */
  at: string;
}

/**
 * FR-19's S1/S2 snooze: a journal S1/S2 inside the trailing 24 hours defers the Strike by 24
 * hours. The dispatcher's snooze convention resets the row and decrements `attempts` — a
 * deferral is never an attempt (the §2.2 budget-release precedent).
 */
export function snoozeDecision(
  recentSeverities: SeverityEvent[],
  nowIso: string,
): { snooze_until: string } | null {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return null;
  const trailingStart = now - 24 * 3_600_000;
  const hit = (Array.isArray(recentSeverities) ? recentSeverities : []).some((event) => {
    if (event.severity !== "S1" && event.severity !== "S2") return false;
    const at = Date.parse(event.at);
    return Number.isFinite(at) && at >= trailingStart && at <= now;
  });
  return hit ? { snooze_until: new Date(now + 24 * 3_600_000).toISOString() } : null;
}
