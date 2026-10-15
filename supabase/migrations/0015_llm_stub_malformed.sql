-- Migration 0015_llm_stub_malformed
-- FP-02 Step 3: dev-only toggle that makes stub mode return invalid JSON, so the
-- §4.2 "exactly one bounded parse retry → malformed_fallback_reply" path can be
-- exercised without touching the network or burning provider quota.

insert into config (key, value, description) values
('llm_stub_malformed', 'false', 'dev-only: when true, stub mode returns invalid JSON to exercise the §4.2 bounded parse retry');
