-- Migration 0032_accountability_fp08
-- FP-08 Step 1: one column, two indexes, three functions, two schedules, fifteen seed writes.
-- This is the whole schema surface of the Accountability Chain: everything else it writes
-- (`habits`, `trust_events`, `profiles.trust_score`/`dialog_state`/`lockdown_started_at`,
-- the `metrics` quest columns) has stood since `0007`/`0002`.
--
-- (a) `journal_entries.habit_flag` — the FR-5 contract extension's storage half, written with
--     the extraction re-run marker (`vagueness_score` + `severity`), so a re-run overwrites
--     identically.
-- (b) Two lookup indexes: the live-habit guard (`habits_live_idx`, FR-13) and the streak's
--     daily-dedup lookup (`trust_events_user_reason_idx`, FR-3).
-- (c) `drift_scan_tick()` every 10 min — inserts job rows only, one `drift_scan` per tick, the
--     `0027` tick-guard shape; kill switch `drift_scan_enabled` read fail-closed.
-- (d) `histogram_eval_tick()` every 15 min — the `0031` per-user shape: local clock inside
--     `[01:00, 01:15)`, at least `histogram_bucket_min_count` impulse failures inside the
--     trailing `histogram_window_days`, and no `histogram_daily` job for that
--     `(user_id, computed_for)` in any status.
-- (e) `accept_quest()` — the atomic accept RPC (FR-15): per-user advisory lock, the offer
--     compare-and-set consume, the one-active-quest guard, the validated-metric insert and the
--     `quest_expire` job insert in one all-or-nothing transaction. The consume check precedes
--     the one-active guard so a second tap is the idempotent `duplicate` no-op AC-7 requires,
--     never a spurious conflict; a fresh unconsumed offer still cannot open a second quest.
--     The formula gate itself re-runs in TypeScript (`insertValidatedMetric`) before this
--     transaction opens, so a gate failure consumes nothing by construction.
-- (f) Fifteen seed writes (proper jsonb — the `0014` lesson), each with a description. The
--     `habit_detection_thresholds` row is the one update: FP-08 is its first reader.
--
-- Cost note (§12): the two schedules add 144 + ~5 inserts/day to the ~292 already scheduled —
-- records the recount in §12's write-back.
--
-- Refs: FP-08 FR-1, FR-3, FR-5, FR-12, FR-13, FR-15, FR-16, FR-18, FR-19, FR-21;
--       TECH-SPEC §7.3, §7.5, §7.8, §3.4, §11, §12, §2.2–2.3; D12, D15, D20, D22, D24;
--       AGENTS.md §2, §3.2, §4.1, §6.4.

-- ---------------------------------------------------------------------------- (a) the column
alter table public.journal_entries
  add column if not exists habit_flag boolean not null default false;

-- ---------------------------------------------------------------------------- (b) indexes
create index if not exists habits_live_idx
  on public.habits (user_id)
  where status in ('detected', 'confronted', 'watch');

create index if not exists trust_events_user_reason_idx
  on public.trust_events (user_id, reason, created_at);

-- ---------------------------------------------------------------------------- (c) drift tick
-- The tick inserts job rows only — the 1-minute dispatcher stays the sole claimer, exactly as
-- 0027/0031 established. The guard is the 0027 shape at the 10-minute cadence: while a
-- `drift_scan` row created inside the trailing interval exists, the tick inserts nothing.
-- Correctness does not rest on the guard — the handler is idempotent and the per
-- `(user, pattern, local-day)` intervention dedup absorbs a double-scan — it only keeps the
-- batch budget free. `p_now` is injectable for the truth-table drill.
create or replace function public.drift_scan_tick(
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
  select value into v_enabled from public.config where key = 'drift_scan_enabled';
  -- Fail-closed: only a literal JSON true enables the loop (the metric_eval precedent).
  if v_enabled is distinct from 'true'::jsonb then
    return 0;
  end if;

  if exists (
    select 1
      from public.jobs
     where type = 'drift_scan'
       and created_at > p_now - interval '10 minutes'
  ) then
    return 0;
  end if;

  insert into public.jobs (type, payload) values ('drift_scan', '{}'::jsonb);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.drift_scan_tick(timestamptz)
  from public, anon, authenticated;
grant execute on function public.drift_scan_tick(timestamptz)
  to service_role;

-- Re-schedulable: a re-apply replaces the schedule instead of failing on the name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'drift-scan-every-10m') then
    perform cron.unschedule('drift-scan-every-10m');
  end if;
end
$$;

select cron.schedule(
  'drift-scan-every-10m',
  '*/10 * * * *',
  $$ select public.drift_scan_tick(); $$
);

