-- Migration 0017_primary_reply_guard
-- FP-02 Step 5a: at-most-one *primary reply* per user message, plus the client
-- message-length cap.
--
-- Refs: FP-02 FR-5 (idempotency), FR-16; TECH-SPECS §3.2, §5.1, §7.10, §11; D23.
--
-- Vocabulary (TECH-SPECS §3.2):
--   primary reply   — the pipeline's single assistant answer to a user message.
--                     Carries reply_to_message_id; at most one per user message.
--   secondary reply — a later re-run for the same user message (select-persona,
--                     Step 6). MUST leave reply_to_message_id NULL so this guard
--                     never blocks it.

alter table messages add column if not exists reply_to_message_id uuid;

-- Backfill rows written before this migration from metadata.user_message_id. The
-- earliest assistant row per user message wins, so the unique index below always
-- builds (a stray second reply for the same turn would otherwise collide).
-- Values are shape-checked before the ::uuid cast so junk metadata cannot abort it.
with ranked as (
  select
    id,
    (metadata->>'user_message_id')::uuid as user_message_id,
    row_number() over (
      partition by metadata->>'user_message_id'
      order by created_at, id
    ) as rn
  from messages
  where role = 'assistant'
    and reply_to_message_id is null
    and metadata->>'user_message_id' ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)
update messages m
set reply_to_message_id = r.user_message_id
from ranked r
where m.id = r.id and r.rn = 1;

-- At most one primary reply per user message. The indexed value is a user row's
-- `id` (a globally unique pk), so no user_id column is needed.
-- Deliberately NOT a foreign key: account deletion removes a user's parent and
-- child rows in one statement, which immediate FK enforcement can reject.
create unique index if not exists messages_one_primary_reply
  on messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- Client message-length cap. AGENTS.md §2: the server and the composer share one
-- runtime value instead of two hardcoded literals.
-- NB: `value` is jsonb — the quoted '8000' is parsed as the JSON number 8000
-- (a bare 8000 fails: "cannot cast type integer to jsonb"); matches the 0001 convention.
insert into config (key, value, description) values
('chat_max_message_chars', '8000', 'Maximum user message length in characters; enforced by send-message and the composer');

grant select on config to anon, authenticated;

-- Verify:
-- select count(*) from messages
--   where role = 'assistant' and metadata ? 'user_message_id' and reply_to_message_id is null;
-- → must be 0.
