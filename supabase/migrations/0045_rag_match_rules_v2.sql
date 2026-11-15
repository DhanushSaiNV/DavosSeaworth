-- Migration 0045_rag_match_rules_v2
-- RAG redesign Phase 1 (PLAN.md §6.1, §6.5, §9.2, §10, §13; owner decision D4 approved 2026-11-15).
--
-- One function: public.match_rules_v2, the retrieval replacement for the legacy match_rules.
--
-- Why a second function instead of replacing match_rules in place: the legacy caller
-- (_shared/pipeline/retrieveRules.ts:63) is service-role and must keep working untouched until P3.
-- match_rules returns SETOF public.rules, embedding included; match_rules_v2 returns an explicit
-- column list with no embedding, so the exclusion is a property of the type, not of a caller's
-- promise (D1). 0047 retires the old name.
--
-- Differences from the legacy function, each deliberate:
--   * p_min_similarity has NO DEFAULT. An uncalibrated threshold must fail at the call site rather
--     than silently degrade retrieval to "everything" (§10).
--   * p_domain_hints boost, never filter: ordering is similarity desc, hint_rank asc (§6.5). A
--     hint that matches no rule is simply inert.
--   * No `where domain = ...` equality filter. The legacy function's case-sensitive equality (and
--     its zero-row behaviour on a lowercase literal) is not reproduced.
--
-- D4 (owner decision): p_domain_hints is NOT validated against a 16-domain enum. `rules.domain`
-- has no CHECK constraint and the 16-domain enum exists nowhere in the repository, so validating
-- against a list this migration would have to invent is exactly the "do not invent" failure. The
-- parameter is an opaque hint list; an unknown value cannot error and cannot widen the result set.
--
-- Refs: PLAN.md §6.1, §6.5, §9.2, §10, §13; RAG PRD §6.1 line 484-491 and §6.2; AGENTS.md §4.4.
--
-- Note on the service_role grant: the §6.1 prologue rejects a null auth.uid(), so a service_role
-- call must carry the user's JWT claims (which is what an Edge Function forwarding the caller's
-- token does). The grant is not a bypass and does not widen the corpus; it exists so the pipeline
-- can call this function as the authenticated user it is acting for.

create or replace function public.match_rules_v2(
  p_query_embedding vector,
  p_min_similarity double precision,
  p_domain_hints text[] default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  text text,
  domain text,
  tone text,
  priority integer,
  similarity double precision
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- D5: the parameter is an unconstrained vector and the dimension is checked here, because a
  -- vector(768) parameter would be cast-checked before the body ran.
  if p_query_embedding is null or public.vector_dims(p_query_embedding) is distinct from 768 then
    raise exception 'embedding_dimension' using errcode = '22023';
  end if;

  if p_min_similarity is null or p_min_similarity <= 0 or p_min_similarity > 1 then
    raise exception 'similarity_threshold_invalid' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  return query
  select s.id, s.text, s.domain, s.tone, s.priority, s.similarity
  from (
    select r.id as id,
           r.text as text,
           r.domain as domain,
           r.tone as tone,
           r.priority as priority,
           1 - (r.embedding operator(public.<=>) p_query_embedding) as similarity,
           case when p_domain_hints is not null and r.domain = any (p_domain_hints)
                then 0 else 1 end as hint_rank
    from public.rules r
    where r.embedding is not null
  ) s
  where s.similarity >= p_min_similarity
  order by s.similarity desc, s.hint_rank asc, s.id
  limit p_limit;
end;
$$;

revoke all on function public.match_rules_v2(vector, double precision, text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.match_rules_v2(vector, double precision, text[], integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verify:
--   -- no embedding in the return type; grants exactly authenticated + service_role
--   select p.proname, p.prosecdef, p.proconfig,
--          coalesce(array_to_string(p.proacl, ' | '), '(none)') as acl,
--          pg_get_function_result(p.oid) as result
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'match_rules_v2';
--
--   -- authenticated gets rows, anon gets 42501:
--   --   select count(*) from public.match_rules_v2(
--   --     (select embedding from public.rules where embedding is not null limit 1), 0.1, null, 5);
