begin;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('review.complete-period.v1', 'low', array['ui', 'chat'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_period_review_operation(
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
  v_kind text;
  v_horizon_kind text;
  v_starts_on date;
  v_ends_on date;
  v_horizon_id uuid;
  v_review_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'review.complete-period.v1'
    or p_surface not in ('ui', 'chat')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200
    or not (p_input ?& array['kind', 'startsOn', 'endsOn', 'reflectionMarkdown'])
    or char_length(trim(coalesce(p_input ->> 'reflectionMarkdown', ''))) not between 1 and 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
  end if;
  v_kind := p_input ->> 'kind';
  v_starts_on := (p_input ->> 'startsOn')::date;
  v_ends_on := (p_input ->> 'endsOn')::date;
  if (v_kind = 'monthly' and (
      extract(day from v_starts_on) <> 1
      or v_ends_on <> (v_starts_on + interval '1 month - 1 day')::date
    )) or (v_kind = 'quarterly' and (
      extract(day from v_starts_on) <> 1
      or extract(month from v_starts_on)::integer not in (1, 4, 7, 10)
      or v_ends_on <> (v_starts_on + interval '3 months - 1 day')::date
    )) or v_kind not in ('monthly', 'quarterly') then
    raise exception using errcode = 'P0001', message = 'invalid_review_range';
  end if;

  select id, timezone into v_workspace_id, v_timezone
  from public.workspaces where owner_user_id = v_user_id;
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

  v_horizon_kind := case when v_kind = 'monthly' then 'month' else 'quarter' end;
  insert into public.planning_horizons (
    workspace_id, kind, starts_on, ends_on, timezone_snapshot
  ) values (
    v_workspace_id, v_horizon_kind, v_starts_on, v_ends_on, v_timezone
  )
  on conflict (workspace_id, kind, starts_on) do update set
    ends_on = excluded.ends_on,
    timezone_snapshot = excluded.timezone_snapshot
  returning id into v_horizon_id;

  if exists (
    select 1 from public.reviews
    where workspace_id = v_workspace_id and horizon_id = v_horizon_id
      and kind = v_kind and status = 'completed'
  ) then
    raise exception using errcode = 'P0001', message = 'review_already_completed';
  end if;
  insert into public.reviews (
    workspace_id, horizon_id, kind, status, reflection_markdown, completed_at
  ) values (
    v_workspace_id, v_horizon_id, v_kind, 'completed',
    trim(p_input ->> 'reflectionMarkdown'), clock_timestamp()
  ) returning id into v_review_id;

  v_result := jsonb_build_object(
    'reviewId', v_review_id,
    'status', 'completed',
    'kind', v_kind
  );
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low', 'review', v_review_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, 'review', v_review_id, 'low',
    case when p_surface = 'chat' then 'approved' else 'explicit_ui_commit' end,
    'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or not_null_violation
    or unique_violation then
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
  if p_operation_id in ('goal.update.v1', 'action.move.v1') then
    v_result := public.execute_plan_edit_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id in ('action.update.v1', 'daily-focus.set.v1') then
    v_result := public.execute_daily_execution_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'workspace.%' then
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
  elsif p_operation_id = 'review.complete-period.v1' then
    v_result := public.execute_period_review_operation(
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

revoke all on function public.execute_period_review_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
