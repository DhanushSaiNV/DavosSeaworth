-- Migration 0018_config_chat_client
-- FP-02 Step 5b: the [SPEC] values the chat client reads at runtime.
--
-- AGENTS.md §2: [SPEC] values live in the `config` table and are read at runtime —
-- never hardcoded into logic. The client loads this table once per session
-- (`lib/config.ts`, kicked off from `app/(app)/_layout.tsx`) and fails closed when a
-- key is missing.
--
-- NB: `value` is jsonb — the quoted numbers are parsed as JSON numbers (a bare 90000
-- fails: "cannot cast type integer to jsonb"); matches the 0001 numeric-key convention.
--
-- Refs: FP-02 FR-17; TECH-SPECS §7.10, §9, §11; D23.

insert into config (key, value, description) values
('chat_send_timeout_ms', '90000', 'Client timeout for the send-message invocation (ms); below the verified 150 s sync limit'),
('chat_realtime_watchdog_ms', '8000', 'Delay before the chat client re-selects an assistant row Realtime has not delivered (ms)'),
('chat_retry_holdoff_ms', '150000', 'Minimum delay before retrying a send whose outcome is unknown (ms); matches the 150 s sync limit so no second pipeline run starts while the first may still be alive'),
('chat_last_n', '50', 'Number of recent messages the chat thread loads (newest first)');

grant select on config to anon, authenticated;

-- Verify:
-- select key, value, jsonb_typeof(value) from config
-- where key in ('chat_max_message_chars','chat_send_timeout_ms','chat_realtime_watchdog_ms','chat_retry_holdoff_ms','chat_last_n')
-- order by key;
