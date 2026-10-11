-- Migration 0005_rls_core
-- Enable RLS and create policies on core user-scoped tables
-- AGENTS.md §4.1: RLS violation here is always a bug

-- Enable RLS on all user-scoped tables
alter table profiles enable row level security;
alter table push_tokens enable row level security;
alter table messages enable row level security;
alter table doings_logs enable row level security;

-- Profiles policies
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Push tokens policies
create policy "push_tokens_select_own" on push_tokens
  for select using (auth.uid() = user_id);

create policy "push_tokens_insert_own" on push_tokens
  for insert with check (auth.uid() = user_id);

create policy "push_tokens_update_own" on push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push_tokens_delete_own" on push_tokens
  for delete using (auth.uid() = user_id);

-- Messages policies
create policy "messages_select_own" on messages
  for select using (auth.uid() = user_id);

create policy "messages_insert_own" on messages
  for insert with check (auth.uid() = user_id);

create policy "messages_update_own" on messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Doings logs policies
create policy "doings_logs_select_own" on doings_logs
  for select using (auth.uid() = user_id);

create policy "doings_logs_insert_own" on doings_logs
  for insert with check (auth.uid() = user_id);

create policy "doings_logs_update_own" on doings_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Grant permissions to authenticated role
grant select, insert, update on profiles to authenticated;
grant select, insert, update, delete on push_tokens to authenticated;
grant select, insert, update on messages to authenticated;
grant select, insert, update on doings_logs to authenticated;