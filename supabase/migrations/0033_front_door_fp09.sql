-- Migration 0033_front_door_fp09
-- FP-09 Step 1: the front door's SQL half. One trigger function, one backfill, one
-- scheduled tick, eight config seeds. No column, no table, no index, no RLS change.
--
-- Refs: TECH-SPEC §3.4, §7.7, §2.2–2.3, §11, §12; D12, D17; FP-09 FR-1, FR-6, FR-13
--       (SQL halves); AGENTS.md §2, §3.2, §4.
--
-- (a) `create_opening_message()` — the first assistant row, written when a profile is
--     created. The copy is `config.onboarding_opening_text`, not a provider call: a
--     trigger cannot await a model, and non-generated copy is the `sync_degrade_reply`
--     precedent. The row is tagged `metadata.source='onboarding_opening'` and carries
--     no `persona_key`; the tag is the idempotency key, so a re-fired insert finds the
--     existing row and skips.
--
--     COPY STATUS: the seeded text below is a clearly labeled DRAFT placeholder. BG-06
--     (Step 6) owns the final owner-approved opening copy. Step 6 must update the config
--     value *and* rewrite the rows this backfill already persisted, because the trigger
--     copies text rather than storing a reference.
--
-- (b) The one-time backfill in the same migration: every non-complete profile without
--     an opening row gets one at `now()`. Existing threads keep their history; for the
--     existing non-complete accounts this is the owner-drilled first line. The seed block
--     deliberately runs before the backfill so the copy exists when the insert reads it.
--
-- (c) `proactive_tick()` — the `0030`/`0032` per-user pattern. The tick only inserts
--     `jobs` rows; the 1-minute dispatcher remains the sole claimer. A user qualifies
--     when: `proactive_enabled` is true; `onboarding_stage='complete'`; the local clock
--     is inside exactly one configured `[slot, slot+30min)` window; the newest user
--     message is older than `proactive_min_silence_minutes`; and no `proactive` job
--     exists for that `(user_id, slot, local-day)` in any status. The gap vector is
--     SQL-checkable (wake, sleep, routine, activities, baseline-fact count), first
--     missing wins, else `companionship`. Payload: `{user_id, slot, kind, gap_key?}`.
--     Every config read fails closed.
--
-- (d) Eight seeds, proper jsonb (the 0014 lesson), each with a description. They are
--     `on conflict (key) do update` so a re-apply is idempotent; note that a re-apply
--     also resets owner-tuned values to these seeds by design (the Step 1 verification
--     re-applies the migration).
--
-- Nothing else: `proactive` is the fifteenth job type but its handler lands in Step 5,
-- so the dispatcher registry stays 14/15 after this migration.

-- ---------------------------------------------------------------------------- (a) opening trigger
create or replace function public.create_opening_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb;
  v_copy text;
begin
  select value
    into v_value
    from public.config
   where key = 'onboarding_opening_text';

  -- Missing/malformed copy must not block signup: warn and leave the profile without
  -- an opening row. The backfill and the Step 1 verify both detect the invariant break.
  if v_value is null or jsonb_typeof(v_value) <> 'string' then
    raise warning 'onboarding_opening_text missing or not a string; no opening row for %',
      new.id;
    return new;
  end if;

  v_copy := v_value #>> '{}';
  if btrim(v_copy) = '' then
    raise warning 'onboarding_opening_text is empty; no opening row for %', new.id;
    return new;
  end if;

  -- Idempotent on the source tag: a re-fired profile insert adds nothing.
  if exists (
    select 1
      from public.messages m
     where m.user_id = new.id
       and m.metadata ->> 'source' = 'onboarding_opening'
  ) then
    return new;
  end if;

  insert into public.messages (user_id, role, content, metadata, persona_key)
  values (
    new.id,
    'assistant',
    v_copy,
    jsonb_build_object(
      'source', 'onboarding_opening',
      'onboarding_stage', 'intro'
    ),
    null
  );

  return new;
end;
$$;

revoke execute on function public.create_opening_message()
  from public, anon, authenticated;
grant execute on function public.create_opening_message()
  to service_role;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row
  execute function public.create_opening_message();

