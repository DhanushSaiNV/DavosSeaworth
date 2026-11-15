-- Migration 0039_rag_forbidden_table_revokes
-- RAG redesign Phase 0 (PLAN.md §7, §6.5; owner decisions B-8 approved 2026-11-15).
--
-- Two defects close here, both live-catalog confirmed on 2026-11-15:
--
-- (1) Eight tables carried `anon` + `authenticated` privileges they never needed, including
--     the full DML set (`arwdDxtm`) on `rules`, `exemplars` and `jobs`. `jobs` in particular
--     let a signed-in user enqueue arbitrary work. `REVOKE ALL` is used rather than a targeted
--     list because it also removes TRUNCATE / REFERENCES / TRIGGER / MAINTAIN, and TRUNCATE is
--     NOT protected by RLS. (Not reachable through PostgREST; defence in depth, stated plainly.)
--
-- (2) `public.match_rules` is SECURITY DEFINER, RETURNS SETOF rules (embedding included) and
--     granted EXECUTE to `authenticated`. It also had NO pinned `search_path`, and its body is
--     fully unqualified:
--         select * from rules where domain = match_domain
--         order by embedding <=> query_embedding limit match_count;
--     So it cannot simply be given `search_path = ''` - that would break it. The body is
--     therefore REPLACED with a fully qualified one, preserving the signature, the parameter
--     names (query_embedding / match_domain / match_count), the DEFAULT 5 and the return type
--     (CREATE OR REPLACE cannot change any of those anyway). EXECUTE then goes to service_role
--     only, so no authenticated caller can retrieve rule embeddings.
--
--     This closes drift recorded in 0025_match_exemplars.sql ("match_rules never revoked it and
--     has no pinned search_path - known drift, out of FP-03 scope").
--
-- `match_exemplars` gets the same treatment: its body qualifies `public.exemplars` but uses an
-- unqualified `<=>`, so `search_path = ''` needs the operator qualification too. It returns no
-- embedding, but it is a global-corpus aggregate with no reason to be user-callable; its only
-- callers are service-role (classifyReal.ts:98, dev-smoke).
--
-- Legacy callers verified before this migration was written:
--   match_rules      -> _shared/pipeline/retrieveRules.ts:63 (supabaseService),
--                       retrieveLockdownRules (runPipeline.ts:545) delegates to it.
--   match_exemplars  -> _shared/pipeline/classifyReal.ts:98 (supabaseService),
--                       dev-smoke/index.ts:908,1156 (service-role client at :110).
-- No other caller exists in the repository.
--
-- Refs: PLAN.md §6.5, §7, §9.2; RAG PRD §9.4; AGENTS.md §4.5, §4.8.

-- ---------------------------------------------------------------------------- (a) table revokes

-- Knowledge corpus: service-role only. Retrieval reaches it through match_rules_v2 (0044) and
-- the legacy match_rules below, never through PostgREST.
revoke all on public.rules from anon, authenticated;
drop policy if exists rules_select_authenticated on public.rules;

revoke all on public.exemplars from anon, authenticated;
drop policy if exists exemplars_select_authenticated on public.exemplars;

-- jobs: the dispatcher is service-role. `authenticated` held INSERT here, i.e. any signed-in
-- user could enqueue work of any type.
revoke all on public.jobs from anon, authenticated;

-- Server-only audit trail. The `r` grant was already absent, which made
-- trust_events_select_own inert; the `awdDxtm` bits were not.
revoke all on public.trust_events from anon, authenticated;
drop policy if exists trust_events_select_own on public.trust_events;

-- Persona weighting: the capped self-service surface closed in 0036; the read grant did not.
revoke all on public.persona_stats from anon, authenticated;
drop policy if exists persona_stats_select_own on public.persona_stats;
drop policy if exists persona_stats_insert_own on public.persona_stats;
drop policy if exists persona_stats_update_own on public.persona_stats;

-- memory_facts: retrieval moves to four narrow SECURITY DEFINER RPCs (0043). Direct table
-- access closes completely, including the embedding column.
revoke all on public.memory_facts from anon, authenticated;
drop policy if exists memory_facts_select_own on public.memory_facts;
drop policy if exists memory_facts_insert_own on public.memory_facts;
drop policy if exists memory_facts_update_own on public.memory_facts;

-- habits / journal_entries: no client read or write path exists (every write is a sync fn, a
-- job or a trigger; every read is server-side). Journal content additionally must never be a
-- client-visible surface (AGENTS.md §4.2).
revoke all on public.habits from anon, authenticated;
drop policy if exists habits_select_own on public.habits;
drop policy if exists habits_insert_own on public.habits;
drop policy if exists habits_update_own on public.habits;

revoke all on public.journal_entries from anon, authenticated;
drop policy if exists journal_entries_select_own on public.journal_entries;
drop policy if exists journal_entries_insert_own on public.journal_entries;
drop policy if exists journal_entries_update_own on public.journal_entries;

-- ---------------------------------------------------------------------------- (b) match_rules

-- Same signature, same parameter names, same default, same return type. Only the body and the
-- search_path change. `OPERATOR(public.<=>)` is required because pgvector is installed in
-- `public` and the path is now empty.
create or replace function public.match_rules(
  query_embedding vector(768),
  match_domain text,
  match_count integer default 5
)
returns setof public.rules
language sql
security definer
set search_path = ''
as $$
  select r.*
  from public.rules r
  where r.domain = match_domain
  order by r.embedding operator(public.<=>) query_embedding
  limit match_count;
$$;

revoke all on function public.match_rules(vector(768), text, integer)
  from public, anon, authenticated;
grant execute on function public.match_rules(vector(768), text, integer) to service_role;

-- ---------------------------------------------------------------------------- (c) match_exemplars

create or replace function public.match_exemplars(query_embedding vector(768))
returns table (set_kind text, label text, sim double precision)
language sql
security definer
set search_path = ''
as $$
  select e.set_kind,
         e.label,
         max(1 - (e.embedding operator(public.<=>) query_embedding)) as sim
  from public.exemplars e
  group by e.set_kind, e.label
  order by e.set_kind,
           max(1 - (e.embedding operator(public.<=>) query_embedding)) desc;
$$;

revoke all on function public.match_exemplars(vector(768))
  from public, anon, authenticated;
grant execute on function public.match_exemplars(vector(768)) to service_role;

-- Verify:
--   -- table ACLs: expect no anon/authenticated entry at all
--   select c.relname, coalesce(array_to_string(c.relacl, ' | '), '(default)') as acl
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('rules','exemplars','jobs','trust_events','persona_stats',
--                        'memory_facts','habits','journal_entries')
--    order by 1;
--
--   -- functions: expect prosecdef = true, proconfig = {search_path=}, and no "=X" ACL entry
--   select p.proname, p.prosecdef, p.proconfig, array_to_string(p.proacl, ' | ') as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('match_rules','match_exemplars');
--
--   -- legacy path still works (service role only):
--   select count(*) from public.match_rules(
--     (select embedding from public.rules where embedding is not null limit 1), 'health', 5);
