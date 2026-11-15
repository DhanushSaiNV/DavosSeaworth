-- RAG redesign Phase 1 - LOCAL FIXTURE HARNESS (migrations 0044-0046).
--
-- LOCAL ONLY. This file inserts users and rows. Never run it against production:
--   docker exec -i supabase_db_DavosSeaworth psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
--
-- It covers the assertions that need two users, a purged fact, an invalid timezone and a
-- 2001-window grid - i.e. everything the production script (scripts/rag_p1_live_check.sql)
-- cannot assert without writing data. Together the two files are T2, T3, T5-T8, T11.
--
-- Fixture identities:
--   A 1111...  Europe/London, 60 min, 08:00-22:00  - the populated user
--   B 2222...  America/New_York, 120 min          - the isolation user
--   C 3333...  Mars/Olympus (storable, invalid)   - the timezone failure user (T6)
--   D 4444...  Europe/London                      - the window-count user (T11)
--
-- Idempotent: every fixture user is deleted first (FKs cascade), then recreated.

-- ---------------------------------------------------------------------------- fixture data

delete from auth.users
 where id in ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333',
              '44444444-4444-4444-4444-444444444444');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'p1-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'p1-b@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'p1-c@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'p1-d@example.test');

-- profiles: `on_auth_user_created` already inserts one per auth user, so this is an upsert. The
-- profile AFTER INSERT trigger may also add an onboarding opening message; harmless, and useful
-- as a second conversation row.
insert into public.profiles
  (id, timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end,
   wake_time, sleep_time, onboarding_stage, dialog_state)
values
  ('11111111-1111-1111-1111-111111111111', 'Europe/London', 60, '08:00', '22:00',
   '07:00', '23:00', 'complete', 'OPEN'),
  ('22222222-2222-2222-2222-222222222222', 'America/New_York', 120, '09:00', '21:00',
   '07:30', '22:30', 'complete', 'OPEN'),
  ('33333333-3333-3333-3333-333333333333', 'Mars/Olympus', 60, '08:00', '22:00',
   '07:00', '23:00', 'baseline', 'OPEN'),
  ('44444444-4444-4444-4444-444444444444', 'Europe/London', 60, '08:00', '22:00',
   '07:00', '23:00', 'complete', 'OPEN')
on conflict (id) do update
  set timezone = excluded.timezone,
      checkin_cadence_minutes = excluded.checkin_cadence_minutes,
      checkin_active_hours_start = excluded.checkin_active_hours_start,
      checkin_active_hours_end = excluded.checkin_active_hours_end,
      wake_time = excluded.wake_time,
      sleep_time = excluded.sleep_time,
      onboarding_stage = excluded.onboarding_stage,
      dialog_state = excluded.dialog_state;

-- Rules: the corpus is global (not user-scoped). Three rules so the threshold filter, the
-- ordering and the hint tie-break are all observable. `rules.domain` has no CHECK, so the
-- capitalised values are fixture data, not an enum.
delete from public.rules where id in ('c0000000-0000-0000-0000-000000000001',
                                      'c0000000-0000-0000-0000-000000000002',
                                      'c0000000-0000-0000-0000-000000000003');

insert into public.rules (id, text, domain, source_figure, tone, priority, embedding)
values
  ('c0000000-0000-0000-0000-000000000001', 'Rule Health aligned', 'Health', 'fixture',
   'neutral', 50, ('[1' || repeat(',0', 767) || ']')::vector),
  ('c0000000-0000-0000-0000-000000000002', 'Rule Habits aligned', 'Discipline/Habits', 'fixture',
   'aggressive', 60, ('[1' || repeat(',0', 767) || ']')::vector),
  ('c0000000-0000-0000-0000-000000000003', 'Rule Health partial', 'Health', 'fixture',
   'empathetic', 40, ('[0.6,0.8' || repeat(',0', 766) || ']')::vector);

-- A: a deterministic conversation. The profile trigger may have inserted an opening message, so
-- the thread is cleared first - otherwise conversation counts depend on seeded config.
delete from public.messages
 where user_id in ('11111111-1111-1111-1111-111111111111',
                   '22222222-2222-2222-2222-222222222222',
                   '33333333-3333-3333-3333-333333333333',
                   '44444444-4444-4444-4444-444444444444');

insert into public.messages (id, user_id, role, content, metadata, unsavable, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'user', 'I keep skipping the gym when work runs late.',
   '{"source":"chat"}'::jsonb, false,
   ((now() at time zone 'Europe/London')::date - 5 + time '10:00') at time zone 'Europe/London'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'assistant', 'Then protect the block before work can eat it.',
   '{"source":"pipeline","route":"primary"}'::jsonb, false,
   ((now() at time zone 'Europe/London')::date - 4 + time '09:00') at time zone 'Europe/London'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'user', 'That is fair.',
   '{"source":"chat"}'::jsonb, false,
   ((now() at time zone 'Europe/London')::date - 4 + time '10:00') at time zone 'Europe/London'),
  -- unsavable: must be excluded from every conversation query (PRD line 581).
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'user', 'UNSAVABLE - must never be counted.',
   '{"source":"chat"}'::jsonb, true,
   ((now() at time zone 'Europe/London')::date - 4 + time '11:00') at time zone 'Europe/London');

insert into public.journal_entries (id, user_id, content, entry_date, vagueness_score, severity, probed, habit_flag, created_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Work ran late again and I skipped the gym.', (now() at time zone 'Europe/London')::date - 5,
   0.30, 'S2', true, false,
   ((now() at time zone 'Europe/London')::date - 5 + time '21:00') at time zone 'Europe/London'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Walked at lunch and felt clearer.', (now() at time zone 'Europe/London')::date - 4,
   0.10, 'S3', false, true,
   ((now() at time zone 'Europe/London')::date - 4 + time '21:00') at time zone 'Europe/London'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Everything is pointless and I am behind.', (now() at time zone 'Europe/London')::date - 3,
   0.50, 'S1', true, false,
   ((now() at time zone 'Europe/London')::date - 3 + time '21:00') at time zone 'Europe/London');

-- A: 3 visible facts + 1 purged. Query vector is e1 = [1,0,...]. fa1/fa3 are e1 (similarity 1.0);
-- fa2 is [0.6,0.8,0,...] (similarity 0.6). Three distinct similarities make both the threshold
-- filter and the ordering observable.
insert into public.memory_facts (id, user_id, fact, fact_type, embedding, source_message_id, created_at)
values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Skips the gym when work runs late', 'chat',
   ('[1' || repeat(',0', 767) || ']')::vector,
   'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/London')::date - 4),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Journaled about work and the gym', 'journal',
   ('[0.6,0.8' || repeat(',0', 766) || ']')::vector,
   null,
   (now() at time zone 'Europe/London')::date - 3),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Wants to train four times a week', 'baseline',
   ('[1' || repeat(',0', 767) || ']')::vector,
   null,
   (now() at time zone 'Europe/London')::date - 2),
  ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'PURGED - must never be visible', 'chat',
   ('[1' || repeat(',0', 767) || ']')::vector,
   null,
   (now() at time zone 'Europe/London')::date - 1);

update public.memory_facts
   set source_journal_id = 'bbbbbbbb-0000-0000-0000-000000000001'
 where id = 'f0000000-0000-0000-0000-000000000002';

update public.memory_facts
   set purged_at = now()
 where id = 'f0000000-0000-0000-0000-000000000004';

-- B: 2 facts. Same vectors, different owner - isolation is the assertion, not the ranking.
insert into public.memory_facts (id, user_id, fact, fact_type, embedding, created_at)
values
  ('f0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'B fact one', 'chat', ('[1' || repeat(',0', 767) || ']')::vector,
   (now() at time zone 'America/New_York')::date - 2),
  ('f0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222',
   'B fact two', 'oath', ('[0,1' || repeat(',0', 766) || ']')::vector,
   (now() at time zone 'America/New_York')::date - 1);

