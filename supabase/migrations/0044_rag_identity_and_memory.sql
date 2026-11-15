-- Migration 0044_rag_identity_and_memory
-- RAG redesign Phase 1 (PLAN.md §6.1-6.3, §9.1-9.2, §13; owner decisions D1-D5 approved 2026-11-15).
--
-- Five of the eighteen P1 functions:
--
--   1. public.current_user_timezone()   INVOKER, zero args, no EXECUTE grant
--   2. public.read_schedule_profile()   DEFINER, authenticated
--   3. public.list_answered_windows()   DEFINER, authenticated
--   4. public.search_facts()            DEFINER, authenticated
--   5. public.list_memory_facts()       DEFINER, authenticated
--   6. public.count_memory_facts()      DEFINER, authenticated
--   7. public.summarize_memory_facts()  DEFINER, authenticated
--
-- (1) is the only INVOKER function in P1 and the only place the timezone is read. It takes no
-- arguments, so there is no way for a caller to supply a zone or a foreign user id: the v4 hole
-- (a valid but *different* p_tz, or resolve_user_timezone(arbitrary_uuid) as a cross-user oracle)
-- is closed structurally rather than by validation (§9.1). No EXECUTE grant to any role means it
-- is reachable only from inside the SECURITY DEFINER bodies below, which run as the owner.
--
-- (2) and (3) are the schedule/compliance half of §6.2. `list_answered_windows` returns raw
-- answered windows only - no scheduled count, no ratio, no hours. Those belong to TypeScript
-- (§8), and truncation is impossible by construction because `doings_logs_one_checkin_window`
-- is UNIQUE (user_id, checkin_window) WHERE checkin_window IS NOT NULL, so one row per window.
-- A range guard replaces the missing LIMIT: over `config.rag_compliance_max_windows` windows the
-- function refuses with 22023 rather than returning a short array (T11).
--
-- (4)-(7) are the only surface onto `memory_facts`. Migration 0039 revoked all direct
-- authenticated access to the table, so these four are the whole dataset (§6.3). The embedding
-- and embed_model columns are absent from every RETURNS TABLE, which makes them unreachable at
-- the type level rather than by convention (D1). `purged_at IS NULL` is hard-coded, never a
-- caller argument. Source ids are never returned; only the boolean `has_source`.
--
-- Deliberate omissions, so a later reader does not "fix" them:
--   * No UTC fallback. `coalesce(p.timezone,'UTC')` (loadGrid.ts:41, 0031:31) is NOT copied;
--     a missing or invalid zone is 22023 timezone_unavailable (§9.1, owner decision B-4).
--   * No `baseline` arm in search_facts. The legacy match_facts baseline arm is unbounded
--     (pg_get_functiondef shows no limit); baseline facts stay reachable through
--     list/summarize by fact_type. One bounded arm only (§6.3).
--   * No service_role grant on any of the four memory functions. The JWT path is the only path,
--     so the grant itself is the proof (T3 asserts service_role -> 42501).
--   * No generic executor, no shared query builder, no dynamic SQL (§6.1).
--
-- Owner decisions applied here:
--   D4 - p_fact_types is validated against the live CHECK domain
--        {chat,journal,oath,baseline} because that CHECK exists. Nothing here filters on an
--        enum that has no CHECK.
--   D5 - p_query_embedding is declared as unconstrained `vector` and validated with
--        public.vector_dims() = 768. A `vector(768)` parameter would be dimension-checked by
--        the cast before the body ran, making the documented SQLSTATE unreachable.
--
-- Refs: PLAN.md §6.1, §6.2, §6.3, §9.1, §9.2, §10, §13; RAG PRD §6.1 dataset registry
-- (memory_facts line 583, schedule_profile line 592); AGENTS.md §4.4, §4.7, §7.7.

-- ---------------------------------------------------------------------------- (1) identity

create or replace function public.current_user_timezone()
returns text
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_tz  text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.timezone into v_tz
  from public.profiles p
  where p.id = v_uid;

  -- `v_tz is null` covers both "no profile row" and "profiles.timezone is null": they are the
  -- same failure for retrieval, and neither may silently become UTC.
  if v_tz is null
     or not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
    raise exception 'timezone_unavailable' using errcode = '22023';
  end if;

  return v_tz;
end;
$$;

revoke all on function public.current_user_timezone()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------- (2) schedule

