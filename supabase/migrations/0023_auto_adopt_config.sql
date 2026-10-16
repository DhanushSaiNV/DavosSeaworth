-- Migration 0023_auto_adopt_config
-- FP-02 Step 10: the D8 `auto_adopt_successes` write path (TECH-SPECS §3.4, §5.3, §5.4, §11).
--
-- AGENTS.md §2: [SPEC] values live in the `config` table and are read at runtime — never
-- hardcoded into logic. §3.4 marks the 10-minute D8 window [SPEC], so it becomes a key
-- rather than a literal in `send-message`.
--
-- The increment is a function, not a read-modify-write from the Edge Function: supabase-js
-- cannot express `col = col + 1` inside an upsert (PostgREST has no arithmetic), and Step 5a
-- proved two invocations of `send-message` can race for the same user
-- (`messages_one_primary_reply`). `persona_stats` has no write-time guard of its own, so a
-- read-modify-write would lose an update silently. Same hardening as `claim_jobs` (0008):
-- SECURITY DEFINER with a pinned `search_path`, execute revoked from public/anon/
-- authenticated and granted to `service_role` only, so the increment the counter performs is
-- never client-callable (AGENTS.md §4.1). NB the table's own `persona_stats_*_own` policies
-- (0007) still permit a user to write **their own** row through PostgREST — a pre-existing
-- surface that can only ever fudge the caller's own weighting, and not what this
-- migration's grant controls.
--
-- Which rows count (owner decision 2026-10-16, recorded in TECH-SPECS §5.3): the **sync
-- pipeline's own primary reply** with `metadata.route='auto'` — i.e. the row immediately
-- preceding the new user message, measured on the server clock. An `llm_retry` secondary
-- row carries the original turn's route by design (§3.2), so a High-tier turn degraded by an
-- outage and answered minutes later would otherwise look exactly like an accepted
-- auto-adoption; D8's signal is engagement with a persona the system picked, which an answer
-- the user had stopped waiting for is not. Nothing reads the counter yet — `band_shift` is
-- written by the §5.4 rider, out of FP-02 scope — so FP-03 is its first consumer.
--
-- Refs: FP-02 FR-14, AC-9; TECH-SPECS §3.4, §5.3, §5.4, §11; D8.

insert into config (key, value, description) values
('auto_adopt_window_minutes', '10', 'D8 window: a user message within this many minutes of an auto-adopted PRIMARY reply counts as an auto_adopt_success (§5.3)');

grant select on config to anon, authenticated;

-- Atomic insert-on-conflict increment; SECURITY DEFINER so the caller's role cannot matter
-- and the pinned search_path keeps a hostile schema off the resolution path.
create or replace function public.increment_auto_adopt_successes(p_user_id uuid, p_domain text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.persona_stats (user_id, domain, auto_adopt_successes)
  values (p_user_id, p_domain, 1)
  on conflict (user_id, domain)
  do update set auto_adopt_successes = public.persona_stats.auto_adopt_successes + 1;
$$;

revoke execute on function public.increment_auto_adopt_successes(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_auto_adopt_successes(uuid, text) to service_role;

-- Verify:
-- select key, value, jsonb_typeof(value) from config where key = 'auto_adopt_window_minutes';
-- select p.proname, p.prosecdef, p.proconfig from pg_proc p
--   where p.proname = 'increment_auto_adopt_successes';
