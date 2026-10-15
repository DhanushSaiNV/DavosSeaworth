// supabase/functions/_shared/dev/placeholderRules.ts
// FP-02 Step 2 — dev-only placeholder rules.
// AGENTS.md §8.4: placeholder seeds must be clearly labeled placeholders and never
// presented as final content. Every seeded row carries source_figure = "PLACEHOLDER-DEV".
// Removal is the single-step dev-smoke ?action=clear-rules (FR-9).

import type { RuleTone } from "../pipeline/retrieveRules.ts";

export interface PlaceholderRule {
  text: string;
  domain: string;
  tone: RuleTone;
  priority: number;
}

export const PLACEHOLDER_SOURCE_FIGURE = "PLACEHOLDER-DEV";
export const PLACEHOLDER_EMBED_MODEL = "gemini-embedding-001@768";

// 9 rows across 3 domains (≥2 domains per the Step 2 spec).
//
// Discipline/Habits holds the crafted conflict fixture: aggressive 80 + empathetic 70
// (gap 10 ≤ conflict_priority_window 15) ⇒ the filter drops the empathetic group,
// leaving exactly one tone group to verify AC-5. It is isolated to a 2-row domain so
// top-5 retrieval always returns both rows regardless of embedding quality.
//
// The other domains keep every aggressive↔empathetic gap > 15 so the filter does NOT
// fire there — proving the filter only triggers on the crafted pair.
export const PLACEHOLDER_RULES: PlaceholderRule[] = [
  // --- Discipline/Habits: the conflict fixture ---
  {
    domain: "Discipline/Habits",
    tone: "aggressive",
    priority: 80,
    text: "Discipline is the bridge between goals and accomplishment; stop negotiating with yourself and execute.",
  },
  {
    domain: "Discipline/Habits",
    tone: "empathetic",
    priority: 70,
    text: "Be patient with yourself — small daily habits compound gently into lasting change.",
  },

  // --- Career ---
  {
    domain: "Career",
    tone: "aggressive",
    priority: 80,
    text: "Nobody is coming to save your career; outwork the room and stop waiting for permission.",
  },
  {
    domain: "Career",
    tone: "neutral",
    priority: 60,
    text: "Map the next concrete skill milestone and schedule time for deliberate practice.",
  },
  {
    domain: "Career",
    tone: "neutral",
    priority: 50,
    text: "Ask for feedback from someone two steps ahead of you this week.",
  },
  {
    domain: "Career",
    tone: "empathetic",
    priority: 40,
    text: "It's okay to move at your own pace; progress in a career is rarely linear.",
  },

  // --- Fitness ---
  {
    domain: "Fitness",
    tone: "aggressive",
    priority: 75,
    text: "Excuses burn no calories; train when you don't feel like it or stay where you are.",
  },
  {
    domain: "Fitness",
    tone: "neutral",
    priority: 55,
    text: "Consistency beats intensity: three short sessions a week outperform one heroic effort.",
  },
  {
    domain: "Fitness",
    tone: "empathetic",
    priority: 35,
    text: "Be kind to your body; rest is part of the training, not a failure of discipline.",
  },
];
