-- Migration 0027_watchdog_cron_fp04
-- FP-04 Step 6: the check-in watchdog's schedule, plus the persona the intervention generates
-- with. No schema change: the `jobs` table (0008) already carries everything the scan needs.
--
-- Refs: FP-04 FR-15, FR-16, FR-18; TECH-SPECS §2.2–2.3, §7.1, §11; D2, D9, D12;
--       AGENTS.md §2, §3.2, §4.5.

-- (a) The 5-minute tick (§2.3's `watchdog_checkin` row: "pg_cron | every 5 min").
--
-- The tick follows §2.2 exactly: pg_cron only *inserts* a job row — the 1-min
-- `job-dispatcher-tick` (0009/0010) stays the sole claimer. It inserts no URL and no token, and
-- reaches no network, so nothing here can break the 0010 auth wiring.
--
-- The `not exists` guard is an optimization, not the correctness mechanism. A tick that lands
-- while the previous watchdog row is still pending/claimed/running inserts nothing, which keeps
-- the batch budget free for feature jobs. Correctness does not rest on it: the handler is
-- idempotent (§2.2.4) and the intervention payload's window dedup absorbs a double-insert
-- (FR-16), so a guard that misses a race costs one redundant scan, never a duplicate nudge.
--
-- `status in ('pending','claimed','running')` is the §2.1 in-flight set; `done`/`failed`/`dead`
-- are all terminal, so a failed scan is re-armed by the next tick (that is the retry policy for
-- this type — backoff on a 5-min scan would only delay the next sweep).
select cron.schedule(
  'watchdog-checkin',
  '*/5 * * * *',  -- every 5 minutes
  $$
  insert into public.jobs (type, payload)
  select 'watchdog_checkin', '{}'::jsonb
  where not exists (
    select 1
      from public.jobs
     where type = 'watchdog_checkin'
       and status in ('pending', 'claimed', 'running')
  );
  $$
);

-- (b) The intervention's persona (FP-04 FR-16: "persona `mentor_tough` [SPEC reading]").
--
-- A [SPEC] string per AGENTS.md §2: registered in TECH-SPEC §11 and read at runtime by the
-- `intervention` handler — never inlined into the prompt builder. `value` is jsonb, so the JSON
-- string literal is quoted (a bare `mentor_tough` fails with "invalid input syntax for type
-- jsonb"), matching the 0001/0017/0026 convention.
--
-- NB `watchdog_grace_minutes` is NOT re-seeded here: 0001 already carries it (default 10).
-- Only `watchdog_lookback_minutes` (0026) and this key are Step 6's additions to the registry.
insert into config (key, value, description) values
  ('intervention_persona', '"mentor_tough"', '§7.1/FR-16: the locked persona the missed-check-in intervention generates with');

grant select on config to anon, authenticated;

-- Verify (SQL editor):
--   select jobname, schedule, active from cron.job where jobname = 'watchdog-checkin';
--     → watchdog-checkin | */5 * * * * | t
--   select key, value, jsonb_typeof(value) from config where key = 'intervention_persona';
--     → intervention_persona | "mentor_tough" | string
--   select count(*) from jobs where type = 'watchdog_checkin' and status = 'pending';
--     → 0 or 1 — never more than one in flight after the first tick