create or replace function public.read_schedule_profile()
returns table (
  timezone text,
  checkin_cadence_minutes integer,
  checkin_active_hours_start time,
  checkin_active_hours_end time,
  wake_time time,
  sleep_time time,
  onboarding_stage text,
  dialog_state text,
  profile_created_at timestamptz,
  day_basis text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_tz      text;
  v_cadence integer;
  v_start   time;
  v_end     time;
  v_wake    time;
  v_sleep   time;
  v_stage   text;
  v_dialog  text;
  v_created timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.checkin_cadence_minutes,
         p.checkin_active_hours_start,
         p.checkin_active_hours_end,
         p.wake_time,
         p.sleep_time,
         p.onboarding_stage,
         p.dialog_state,
         p.created_at
    into v_cadence, v_start, v_end, v_wake, v_sleep, v_stage, v_dialog, v_created
  from public.profiles p
  where p.id = v_uid;

  if not found then
    raise exception 'profile_unavailable' using errcode = '22023';
  end if;

  -- Single source for the zone, so the schedule and every date-windowed query can never disagree.
  v_tz := public.current_user_timezone();

  -- The CHECK constraint already limits this to (60,120); the guard stays because the grid
  -- contract is what callers depend on, and a constraint is not a contract (§6.2).
  if v_cadence is null or v_cadence not in (60, 120) then
    raise exception 'grid_unavailable' using errcode = '22023';
  end if;

  -- Explicitly not returned: trust_score, lockdown_started_at, routine,
  -- high_dopamine_activities, latest_energy, updated_at, display_name (§6.2, §4.7).
  return query
  select v_tz, v_cadence, v_start, v_end, v_wake, v_sleep, v_stage, v_dialog, v_created,
         'profile_local_day'::text;
end;
$$;

revoke all on function public.read_schedule_profile()
  from public, anon, authenticated, service_role;
grant execute on function public.read_schedule_profile() to authenticated;

-- ---------------------------------------------------------------------------- (3) grid evidence

create or replace function public.list_answered_windows(p_from date, p_to date)
returns table (
  local_day date,
  answered_count integer,
  answered_starts timestamptz[],
  first_logged_at timestamptz,
  last_logged_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid   uuid;
  v_tz    text;
  v_max   integer;
  v_total bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_from is null or p_to is null then
    raise exception 'date_range_required' using errcode = '22023';
  end if;
  if p_from > p_to then
    raise exception 'date_range_inverted' using errcode = '22023';
  end if;
  if (p_to - p_from) > 366 then
    raise exception 'date_range_too_large' using errcode = '22023';
  end if;

  v_tz := public.current_user_timezone();

  if p_to > (now() at time zone v_tz)::date then
    raise exception 'date_range_in_future' using errcode = '22023';
  end if;

  -- [SPEC] read from config, not hardcoded; 2000 is the documented seed value (PLAN.md §6.2,
  -- migration 0042). Missing row falls back to the same documented default.
  select (c.value #>> '{}')::integer
    into v_max
  from public.config c
  where c.key = 'rag_compliance_max_windows';
  v_max := coalesce(v_max, 2000);

  select count(*)
    into v_total
  from public.doings_logs d
  where d.user_id = v_uid
    and d.kind = 'doing'
    and d.checkin_window is not null
    and (d.checkin_window at time zone v_tz)::date between p_from and p_to;

  -- Exactness over truncation: a short array would be silently wrong evidence (T11).
  if v_total > v_max then
    raise exception 'range_too_large: % answered windows, cap %', v_total, v_max
      using errcode = '22023';
  end if;

  return query
  select (d.checkin_window at time zone v_tz)::date as local_day,
         count(*)::integer as answered_count,
         array_agg(d.checkin_window order by d.checkin_window) as answered_starts,
         min(d.logged_at) as first_logged_at,
         max(d.logged_at) as last_logged_at
  from public.doings_logs d
  where d.user_id = v_uid
    and d.kind = 'doing'
    and d.checkin_window is not null
    and (d.checkin_window at time zone v_tz)::date between p_from and p_to
  group by 1
  order by 1;
end;
$$;

revoke all on function public.list_answered_windows(date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.list_answered_windows(date, date) to authenticated;

-- ---------------------------------------------------------------------------- (4) memory search

create or replace function public.search_facts(
  p_query_embedding vector,
  p_min_similarity double precision,
  p_fact_types text[] default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  fact text,
  fact_type text,
  created_at timestamptz,
  has_source boolean,
  similarity double precision
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_tz  text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_query_embedding is null or public.vector_dims(p_query_embedding) is distinct from 768 then
    raise exception 'embedding_dimension' using errcode = '22023';
  end if;

  -- No DEFAULT and no zero fallback: an uncalibrated threshold must fail here, not degrade
  -- retrieval to "everything" (§10, T8).
  if p_min_similarity is null or p_min_similarity <= 0 or p_min_similarity > 1 then
    raise exception 'similarity_threshold_invalid' using errcode = '22023';
  end if;

  if p_fact_types is not null
     and not (p_fact_types <@ array['chat', 'journal', 'oath', 'baseline']::text[]) then
    raise exception 'invalid_fact_type' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 5 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  if (p_from is null) <> (p_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;

  -- The zone is only needed when a date window is asked for, so memory_facts stays available
  -- with an unusable zone for the unfiltered case (§9.1).
  if p_from is not null then
    if p_from > p_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_to - p_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
    v_tz := public.current_user_timezone();
    if p_to > (now() at time zone v_tz)::date then
      raise exception 'date_range_in_future' using errcode = '22023';
    end if;
  end if;

  return query
  select s.id, s.fact, s.fact_type, s.created_at, s.has_source, s.similarity
  from (
    select m.id as id,
           m.fact as fact,
           m.fact_type as fact_type,
           m.created_at as created_at,
           (m.source_message_id is not null or m.source_journal_id is not null) as has_source,
           1 - (m.embedding operator(public.<=>) p_query_embedding) as similarity
    from public.memory_facts m
    where m.user_id = v_uid
      and m.purged_at is null
      and m.embedding is not null
      and (p_fact_types is null or m.fact_type = any (p_fact_types))
      and (p_from is null or (m.created_at at time zone v_tz)::date >= p_from)
      and (p_to is null or (m.created_at at time zone v_tz)::date <= p_to)
  ) s
  where s.similarity >= p_min_similarity
  order by s.similarity desc, s.id
  limit p_limit;
end;
$$;

revoke all on function public.search_facts(vector, double precision, text[], date, date, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_facts(vector, double precision, text[], date, date, integer)
  to authenticated;

-- ---------------------------------------------------------------------------- (5) memory list

create or replace function public.list_memory_facts(
  p_fact_types text[] default null,
  p_from date default null,
  p_to date default null,
  p_has_source boolean default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  fact text,
  fact_type text,
  created_at timestamptz,
  has_source boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_tz  text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_fact_types is not null
     and not (p_fact_types <@ array['chat', 'journal', 'oath', 'baseline']::text[]) then
    raise exception 'invalid_fact_type' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  if (p_from is null) <> (p_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;

  if p_from is not null then
    if p_from > p_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_to - p_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
    v_tz := public.current_user_timezone();
    if p_to > (now() at time zone v_tz)::date then
      raise exception 'date_range_in_future' using errcode = '22023';
    end if;
  end if;

  return query
  select m.id, m.fact, m.fact_type, m.created_at,
         (m.source_message_id is not null or m.source_journal_id is not null) as has_source
  from public.memory_facts m
  where m.user_id = v_uid
    and m.purged_at is null
    and (p_fact_types is null or m.fact_type = any (p_fact_types))
    and (p_from is null or (m.created_at at time zone v_tz)::date >= p_from)
    and (p_to is null or (m.created_at at time zone v_tz)::date <= p_to)
    and (p_has_source is null
         or (m.source_message_id is not null or m.source_journal_id is not null) = p_has_source)
  order by m.created_at desc, m.id
  limit p_limit;
end;
$$;

revoke all on function public.list_memory_facts(text[], date, date, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_memory_facts(text[], date, date, boolean, integer)
  to authenticated;

-- ---------------------------------------------------------------------------- (6) memory count

create or replace function public.count_memory_facts(
  p_fact_types text[] default null,
  p_from date default null,
  p_to date default null,
  p_has_source boolean default null
)
returns bigint
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_tz  text;
  v_n   bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_fact_types is not null
     and not (p_fact_types <@ array['chat', 'journal', 'oath', 'baseline']::text[]) then
    raise exception 'invalid_fact_type' using errcode = '22023';
  end if;

  if (p_from is null) <> (p_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;

  if p_from is not null then
    if p_from > p_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_to - p_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
    v_tz := public.current_user_timezone();
    if p_to > (now() at time zone v_tz)::date then
      raise exception 'date_range_in_future' using errcode = '22023';
    end if;
  end if;

  select count(*)
    into v_n
  from public.memory_facts m
  where m.user_id = v_uid
    and m.purged_at is null
    and (p_fact_types is null or m.fact_type = any (p_fact_types))
    and (p_from is null or (m.created_at at time zone v_tz)::date >= p_from)
    and (p_to is null or (m.created_at at time zone v_tz)::date <= p_to)
    and (p_has_source is null
         or (m.source_message_id is not null or m.source_journal_id is not null) = p_has_source);

  return v_n;
end;
$$;

revoke all on function public.count_memory_facts(text[], date, date, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.count_memory_facts(text[], date, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------- (7) memory summary

create or replace function public.summarize_memory_facts(
  p_fact_types text[] default null,
  p_from date default null,
  p_to date default null,
  p_has_source boolean default null,
  p_dimensions text[] default null
)
returns table (
  dimension text,
  key text,
  n bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_tz   text;
  v_dims text[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_fact_types is not null
     and not (p_fact_types <@ array['chat', 'journal', 'oath', 'baseline']::text[]) then
    raise exception 'invalid_fact_type' using errcode = '22023';
  end if;

  -- Null and empty both mean "the default dimension", so a caller that sends an empty array is
  -- not silently given an empty result.
  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array['fact_type']::text[]);
  if not (v_dims <@ array['fact_type', 'created_day']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if (p_from is null) <> (p_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;

  if p_from is not null then
    if p_from > p_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_to - p_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
  end if;

  -- created_day and the date filter are the only parts that need the profile zone.
  if p_from is not null or 'created_day' = any (v_dims) then
    v_tz := public.current_user_timezone();
    if p_from is not null and p_to > (now() at time zone v_tz)::date then
      raise exception 'date_range_in_future' using errcode = '22023';
    end if;
  end if;

  if 'fact_type' = any (v_dims) then
    return query
    select 'fact_type'::text as dimension,
           m.fact_type::text as key,
           count(*) as n
    from public.memory_facts m
    where m.user_id = v_uid
      and m.purged_at is null
      and (p_fact_types is null or m.fact_type = any (p_fact_types))
      and (p_from is null or (m.created_at at time zone v_tz)::date >= p_from)
      and (p_to is null or (m.created_at at time zone v_tz)::date <= p_to)
      and (p_has_source is null
           or (m.source_message_id is not null or m.source_journal_id is not null) = p_has_source)
    group by m.fact_type
    order by m.fact_type;
  end if;

  if 'created_day' = any (v_dims) then
    return query
    select 'created_day'::text as dimension,
           ((m.created_at at time zone v_tz)::date)::text as key,
           count(*) as n
    from public.memory_facts m
    where m.user_id = v_uid
      and m.purged_at is null
      and (p_fact_types is null or m.fact_type = any (p_fact_types))
      and (p_from is null or (m.created_at at time zone v_tz)::date >= p_from)
      and (p_to is null or (m.created_at at time zone v_tz)::date <= p_to)
      and (p_has_source is null
           or (m.source_message_id is not null or m.source_journal_id is not null) = p_has_source)
    group by 2
    order by 2;
  end if;

  return;
end;
$$;

revoke all on function public.summarize_memory_facts(text[], date, date, boolean, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.summarize_memory_facts(text[], date, date, boolean, text[])
  to authenticated;

-- PostgREST caches the schema; without this the RPCs are not reachable until the next reload.
notify pgrst, 'reload schema';

-- Verify:
--   -- functions: prosecdef / proconfig / proacl, and no "=X" (PUBLIC) entry anywhere
--   select p.proname, p.prosecdef, p.provolatile, p.proconfig,
--          coalesce(array_to_string(p.proacl, ' | '), '(none)') as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('current_user_timezone','read_schedule_profile','list_answered_windows',
--                        'search_facts','list_memory_facts','count_memory_facts',
--                        'summarize_memory_facts')
--    order by 1;
--
--   -- the type-level exclusion guarantee (D1): no embedding / embed_model anywhere in a result
--   select p.proname, pg_get_function_result(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like '%memory_facts' or p.proname = 'search_facts';
