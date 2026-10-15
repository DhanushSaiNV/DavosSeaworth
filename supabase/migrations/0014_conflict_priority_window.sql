-- Migration 0014_conflict_priority_window
-- FP-02 Step 2: config key for the §5.2 conflict filter priority window.
-- AGENTS.md §2: [SPEC] values are tunable defaults read from `config` at runtime.
-- NB: `value` is jsonb — the quoted '15' is parsed as the JSON number 15 (a bare 15
-- fails: "cannot cast type integer to jsonb"); matches the 0001 numeric-key convention.

insert into config (key, value, description) values
('conflict_priority_window', '15', 'Same-domain aggressive+empathetic rule groups within this priority gap → drop the lower-priority group (§5.2 [SPEC])');
