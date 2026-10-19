-- Migration 0028_journal_chain_fp05
-- FP-05 Step 1: four config seeds for the evening journal chain.
-- No schema change: the 0007 tables (journal_entries, anchor_plans, memory_facts)
-- already carry every column FP-05 needs. This migration only seeds config.
--
-- Refs: FP-05 FR-7, FR-8, FR-11, FR-15; TECH-SPEC §11, §7.4, §7.2; D14, D16.
-- AGENTS.md §2: [SPEC] values live in `config` and are read at runtime.

-- Four config seeds, jsonb-typed correctly (the 0014/0027 lesson: quoted literals).
-- Idempotent upsert so the Verify gate's "re-applies idempotently" passes.
insert into config (key, value, description) values
  ('journal_probe_vagueness_threshold', '0.6', '§7.4 [SPEC]: an entry whose vagueness_score is at or above this value enqueues journal_probe (FP-05 FR-7)'),
  ('journal_probe_persona_severe', '"therapist_empath"', '§7.4/§5.3 [SPEC]: the probing persona for S1/S2 entries — empathetic (FP-05 FR-8)'),
  ('journal_probe_persona_vague', '"mentor_tough"', '§7.4/§5.3 [SPEC]: the probing persona for a vague S3 entry — PRD §3.4 aggressive-editor reading (FP-05 FR-8)'),
  ('anchor_plan_persona', '"mentor_tough"', '§7.2/§5.3 [SPEC]: the locked persona the next-day plan summary row generates with (FP-05 FR-11)')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

-- Read access (0026/0027 re-issue this; harmless to repeat).
grant select on config to anon, authenticated;

-- Verify (SQL editor):
--   select key, value, jsonb_typeof(value) from config
--     where key in (
--       'journal_probe_vagueness_threshold',
--       'journal_probe_persona_severe',
--       'journal_probe_persona_vague',
--       'anchor_plan_persona'
--     ) order by key;
--   → four rows; types: number, string, string, string.
--   Re-running this migration is clean (no error, no duplicate).
--   information_schema.columns diff before/after: zero rows.