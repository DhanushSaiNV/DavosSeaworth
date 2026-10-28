// supabase/functions/_shared/dev/goldenSet.ts
// FP-03 Step 6 — dev-only golden set for the classifier eval gate (NFR-4, AC-9, D19, §6.4).
//
// Owner-accepted evaluation fixture (2026-10-28): the 40 items and their expectations are the
// accepted evaluation baseline. Dev-only and never seeded; the BG-01 content-migration rule
// does not apply to it, the labelling rule does (AGENTS.md §8.4).
//
// These 40 items exist so the classifier can be *evaluated*; the expectations are the owner's
// accepted baseline, and the report the gate produces
// (`docs/feature-prds/FP-03/FP-03-GOLDEN-SET-<date>.md`) is the evidence the owner judges.
//
// Never seeded. This module is a test fixture only — no `dev-smoke` action writes it to a table,
// so the BG-01 content-migration rule does not apply to it; the labelling rule does.
//
// Disjointness is an authoring rule, checked two ways: `goldenSet.test.ts` enforces uniqueness
// inside the set, and `scripts/verify-fp03-step6.py` asserts (statically against
// `placeholderExemplars.ts` and live against the seeded rows) that no golden text is present in
// the exemplar corpus — a leaked item would measure memorisation instead of generalisation.
//
// Why these 12 domains for the `clear` bucket: the plan requires distinct, non-overlapping
// domains, and `Mental/Emotional` is the one §3.3 label that is inherently conflatable with the
// emotion set (D19's topical/emotional conflation trade-off). Putting it in the *clear* bucket
// would be an authoring error, so it appears in the `ambiguous` bucket instead, paired with the
// domain it genuinely overlaps. The remaining 12 labels carry distinctive vocabulary
// (Health = sleep/medical vs Fitness = training; Social = friends/belonging vs
// Communication = expressing; Environment/Home = the physical space).
//
// Item shape is the plan's: `{id, text, case, expect}`. `expect` is intentionally a loose shape
// (one field per case) rather than a discriminated union, so the eval action and the report stay
// simple; the per-case well-formedness is enforced by `goldenSet.test.ts` and the step-6 gate.
//
// Counts (§6.4 / FP-03-PLAN Step 6): 12 clear-domain + 8 ambiguous + 8 energy (4 low, 4 high)
// + 6 quit + 6 false-constraint = 40.

/** Which bucket a golden item belongs to — each has its own expectation shape and metric. */
export type GoldenCase = "clear" | "ambiguous" | "energy" | "quit" | "false_constraint";

/**
 * One item's expectation. Only the field(s) its `case` defines are meaningful:
 *   clear           → `domain`
 *   ambiguous       → `domains` (both are "not wrong")
 *   energy          → `energy` + the `emotion` the override must force
 *   quit            → `quit_label` = "quit"
 *   false_constraint→ `quit_label` = "false_constraint"
 */
export interface GoldenExpectation {
  domain?: string;
  domains?: [string, string];
  energy?: number;
  emotion?: string;
  quit_label?: string;
}

export interface GoldenItem {
  id: string;
  text: string;
  case: GoldenCase;
  expect: GoldenExpectation;
}

/** The fixture's provenance stamp — never `PLACEHOLDER-DEV` or `BG-04` (it is not seeded). */
export const GOLDEN_SET_SOURCE = "GOLDEN-ACCEPTED";

