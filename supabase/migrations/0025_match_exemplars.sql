-- Migration 0025_match_exemplars
-- FP-03 Step 3: the classifier's similarity lookup (TECH-SPEC §6.2; FP-03 FR-6, NFR-5).
--
-- One row per (set_kind, label) holding the MAXIMUM cosine similarity between the query
-- vector and every seeded exemplar carrying that label — 24 rows at full seed (16 domains
-- + 6 emotions + 2 quit labels). The classifier argmaxes per set from these rows, so the
-- function aggregates over ALL exemplars and carries NO LIMIT.
--
-- Hardening follows claim_jobs (0008) and increment_auto_adopt_successes (0023), NOT
-- match_rules (0013): SECURITY DEFINER with a pinned `search_path`, and the default PUBLIC
-- EXECUTE grant explicitly revoked before the authenticated/service_role grants are added.
-- (match_rules never revoked it and has no pinned `search_path` — known drift, recorded and
-- out of FP-03 scope; deliberately untouched here.)
--
-- No vector index is created on purpose: 228 rows scan faster than an ANN index probes, and
-- an approximate index could drop the true nearest label. No `source` filter either: the
-- Step 7 BG-04 drill clears the placeholder set before seeding the approved one, so exactly
-- one source is present at a time. `exemplars` writes stay service-role only (NFR-5).
--
-- Refs: FP-03 FR-6, NFR-5; TECH-SPEC §6.2; scoring definition §6.3; D19; AGENTS.md §4.1, §6.6.

create or replace function public.match_exemplars(query_embedding vector(768))
returns table (set_kind text, label text, sim double precision)
language sql
security definer
set search_path = public
as $$
  select e.set_kind,
         e.label,
         max(1 - (e.embedding <=> query_embedding)) as sim
  from public.exemplars e
  group by e.set_kind, e.label
  order by e.set_kind, max(1 - (e.embedding <=> query_embedding)) desc;
$$;

revoke execute on function public.match_exemplars(vector(768)) from public, anon;
grant execute on function public.match_exemplars(vector(768)) to authenticated, service_role;

-- Verify:
-- select p.proname, p.prosecdef, p.proconfig from pg_proc p
--   where p.proname = 'match_exemplars';
-- select * from public.match_exemplars((select embedding from public.exemplars limit 1));
