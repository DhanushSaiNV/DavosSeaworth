-- Migration 0016_messages_client_id
-- FP-02 Step 4: client-generated dedupe key on `messages` (FR-16, TECH-SPECS §3.2, §7.10).
-- `send-message` inserts the user row with this key and skips the pipeline on a repeat,
-- so a retried/duplicated send never produces a second user row or a second reply.

alter table messages add column if not exists client_message_id uuid;

-- Dedupe by (user, client_message_id). Plain (not partial) so PostgREST's
-- `on_conflict=user_id,client_message_id` inference is unambiguous — a partial index
-- requires the statement to carry a matching predicate.
--
-- NULL is load-bearing: assistant rows leave `client_message_id` NULL, and Postgres
-- treats NULLs as distinct in a unique index, so assistant rows never collide with
-- each other or with user rows. Do not "clean up" this index to NOT NULL.
create unique index if not exists messages_user_client_msg_uniq
  on messages (user_id, client_message_id);
