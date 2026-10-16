-- Migration 0021_llm_retry_config
-- FP-02 Step 8: sync-degrade + `llm_retry` timing values (TECH-SPECS §4.1, §2.2, §2.3, §11).
--
-- AGENTS.md §2: [SPEC] values live in the `config` table and are read at runtime —
-- never hardcoded into logic.
--
-- `llm_call_timeout_ms` is what makes the 150 s synchronous limit provable: without a
-- per-call timeout a hung provider socket burns the whole invocation budget and the
-- invocation is killed mid-pipeline, orphaning the turn (the user row is already
-- committed). `pipeline_deadline_ms` is the backstop: the pipeline bails to the
-- sync-degrade path before the platform can kill it.
--
-- `job_dispatcher_budget_ms` is the same discipline for the async path (§2.2): a dispatcher
-- tick stops starting jobs once the next handler's worst case no longer fits, and releases
-- the claims it never reached so they cannot burn an attempt. It must stay below the 150 s
-- invocation limit with room to settle the batch (10 s of headroom here).
--
-- NB: `value` is jsonb — the quoted '30000' is parsed as the JSON number 30000
-- (a bare 30000 fails: "cannot cast type integer to jsonb"); matches the 0001/0017 convention.
--
-- Refs: FP-02 FR-3, FR-4; TECH-SPECS §4.1, §2.2, §2.3, §11; D12, D18.

insert into config (key, value, description) values
('llm_call_timeout_ms', '30000', 'Per-provider-call timeout (AbortSignal) for every LLM/embedding fetch; a timeout counts as a transport failure'),
('pipeline_deadline_ms', '120000', 'Total synchronous pipeline budget from invocation start; the pipeline degrades rather than risk the 150 s invocation limit'),
('job_dispatcher_budget_ms', '140000', 'Wall-clock budget for one job-dispatcher tick; it stops starting jobs (and releases their claims) once the next handler could not finish inside it');

grant select on config to anon, authenticated;

-- Verify:
-- select key, value, jsonb_typeof(value) from config
-- where key in ('llm_call_timeout_ms','pipeline_deadline_ms','job_dispatcher_budget_ms')
-- order by key;
