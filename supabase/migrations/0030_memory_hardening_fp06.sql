-- Migration 0030_memory_hardening_fp06
-- Live hardening for the three FP-06 gaps found after the first drill:
--
--   1. `match_facts(p_user_id, ...)` is SECURITY DEFINER and was granted to
--      `authenticated`. It read whatever `p_user_id` the caller supplied, so any
--      signed-in user could read another user's facts. The replacement scopes every
--      non-service caller to `auth.uid()`; `p_user_id` is honored only for
--      `service_role` (the Edge Functions) and direct SQL/admin connections, and the
--      0029 authenticated grant is revoked so retrieval has no client surface at all.
--   2. `flag-unsavable` marked the message and *then* inserted the purge job in a second
--      PostgREST call. If that insert failed (or the function died between the calls),
--      the message stayed flagged while its facts stayed live forever. A trigger now
--      purges the facts in the same transaction as the `unsavable` flip, so no queue
--      write (or dispatcher tick) is required for D6 to hold. The existing
--      `purge_memory` job remains the idempotent backup. The trigger also closes the
--      known direct-PATCH bypass, which never called `flag-unsavable` at all.
--   3. `memory_extract` only treated a message as extracted when a fact cited it. A
--      slice that correctly returned zero facts left every message unmarked, so each
--      later boundary re-sent the same old messages to the provider. A durable
--      `messages.memory_extracted_at` watermark is now written after each slice (facts
--      or empty), and the backlog query skips processed rows.
--
-- Defense in depth: a BEFORE INSERT/UPDATE guard on `memory_facts` marks any new fact
-- citing an already-unsavable message as purged, closing the extraction-vs-flag race.
--
-- Refs: FP-06 FR-2, FR-4, FR-9, FR-17; TECH-SPEC §3.2–3.3, §7.6, §11; D6; AGENTS.md §4.1.

-- ============================================================================
-- 1. match_facts: scope the definer function to the caller
-- ============================================================================

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
  with scoped as (
    select m.id,
           m.fact,
           m.fact_type,
           m.embedding
    from public.memory_facts m
    where m.user_id = case
        -- service_role is the Edge Function caller; a direct SQL/admin connection has no
        -- JWT role and is trusted. Every other caller is pinned to the JWT subject.
        when auth.role() = 'service_role' then p_user_id
        when auth.role() is null and session_user in ('postgres', 'supabase_admin') then p_user_id
        else auth.uid()
      end
      and m.purged_at is null
  ),
  top_k as (
    select m.id,
           m.fact,
           m.fact_type,
           1 - (m.embedding <=> p_query_embedding) as similarity
    from scoped m
    where m.embedding is not null
    order by m.embedding <=> p_query_embedding, m.id
    limit greatest(p_top_k, 0)
  ),
  baseline as (
    select m.id,
           m.fact,
           m.fact_type,
           1.0::double precision as similarity
    from scoped m
    where m.fact_type = 'baseline'
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

-- Keep the 0025/0029 public/anon revocations, and tighten the 0029 authenticated grant:
-- retrieval is server-side only (runPipeline uses the service-role client), so clients have
-- no reason to call this SECURITY DEFINER function. The body's `auth.uid()` scope remains as
-- defense in depth if a grant is ever restored.
revoke execute on function public.match_facts(uuid, vector(768), int) from public, anon, authenticated;
grant execute on function public.match_facts(uuid, vector(768), int) to service_role;

-- ============================================================================
-- 2. Durable extraction watermark (zero-fact slices included)
-- ============================================================================

alter table public.messages
  add column if not exists memory_extracted_at timestamptz;

comment on column public.messages.memory_extracted_at is
  'Set by memory_extract after a slice is durably processed; null = pending. Unsavable rows are excluded from the backlog separately.';

-- Backfill: fact-cited messages and unsavable messages are already decided. Mark them
-- processed so fact-cited history is not re-sent; historical zero-fact slices are re-sent
-- once, then the watermark takes over.
update public.messages m
set memory_extracted_at = coalesce(m.created_at, now())
where m.memory_extracted_at is null
  and (
    m.unsavable = true
    or exists (
      select 1 from public.memory_facts f
      where f.source_message_id = m.id
    )
  );

create index if not exists messages_memory_pending_idx
  on public.messages (user_id, created_at)
  where memory_extracted_at is null and unsavable = false;

-- ============================================================================
-- 3. Purge in the same transaction as the unsavable flip
-- ============================================================================

create or replace function public.purge_memory_on_unsavable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.memory_facts
  set purged_at = now()
  where source_message_id = new.id
    and purged_at is null
    and fact_type <> 'oath';
  return new;
end;
$$;

revoke execute on function public.purge_memory_on_unsavable() from public, anon, authenticated;
grant execute on function public.purge_memory_on_unsavable() to service_role;

drop trigger if exists messages_purge_memory_on_unsavable on public.messages;
create trigger messages_purge_memory_on_unsavable
  after update of unsavable on public.messages
  for each row
  when (old.unsavable is not true and new.unsavable is true)
  execute function public.purge_memory_on_unsavable();

-- ============================================================================
-- 4. Race guard: a fact can never be born live from an unsavable message
-- ============================================================================

create or replace function public.purge_memory_fact_if_source_unsavable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_unsavable boolean;
begin
  if new.fact_type <> 'oath' and new.source_message_id is not null then
    -- Lock the source row before reading the flag. A concurrent `unsavable` flip holds the
    -- same row's exclusive lock, so this insert either waits and sees true (and is born
    -- purged) or commits first and the flag trigger's UPDATE sees this fact and purges it.
    select m.unsavable into source_unsavable
    from public.messages m
    where m.id = new.source_message_id
    for share;

    if source_unsavable is true then
      new.purged_at := coalesce(new.purged_at, now());
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.purge_memory_fact_if_source_unsavable() from public, anon, authenticated;
grant execute on function public.purge_memory_fact_if_source_unsavable() to service_role;

drop trigger if exists memory_facts_purge_unsavable_source on public.memory_facts;
create trigger memory_facts_purge_unsavable_source
  before insert or update of source_message_id on public.memory_facts
  for each row
  execute function public.purge_memory_fact_if_source_unsavable();

-- Heal flags written before this migration whose queue write failed. This runs after the
-- fact-birth guard so a fact inserted while the migration was in flight is covered too.
update public.memory_facts mf
set purged_at = now()
where mf.purged_at is null
  and mf.fact_type <> 'oath'
  and mf.source_message_id is not null
  and exists (
    select 1 from public.messages m
    where m.id = mf.source_message_id
      and m.unsavable = true
  );

-- Verify (SQL editor):
--   -- authenticated direct calls are denied (EXECUTE revoked); a service_role call is the
--   -- only way to pass p_user_id, and that key never reaches a client
--   select count(*) from public.match_facts('<other user>', (select embedding from memory_facts limit 1), 5);
--   -- flagging purges immediately, before any dispatcher tick
--   update messages set unsavable = true where id = '<message>';
--   select count(*) from memory_facts where source_message_id = '<message>' and purged_at is null and fact_type <> 'oath';
--   -- extraction pending index
--   select indexname from pg_indexes where tablename = 'messages' and indexname = 'messages_memory_pending_idx';
--   Re-running this migration is clean (functions replace, triggers drop/create, backfills no-op).
