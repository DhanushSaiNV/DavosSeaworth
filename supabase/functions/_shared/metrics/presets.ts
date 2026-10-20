// supabase/functions/_shared/metrics/presets.ts
// FP-07 Step 3 — the core-metric preset library.
//
// Refs: FP-07 FR-9, FR-10; TECH-SPEC §7.9, §3.3, §3.4; decisions2 D9 / TECH-SPEC D10, D17.
//
// Every formula is over the eight §7.9 variables only. Domains are the canonical BG-02
// Option 1 set (GLOSSARY §14), never the superseded Option 2 labels. The unit suite runs
// every entry through the real gate; an unvalidated preset cannot ship.
//
// Names are the idempotency key for `seed-metrics` because `metrics` carries no unique
// constraint on (user_id, name) — a recorded reading in FP-07-PLAN Step 3.

import type { FormulaVariable } from "./formula.ts";

export interface MetricPreset {
  name: string;
  domain: string;
  output_unit: string;
  formula: Record<string, unknown>;
}

/** The only legal `var` names in every preset — kept here so a preset cannot invent one. */
const V = (name: FormulaVariable): { var: FormulaVariable } => ({ var: name });

export const METRIC_PRESETS: readonly MetricPreset[] = [
  {
    name: "Momentum",
    domain: "Discipline/Habits",
    output_unit: "doings",
    formula: V("doings_count"),
  },
  {
    name: "Deep Work Hours",
    domain: "Career",
    output_unit: "h",
    formula: V("hours_logged"),
  },
  {
    name: "Check-in Consistency",
    domain: "Discipline/Habits",
    output_unit: "%",
    formula: { "*": [V("checkin_compliance_rate"), 100] },
  },
  {
    name: "Energy Level",
    domain: "Health",
    output_unit: "/10",
    formula: {
      if: [{ "==": [V("doings_count"), 0] }, 0, V("energy_avg")],
    },
  },
  {
    name: "Impulse Control",
    domain: "Discipline/Habits",
    output_unit: "score",
    formula: {
      if: [{ "==": [V("impulse_failures"), 0] }, 1, 0],
    },
  },
  {
    name: "Journal Positivity",
    domain: "Mental/Emotional",
    output_unit: "%",
    formula: {
      if: [
        { "==": [{ "+": [V("journal_positive_mentions"), V("journal_negative_mentions")] }, 0] },
        0,
        {
          "*": [
            {
              "/": [
                V("journal_positive_mentions"),
                { "+": [V("journal_positive_mentions"), V("journal_negative_mentions")] },
              ],
            },
            100,
          ],
        },
      ],
    },
  },
  {
    name: "Quest Completions",
    domain: "Purpose/Legacy",
    output_unit: "quests",
    formula: V("quest_completions"),
  },
  {
    name: "Life Balance",
    domain: "Purpose/Legacy",
    output_unit: "pts",
    formula: {
      "+": [
        {
          "+": [
            { min: [V("doings_count"), 8] },
            { min: [V("hours_logged"), 8] },
          ],
        },
        { "*": [V("checkin_compliance_rate"), 4] },
      ],
    },
  },
];

export const METRIC_PRESET_NAMES: readonly string[] = METRIC_PRESETS.map((p) => p.name);
