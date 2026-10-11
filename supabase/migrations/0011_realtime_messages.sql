-- Migration 0011_realtime_messages
-- Enable Realtime broadcast on `messages` so the chat screen can render rows
-- pushed by server pipelines (send-message, AI response) via postgres_changes.
--
-- Without publication membership, `postgres_changes` never fires: this is the
-- Step 10 equivalent of the Step 8 gateway trap. Idempotent: safe to apply even
-- if the table was already added via the dashboard.
--
-- Refs: FP-01 FR-6 AC-7; FP-01PLAN.md Step 10; TECH-SPECS §7.10 (D23), §3.2; D23.

do $$
begin
  -- Supabase creates this publication on project setup; guard for fresh resets.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end
$$;

-- Verify:
-- select schemaname, tablename from pg_publication_tables
-- where pubname = 'supabase_realtime' order by tablename;