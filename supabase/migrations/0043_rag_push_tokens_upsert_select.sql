-- Migration 0043_rag_push_tokens_upsert_select
--
-- Fix-forward for 0040. 0040 revoked SELECT on `push_tokens` on the reasoning that `lib/push.ts:82`
-- asks for no representation (`return=minimal`), so "no SELECT is required". That reasoning was
-- wrong, and it broke push registration in production.
--
-- `INSERT ... ON CONFLICT (user_id, token) DO UPDATE` requires SELECT privilege on the target table
-- regardless of the requested response representation: the executor locks and re-reads the
-- conflicting tuple to apply the update. Without the privilege the statement fails with
--   42501  permission denied for table push_tokens
-- so every device silently stops receiving notifications.
--
-- Reproduced against the migrated schema before writing this migration:
--   set role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<uuid>"}', false);
--   insert into public.push_tokens (user_id, token, platform)
--     values ('<uuid>'::uuid, 'tok', 'ios')
--     on conflict (user_id, token) do update set platform = excluded.platform;
--   => ERROR: permission denied for table push_tokens
--
-- A column-level `GRANT SELECT (user_id, token)` is NOT sufficient; Postgres demands the
-- table-level privilege for the ON CONFLICT path. Also verified.
--
-- So `push_tokens` returns to its pre-0040 client contract, which is what `0005:56` (the DML grant)
-- and `0005:22` (the own-rows read policy) established. The RAG redesign has no reason to change
-- how push registration works, and least privilege here would cost a shipped feature.
--
-- What 0040's `REVOKE ALL` still buys us is kept: TRUNCATE, REFERENCES and TRIGGER are not
-- re-granted (the pre-0040 `arwdDxtm` included all three). Only the four DML privileges return.
--
-- Deliberately still not granted:
--   * `anon` - no privilege on this table at all (`0005` never granted it; `0036:96` removed what
--     had leaked in).
--   * TRUNCATE / REFERENCES / TRIGGER.
--   * any column outside the table's own set: there is no column-level grant on this table, so the
--     client can read `id, user_id, token, platform, created_at` of its own rows and nothing else.

grant select, insert, update, delete on public.push_tokens to authenticated;

-- Restore the own-rows read policy 0040 dropped. Without it the SELECT privilege above would
-- expose every user's push token; with it, a token is only ever visible to its owner.
drop policy if exists push_tokens_select_own on public.push_tokens;

create policy push_tokens_select_own on public.push_tokens
  for select using (auth.uid() = user_id);

-- Make PostgREST rebuild its schema cache immediately rather than on the next DDL.
notify pgrst, 'reload schema';

-- Verify (expect `authenticated=arwd` - no T/R/X - and no `anon` entry):
--   select relacl::text from pg_class where oid = 'public.push_tokens'::regclass;
--
-- Verify (expect the four own-rows policies):
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.push_tokens'::regclass order by polname;
