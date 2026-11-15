-- RAG redesign Phase 0 live verification (migrations 0039-0042).
--
-- Runs as `postgres` and simulates each JWT role with `set role` + `request.jwt.claims`, which is
-- what PostgREST does. Every assertion compares the resulting SQLSTATE, so a privilege is proven
-- present or absent rather than assumed.
--
-- Safety: this file performs no writes to any permanent table.
--   * every INSERT probe ends in `where false`, so even if the privilege is wrongly still present
--     the statement inserts nothing (privilege is checked at plan time, so the SQLSTATE is
--     unchanged);
--   * the push_tokens upsert probe targets a random user_id and can therefore only fail its FK;
--   * the UPDATE/DELETE probes match on random UUIDs, so they affect zero rows;
--   * the only objects written are a pg_temp table and pg_temp functions, which die with the
--     session.
--
-- No failures abort the run: every result is recorded and printed, so one red row cannot hide the
-- rest.
--
-- Run:
--   npx supabase db query --remote --yes -f scripts/rag_p0_live_check.sql
--
-- Read the final result set: every row must have ok = true.

create temporary table p0_results (seq serial, ok boolean, label text);

create or replace function pg_temp.try_as(role_name text, claims text, stmt text)
returns text
language plpgsql
as $fn$
declare
  code text := '00000';
begin
  begin
    execute format('set role %I', role_name);
    if claims is not null then
      perform set_config('request.jwt.claims', claims, false);
    end if;
    execute stmt;
  exception
    when others then
      code := SQLSTATE;
  end;
  -- Always legal whatever the current role is: RESET ROLE returns to the session user.
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
  return code;
end;
$fn$;

create or replace function pg_temp.try_rows(role_name text, claims text, stmt text)
returns bigint
language plpgsql
as $fn$
declare
  n bigint := -1;
begin
  begin
    execute format('set role %I', role_name);
    if claims is not null then
      perform set_config('request.jwt.claims', claims, false);
    end if;
    execute format('select count(*) from (%s) s', stmt) into n;
  exception
    when others then
      n := -1;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
  return n;
end;
$fn$;

-- Assert a specific SQLSTATE.
create or replace function pg_temp.expect(label text, role_name text, claims text, stmt text, want text)
returns void
language plpgsql
as $fn$
declare
  got text;
begin
  got := pg_temp.try_as(role_name, claims, stmt);
  insert into p0_results (ok, label) values (got = want, label);
  if got <> want then
    raise notice 'FAIL  %  (want %, got %)', label, want, got;
  end if;
end;
$fn$;

-- Assert the statement runs AND returns at least one row. A SQLSTATE-only check would pass on an
-- empty result, which is exactly how a silently broken projection would look.
create or replace function pg_temp.expect_rows(label text, role_name text, claims text, stmt text)
returns void
language plpgsql
as $fn$
declare
  n bigint;
begin
  n := pg_temp.try_rows(role_name, claims, stmt);
  insert into p0_results (ok, label) values (n >= 1, label);
  if n < 1 then
    raise notice 'FAIL  %  (want >= 1 row, got %)', label, n;
  end if;
end;
$fn$;

-- Assert the statement runs (any row count).
create or replace function pg_temp.expect_ok(label text, role_name text, claims text, stmt text)
returns void
language plpgsql
as $fn$
declare
  got text;
begin
  got := pg_temp.try_as(role_name, claims, stmt);
  insert into p0_results (ok, label) values (got = '00000', label);
  if got <> '00000' then
    raise notice 'FAIL  %  (want 00000, got %)', label, got;
  end if;
end;
$fn$;

-- ============================================================ T5: function hardening

select pg_temp.expect_rows(
  'T5 match_rules: SECURITY DEFINER, pinned search_path, no PUBLIC execute',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc
        where proname = 'match_rules'
          and (not prosecdef
               or proconfig is null
               or proconfig::text not like '%search_path=%'
               or exists (select 1 from unnest(coalesce(proacl, '{}')) a
                           where a::text like '=X/%')))$q$
);

select pg_temp.expect_rows(
  'T5 match_exemplars: SECURITY DEFINER, pinned search_path, no PUBLIC execute',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc
        where proname = 'match_exemplars'
          and (not prosecdef
               or proconfig is null
               or proconfig::text not like '%search_path=%'
               or exists (select 1 from unnest(coalesce(proacl, '{}')) a
                           where a::text like '=X/%')))$q$
);

select pg_temp.expect_rows(
  'T5 match_rules is executable by service_role and not by authenticated',
  'postgres', null,
  $q$select 1 where has_function_privilege('service_role', 'public.match_rules(vector, text, integer)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.match_rules(vector, text, integer)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.match_rules(vector, text, integer)', 'EXECUTE')$q$
);

