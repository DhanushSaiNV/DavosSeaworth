// supabase/functions/_shared/journal/submitValidate.ts
// FP-05 Step 2 — pure validation + canonical date for journal submission.
// Refs: FP-05 FR-1, FR-2, FR-3; TECH-SPEC §3.4, §7.4, §10.2; D3, D16.
// Pure (jest-loadable): no Deno.env, no service client — the IO half lives in submit-journal/index.ts.

import { isValidTimeZone } from "../checkin/windows.ts";

/** Result of parsing an optional `entry_date` hint. */
export type DateHint =
  | { ok: true; value: string | null }
  | { ok: false };

/** Result of validating the submit body. */
export type SubmitValidation =
  | { ok: true; content: string; entryDateHint: string | null }
  | { ok: false; error: string };

/** Validates and parses an optional `entry_date` hint.
 *  Accepts only strict `YYYY-MM-DD` with a real calendar date.
 *  Returns {ok: true, value: the hint string} on success, {ok: false} on any failure.
 *  Null/undefined → {ok: true, value: null} (hint not provided). */
export function parseEntryDateHint(raw: unknown): DateHint {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { ok: false };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { ok: false };
  // Real calendar check: construct UTC date and verify round-trip components.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

/** Validates the journal submit body.
 *  - `content`: must be a string, non-empty after trim, length <= maxChars. Returned verbatim (no server trim).
 *  - `entry_date`: optional; validated by parseEntryDateHint, discarded (advisory only).
 *  Returns {ok: true, content, entryDateHint} or {ok: false, error}. */
export function validateSubmitBody(
  body: Record<string, unknown>,
  maxChars: number,
): SubmitValidation {
  const content = body?.content;
  if (typeof content !== "string") return { ok: false, error: "content is required" };
  const trimmed = content.trim();
  if (trimmed.length === 0) return { ok: false, error: "content is required" };
  if (content.length > maxChars) {
    return { ok: false, error: `content exceeds ${maxChars} characters` };
  }
  const hint = parseEntryDateHint(body?.entry_date);
  if (!hint.ok) return { ok: false, error: "entry_date must be YYYY-MM-DD" };
  return { ok: true, content, entryDateHint: hint.value };
}

/** The profile-local calendar date as `YYYY-MM-DD` — the text a Postgres `date` compares to.
 *  Coerces an invalid/empty zone to UTC so every caller is safe. */
export function localDate(timezone: string, ms: number): string {
  const tz = timezone && isValidTimeZone(timezone) ? timezone : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Canonical entry date for a submit — ignores any client hint entirely.
 *  The hint is validated by validateSubmitBody but never used to compute the stored date. */
export function canonicalEntryDate(timezone: string, nowMs: number): string {
  return localDate(timezone, nowMs);
}