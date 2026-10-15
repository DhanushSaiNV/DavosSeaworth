-- Migration 0020_push_config
-- FP-02 Step 7: Expo push notification config values (TECH-SPECS §7.10, §11).
--
-- AGENTS.md §2: [SPEC] values live in the `config` table and are read at runtime —
-- never hardcoded into logic.
--
-- Refs: FP-02 FR-15; D23.

insert into config (key, value, description) values
('expo_push_enabled', 'true', 'Master toggle for Expo push sends (AI messages, interventions, etc.)'),
('vapid_public_key', '""', 'VAPID public key for Web Push (from `npx web-push generate-vapid-keys`); empty = web push falls back to in-app banner');

grant select on config to anon, authenticated;

-- Verify:
-- select key, value, jsonb_typeof(value) from config
-- where key in ('expo_push_enabled','vapid_public_key')
-- order by key;