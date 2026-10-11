-- Migration 0002_auth_profiles
-- Create profiles and push_tokens tables per TECH-SPECS §3.2, §3.4

-- Profiles table
create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    timezone text default 'UTC',
    onboarding_stage text not null default 'intro'
        check (onboarding_stage in ('intro','baseline','goals','routine','metric_selection','complete')),
    checkin_cadence_minutes int not null default 60
        check (checkin_cadence_minutes in (60, 120)),
    checkin_active_hours_start time not null default '08:00',
    checkin_active_hours_end time not null default '22:00',
    wake_time time,
    sleep_time time,
    routine jsonb default '{}',
    high_dopamine_activities jsonb default '[]',
    trust_score int not null default 0 check (trust_score between 0 and 100),
    dialog_state text not null default 'OPEN' check (dialog_state in ('OPEN','LOCKDOWN')),
    lockdown_started_at timestamptz,
    latest_energy int check (latest_energy between 1 and 10),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Push tokens table
create table push_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    token text not null,
    platform text check (platform in ('ios','android','web')),
    created_at timestamptz default now(),
    unique (user_id, token)
);

-- Indexes
create index if not exists idx_push_tokens_user_id on push_tokens(user_id);

-- RLS will be enabled in migration 0005_rls_core