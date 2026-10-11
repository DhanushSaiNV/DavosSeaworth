-- Migration 0006_knowledge
-- Create rules, exemplars, memory_facts tables per TECH-SPECS §3.3
-- No seed rows (content is migration 7, content-gated per AGENTS.md §8.4)

-- Rules table (pre-seeded content deliverable D17)
create table rules (
    id uuid primary key,
    text text not null,
    domain text not null,
    source_figure text not null,
    tone text not null check (tone in ('aggressive','empathetic','neutral')),
    priority int not null default 50,
    embed_model text,
    embedding vector(768)
);

-- Exemplars table (classifier sets, seeded with rules migration D19)
create table exemplars (
    id uuid primary key,
    set_kind text not null check (set_kind in ('domain','emotion','quit_signal')),
    label text not null,
    text text not null,
    embed_model text,
    embedding vector(768) not null
);

-- Memory facts table
create table memory_facts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    fact text not null,
    fact_type text not null default 'chat' check (fact_type in ('chat','journal','oath','baseline')),
    source_message_id uuid references messages(id),
    source_journal_id uuid, -- FK added in 0007 after journal_entries exists
    embed_model text,
    embedding vector(768),
    purged_at timestamptz,
    created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_rules_domain on rules(domain);
create index if not exists idx_exemplars_set_kind on exemplars(set_kind);
create index if not exists idx_memory_facts_user_id on memory_facts(user_id);
create index if not exists idx_memory_facts_purged_at on memory_facts(purged_at) where purged_at is null;
create index if not exists idx_memory_facts_fact_type on memory_facts(fact_type);
create index if not exists idx_memory_facts_source_message_id on memory_facts(source_message_id);
create index if not exists idx_memory_facts_source_journal_id on memory_facts(source_journal_id);

-- RLS will be enabled in this migration
alter table rules enable row level security;
alter table exemplars enable row level security;
alter table memory_facts enable row level security;

-- Rules: read-only for authenticated users (content is system-owned)
create policy "rules_select_authenticated" on rules
  for select to authenticated using (true);

-- Exemplars: read-only for authenticated users (content is system-owned)
create policy "exemplars_select_authenticated" on exemplars
  for select to authenticated using (true);

-- Memory facts: user-scoped RLS
create policy "memory_facts_select_own" on memory_facts
  for select using (auth.uid() = user_id);

create policy "memory_facts_insert_own" on memory_facts
  for insert with check (auth.uid() = user_id);

create policy "memory_facts_update_own" on memory_facts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Grant permissions
grant select on rules to authenticated;
grant select on exemplars to authenticated;
grant select, insert, update on memory_facts to authenticated;