-- A: 3 answered windows on one local day, window start 08:00/09:00/10:00 London.
insert into public.doings_logs (user_id, kind, content, energy, source, logged_at, checkin_window)
values
  ('11111111-1111-1111-1111-111111111111', 'doing', 'Deep work block', 7, 'checkin_reply',
   ((now() at time zone 'Europe/London')::date - 5 + time '08:00') at time zone 'Europe/London' + interval '60 minutes',
   ((now() at time zone 'Europe/London')::date - 5 + time '08:00') at time zone 'Europe/London'),
  ('11111111-1111-1111-1111-111111111111', 'doing', 'Walked outside', 6, 'checkin_reply',
   ((now() at time zone 'Europe/London')::date - 5 + time '09:00') at time zone 'Europe/London' + interval '60 minutes',
   ((now() at time zone 'Europe/London')::date - 5 + time '09:00') at time zone 'Europe/London'),
  ('11111111-1111-1111-1111-111111111111', 'doing', 'Read a chapter', 8, 'app',
   ((now() at time zone 'Europe/London')::date - 5 + time '10:00') at time zone 'Europe/London' + interval '60 minutes',
   ((now() at time zone 'Europe/London')::date - 5 + time '10:00') at time zone 'Europe/London');

-- B: 2 answered windows on the same local day.
insert into public.doings_logs (user_id, kind, content, energy, source, logged_at, checkin_window)
values
  ('22222222-2222-2222-2222-222222222222', 'doing', 'B window one', 5, 'checkin_reply',
   ((now() at time zone 'America/New_York')::date - 5 + time '09:00') at time zone 'America/New_York' + interval '120 minutes',
   ((now() at time zone 'America/New_York')::date - 5 + time '09:00') at time zone 'America/New_York'),
  ('22222222-2222-2222-2222-222222222222', 'doing', 'B window two', 6, 'checkin_reply',
   ((now() at time zone 'America/New_York')::date - 5 + time '11:00') at time zone 'America/New_York' + interval '120 minutes',
   ((now() at time zone 'America/New_York')::date - 5 + time '11:00') at time zone 'America/New_York');

-- D: exactly 600 answered windows, 10 minutes apart, ending 100 days ago. T11 phase 1.
insert into public.doings_logs (user_id, kind, content, source, logged_at, checkin_window)
select '44444444-4444-4444-4444-444444444444', 'doing', 'D window', 'checkin_reply',
       w, w
from (
  select (((now() at time zone 'Europe/London')::date - 120)::timestamp at time zone 'Europe/London')
         + (g * interval '10 minutes') as w
  from generate_series(0, 599) g
) s;

-- A: one impulse yield on the same local day (metadata-only dataset; content must never surface).
insert into public.doings_logs (user_id, kind, content, energy, source, logged_at, checkin_window)
values ('11111111-1111-1111-1111-111111111111', 'impulse_failure',
        'IMPULSE CONTENT - must never be returned', 4, 'chat',
        ((now() at time zone 'Europe/London')::date - 5 + time '12:00') at time zone 'Europe/London',
        null);

-- A: two habits in different states.
insert into public.habits (id, user_id, description, status, detected_at, watch_started_at, watch_days, strike_at)
values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Scrolling in bed', 'watch',
   ((now() at time zone 'Europe/London')::date - 4 + time '12:00') at time zone 'Europe/London',
   (now() at time zone 'Europe/London')::date - 4, 7, null),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Skipping breakfast', 'detected',
   ((now() at time zone 'Europe/London')::date - 2 + time '09:00') at time zone 'Europe/London',
   null, 7, null);

-- A: two anchor plans. `label` is the stored key; the RPC projects it to `title`.
insert into public.anchor_plans (id, user_id, plan_date, anchors)
values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   (now() at time zone 'Europe/London')::date - 5,
   '[{"start":"08:00","end":"09:00","label":"Deep work","kind":"commitment"},
     {"start":"12:00","end":"12:30","label":"Walk","kind":"routine"}]'::jsonb),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   (now() at time zone 'Europe/London')::date - 4,
   '[{"start":"09:00","end":"10:00","label":"Gym","kind":"commitment"}]'::jsonb);

-- A: three metrics (one archived, one quest) and their points. B: one metric, for isolation.
insert into public.metrics (id, user_id, name, domain, output_unit, is_quest, quest_status, quest_deadline, formula, formula_status, archived_at)
values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Deep Work Hours', 'Health', 'hours', false, null, null, '{}'::jsonb, 'validated', null),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Gym Sessions', 'Discipline/Habits', 'sessions', true, 'active',
   (now() at time zone 'Europe/London')::date + 7, '{}'::jsonb, 'proposed', null),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Old Metric', 'Health', 'count', false, null, null, '{}'::jsonb, 'rejected', now()),
  ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'B Metric', 'Health', 'count', false, null, null, '{}'::jsonb, 'validated', null);

insert into public.metric_points (metric_id, value, computed_for)
values
  ('a0000000-0000-0000-0000-000000000001', 1, (now() at time zone 'Europe/London')::date - 5),
  ('a0000000-0000-0000-0000-000000000001', 2, (now() at time zone 'Europe/London')::date - 4),
  ('a0000000-0000-0000-0000-000000000001', 3, (now() at time zone 'Europe/London')::date - 3),
  ('a0000000-0000-0000-0000-000000000002', 1, (now() at time zone 'Europe/London')::date - 4),
  ('a0000000-0000-0000-0000-0000000000b1', 5, (now() at time zone 'Europe/London')::date - 4);

-- ---------------------------------------------------------------------------- harness

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

-- ============================================================ T5: hardening + grants

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
  'T5 read_schedule_profile/list_answered_windows: authenticated only',
  'postgres', null,
  $q$select 1
       where has_function_privilege('authenticated', 'public.read_schedule_profile()', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.list_answered_windows(date, date)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.read_schedule_profile()', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.read_schedule_profile()', 'EXECUTE')
         and not has_function_privilege('anon', 'public.list_answered_windows(date, date)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.list_answered_windows(date, date)', 'EXECUTE')$q$
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
         and not has_function_privilege('service_role', 'public.summarize_memory_facts(text[], date, date, boolean, text[])', 'EXECUTE')
         and not has_function_privilege('anon', 'public.list_memory_facts(text[], date, date, boolean, integer)', 'EXECUTE')$q$
);

-- D1: the return type is the exclusion guarantee. If either column ever appears in a result
-- signature, a later caller can read it without any grant change.
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

-- ============================================================ T2: match_rules_v2

select pg_temp.expect_rows(
  'T2 authenticated gets rule rows and the payload carries text/domain/tone',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.99, null, 5) r
       where r.text <> '' and r.domain <> '' and r.tone <> '' and round(r.similarity::numeric, 6) = 1.000000$q$
);

select pg_temp.expect_rows(
  'T2 service_role can also call match_rules_v2 (with the user JWT claims it would carry)',
  'service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}',
  $q$select 1 from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.99, null, 5)$q$
);

select pg_temp.expect('T2 anon denied: match_rules_v2', 'anon', null,
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, 5)$q$,
  '42501');

select pg_temp.expect(
  'T2 the result type has no embedding column (runtime proof)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select embedding from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, 5)$q$,
  '42703'
);

select pg_temp.expect(
  'T2 p_min_similarity has no default',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.match_rules_v2(p_query_embedding => ('[1' || repeat(',0',767) || ']')::vector)$q$,
  '42883'
);

select pg_temp.expect_rows(
  'T2 threshold 0.9 keeps the 2 fully aligned rules',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.match_rules_v2(
       ('[1' || repeat(',0',767) || ']')::vector, 0.9, null, 5)) = 2$q$
);

