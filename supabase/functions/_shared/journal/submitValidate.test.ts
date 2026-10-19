// supabase/functions/_shared/journal/submitValidate.test.ts
// FP-05 Step 2 — unit tests for the journal submit validation and local-date canonicalization.
// Refs: FP-05 FR-1, FR-2, FR-3; TECH-SPEC §3.4, §7.4, §10.2.
// Jest globals declared inline (parseEnergy.test.ts precedent) so this tree loads under jest
// without importing the jest package (tsconfig excludes supabase/functions).

import {
  parseEntryDateHint,
  validateSubmitBody,
  localDate,
  canonicalEntryDate,
} from "./submitValidate.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// supabase/functions, and eslint ignores it), so declare the ones used here.
interface Expectation {
  toBe(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toEqual(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

describe("parseEntryDateHint", () => {
  it("undefined -> null hint", () => {
    expect(parseEntryDateHint(undefined)).toEqual({ ok: true, value: null });
  });
  it("null -> null hint", () => {
    expect(parseEntryDateHint(null)).toEqual({ ok: true, value: null });
  });
  it("valid YYYY-MM-DD accepted", () => {
    expect(parseEntryDateHint("2026-10-19")).toEqual({ ok: true, value: "2026-10-19" });
  });
  it("non-string rejected", () => {
    expect(parseEntryDateHint(123)).toEqual({ ok: false });
    expect(parseEntryDateHint({})).toEqual({ ok: false });
  });
  it("malformed format rejected", () => {
    expect(parseEntryDateHint("not-a-date")).toEqual({ ok: false });
    expect(parseEntryDateHint("19-10-2026")).toEqual({ ok: false });
    expect(parseEntryDateHint("2026/10/19")).toEqual({ ok: false });
  });
  it("invalid month rejected", () => {
    expect(parseEntryDateHint("2026-13-01")).toEqual({ ok: false });
    expect(parseEntryDateHint("2026-00-01")).toEqual({ ok: false });
  });
  it("invalid day rejected", () => {
    expect(parseEntryDateHint("2026-02-30")).toEqual({ ok: false });
    expect(parseEntryDateHint("2026-04-31")).toEqual({ ok: false });
    expect(parseEntryDateHint("2026-01-00")).toEqual({ ok: false });
  });
});

describe("validateSubmitBody", () => {
  const MAX = 8000;

  it("non-string content rejected", () => {
    expect(validateSubmitBody({ content: 123 }, MAX)).toEqual({
      ok: false,
      error: "content is required",
    });
  });
  it("empty string rejected", () => {
    expect(validateSubmitBody({ content: "" }, MAX)).toEqual({
      ok: false,
      error: "content is required",
    });
  });
  it("whitespace-only rejected", () => {
    expect(validateSubmitBody({ content: "   \n\t  " }, MAX)).toEqual({
      ok: false,
      error: "content is required",
    });
  });
  it("content at max boundary accepted", () => {
    const c = "a".repeat(MAX);
    const r = validateSubmitBody({ content: c }, MAX);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe(c);
  });
  it("content at max+1 rejected", () => {
    const c = "a".repeat(MAX + 1);
    expect(validateSubmitBody({ content: c }, MAX)).toEqual({
      ok: false,
      error: `content exceeds ${MAX} characters`,
    });
  });
  it("content returned verbatim (leading/trailing whitespace preserved)", () => {
    const c = "  real text  ";
    const r = validateSubmitBody({ content: c }, MAX);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe(c);
  });
  it("valid entry_date hint accepted but discarded", () => {
    const r = validateSubmitBody({ content: "hello", entry_date: "2026-10-19" }, MAX);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entryDateHint).toBe("2026-10-19");
  });
  it("bad entry_date hint rejected", () => {
    expect(validateSubmitBody({ content: "hello", entry_date: "not-a-date" }, MAX)).toEqual({
      ok: false,
      error: "entry_date must be YYYY-MM-DD",
    });
  });
  it("missing entry_date -> null hint", () => {
    const r = validateSubmitBody({ content: "hello" }, MAX);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entryDateHint).toBeNull();
  });
});

describe("localDate (canonical YYYY-MM-DD in user's timezone)", () => {
  // 2026-10-19T23:30:00Z = 2026-10-20 05:00 in UTC+5:30 (Asia/Kolkata)
  it("UTC+5:30: 23:30Z submit lands on tomorrow's local date", () => {
    const ms = Date.parse("2026-10-19T23:30:00Z");
    expect(localDate("Asia/Kolkata", ms)).toBe("2026-10-20");
  });
  // 2026-10-20T02:00:00Z = 2026-10-19 21:00 in UTC-5 (America/New_York, EDT)
  it("UTC-5: 02:00Z submit lands on previous local date", () => {
    const ms = Date.parse("2026-10-20T02:00:00Z");
    expect(localDate("America/New_York", ms)).toBe("2026-10-19");
  });
  // Month boundary: 2026-11-30T23:00Z = 2026-12-01 00:30 in UTC+1:30 (e.g., no such IANA but a valid offset)
  // Use a real zone: UTC+13 (Pacific/Tongatapu) — 2026-11-30T23:00Z -> 2026-12-01 12:00 local
  it("month wrap: UTC+13 crosses into next month", () => {
    const ms = Date.parse("2026-11-30T23:00:00Z");
    expect(localDate("Pacific/Tongatapu", ms)).toBe("2026-12-01");
  });
  // Year boundary: 2026-12-31T23:00Z in UTC+12 (Pacific/Auckland, NZDT) -> 2027-01-01
  it("year wrap: UTC+12 crosses into next year", () => {
    const ms = Date.parse("2026-12-31T23:00:00Z");
    expect(localDate("Pacific/Auckland", ms)).toBe("2027-01-01");
  });
  // Leap day: 2024-02-29 is valid
  it("leap day: UTC midnight is 2024-02-29", () => {
    const ms = Date.parse("2024-02-29T00:00:00Z");
    expect(localDate("UTC", ms)).toBe("2024-02-29");
  });
  // UTC is the default/fallback
  it("UTC zone returns UTC date", () => {
    const ms = Date.parse("2026-10-19T12:00:00Z");
    expect(localDate("UTC", ms)).toBe("2026-10-19");
  });
  it("invalid zone falls back to UTC", () => {
    const ms = Date.parse("2026-10-19T23:30:00Z");
    // "Not/AZone" is not a valid IANA zone
    expect(localDate("Not/AZone", ms)).toBe("2026-10-19");
  });
  it("empty zone falls back to UTC", () => {
    const ms = Date.parse("2026-10-19T23:30:00Z");
    expect(localDate("", ms)).toBe("2026-10-19");
  });
});

describe("canonicalEntryDate (hint is ignored)", () => {
  it("equals localDate for the same inputs", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(canonicalEntryDate("UTC", now)).toBe(localDate("UTC", now));
    expect(canonicalEntryDate("Asia/Kolkata", now)).toBe(localDate("Asia/Kolkata", now));
  });
});