-- Migration 0007_features
-- Create feature tables per TECH-SPECS §3.4
-- journal_entries, metrics, metric_points, anchor_plans, habits, persona_stats, trust_events

-- Journal entries
create table journal_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    content text not null,
    entry_date date not null,
    vagueness_score numeric,
    severity text check (severity in ('S1','S2','S3')),
    probed boolean default false,
    created_at timestamptz default now()
);

-- Add FK from memory_facts to journal_entries (created in 0006)
alter table memory_facts
    add constraint memory_facts_source_journal_id_fkey
    foreign key (source_journal_id) references journal_entries(id) on delete set null;

-- Metrics
create table metrics (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    domain text,
    is_core boolean default false,
    is_quest boolean default false,
    quest_status text check (quest_status in ('active','completed','expired','failed')),
    quest_deadline date,
    formula jsonb not null,
    formula_status text not null default 'proposed' check (formula_status in ('proposed','validated','rejected')),
    output_unit text,
    archived_at timestamptz,
    created_at timestamptz default now()
);

-- Metric points (daily computed values)
create table metric_points (
    id uuid primary key default gen_random_uuid(),
    metric_id uuid not null references metrics(id) on delete cascade,
    value numeric not null,
    computed_for date not null,
    created_at timestamptz default now(),
    unique (metric_id, computed_for)
);

-- Anchor plans (next-day anchors)
create table anchor_plans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    plan_date date not null,
    anchors jsonb not null,
    created_at timestamptz default now(),
    unique (user_id, plan_date)
);

-- Habits (Strike lifecycle)
create table habits (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    description text not null,
    status text not null default 'detected'
        check (status in ('detected','confronted','watch','struck','quit_committed','cancelled')),
    detected_at timestamptz default now(),
    watch_started_at date,
    watch_days int not null default 7,
    strike_at date,
    created_at timestamptz default now()
);

-- Persona stats (adaptive weighting per user + domain)
create table persona_stats (
    user_id uuid not null references auth.users(id) on delete cascade,
    domain text not null,
    auto_adopt_successes int default 0,
    user_overrides int default 0,
    band_shift numeric default 0,
    primary key (user_id, domain)
);

-- Trust events (server-only audit log)
create table trust_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    delta int not null,
    reason text not null check (reason in ('openness','admission','streak','override')),
    created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_journal_entries_user_id on journal_entries(user_id);
create index if not exists idx_journal_entries_entry_date on journal_entries(entry_date);
create index if not exists idx_metrics_user_id on metrics(user_id);
create index if not exists idx_metric_points_metric_id on metric_points(metric_id);
create index if not exists idx_anchor_plans_user_id on anchor_plans(user_id);
create index if not exists idx_habits_user_id on habits(user_id);
create index if not exists idx_trust_events_user_id on trust_events(user_id);

-- RLS
alter table journal_entries enable row level security;
alter table metrics enable row level security;
alter table metric_points enable row level security;
alter table anchor_plans enable row level security;
alter table habits enable row level security;
alter table persona_stats enable row level security;
alter table trust_events enable row level security;

-- Journal entries policies
create policy "journal_entries_select_own" on journal_entries
  for select using (auth.uid() = user_id);

create policy "journal_entries_insert_own" on journal_entries
  for insert with check (auth.uid() = user_id);

create policy "journal_entries_update_own" on journal_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Metrics policies
create policy "metrics_select_own" on metrics
  for select using (auth.uid() = user_id);

create policy "metrics_insert_own" on metrics
  for insert with check (auth.uid() = user_id);

create policy "metrics_update_own" on metrics
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "metrics_delete_own" on metrics
  for delete using (auth.uid() = user_id);

-- Metric points policies (join through metrics to check user_id)
create policy "metric_points_select_own" on metric_points
  for select using (
    exists (
      select 1 from metrics m
      where m.id = metric_points.metric_id
      and m.user_id = auth.uid()
    )
  );

create policy "metric_points_insert_own" on metric_points
  for insert with check (
    exists (
      select 1 from metrics m
      where m.id = metric_points.metric_id
      and m.user_id = auth.uid()
    )
  );

-- Anchor plans policies
create policy "anchor_plans_select_own" on anchor_plans
  for select using (auth.uid() = user_id);

create policy "anchor_plans_insert_own" on anchor_plans
  for insert with check (auth.uid() = user_id);

create policy "anchor_plans_update_own" on anchor_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Habits policies
create policy "habits_select_own" on habits
  for select using (auth.uid() = user_id);

create policy "habits_insert_own" on habits
  for insert with check (auth.uid() = user_id);

create policy "habits_update_own" on habits
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Persona stats policies
create policy "persona_stats_select_own" on persona_stats
  for select using (auth.uid() = user_id);

create policy "persona_stats_insert_own" on persona_stats
  for insert with check (auth.uid() = user_id);

create policy "persona_stats_update_own" on persona_stats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trust events policies (server-only via service role; no client access)
-- RLS enabled but NO policies for authenticated role — service role bypasses RLS
-- This enforces AGENTS.md §4.7: trust_score is hidden by design

-- Grant permissions (no grant for trust_events — server-only)
grant select, insert, update on journal_entries to authenticated;
grant select, insert, update, delete on metrics to authenticated;
grant select, insert on metric_points to authenticated;
grant select, insert, update on anchor_plans to authenticated;
grant select, insert, update on habits to authenticated;
grant select, insert, update on persona_stats to authenticated;