select pg_temp.expect_rows(
  'T2 threshold 0.5 keeps all 3 fixture rules',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.match_rules_v2(
       ('[1' || repeat(',0',767) || ']')::vector, 0.5, null, 5)) = 3$q$
);

-- Hints boost, never filter: the same 2 rules at 1.0, but the hinted domain is first.
select pg_temp.expect_rows(
  'T2 domain hints break ties in favour of the hinted domain, without filtering',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.9,
                                         array['Discipline/Habits']::text[], 5) with ordinality as r
       where r.ordinality = 1 and r.domain = 'Discipline/Habits'$q$
);

select pg_temp.expect_rows(
  'T2 an unknown hint value is inert, not an error (D4: no enum exists to validate)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.match_rules_v2(
       ('[1' || repeat(',0',767) || ']')::vector, 0.9, array['Not/A Domain']::text[], 5)) = 2$q$
);

select pg_temp.expect('T2 p_limit 0 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, 0)$q$,
  '22023');
select pg_temp.expect('T2 p_limit 21 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, 21)$q$,
  '22023');
select pg_temp.expect('T2 p_min_similarity 0 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 0, null, 5)$q$,
  '22023');
select pg_temp.expect('T2 p_min_similarity 1.5 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.match_rules_v2(('[1' || repeat(',0',767) || ']')::vector, 1.5, null, 5)$q$,
  '22023');
select pg_temp.expect('D5 match_rules_v2 3-dim embedding rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.match_rules_v2('[1,2,3]'::vector, 0.5, null, 5)$q$, '22023');

-- ============================================================ T3: anon / service_role

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
  'select * from public.list_answered_windows(current_date - 10, current_date)', '42501');

select pg_temp.expect('T3 service_role denied: search_facts', 'service_role', null,
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5)$q$, '42501');
select pg_temp.expect('T3 service_role denied: list_memory_facts', 'service_role', null,
  'select * from public.list_memory_facts()', '42501');
select pg_temp.expect('T3 service_role denied: count_memory_facts', 'service_role', null,
  'select public.count_memory_facts()', '42501');
select pg_temp.expect('T3 service_role denied: summarize_memory_facts', 'service_role', null,
  'select * from public.summarize_memory_facts()', '42501');

-- ============================================================ T3: own rows only

select pg_temp.expect_rows(
  'T3 A list_memory_facts returns exactly its 3 non-purged facts',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.list_memory_facts(null, null, null, null, 50)) = 3$q$
);

select pg_temp.expect_rows(
  'T3 B list_memory_facts returns exactly its own 2 facts (two-user isolation)',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1 where (select count(*) from public.list_memory_facts(null, null, null, null, 50)) = 2$q$
);

select pg_temp.expect_rows(
  'T3 A sees none of B facts and B sees none of A facts',
  'postgres', null,
  $q$select 1
       where not exists (select 1 from public.memory_facts m
                          where m.user_id = '22222222-2222-2222-2222-222222222222'
                            and m.fact in ('Skips the gym when work runs late',
                                           'Journaled about work and the gym',
                                           'Wants to train four times a week'))$q$
);

select pg_temp.expect_rows(
  'T3 purged fact is invisible to count_memory_facts',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where public.count_memory_facts() = 3$q$
);

select pg_temp.expect_rows(
  'T3 purged fact is invisible to list_memory_facts by id',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where not exists (
       select 1 from public.list_memory_facts(null, null, null, null, 50) f
        where f.id = 'f0000000-0000-0000-0000-000000000004')$q$
);

select pg_temp.expect_rows(
  'T3 purged fact is invisible to search_facts even at threshold 0.01',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where not exists (
       select 1 from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.01, null, null, null, 5) f
        where f.id = 'f0000000-0000-0000-0000-000000000004')$q$
);

select pg_temp.expect_rows(
  'T3 purged fact is invisible to summarize_memory_facts totals',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select sum(n) from public.summarize_memory_facts()) = 3$q$
);

-- ============================================================ search_facts semantics

select pg_temp.expect_rows(
  'search_facts threshold 0.9 keeps only the 2 fully aligned facts',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*)
                       from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.9)) = 2$q$
);

select pg_temp.expect_rows(
  'search_facts threshold 0.5 keeps all 3 visible facts (0.6 included)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*)
                       from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5)) = 3$q$
);

select pg_temp.expect_rows(
  'search_facts returns rows in descending similarity order',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where not exists (
       select 1
       from (
         select f.similarity,
                lag(f.similarity) over (order by f.ordinality) as prev
         from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5)
              with ordinality as f
       ) t
       where t.prev is not null and t.similarity > t.prev)$q$
);

select pg_temp.expect_rows(
  'search_facts returns similarity 1.0 and has_source true for the sourced fact',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5) f
       where f.id = 'f0000000-0000-0000-0000-000000000001'
         and f.has_source
         and round(f.similarity::numeric, 6) = 1.000000$q$
);

select pg_temp.expect_rows(
  'search_facts fact_type filter narrows the arm',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*)
                       from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.01,
                                                array['baseline']::text[])) = 1$q$
);

select pg_temp.expect_rows(
  'list_memory_facts p_has_source partitions 2 sourced / 1 unsourced',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
       where (select count(*) from public.list_memory_facts(null, null, null, true, 50)) = 2
         and (select count(*) from public.list_memory_facts(null, null, null, false, 50)) = 1$q$
);

select pg_temp.expect_rows(
  'summarize_memory_facts default dimension groups by fact_type',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.summarize_memory_facts()) = 3
                   and (select sum(n) from public.summarize_memory_facts()) = 3$q$
);

select pg_temp.expect_rows(
  'summarize_memory_facts created_day dimension is a local date key',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.summarize_memory_facts(null, null, null, null, array['created_day']::text[]) s
       where s.dimension = 'created_day' and s.key ~ '^\d{4}-\d{2}-\d{2}$'$q$
);

-- ============================================================ T8: threshold + D5 + limits

select pg_temp.expect(
  'T8 p_min_similarity has no default (omitting it is a signature error)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(p_query_embedding => ('[1' || repeat(',0',767) || ']')::vector)$q$,
  '42883'
);

