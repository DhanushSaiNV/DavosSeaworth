-- Migration 0001_extensions_config
-- Enable required extensions and create config table with §11 approved values

-- Enable extensions
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists vector;

-- Create config table
create table if not exists config (
    key text primary key,
    value jsonb not null,
    description text
);

-- Seed config table with all §11 approved values
insert into config (key, value, description) values
-- Confidence bands for persona determination
('confidence_bands', '{"high": 0.75, "medium_low": 0.55, "medium_high": 0.74, "low_low": 0.40, "low_high": 0.54, "fallback": 0.40}', 'Confidence thresholds for three-tier persona routing'),

-- Emotion labels for classifier
('emotion_labels', '["frustrated", "exhausted", "anxious", "proud", "determined", "avoidant"]', 'Six-state emotion label set for classifier'),

-- Trust threshold for Oath/breakdown triggers
('trust_threshold', '70', 'Trust score threshold (0-100) for Oath demand and breakdown intervention'),

-- Strike watch window default days
('strike_watch_days_default', '7', 'Default watch window days for Strike lifecycle'),

-- Preemptive push lead time in minutes
('preemptive_lead_minutes', '15', 'Minutes before predicted urge window to send preemptive push'),

-- Habit detection thresholds
('habit_detection_thresholds', '{"impulse_failures_per_week": 3, "journal_flags_per_week": 3}', 'Thresholds for habit detection via drift_scan'),

-- Default check-in cadence in minutes
('checkin_cadence_default', '60', 'Default check-in interval (60 or 120 minutes)'),

-- Watchdog grace period in minutes
('watchdog_grace_minutes', '10', 'Grace period after check-in window closes before marking missed'),

-- Lockdown circuit breaker hours
('lockdown_circuit_breaker_hours', '24', 'Auto-exit lockdown after this many hours'),

-- Sliding window message count for immediate context
('sliding_window_messages', '8', 'Number of recent messages passed as immediate context to generation'),

-- Sync degrade reply (holding message when sync generation fails)
('sync_degrade_reply', '"Noted. Give me a second."', 'Holding message sent immediately when synchronous generation fails over to async retry'),

-- Malformed fallback reply (when JSON parse fails after retry)
('malformed_fallback_reply', '"Something went wrong. Let me try again."', 'Fallback response when generation output fails structural parse after one retry');

-- Grant read access to anon/authenticated roles
grant select on config to anon, authenticated;