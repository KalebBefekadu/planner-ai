-- Nesting a task under a task must not require a Goal.
--
-- action.move.v1 has always taken a non-null goalId and checked it against a
-- quarterly Goal, which was fine while the only move it served was the
-- monthly-to-weekly rollup -- that work is filed by definition. Now that the
-- same operation carries indent and outdent, the first thing a person does is
-- capture two Actions from Today, neither of which has a Goal, and try to put
-- one under the other. That failed as a generic "something went wrong".
--
-- goalId becomes nullable and the parent's Goal has to match rather than be
-- equal, so unfiled work nests with unfiled work.
--
-- parentActionId becomes nullable for weekly work in the same breath, and for
-- the same reason. action.create.v1 has always allowed a weekly Action with no
-- parent -- that is what Today produces -- while action.move.v1 demanded one,
-- so an Action could be nested and then never brought back out to the top.
-- Outdent had nowhere to outdent to.
--
-- Both are widenings: every payload that was valid before is still valid and
-- still does the same thing, so the operation keeps its version.

begin;

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
  v_goal_kind text;
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
    select horizon.kind, goal.kind into v_kind, v_goal_kind
    from public.goals goal
    join public.planning_horizons horizon
      on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
    where goal.id = v_target_id and goal.workspace_id = v_workspace_id
      and goal.version = v_expected_version
      and goal.archived_at is null and goal.trashed_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    -- An initiative is year-anchored, but the anchor is bookkeeping rather than
    -- a level: it may sit under a yearly Goal when the project exists to serve
    -- one. goal.create.v1 has allowed that since 20260915100000, and this path
    -- refusing it meant a parent could be set at creation and never edited.
    if (v_kind = 'year' and v_goal_kind = 'outcome' and v_parent_id is not null)
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
    -- Named, rather than letting goals_initiative_has_no_deadline surface as a
    -- generic constraint error. "Never finished" is the whole point of the
    -- kind, so an edit that contradicts it deserves to say which rule it hit.
    if v_goal_kind = 'initiative' and nullif(p_input ->> 'dueOn', '') is not null then
      raise exception using errcode = 'P0001', message = 'initiative_has_no_deadline';
    end if;
    if char_length(coalesce(p_input ->> 'definitionOfDone', '')) > 2000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    update public.goals set
      title = trim(p_input ->> 'title'),
      description_markdown = nullif(p_input ->> 'descriptionMarkdown', ''),
      parent_goal_id = v_parent_id,
      target_value = v_target_value,
      current_value = v_current_value,
      unit = nullif(trim(p_input ->> 'unit'), ''),
      due_on = nullif(p_input ->> 'dueOn', '')::date,
      -- Absent means "not my business", not "clear it". Every existing caller
      -- omits this key, and none of them intends to erase what good looks like.
      definition_of_done = case
        when p_input ? 'definitionOfDone'
          then nullif(trim(coalesce(p_input ->> 'definitionOfDone', '')), '')
        else definition_of_done
      end,
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
    v_goal_id := nullif(p_input ->> 'goalId', '')::uuid;
    v_parent_id := nullif(p_input ->> 'parentActionId', '')::uuid;
    v_kind := p_input ->> 'horizonKind';
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    v_scheduled_on := (p_input ->> 'scheduledOn')::date;
    if v_kind not in ('month', 'week') or v_ends_on < v_starts_on
      or v_scheduled_on not between v_starts_on and v_ends_on
      or (v_goal_id is not null and not exists (
        select 1 from public.goals goal
        join public.planning_horizons horizon
          on horizon.id = goal.horizon_id and horizon.workspace_id = goal.workspace_id
        where goal.id = v_goal_id and goal.workspace_id = v_workspace_id
          and horizon.kind = 'quarter' and goal.archived_at is null and goal.trashed_at is null
      )) or (v_kind = 'month' and v_parent_id is not null)
      or (v_kind = 'week' and v_parent_id is not null and (
        not exists (
          select 1 from public.actions parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_parent_id and parent.workspace_id = v_workspace_id
            and parent.goal_id is not distinct from v_goal_id
            and horizon.kind in ('month', 'week')
            and parent.archived_at is null and parent.trashed_at is null
        )
      )) then
      raise exception using errcode = 'P0001', message = 'invalid_action_move';
    end if;
    -- Notes have guarded against this since 20260816000400; Actions never did,
    -- because until now nothing could reparent one Action under another. An
    -- Action made its own ancestor would make every recursive cascade over
    -- parent_action_id -- archive, trash, undo -- fail to terminate.
    if v_parent_id is not null
      and public.action_has_descendant(v_workspace_id, v_target_id, v_parent_id) then
      raise exception using errcode = 'P0001', message = 'action_cannot_contain_itself';
    end if;
    -- The whole subtree moves, so the bound is on where its deepest leaf lands
    -- rather than on the Action being dragged.
    if v_parent_id is not null
      and public.action_ancestor_depth(v_workspace_id, v_parent_id) + 1
          + public.action_subtree_height(v_workspace_id, v_target_id)
          > public.action_max_depth() - 1 then
      raise exception using errcode = 'P0001', message = 'action_nested_too_deep';
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

commit;
