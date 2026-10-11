-- Migration 0004_profiles_trigger
-- Create trigger to auto-create profiles row on new auth user

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, onboarding_stage, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end, dialog_state)
  values (
    new.id,
    'intro',
    60,
    '08:00'::time,
    '22:00'::time,
    'OPEN'
  );
  return new;
end;
$$;

-- Drop existing trigger if exists (idempotent)
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Grant execute to service role for any manual invocations
grant execute on function public.handle_new_user() to service_role;