-- Migration 0026_checkin_loop_fp04
-- FP-04 Step 1: one doing per check-in window, the two [SPEC] check-in keys, and the
-- validated write path for the four check-in preference columns.
--
-- AGENTS.md §2: [SPEC] values live in the `config` table and are read at runtime — never
-- hardcoded into logic. §7.1 marks the late gate at 15 min and the watchdog scan at 120 min,
-- so both become keys rather than literals in `submit-checkin` / the watchdog handler.
--
-- (a) Window uniqueness. `checkin_window` is the *canonical* window START (TECH-SPECS §7.1)
-- and is the join key the watchdog scans on, so at most one doing may answer it. The
-- predicate leaves every other source untouched: `impulse_failure` / `chat` / `app` /
-- `quick_action` rows carry a null window and are unaffected (Postgres treats NULLs in a
-- unique index as distinct, so those rows never collide with each other).
--
-- The 0003 non-unique `idx_doings_logs_checkin_window` is dropped here on purpose: the
-- partial unique index below serves every non-null-window query — the only ones that exist
-- (the watchdog "answered" join and the submit dedupe both filter a non-null window) — so
-- keeping the old one would only add write amplification. This drop is deliberate, not drift.
--
-- (b) `update_checkin_prefs` is the *validated* write path for the four check-in columns —
-- cadence, active hours, timezone. It is NOT a lockdown: 0005 granted `update` on `profiles`
-- to `authenticated` plus a `profiles_update_own` policy, so a hand-crafted PostgREST PATCH
-- can still write any granted column (a pre-existing FP-01 surface, recorded as a live item
-- in FP-04's Out of scope). The function exists to give the client one path that validates an
-- invariant the table's CHECKs cannot express (`start < end`, a real timezone). It takes NO
-- user id: `security definer` bypasses RLS, so the body guards with `auth.uid()` instead, and
-- the pinned `search_path` keeps a hostile schema off the resolution path — the `claim_jobs`
-- (0008) / `increment_auto_adopt_successes` (0023) hardening.
--
-- Refs: FP-04 FR-8, FR-11 (partial), FR-17 (partial); TECH-SPECS §3.2, §7.1, §11; D9;
--       AGENTS.md §2, §4.1, §6.6.

-- (a) one doing per check-in window
create unique index if not exists doings_logs_one_checkin_window
  on doings_logs (user_id, checkin_window)
  where checkin_window is not null;

drop index if exists public.idx_doings_logs_checkin_window;

-- (b) [SPEC] keys. NB: `value` is jsonb — a bare number fails to cast ("cannot cast type
-- integer to jsonb"), so numbers are written as quoted JSON literals, matching 0001/0014/0017.
insert into config (key, value, description) values
  ('checkin_late_minutes', '15', '§7.1 late gate: a check-in answered more than this many minutes after its window closes triggers the LLM evaluation call'),
  ('watchdog_lookback_minutes', '120', '§7.1 watchdog scan bound: only check-in windows closed within this many minutes are considered missed');

grant select on config to anon, authenticated;

-- (c) the validated write path for the four check-in preference columns
create or replace function public.update_checkin_prefs(
  p_cadence int,
  p_start time,
  p_end time,
  p_tz text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'update_checkin_prefs: not authenticated';
  end if;
  if p_cadence is null or p_cadence not in (60, 120) then
    raise exception 'update_checkin_prefs: cadence must be 60 or 120';
  end if;
  if p_start is null or p_end is null or p_start >= p_end then
    raise exception 'update_checkin_prefs: active hours must be same-day with start < end';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names z where z.name = p_tz) then
    raise exception 'update_checkin_prefs: unknown timezone %', coalesce(p_tz, '<null>');
  end if;

  update public.profiles
     set checkin_cadence_minutes    = p_cadence,
         checkin_active_hours_start = p_start,
         checkin_active_hours_end   = p_end,
         timezone                   = p_tz
   where id = auth.uid();
end;
$$;

revoke execute on function public.update_checkin_prefs(int, time, time, text) from public, anon;
grant execute on function public.update_checkin_prefs(int, time, time, text) to authenticated, service_role;

-- Verify:
-- select indexname from pg_indexes
--   where tablename = 'doings_logs'
--     and indexname in ('doings_logs_one_checkin_window', 'idx_doings_logs_checkin_window');
--   -- → exactly one row (the unique partial index)
-- select key, value, jsonb_typeof(value) from config
--   where key in ('checkin_late_minutes', 'watchdog_lookback_minutes') order by key;
--   -- → both jsonb numbers (15 / 120)
-- select p.proname, p.prosecdef, p.proconfig from pg_proc p
--   where p.proname = 'update_checkin_prefs';
--   -- → prosecdef = true, proconfig = {search_path=public}
