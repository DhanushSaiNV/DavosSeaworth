-- Migration 0047_rag_match_rules_compat
-- RAG redesign Phase 5 (PLAN.md §1.10 Decision D20, §6.5, §10, §15 Gate G3).
--
-- Upgrades legacy public.match_rules with calibrated similarity threshold gating and domain filtering.
--
-- Background (PLAN.md §1.10 D20):
--   Original plan scheduled 0047 to drop match_rules and rename match_rules_v2 to match_rules.
--   However, doing so would break the kill switch (rag_planner_enabled = false), because the
--   legacy retrieval path (_shared/pipeline/retrieveRules.ts:63) invokes match_rules with named
--   arguments (query_embedding, match_domain, match_count), whereas match_rules_v2 declares
--   p_query_embedding, p_min_similarity (mandatory), p_domain_hints, p_limit.
--
-- Resolution (Decision D20 Option A):
--   Provide a backward-compatible 3-argument version of match_rules that:
--     1. Preserves the exact signature (query_embedding vector(768), match_domain text, match_count integer)
--        and parameter names expected by retrieveRules.ts.
--     2. Reads the calibrated similarity threshold from public.config ('rag_rules_min_similarity',
--        coalescing to 0.76 if absent).
--     3. Enforces cosine similarity filtering: (1.0 - (embedding <=> query_embedding)) >= v_min_similarity.
--     4. Returns setof public.rules, keeping the return type identical.
--     5. Retains SECURITY DEFINER, pinned search_path = '', and EXECUTE restricted to service_role only.
--
-- Refs: PLAN.md §1.10 (D20), §6.5, §10, §15; PRD §10, §15; AGENTS.md §4.4.

create or replace function public.match_rules(
  query_embedding vector(768),
  match_domain text,
  match_count integer default 5
)
returns setof public.rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min_similarity double precision;
begin
  -- Read calibrated similarity threshold from config
  select coalesce(value::text::double precision, 0.76) into v_min_similarity
  from public.config
  where key = 'rag_rules_min_similarity';

  if v_min_similarity is null or v_min_similarity <= 0.0 or v_min_similarity > 1.0 then
    v_min_similarity := 0.76;
  end if;

  return query
  select r.*
  from public.rules r
  where (match_domain is null or r.domain = match_domain)
    and (1.0 - (r.embedding operator(public.<=>) query_embedding)) >= v_min_similarity
  order by (1.0 - (r.embedding operator(public.<=>) query_embedding)) desc
  limit least(coalesce(match_count, 5), 20);
end;
$$;

revoke all on function public.match_rules(vector(768), text, integer)
  from public, anon, authenticated;
grant execute on function public.match_rules(vector(768), text, integer) to service_role;
