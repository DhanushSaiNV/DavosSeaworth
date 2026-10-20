-- Migration 0029_memory_fp06
-- FP-06 Step 1: the memory retrieval RPC (`match_facts`), one HNSW index, one idempotent
-- b-tree check, and two config seeds.
--
-- No table, no column, no RLS change: 0006/0007 already carry everything FP-06 needs
-- (memory_facts with `fact_type` incl. 'chat', `source_message_id`, `purged_at`; own-rows RLS).
-- 0006 already seeded idx_memory_facts_source_message_id — the `if not exists` line below is
-- the idempotent safeguard the plan asks for, not a new object.
--
-- Hardening follows match_exemplars (0025): SECURITY DEFINER with a pinned `search_path`, and
-- the default PUBLIC EXECUTE grant explicitly revoked before authenticated/service_role are
-- granted. `match_rules` (0013) predates that convention — its drift stays recorded and out of
-- FP-06's scope.
--
-- The RPC returns two arms, ids deduped across them, so the code-side merge never sees a
-- duplicate row: the top-`p_top_k` unpurged facts by cosine distance (all fact types compete),
-- then every unpurged `fact_type='baseline'` row regardless of similarity (dormant until the
-- onboarding FP writes baseline rows — similarity 1.0, ordered after the top-k arm, `rn`
-- tie-broken by id so a drill can assert a deterministic order).
--
-- Refs: FP-06 FR-9, FR-13; TECH-SPEC §7.6, §3.1, §3.3, §11; D5, D6; AGENTS.md §2, §6.6.

create or replace function public.match_facts(
  p_user_id uuid,
  p_query_embedding vector(768),
  p_top_k int
)
returns table (id uuid, fact text, fact_type text, similarity double precision)
language sql
security definer
set search_path = public
as $$
  with top_k as (
    select m.id,
           m.fact,
           m.fact_type,
           1 - (m.embedding <=> p_query_embedding) as similarity
    from public.memory_facts m
    where m.user_id = p_user_id
      and m.purged_at is null
      and m.embedding is not null
    order by m.embedding <=> p_query_embedding, m.id
    limit greatest(p_top_k, 0)
  ),
  baseline as (
    select m.id,
           m.fact,
           m.fact_type,
           1.0::double precision as similarity
    from public.memory_facts m
    where m.user_id = p_user_id
      and m.purged_at is null
      and m.fact_type = 'baseline'
      and not exists (select 1 from top_k t where t.id = m.id)
  )
  select u.id, u.fact, u.fact_type, u.similarity
  from (
    select t.id, t.fact, t.fact_type, t.similarity,
           0 as arm,
           row_number() over (order by t.similarity desc, t.id) as rn
    from top_k t
    union all
    select b.id, b.fact, b.fact_type, b.similarity,
           1 as arm,
           row_number() over (order by b.id) as rn
    from baseline b
  ) u
  order by u.arm, u.rn;
$$;

revoke execute on function public.match_facts(uuid, vector(768), int) from public, anon;
grant execute on function public.match_facts(uuid, vector(768), int) to authenticated, service_role;

-- The deferred HNSW cosine index (§3.1: created when retrieval makes it load-bearing — this is
-- that moment). HNSW, not ivfflat: no training data, and the top-k query is exactly its shape.
create index if not exists idx_memory_facts_embedding
  on memory_facts using hnsw (embedding vector_cosine_ops);

-- Idempotent safeguard: 0006 already created this one; the plan calls it out so a project that
-- somehow missed it converges without a manual fix.
create index if not exists idx_memory_facts_source_message_id on memory_facts(source_message_id);

-- Two config seeds (proper jsonb, the 0014/0028 lesson: quoted literals for strings, bare for
-- numbers/booleans). Idempotent upsert.
insert into config (key, value, description) values
  ('memory_fact_top_k', '5', '§7.6 [SPEC]: top-k unpurged facts retrieved per turn by cosine similarity, plus every baseline fact (FP-06 FR-9, FR-13)'),
  ('memory_retrieval_enabled', 'true', '§7.6 [SPEC]: the classifier_mode-style kill switch for memory retrieval into generation; false restores the byte-identical FP-05 prompt with one config flip (FP-06 FR-10, FR-13)')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

-- Read access (0026/0027/0028 re-issue this; harmless to repeat).
grant select on config to anon, authenticated;

-- Verify (SQL editor):
--   select p.proname, p.prosecdef, p.proconfig from pg_proc p where p.proname = 'match_facts';
--     → prosecdef = true, proconfig = {search_path=public}
--   select * from public.match_facts('<user uuid>', (select embedding from memory_facts limit 1), 5);
--     → rows ordered top-k first, baseline after; purged rows never appear.
--   select indexname from pg_indexes where tablename = 'memory_facts';
--     → includes idx_memory_facts_embedding (hnsw) and idx_memory_facts_source_message_id.
--   Re-running this migration is clean (no error, no duplicate).
--   information_schema.columns diff before/after: zero rows.
