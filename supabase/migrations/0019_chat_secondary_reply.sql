-- Migration 0019_chat_secondary_reply
-- FP-02 Step 6: schema for *secondary replies* — the Medium tier's `select-persona`
-- chip re-run (§5.3).
--
-- Refs: FP-02 FR-11, FR-10; TECH-SPECS §3.2, §5.3, §7.10; D13.
--
-- Vocabulary (TECH-SPECS §3.2):
--   primary reply   — the pipeline's single answer to a user message; carries
--                     `reply_to_message_id` and is guarded by `messages_one_primary_reply`.
--   secondary reply — a later re-run for the same user message (the Medium tier's chip
--                     tap). MUST leave `reply_to_message_id` NULL so the primary guard
--                     never blocks it, so it records the user message it re-answers in
--                     `secondary_reply_to_message_id` instead.

alter table messages add column if not exists persona_key text;
alter table messages add column if not exists secondary_reply_to_message_id uuid;

-- At most one secondary reply per user message. The Medium tier's chips are a single
-- "how should I engage now?" question, so one tap consumes the whole option set
-- (AC-3: "consumed options reject re-selection"). The anchor is a *separate* column
-- from `reply_to_message_id` precisely so this guard can never interact with the
-- primary-reply one — a secondary row must stay invisible to it.
create unique index if not exists messages_one_secondary_reply
  on messages (secondary_reply_to_message_id)
  where secondary_reply_to_message_id is not null;

-- Verify:
--   select count(*) from messages where persona_key is not null and role <> 'assistant';   -- must be 0
--   select count(*) from messages where secondary_reply_to_message_id is not null
--     and reply_to_message_id is not null;                                                 -- must be 0