-- ---------------------------------------------------------------------------- (d) seeds
-- Seeded before the backfill: the backfill reads `onboarding_opening_text`.
insert into public.config (key, value, description) values
  ('onboarding_stage_questions', '{"intro":1,"baseline":3,"goals":3,"routine":4,"metric_selection":0}'::jsonb,
   '§7.7/D17: answer count per onboarding stage; intro=1 is the opening greeting itself'),
  ('onboarding_persona', '"mentor_tough"'::jsonb,
   '§7.7/D17: the locked persona for the stages 4-5 interview override'),
  ('onboarding_opening_text', to_jsonb($copy$[DRAFT - BG-06 opening copy pending] Davos here. Before we start, what's the one thing you want to change first?$copy$::text),
   '§7.7/FR-6: the deterministic first assistant row — DRAFT placeholder until BG-06 (Step 6) supplies the owner copy'),
  ('proactive_enabled', 'true'::jsonb,
   'FR-12 kill switch: the proactive tick and the handler both no-op when false'),
  ('proactive_windows', '["10:00","19:30"]'::jsonb,
   'FR-12 [SPEC]: user-local 30-minute windows in which the tick may insert one proactive job'),
  ('proactive_persona', '"mentor_tough"'::jsonb,
   'FR-12: the locked persona the proactive handler generates with'),
  ('proactive_min_silence_minutes', '120'::jsonb,
   'FR-12 [SPEC]: the newest user message must be older than this many minutes'),
  ('proactive_gap_min_baseline_facts', '5'::jsonb,
   'FR-13 [SPEC]: below this many live baseline facts, the gap vector asks for more')
on conflict (key) do update
  set value = case
        when config.key = 'onboarding_opening_text' then config.value
        else excluded.value
      end,
      description = excluded.description;

-- ---------------------------------------------------------------------------- (b) one-time backfill
do $$
declare
  v_value jsonb;
  v_copy text;
  v_count integer := 0;
begin
  select value
    into v_value
    from public.config
   where key = 'onboarding_opening_text';

  if v_value is null or jsonb_typeof(v_value) <> 'string'
     or btrim(v_value #>> '{}') = '' then
    raise warning 'onboarding_opening_text unavailable; backfill skipped';
    return;
  end if;

  v_copy := v_value #>> '{}';

  insert into public.messages (user_id, role, content, metadata, persona_key)
  select p.id,
         'assistant',
         v_copy,
         jsonb_build_object(
           'source', 'onboarding_opening',
           'onboarding_stage', 'intro'
         ),
         null
    from public.profiles p
   where p.onboarding_stage <> 'complete'
     and not exists (
       select 1
         from public.messages m
        where m.user_id = p.id
          and m.metadata ->> 'source' = 'onboarding_opening'
     );

  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise notice '0033 backfilled % onboarding opening rows', v_count;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------- (c) proactive tick
create or replace function public.proactive_tick(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled jsonb;
  v_windows jsonb;
  v_silence_json jsonb;
  v_gap_min_json jsonb;
  v_silence_minutes integer;
  v_gap_min integer;
  v_profile record;
  v_slot_json jsonb;
  v_slot_text text;
  v_slot_time time;
  v_end_time time;
  v_match_count integer;
  v_matched_slot text;
  v_local_time time;
  v_local_date date;
  v_kind text;
  v_gap_key text;
  v_baseline_count integer;
  v_inserted integer := 0;
begin
  select value into v_enabled from public.config where key = 'proactive_enabled';
  -- Fail-closed: missing, false, or a non-boolean all stop the tick.
  if v_enabled is distinct from 'true'::jsonb then
    return 0;
  end if;

  select value into v_windows from public.config where key = 'proactive_windows';
  if v_windows is null or jsonb_typeof(v_windows) <> 'array' then
    return 0;
  end if;

  select value into v_silence_json from public.config where key = 'proactive_min_silence_minutes';
  if v_silence_json is null or jsonb_typeof(v_silence_json) <> 'number'
     or v_silence_json::text !~ '^[0-9]+$' then
    return 0;
  end if;
  v_silence_minutes := v_silence_json::text::integer;

  select value into v_gap_min_json from public.config where key = 'proactive_gap_min_baseline_facts';
  if v_gap_min_json is null or jsonb_typeof(v_gap_min_json) <> 'number'
     or v_gap_min_json::text !~ '^[0-9]+$' then
    return 0;
  end if;
  v_gap_min := v_gap_min_json::text::integer;

  for v_profile in
    select p.id, p.timezone, p.wake_time, p.sleep_time, p.routine,
           p.high_dopamine_activities
      from public.profiles p
     where p.onboarding_stage = 'complete'
     order by p.id
  loop
    -- Invalid/absent timezone fails closed per user, never aborts the tick.
    begin
      v_local_time := (p_now at time zone v_profile.timezone)::time;
      v_local_date := (p_now at time zone v_profile.timezone)::date;
    exception when others then
      continue;
    end;

    -- Local clock must be inside exactly one [slot, slot+30min) window. Overlapping
    -- windows are ambiguous and therefore insert nothing.
    v_match_count := 0;
    v_matched_slot := null;
    for v_slot_json in select * from jsonb_array_elements(v_windows)
    loop
      if jsonb_typeof(v_slot_json) <> 'string' then
        continue;
      end if;
      v_slot_text := v_slot_json #>> '{}';
      begin
        v_slot_time := v_slot_text::time;
      exception when others then
        continue;
      end;
      v_end_time := (v_slot_time + interval '30 minutes')::time;
      if v_slot_time < v_end_time then
        if v_local_time >= v_slot_time and v_local_time < v_end_time then
          v_match_count := v_match_count + 1;
          v_matched_slot := v_slot_text;
        end if;
      else
        -- A window crossing midnight: [23:45, 00:15).
        if v_local_time >= v_slot_time or v_local_time < v_end_time then
          v_match_count := v_match_count + 1;
          v_matched_slot := v_slot_text;
        end if;
      end if;
    end loop;

    if v_match_count <> 1 then
      continue;
    end if;

    -- Silence: the newest user row must be older than the threshold. At the exact
    -- boundary the row is not older, so it fails closed. No user row at all passes.
    if exists (
      select 1
        from public.messages m
       where m.user_id = v_profile.id
         and m.role = 'user'
         and m.created_at >= p_now - (v_silence_minutes * interval '1 minute')
    ) then
      continue;
    end if;

    -- Any-status dedup: one proactive job per user, slot, local day. The job's
    -- created_at is the tick's p_now, so the local-day derivation is deterministic
    -- under backdated verification calls.
    if exists (
      select 1
        from public.jobs j
       where j.type = 'proactive'
         and j.payload ->> 'user_id' = v_profile.id::text
         and j.payload ->> 'slot' = v_matched_slot
         and (j.created_at at time zone v_profile.timezone)::date = v_local_date
    ) then
      continue;
    end if;

    -- Gap vector, fixed order: wake -> sleep -> routine -> activities -> facts.
    v_kind := 'companionship';
    v_gap_key := null;

    if v_profile.wake_time is null then
      v_kind := 'gap';
      v_gap_key := 'wake_time';
    elsif v_profile.sleep_time is null then
      v_kind := 'gap';
      v_gap_key := 'sleep_time';
    elsif v_profile.routine is null
       or v_profile.routine = '{}'::jsonb
       or btrim(coalesce(v_profile.routine ->> 'summary', '')) = '' then
      v_kind := 'gap';
      v_gap_key := 'routine';
    elsif v_profile.high_dopamine_activities is null
       or jsonb_typeof(v_profile.high_dopamine_activities) <> 'array' then
      v_kind := 'gap';
      v_gap_key := 'high_dopamine_activities';
    elsif jsonb_array_length(v_profile.high_dopamine_activities) = 0 then
      v_kind := 'gap';
      v_gap_key := 'high_dopamine_activities';
    else
      select count(*)::integer
        into v_baseline_count
        from public.memory_facts f
       where f.user_id = v_profile.id
         and f.fact_type = 'baseline'
         and f.purged_at is null;

      if v_baseline_count < v_gap_min then
        v_kind := 'gap';
        v_gap_key := 'baseline_facts';
      end if;
    end if;

    insert into public.jobs (type, payload, created_at)
    values (
      'proactive',
      jsonb_build_object(
        'user_id', v_profile.id::text,
        'slot', v_matched_slot,
        'kind', v_kind
      ) || case
             when v_gap_key is not null
               then jsonb_build_object('gap_key', v_gap_key)
             else '{}'::jsonb
           end,
      p_now
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke execute on function public.proactive_tick(timestamptz)
  from public, anon, authenticated;
grant execute on function public.proactive_tick(timestamptz)
  to service_role;

-- Re-schedulable: a re-apply replaces the schedule instead of failing on the name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'proactive-tick') then
    perform cron.unschedule('proactive-tick');
  end if;
end
$$;

select cron.schedule(
  'proactive-tick',
  '*/30 * * * *',
  $$ select public.proactive_tick(); $$
);

-- Verify (SQL editor):
--   select jobname, schedule, active from cron.job where jobname = 'proactive-tick';
--     -> proactive-tick | */30 * * * * | t
--   select key, value, jsonb_typeof(value) from config
--    where key like 'onboarding_%' or key like 'proactive_%' order by key;
--     -> eight rows; the string keys are jsonb strings, the counts/booleans are jsonb
--   select p.id, count(m.id) from profiles p
--     left join messages m on m.user_id = p.id
--      and m.metadata->>'source' = 'onboarding_opening'
--    where p.onboarding_stage <> 'complete'
--    group by p.id having count(m.id) <> 1;
--     -> zero rows
