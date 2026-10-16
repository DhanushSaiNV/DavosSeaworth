-- Migration 0024_exemplars_source_fp03
-- FP-03 Step 1: exemplar provenance + the real-classifier config keys.
--
-- `exemplars.source` mirrors `rules.source_figure` (0006): one provenance label per row so
-- seed / clear / hot-swap is the same single-predicate operation on both corpus tables. The
-- FP-03 plan's Step 7 BG-04 drill swaps a `source='BG-04'` set in and out with zero code and
-- zero schema change; the default keeps every existing row labelled as placeholder dev
-- content (AGENTS.md §8.4 — placeholders stay visibly labelled, never presented as final).
--
-- AGENTS.md §2: [SPEC] values are tunable defaults read from the `config` table at runtime,
-- never hardcoded into logic. §6.3 marks the quit threshold [SPEC] and §6.2 the two energy
-- bounds, so they become keys rather than literals in the classifier. `classifier_mode` is
-- not a [SPEC] value: it is the dark-ship + rollback switch (FP-03 run/rollback recipe) —
-- `'stub'` ships FP-02's deterministic classifier, `'real'` switches stage 2 to the
-- embedding-similarity classifier. Default `'stub'` means this migration changes no behavior.
--
-- NB: `value` is jsonb — a quoted `'"stub"'` is the JSON string `stub` and bare `0.75` / `3`
-- / `8` are JSON numbers (matches the 0001 numeric-key convention; 0014 records the same
-- lesson).
--
-- No other schema change here: the table, its `set_kind` check, `embedding not null`, and the
-- `exemplars_select_authenticated` policy + authenticated-only `select` grant are exactly as
-- 0006 built them. Writes stay service-role only.
--
-- Refs: TECH-SPEC §3.3, §6.2, §6.3, §11; D19; FP-03 FR-1, FR-11.

alter table exemplars
  add column if not exists source text not null default 'PLACEHOLDER-DEV';

insert into config (key, value, description) values
('classifier_mode',       '"stub"', 'Classifier stage: stub (FP-02 deterministic) or real (FP-03 embedding-similarity, §6). Dark-ship + rollback switch, not dev-only'),
('quit_signal_threshold', '0.75',   'Quit-set top cosine similarity at or above this → quit_signal true (§6.3 [SPEC])'),
('energy_exhausted_max',  '3',      'Check-in energy at or below this forces emotion exhausted (§6.2 [SPEC])'),
('energy_determined_min', '8',      'Check-in energy at or above this forces emotion determined (§6.2 [SPEC])');

-- Verify:
-- select column_name, column_default, is_nullable from information_schema.columns
--   where table_name = 'exemplars' and column_name = 'source';
-- select key, value, jsonb_typeof(value) from config
--   where key in ('classifier_mode','quit_signal_threshold','energy_exhausted_max','energy_determined_min');
