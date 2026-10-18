// supabase/functions/_shared/checkin/parseEnergy.ts
// FP-04 Step 2 — the server energy parse (§7.1) and the capture→source map (§3.2).
//
// Refs: FP-04 FR-6, FR-7; TECH-SPEC §7.1, §3.2; GLOSSARY §14 (`Doings source`).
//
// Pure and I/O-free by design: the AC-2 table is a unit test, so this module must load under
// jest — no `Deno.env`, no service client (the `bands.ts` split, for the same reason).
//
// This regex reads **user input**, never LLM output. AGENTS.md §5.1 bans post-processing model
// text; reading the digit the user typed is the §7.1 contract, not post-processing.

export type CheckinCapture = "reply" | "chat";
export type DoingsSource = "checkin_reply" | "chat";

/**
 * §7.1: a trailing standalone integer 1–10.
 *
 * The alternation order is load-bearing — `10` is tried before `[1-9]`, or "energy 10" would
 * fall through to the single-digit branch and read as 1. `\b` keeps the two table cases that
 * must stay null: there is no word boundary between the digits of "score 11", and `0` is
 * outside 1–10, so "level 0" cannot match either.
 */
export const ENERGY_RE = /\b(10|[1-9])\s*$/;

/** The trailing energy score, or null when the text carries none — a normal outcome (FR-6). */
export function parseEnergy(text: string): number | null {
  const match = ENERGY_RE.exec(text);
  return match ? Number(match[1]) : null;
}

/** FR-7: the notification's direct reply is `checkin_reply`; the chat/deep-link path is `chat`. */
export function sourceForCapture(capture: CheckinCapture): DoingsSource {
  return capture === "reply" ? "checkin_reply" : "chat";
}