export const GOLDEN_SET: GoldenItem[] = [
  // ==========================================================================
  // clear-domain — 12 items, 12 distinct §3.3 labels, one idea each
  // ==========================================================================
  {
    id: "G-01",
    case: "clear",
    text: "I keep getting passed over for the lead role at work and I don't know what I'm doing wrong.",
    expect: { domain: "Career" },
  },
  {
    id: "G-02",
    case: "clear",
    text: "I looked at my savings account and I've been spending more than I earn every single month.",
    expect: { domain: "Finance" },
  },
  {
    id: "G-03",
    case: "clear",
    text: "My squat numbers have stalled for weeks and my training plan isn't working anymore.",
    expect: { domain: "Fitness" },
  },
  {
    id: "G-04",
    case: "clear",
    text: "I've been sleeping four hours a night and I feel like my body is falling apart.",
    expect: { domain: "Health" },
  },
  {
    id: "G-05",
    case: "clear",
    text: "I'm halfway through the statistics course and I still can't follow the lectures.",
    expect: { domain: "Learning" },
  },
  {
    id: "G-06",
    case: "clear",
    text: "I sit down to write and the ideas just won't come out of my head onto the page.",
    expect: { domain: "Creativity" },
  },
  {
    id: "G-07",
    case: "clear",
    text: "My partner and I have been arguing about the same thing for months now.",
    expect: { domain: "Relationships" },
  },
  {
    id: "G-08",
    case: "clear",
    text: "My mother calls me every single day and I dread picking up the phone.",
    expect: { domain: "Family" },
  },
  {
    id: "G-09",
    case: "clear",
    text: "I've drifted apart from my whole friend group and I don't know how to rejoin it.",
    expect: { domain: "Social" },
  },
  {
    id: "G-10",
    case: "clear",
    text: "I've stopped praying and I feel disconnected from what I believe in.",
    expect: { domain: "Spirituality" },
  },
  {
    id: "G-11",
    case: "clear",
    text: "I stay up until two in the morning every night even though I promise myself I'll go to bed early.",
    expect: { domain: "Discipline/Habits" },
  },
  {
    id: "G-12",
    case: "clear",
    text: "My apartment is a mess and I can't bring myself to deal with the clutter.",
    expect: { domain: "Environment/Home" },
  },

  // ==========================================================================
  // ambiguous — 8 items, each genuinely plausible in both listed domains
  // ==========================================================================
  {
    id: "G-13",
    case: "ambiguous",
    text: "I keep replaying the argument with my sister and I can't stop feeling awful about it.",
    expect: { domains: ["Mental/Emotional", "Relationships"] },
  },
  {
    id: "G-14",
    case: "ambiguous",
    text: "My boss promised me a raise six months ago and it still hasn't come through.",
    expect: { domains: ["Career", "Finance"] },
  },
  {
    id: "G-15",
    case: "ambiguous",
    text: "My back has been killing me since I started deadlifting again.",
    expect: { domains: ["Fitness", "Health"] },
  },
  {
    id: "G-16",
    case: "ambiguous",
    text: "I keep breaking every promise I make to myself and it's wearing me down.",
    expect: { domains: ["Discipline/Habits", "Mental/Emotional"] },
  },
  {
    id: "G-17",
    case: "ambiguous",
    text: "I want to move into data work but I'd have to go back and study for a year.",
    expect: { domains: ["Learning", "Career"] },
  },
  {
    id: "G-18",
    case: "ambiguous",
    text: "My dad's health is getting worse and I feel guilty for not visiting him more.",
    expect: { domains: ["Family", "Mental/Emotional"] },
  },
  {
    id: "G-19",
    case: "ambiguous",
    text: "I spend every evening gaming and I know I should be doing something better with the time.",
    expect: { domains: ["Recreation", "Discipline/Habits"] },
  },
  {
    id: "G-20",
    case: "ambiguous",
    text: "I freeze up in group conversations and never say what I actually think.",
    expect: { domains: ["Social", "Communication"] },
  },

  // ==========================================================================
  // energy — 8 items; 4 at the floor (exhausted), 4 at the ceiling (determined).
  // Half of each group is authored to pull the *embedding* argmax elsewhere, so the
  // override is genuinely exercised rather than trivially agreeing.
  // ==========================================================================
  {
    id: "G-21",
    case: "energy",
    text: "I'm exhausted, I've been dragging myself through every hour of today.",
    expect: { energy: 2, emotion: "exhausted" },
  },
  {
    id: "G-22",
    case: "energy",
    text: "My mind is racing and I'm too worn out to calm it down.",
    expect: { energy: 2, emotion: "exhausted" },
  },
  {
    id: "G-23",
    case: "energy",
    text: "I keep snapping at people and I'm running on fumes.",
    expect: { energy: 2, emotion: "exhausted" },
  },
  {
    id: "G-24",
    case: "energy",
    text: "I have nothing left in the tank and everything feels heavy.",
    expect: { energy: 2, emotion: "exhausted" },
  },
  {
    id: "G-25",
    case: "energy",
    text: "I'm determined to turn this around and I feel unstoppable today.",
    expect: { energy: 9, emotion: "determined" },
  },
  {
    id: "G-26",
    case: "energy",
    text: "I'm so fired up I could run through a wall right now.",
    expect: { energy: 9, emotion: "determined" },
  },
  {
    id: "G-27",
    case: "energy",
    text: "I feel genuinely proud of how far I've come this month.",
    expect: { energy: 9, emotion: "determined" },
  },
  {
    id: "G-28",
    case: "energy",
    text: "I've got real momentum and I'm not slowing down for anything.",
    expect: { energy: 9, emotion: "determined" },
  },

  // ==========================================================================
  // quit — 6 give-up phrasings (§6.4 quit set, label `quit`)
  // ==========================================================================
  {
    id: "G-29",
    case: "quit",
    text: "There's no point in any of this anymore, I'm done trying.",
    expect: { quit_label: "quit" },
  },
  {
    id: "G-30",
    case: "quit",
    text: "I give up, nothing I do makes any difference.",
    expect: { quit_label: "quit" },
  },
  {
    id: "G-31",
    case: "quit",
    text: "I'm going to quit the whole thing, I can't keep pretending anymore.",
    expect: { quit_label: "quit" },
  },
  {
    id: "G-32",
    case: "quit",
    text: "What's the use? I'm never going to get anywhere with this.",
    expect: { quit_label: "quit" },
  },
  {
    id: "G-33",
    case: "quit",
    text: "I've decided to stop and walk away from all of it.",
    expect: { quit_label: "quit" },
  },
  {
    id: "G-34",
    case: "quit",
    text: "It doesn't matter what I try, so I'm just going to give up.",
    expect: { quit_label: "quit" },
  },

  // ==========================================================================
  // false_constraint — 6 fake-excuse phrasings (§6.4 quit set, label `false_constraint`)
  // ==========================================================================
  {
    id: "G-35",
    case: "false_constraint",
    text: "I'd do it but I have absolutely no time with everything going on.",
    expect: { quit_label: "false_constraint" },
  },
  {
    id: "G-36",
    case: "false_constraint",
    text: "I can't start until things calm down, there's no room in my schedule.",
    expect: { quit_label: "false_constraint" },
  },
  {
    id: "G-37",
    case: "false_constraint",
    text: "I have no choice in this, my situation doesn't let me change anything.",
    expect: { quit_label: "false_constraint" },
  },
  {
    id: "G-38",
    case: "false_constraint",
    text: "It's not my fault, the circumstances just won't allow it.",
    expect: { quit_label: "false_constraint" },
  },
  {
    id: "G-39",
    case: "false_constraint",
    text: "I would if I could, but my hands are completely tied here.",
    expect: { quit_label: "false_constraint" },
  },
  {
    id: "G-40",
    case: "false_constraint",
    text: "There's no way I can fit this in, my days are already full.",
    expect: { quit_label: "false_constraint" },
  },
];
