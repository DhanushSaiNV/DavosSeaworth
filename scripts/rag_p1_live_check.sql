-- RAG redesign Phase 1 - PRODUCTION verification (migrations 0044-0046).
--
-- Read-only. It writes nothing to any permanent table: the only objects created are a pg_temp
-- table and pg_temp functions, which die with the session. Every probe runs as the role PostgREST
-- would use, via `set role` + `request.jwt.claims`, and asserts the resulting SQLSTATE or row set.
--
-- Run:
--   npx supabase db query --remote --yes -f scripts/rag_p1_live_check.sql
--
-- Read the final result set: every row must have ok = true.
--
-- What this file can and cannot prove on production: it cannot create fixtures, so the two-user
-- isolation, the purged-fact invisibility, the invalid-timezone profile and the 2001-window grid
-- are asserted by scripts/rag_p1_fixtures.sql on the local stack. Everything else - privilege
-- matrix, signature shape, SQLSTATEs, real-user projections - is asserted here against production.

create temporary table p1_results (seq serial, ok boolean, label text);

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

create or replace function pg_temp.expect(label text, role_name text, claims text, stmt text, want text)
returns void
language plpgsql
as $fn$
declare
  got text;
begin
  got := pg_temp.try_as(role_name, claims, stmt);
  insert into p1_results (ok, label) values (got = want, label);
  if got <> want then
    raise notice 'FAIL  %  (want %, got %)', label, want, got;
  end if;
end;
$fn$;

create or replace function pg_temp.expect_rows(label text, role_name text, claims text, stmt text)
returns void
language plpgsql
as $fn$
declare
  n bigint;
begin
  n := pg_temp.try_rows(role_name, claims, stmt);
  insert into p1_results (ok, label) values (n >= 1, label);
  if n < 1 then
    raise notice 'FAIL  %  (want >= 1 row, got %)', label, n;
  end if;
end;
$fn$;

create or replace function pg_temp.expect_ok(label text, role_name text, claims text, stmt text)
returns void
language plpgsql
as $fn$
declare
  got text;
begin
  got := pg_temp.try_as(role_name, claims, stmt);
  insert into p1_results (ok, label) values (got = '00000', label);
  if got <> '00000' then
    raise notice 'FAIL  %  (want 00000, got %)', label, got;
  end if;
end;
$fn$;

-- A real production identity, used only to prove that a genuine authenticated caller reads its own
-- rows. No value from that user is printed by this file.
create temporary table p1_ctx as
select (select p.id from public.profiles p order by p.created_at nulls last, p.id limit 1) as uid,
       (select count(*)
          from public.memory_facts m
         where m.user_id = (select p.id from public.profiles p order by p.created_at nulls last, p.id limit 1)
           and m.purged_at is null) as visible_facts,
       (select count(*) from public.memory_facts m where m.purged_at is null) as total_visible_facts,
       (select r.embedding::text from public.rules r
         where r.embedding is not null order by r.id limit 1) as rule_vec,
       (select m.id from public.metrics m
         where m.user_id = (select p.id from public.profiles p
                             order by p.created_at nulls last, p.id limit 1)
         order by m.created_at nulls last, m.id limit 1) as metric_id;

-- ============================================================ T5: hardening + grants (0044)

select pg_temp.expect_rows(
  'T5 0044 functions: pinned search_path, no PUBLIC execute, correct security mode',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('current_user_timezone','read_schedule_profile',
                            'list_answered_windows','search_facts','list_memory_facts',
                            'count_memory_facts','summarize_memory_facts')
          and (proconfig is null
               or proconfig::text not like '%search_path=%'
               or exists (select 1 from unnest(coalesce(proacl, '{}')) a
                           where a::text like '=X/%')
               or (p.proname = 'current_user_timezone' and prosecdef)
               or (p.proname <> 'current_user_timezone' and not prosecdef)))$q$
);

select pg_temp.expect_rows(
  'T5 current_user_timezone has no EXECUTE grant to any role',
  'postgres', null,
  $q$select 1 where not has_function_privilege('authenticated', 'public.current_user_timezone()', 'EXECUTE')
                and not has_function_privilege('anon', 'public.current_user_timezone()', 'EXECUTE')
                and not has_function_privilege('service_role', 'public.current_user_timezone()', 'EXECUTE')$q$
);

