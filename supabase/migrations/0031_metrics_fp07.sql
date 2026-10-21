-- Migration 0031_metrics_fp07
-- FP-07 Step 1: the metric-variable plane, the guarded nightly trigger, and the three
-- metric config keys. No table and no column changes: `metrics` and `metric_points` have
-- stood since 0007 with everything FP-07 needs.
--
-- (a) `metric_vars_daily` computes seven of the eight §7.9 variables in SQL. The eighth,
--     `checkin_compliance_rate`, deliberately stays in TypeScript (`_shared/metrics/runEval.ts`)
--     because it must use the frozen server grid (`_shared/checkin/windows.ts` +
--     `loadGrid.ts`); a SQL twin would be a third grid implementation and drift is a stop
--     condition (FP-04 NFR-7). The view is `security_invoker` and granted to `service_role`
--     only — the evaluator is its sole reader.
--
-- (b) The guarded insert only *inserts job rows*, exactly like 0027's watchdog tick. The
--     1-minute dispatcher remains the sole claimer. A user qualifies when the local clock is
--     inside [00:30, 00:45), they hold at least one active validated metric, and no
--     `metric_eval` job exists for that (user, day) in ANY status — the watchdog's
--     one-job-row-per-target-ever pattern. `computed_for` is the local day that just ended.
--     The payload carries ids and a date only: `{user_id, computed_for}`.
--
-- (c) Three [SPEC] seeds (TECH-SPEC §11), written as proper jsonb (the 0014 lesson).
--
-- Refs: FP-07 FR-1, FR-7, FR-8; TECH-SPEC §7.9, §3.4, §11, §2.3; decisions2 D9 /
--       TECH-SPEC D10, D12; AGENTS.md §2, §3.2, §4.1.

-- ---------------------------------------------------------------------------- (a) the view
create or replace view public.metric_vars_daily
with (security_invoker = true)
as
with profile_grid as (
  select p.id as user_id,
         coalesce(p.timezone, 'UTC') as timezone,
         p.checkin_cadence_minutes
    from public.profiles p
    join pg_timezone_names tz on tz.name = coalesce(p.timezone, 'UTC')
),
doings as (
  select d.user_id,
         (d.logged_at at time zone g.timezone)::date as day,
         count(*) filter (where d.kind = 'doing') as doings_count,
         count(distinct d.checkin_window)
           filter (where d.kind = 'doing' and d.checkin_window is not null) as windows_answered,
         avg(d.energy) filter (where d.energy is not null) as energy_avg,
         count(*) filter (where d.kind = 'impulse_failure') as impulse_failures
    from public.doings_logs d
    join profile_grid g on g.user_id = d.user_id
   group by d.user_id, (d.logged_at at time zone g.timezone)::date
),
journal as (
  select j.user_id,
         j.entry_date as day,
         count(*) filter (where j.severity = 'S3') as journal_positive_mentions,
         count(*) filter (where j.severity in ('S1', 'S2')) as journal_negative_mentions
    from public.journal_entries j
   group by j.user_id, j.entry_date
),
quest as (
  select m.user_id,
         m.quest_deadline as day,
         count(*) as quest_completions
    from public.metrics m
   where m.is_quest
     and m.quest_status = 'completed'
     and m.quest_deadline is not null
   group by m.user_id, m.quest_deadline
),
days as (
  select user_id, day from doings
  union
  select user_id, day from journal
  union
  select user_id, day from quest
)
select days.user_id,
       days.day,
       coalesce(d.doings_count, 0)::numeric as doings_count,
       (coalesce(d.windows_answered, 0)::numeric
         * g.checkin_cadence_minutes / 60.0) as hours_logged,
       d.energy_avg,
       coalesce(d.impulse_failures, 0)::numeric as impulse_failures,
       coalesce(j.journal_positive_mentions, 0)::numeric as journal_positive_mentions,
       coalesce(j.journal_negative_mentions, 0)::numeric as journal_negative_mentions,
       coalesce(q.quest_completions, 0)::numeric as quest_completions
  from days
  join profile_grid g on g.user_id = days.user_id
  left join doings d on d.user_id = days.user_id and d.day = days.day
  left join journal j on j.user_id = days.user_id and j.day = days.day
  left join quest q on q.user_id = days.user_id and q.day = days.day;