-- ============================================================ T1: old match_rules
-- Literal arguments, so a table-privilege failure can never be mistaken for a function-EXECUTE
-- failure: the only thing under test is EXECUTE on match_rules.

select pg_temp.expect(
  'T1 authenticated cannot execute old match_rules',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  $q$select count(*) from public.match_rules(
       array_fill(0.01::real, array[768])::vector, 'health', 5)$q$,
  '42501'
);

select pg_temp.expect(
  'T1 anon cannot execute old match_rules',
  'anon', null,
  $q$select count(*) from public.match_rules(
       array_fill(0.01::real, array[768])::vector, 'health', 5)$q$,
  '42501'
);

-- The legacy retrieveRules path: service_role still executes, and the rewritten body still finds
-- rules with search_path = '' (the 144-rule corpus is the fixture). The domain literal must match
-- the corpus exactly - `match_rules` filters `domain = match_domain`, case-sensitively, and the
-- seeded domains are capitalised ('Health', not 'health').
select pg_temp.expect_rows(
  'T1 service_role still executes old match_rules and gets rows (legacy path)',
  'service_role', null,
  $q$select 1 from public.match_rules(
       array_fill(0.01::real, array[768])::vector, 'Health', 5) r$q$
);

-- ============================================================ T4: forbidden tables

