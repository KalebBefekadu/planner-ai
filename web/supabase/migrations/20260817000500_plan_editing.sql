begin;

insert into public.operation_contracts (operation_id, risk_class, exposures, reversible) values
  ('goal.update.v1', 'low', array['ui', 'chat', 'mcp'], true),
  ('action.move.v1', 'low', array['ui', 'chat', 'mcp'], true)
on conflict (operation_id) do update set
  risk_class = excluded.risk_class,
  exposures = excluded.exposures,
  reversible = excluded.reversible,
  updated_at = clock_timestamp();

create or replace function public.execute_plan_edit_operation(
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
  v_target_id uuid;
  v_expected_version bigint;
  v_parent_id uuid;
  v_goal_id uuid;
  v_kind text;
  v_starts_on date;
  v_ends_on date;
  v_scheduled_on date;
  v_horizon_id uuid;
  v_previous_horizon_id uuid;
  v_previous_scheduled_on date;
  v_target_value numeric;
  v_current_value numeric;
  v_result jsonb;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in ('goal.update.v1', 'action.move.v1')
    or p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system')
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_operation_context';
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

  v_target_id := (p_input ->> 'id')::uuid;
  v_expected_version := (p_input ->> 'expectedVersion')::bigint;
  if p_operation_id = 'goal.update.v1' then
    if not (p_input ?& array[
      'id', 'expectedVersion', 'title', 'descriptionMarkdown', 'parentGoalId',
      'targetValue', 'currentValue', 'unit', 'dueOn'
    ]) or char_length(trim(p_input ->> 'title')) not between 3 and 1000
      or char_length(coalesce(p_input ->> 'descriptionMarkdown', '')) > 50000
      or char_length(coalesce(p_input ->> 'unit', '')) > 80 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_parent_id := nullif(p_input ->> 'parentGoalId', '')::uuid;
    v_target_value := nullif(p_input ->> 'targetValue', '')::numeric;
    v_current_value := nullif(p_input ->> 'currentValue', '')::numeric;
    select horizon.kind into v_kind
    from public.goals goal
    join public.planning_horizons horizon
      on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
    where goal.id = v_target_id and goal.workspace_id = v_workspace_id
      and goal.version = v_expected_version
      and goal.archived_at is null and goal.trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if (v_kind = 'year' and v_parent_id is not null)
      or (v_kind = 'quarter' and (
        v_parent_id is null or v_parent_id = v_target_id or not exists (
          select 1 from public.goals parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_parent_id and parent.workspace_id = v_workspace_id
            and horizon.kind = 'year' and parent.archived_at is null and parent.trashed_at is null
        )
      )) or ((v_target_value is null) <> (v_current_value is null))
      or ((v_target_value is null) <> ((p_input ->> 'unit') is null))
      or (v_target_value is not null and char_length(trim(coalesce(p_input ->> 'unit', ''))) not between 1 and 80)
      or v_target_value <= 0 or v_current_value < 0 then
      raise exception using errcode = 'P0001', message = 'invalid_goal_update';
    end if;
    update public.goals set
      title = trim(p_input ->> 'title'),
      description_markdown = nullif(p_input ->> 'descriptionMarkdown', ''),
      parent_goal_id = v_parent_id,
      target_value = v_target_value,
      current_value = v_current_value,
      unit = nullif(trim(p_input ->> 'unit'), ''),
      due_on = nullif(p_input ->> 'dueOn', '')::date,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    returning * into v_row;
  else
    if not (p_input ?& array[
      'id', 'expectedVersion', 'goalId', 'parentActionId', 'horizonKind',
      'startsOn', 'endsOn', 'scheduledOn'
    ]) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_goal_id := (p_input ->> 'goalId')::uuid;
    v_parent_id := nullif(p_input ->> 'parentActionId', '')::uuid;
    v_kind := p_input ->> 'horizonKind';
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    v_scheduled_on := (p_input ->> 'scheduledOn')::date;
    if v_kind not in ('month', 'week') or v_ends_on < v_starts_on
      or v_scheduled_on not between v_starts_on and v_ends_on
      or not exists (
        select 1 from public.goals goal
        join public.planning_horizons horizon
          on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
        where goal.id = v_goal_id and goal.workspace_id = v_workspace_id
          and horizon.kind = 'quarter' and goal.archived_at is null and goal.trashed_at is null
      ) or (v_kind = 'month' and v_parent_id is not null)
      or (v_kind = 'week' and (
        v_parent_id is null or not exists (
          select 1 from public.actions parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_parent_id and parent.workspace_id = v_workspace_id
            and parent.goal_id = v_goal_id and horizon.kind = 'month'
            and parent.archived_at is null and parent.trashed_at is null
        )
      )) then
      raise exception using errcode = 'P0001', message = 'invalid_action_move';
    end if;
    select horizon_id, scheduled_on into v_previous_horizon_id, v_previous_scheduled_on
    from public.actions
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
      and archived_at is null and trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    insert into public.planning_horizons (
      workspace_id, kind, starts_on, ends_on, timezone_snapshot
    ) select v_workspace_id, v_kind, v_starts_on, v_ends_on, timezone
      from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;
    update public.actions set
      goal_id = v_goal_id,
      parent_action_id = v_parent_id,
      horizon_id = v_horizon_id,
      scheduled_on = v_scheduled_on,
      version = version + 1
    where id = v_target_id and workspace_id = v_workspace_id and version = v_expected_version
    returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    insert into public.action_schedule_history (
      workspace_id, action_id, previous_horizon_id, new_horizon_id,
      previous_scheduled_on, new_scheduled_on, reason, actor_user_id
    ) values (
      v_workspace_id, v_target_id, v_previous_horizon_id, v_horizon_id,
      v_previous_scheduled_on, v_scheduled_on, 'rescheduled', v_user_id
    );
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
  end if;
  v_result := to_jsonb(v_row);
  insert into public.operation_receipts (
    workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, 'low',
    case when p_operation_id = 'goal.update.v1' then 'goal' else 'action' end,
    v_target_id, 'succeeded', v_result
  );
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface in ('chat', 'mcp', 'automation') then 'assistant' else 'user' end,
    p_surface, p_operation_id,
    case when p_operation_id = 'goal.update.v1' then 'goal' else 'action' end,
    v_target_id, 'low', case when p_surface = 'ui' then 'explicit_ui_commit' else 'approved' end,
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
  if p_operation_id in ('goal.update.v1', 'action.move.v1') then
    v_result := public.execute_plan_edit_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id like 'account.%' then
    v_result := public.execute_account_operation(
      p_operation_id, p_input, p_idempotency_key, p_surface
    );
  elsif p_operation_id in ('action.update.v1', 'action.status.v1', 'daily-focus.set.v1') then
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

revoke all on function public.execute_plan_edit_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.dispatch_trusted_operation(text, jsonb, text, text)
from public, anon, authenticated, service_role;

commit;