-- The handler is the sole reader. `security_invoker` is defense-in-depth: if a future grant
-- accidentally reaches `authenticated`, the view still evaluates the caller's RLS.
revoke all on public.metric_vars_daily from public, anon, authenticated;
grant select on public.metric_vars_daily to service_role;

-- ---------------------------------------------------------------------------- (b) guarded tick
create or replace function public.enqueue_metric_eval_jobs(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled jsonb;
  v_count integer := 0;
begin
  select value into v_enabled from public.config where key = 'metric_eval_enabled';
  -- Fail-closed: only a literal JSON true enables the loop.
  if v_enabled is distinct from 'true'::jsonb then
    return 0;
  end if;

  with candidates as (
    select p.id as user_id,
           ((p_now at time zone coalesce(p.timezone, 'UTC'))::date - 1) as computed_for
      from public.profiles p
      join pg_timezone_names tz on tz.name = coalesce(p.timezone, 'UTC')
     where (p_now at time zone coalesce(p.timezone, 'UTC'))::time >= time '00:30'
       and (p_now at time zone coalesce(p.timezone, 'UTC'))::time < time '00:45'
       and exists (
         select 1
           from public.metrics m
          where m.user_id = p.id
            and m.formula_status = 'validated'
            and m.archived_at is null
       )
  )
  insert into public.jobs (type, payload)
  select 'metric_eval',
         jsonb_build_object('user_id', c.user_id, 'computed_for', c.computed_for)
    from candidates c
   where not exists (
     select 1
       from public.jobs j
      where j.type = 'metric_eval'
        and j.payload ->> 'user_id' = c.user_id::text
        and j.payload ->> 'computed_for' = c.computed_for::text
   );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.enqueue_metric_eval_jobs(timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_metric_eval_jobs(timestamptz)
  to service_role;

-- Re-schedulable: a re-apply replaces the schedule instead of failing on the name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'metric-eval-daily') then
    perform cron.unschedule('metric-eval-daily');
  end if;
end
$$;

select cron.schedule(
  'metric-eval-daily',
  '*/15 * * * *',
  $$ select public.enqueue_metric_eval_jobs(); $$
);

-- ---------------------------------------------------------------------------- (c) config seeds
insert into config (key, value, description) values
  ('metric_formula_bounds',
   '{"max_depth":6,"max_nodes":30,"literal_abs_max":1000}',
   '§7.9 formula gate: JSONLogic tree depth, node count, and numeric-literal bound'),
  ('metric_eval_enabled',
   'true',
   '§7.9 metric evaluation kill switch: the cron insert and the handler both no-op when false'),
  ('metric_history_days',
   '30',
   '§7.9 dashboard lookback: trailing days of metric_points the client reads')
on conflict (key) do nothing;

-- config is client-readable only by signed-in users; never expose it anonymously.
grant select on config to authenticated;
revoke select on config from anon;

-- Verify (SQL editor):
--   select * from cron.job where jobname = 'metric-eval-daily';
--     -> metric-eval-daily | */15 * * * * | t
--   select key, value, jsonb_typeof(value) from config
--    where key like 'metric_%' order by key;
--     -> metric_eval_enabled | true | boolean
--        metric_formula_bounds | {...} | object
--        metric_history_days | 30 | number
--   select relrowsecurity, reloptions from pg_class where relname = 'metric_vars_daily';
--     -> t | {security_invoker=true}
--   select has_table_privilege('authenticated', 'public.metric_vars_daily', 'select');
--     -> false
--   select public.enqueue_metric_eval_jobs('2026-10-21T00:31:00+05:30'::timestamptz);
--     -> 0 or 1 depending on users/metrics/jobs
