-- Migration 0003_chat_doings
-- Create messages and doings_logs tables per TECH-SPECS §3.2

-- Messages table
create table messages (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('user','assistant')),
    content text not null,
    unsavable boolean not null default false,
    client_sent_at timestamptz,
    metadata jsonb default '{}',
    created_at timestamptz default now()
);

-- Doings logs table
create table doings_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('doing','impulse_failure')),
    content text,
    energy int check (energy between 1 and 10),
    source text not null check (source in ('checkin_reply','chat','app','quick_action')),
    logged_at timestamptz not null,
    checkin_window timestamptz,
    embed_model text,
    embedding vector(768),
    created_at timestamptz default now()
);

-- Indexes
create index messages_thread_idx on messages (user_id, created_at desc);
create index doings_user_time_idx on doings_logs (user_id, logged_at desc);
create index idx_doings_logs_checkin_window on doings_logs (user_id, checkin_window);

-- RLS will be enabled in migration 0005_rls_core