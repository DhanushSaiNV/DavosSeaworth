-- Migration 0010_cron_auth
-- The Edge Function gateway enforces JWT verification (`verify_jwt`) on the
-- deployed `job-dispatcher`, so the pg_cron tick MUST send an Authorization
-- header. Supersedes the header-less schedule created in 0009_cron.
--
-- The key is read from Supabase Vault at call time — never inline here and never
-- in `config` (which is readable by anon/authenticated). AGENTS.md §4.5.
-- Owner action required before this tick works:
--   select vault.create_secret('<service_role_key>', 'job_dispatcher_auth', '...');
--
-- Refs: FP-01 FR-6, AC-6; FP-01PLAN.md Step 8.1; TECH-SPECS §2.2 (algorithm 1); D12.

-- Replace the header-less schedule from 0009 (guarded: unschedule errors if absent).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'job-dispatcher-tick') then
    perform cron.unschedule('job-dispatcher-tick');
  end if;
end
$$;

select cron.schedule(
  'job-dispatcher-tick',
  '* * * * *',  -- every 1 minute
  $$
  select net.http_post(
    url := (select value #>> '{}' from config where key = 'job_dispatcher_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret
                                     from vault.decrypted_secrets
                                     where name = 'job_dispatcher_auth')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Verify the schedule was created
-- select jobid, jobname, schedule, active, command
-- from cron.job where jobname = 'job-dispatcher-tick';
