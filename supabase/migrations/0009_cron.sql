-- Migration 0009_cron
-- pg_cron tick wiring per TECH-SPECS §2.2
-- Schedules job-dispatcher invocation every 1 minute

-- The Edge Function runs within the Supabase project with service role privileges,
-- so no Authorization header is needed — the dispatcher handles auth internally
-- via Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') provided by Supabase.
-- The job_dispatcher_url must be set in config after Edge Function deployment:
--   supabase exec --sql "UPDATE config SET value = '\"https://<project>.supabase.co/functions/v1/job-dispatcher\"' WHERE key = 'job_dispatcher_url';"

-- Note: Ticks are idempotent-safe by design.
-- pg_cron ticks only *enable* claiming; a missed or doubled tick cannot corrupt state.
-- The dispatcher's FOR UPDATE SKIP LOCKED ensures only one worker claims each job.

select cron.schedule(
  'job-dispatcher-tick',
  '* * * * *',  -- every 1 minute
  $$
  select net.http_post(
    url := (select value #>> '{}' from config where key = 'job_dispatcher_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Verify the schedule was created
-- select * from cron.job where jobname = 'job-dispatcher-tick';