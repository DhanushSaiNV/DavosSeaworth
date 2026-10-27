// supabase/functions/_shared/prompts/delimiters.ts
// Prompt-delimiter hardening for every dynamic value that rides inside a fence.
//
// Refs: AGENTS.md §4.6, §5; TECH-SPEC §10.5; FP-09 AC-11.
//
// A delimiter is only a boundary if the text cannot close it. User text, recalled
// facts, recent messages, rule text and model-authored claims are all untrusted at the
// prompt boundary: a payload containing `</user_message>` must render as literal text,
// never as a structural close. Escape the two characters that create tags. Ampersands
// are left alone so ordinary prose ("AT&T", "R&D") stays readable; `&lt;` is inert and
// cannot close a delimiter.

/** Escape angle brackets so a dynamic value cannot open or close a prompt delimiter. */
export function escapePromptText(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