-- ---------------------------------------------------------------------------- (d) histogram tick
-- The 0031 shape: the tick only qualifies users and inserts job rows. The rebuild itself
-- (bucketing, cold start, the top-2 cap, fire-job self-insertion) is `runHistogram.ts`, driven
-- by the dispatcher and the `drift-drill` for the same reason the watchdog shares one scan.
create or replace function public.histogram_eval_tick(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min jsonb;
  v_window jsonb;
  v_min_count integer;
  v_window_days integer;
  v_count integer := 0;
begin
  select value into v_min from public.config where key = 'histogram_bucket_min_count';
  select value into v_window from public.config where key = 'histogram_window_days';
  -- Fail-closed: a missing or non-numeric bound schedules nothing.
  if v_min is null or jsonb_typeof(v_min) <> 'number'
     or v_window is null or jsonb_typeof(v_window) <> 'number' then
    return 0;
  end if;
  v_min_count := (v_min #>> '{}')::integer;
  v_window_days := (v_window #>> '{}')::integer;

  with candidates as (
    select p.id as user_id,
           ((p_now at time zone coalesce(p.timezone, 'UTC'))::date - 1) as computed_for
      from public.profiles p
      join pg_timezone_names tz on tz.name = coalesce(p.timezone, 'UTC')
     where (p_now at time zone coalesce(p.timezone, 'UTC'))::time >= time '01:00'
       and (p_now at time zone coalesce(p.timezone, 'UTC'))::time < time '01:15'
       and (
         select count(*)
           from public.doings_logs d
          where d.user_id = p.id
            and d.kind = 'impulse_failure'
            and (d.logged_at at time zone coalesce(p.timezone, 'UTC'))::date
                between ((p_now at time zone coalesce(p.timezone, 'UTC'))::date - v_window_days)
                    and ((p_now at time zone coalesce(p.timezone, 'UTC'))::date - 1)
       ) >= v_min_count
  )
  insert into public.jobs (type, payload)
  select 'histogram_daily',
         jsonb_build_object('user_id', c.user_id, 'computed_for', c.computed_for)
    from candidates c
   where not exists (
     select 1
       from public.jobs j
      where j.type = 'histogram_daily'
        and j.payload ->> 'user_id' = c.user_id::text
        and j.payload ->> 'computed_for' = c.computed_for::text
   );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.histogram_eval_tick(timestamptz)
  from public, anon, authenticated;
grant execute on function public.histogram_eval_tick(timestamptz)
  to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'histogram-daily-every-15m') then
    perform cron.unschedule('histogram-daily-every-15m');
  end if;
end
$$;

select cron.schedule(
  'histogram-daily-every-15m',
  '*/15 * * * *',
  $$ select public.histogram_eval_tick(); $$
);

-- ---------------------------------------------------------------------------- (e) accept RPC
-- FR-15's letter: all steps are one transaction. The advisory lock serializes concurrent
-- accepts for the same user; the validate/consume checks and the one-active-quest check are
-- inside it, so two racing taps on one offer collapse to ok + duplicate and two racing accepts
-- of different offers collapse to ok + conflict. The `quest_expire` job carries a future
-- `next_retry_at` — a pending job is the whole delay mechanism. A job-insert failure rolls the
-- metric back with it, so a committed accept always carries its expiry job.
create or replace function public.accept_quest(
  p_user_id uuid,
  p_message_id uuid,
  p_name text,
  p_domain text,
  p_output_unit text,
  p_formula jsonb,
  p_quest_deadline date,
  p_expire_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb;
  v_metric_id uuid;
begin
  -- Per-user serialization: covers both racing accepts of one offer and two accepted offers.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- (1) Lock the offer row and validate it. The consume check runs BEFORE the one-active
  -- guard on purpose: a second tap on an offer this RPC already consumed is the idempotent
  -- `duplicate` no-op (FR-15/AC-7), never a conflict — the first tap really did succeed.
  select metadata into v_meta
    from public.messages
   where id = p_message_id
     and user_id = p_user_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_meta is null or v_meta -> 'quest_offer' is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_meta ->> 'quest_consumed' is not null then
    return jsonb_build_object('status', 'duplicate');
  end if;
  -- Defense in depth: the gate already ran in TypeScript; an array/scalar here is a bug.
  if jsonb_typeof(p_formula) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- (2) The one-active-quest limit (an unarchived quest metric already exists). A fresh
  -- unconsumed offer cannot open a second quest while one is live; concurrent accepts of two
  -- different offers serialize on the advisory lock and the loser lands here.
  if exists (
    select 1
      from public.metrics m
     where m.user_id = p_user_id
       and m.is_quest
       and m.archived_at is null
  ) then
    return jsonb_build_object('status', 'conflict');
  end if;

  -- (3) The validated metric row.
  insert into public.metrics (
    user_id, name, domain, is_quest, quest_status, quest_deadline,
    formula, formula_status, output_unit
  ) values (
    p_user_id, p_name, p_domain, true, 'active', p_quest_deadline,
    p_formula, 'validated', p_output_unit
  ) returning id into v_metric_id;

  -- (4) The expiry job (the debrief reads the last nightly point before 01:15 local).
  insert into public.jobs (type, payload, next_retry_at)
  values (
    'quest_expire',
    jsonb_build_object('user_id', p_user_id, 'metric_id', v_metric_id),
    p_expire_at
  );

  -- (5) Consume the offer in the same transaction.
  update public.messages
     set metadata = coalesce(metadata, '{}'::jsonb)
       || jsonb_build_object(
            'quest_consumed', true,
            'quest_accepted', true,
            'quest_metric_id', v_metric_id
          )
   where id = p_message_id;

  return jsonb_build_object('status', 'ok', 'metric_id', v_metric_id);
end;
$$;

revoke execute on function public.accept_quest(uuid, uuid, text, text, text, jsonb, date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.accept_quest(uuid, uuid, text, text, text, jsonb, date, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------- (f) config seeds
insert into config (key, value, description) values
  ('drift_window_days',
   '3',
   '§7.3 drift scan: trailing complete local days each pattern evaluates (FR-12 [SPEC])'),
  ('drift_late_start_hour',
   '10',
   '§7.3 drift scan: a day whose first doing lands after this local hour counts as a late start (FR-12 [SPEC])'),
  ('drift_compliance_threshold',
   '0.6',
   '§7.3 drift scan: check-in compliance floor for the drop pattern; FR-3 reuses it as the streak day rule (one knob, D4) [SPEC]'),
  ('drift_energy_threshold',
   '4',
   '§7.3 drift scan: energy slide fires when the trailing mean of non-null energy_avg is below this (FR-12 [SPEC])'),
  ('drift_scan_enabled',
   'true',
   '§7.3 kill switch: the drift-scan tick and handler both no-op when false (FR-12)'),
  ('histogram_window_days',
   '14',
   '§7.8 histogram: trailing local days bucketed for urge prediction (FR-21 [SPEC])'),
  ('histogram_bucket_min_count',
   '3',
   '§7.8 histogram: cold-start floor — below this many impulse failures nothing is scheduled, and a bucket needs this many to qualify (FR-21 [SPEC])'),
  ('quest_completion_fraction',
   '0.5',
   '§7.3 quest verdict: fractional points ≥ fraction × elapsed days → completed (FR-16 [SPEC])'),
  ('quest_deadline_bounds',
   '{"min_days":3,"max_days":21}',
   '§7.3 quest deadline clamp in days; applied at accept time (FR-15 [SPEC])'),
  ('strike_fire_local_hour',
   '18',
   '§7.5 Strike: the user-local hour the Strike fires at on strike_at (FR-18 [SPEC])'),
  ('strike_fire_enabled',
   'true',
   '§7.5 kill switch: runStrike completes without generating when false (FR-19)'),
  ('oath_request_cooldown_days',
   '7',
   '§5.4 Oath: no new oath_request demand within this many trailing days (FR-9 [SPEC])'),
  ('breakdown_persona',
   '"therapist_empath"',
   '§5.4 breakdown: the locked persona the breakdown intervention generates with (FR-11 [SPEC])'),
  ('lockdown_accountability_domains',
   '["Career","Discipline/Habits"]',
   '§5.3 lockdown: the domains whose rules are retrieved while dialog_state = LOCKDOWN (FR-7 [SPEC])')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

-- The one update, not an add: `0001` seeded this key before any reader existed; FP-08's drift
-- scan is its first. The upsert heals a drifted live value on re-apply (the 0014 lesson).
insert into config (key, value, description) values
  ('habit_detection_thresholds',
   '{"impulse_failures_per_week":3,"journal_flags_per_week":3}',
   '§7.5 habit surfacing: impulse failures or journal habit_flags in a trailing week that surface a habit (FR-13 [SPEC])')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

-- config is client-readable by signed-in users only; never anonymous (0031's end state — the
-- revoke also heals the live database, where the intermediate re-granting migrations left the
-- anon grant in place; nothing in this migration may re-add it).
grant select on config to authenticated;
revoke select on config from anon;

-- Verify (SQL editor):
--   select cron.jobname, cron.schedule, cron.active from cron.job
--    where jobname in ('drift-scan-every-10m', 'histogram-daily-every-15m');
--     -> both rows, */10 * * * * and */15 * * * *, active
--   select public.drift_scan_tick();
--     -> 0 or 1 (1 only when no drift_scan row was created in the trailing 10 minutes)
--   select public.histogram_eval_tick('2026-10-22T01:05:00+05:30'::timestamptz);
--     -> 0 or 1 (1 only for a qualified user at their local 01:00–01:15)
--   select key, value, jsonb_typeof(value) from config
--    where key like 'drift_%' or key like 'histogram_%' or key like 'quest_%'
--       or key like 'strike_%' or key like 'oath_%' or key like 'breakdown_%'
--       or key = 'lockdown_accountability_domains' or key = 'habit_detection_thresholds'
--    order by key;
--     -> fifteen rows; every numeric key `number`, bounds/domains/thresholds `object|array|string`
--   select p.proname, p.prosecdef, p.proconfig from pg_proc p
--    where p.proname in ('drift_scan_tick', 'histogram_eval_tick', 'accept_quest');
--     -> t | {search_path=public} on all three