select pg_temp.expect_rows(
  'T5 four memory functions: authenticated only, service_role excluded',
  'postgres', null,
  $q$select 1
       where has_function_privilege('authenticated', 'public.search_facts(vector, double precision, text[], date, date, integer)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.list_memory_facts(text[], date, date, boolean, integer)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.count_memory_facts(text[], date, date, boolean)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.summarize_memory_facts(text[], date, date, boolean, text[])', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.search_facts(vector, double precision, text[], date, date, integer)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.list_memory_facts(text[], date, date, boolean, integer)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.count_memory_facts(text[], date, date, boolean)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.summarize_memory_facts(text[], date, date, boolean, text[])', 'EXECUTE')$q$
);

select pg_temp.expect_rows(
  'T3/D1 no memory or rule function result mentions embedding',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('search_facts','list_memory_facts','count_memory_facts',
                            'summarize_memory_facts','match_rules_v2')
          and (pg_get_function_result(p.oid) ~* 'embedding'))$q$
);

select pg_temp.expect_rows(
  'T6 no retrieval function takes a timezone argument',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('current_user_timezone','read_schedule_profile',
                            'list_answered_windows','search_facts','list_memory_facts',
                            'count_memory_facts','summarize_memory_facts')
          and (p.proargnames[1:p.pronargs] && array['p_tz','timezone','tz']::text[]))$q$
);

-- ============================================================ T3: privilege boundary

select pg_temp.expect('T3 anon denied: search_facts', 'anon', null,
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5)$q$, '42501');
select pg_temp.expect('T3 anon denied: list_memory_facts', 'anon', null,
  'select * from public.list_memory_facts()', '42501');
select pg_temp.expect('T3 anon denied: count_memory_facts', 'anon', null,
  'select public.count_memory_facts()', '42501');
select pg_temp.expect('T3 anon denied: summarize_memory_facts', 'anon', null,
  'select * from public.summarize_memory_facts()', '42501');
select pg_temp.expect('T3 anon denied: read_schedule_profile', 'anon', null,
  'select * from public.read_schedule_profile()', '42501');
select pg_temp.expect('T3 anon denied: list_answered_windows', 'anon', null,
  'select * from public.list_answered_windows(current_date - 10, current_date - 1)', '42501');

select pg_temp.expect('T3 service_role denied: search_facts', 'service_role', null,
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5)$q$, '42501');
select pg_temp.expect('T3 service_role denied: list_memory_facts', 'service_role', null,
  'select * from public.list_memory_facts()', '42501');
select pg_temp.expect('T3 service_role denied: count_memory_facts', 'service_role', null,
  'select public.count_memory_facts()', '42501');
select pg_temp.expect('T3 service_role denied: summarize_memory_facts', 'service_role', null,
  'select * from public.summarize_memory_facts()', '42501');

-- An authenticated JWT with no profile is still a valid identity: the memory functions need no
-- timezone, so they must return zero rows rather than an error. They must never fall back to
-- "everyone".
select pg_temp.expect_rows(
  'T3 authenticated without a profile: list_memory_facts returns 0 rows',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  'select 1 where (select count(*) from public.list_memory_facts()) = 0'
);
select pg_temp.expect_rows(
  'T3 authenticated without a profile: count_memory_facts returns 0',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  'select 1 where public.count_memory_facts() = 0'
);
select pg_temp.expect_rows(
  'T3 authenticated without a profile: summarize_memory_facts returns 0 rows',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  'select 1 where (select count(*) from public.summarize_memory_facts()) = 0'
);
select pg_temp.expect_rows(
  'T3 authenticated without a profile: search_facts returns 0 rows',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select 1 where (select count(*) from public.search_facts(
       ('[1' || repeat(',0',767) || ']')::vector, 0.5)) = 0$q$
);

-- ============================================================ T3: a real caller reads own rows

select pg_temp.expect_rows(
  'T3 real authenticated user: list_memory_facts returns exactly its own visible facts',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select 1 where (select count(*) from public.list_memory_facts(null, null, null, null, 50))
                        = %s$q$, (select visible_facts from p1_ctx))
);

select pg_temp.expect_rows(
  'T3 real authenticated user: count_memory_facts agrees with list',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select 1 where public.count_memory_facts() = %s$q$, (select visible_facts from p1_ctx))
);

select pg_temp.expect_rows(
  'T3 the corpus is larger than one user, so the equality above is a real filter',
  'postgres', null,
  format($q$select 1 where %s > %s$q$,
         (select total_visible_facts from p1_ctx), (select visible_facts from p1_ctx))
);

select pg_temp.expect_rows(
  'T3 real authenticated user: summarize totals equal the visible count',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select 1 where coalesce((select sum(n) from public.summarize_memory_facts()), 0) = %s$q$,
         (select visible_facts from p1_ctx))
);

