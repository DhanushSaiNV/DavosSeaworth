-- Migration 0008_jobs
-- Create jobs table per TECH-SPECS §2.1
-- Job type registry per §2.3 (smoke_test registered in Step 11)

-- Jobs table
create table jobs (
    id uuid primary key default gen_random_uuid(),
    type text not null,
    payload jsonb not null default '{}',
    status text not null default 'pending'
        check (status in ('pending','claimed','running','done','failed','dead')),
    attempts int not null default 0,
    max_attempts int not null default 5,
    next_retry_at timestamptz not null default now(),
    last_error text,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    completed_at timestamptz
);

-- Index for dispatcher claim query
create index jobs_due_idx on jobs (status, next_retry_at);

-- Claim jobs function (implements §2.2 algorithm)
-- Claims batch of jobs with FOR UPDATE SKIP LOCKED, sets claimed/running
create or replace function public.claim_jobs(batch_size int default 10, lease_minutes int default 5)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job_record public.jobs%rowtype;
  now_ts timestamptz := now();
begin
  for job_record in
    select * from public.jobs
    where status in ('pending', 'failed')
      and next_retry_at <= now_ts
    order by next_retry_at
    limit batch_size
    for update skip locked
  loop
    update public.jobs
    set status = 'running',
        updated_at = now_ts,
        attempts = attempts + 1
    where id = job_record.id
    returning * into job_record;

    return next job_record;
  end loop;
  return;
end;
$$;

-- RLS: jobs are system-managed; no client access
-- Service role bypasses RLS for dispatcher operations
alter table jobs enable row level security;

-- No policies for authenticated role — only service role accesses jobs

-- Grant permissions (service role has full access by default)
-- No grants to authenticated role

-- Security: claim_jobs is SECURITY DEFINER — restrict execution to service_role only
-- Prevents anon/authenticated from draining the job queue via PostgREST
revoke execute on function public.claim_jobs(int, int) from public, anon, authenticated;
grant execute on function public.claim_jobs(int, int) to service_role;
