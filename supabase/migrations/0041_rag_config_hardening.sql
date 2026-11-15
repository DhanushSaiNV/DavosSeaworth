-- Migration 0041_rag_config_hardening
-- RAG redesign Phase 0 (PLAN.md §7.1, owner decision B-9 approved 2026-11-15).
--
-- Live state before this migration: `config` had RLS DISABLED and `anon` held `Dxtm`
-- (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) while `authenticated` held `rDxtm`. Every earlier
-- migration that touched this table ended with `grant select on config to anon, authenticated`
-- (0012, 0017, 0018, 0020, 0021, 0022, 0023, 0026, 0027, 0028, 0029, 0031, 0032) - the last one
-- wins, and that is how `anon` ended up with write-ish residual privileges.
--
-- `anon` is revoked entirely: the client is always authenticated (lib/config.ts runs behind the
-- session). `authenticated` keeps column-level SELECT on exactly (key, value), which is the whole
-- of lib/config.ts:95.
--
-- RLS stays DISABLED here (owner decision B-9). Enabling it would require a policy enumerating
-- every key any client screen reads, because loadConfig() fetches the entire table and parses it
-- into a map (lib/config.ts:87-118); a partial policy would break config loading outright. What
-- protects the table instead:
--   * `anon` has no access at all;
--   * `authenticated` can read only (key, value), never `description`;
--   * all 70 live keys are tunables - no secret, no user data, no per-user value. API keys live
--     only in Edge Function secrets (AGENTS.md §4.5). `trust_threshold` is a global tunable and
--     is NOT the hidden per-user `trust_score` (AGENTS.md §4.7).
--
-- Refs: PLAN.md §7.1, §17 item 3; RAG PRD §9.4; AGENTS.md §4.5, §4.7.

revoke all on public.config from anon, authenticated;

grant select (key, value) on public.config to authenticated;

-- No policies: RLS is off, and adding one without enabling RLS would be decorative. Recorded as
-- a known limitation (PLAN.md §17) rather than half-done here.

-- Verify:
--   select c.relacl, c.relrowsecurity from pg_class c
--    where c.oid = 'public.config'::regclass;
--   -- expect: relacl has postgres and service_role only (no anon, no authenticated),
--   --         relrowsecurity = false
--
--   select a.attname, a.attacl from pg_attribute a
--    where a.attrelid = 'public.config'::regclass and a.attacl is not null;
--   -- expect: exactly two rows - key and value, each with authenticated=r
--
--   -- as anon:       expect 42501 (permission denied for table config)
--   -- as authenticated: expect rows, and `select description` to fail with 42501