select pg_temp.expect('T8 p_min_similarity 0 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0)$q$, '22023');
select pg_temp.expect('T8 p_min_similarity -1 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, -1)$q$, '22023');
select pg_temp.expect('T8 p_min_similarity 1.5 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 1.5)$q$, '22023');
select pg_temp.expect('T8 p_min_similarity null rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, null::double precision)$q$, '22023');

select pg_temp.expect('D5 search_facts 3-dim embedding rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts('[1,2,3]'::vector, 0.5)$q$, '22023');

select pg_temp.expect('search_facts p_limit 0 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, null, null, 0)$q$, '22023');
select pg_temp.expect('search_facts p_limit 6 rejected (PRD cap 5)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.search_facts(('[1' || repeat(',0',767) || ']')::vector, 0.5, null, null, null, 6)$q$, '22023');
select pg_temp.expect('list_memory_facts p_limit 51 rejected (PRD cap 50)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  'select * from public.list_memory_facts(null, null, null, null, 51)', '22023');
select pg_temp.expect('list_memory_facts p_limit 0 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  'select * from public.list_memory_facts(null, null, null, null, 0)', '22023');

select pg_temp.expect('D4 invalid fact_type rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_memory_facts(array['nope']::text[], null, null, null, 50)$$, '22023');
select pg_temp.expect('D4 invalid fact_type rejected on summarize',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.summarize_memory_facts(array['nope']::text[])$$, '22023');

select pg_temp.expect('memory date filter: from without to rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_memory_facts(null, current_date - 5, null, null, 50)$$, '22023');
select pg_temp.expect('memory date filter: inverted range rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_memory_facts(null, current_date - 1, current_date - 5, null, 50)$$, '22023');
select pg_temp.expect('memory date filter: span > 366 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_memory_facts(null, current_date - 400, current_date - 5, null, 50)$$, '22023');
select pg_temp.expect('memory date filter: future p_to rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_memory_facts(null, current_date - 5, current_date + 1, null, 50)$$, '22023');
select pg_temp.expect('summarize_memory_facts unsupported dimension rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.summarize_memory_facts(null, null, null, null, array['embedding']::text[])$$, '22023');

-- ============================================================ T6: timezone failure

select pg_temp.expect('T6 read_schedule_profile with invalid tz -> 22023',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  'select * from public.read_schedule_profile()', '22023');
select pg_temp.expect('T6 list_answered_windows with invalid tz -> 22023',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  'select * from public.list_answered_windows(current_date - 10, current_date - 1)', '22023');
select pg_temp.expect('T6 date-filtered memory read with invalid tz -> 22023',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  'select * from public.list_memory_facts(null, current_date - 10, current_date - 1, null, 50)', '22023');
select pg_temp.expect_ok('T6 unfiltered memory read survives an invalid tz',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  'select * from public.list_memory_facts()');

-- The five datasets whose day basis is a timestamp must all fail closed on the same zone:
-- checkins, impulse_events, daily_vars and conversation always, habits only when a detected
-- range or the detected_day dimension is used. The four pure-date datasets never consult it.
select pg_temp.expect('T6 query_impulse_events with invalid tz -> 22023',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_impulse_events('count', current_date - 5, current_date - 1)$q$, '22023');
select pg_temp.expect('T6 query_conversation with invalid tz -> 22023',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_conversation('count', current_date - 5, current_date - 1)$q$, '22023');
select pg_temp.expect('T6 query_checkins with invalid tz -> 22023 (dataset surface)',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 1)$q$, '22023');
select pg_temp.expect('T6 query_daily_vars with invalid tz -> 22023 (dataset surface)',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_daily_vars('list', current_date - 5, current_date - 1)$q$, '22023');
select pg_temp.expect_ok('T6 query_quests needs no timezone (pure quest_deadline column)',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_quests('list')$q$);

select pg_temp.expect_rows(
  'T6 read_schedule_profile returns the allowlisted subset for a valid profile',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.read_schedule_profile() s
       where s.timezone = 'Europe/London'
         and s.checkin_cadence_minutes = 60
         and s.checkin_active_hours_start = '08:00'::time
         and s.checkin_active_hours_end = '22:00'::time
         and s.onboarding_stage = 'complete'
         and s.dialog_state = 'OPEN'
         and s.day_basis = 'profile_local_day'
         and s.profile_created_at is not null$q$
);

-- ============================================================ list_answered_windows

select pg_temp.expect_rows(
  'list_answered_windows returns 3 windows on the fixture day, exact array',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.list_answered_windows(
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5) w
      where w.answered_count = 3
        and array_length(w.answered_starts, 1) = 3
        and w.first_logged_at <= w.last_logged_at$q$
);

select pg_temp.expect_rows(
  'list_answered_windows is owner-scoped (B sees 2, not 5)',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1 from public.list_answered_windows(
       (now() at time zone 'America/New_York')::date - 5,
       (now() at time zone 'America/New_York')::date - 5) w
      where w.answered_count = 2$q$
);

select pg_temp.expect('list_answered_windows future p_to rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_answered_windows(current_date - 5, current_date + 1)$$, '22023');
select pg_temp.expect('list_answered_windows inverted range rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_answered_windows(current_date - 1, current_date - 5)$$, '22023');
select pg_temp.expect('list_answered_windows span > 366 rejected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $$select * from public.list_answered_windows(current_date - 400, current_date - 5)$$, '22023');

-- ============================================================ T11: exactness vs truncation

select pg_temp.expect_rows(
  'T11 600 answered windows are counted exactly, not truncated',
  'authenticated', '{"sub":"44444444-4444-4444-4444-444444444444"}',
  $q$select 1 where (select sum(answered_count) from public.list_answered_windows(
                        (now() at time zone 'Europe/London')::date - 121,
                        (now() at time zone 'Europe/London')::date - 1)) = 600$q$
);

insert into public.doings_logs (user_id, kind, content, source, logged_at, checkin_window)
select '44444444-4444-4444-4444-444444444444', 'doing', 'D window', 'checkin_reply', w, w
from (
  select (((now() at time zone 'Europe/London')::date - 120)::timestamp at time zone 'Europe/London')
         + ((g + 600) * interval '10 minutes') as w
  from generate_series(0, 1400) g
) s;

select pg_temp.expect(
  'T11 2001 answered windows -> 22023 range_too_large, never a short array',
  'authenticated', '{"sub":"44444444-4444-4444-4444-444444444444"}',
  $q$select * from public.list_answered_windows(
       (now() at time zone 'Europe/London')::date - 121,
       (now() at time zone 'Europe/London')::date - 1)$q$,
  '22023'
);

-- ============================================================ 0046: privilege matrix
--
-- Aggregated deliberately: ten functions x four privilege facts is forty statements, and the
-- only thing that matters is whether all of them hold. Each check is a separate pg_temp.try_as
-- call at top level (never nested inside try_rows - an authenticated role cannot `set role`).

insert into p1_results (ok, label)
select (
  -- no auth.uid() -> the §6.1 prologue fires before any argument validation
     pg_temp.try_as('authenticated', null, $s$select * from public.query_checkins('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_impulse_events('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_anchor_plans('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_habits('list')$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_metrics_catalog('list')$s$) = '42501'
 and pg_temp.try_as('authenticated', null, $s$select * from public.query_metric_series('list', array['a0000000-0000-0000-0000-000000000001']::uuid[])$s$) = '42501'
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
 and pg_temp.try_as('anon', null, $s$select * from public.query_metric_series('list', array['a0000000-0000-0000-0000-000000000001']::uuid[])$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_quests('list')$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_daily_vars('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_conversation('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('anon', null, $s$select * from public.query_journal_entries('count', current_date - 5, current_date - 1)$s$) = '42501'
), 'T3 all ten query_* deny anon with 42501';

insert into p1_results (ok, label)
select (
     pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_checkins('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_impulse_events('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_anchor_plans('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_habits('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_metrics_catalog('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_metric_series('list', array['a0000000-0000-0000-0000-000000000001']::uuid[])$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_quests('list')$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_daily_vars('list', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_conversation('count', current_date - 5, current_date - 1)$s$) = '42501'
 and pg_temp.try_as('service_role', '{"sub":"11111111-1111-1111-1111-111111111111","role":"service_role"}', $s$select * from public.query_journal_entries('count', current_date - 5, current_date - 1)$s$) = '42501'
), 'T3 all ten query_* deny service_role with 42501';

select pg_temp.expect_rows(
  'T5 all ten query_*: DEFINER, pinned search_path, no PUBLIC execute, no tz argument',
  'postgres', null,
  $q$select 1 where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'query\_%'
          and p.proname not like 'query\_%\_%\_%'
          and (not p.prosecdef
               or p.proconfig is null
               or p.proconfig::text not like '%search_path=%'
               or exists (select 1 from unnest(coalesce(p.proacl, '{}')) a
                           where a::text like '=X/%')
               or (p.proargnames[1:p.pronargs] && array['p_tz','timezone','tz']::text[])))$q$
);

select pg_temp.expect_rows(
  'T5 exactly ten query_* functions exist, each granted to authenticated only',
  'postgres', null,
  $q$select 1 where (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'query\_%') = 10
                and not exists (
                  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like 'query\_%'
                     and (not has_function_privilege('authenticated', p.oid, 'EXECUTE')
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
  'T3 content is projected by query_checkins only (metadata-only conversation and journal)',
  'postgres', null,
  $q$select 1 where (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'query\_%'
                        and pg_get_function_result(p.oid) ~* '\mcontent\M') = 1$q$
);

-- Runtime proof, not just the catalog: a caller cannot select a column that is not there.
select pg_temp.expect('conversation has no content column', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select content from public.query_conversation('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3)$q$, '42703');
select pg_temp.expect('journal has no content column', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select content from public.query_journal_entries('list',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 2)$q$, '42703');
select pg_temp.expect('impulse_events has no content column', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select content from public.query_impulse_events('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5)$q$, '42703');

-- ============================================================ 0046: checkins

select pg_temp.expect_rows(
  'checkins count: 3 doings, the impulse row excluded by kind',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_checkins('count',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5)) = 3$q$
);

select pg_temp.expect_rows(
  'checkins aggregate (no dims): n/window_count/energy avg-sum-min-max',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5) a
      where a.n = 3 and a.window_count = 3
        and round(a.energy_avg, 3) = 7.000
        and a.energy_sum = 21 and a.energy_min = 6 and a.energy_max = 8$q$
);

select pg_temp.expect_rows(
  'checkins list: content, source, energy and window are projected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_checkins('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5) c
      where c.content = 'Read a chapter' and c.energy = 8 and c.source = 'app'
        and c.checkin_window is not null and c.total_count = 3$q$
);

select pg_temp.expect_rows(
  'checkins latest: same rows but content is never projected',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_checkins('latest',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5)) = 3
     and not exists (select 1 from public.query_checkins('latest',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5) c where c.content is not null)$q$
);

select pg_temp.expect_rows(
  'checkins timeseries day: one bucket with the aggregate attached',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_checkins('timeseries',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, null, 'day') t
      where t.bucket_start = (now() at time zone 'Europe/London')::date - 5
        and t.n = 3 and t.window_count = 3 and round(t.energy_avg, 3) = 7.000$q$
);

select pg_temp.expect_rows(
  'checkins timeseries week: the same 3 rows in a single week bucket',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select sum(n) from public.query_checkins('timeseries',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, null, 'week')) = 3$q$
);

select pg_temp.expect_rows(
  'checkins aggregate dim hour_of_day: three distinct hours, one row each',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, array['hour_of_day']::text[])) = 3
     and (select n from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, array['hour_of_day']::text[]) g
       where g.key = '8') = 1$q$
);

select pg_temp.expect_rows(
  'checkins aggregate dim source: checkin_reply 2, app 1',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, array['source']::text[]) g where g.key = 'checkin_reply') = 2
     and (select n from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, array['source']::text[]) g where g.key = 'app') = 1$q$
);

select pg_temp.expect_rows(
  'checkins aggregate dim day and week both reduce to the fixture day',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select key from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, array['day']::text[])) = ((now() at time zone 'Europe/London')::date - 5)::text
     and (select key from public.query_checkins('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, null, null, null, array['week']::text[]))
       = (date_trunc('week', ((now() at time zone 'Europe/London')::date - 5)::timestamp)::date)::text$q$
);

select pg_temp.expect_rows(
  'checkins filters: source, energy bounds and has_window each narrow correctly',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select n from public.query_checkins('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5,
               array['app']::text[])) = 1
        and (select n from public.query_checkins('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5,
               null, 7)) = 2
        and (select n from public.query_checkins('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5,
               null, 7, 7)) = 1
        and (select n from public.query_checkins('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5,
               null, null, null, true)) = 3
        and (select n from public.query_checkins('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5,
               null, null, null, false)) = 0$q$
);

-- D2: PRD line 491 caps content at 20 rows. The cap is a clamp, not a rejection, because the
-- default p_limit is 200. User D owns 2001 answered windows.
select pg_temp.expect_rows(
  'D2 checkins list clamps to 20 rows while total_count still reports 2001',
  'authenticated', '{"sub":"44444444-4444-4444-4444-444444444444"}',
  $q$select 1 where (select count(*) from public.query_checkins('list',
       (now() at time zone 'Europe/London')::date - 121,
       (now() at time zone 'Europe/London')::date - 1, null, null, null, null, null, null, 200)) = 20
     and (select max(total_count) from public.query_checkins('list',
       (now() at time zone 'Europe/London')::date - 121,
       (now() at time zone 'Europe/London')::date - 1, null, null, null, null, null, null, 200)) = 2001$q$
);

select pg_temp.expect_rows(
  'D2 checkins latest clamps to 20 as well',
  'authenticated', '{"sub":"44444444-4444-4444-4444-444444444444"}',
  $q$select 1 where (select count(*) from public.query_checkins('latest',
       (now() at time zone 'Europe/London')::date - 121,
       (now() at time zone 'Europe/London')::date - 1)) = 20$q$
);

select pg_temp.expect('checkins unsupported op rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('delete', current_date - 5, current_date - 5)$q$, '22023');
select pg_temp.expect('checkins invalid source rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 5, array['sms']::text[])$q$, '22023');
select pg_temp.expect('checkins energy 0 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 5, null, 0)$q$, '22023');
select pg_temp.expect('checkins energy 11 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 5, null, 11)$q$, '22023');
select pg_temp.expect('checkins inverted energy range rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 5, null, 8, 4)$q$, '22023');
select pg_temp.expect('checkins unsupported dimension rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('aggregate', current_date - 5, current_date - 5, null, null, null, null, array['month']::text[])$q$, '22023');
select pg_temp.expect('checkins invalid bucket rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('timeseries', current_date - 5, current_date - 5, null, null, null, null, null, 'month')$q$, '22023');
select pg_temp.expect('checkins bucket on a non-timeseries op rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 5, null, null, null, null, null, 'day')$q$, '22023');
select pg_temp.expect('checkins limit 0 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('list', current_date - 5, current_date - 5, null, null, null, null, null, null, 0)$q$, '22023');
select pg_temp.expect('checkins limit 501 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('list', current_date - 5, current_date - 5, null, null, null, null, null, null, 501)$q$, '22023');
select pg_temp.expect('checkins missing range rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', null, null)$q$, '22023');
select pg_temp.expect('checkins inverted range rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 1, current_date - 5)$q$, '22023');
select pg_temp.expect('checkins span > 366 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 400, current_date - 5)$q$, '22023');
select pg_temp.expect('checkins future p_to rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date + 1)$q$, '22023');
select pg_temp.expect('checkins invalid timezone -> 22023', 'authenticated',
  '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_checkins('count', current_date - 5, current_date - 5)$q$, '22023');

-- ============================================================ 0046: impulse_events

select pg_temp.expect_rows(
  'impulse count/aggregate/timeseries/list all agree on the single fixture event',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select n from public.query_impulse_events('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5)) = 1
        and (select n from public.query_impulse_events('aggregate',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5)) = 1
        and (select count(*) from public.query_impulse_events('list',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5)) = 1
        and (select sum(n) from public.query_impulse_events('timeseries',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5)) = 1$q$
);

select pg_temp.expect_rows(
  'impulse list exposes source but never the doing kind or its content',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_impulse_events('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5) e
      where e.source = 'chat' and e.total_count = 1$q$
);

select pg_temp.expect_rows(
  'impulse aggregate dim hour_of_day: the noon yield',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_impulse_events('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5,
       null, array['hour_of_day']::text[]) g
      where g.key = '12' and g.n = 1$q$
);

select pg_temp.expect_rows(
  'impulse source filter: chat 1, app 0 (no error)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_impulse_events('count',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5, array['chat']::text[])) = 1
     and (select n from public.query_impulse_events('count',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 5, array['app']::text[])) = 0$q$
);

select pg_temp.expect('impulse unsupported op rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_impulse_events('latest', current_date - 5, current_date - 5)$q$, '22023');

-- ============================================================ 0046: anchor_plans

select pg_temp.expect_rows(
  'anchor_plans list: 2 plans, label projected to title, no label key survives',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_anchor_plans('list',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 1) a
      where a.plan_date = (now() at time zone 'Europe/London')::date - 5
        and jsonb_array_length(a.anchors) = 2
        and a.anchors->0->>'title' = 'Deep work'
        and not (a.anchors->0 ? 'label')$q$
);

select pg_temp.expect_rows(
  'anchor_plans aggregate (no dims): 2 plans, 3 anchors',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_anchor_plans('aggregate',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 1) a
      where a.n = 2 and a.plan_count = 2 and a.anchor_count = 3$q$
);

select pg_temp.expect_rows(
  'anchor_plans aggregate dim day: one row per plan date',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_anchor_plans('aggregate',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 1,
       array['day']::text[])) = 2$q$
);

select pg_temp.expect_rows(
  'anchor_plans aggregate dim kind: commitment 2, routine 1',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select anchor_count from public.query_anchor_plans('aggregate',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 1,
       array['kind']::text[]) k where k.key = 'commitment') = 2
     and (select anchor_count from public.query_anchor_plans('aggregate',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 1,
       array['kind']::text[]) k where k.key = 'routine') = 1$q$
);

select pg_temp.expect_rows(
  'anchor_plans latest returns the newest plan first',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_anchor_plans('latest',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 1) with ordinality as a
      where a.ordinality = 1 and a.plan_date = (now() at time zone 'Europe/London')::date - 4$q$
);

select pg_temp.expect('anchor_plans unsupported dimension rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_anchor_plans('aggregate', current_date - 6, current_date - 1, array['week']::text[])$q$, '22023');

-- ============================================================ 0046: habits

select pg_temp.expect_rows(
  'habits list: 2 habits with status, description and watch fields',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_habits('list')) = 2
     and exists (select 1 from public.query_habits('list') h
                  where h.status = 'watch' and h.description = 'Scrolling in bed'
                    and h.watch_started_at = (now() at time zone 'Europe/London')::date - 4
                    and h.watch_days = 7)$q$
);

select pg_temp.expect_rows(
  'habits status / detected-day / watch-day filters each select one habit',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select count(*) from public.query_habits('list', array['detected']::text[])) = 1
        and (select count(*) from public.query_habits('list', null,
               (now() at time zone 'Europe/London')::date - 4,
               (now() at time zone 'Europe/London')::date - 4)) = 1
        and (select count(*) from public.query_habits('list', null, null, null,
               (now() at time zone 'Europe/London')::date - 4,
               (now() at time zone 'Europe/London')::date - 4)) = 1$q$
);

select pg_temp.expect_rows(
  'habits aggregate (no dims) and dim status both total 2',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_habits('aggregate')) = 2
     and (select sum(n) from public.query_habits('aggregate', null, null, null, null, null,
             array['status']::text[])) = 2$q$
);

select pg_temp.expect_rows(
  'habits aggregate dim detected_day: two local-date keys',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_habits('aggregate', null, null, null,
                        null, null, array['detected_day']::text[])) = 2
     and exists (select 1 from public.query_habits('aggregate', null, null, null, null, null,
                        array['detected_day']::text[]) h
                  where h.key ~ '^\d{4}-\d{2}-\d{2}$')$q$
);

select pg_temp.expect('habits invalid status rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_habits('list', array['archived']::text[])$q$, '22023');
select pg_temp.expect('habits incomplete detected range rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_habits('list', null, current_date - 5, null)$q$, '22023');
select pg_temp.expect('habits detected range in the future rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_habits('list', null, current_date - 5, current_date + 1)$q$, '22023');
select pg_temp.expect('habits invalid timezone only matters when detected range is used',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_habits('list', null, current_date - 5, current_date - 1)$q$, '22023');
select pg_temp.expect_ok('habits list survives an invalid timezone (no date filter)',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_habits('list')$q$);

-- ============================================================ 0046: metrics_catalog

select pg_temp.expect_rows(
  'metrics_catalog default excludes the archived metric (2 of 3), include returns 3',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metrics_catalog('list')) = 2
     and (select count(*) from public.query_metrics_catalog('list', null, null, null, null, 'include')) = 3
     and (select count(*) from public.query_metrics_catalog('list', null, null, null, null, 'only')) = 1$q$
);

select pg_temp.expect_rows(
  'metrics_catalog list projects the catalog fields and never the formula',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_metrics_catalog('list') m
      where m.name = 'Deep Work Hours' and m.domain = 'Health' and m.output_unit = 'hours'
        and m.is_quest = false and m.formula_status = 'validated' and m.archived_at is null
        and m.created_at is not null$q$
);

select pg_temp.expect_rows(
  'metrics_catalog filters: is_quest, formula_status, domain, quest_status',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select count(*) from public.query_metrics_catalog('list', null, null, true)) = 1
        and (select count(*) from public.query_metrics_catalog('list', null, array['validated']::text[])) = 1
        and (select count(*) from public.query_metrics_catalog('list', array['Health']::text[])) = 1
        and (select count(*) from public.query_metrics_catalog('list', array['Health']::text[], null, null, null, 'include')) = 2
        and (select count(*) from public.query_metrics_catalog('list', null, null, null, array['active']::text[])) = 1$q$
);

-- D4: no CHECK on metrics.domain, so an unknown value is an opaque filter: zero rows, no error.
select pg_temp.expect_ok('D4 metrics_catalog unknown domain is inert, not an error',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metrics_catalog('list', array['Nope/Nope']::text[])) = 0$q$);

select pg_temp.expect_rows(
  'metrics_catalog aggregate (no dims) counts 2, dims domain/is_quest/formula_status/quest_status',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_metrics_catalog('aggregate')) = 2
     and (select sum(n) from public.query_metrics_catalog('aggregate', null, null, null, null,
             'exclude', null, null, array['domain']::text[])) = 2
     and (select sum(n) from public.query_metrics_catalog('aggregate', null, null, null, null,
             'exclude', null, null, array['is_quest']::text[])) = 2
     and (select sum(n) from public.query_metrics_catalog('aggregate', null, null, null, null,
             'exclude', null, null, array['formula_status']::text[])) = 2
     and (select sum(n) from public.query_metrics_catalog('aggregate', null, null, null, null,
             'exclude', null, null, array['quest_status']::text[])) = 2$q$
);

select pg_temp.expect_rows(
  'metrics_catalog aggregate dim domain splits Health 1 / Discipline-Habits 1',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_metrics_catalog('aggregate', null, null, null,
       null, 'exclude', null, null, array['domain']::text[]) g where g.key = 'Health') = 1
     and (select n from public.query_metrics_catalog('aggregate', null, null, null,
       null, 'exclude', null, null, array['domain']::text[]) g where g.key = 'Discipline/Habits') = 1$q$
);

select pg_temp.expect('metrics_catalog invalid formula_status rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metrics_catalog('list', null, array['draft']::text[])$q$, '22023');
select pg_temp.expect('metrics_catalog invalid quest_status rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metrics_catalog('list', null, null, null, array['paused']::text[])$q$, '22023');
select pg_temp.expect('metrics_catalog invalid archived_mode rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metrics_catalog('list', null, null, null, null, 'everything')$q$, '22023');

-- ============================================================ 0046: metric_series

select pg_temp.expect('metric_series requires a selector', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metric_series('list')$q$, '22023');

select pg_temp.expect_rows(
  'metric_series list by id / by name / by domain all return the 3 points',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select count(*) from public.query_metric_series('list',
               array['a0000000-0000-0000-0000-000000000001']::uuid[])) = 3
        and (select count(*) from public.query_metric_series('list', null,
               array['Gym Sessions']::text[])) = 1
        and (select count(*) from public.query_metric_series('list', null, null,
               array['Health']::text[])) = 3$q$
);

select pg_temp.expect_rows(
  'metric_series list projects metric name, domain, computed_for and the point value',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_metric_series('list',
       array['a0000000-0000-0000-0000-000000000001']::uuid[]) p
      where p.metric_name = 'Deep Work Hours' and p.domain = 'Health'
        and p.computed_for = (now() at time zone 'Europe/London')::date - 3
        and p.value = 3 and p.total_count = 3$q$
);

select pg_temp.expect_rows(
  'metric_series timeseries day: 3 buckets with latest/avg/sum/min/max/delta',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metric_series('timeseries',
                        array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null,
                        null, null, 'day')) = 3
     and exists (select 1 from public.query_metric_series('timeseries',
                        array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null,
                        null, null, 'day') t
                  where t.bucket_start = (now() at time zone 'Europe/London')::date - 3
                    and t.point_count = 1 and t.value_latest = 3)$q$
);

select pg_temp.expect_rows(
  'metric_series timeseries week collapses the 3 daily points into one bucket',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metric_series('timeseries',
                        array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null,
                        null, null, 'week')) = 1$q$
);

select pg_temp.expect_rows(
  'metric_series aggregate: latest 3, avg 2, sum 6, min 1, max 3, count 3, delta 1',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_metric_series('aggregate',
       array['a0000000-0000-0000-0000-000000000001']::uuid[]) a
      where a.value_latest = 3 and a.value_avg = 2 and a.value_sum = 6
        and a.value_min = 1 and a.value_max = 3 and a.point_count = 3
        and a.value_delta = 1 and a.metric_name = 'Deep Work Hours'$q$
);

select pg_temp.expect_rows(
  'metric_series aggregate dim metric_id labels the facet with the metric name',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_metric_series('aggregate',
       array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null, null, null, null,
       false, array['metric_id']::text[]) g
      where g.key = 'Deep Work Hours' and g.point_count = 3$q$
);

select pg_temp.expect_rows(
  'metric_series latest returns the 3 points of the selected metric',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metric_series('latest',
       array['a0000000-0000-0000-0000-000000000001']::uuid[])) = 3$q$
);

-- Isolation: metric_points has no user_id, so the join is the only ownership check. A asking for
-- B's metric id must get nothing, and A's catalog must not contain B's metric.
select pg_temp.expect_rows(
  'metric_series isolation: A cannot read B metric points by id',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metric_series('list',
       array['a0000000-0000-0000-0000-0000000000b1']::uuid[])) = 0$q$
);
select pg_temp.expect_rows(
  'metrics_catalog isolation: A sees 3 of the 4 corpus metrics, B sees exactly its own 1',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_metrics_catalog('list', null, null, null,
       null, 'include')) = 3$q$
);
select pg_temp.expect_rows(
  'metrics_catalog isolation: B sees exactly its own metric',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1 where (select count(*) from public.query_metrics_catalog('list', null, null, null,
       null, 'include')) = 1$q$
);

select pg_temp.expect('metric_series invalid bucket rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metric_series('timeseries',
       array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null, null, null, 'year')$q$, '22023');
select pg_temp.expect('metric_series from without to rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metric_series('list',
       array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null, current_date - 5)$q$, '22023');
select pg_temp.expect('metric_series span > 366 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_metric_series('list',
       array['a0000000-0000-0000-0000-000000000001']::uuid[], null, null,
       current_date - 400, current_date - 5)$q$, '22023');

-- ============================================================ 0046: quests

select pg_temp.expect_rows(
  'quests list: exactly the one is_quest metric, with status and deadline',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_quests('list')) = 1
     and exists (select 1 from public.query_quests('list') q
                  where q.name = 'Gym Sessions' and q.quest_status = 'active'
                    and q.quest_deadline = (now() at time zone 'Europe/London')::date + 7)$q$
);

select pg_temp.expect_rows(
  'quests aggregate (no dims) = 1; dims quest_status/domain/deadline_day each produce 1 row',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_quests('aggregate')) = 1
     and (select count(*) from public.query_quests('aggregate', null, null, null, null,
             array['quest_status']::text[])) = 1
     and (select count(*) from public.query_quests('aggregate', null, null, null, null,
             array['domain']::text[])) = 1
     and (select count(*) from public.query_quests('aggregate', null, null, null, null,
             array['deadline_day']::text[])) = 1$q$
);

select pg_temp.expect_rows(
  'quests deadline_day key is the stored local date, unshifted',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_quests('aggregate', null, null, null, null,
       array['deadline_day']::text[]) g
      where g.key = (((now() at time zone 'Europe/London')::date + 7))::text$q$
);

-- A deadline may point forward: the §6.2 future clamp is only for timestamp-derived ranges.
select pg_temp.expect_rows(
  'quests deadline range may point into the future (no future clamp on a date column)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_quests('list', null,
       (now() at time zone 'Europe/London')::date + 1,
       (now() at time zone 'Europe/London')::date + 30)) = 1
     and (select count(*) from public.query_quests('list', null,
       (now() at time zone 'Europe/London')::date - 30,
       (now() at time zone 'Europe/London')::date - 1)) = 0$q$
);

select pg_temp.expect('quests invalid quest_status rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_quests('list', array['cancelled']::text[])$q$, '22023');
select pg_temp.expect('quests incomplete deadline range rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_quests('list', null, current_date)$q$, '22023');

-- ============================================================ 0046: daily_vars

select pg_temp.expect_rows(
  'daily_vars list zero-fills the range and computes hours_logged in SQL (D3)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_daily_vars('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3) v
      where v.local_day = (now() at time zone 'Europe/London')::date - 5
        and v.doings_count = 3 and v.impulse_failures = 1
        and v.answered_windows = 3 and v.hours_logged = 3
        and round(v.energy_avg, 3) = 7.000
        and v.journal_positive_mentions = 0 and v.journal_negative_mentions = 1$q$
);

select pg_temp.expect_rows(
  'daily_vars fills a day with no doings and still reports its journal and zero hours',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_daily_vars('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3) v
      where v.local_day = (now() at time zone 'Europe/London')::date - 4
        and v.doings_count = 0 and v.impulse_failures = 0 and v.answered_windows = 0
        and v.hours_logged = 0 and v.energy_avg is null
        and v.journal_positive_mentions = 1 and v.journal_negative_mentions = 0$q$
);

select pg_temp.expect_rows(
  'daily_vars list returns exactly one row per day in the range',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_daily_vars('list',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3)) = 3$q$
);

select pg_temp.expect_rows(
  'daily_vars timeseries day = 3 buckets, week collapses them and keeps the sums',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_daily_vars('timeseries',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, 'day')) = 3
     and (select sum(doings_count) from public.query_daily_vars('timeseries',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, 'week')) = 3$q$
);

select pg_temp.expect_rows(
  'daily_vars aggregate (no dims) sums the grid; dims day/weekday both cover 3 days',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_daily_vars('aggregate',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3) a
      where a.n = 3 and a.doings_count = 3 and a.impulse_failures = 1
        and a.hours_logged = 3 and a.answered_windows = 3
        and a.journal_positive_mentions = 1 and a.journal_negative_mentions = 2$q$
);

select pg_temp.expect_rows(
  'daily_vars aggregate dim day/weekday each produce 3 facet rows',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_daily_vars('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        array['day']::text[])) = 3
     and (select count(*) from public.query_daily_vars('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        array['weekday']::text[])) = 3$q$
);

select pg_temp.expect('daily_vars unsupported dimension rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_daily_vars('aggregate', current_date - 5, current_date - 3, array['month']::text[])$q$, '22023');
select pg_temp.expect('daily_vars limit 367 rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_daily_vars('list', current_date - 5, current_date - 3, null, null, 367)$q$, '22023');
select pg_temp.expect('daily_vars future p_to rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_daily_vars('list', current_date - 5, current_date + 1)$q$, '22023');
select pg_temp.expect('daily_vars unusable grid rejected', 'authenticated',
  '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_daily_vars('list', current_date - 5, current_date - 3)$q$, '22023');

-- ============================================================ 0046: conversation

select pg_temp.expect_rows(
  'conversation count excludes the unsavable row (3 of 4)',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_conversation('count',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3)) = 3$q$
);

select pg_temp.expect_rows(
  'conversation list returns role and source metadata for 3 rows',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_conversation('list',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3)) = 3
     and exists (select 1 from public.query_conversation('list',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3) c
                  where c.role = 'assistant' and c.source = 'pipeline')$q$
);

select pg_temp.expect_rows(
  'conversation aggregate (no dims) = 3; dims role/source/day/hour_of_day all resolve',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_conversation('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3)) = 3
     and (select n from public.query_conversation('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, null, array['role']::text[]) g where g.key = 'user') = 2
     and (select n from public.query_conversation('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, null, array['source']::text[]) g where g.key = 'chat') = 2
     and (select count(*) from public.query_conversation('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, null, array['day']::text[])) = 2
     and (select count(*) from public.query_conversation('aggregate',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, null, array['hour_of_day']::text[])) = 2$q$
);

select pg_temp.expect_rows(
  'conversation role and source filters narrow correctly',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select n from public.query_conversation('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 3,
               array['assistant']::text[])) = 1
        and (select n from public.query_conversation('count',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 3,
               null, array['pipeline']::text[])) = 1$q$
);

-- D4: messages.metadata->>'source' has no CHECK, so an unknown value is inert.
select pg_temp.expect_ok('D4 conversation unknown source is inert, not an error',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select n from public.query_conversation('count',
       (now() at time zone 'Europe/London')::date - 5,
       (now() at time zone 'Europe/London')::date - 3,
       null, array['not-a-real-source']::text[])) = 0$q$);

select pg_temp.expect_rows(
  'conversation timeseries day produces the 2 active days',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_conversation('timeseries',
                        (now() at time zone 'Europe/London')::date - 5,
                        (now() at time zone 'Europe/London')::date - 3,
                        null, null, null, 'day')) = 2$q$
);

select pg_temp.expect('conversation invalid role rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_conversation('count', current_date - 5, current_date - 3, array['system']::text[])$q$, '22023');

-- ============================================================ 0046: journal_entries

select pg_temp.expect_rows(
  'journal count/list/aggregate agree on 3 entries; entry_date is never shifted',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select n from public.query_journal_entries('count',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2)) = 3
        and (select count(*) from public.query_journal_entries('list',
               (now() at time zone 'Europe/London')::date - 5,
               (now() at time zone 'Europe/London')::date - 5)) = 1
        and (select n from public.query_journal_entries('aggregate',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2)) = 3$q$
);

select pg_temp.expect_rows(
  'journal aggregate value is the mean vagueness (0.30) and list projects the flags',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 from public.query_journal_entries('aggregate',
       (now() at time zone 'Europe/London')::date - 6,
       (now() at time zone 'Europe/London')::date - 2) a
      where round(a.value, 4) = 0.3000
        and exists (select 1 from public.query_journal_entries('list',
          (now() at time zone 'Europe/London')::date - 4,
          (now() at time zone 'Europe/London')::date - 4) j
          where j.severity = 'S3' and j.probed = false and j.habit_flag = true
            and j.vagueness_score = 0.10)$q$
);

select pg_temp.expect_rows(
  'journal filters: severity / probed / habit_flag each select the expected count',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select n from public.query_journal_entries('count',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               array['S1']::text[])) = 1
        and (select n from public.query_journal_entries('count',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               null, true)) = 2
        and (select n from public.query_journal_entries('count',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               null, null, true)) = 1$q$
);

select pg_temp.expect_rows(
  'journal aggregate dims severity/habit_flag/day/week each total 3',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1
      where (select count(*) from public.query_journal_entries('aggregate',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               null, null, null, array['severity']::text[])) = 3
        and (select count(*) from public.query_journal_entries('aggregate',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               null, null, null, array['habit_flag']::text[])) = 2
        and (select count(*) from public.query_journal_entries('aggregate',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               null, null, null, array['day']::text[])) = 3
        and (select count(*) from public.query_journal_entries('aggregate',
               (now() at time zone 'Europe/London')::date - 6,
               (now() at time zone 'Europe/London')::date - 2,
               null, null, null, array['week']::text[])) >= 1$q$
);

select pg_temp.expect_rows(
  'journal timeseries day: 3 buckets, each carrying the vagueness mean',
  'authenticated', '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select 1 where (select count(*) from public.query_journal_entries('timeseries',
                        (now() at time zone 'Europe/London')::date - 6,
                        (now() at time zone 'Europe/London')::date - 2,
                        null, null, null, null, 'day')) = 3
     and exists (select 1 from public.query_journal_entries('timeseries',
                        (now() at time zone 'Europe/London')::date - 6,
                        (now() at time zone 'Europe/London')::date - 2,
                        null, null, null, null, 'day') t
                  where round(t.value, 4) = 0.3000)$q$
);

-- entry_date is a pure date column: a forward range is legal, and no timezone is consulted.
select pg_temp.expect_ok('journal accepts a future p_to (pure date column, no tz, no clamp)',
  'authenticated', '{"sub":"33333333-3333-3333-3333-333333333333"}',
  $q$select * from public.query_journal_entries('count', current_date - 6, current_date + 5)$q$);

select pg_temp.expect('journal invalid severity rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_journal_entries('count', current_date - 6, current_date - 2, array['S4']::text[])$q$, '22023');
select pg_temp.expect('journal unsupported dimension rejected', 'authenticated',
  '{"sub":"11111111-1111-1111-1111-111111111111"}',
  $q$select * from public.query_journal_entries('aggregate', current_date - 6, current_date - 2, null, null, null, array['source']::text[])$q$, '22023');

-- ============================================================ 0046: isolation sweep
--
-- One assertion per dataset that has a B-side fixture, so a missing ownership predicate shows up
-- as a specific red row rather than a vague total.

select pg_temp.expect_rows(
  'isolation checkins: A 3 / B 2 on their own local days',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1 where (select n from public.query_checkins('count',
       (now() at time zone 'America/New_York')::date - 5,
       (now() at time zone 'America/New_York')::date - 5)) = 2$q$
);
select pg_temp.expect_rows(
  'isolation conversation: B owns no messages, so its count is 0',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1 where (select n from public.query_conversation('count',
       (now() at time zone 'America/New_York')::date - 30,
       (now() at time zone 'America/New_York')::date - 1)) = 0$q$
);
select pg_temp.expect_rows(
  'isolation journal: B owns no entries, so its count is 0',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1 where (select n from public.query_journal_entries('count',
       (now() at time zone 'America/New_York')::date - 30,
       (now() at time zone 'America/New_York')::date - 1)) = 0$q$
);
select pg_temp.expect_rows(
  'isolation habits/anchor_plans/daily_vars: B sees only its own 2 windows, not A fixtures',
  'authenticated', '{"sub":"22222222-2222-2222-2222-222222222222"}',
  $q$select 1
      where (select count(*) from public.query_habits('list')) = 0
        and (select n from public.query_anchor_plans('aggregate',
               (now() at time zone 'America/New_York')::date - 30,
               (now() at time zone 'America/New_York')::date - 1)) = 0
        -- B owns 2 answered windows (120-min cadence), A owns 3 (60-min): the totals differ, so
        -- this is a real ownership filter and not a shared zero.
        and (select sum(v.doings_count) from public.query_daily_vars('list',
               (now() at time zone 'America/New_York')::date - 5,
               (now() at time zone 'America/New_York')::date - 3) v) = 2
        and (select sum(v.hours_logged) from public.query_daily_vars('list',
               (now() at time zone 'America/New_York')::date - 5,
               (now() at time zone 'America/New_York')::date - 3) v) = 4$q$
);

-- ============================================================ report

select seq, ok, label from p1_results order by seq;
