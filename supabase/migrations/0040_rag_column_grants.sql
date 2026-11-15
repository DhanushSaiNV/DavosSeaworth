-- Migration 0040_rag_column_grants
-- RAG redesign Phase 0 (PLAN.md §7, owner decisions B-8 approved 2026-11-15).
--
-- Pattern, applied to every relation here: `REVOKE ALL` from anon + authenticated, then re-grant
-- ONLY the privileges a verified consumer needs, at COLUMN granularity wherever the client reads
-- a subset. Column-level REVOKE is a no-op while a table-level SELECT exists, so the table-level
-- privilege has to go first - that is the whole point of this migration.
--
-- Every grant below was derived from the actual SELECT projection in client source, not from a
-- relation reference. The complete client surface is eight files; the projections are:
--
--   profiles       todayService.ts:75      id, checkin_cadence_minutes,
--                                          checkin_active_hours_start,
--                                          checkin_active_hours_end, timezone
--                  checkins.ts:128,184     timezone, checkin_cadence_minutes,
--                                          checkin_active_hours_start, checkin_active_hours_end
--                  onboardingStage.ts:17  onboarding_stage
--   doings_logs    todayService.ts:155     id, user_id, kind, content, energy, source,
--                                          logged_at, checkin_window
--                  proofService.ts:59      same eight
--   messages       chatService.ts:58,81    id, user_id, role, content, unsavable,
--                                          client_message_id, reply_to_message_id,
--                                          client_sent_at, created_at, metadata
--   metrics        metricsService.ts:105   id, name, domain, output_unit, is_quest,
--                                          quest_status, quest_deadline, created_at,
--                                          formula_status, archived_at
--                                          (+ user_id, used by the .eq() filter and by the
--                                           metric_points_select_own EXISTS join)
--   metric_points  metricsService.ts:129   metric_id, value, computed_for
--   anchor_plans   todayService.ts:105     anchors (+ user_id, plan_date, both filter columns)
--   push_tokens    push.ts:82,101          upsert + delete (SELECT required too - corrected in 0043)
--
-- Deliberately NOT granted: `metrics.is_core` (server-only: select-metrics:109,
-- runProactive:149, create.ts:87), `metrics.formula` (PRD line 545), `profiles.display_name`
-- (selected by nothing), `doings_logs.created_at` (selected by nothing), `doings_logs.embedding`.
--
-- Two unused column-level UPDATE grants are revoked (owner decision B-8):
--   messages.unsavable  - created by 0036:70 for a client-direct flag path that does not exist;
--                         flag-unsavable/index.ts:27,75,101-103 writes via supabaseService.
--   profiles.display_name - created by 0036:64 for a "future profile-edit screen" that has not
--                         shipped; no client .update() on profiles exists anywhere.
-- Both are one-line restorations (grant + policy) if a screen ships later.
--
-- Refs: PLAN.md §7; RAG PRD §6.1, §9.2; AGENTS.md §4.1, §4.7.

-- ---------------------------------------------------------------------------- profiles

revoke all on public.profiles from anon, authenticated;
revoke update (display_name) on public.profiles from anon, authenticated;

grant select (
  id,
  timezone,
  onboarding_stage,
  checkin_cadence_minutes,
  checkin_active_hours_start,
  checkin_active_hours_end
) on public.profiles to authenticated;

-- Writes: the profiles-creation path is the `on_auth_user_created` -> handle_new_user() definer
-- trigger; settings go through update_checkin_prefs() (0026), which is SECURITY DEFINER. Neither
-- needs a client privilege, so the insert/update policies are now unreachable and are dropped.
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

-- ---------------------------------------------------------------------------- doings_logs

revoke all on public.doings_logs from anon, authenticated;

grant select (
  id,
  user_id,
  kind,
  content,
  energy,
  source,
  logged_at,
  checkin_window
) on public.doings_logs to authenticated;

drop policy if exists doings_logs_insert_own on public.doings_logs;
drop policy if exists doings_logs_update_own on public.doings_logs;
drop policy if exists doings_logs_select_own on public.doings_logs;
create policy doings_logs_select_own on public.doings_logs
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------- messages

