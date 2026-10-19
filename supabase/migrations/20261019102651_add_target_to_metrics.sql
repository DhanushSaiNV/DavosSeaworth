-- supabase/migrations/0030_add_target_to_metrics.sql
-- Add target column to metrics (required by anchor_plan handler)

alter table metrics
add column if not exists target jsonb default '{}';

-- Backfill existing rows with empty target
update metrics
set target = '{}'
where target is null;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
