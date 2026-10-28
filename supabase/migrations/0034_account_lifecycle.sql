-- Migration 0034_account_lifecycle
-- Decision 27 (owner, 2026-10-28) / TECH-SPEC §7.13 — self-service data reset and account
-- deletion.
--
-- Why two SECURITY DEFINER functions instead of a table-by-table delete loop in the Edge
-- Function: a reset must be one transaction (a half-deleted user is unrecoverable), and the
-- per-user advisory lock below is the same key 0032's `accept_quest` takes, so an in-flight
-- strike write cannot resurrect rows in the middle of a purge.
--
-- Both functions are service-role only. The `delete-account` Edge Function is the only caller,
-- and it derives the id from the caller's JWT — never from the request body (AGENTS.md §4.1).
--
-- Deletion order matters: `memory_facts.source_message_id` references `messages(id)` with
-- NO ACTION (0006), so facts must go before their source messages. Every other user table
-- cascades from `auth.users`, but the reset path keeps the auth user alive, which is why the
-- deletes are explicit here.

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
  -- orphan job would keep firing against a deleted account. The LIKE arm catches payloads that
  -- nest the id; UUIDs cannot collide as substrings of other UUIDs in practice.
  delete from public.jobs
   where payload ->> 'user_id' = p_user_id::text
      or payload::text like '%' || p_user_id::text || '%';
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

-- Reset = purge + a fresh profile row. The 0033 `on_profile_created` trigger writes the live
-- onboarding opening message inside this same transaction, so the interview restarts cleanly.
create or replace function public.reset_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
  v_created integer := 0;
begin
  v_counts := public.purge_user_data(p_user_id);

  insert into public.profiles (id) values (p_user_id)
  on conflict (id) do nothing;
  get diagnostics v_created = row_count;

  return v_counts || jsonb_build_object('profile_created', v_created > 0);
end;
$$;

revoke execute on function public.reset_user_data(uuid) from public, anon, authenticated;
grant execute on function public.reset_user_data(uuid) to service_role;

-- Kill switch for the destructive surface (Decision 27). Read at runtime by `delete-account`;
-- a missing key is a 500 there, never a silent default.
insert into public.config (key, value, description) values
  ('account_lifecycle_enabled',
   'true'::jsonb,
   'Decision 27 / §7.13: delete-account kill switch — reset and deletion both answer 403 when false')
on conflict (key) do nothing;
