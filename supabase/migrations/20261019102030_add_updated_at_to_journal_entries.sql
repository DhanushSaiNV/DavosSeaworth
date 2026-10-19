-- supabase/migrations/0029_add_updated_at_to_journal_entries.sql
-- Add updated_at column to journal_entries (missing from 0007)

alter table journal_entries
add column if not exists updated_at timestamptz default now();

-- Backfill existing rows
update journal_entries
set updated_at = created_at
where updated_at is null;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
