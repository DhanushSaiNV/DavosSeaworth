-- Migration 0037_anchor_plans_write_rpc
-- Provides the validated client-callable write path for daily anchor plans (PlanEditorModal).
-- Migration 0036 revoked direct DML on anchor_plans under the least-privilege policy;
-- this SECURITY DEFINER function safely gates writes to auth.uid().

create or replace function public.save_anchor_plan(
  p_plan_date date,
  p_anchors jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'save_anchor_plan: not authenticated';
  end if;

  if p_plan_date is null then
    raise exception 'save_anchor_plan: p_plan_date is required';
  end if;

  if p_anchors is null or jsonb_typeof(p_anchors) != 'array' then
    raise exception 'save_anchor_plan: p_anchors must be a jsonb array';
  end if;

  insert into public.anchor_plans (user_id, plan_date, anchors)
  values (v_uid, p_plan_date, p_anchors)
  on conflict (user_id, plan_date)
  do update set anchors = excluded.anchors
  returning id, user_id, plan_date, anchors, created_at into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'user_id', v_row.user_id,
    'plan_date', v_row.plan_date,
    'anchors', v_row.anchors,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.save_anchor_plan(date, jsonb) from public, anon;
grant execute on function public.save_anchor_plan(date, jsonb) to authenticated, service_role;
