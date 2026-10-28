-- Migration 0035_onboarding_opening_content.sql
-- BG-06 / FP-09 Step 6 — owner-approved opening copy promotion.
--
-- Refs: BG-06; FP-09 FR-6, FR-14, AC-8; TECH-SPEC §7.7; AGENTS.md §8.4.
--
-- Promotes the approved onboarding opening copy into config.onboarding_opening_text
-- and rewrites existing tagged opening rows (metadata.source = 'onboarding_opening')
-- to match, ensuring both fresh deployments and existing installations receive the approved copy.

insert into public.config (key, value, description)
values (
  'onboarding_opening_text',
  to_jsonb($copy$Hey, it's Davos. We'll get to the big stuff soon enough — first, how's your day actually going?$copy$::text),
  '§7.7/FR-6: the deterministic first assistant row — owner-approved opening copy (BG-06)'
)
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

update public.messages
   set content = $copy$Hey, it's Davos. We'll get to the big stuff soon enough — first, how's your day actually going?$copy$
 where metadata ->> 'source' = 'onboarding_opening';
