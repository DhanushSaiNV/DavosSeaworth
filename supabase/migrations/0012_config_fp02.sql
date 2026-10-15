-- Migration 0012_config_fp02
-- FP-02 Step 1: New config keys for provider adapter and dev modes

insert into config (key, value, description) values
('llm_stub_mode', 'false', 'Dev-only: when true, adapter returns canned schema-valid responses without calling providers'),
('llm_force_fail', '"none"', 'Dev-only: force provider failure ("none"|"primary"|"both") for testing retry/dead-letter paths'),
('dev_overrides_enabled', 'true', 'Dev-only: when false, forced persona/route params in send-message are ignored');

grant select on config to anon, authenticated;