select pg_temp.expect('T4 authenticated denied: rules select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.rules limit 1', '42501');
select pg_temp.expect('T4 anon denied: rules select', 'anon', null, 'select 1 from public.rules limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: exemplars select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.exemplars limit 1', '42501');
select pg_temp.expect('T4 anon denied: exemplars select', 'anon', null, 'select 1 from public.exemplars limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: jobs select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.jobs limit 1', '42501');
select pg_temp.expect('T4 anon denied: jobs select', 'anon', null, 'select 1 from public.jobs limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: jobs insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.jobs (type, payload) select 'x', '{}'::jsonb where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: trust_events select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.trust_events limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: persona_stats select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.persona_stats limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: memory_facts select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.memory_facts limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: memory_facts insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.memory_facts (user_id, fact, fact_type) select gen_random_uuid(), 'x', 'chat' where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: habits select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.habits limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: journal_entries select', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select 1 from public.journal_entries limit 1', '42501');

-- ============================================================ T4: column grants (denials)

select pg_temp.expect('T4 authenticated denied: metrics.is_core', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select is_core from public.metrics limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: metrics.formula', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select formula from public.metrics limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: profiles.trust_score', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select trust_score from public.profiles limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: profiles.lockdown_started_at', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select lockdown_started_at from public.profiles limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: profiles.display_name', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select display_name from public.profiles limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: profiles.dialog_state', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select dialog_state from public.profiles limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: doings_logs.created_at', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select created_at from public.doings_logs limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: doings_logs.embedding', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select embedding from public.doings_logs limit 1', '42501');
select pg_temp.expect('T4 authenticated denied: config.description', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'select description from public.config limit 1', '42501');
select pg_temp.expect('T4 anon denied: config select', 'anon', null, 'select key, value from public.config limit 1', '42501');

-- ============================================================ T4: column grants (allowances)
-- These are the exact projections lib/ ships. A break here is a broken screen.

select pg_temp.expect_ok(
  'T4 authenticated allowed: exact metrics projection',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $q$select id, user_id, name, domain, output_unit, is_quest, quest_status,
            quest_deadline, formula_status, archived_at, created_at
       from public.metrics limit 1$q$
);

select pg_temp.expect_ok(
  'T4 authenticated allowed: exact profiles projection',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $q$select id, timezone, onboarding_stage, checkin_cadence_minutes,
            checkin_active_hours_start, checkin_active_hours_end
       from public.profiles limit 1$q$
);

select pg_temp.expect_ok(
  'T4 authenticated allowed: exact doings_logs projection',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $q$select id, user_id, kind, content, energy, source, logged_at, checkin_window
       from public.doings_logs limit 1$q$
);

select pg_temp.expect_ok(
  'T4 authenticated allowed: exact metric_points projection',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $q$select metric_id, value, computed_for from public.metric_points limit 1$q$
);

select pg_temp.expect_ok(
  'T4 authenticated allowed: exact anchor_plans projection',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $q$select user_id, plan_date, anchors from public.anchor_plans limit 1$q$
);

select pg_temp.expect_ok(
  'T4 authenticated allowed: exact messages projection (Realtime path)',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $q$select id, user_id, role, content, unsavable, client_message_id,
            reply_to_message_id, client_sent_at, created_at, metadata
       from public.messages limit 1$q$
);

select pg_temp.expect_ok(
  'T4 authenticated allowed: config (key, value)',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  'select key, value from public.config limit 1'
);

-- ============================================================ T4: write paths

select pg_temp.expect('T4 authenticated denied: messages insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.messages (user_id, role, content) select gen_random_uuid(), 'user', 'x' where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: messages delete', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'delete from public.messages where false', '42501');
select pg_temp.expect('T4 authenticated denied: messages.unsavable update', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', 'update public.messages set unsavable = true where false', '42501');
select pg_temp.expect('T4 authenticated denied: profiles.display_name update', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$update public.profiles set display_name = 'x' where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: doings_logs insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.doings_logs (user_id, kind, content, source, logged_at) select gen_random_uuid(), 'doing', 'x', 'app', now() where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: anchor_plans insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.anchor_plans (user_id, plan_date, anchors) select gen_random_uuid(), current_date, '[]'::jsonb where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: metrics insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.metrics (user_id, name, domain) select gen_random_uuid(), 'x', 'health' where false$$, '42501');
select pg_temp.expect('T4 authenticated denied: metric_points insert', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$insert into public.metric_points (metric_id, value, computed_for) select gen_random_uuid(), 1, current_date where false$$, '42501');

-- push_tokens: SELECT is required by the client's upsert (ON CONFLICT DO UPDATE needs the
-- table-level privilege), so it is granted and scoped by an own-rows policy. The probes use the
-- JWT subject as user_id so the row passes `auth.uid() = user_id`; otherwise an RLS violation
-- (also 42501) would masquerade as a missing privilege. The upsert then hits the FK on
-- auth.users, so 23503 is the success signal: INSERT privilege held, nothing inserted.
select pg_temp.expect_ok(
  'T4 authenticated allowed: push_tokens select (needed by ON CONFLICT DO UPDATE)',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  'select 1 from public.push_tokens limit 1'
);
select pg_temp.expect_rows(
  'T4 push_tokens: read is scoped to the owner by policy',
  'postgres', null,
  $q$select 1 from pg_policy
      where polrelid = 'public.push_tokens'::regclass
        and polname = 'push_tokens_select_own'
        and polcmd = 'r'
        and pg_get_expr(polqual, polrelid) like '%auth.uid()%'$q$
);
select pg_temp.expect('T4 anon denied: push_tokens select', 'anon', null, 'select 1 from public.push_tokens limit 1', '42501');
select pg_temp.expect(
  'T4 authenticated allowed: push_tokens upsert (FK 23503 = INSERT privilege held)',
  'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}',
  $$insert into public.push_tokens (user_id, token, platform)
    values ('00000000-0000-0000-0000-000000000001'::uuid, 'tok', 'ios')
    on conflict (user_id, token) do update set platform = excluded.platform$$,
  '23503'
);
select pg_temp.expect('T4 authenticated allowed: push_tokens update', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$update public.push_tokens set platform = 'ios' where user_id = '00000000-0000-0000-0000-000000000001'::uuid$$, '00000');
select pg_temp.expect('T4 authenticated allowed: push_tokens delete', 'authenticated', '{"sub":"00000000-0000-0000-0000-000000000001"}', $$delete from public.push_tokens where user_id = '00000000-0000-0000-0000-000000000001'::uuid$$, '00000');

-- ============================================================ anon on the user tables

select pg_temp.expect('T4 anon denied: doings_logs', 'anon', null, 'select 1 from public.doings_logs limit 1', '42501');
select pg_temp.expect('T4 anon denied: messages', 'anon', null, 'select 1 from public.messages limit 1', '42501');
select pg_temp.expect('T4 anon denied: profiles', 'anon', null, 'select 1 from public.profiles limit 1', '42501');
select pg_temp.expect('T4 anon denied: metrics', 'anon', null, 'select 1 from public.metrics limit 1', '42501');
select pg_temp.expect('T4 anon denied: metric_points', 'anon', null, 'select 1 from public.metric_points limit 1', '42501');
select pg_temp.expect('T4 anon denied: anchor_plans', 'anon', null, 'select 1 from public.anchor_plans limit 1', '42501');

-- ============================================================ 0042 keys

select pg_temp.expect_rows(
  '0042 seven rag_* keys seeded, both thresholds JSON null, planner off',
  'postgres', null,
  $q$select 1 from public.config
      where key like 'rag\_%'
     having count(*) = 7
        and count(*) filter (where key in ('rag_rules_min_similarity','rag_memory_min_similarity')
                              and jsonb_typeof(value) = 'null') = 2
        and bool_and(key <> 'rag_planner_enabled' or value = 'false'::jsonb)$q$
);

-- ============================================================ report

select seq, ok, label from p0_results order by seq;