revoke all on public.messages from anon, authenticated;
revoke update (unsavable) on public.messages from anon, authenticated;

-- Table-level SELECT, not column-level: lib/chatService.ts:163-165 subscribes to
-- postgres_changes on `messages`, and Realtime evaluates RLS but does not apply column
-- privileges to the WAL payload. Column exclusion for retrieval is enforced by the
-- query_conversation RPC return shape (0045), not by privilege. Owner decision B-1.
grant select on public.messages to authenticated;

drop policy if exists messages_insert_own on public.messages;
drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------- metrics

revoke all on public.metrics from anon, authenticated;

grant select (
  id,
  user_id,
  name,
  domain,
  output_unit,
  is_quest,
  quest_status,
  quest_deadline,
  formula_status,
  archived_at,
  created_at
) on public.metrics to authenticated;

drop policy if exists metrics_insert_own on public.metrics;
drop policy if exists metrics_update_own on public.metrics;
drop policy if exists metrics_delete_own on public.metrics;
drop policy if exists metrics_select_own on public.metrics;
create policy metrics_select_own on public.metrics
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------- metric_points

revoke all on public.metric_points from anon, authenticated;

grant select (metric_id, value, computed_for) on public.metric_points to authenticated;

drop policy if exists metric_points_insert_own on public.metric_points;
-- metric_points_select_own EXISTS-joins metrics on (id, user_id), which is why the metrics
-- grant above keeps both columns.
drop policy if exists metric_points_select_own on public.metric_points;
create policy metric_points_select_own on public.metric_points
  for select to authenticated using (
    exists (
      select 1 from public.metrics m
      where m.id = metric_points.metric_id
        and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------- anchor_plans

revoke all on public.anchor_plans from anon, authenticated;

grant select (user_id, plan_date, anchors) on public.anchor_plans to authenticated;

-- Writes go through save_anchor_plan() (0037), which is SECURITY DEFINER.
drop policy if exists anchor_plans_insert_own on public.anchor_plans;
drop policy if exists anchor_plans_update_own on public.anchor_plans;
drop policy if exists anchor_plans_select_own on public.anchor_plans;
create policy anchor_plans_select_own on public.anchor_plans
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------- push_tokens

revoke all on public.push_tokens from anon, authenticated;

-- The client's one legitimate direct write: upsert (push.ts:82) needs INSERT + UPDATE, and
-- deregistration (push.ts:101) needs DELETE.
--
-- CORRECTED BY 0043: the original reasoning here said "neither call asks for a representation
-- (`return=minimal`), so no SELECT is required". That is WRONG. `INSERT ... ON CONFLICT DO UPDATE`
-- requires table-level SELECT on the target table regardless of the requested representation,
-- because the executor locks and re-reads the conflicting tuple. Revoking SELECT broke push
-- registration with `42501 permission denied for table push_tokens`. 0043 restores SELECT plus
-- this policy; see its header for the reproduction.
grant insert, update, delete on public.push_tokens to authenticated;

drop policy if exists push_tokens_select_own on public.push_tokens;

-- Verify:
--   -- expect exactly the columns listed above, and nothing for anon
--   select c.relname, a.attname, a.attacl
--     from pg_attribute a join pg_class c on c.oid = a.attrelid
--    where c.relnamespace = 'public'::regnamespace
--      and c.relname in ('profiles','doings_logs','metrics','metric_points','anchor_plans')
--      and a.attacl is not null
--    order by 1, 2;
--
--   select c.relname, coalesce(array_to_string(c.relacl, ' | '), '(default)') as acl
--     from pg_class c
--    where c.relnamespace = 'public'::regnamespace
--      and c.relname in ('profiles','doings_logs','messages','metrics','metric_points',
--                        'anchor_plans','push_tokens')
--    order by 1;
--
--   -- expect zero rows (the two revoked column grants)
--   select c.relname, a.attname
--     from pg_attribute a join pg_class c on c.oid = a.attrelid
--    where c.relnamespace = 'public'::regnamespace
--      and ((c.relname = 'messages' and a.attname = 'unsavable')
--        or (c.relname = 'profiles' and a.attname = 'display_name'))
--      and a.attacl is not null;