-- ============================================================ T2: match_rules_v2

select pg_temp.expect_rows(
  'T2 authenticated gets rule rows with text/domain/tone and similarity 1.0',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select 1 from public.match_rules_v2(%L::vector, 0.99, null, 5) r
            where r.text <> '' and r.domain <> '' and r.tone <> ''
              and round(r.similarity::numeric, 6) = 1.000000$q$,
         (select rule_vec from p1_ctx))
);

select pg_temp.expect_rows(
  'T2 service_role can call match_rules_v2 when carrying the user JWT claims',
  'service_role',
  (select json_build_object('sub', uid, 'role', 'service_role')::text from p1_ctx),
  format($q$select 1 from public.match_rules_v2(%L::vector, 0.99, null, 5)$q$,
         (select rule_vec from p1_ctx))
);

select pg_temp.expect('T2 anon denied: match_rules_v2', 'anon', null,
  format($q$select * from public.match_rules_v2(%L::vector, 0.5, null, 5)$q$,
         (select rule_vec from p1_ctx)),
  '42501');

select pg_temp.expect(
  'T2 the result type has no embedding column (runtime proof)',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select embedding from public.match_rules_v2(%L::vector, 0.5, null, 5)$q$,
         (select rule_vec from p1_ctx)),
  '42703'
);

select pg_temp.expect(
  'T2 p_min_similarity has no default',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select * from public.match_rules_v2(p_query_embedding => %L::vector)$q$,
         (select rule_vec from p1_ctx)),
  '42883'
);

select pg_temp.expect('T2 p_limit 0 rejected',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select * from public.match_rules_v2(%L::vector, 0.5, null, 0)$q$,
         (select rule_vec from p1_ctx)),
  '22023');
select pg_temp.expect('T2 p_limit 21 rejected',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select * from public.match_rules_v2(%L::vector, 0.5, null, 21)$q$,
         (select rule_vec from p1_ctx)),
  '22023');

select pg_temp.expect_rows(
  'T2 hints do not filter: an unknown hint value still returns the same rows',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select 1 where (select count(*) from public.match_rules_v2(
            %L::vector, 0.99, array['Not/A Domain']::text[], 5))
          = (select count(*) from public.match_rules_v2(%L::vector, 0.99, null, 5))$q$,
         (select rule_vec from p1_ctx), (select rule_vec from p1_ctx))
);

-- ============================================================ T8 / D5: argument validation

