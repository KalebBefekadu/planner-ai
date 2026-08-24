begin;

alter table public.workspaces
  add column ai_enabled boolean not null default true,
  add column weekly_review_day smallint not null default 0
    check (weekly_review_day between 0 and 6),
  add column onboarding_completed_at timestamptz;

update public.workspaces set onboarding_completed_at = clock_timestamp()
where onboarding_completed_at is null;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible)
values ('workspace.preferences.v1', 'medium', array['ui', 'chat'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_workspace_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_timezone text;
  v_week_starts_on smallint;
  v_coaching_intensity text;
  v_ai_enabled boolean;
  v_weekly_review_day smallint;
  v_completed_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'workspace.preferences.v1' then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'automation', 'system')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  v_timezone := p_input ->> 'timezone';
  v_week_starts_on := (p_input ->> 'weekStartsOn')::smallint;
  v_coaching_intensity := p_input ->> 'coachingIntensity';
  v_ai_enabled := (p_input ->> 'aiEnabled')::boolean;
  v_weekly_review_day := (p_input ->> 'weeklyReviewDay')::smallint;
  if not exists (select 1 from pg_timezone_names where name = v_timezone)
    or v_week_starts_on not between 0 and 6
    or v_coaching_intensity not in ('calm', 'direct', 'strict')
    or v_weekly_review_day not between 0 and 6 then
    raise exception using errcode = 'P0001', message = 'invalid_workspace_preferences';
  end if;
  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0)
  );
  select result_json into v_result from public.operation_receipts
  where workspace_id = v_workspace_id and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key and status = 'succeeded';
  if found then return v_result; end if;

  update public.workspaces set
    timezone = v_timezone,
    week_starts_on = v_week_starts_on,
    coaching_intensity = v_coaching_intensity,
    ai_enabled = v_ai_enabled,
    weekly_review_day = v_weekly_review_day,
    onboarding_completed_at = coalesce(onboarding_completed_at, clock_timestamp())
  where id = v_workspace_id
  returning onboarding_completed_at into v_completed_at;
  v_result := jsonb_build_object(
    'workspaceId', v_workspace_id,
    'timezone', v_timezone,
    'weekStartsOn', v_week_starts_on,
    'coachingIntensity', v_coaching_intensity,
    'aiEnabled', v_ai_enabled,
    'weeklyReviewDay', v_weekly_review_day,
    'onboardingCompletedAt', v_completed_at
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'medium', 'workspace', v_workspace_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'workspace', v_workspace_id, 'medium',
    case when p_surface = 'chat' then 'approved' else 'explicit_ui_commit' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$$;

create or replace function public.dispatch_trusted_operation(
  p_operation_id text,
  p_input jsonb,
  p_idempotency_key text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_operation_surface';
  end if;
  perform 1 from public.operation_contracts
  where operation_id = p_operation_id and p_surface = any(exposures);
  if not found then
    raise exception using errcode = '42501', message = 'operation_surface_not_allowed';
  end if;
  if p_operation_id like 'workspace.%' then
    v_result := public.execute_workspace_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id in (
    'note.goal-link.v1', 'note.goal-unlink.v1',
    'note.action-link.v1', 'note.action-unlink.v1'
  ) then
    v_result := public.execute_note_relation_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'review.%' then
    v_result := public.execute_review_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id in (
    'note.tags.set.v1', 'note.link.v1', 'note.unlink.v1', 'capture.file-to-note.v1'
  ) then
    v_result := public.execute_knowledge_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'note.%' then
    v_result := public.execute_note_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'memory.%' then
    v_result := public.execute_memory_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  elsif p_operation_id like 'trash.%' then
    v_result := public.execute_trash_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  else
    v_result := public.execute_planner_operation(p_operation_id, p_input, p_idempotency_key, p_surface);
  end if;
  return v_result;
end;
$$;

revoke all on function public.execute_workspace_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
