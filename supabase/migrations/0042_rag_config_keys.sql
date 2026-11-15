-- Migration 0042_rag_config_keys
-- RAG redesign Phase 0 (PLAN.md §6.2, §10, §11.3, §12; RAG PRD §4.4, §12.2).
--
-- Every tunable the planner path reads at runtime. Per AGENTS.md §2 and §9, [SPEC] values live
-- in `config` and are never hardcoded into logic.
--
-- NOTE: unlike every previous config migration, this one does NOT end with
-- `grant select on config to anon, authenticated`. 0041 revoked `anon` deliberately; re-granting
-- here would silently undo it.
--
-- `rag_planner_enabled = false` is the kill switch (PLAN.md §15). With it off, the pipeline runs
-- the existing rules + memory retrieval verbatim.
--
-- `rag_rules_min_similarity` and `rag_memory_min_similarity` are seeded as JSON `null`, not a
-- number. `value` is `jsonb not null`, so SQL NULL is not an option; JSON null is the encoding
-- for "not calibrated". thresholds.ts MUST treat BOTH an absent row and a JSON null as
-- uncalibrated and fail closed (PLAN.md §10 rule 4) - it must never substitute 0.0. A zero
-- threshold silently degrades retrieval to "return everything", which is the defect this
-- migration exists to prevent.
--
-- `rag_metadata_allowlist` starts empty. It is the set of `messages.metadata` keys the
-- `conversation` dataset may group by; it is built from actual writers and must never contain
-- `route` or `severity` (PLAN.md §6.4).
--
-- Refs: PLAN.md §6.2, §10, §11.3, §12.4; RAG PRD §4.4, §5.3, §6.1, §12.2.

insert into config (key, value, description) values
('rag_planner_enabled', 'false',
 'RAG redesign kill switch. false = existing rules+memory retrieval and the current prompt, verbatim.'),
('rag_rules_min_similarity', 'null',
 'Calibrated minimum cosine similarity for match_rules_v2. JSON null = uncalibrated, so the rules source is unavailable (never 0.0).'),
('rag_memory_min_similarity', 'null',
 'Calibrated minimum cosine similarity for search_facts. JSON null = uncalibrated, so the memory source is unavailable (never 0.0).'),
('rag_evidence_total_chars', '12000',
 'Total character budget for the assembled evidence bundle in the generation prompt.'),
('rag_compliance_max_windows', '2000',
 'Hard cap on answered check-in windows list_answered_windows may return in one call; above it the RPC raises 22023 range_too_large instead of truncating.'),
('rag_metadata_allowlist', '[]',
 'Allowlisted messages.metadata keys the conversation dataset may group by. Empty = no metadata dimension. Never contains route or severity.'),
('rag_max_plan_requests', '6',
 'Maximum retrieval requests a single plan may contain. Exceeding it rejects the plan deterministically (RAG PRD 5.3).')
on conflict (key) do nothing;

-- Verify:
--   select key, value, jsonb_typeof(value) from config where key like 'rag\_%' order by key;
--   -- expect 7 rows; the two *_min_similarity rows report jsonb_typeof = 'null'
--
--   select has_table_privilege('anon', 'public.config', 'select');          -- expect false
--   select has_column_privilege('authenticated', 'public.config', 'value', 'select'); -- expect true