select pg_temp.expect(
  'T8 p_min_similarity has no default (omitting it is a signature error)',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.search_facts(p_query_embedding => ('[1' || repeat(',0',767) || ']')::vector)$q$,
  '42883'
);
select pg_temp.expect('T8 p_min_similarity 0 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0)$q$, '22023');
select pg_temp.expect('T8 p_min_similarity -1 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, -1)$q$, '22023');
select pg_temp.expect('T8 p_min_similarity 1.5 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 1.5)$q$, '22023');
select pg_temp.expect('D5 3-dim query embedding rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.search_facts('[1,2,3]'::vector, 0.5)$q$, '22023');
select pg_temp.expect('D5 match_rules_v2 3-dim query embedding rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.match_rules_v2('[1,2,3]'::vector, 0.5, null, 5)$q$, '22023');
select pg_temp.expect('T8 match_rules_v2 p_min_similarity 0 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0, null, 5)$q$,
  '22023');
select pg_temp.expect('T8 match_rules_v2 p_min_similarity 1.5 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 1.5, null, 5)$q$,
  '22023');
select pg_temp.expect('search_facts p_limit 6 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, null, null, 6)$q$,
  '22023');
select pg_temp.expect('list_memory_facts p_limit 51 rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  'select * from public.list_memory_facts(null, null, null, null, 51)', '22023');
select pg_temp.expect('D4 invalid fact_type rejected',
  'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}',
  $$select * from public.list_memory_facts(array['nope']::text[], null, null, null, 50)$$, '22023');

select pg_temp.expect_rows(
  'G2 not started: both semantic thresholds are still JSON null and the planner is off',
  'postgres', null,
  $q$select 1 from public.config
      where key in ('rag_rules_min_similarity','rag_memory_min_similarity','rag_planner_enabled')
      having count(*) filter (where key in ('rag_rules_min_similarity','rag_memory_min_similarity')
                              and jsonb_typeof(value) = 'null') = 2
         and bool_and(key <> 'rag_planner_enabled' or value = 'false'::jsonb)$q$
);

-- ============================================================ schedule / grid on production

select pg_temp.expect_rows(
  'schedule_profile: a real caller gets one allowlisted row with a usable grid',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select 1 from public.read_schedule_profile() s
       where s.day_basis = 'profile_local_day'
         and s.checkin_cadence_minutes in (60, 120)
         and length(s.timezone) > 0$q$
);

select pg_temp.expect_ok(
  'list_answered_windows: a real caller can read the last week without error',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.list_answered_windows(current_date - 7, current_date - 1)'
);

select pg_temp.expect('list_answered_windows future p_to rejected',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.list_answered_windows(current_date - 7, current_date + 2)', '22023');

-- ============================================================ 0046: privilege matrix
--
-- Aggregated: ten functions x three role facts is thirty statements, and only the conjunction
-- matters. Each probe is a top-level pg_temp.try_as call (never nested inside try_rows - an
-- authenticated role cannot `set role`).

insert into p1_results (ok, label)
select (
     pg_temp.try_as('authenticated', null, $s$select * from public.query_checkins('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_impulse_events('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_anchor_plans('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_habits('list')$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_metrics_catalog('list')$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_metric_series('list')$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_quests('list')$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_daily_vars('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_conversation('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_journal_entries('count', current_date - 5, current_date - 1)$s$) = '42501'
), 'T3 all ten query_* reject a null auth.uid() with 42501';

insert into p1_results (ok, label)
select (
     pg_temp.try_as('anon', null, $s$select * from public.query_checkins('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_impulse_events('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_anchor_plans('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_habits('list')$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_metrics_catalog('list')$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_metric_series('list')$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_quests('list')$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_daily_vars('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_conversation('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_journal_entries('count', current_date - 5, current_date - 1)$s$) = '42501'
), 'T3 all ten query_* deny anon with 42501';

insert into p1_results (ok, label)
select (
     pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_checkins('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_impulse_events('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_anchor_plans('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_habits('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_metrics_catalog('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_metric_series('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_quests('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_daily_vars('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_conversation('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"service_role"}', $s$select * from public.query_journal_entries('count', current_date - 5, current_date - 1)$s$) = '42501'
), 'T3 all ten query_* deny service_role with 42501';

select pg_temp.expect_rows(
  'T5 exactly ten query_* functions, DEFINER, pinned search_path, authenticated-only EXECUTE',
  'postgres', null,
  $q$select 1 where (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'query\_%') = 10
                and not exists (
                  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like 'query\_%'
                     and (not p.prosecdef
                          or p.proconfig is null
                          or p.proconfig::text not like '%search_path=%'
                          or exists (select 1 from unnest(coalesce(p.proacl, '{}')) a
                                      where a::text like '=X/%')
                          or (p.proargnames[1:p.pronargs] && array['p_tz','timezone','tz']::text[])
                          or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          or has_function_privilege('anon', p.oid, 'EXECUTE')
                          or has_function_privilege('service_role', p.oid, 'EXECUTE')))$q$
);

select pg_temp.expect_rows(
  'T3/D1 no query_* result exposes embedding, unsavable, tactical_analysis, trust_score or user_id',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'query\_%'
          and pg_get_function_result(p.oid) ~* '(embedding|unsavable|tactical_analysis|trust_score|user_id)')$q$
);

select pg_temp.expect_rows(
  'T3 content is projected by query_checkins only (conversation and journal are metadata-only)',
  'postgres', null,
  $q$select 1 where (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'query\_%'
                        and pg_get_function_result(p.oid) ~* '\mcontent\M') = 1$q$
);

select pg_temp.expect('conversation has no content column', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select content from public.query_conversation(''list'', current_date - 5, current_date - 1)', '42703');
select pg_temp.expect('journal has no content column', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select content from public.query_journal_entries(''list'', current_date - 5, current_date - 1)', '42703');
select pg_temp.expect('impulse_events has no content column', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select content from public.query_impulse_events(''list'', current_date - 5, current_date - 1)', '42703');

-- ============================================================ 0046: real-user reads
--
-- One read per dataset. This is what proves each PL/pgSQL body compiles and runs against the live
-- schema and the real column grants; the local harness proves the values.

select pg_temp.expect_ok('query_checkins runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_checkins(''list'', current_date - 7, current_date - 1)');
select pg_temp.expect_ok('query_impulse_events runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_impulse_events(''count'', current_date - 7, current_date - 1)');
select pg_temp.expect_ok('query_anchor_plans runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_anchor_plans(''aggregate'', current_date - 30, current_date - 1)');
select pg_temp.expect_ok('query_habits runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_habits(''list'')');
select pg_temp.expect_ok('query_metrics_catalog runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_metrics_catalog(''aggregate'', null, null, null, null, ''include'')');
select pg_temp.expect_ok('query_metric_series runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format('select * from public.query_metric_series(''aggregate'', array[%L]::uuid[])',
         (select metric_id from p1_ctx)));
select pg_temp.expect_ok('query_quests runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_quests(''list'')');
select pg_temp.expect_ok('query_daily_vars runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_daily_vars(''list'', current_date - 7, current_date - 1)');
select pg_temp.expect_ok('query_conversation runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_conversation(''count'', current_date - 7, current_date - 1)');
select pg_temp.expect_ok('query_journal_entries runs for a real caller', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  'select * from public.query_journal_entries(''count'', current_date - 7, current_date - 1)');

-- The one dataset whose ownership is enforced by a join rather than a WHERE clause. There is no
-- "read everything" mode (the selector is required), so the probe is a direct cross-user read:
-- ask for a metric owned by someone else and require zero rows. The first assertion exists only so
-- the second cannot pass vacuously.
select pg_temp.expect_rows(
  'query_metric_series isolation probe is not vacuous: a foreign metric exists',
  'postgres', null,
  $q$select 1 where exists (select 1 from public.metrics m
                             where m.user_id <> (select uid from p1_ctx))$q$
);

select pg_temp.expect_rows(
  'query_metric_series cannot read another user''s metric points',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  format($q$select 1 where (select count(*) from public.query_metric_series('list',
       array[%L]::uuid[])) = 0$q$,
         (select m.id from public.metrics m
           where m.user_id <> (select uid from p1_ctx) order by m.id limit 1))
);

-- ============================================================ 0046: argument validation

select pg_temp.expect('query_checkins unsupported op rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_checkins('delete', current_date - 5, current_date - 1)$q$, '22023');
select pg_temp.expect('query_checkins future p_to rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_checkins('count', current_date - 5, current_date + 2)$q$, '22023');
select pg_temp.expect('query_checkins invalid source rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 1, array['sms']::text[])$q$, '22023');
select pg_temp.expect('query_checkins energy 11 rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 1, null, 11)$q$, '22023');
select pg_temp.expect('query_habits invalid status rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_habits('list', array['archived']::text[])$q$, '22023');
select pg_temp.expect('query_metrics_catalog invalid archived_mode rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_metrics_catalog('list', null, null, null, null, 'everything')$q$, '22023');
select pg_temp.expect('query_metric_series requires a selector', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_metric_series('list')$q$, '22023');
select pg_temp.expect('query_quests invalid quest_status rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_quests('list', array['cancelled']::text[])$q$, '22023');
select pg_temp.expect('query_journal_entries invalid severity rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_journal_entries('count', current_date - 5, current_date - 1, array['S4']::text[])$q$, '22023');
select pg_temp.expect('query_conversation invalid role rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_conversation('count', current_date - 5, current_date - 1, array['system']::text[])$q$, '22023');
select pg_temp.expect('query_impulse_events span > 366 rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_impulse_events('count', current_date - 400, current_date - 1)$q$, '22023');
select pg_temp.expect('query_daily_vars invalid bucket rejected', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select * from public.query_daily_vars('timeseries', current_date - 5, current_date - 1, null, 'month')$q$, '22023');

-- D4: metrics.domain and messages.metadata->>'source' have no CHECK, so an unknown value is an
-- opaque filter - zero rows, never an error.
select pg_temp.expect_ok('D4 query_metrics_catalog unknown domain is inert', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select 1 where (select count(*) from public.query_metrics_catalog('list', array['Nope/Nope']::text[])) = 0$q$);
select pg_temp.expect_ok('D4 query_conversation unknown source is inert', 'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select 1 where (select count(*) from public.query_conversation('count',
       current_date - 5, current_date - 1, null, array['not-a-real-source']::text[])) = 0$q$);

-- D2: the content cap is a clamp, not a rejection, because the default p_limit is 200.
select pg_temp.expect_ok('D2 query_checkins list accepts p_limit 200 (clamps to 20)',
  'authenticated',
  (select json_build_object('sub', uid, 'role', 'authenticated')::text from p1_ctx),
  $q$select 1 where (select count(*) from public.query_checkins('list',
       current_date - 7, current_date - 1, null, null, null, null, null, null, 200)) <= 20$q$);

-- ============================================================ report

select seq, ok, label from p1_results order by seq;
