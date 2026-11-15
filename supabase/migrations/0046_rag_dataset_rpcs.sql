-- Migration 0046_rag_dataset_rpcs
-- RAG redesign Phase 1 (PLAN.md §6.1, §6.4, §9.1, §9.2, §10, §13; owner decisions D1-D5).
--
-- Ten dataset functions. Together with 0044 (7) and 0045 (1) this completes the 18 P1 functions.
--
-- SHARED RETURN SHAPE (D1). One typed table per dataset, a common prefix plus only that dataset's
-- dimension/payload columns:
--
--   bucket_start date, n bigint, value numeric, id uuid, occurred_at timestamptz,
--   total_count bigint, dimension text, key text
--
-- `bucket_start` is the timeseries bucket (null outside timeseries, except daily_vars whose grain
-- IS a day and which therefore also carries local_day). `n` is the row/group count, `value` the
-- canonical single aggregate, `id`/`occurred_at` the record identity for list/latest,
-- `total_count` = count(*) over () before LIMIT (the envelope's row_count), and `dimension`/`key`
-- the facet label for aggregate rows. TypeScript strips the nulls; a dataset that does not use a
-- column leaves it null rather than growing a second return type.
--
-- NO METRIC SELECTOR, ON PURPOSE. The approved signatures in PLAN.md §6.4 have no `p_metric`
-- argument, so `aggregate` returns every metric the dataset's registry row allows, as columns
-- (e.g. `window_count`, `energy_avg`, `energy_sum`, `energy_min`, `energy_max` for checkins). The
-- PRD's model-selected `metrics` array is therefore a *read* selection made by the P2 executor
-- over these columns, not a SQL argument. This keeps the allowlist in SQL and the choice in one
-- place. Recorded as decision D6 in the P1 report.
--
-- AGGREGATE GROUPING. `p_dimensions` is a facet list, exactly like `summarize_memory_facts`
-- (§6.3): one row per requested dimension and value, never a cross-tab. An empty or null list
-- produces one overall row. This is the only generic shape a fixed RETURNS TABLE can carry.
--
-- EVERY function: SECURITY DEFINER, `search_path = ''`, ownership predicate `x.user_id = v_uid`,
-- REVOKE from PUBLIC/anon/authenticated/service_role then GRANT to `authenticated` only, no
-- projection/column/table/predicate/tz argument, and every rejection is 22023. `metric_series`
-- joins `public.metrics` because `metric_points` has no user_id (PRD §6.1 line 602).
--
-- Date basis, per dataset, and why it is not uniform:
--   * checkins/impulse_events/conversation/daily_vars: profile-local day from a timestamptz.
--   * habits.detected_at, metrics.created_at: profile-local day, only when that filter is given
--     (so the dataset stays reachable with an unusable zone, §9.1).
--   * journal_entries.entry_date, anchor_plans.plan_date, quests.quest_deadline,
--     metric_points.computed_for: already local dates - never shifted (PRD line 607), and never
--     timezone-dependent.
--   * The future clamp from §6.2 is applied only where the date is derived from a timestamp. A
--     deadline range or a plan-date range must be allowed to point forward.
--
-- Refs: PLAN.md §6.1, §6.4, §9.1, §9.2, §13; RAG PRD §6.1 lines 455-610; AGENTS.md §4.1, §4.7.

-- ============================================================ 1. checkins

create or replace function public.query_checkins(
  p_op text,
  p_from date,
  p_to date,
  p_sources text[] default null,
  p_energy_min integer default null,
  p_energy_max integer default null,
  p_has_window boolean default null,
  p_dimensions text[] default null,
  p_bucket text default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  content text,
  source text,
  energy integer,
  checkin_window timestamptz,
  window_count bigint,
  energy_avg numeric,
  energy_sum numeric,
  energy_min numeric,
  energy_max numeric
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_tz     text;
  v_dims   text[];
  v_bucket text;
  v_limit  integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('list', 'count', 'aggregate', 'timeseries', 'latest') then
    raise exception 'unsupported_operation' using errcode = '22023';
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

  if p_sources is not null
     and not (p_sources <@ array['checkin_reply', 'chat', 'app', 'quick_action']::text[]) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if p_energy_min is not null and (p_energy_min < 1 or p_energy_min > 10) then
    raise exception 'energy_out_of_range' using errcode = '22023';
  end if;
  if p_energy_max is not null and (p_energy_max < 1 or p_energy_max > 10) then
    raise exception 'energy_out_of_range' using errcode = '22023';
  end if;
  if p_energy_min is not null and p_energy_max is not null and p_energy_min > p_energy_max then
    raise exception 'energy_range_inverted' using errcode = '22023';
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'week', 'weekday', 'hour_of_day', 'source']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_bucket is not null and p_bucket not in ('day', 'week') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if p_op <> 'timeseries' and p_bucket is not null then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  v_bucket := coalesce(p_bucket, 'day');

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;
  -- PRD line 491 / decision D2: content is capped at 20 rows, so list and latest CLAMP to 20
  -- rather than reject. A caller asking for 200 gets 20 rows; the envelope reports completeness.
  v_limit := case when p_op in ('list', 'latest') then least(p_limit, 20) else p_limit end;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, d.id, d.logged_at,
           count(*) over (),
           null::text, null::text,
           left(d.content, 280), d.source, d.energy, d.checkin_window,
           null::bigint, null::numeric, null::numeric, null::numeric, null::numeric
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'doing'
      and (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources))
      and (p_energy_min is null or d.energy >= p_energy_min)
      and (p_energy_max is null or d.energy <= p_energy_max)
      and (p_has_window is null or (d.checkin_window is not null) = p_has_window)
    order by d.logged_at desc, d.id
    limit v_limit;
    return;
  end if;

  if p_op = 'latest' then
    return query
    select null::date, null::bigint, null::numeric, d.id, d.logged_at,
           count(*) over (),
           null::text, null::text,
           null::text, d.source, d.energy, d.checkin_window,
           null::bigint, null::numeric, null::numeric, null::numeric, null::numeric
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'doing'
      and (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources))
      and (p_energy_min is null or d.energy >= p_energy_min)
      and (p_energy_max is null or d.energy <= p_energy_max)
      and (p_has_window is null or (d.checkin_window is not null) = p_has_window)
    order by d.logged_at desc, d.id
    limit v_limit;
    return;
  end if;

  if p_op = 'count' then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text, null::integer, null::timestamptz,
           null::bigint, null::numeric, null::numeric, null::numeric, null::numeric
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'doing'
      and (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources))
      and (p_energy_min is null or d.energy >= p_energy_min)
      and (p_energy_max is null or d.energy <= p_energy_max)
      and (p_has_window is null or (d.checkin_window is not null) = p_has_window);
    return;
  end if;

  if p_op = 'timeseries' then
    return query
    select t.bucket_start, t.n, t.energy_avg, null::uuid, null::timestamptz,
           count(*) over (),
           null::text, null::text, null::text, null::text, null::integer, null::timestamptz,
           t.window_count, t.energy_avg, t.energy_sum, t.energy_min, t.energy_max
    from (
      select date_trunc(v_bucket, (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date::timestamp)::date as bucket_start,
             count(*) as n,
             count(distinct d.checkin_window) as window_count,
             avg(d.energy) as energy_avg,
             sum(d.energy)::numeric as energy_sum,
             min(d.energy)::numeric as energy_min,
             max(d.energy)::numeric as energy_max
      from public.doings_logs d
      where d.user_id = v_uid
        and d.kind = 'doing'
        and (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date between p_from and p_to
        and (p_sources is null or d.source = any (p_sources))
        and (p_energy_min is null or d.energy >= p_energy_min)
        and (p_energy_max is null or d.energy <= p_energy_max)
        and (p_has_window is null or (d.checkin_window is not null) = p_has_window)
      group by 1
    ) t
    order by t.bucket_start;
    return;
  end if;

  -- aggregate
  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), avg(d.energy), null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text, null::integer, null::timestamptz,
           count(distinct d.checkin_window), avg(d.energy), sum(d.energy)::numeric,
           min(d.energy)::numeric, max(d.energy)::numeric
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'doing'
      and (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources))
      and (p_energy_min is null or d.energy >= p_energy_min)
      and (p_energy_max is null or d.energy <= p_energy_max)
      and (p_has_window is null or (d.checkin_window is not null) = p_has_window);
    return;
  end if;

  return query
  select null::date, count(*), avg(d.energy), null::uuid, null::timestamptz,
         count(*) over (),
         g.dim, g.key, null::text, null::text, null::integer, null::timestamptz,
         count(distinct d.checkin_window), avg(d.energy), sum(d.energy)::numeric,
         min(d.energy)::numeric, max(d.energy)::numeric
  from public.doings_logs d
  cross join lateral (
    values
      ('day', ((coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date)::text),
      ('week', (date_trunc('week', (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date::timestamp)::date)::text),
      ('weekday', (extract(isodow from (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date)::integer)::text),
      ('hour_of_day', (extract(hour from (coalesce(d.checkin_window, d.logged_at) at time zone v_tz))::integer)::text),
      ('source', d.source)
  ) as g(dim, key)
  where d.user_id = v_uid
    and d.kind = 'doing'
    and (coalesce(d.checkin_window, d.logged_at) at time zone v_tz)::date between p_from and p_to
    and (p_sources is null or d.source = any (p_sources))
    and (p_energy_min is null or d.energy >= p_energy_min)
    and (p_energy_max is null or d.energy <= p_energy_max)
    and (p_has_window is null or (d.checkin_window is not null) = p_has_window)
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_checkins(text, date, date, text[], integer, integer, boolean, text[], text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_checkins(text, date, date, text[], integer, integer, boolean, text[], text, integer)
  to authenticated;

-- ============================================================ 2. impulse_events

create or replace function public.query_impulse_events(
  p_op text,
  p_from date,
  p_to date,
  p_sources text[] default null,
  p_dimensions text[] default null,
  p_bucket text default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  source text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_tz     text;
  v_dims   text[];
  v_bucket text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('count', 'aggregate', 'timeseries', 'list') then
    raise exception 'unsupported_operation' using errcode = '22023';
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

  if p_sources is not null
     and not (p_sources <@ array['checkin_reply', 'chat', 'app', 'quick_action']::text[]) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'week', 'weekday', 'hour_of_day', 'source']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_bucket is not null and p_bucket not in ('day', 'week') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if p_op <> 'timeseries' and p_bucket is not null then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  v_bucket := coalesce(p_bucket, 'day');

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, d.id, d.logged_at,
           count(*) over (), null::text, null::text, d.source
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'impulse_failure'
      and (d.logged_at at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources))
    order by d.logged_at desc, d.id
    limit p_limit;
    return;
  end if;

  if p_op = 'count' then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'impulse_failure'
      and (d.logged_at at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources));
    return;
  end if;

  if p_op = 'timeseries' then
    return query
    select t.bucket_start, t.n, null::numeric, null::uuid, null::timestamptz,
           count(*) over (), null::text, null::text, null::text
    from (
      select date_trunc(v_bucket, (d.logged_at at time zone v_tz)::date::timestamp)::date as bucket_start,
             count(*) as n
      from public.doings_logs d
      where d.user_id = v_uid
        and d.kind = 'impulse_failure'
        and (d.logged_at at time zone v_tz)::date between p_from and p_to
        and (p_sources is null or d.source = any (p_sources))
      group by 1
    ) t
    order by t.bucket_start;
    return;
  end if;

  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text
    from public.doings_logs d
    where d.user_id = v_uid
      and d.kind = 'impulse_failure'
      and (d.logged_at at time zone v_tz)::date between p_from and p_to
      and (p_sources is null or d.source = any (p_sources));
    return;
  end if;

  return query
  select null::date, count(*), null::numeric, null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key, null::text
  from public.doings_logs d
  cross join lateral (
    values
      ('day', ((d.logged_at at time zone v_tz)::date)::text),
      ('week', (date_trunc('week', (d.logged_at at time zone v_tz)::date::timestamp)::date)::text),
      ('weekday', (extract(isodow from (d.logged_at at time zone v_tz)::date)::integer)::text),
      ('hour_of_day', (extract(hour from (d.logged_at at time zone v_tz))::integer)::text),
      ('source', d.source)
  ) as g(dim, key)
  where d.user_id = v_uid
    and d.kind = 'impulse_failure'
    and (d.logged_at at time zone v_tz)::date between p_from and p_to
    and (p_sources is null or d.source = any (p_sources))
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_impulse_events(text, date, date, text[], text[], text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_impulse_events(text, date, date, text[], text[], text, integer)
  to authenticated;

-- ============================================================ 3. anchor_plans

create or replace function public.query_anchor_plans(
  p_op text,
  p_from date,
  p_to date,
  p_dimensions text[] default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  plan_date date,
  anchors jsonb,
  plan_count bigint,
  anchor_count bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_dims text[];
  v_limit integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('list', 'aggregate', 'latest') then
    raise exception 'unsupported_operation' using errcode = '22023';
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

  -- plan_date is already a local date: no timezone, no future clamp.
  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'kind']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;
  -- latest is capped at 20 (PRD §6.1): clamp rather than reject.
  v_limit := case when p_op = 'latest' then least(p_limit, 20) else p_limit end;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op in ('list', 'latest') then
    return query
    select null::date, null::bigint, null::numeric, p.id, null::timestamptz,
           count(*) over (), null::text, null::text,
           p.plan_date,
           case when jsonb_typeof(p.anchors) = 'array' then
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'start', a.value->'start',
                        'end',   a.value->'end',
                        'title', a.value->>'label',
                        'kind',  a.value->>'kind') order by a.ord)
               from jsonb_array_elements(p.anchors) with ordinality as a(value, ord)
             ), '[]'::jsonb)
           else '[]'::jsonb end,
           null::bigint, null::bigint
    from public.anchor_plans p
    where p.user_id = v_uid
      and p.plan_date between p_from and p_to
    order by p.plan_date desc, p.id
    limit v_limit;
    return;
  end if;

  -- aggregate: one overall row, or one facet row per requested dimension value.
  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::date, null::jsonb,
           count(*), coalesce(sum(case when jsonb_typeof(p.anchors) = 'array'
                                       then jsonb_array_length(p.anchors) else 0 end), 0)::bigint
    from public.anchor_plans p
    where p.user_id = v_uid
      and p.plan_date between p_from and p_to;
    return;
  end if;

  if 'day' = any (v_dims) then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz,
           count(*) over (), 'day'::text, p.plan_date::text, null::date, null::jsonb,
           count(*), coalesce(sum(case when jsonb_typeof(p.anchors) = 'array'
                                       then jsonb_array_length(p.anchors) else 0 end), 0)::bigint
    from public.anchor_plans p
    where p.user_id = v_uid
      and p.plan_date between p_from and p_to
    group by p.plan_date
    order by p.plan_date;
  end if;

  if 'kind' = any (v_dims) then
    return query
    select null::date, count(distinct p.id), null::numeric, null::uuid, null::timestamptz,
           count(*) over (), 'kind'::text, a.value->>'kind', null::date, null::jsonb,
           count(distinct p.id), count(*)
    from public.anchor_plans p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.anchors) = 'array' then p.anchors else '[]'::jsonb end
    ) as a(value)
    where p.user_id = v_uid
      and p.plan_date between p_from and p_to
    group by a.value->>'kind'
    order by a.value->>'kind';
  end if;
