-- Migration 0036_armor_audit_fp10
-- FP-10 Step 1: the least-privilege end-state, the universal purge enqueuer, the
-- transactional degrade pair, one config seed, and two one-time closes.
--
-- Slot: `0034` and `0035` were claimed by FP-09's account lifecycle and opening copy,
-- so FP-10 takes `0036`. Zero columns, zero tables, zero indexes, zero RLS changes.
--
-- Refs: TECH-SPEC §3.1–3.4, §4.1, §5.1, §5.4, §7.6, §10, §11, §13; D3, D6, D12, D20,
--       D26; FP-10 FR-1, FR-2, FR-3, FR-4; AGENTS.md §3.2, §4.
--
-- ---------------------------------------------------------------------------
-- AS-READ GRANT MATRIX (Step 0, live project, 2026-10-28)
-- ---------------------------------------------------------------------------
-- Supabase's default privileges gave BOTH `anon` and `authenticated` the full
-- INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES set on every public table;
-- migrations 0001/0005 layered explicit grants on top. Effective protection was
-- RLS alone. Two consequences mattered:
--
--   * `config` has RLS DISABLED (the one table without a policy), so the default
--     DML grants made every kill switch — `dev_overrides_enabled`, `llm_stub_mode`,
--     `llm_force_fail` — writable by any client holding the public anon key.
--     This migration closes it (revoke DML; `select` for authenticated stays).
--   * `push_tokens` is the client's one legitimate direct-write table and
--     `lib/push.ts` also DELETEs on token deregistration, so delete stays.
--
-- `information_schema.column_privileges` showed no explicit column grants
-- (`pg_attribute.attacl` is null everywhere): every column row was an expansion of
-- the table-level grant. Revoking the table privilege therefore leaves a clean
-- slate for the column-level grants below.
--
-- `jobs`, `rules`, `exemplars` hold the default grants but have no write policy
-- (`jobs` has zero policies at all), so no authenticated DML is reachable through
-- PostgREST. Recorded as-found; left untouched.
--
-- Every client-callable RPC is SECURITY DEFINER (`update_checkin_prefs`,
-- `match_rules`, `match_exemplars`), so table-level revokes cannot break them.
--
-- ---------------------------------------------------------------------------
-- REVERSE DDL (R-1: the one-statement-per-line rollback)
-- ---------------------------------------------------------------------------
--   grant insert, update on public.messages to authenticated;
--   grant update on public.profiles to authenticated;
--   grant select on public.trust_events to authenticated, anon;
--   grant insert, update, delete on public.doings_logs, public.journal_entries,
--     public.memory_facts, public.metrics, public.metric_points,
--     public.anchor_plans, public.habits to authenticated, anon;
--   grant update on public.persona_stats to authenticated, anon;
--   grant insert, update, delete on public.config to authenticated, anon;
--   grant insert, update, delete on public.push_tokens to anon;
--   -- (0030's function body can be restored from 0030_memory_hardening_fp06.sql)
--   -- (write_degrade_pair may be dropped once Step 2's caller is reverted)

-- ============================================================================
-- (a) The least-privilege grant end-state
-- ============================================================================

-- profiles: identity only. Every other column is server-written (settings via the
-- `update_checkin_prefs` definer RPC, TZ via the sync, the interview via
-- `send-message`). `display_name` stays as the one benign client-writable column so
-- a future profile-edit screen needs no migration. INSERT is left as-found: the
-- profiles-creation path is the `on_auth_user_created` → `handle_new_user()` definer
-- trigger, so no client INSERT is load-bearing.
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

-- messages: the thread is server-authored. `send-message` (service role) is the only
-- writer. The one client-writable column is `unsavable`, and the 0030 trigger is
-- `after update of unsavable`, so the column grant still fires it.
revoke insert, update on public.messages from authenticated, anon;
grant update (unsavable) on public.messages to authenticated;

-- trust_events: §3.4 says server-only. The hidden score's audit trail stops being
-- client-reconstructable from deltas and reasons.
revoke select on public.trust_events from authenticated, anon;

-- Every write path for these seven is a sync fn, a job, or a trigger. The client's
-- SELECT surfaces stand (D6's future review screen is the reason they are kept).
revoke insert, update, delete on public.doings_logs from authenticated, anon;
revoke insert, update, delete on public.journal_entries from authenticated, anon;
revoke insert, update, delete on public.memory_facts from authenticated, anon;
revoke insert, update, delete on public.metrics from authenticated, anon;
revoke insert, update, delete on public.metric_points from authenticated, anon;
revoke insert, update, delete on public.anchor_plans from authenticated, anon;
revoke insert, update, delete on public.habits from authenticated, anon;

-- persona_stats: FP-02 left the 0007 own-row policy accepted-but-unused; the capped
-- self-service weighting surface closes here. SELECT stays.
revoke update on public.persona_stats from authenticated, anon;

-- config: `lib/config.ts` is the only client reader and it only SELECTs. With RLS
-- disabled on this table, the default DML grants were the widest hole in the schema.
revoke insert, update, delete on public.config from authenticated, anon;

-- push_tokens: the client's one legitimate direct write — the upsert needs insert +
-- update and deregistration needs delete. `anon` has no use for any of them.
revoke insert, update, delete on public.push_tokens from anon;

-- ============================================================================
-- (b) The universal purge enqueuer
-- ============================================================================
-- FP-06's 0030 trigger already purges the derived facts inside the `unsavable` flip's
-- transaction, which closed the direct-PATCH bypass for facts. What it did not do is
-- leave the `purge_memory` job behind, so the raw PATCH and `flag-unsavable` were not
-- behaviourally identical. Extending this one function (rather than adding a second
-- trigger + function) makes the job the trigger's product for every actor, with no
-- role detection to get wrong and no duplicated mechanism.
--
-- A concurrent double-flip can double-enqueue; §2.2 clause 4 tolerates it and the
-- handler is idempotent by design.
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

  insert into public.jobs (type, payload)
  values ('purge_memory', jsonb_build_object('message_id', new.id));

  return new;
end;
$$;

revoke execute on function public.purge_memory_on_unsavable() from public, anon, authenticated;
grant execute on function public.purge_memory_on_unsavable() to service_role;

-- The trigger itself is unchanged from 0030 (re-created only so a re-apply is
-- deterministic); the function body above is the whole change.
drop trigger if exists messages_purge_memory_on_unsavable on public.messages;
create trigger messages_purge_memory_on_unsavable
  after update of unsavable on public.messages
  for each row
  when (old.unsavable is not true and new.unsavable is true)
  execute function public.purge_memory_on_unsavable();

-- ============================================================================
-- (c) The transactional degrade pair (§4.1 / §5.1)
-- ============================================================================
-- The holding reply and its `llm_retry` job used to be two PostgREST calls: a killed
-- invocation between them left a holding reply with no retry behind it (§5.1's
-- residual). supabase-js has no transaction API, so the pair is one function call:
-- both rows land or neither does.
--
-- Race semantics are preserved from `insertPrimaryReply`: the partial unique index
-- `messages_one_primary_reply` rejects a second answer to the same user message, and
-- the function reports `race_lost` with the winner's id instead of failing. Any other
-- failure (including a duplicate job id) propagates, rolling the whole call back.
--
-- The caller keeps the fatal `sync_degrade_reply` config read and the payload
-- assembly; Step 2 wires `_shared/replies.ts` to this function.
create or replace function public.write_degrade_pair(
  p_user_id uuid,
  p_user_message_id uuid,
  p_job_id uuid,
  p_content text,
  p_metadata jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_winner_id uuid;
begin
  -- The reply is claimed first: the race guard must decide before a job exists.
  begin
    insert into public.messages (user_id, role, content, reply_to_message_id, metadata)
    values (p_user_id, 'assistant', p_content, p_user_message_id, p_metadata)
    returning id into v_message_id;
  exception
    when unique_violation then
      select m.id
        into v_winner_id
        from public.messages m
       where m.role = 'assistant'
         and m.reply_to_message_id = p_user_message_id
       limit 1;
      return jsonb_build_object('status', 'race_lost', 'winner_id', v_winner_id);
  end;

  insert into public.jobs (id, type, payload)
  values (p_job_id, 'llm_retry', p_payload);

  return jsonb_build_object(
    'status', 'ok',
    'assistant_message_id', v_message_id,
    'job_id', p_job_id
  );
end;
$$;

revoke execute on function public.write_degrade_pair(uuid, uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.write_degrade_pair(uuid, uuid, uuid, text, jsonb, jsonb)
  to service_role;

-- ============================================================================
-- (d) The oath capture window seed
-- ============================================================================
-- §5.4 / D26: a confirmed send captures only a request that is still fresh. Without
-- the bound, thread position alone would enshrine whatever the user next said — days
-- later and unrelated — as a purge-exempt oath. [SPEC], tunable without redeploy.
insert into public.config (key, value, description) values
  ('oath_request_capture_window_hours', '48'::jsonb,
   '§5.4/D26 [SPEC]: a confirmed oath capture only qualifies when the oath_request row is younger than this many hours')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

-- ============================================================================
-- (e) The one-time stale-oath close
-- ============================================================================
-- Pre-window requests that were never confirmed are retired with the same marker
-- `validateOathConfirmation` already reads (`consumed`), plus an `expired` reason so
-- the audit trail can tell a stale close from a real capture. The cooldown is
-- deliberately unchanged: `maybeRequestOath` counts request rows by `created_at`, so
-- a stale-closed request still occupies its trailing cooldown (conservative).
--
-- As-read count on 2026-10-28: 0 unconsumed requests. A re-run is a no-op because the
-- marker is the predicate.
do $$
declare
  v_hours numeric;
  v_closed int;
begin
  select (value #>> '{}')::numeric into v_hours
    from public.config
   where key = 'oath_request_capture_window_hours';

  if v_hours is null or v_hours <= 0 then
    raise warning 'oath_request_capture_window_hours missing or invalid; stale-oath close skipped';
    return;
  end if;

  update public.messages
     set metadata = metadata || jsonb_build_object(
           'consumed', true,
           'consumed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'consumed_reason', 'expired'
         )
   where metadata->>'source' = 'oath_request'
     and metadata->>'consumed' is null
     and created_at < now() - make_interval(hours => v_hours::int);

  get diagnostics v_closed = row_count;
  raise notice 'stale-oath close: % request row(s) marked expired', v_closed;
end;
$$;

-- ============================================================================
-- (f) The one-time degrade-orphan count (§5.1)
-- ============================================================================
-- A `sync_degrade` holding row whose `source_job_id` has no `jobs` row is the §5.1
-- residual window. The count is reported, never auto-repaired: the job payload is
-- unreconstructable (persona/route/domain were only ever in the job).
-- As-read count on 2026-10-28: 0. Step 2's atomic pair removes the window; the audit
-- doc records this number.
do $$
declare
  v_orphans int;
begin
  select count(*)
    into v_orphans
    from public.messages m
   where m.metadata->>'source' = 'sync_degrade'
     and m.reply_to_message_id is not null
     and not exists (
       select 1
         from public.jobs j
        where j.id::text = m.metadata->>'source_job_id'
     );

  raise notice 'sync_degrade orphan count: % (expected 0)', v_orphans;
end;
$$;
