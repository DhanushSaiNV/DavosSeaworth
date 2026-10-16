-- Migration 0022_chat_queue_config
-- FP-02 Step 9: offline send-queue bound (TECH-SPECS §7.10, §11, §12).
--
-- AGENTS.md §2: [SPEC] values live in the `config` table and are read at runtime —
-- never hardcoded into logic.
--
-- The offline queue (FR-16) is device-local, but its bound is not a free choice: it caps
-- both AsyncStorage growth and the reconnect replay burst, which is a burst of full
-- pipeline runs (one Gemini extraction + one embedding + one generation call each). §12
-- budgets those calls on a 5-user basis, so the bound belongs in the registry with the
-- other chat limits rather than in the client bundle.
--
-- Refs: FP-02 FR-16, AC-8; TECH-SPECS §7.10, §11, §12; D23.

insert into config (key, value, description) values
('chat_queue_max_items', '20', 'Max unsent messages held in the device offline queue; also caps the reconnect replay burst (each item is one pipeline run)');

grant select on config to anon, authenticated;

-- Verify:
-- select key, value, jsonb_typeof(value) from config
-- where key = 'chat_queue_max_items';