end;
$$;

revoke all on function public.query_anchor_plans(text, date, date, text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_anchor_plans(text, date, date, text[], integer)
  to authenticated;

-- ============================================================ 4. habits

create or replace function public.query_habits(
  p_op text,
  p_status text[] default null,
  p_detected_from date default null,
  p_detected_to date default null,
  p_watch_from date default null,
  p_watch_to date default null,
  p_dimensions text[] default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  status text,
  description text,
  detected_at timestamptz,
  watch_started_at date,
  strike_at date,
  watch_days integer
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

  if p_op is null or p_op not in ('list', 'aggregate') then
    raise exception 'unsupported_operation' using errcode = '22023';
  end if;

  if p_status is not null
     and not (p_status <@ array['detected', 'confronted', 'watch', 'struck',
                               'quit_committed', 'cancelled']::text[]) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if (p_detected_from is null) <> (p_detected_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;
  if (p_watch_from is null) <> (p_watch_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['status', 'detected_day']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  -- The zone is needed by the detected_at date filter AND by the detected_day dimension, so it is
  -- fetched for either. Requesting neither keeps habits reachable with an unusable zone (§9.1) -
  -- unlike query_checkins, whose grain is a timestamp and which therefore always needs it.
  if p_detected_from is not null or 'detected_day' = any (v_dims) then
    v_tz := public.current_user_timezone();
  end if;

  if p_detected_from is not null then
    if p_detected_from > p_detected_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_detected_to - p_detected_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
    if p_detected_to > (now() at time zone v_tz)::date then
      raise exception 'date_range_in_future' using errcode = '22023';
    end if;
  end if;
  if p_watch_from is not null then
    if p_watch_from > p_watch_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_watch_to - p_watch_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, h.id, h.detected_at,
           count(*) over (), null::text, null::text,
           h.status, h.description, h.detected_at, h.watch_started_at, h.strike_at, h.watch_days
    from public.habits h
    where h.user_id = v_uid
      and (p_status is null or h.status = any (p_status))
      and (p_detected_from is null
           or (h.detected_at at time zone v_tz)::date between p_detected_from and p_detected_to)
      and (p_watch_from is null
           or h.watch_started_at between p_watch_from and p_watch_to)
    order by h.detected_at desc nulls last, h.id
    limit p_limit;
    return;
  end if;

  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text, null::timestamptz, null::date,
           null::date, null::integer
    from public.habits h
    where h.user_id = v_uid
      and (p_status is null or h.status = any (p_status))
      and (p_detected_from is null
           or (h.detected_at at time zone v_tz)::date between p_detected_from and p_detected_to)
      and (p_watch_from is null
           or h.watch_started_at between p_watch_from and p_watch_to);
    return;
  end if;

  return query
  select null::date, count(*), null::numeric, null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key,
         null::text, null::text, null::timestamptz, null::date, null::date, null::integer
  from public.habits h
  cross join lateral (
    values
      ('status', h.status),
      ('detected_day', case when h.detected_at is null then null
                            else ((h.detected_at at time zone v_tz)::date)::text end)
  ) as g(dim, key)
  where h.user_id = v_uid
    and (p_status is null or h.status = any (p_status))
    and (p_detected_from is null
         or (h.detected_at at time zone v_tz)::date between p_detected_from and p_detected_to)
    and (p_watch_from is null
         or h.watch_started_at between p_watch_from and p_watch_to)
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_habits(text, text[], date, date, date, date, text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_habits(text, text[], date, date, date, date, text[], integer)
  to authenticated;

-- ============================================================ 5. metrics_catalog

create or replace function public.query_metrics_catalog(
  p_op text,
  p_domain text[] default null,
  p_formula_status text[] default null,
  p_is_quest boolean default null,
  p_quest_status text[] default null,
  p_archived_mode text default 'exclude',
  p_created_from date default null,
  p_created_to date default null,
  p_dimensions text[] default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  name text,
  domain text,
  output_unit text,
  is_quest boolean,
  quest_status text,
  quest_deadline date,
  formula_status text,
  archived_at timestamptz,
  created_at timestamptz
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

  if p_op is null or p_op not in ('list', 'aggregate') then
    raise exception 'unsupported_operation' using errcode = '22023';
  end if;

  -- D4: metrics.domain has no CHECK and the 16-domain enum exists nowhere in the repository, so
  -- p_domain is an opaque equality filter (an unknown value returns zero rows, never an error).
  if p_formula_status is not null
     and not (p_formula_status <@ array['proposed', 'validated', 'rejected']::text[]) then
    raise exception 'invalid_formula_status' using errcode = '22023';
  end if;
  if p_quest_status is not null
     and not (p_quest_status <@ array['active', 'completed', 'expired', 'failed']::text[]) then
    raise exception 'invalid_quest_status' using errcode = '22023';
  end if;
  if p_archived_mode is null or p_archived_mode not in ('exclude', 'include', 'only') then
    raise exception 'invalid_archived_mode' using errcode = '22023';
  end if;

  if (p_created_from is null) <> (p_created_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;
  if p_created_from is not null then
    if p_created_from > p_created_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_created_to - p_created_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
    v_tz := public.current_user_timezone();
    if p_created_to > (now() at time zone v_tz)::date then
      raise exception 'date_range_in_future' using errcode = '22023';
    end if;
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['domain', 'formula_status', 'is_quest', 'quest_status']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, m.id, m.created_at,
           count(*) over (), null::text, null::text,
           m.name, m.domain, m.output_unit, m.is_quest, m.quest_status, m.quest_deadline,
           m.formula_status, m.archived_at, m.created_at
    from public.metrics m
    where m.user_id = v_uid
      and (p_domain is null or m.domain = any (p_domain))
      and (p_formula_status is null or m.formula_status = any (p_formula_status))
      and (p_is_quest is null or m.is_quest = p_is_quest)
      and (p_quest_status is null or m.quest_status = any (p_quest_status))
      and (case p_archived_mode
             when 'exclude' then m.archived_at is null
             when 'only' then m.archived_at is not null
             else true
           end)
      and (p_created_from is null
           or (m.created_at at time zone v_tz)::date between p_created_from and p_created_to)
    order by m.created_at desc nulls last, m.id
    limit p_limit;
    return;
  end if;

  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text, null::text, null::boolean,
           null::text, null::date, null::text, null::timestamptz, null::timestamptz
    from public.metrics m
    where m.user_id = v_uid
      and (p_domain is null or m.domain = any (p_domain))
      and (p_formula_status is null or m.formula_status = any (p_formula_status))
      and (p_is_quest is null or m.is_quest = p_is_quest)
      and (p_quest_status is null or m.quest_status = any (p_quest_status))
      and (case p_archived_mode
             when 'exclude' then m.archived_at is null
             when 'only' then m.archived_at is not null
             else true
           end)
      and (p_created_from is null
           or (m.created_at at time zone v_tz)::date between p_created_from and p_created_to);
    return;
  end if;

  return query
  select null::date, count(*), null::numeric, null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key,
         null::text, null::text, null::text, null::boolean, null::text, null::date,
         null::text, null::timestamptz, null::timestamptz
  from public.metrics m
  cross join lateral (
    values
      ('domain', m.domain),
      ('formula_status', m.formula_status),
      ('is_quest', m.is_quest::text),
      ('quest_status', m.quest_status)
  ) as g(dim, key)
  where m.user_id = v_uid
    and (p_domain is null or m.domain = any (p_domain))
    and (p_formula_status is null or m.formula_status = any (p_formula_status))
    and (p_is_quest is null or m.is_quest = p_is_quest)
    and (p_quest_status is null or m.quest_status = any (p_quest_status))
    and (case p_archived_mode
           when 'exclude' then m.archived_at is null
           when 'only' then m.archived_at is not null
           else true
         end)
    and (p_created_from is null
         or (m.created_at at time zone v_tz)::date between p_created_from and p_created_to)
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_metrics_catalog(text, text[], text[], boolean, text[], text, date, date, text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_metrics_catalog(text, text[], text[], boolean, text[], text, date, date, text[], integer)
  to authenticated;

-- ============================================================ 6. metric_series

create or replace function public.query_metric_series(
  p_op text,
  p_metric_ids uuid[] default null,
  p_metric_names text[] default null,
  p_domain text[] default null,
  p_from date default null,
  p_to date default null,
  p_bucket text default null,
  p_include_archived boolean default false,
  p_dimensions text[] default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  metric_id uuid,
  metric_name text,
  domain text,
  computed_for date,
  value_latest numeric,
  value_avg numeric,
  value_sum numeric,
  value_min numeric,
  value_max numeric,
  point_count bigint,
  value_delta numeric
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_dims   text[];
  v_bucket text;
  v_cap    integer;
  v_limit  integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('list', 'timeseries', 'latest', 'aggregate') then
    raise exception 'unsupported_operation' using errcode = '22023';
  end if;

  -- At least one selector is required: an unscoped metric read is a full scan of every metric the
  -- user owns, which the registry forbids.
  if p_metric_ids is null and p_metric_names is null and p_domain is null then
    raise exception 'metric_selector_required' using errcode = '22023';
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

  if p_bucket is not null and p_bucket not in ('day', 'week', 'month') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if p_op <> 'timeseries' and p_bucket is not null then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  v_bucket := coalesce(p_bucket, 'day');
  v_cap := case v_bucket when 'day' then 60 when 'week' then 53 else 12 end;

  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'week', 'metric_id', 'domain']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;
  -- latest is capped at 20 (PRD §6.1): clamp rather than reject.
  v_limit := case when p_op = 'latest' then least(p_limit, 20) else p_limit end;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op in ('list', 'latest') then
    return query
    select null::date, null::bigint, mp.value, mp.id, null::timestamptz,
           count(*) over (), null::text, null::text,
           mp.metric_id, m.name, m.domain, mp.computed_for,
           mp.value, mp.value, mp.value, mp.value, mp.value, 1::bigint, null::numeric
    from public.metric_points mp
    join public.metrics m on m.id = mp.metric_id and m.user_id = v_uid
    where (p_metric_ids is null or mp.metric_id = any (p_metric_ids))
      and (p_metric_names is null or m.name = any (p_metric_names))
      and (p_domain is null or m.domain = any (p_domain))
      and (p_from is null or mp.computed_for between p_from and p_to)
      and (p_include_archived or m.archived_at is null)
    order by mp.computed_for desc, mp.metric_id, mp.id
    limit v_limit;
    return;
  end if;

  if p_op = 'timeseries' then
    return query
    with buckets as (
      select mp.metric_id, m.name as metric_name, m.domain,
             date_trunc(v_bucket, mp.computed_for::timestamp)::date as bucket_start,
             count(*) as point_count,
             avg(mp.value) as value_avg,
             sum(mp.value) as value_sum,
             min(mp.value) as value_min,
             max(mp.value) as value_max,
             (array_agg(mp.value order by mp.computed_for desc))[1] as value_latest,
             (array_agg(mp.value order by mp.computed_for desc))[1]
               - (array_agg(mp.value order by mp.computed_for desc))[2] as value_delta
      from public.metric_points mp
      join public.metrics m on m.id = mp.metric_id and m.user_id = v_uid
      where (p_metric_ids is null or mp.metric_id = any (p_metric_ids))
        and (p_metric_names is null or m.name = any (p_metric_names))
        and (p_domain is null or m.domain = any (p_domain))
        and (p_from is null or mp.computed_for between p_from and p_to)
        and (p_include_archived or m.archived_at is null)
      group by mp.metric_id, m.name, m.domain, 4
    ),
    capped as (
      select b.*,
             row_number() over (partition by b.metric_id order by b.bucket_start desc) as rn
      from buckets b
    )
    select c.bucket_start, c.point_count, c.value_avg, null::uuid, null::timestamptz,
           count(*) over (), 'metric_id'::text, c.metric_name,
           c.metric_id, c.metric_name, c.domain, null::date,
           c.value_latest, c.value_avg, c.value_sum, c.value_min, c.value_max,
           c.point_count, c.value_delta
    from capped c
    where c.rn <= v_cap
    order by c.metric_id, c.bucket_start;
    return;
  end if;

  -- aggregate: always per metric; the facet list adds a breakdown inside each metric.
  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), avg(mp.value), null::uuid, null::timestamptz,
           count(*) over (), null::text, m.name,
           mp.metric_id, m.name, m.domain, null::date,
           (array_agg(mp.value order by mp.computed_for desc))[1],
           avg(mp.value),
           sum(mp.value),
           min(mp.value),
           max(mp.value),
           count(*),
           (array_agg(mp.value order by mp.computed_for desc))[1]
             - (array_agg(mp.value order by mp.computed_for desc))[2]
    from public.metric_points mp
    join public.metrics m on m.id = mp.metric_id and m.user_id = v_uid
    where (p_metric_ids is null or mp.metric_id = any (p_metric_ids))
      and (p_metric_names is null or m.name = any (p_metric_names))
      and (p_domain is null or m.domain = any (p_domain))
      and (p_from is null or mp.computed_for between p_from and p_to)
      and (p_include_archived or m.archived_at is null)
    group by mp.metric_id, m.name, m.domain
    order by m.name;
    return;
  end if;

  return query
  select null::date, count(*), avg(mp.value), null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key,
         mp.metric_id, m.name, m.domain, null::date,
         (array_agg(mp.value order by mp.computed_for desc))[1],
         avg(mp.value),
         sum(mp.value),
         min(mp.value),
         max(mp.value),
         count(*),
         (array_agg(mp.value order by mp.computed_for desc))[1]
           - (array_agg(mp.value order by mp.computed_for desc))[2]
  from public.metric_points mp
  join public.metrics m on m.id = mp.metric_id and m.user_id = v_uid
  cross join lateral (
    values
      ('day', (mp.computed_for)::text),
      ('week', (date_trunc('week', mp.computed_for::timestamp)::date)::text),
      ('metric_id', m.name),
      ('domain', m.domain)
  ) as g(dim, key)
  where (p_metric_ids is null or mp.metric_id = any (p_metric_ids))
    and (p_metric_names is null or m.name = any (p_metric_names))
    and (p_domain is null or m.domain = any (p_domain))
    and (p_from is null or mp.computed_for between p_from and p_to)
    and (p_include_archived or m.archived_at is null)
    and g.dim = any (v_dims)
  group by mp.metric_id, m.name, m.domain, g.dim, g.key
  order by array_position(v_dims, g.dim), g.key, m.name;
end;
$$;

revoke all on function public.query_metric_series(text, uuid[], text[], text[], date, date, text, boolean, text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_metric_series(text, uuid[], text[], text[], date, date, text, boolean, text[], integer)
  to authenticated;

-- ============================================================ 7. quests

create or replace function public.query_quests(
  p_op text,
  p_quest_status text[] default null,
  p_deadline_from date default null,
  p_deadline_to date default null,
  p_domain text[] default null,
  p_dimensions text[] default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  name text,
  domain text,
  quest_status text,
  quest_deadline date
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_dims text[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('list', 'aggregate') then
    raise exception 'unsupported_operation' using errcode = '22023';
  end if;

  if p_quest_status is not null
     and not (p_quest_status <@ array['active', 'completed', 'expired', 'failed']::text[]) then
    raise exception 'invalid_quest_status' using errcode = '22023';
  end if;

  if (p_deadline_from is null) <> (p_deadline_to is null) then
    raise exception 'date_range_incomplete' using errcode = '22023';
  end if;
  if p_deadline_from is not null then
    if p_deadline_from > p_deadline_to then
      raise exception 'date_range_inverted' using errcode = '22023';
    end if;
    if (p_deadline_to - p_deadline_from) > 366 then
      raise exception 'date_range_too_large' using errcode = '22023';
    end if;
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['quest_status', 'domain', 'deadline_day']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, m.id, null::timestamptz,
           count(*) over (), null::text, null::text,
           m.name, m.domain, m.quest_status, m.quest_deadline
    from public.metrics m
    where m.user_id = v_uid
      and m.is_quest
      and (p_quest_status is null or m.quest_status = any (p_quest_status))
      and (p_domain is null or m.domain = any (p_domain))
      and (p_deadline_from is null or m.quest_deadline between p_deadline_from and p_deadline_to)
    order by m.quest_deadline asc nulls last, m.id
    limit p_limit;
    return;
  end if;

  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text, null::text, null::date
    from public.metrics m
    where m.user_id = v_uid
      and m.is_quest
      and (p_quest_status is null or m.quest_status = any (p_quest_status))
      and (p_domain is null or m.domain = any (p_domain))
      and (p_deadline_from is null or m.quest_deadline between p_deadline_from and p_deadline_to);
    return;
  end if;

  return query
  select null::date, count(*), null::numeric, null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key,
         null::text, null::text, null::text, null::date
  from public.metrics m
  cross join lateral (
    values
      ('quest_status', m.quest_status),
      ('domain', m.domain),
      ('deadline_day', m.quest_deadline::text)
  ) as g(dim, key)
  where m.user_id = v_uid
    and m.is_quest
    and (p_quest_status is null or m.quest_status = any (p_quest_status))
    and (p_domain is null or m.domain = any (p_domain))
    and (p_deadline_from is null or m.quest_deadline between p_deadline_from and p_deadline_to)
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_quests(text, text[], date, date, text[], text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_quests(text, text[], date, date, text[], text[], integer)
  to authenticated;

-- ============================================================ 8. daily_vars

create or replace function public.query_daily_vars(
  p_op text,
  p_from date,
  p_to date,
  p_dimensions text[] default null,
  p_bucket text default null,
  p_limit integer default 366
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  local_day date,
  doings_count bigint,
  energy_avg numeric,
  impulse_failures bigint,
  journal_positive_mentions bigint,
  journal_negative_mentions bigint,
  hours_logged numeric,
  answered_windows bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_tz      text;
  v_dims    text[];
  v_bucket  text;
  v_cadence integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('list', 'timeseries', 'aggregate') then
    raise exception 'unsupported_operation' using errcode = '22023';
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

  select p.checkin_cadence_minutes into v_cadence
  from public.profiles p where p.id = v_uid;
  if v_cadence is null or v_cadence not in (60, 120) then
    raise exception 'grid_unavailable' using errcode = '22023';
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'week', 'weekday']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_bucket is not null and p_bucket not in ('day', 'week') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if p_op <> 'timeseries' and p_bucket is not null then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  v_bucket := coalesce(p_bucket, 'day');

  if p_limit is null or p_limit < 1 or p_limit > 366 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    with days as (
      select generate_series(p_from, p_to, interval '1 day')::date as d
    ),
    doings as (
      select (x.logged_at at time zone v_tz)::date as d,
             count(*) filter (where x.kind = 'doing') as doings_count,
             avg(x.energy) filter (where x.kind = 'doing') as energy_avg,
             count(*) filter (where x.kind = 'impulse_failure') as impulse_failures
      from public.doings_logs x
      where x.user_id = v_uid
        and (x.logged_at at time zone v_tz)::date between p_from and p_to
      group by 1
    ),
    windows as (
      select (x.checkin_window at time zone v_tz)::date as d,
             count(distinct x.checkin_window) as answered_windows
      from public.doings_logs x
      where x.user_id = v_uid
        and x.kind = 'doing'
        and x.checkin_window is not null
        and (x.checkin_window at time zone v_tz)::date between p_from and p_to
      group by 1
    ),
    journal as (
      select j.entry_date as d,
             count(*) filter (where j.severity = 'S3') as pos,
             count(*) filter (where j.severity in ('S1', 'S2')) as neg
      from public.journal_entries j
      where j.user_id = v_uid
        and j.entry_date between p_from and p_to
      group by 1
    )
    select null::date, coalesce(dn.doings_count, 0), dn.energy_avg, null::uuid, null::timestamptz,
           count(*) over (), null::text, null::text,
           g.d,
           coalesce(dn.doings_count, 0),
           dn.energy_avg,
           coalesce(dn.impulse_failures, 0),
           coalesce(j.pos, 0),
           coalesce(j.neg, 0),
           (coalesce(w.answered_windows, 0) * v_cadence / 60.0)::numeric,
           coalesce(w.answered_windows, 0)
    from days g
    left join doings dn on dn.d = g.d
    left join windows w on w.d = g.d
    left join journal j on j.d = g.d
    order by g.d
    limit p_limit;
    return;
  end if;

  if p_op = 'timeseries' then
    return query
    with days as (
      select generate_series(p_from, p_to, interval '1 day')::date as d
    ),
    doings as (
      select (x.logged_at at time zone v_tz)::date as d,
             count(*) filter (where x.kind = 'doing') as doings_count,
             avg(x.energy) filter (where x.kind = 'doing') as energy_avg,
             count(*) filter (where x.kind = 'impulse_failure') as impulse_failures
      from public.doings_logs x
      where x.user_id = v_uid
        and (x.logged_at at time zone v_tz)::date between p_from and p_to
      group by 1
    ),
    windows as (
      select (x.checkin_window at time zone v_tz)::date as d,
             count(distinct x.checkin_window) as answered_windows
      from public.doings_logs x
      where x.user_id = v_uid
        and x.kind = 'doing'
        and x.checkin_window is not null
        and (x.checkin_window at time zone v_tz)::date between p_from and p_to
      group by 1
    ),
    journal as (
      select j.entry_date as d,
             count(*) filter (where j.severity = 'S3') as pos,
             count(*) filter (where j.severity in ('S1', 'S2')) as neg
      from public.journal_entries j
      where j.user_id = v_uid
        and j.entry_date between p_from and p_to
      group by 1
    ),
    filled as (
      select g.d,
             coalesce(dn.doings_count, 0) as doings_count,
             dn.energy_avg,
             coalesce(dn.impulse_failures, 0) as impulse_failures,
             coalesce(j.pos, 0) as journal_positive_mentions,
             coalesce(j.neg, 0) as journal_negative_mentions,
             coalesce(w.answered_windows, 0) as answered_windows
      from days g
      left join doings dn on dn.d = g.d
      left join windows w on w.d = g.d
      left join journal j on j.d = g.d
    )
    select date_trunc(v_bucket, f.d::timestamp)::date, count(*), avg(f.energy_avg),
           null::uuid, null::timestamptz, count(*) over (), null::text, null::text,
           null::date,
           sum(f.doings_count)::bigint, avg(f.energy_avg), sum(f.impulse_failures)::bigint,
           sum(f.journal_positive_mentions)::bigint, sum(f.journal_negative_mentions)::bigint,
           (sum(f.answered_windows) * v_cadence / 60.0)::numeric,
           sum(f.answered_windows)::bigint
    from filled f
    group by 1
    order by 1;
    return;
  end if;

  -- aggregate over the zero-filled day grid
  if cardinality(v_dims) = 0 then
    return query
    with days as (
      select generate_series(p_from, p_to, interval '1 day')::date as d
    ),
    doings as (
      select (x.logged_at at time zone v_tz)::date as d,
             count(*) filter (where x.kind = 'doing') as doings_count,
             avg(x.energy) filter (where x.kind = 'doing') as energy_avg,
             count(*) filter (where x.kind = 'impulse_failure') as impulse_failures
      from public.doings_logs x
      where x.user_id = v_uid
        and (x.logged_at at time zone v_tz)::date between p_from and p_to
      group by 1
    ),
    windows as (
      select (x.checkin_window at time zone v_tz)::date as d,
             count(distinct x.checkin_window) as answered_windows
      from public.doings_logs x
      where x.user_id = v_uid
        and x.kind = 'doing'
        and x.checkin_window is not null
        and (x.checkin_window at time zone v_tz)::date between p_from and p_to
      group by 1
    ),
    journal as (
      select j.entry_date as d,
             count(*) filter (where j.severity = 'S3') as pos,
             count(*) filter (where j.severity in ('S1', 'S2')) as neg
      from public.journal_entries j
      where j.user_id = v_uid
        and j.entry_date between p_from and p_to
      group by 1
    ),
    filled as (
      select g.d,
             coalesce(dn.doings_count, 0) as doings_count,
             dn.energy_avg,
             coalesce(dn.impulse_failures, 0) as impulse_failures,
             coalesce(j.pos, 0) as journal_positive_mentions,
             coalesce(j.neg, 0) as journal_negative_mentions,
             coalesce(w.answered_windows, 0) as answered_windows
      from days g
      left join doings dn on dn.d = g.d
      left join windows w on w.d = g.d
      left join journal j on j.d = g.d
    )
    select null::date, count(*), avg(f.energy_avg), null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::date,
           sum(f.doings_count)::bigint, avg(f.energy_avg), sum(f.impulse_failures)::bigint,
           sum(f.journal_positive_mentions)::bigint, sum(f.journal_negative_mentions)::bigint,
           (sum(f.answered_windows) * v_cadence / 60.0)::numeric,
           sum(f.answered_windows)::bigint
    from filled f;
    return;
  end if;

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  doings as (
    select (x.logged_at at time zone v_tz)::date as d,
           count(*) filter (where x.kind = 'doing') as doings_count,
           avg(x.energy) filter (where x.kind = 'doing') as energy_avg,
           count(*) filter (where x.kind = 'impulse_failure') as impulse_failures
    from public.doings_logs x
    where x.user_id = v_uid
      and (x.logged_at at time zone v_tz)::date between p_from and p_to
    group by 1
  ),
  windows as (
    select (x.checkin_window at time zone v_tz)::date as d,
           count(distinct x.checkin_window) as answered_windows
    from public.doings_logs x
    where x.user_id = v_uid
      and x.kind = 'doing'
      and x.checkin_window is not null
      and (x.checkin_window at time zone v_tz)::date between p_from and p_to
    group by 1
  ),
  journal as (
    select j.entry_date as d,
           count(*) filter (where j.severity = 'S3') as pos,
           count(*) filter (where j.severity in ('S1', 'S2')) as neg
    from public.journal_entries j
    where j.user_id = v_uid
      and j.entry_date between p_from and p_to
    group by 1
  ),
  filled as (
    select g.d,
           coalesce(dn.doings_count, 0) as doings_count,
           dn.energy_avg,
           coalesce(dn.impulse_failures, 0) as impulse_failures,
           coalesce(j.pos, 0) as journal_positive_mentions,
           coalesce(j.neg, 0) as journal_negative_mentions,
           coalesce(w.answered_windows, 0) as answered_windows
    from days g
    left join doings dn on dn.d = g.d
    left join windows w on w.d = g.d
    left join journal j on j.d = g.d
  )
  select null::date, count(*), avg(f.energy_avg), null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key, null::date,
         sum(f.doings_count)::bigint, avg(f.energy_avg), sum(f.impulse_failures)::bigint,
         sum(f.journal_positive_mentions)::bigint, sum(f.journal_negative_mentions)::bigint,
         (sum(f.answered_windows) * v_cadence / 60.0)::numeric,
         sum(f.answered_windows)::bigint
  from filled f
  cross join lateral (
    values
      ('day', (f.d)::text),
      ('week', (date_trunc('week', f.d::timestamp)::date)::text),
      ('weekday', (extract(isodow from f.d)::integer)::text)
  ) as g(dim, key)
  where g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_daily_vars(text, date, date, text[], text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_daily_vars(text, date, date, text[], text, integer)
  to authenticated;

-- ============================================================ 9. conversation

create or replace function public.query_conversation(
  p_op text,
  p_from date,
  p_to date,
  p_role text[] default null,
  p_sources text[] default null,
  p_dimensions text[] default null,
  p_bucket text default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  role text,
  source text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_tz     text;
  v_dims   text[];
  v_bucket text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('count', 'aggregate', 'timeseries', 'list') then
    raise exception 'unsupported_operation' using errcode = '22023';
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

  if p_role is not null
     and not (p_role <@ array['user', 'assistant']::text[]) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  -- D4: messages.metadata->>'source' has no CHECK, so p_sources is an opaque equality filter.
  -- The registry allowlist is enforced by the P2 executor, which owns the list of real writers.

  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'hour_of_day', 'role', 'source']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_bucket is not null and p_bucket not in ('day', 'week') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if p_op <> 'timeseries' and p_bucket is not null then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  v_bucket := coalesce(p_bucket, 'day');

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, m.id, m.created_at,
           count(*) over (), null::text, null::text,
           m.role, m.metadata->>'source'
    from public.messages m
    where m.user_id = v_uid
      and m.unsavable = false
      and (m.created_at at time zone v_tz)::date between p_from and p_to
      and (p_role is null or m.role = any (p_role))
      and (p_sources is null or (m.metadata->>'source') = any (p_sources))
    order by m.created_at desc, m.id
    limit p_limit;
    return;
  end if;

  if p_op = 'count' then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text
    from public.messages m
    where m.user_id = v_uid
      and m.unsavable = false
      and (m.created_at at time zone v_tz)::date between p_from and p_to
      and (p_role is null or m.role = any (p_role))
      and (p_sources is null or (m.metadata->>'source') = any (p_sources));
    return;
  end if;

  if p_op = 'timeseries' then
    return query
    select t.bucket_start, t.n, null::numeric, null::uuid, null::timestamptz,
           count(*) over (), null::text, null::text, null::text, null::text
    from (
      select date_trunc(v_bucket, (m.created_at at time zone v_tz)::date::timestamp)::date as bucket_start,
             count(*) as n
      from public.messages m
      where m.user_id = v_uid
        and m.unsavable = false
        and (m.created_at at time zone v_tz)::date between p_from and p_to
        and (p_role is null or m.role = any (p_role))
        and (p_sources is null or (m.metadata->>'source') = any (p_sources))
      group by 1
    ) t
    order by t.bucket_start;
    return;
  end if;

  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::text, null::text
    from public.messages m
    where m.user_id = v_uid
      and m.unsavable = false
      and (m.created_at at time zone v_tz)::date between p_from and p_to
      and (p_role is null or m.role = any (p_role))
      and (p_sources is null or (m.metadata->>'source') = any (p_sources));
    return;
  end if;

  return query
  select null::date, count(*), null::numeric, null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key, null::text, null::text
  from public.messages m
  cross join lateral (
    values
      ('day', ((m.created_at at time zone v_tz)::date)::text),
      ('hour_of_day', (extract(hour from (m.created_at at time zone v_tz))::integer)::text),
      ('role', m.role),
      ('source', m.metadata->>'source')
  ) as g(dim, key)
  where m.user_id = v_uid
    and m.unsavable = false
    and (m.created_at at time zone v_tz)::date between p_from and p_to
    and (p_role is null or m.role = any (p_role))
    and (p_sources is null or (m.metadata->>'source') = any (p_sources))
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_conversation(text, date, date, text[], text[], text[], text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_conversation(text, date, date, text[], text[], text[], text, integer)
  to authenticated;

-- ============================================================ 10. journal_entries

create or replace function public.query_journal_entries(
  p_op text,
  p_from date,
  p_to date,
  p_severity text[] default null,
  p_probed boolean default null,
  p_habit_flag boolean default null,
  p_dimensions text[] default null,
  p_bucket text default null,
  p_limit integer default 200
)
returns table (
  bucket_start date,
  n bigint,
  value numeric,
  id uuid,
  occurred_at timestamptz,
  total_count bigint,
  dimension text,
  key text,
  entry_date date,
  severity text,
  probed boolean,
  habit_flag boolean,
  vagueness_score numeric
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_dims   text[];
  v_bucket text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_op is null or p_op not in ('count', 'aggregate', 'timeseries', 'list') then
    raise exception 'unsupported_operation' using errcode = '22023';
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
  -- entry_date is already a local date (PRD line 607): no timezone, no shift, no future clamp.

  if p_severity is not null
     and not (p_severity <@ array['S1', 'S2', 'S3']::text[]) then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;

  if p_dimensions is not null
     and not (p_dimensions <@ array['day', 'week', 'severity', 'habit_flag']::text[]) then
    raise exception 'unsupported_dimension' using errcode = '22023';
  end if;

  if p_bucket is not null and p_bucket not in ('day', 'week') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if p_op <> 'timeseries' and p_bucket is not null then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  v_bucket := coalesce(p_bucket, 'day');

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit_out_of_range' using errcode = '22023';
  end if;

  v_dims := coalesce(nullif(p_dimensions, '{}'::text[]), array[]::text[]);

  if p_op = 'list' then
    return query
    select null::date, null::bigint, null::numeric, j.id, j.created_at,
           count(*) over (), null::text, null::text,
           j.entry_date, j.severity, j.probed, j.habit_flag, j.vagueness_score
    from public.journal_entries j
    where j.user_id = v_uid
      and j.entry_date between p_from and p_to
      and (p_severity is null or j.severity = any (p_severity))
      and (p_probed is null or j.probed = p_probed)
      and (p_habit_flag is null or j.habit_flag = p_habit_flag)
    order by j.entry_date desc, j.id
    limit p_limit;
    return;
  end if;

  if p_op = 'count' then
    return query
    select null::date, count(*), null::numeric, null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::date, null::text, null::boolean, null::boolean,
           null::numeric
    from public.journal_entries j
    where j.user_id = v_uid
      and j.entry_date between p_from and p_to
      and (p_severity is null or j.severity = any (p_severity))
      and (p_probed is null or j.probed = p_probed)
      and (p_habit_flag is null or j.habit_flag = p_habit_flag);
    return;
  end if;

  if p_op = 'timeseries' then
    return query
    select t.bucket_start, t.n, t.vagueness_avg, null::uuid, null::timestamptz,
           count(*) over (), null::text, null::text, null::date, null::text, null::boolean,
           null::boolean, null::numeric
    from (
      select date_trunc(v_bucket, j.entry_date::timestamp)::date as bucket_start,
             count(*) as n,
             avg(j.vagueness_score) as vagueness_avg
      from public.journal_entries j
      where j.user_id = v_uid
        and j.entry_date between p_from and p_to
        and (p_severity is null or j.severity = any (p_severity))
        and (p_probed is null or j.probed = p_probed)
        and (p_habit_flag is null or j.habit_flag = p_habit_flag)
      group by 1
    ) t
    order by t.bucket_start;
    return;
  end if;

  if cardinality(v_dims) = 0 then
    return query
    select null::date, count(*), avg(j.vagueness_score), null::uuid, null::timestamptz, 1::bigint,
           null::text, null::text, null::date, null::text, null::boolean, null::boolean,
           null::numeric
    from public.journal_entries j
    where j.user_id = v_uid
      and j.entry_date between p_from and p_to
      and (p_severity is null or j.severity = any (p_severity))
      and (p_probed is null or j.probed = p_probed)
      and (p_habit_flag is null or j.habit_flag = p_habit_flag);
    return;
  end if;

  return query
  select null::date, count(*), avg(j.vagueness_score), null::uuid, null::timestamptz,
         count(*) over (), g.dim, g.key, null::date, null::text, null::boolean, null::boolean,
         null::numeric
  from public.journal_entries j
  cross join lateral (
    values
      ('day', (j.entry_date)::text),
      ('week', (date_trunc('week', j.entry_date::timestamp)::date)::text),
      ('severity', j.severity),
      ('habit_flag', j.habit_flag::text)
  ) as g(dim, key)
  where j.user_id = v_uid
    and j.entry_date between p_from and p_to
    and (p_severity is null or j.severity = any (p_severity))
    and (p_probed is null or j.probed = p_probed)
    and (p_habit_flag is null or j.habit_flag = p_habit_flag)
    and g.dim = any (v_dims)
  group by g.dim, g.key
  order by array_position(v_dims, g.dim), g.key;
end;
$$;

revoke all on function public.query_journal_entries(text, date, date, text[], boolean, boolean, text[], text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.query_journal_entries(text, date, date, text[], boolean, boolean, text[], text, integer)
  to authenticated;

notify pgrst, 'reload schema';

-- Verify:
--   select p.proname, p.prosecdef, p.proconfig,
--          coalesce(array_to_string(p.proacl, ' | '), '(none)') as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'query\_%'
--    order by 1;
--
--   -- no return type may contain a forbidden column
--   select p.proname, pg_get_function_result(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'query\_%';
