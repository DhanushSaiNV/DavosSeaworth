-- Migration 0038_wipe_coverage
-- Decision 27 / TECH-SPEC §7.13 — make Settings -> "Wipe data" exhaustive.
--
-- 0034's `purge_user_data` deleted jobs by `payload->>'user_id'` (plus a substring arm).
-- The journal chain and the memory purge name an entry or a message instead of the user:
--
--   journal_extract / journal_probe / anchor_plan  ->  { "entry_id":   <uuid> }
--   purge_memory                                   ->  { "message_id": <uuid> }
--
-- Those rows therefore survived a wipe. On reset the orphans then fired against a deleted
-- entry and dead-lettered; on delete they outlived the account. The arms below run before
-- `journal_entries` / `messages` are deleted, so the EXISTS lookups still see the user's
-- rows. Comparing `id::text` keeps a malformed payload from raising on a `::uuid` cast.
--
-- No table, column, index or RLS change. `reset_user_data` calls this function unchanged.

create or replace function public.purge_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Serializes against the FP-08 strike path (0032) and any other per-user writer that takes
  -- this key. Reset and delete both land here, so the lock is taken exactly once per call.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- `jobs` has no user_id column and no FK (0008): job payloads name the user instead, so an
  -- orphan job would keep firing against a deleted account. Three arms:
  --   1. the direct user id;
  --   2. any payload that nests the id (UUIDs cannot collide as substrings in practice);
  --   3. the indirect journal/message payloads, resolved through their owning row.
  -- This delete runs first so arms 3 still see the user's entries and messages.
  delete from public.jobs as j
   where j.payload ->> 'user_id' = p_user_id::text
      or j.payload::text like '%' || p_user_id::text || '%'
      or (j.payload ? 'entry_id' and exists (
            select 1 from public.journal_entries e
             where e.user_id = p_user_id
               and e.id::text = j.payload ->> 'entry_id'))
      or (j.payload ? 'message_id' and exists (
            select 1 from public.messages m
             where m.user_id = p_user_id
               and m.id::text = j.payload ->> 'message_id'));
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('jobs', v_n);

  -- Facts before their source messages (NO ACTION FK in 0006).
  delete from public.memory_facts where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('memory_facts', v_n);

  delete from public.messages where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_n);

  delete from public.doings_logs where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('doings_logs', v_n);

  delete from public.journal_entries where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('journal_entries', v_n);

  -- metric_points cascades on metric_id.
  delete from public.metrics where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('metrics', v_n);

  delete from public.anchor_plans where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('anchor_plans', v_n);

  delete from public.habits where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('habits', v_n);

  delete from public.persona_stats where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('persona_stats', v_n);

  delete from public.trust_events where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('trust_events', v_n);

  delete from public.push_tokens where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('push_tokens', v_n);

  -- Last: the profile row itself (its id is the auth user id).
  delete from public.profiles where id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('profiles', v_n);

  return v_counts;
end;
$$;

revoke execute on function public.purge_user_data(uuid) from public, anon, authenticated;
grant execute on function public.purge_user_data(uuid) to service_role;
