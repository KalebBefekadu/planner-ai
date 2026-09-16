-- Three defects found by auditing the nesting work against the rest of the
-- schema, all of them newly reachable because nothing could reparent an Action
-- under another Action before.
--
-- 1. A week with more than a hundred stalled Actions could never be closed.
--    review_week_required_actions returned every Action past three checkpoints
--    with no upper bound, while the operation rejects more than a hundred
--    decisions. 20260915090000 claimed bounding what must be decided bounds the
--    payload with it; that is true relative to "everything eligible" and false
--    in absolute terms, and the deadlock it was written to prevent survived in
--    a narrower form. The required set is now the oldest few, so the ritual
--    costs the same whatever the backlog behind it looks like and the rest are
--    asked about next week.
--
-- 2. action.move.v1 changed the moved Action's Goal and left its descendants on
--    the old one, producing a tree the schema's own rules forbid.
--
-- 3. action.archive.v1 archived one row while the confirmation dialog promised
--    "and any items beneath it" -- vacuously true until subtasks existed.

begin;

-- Deliberately well under the hundred-decision cap, so a person still has room
-- to decide things nobody asked them about.
create or replace function public.review_max_required_actions()
returns integer
language sql
immutable
parallel safe
as $$ select 40 $$;

-- Oldest first, and deterministic: the loader and the operation compute this
-- separately and an exactness check compares them, so any ambiguity in the
-- ordering would surface as a week that refuses to close.
create or replace function public.review_week_required_actions(
  p_workspace_id uuid,
  p_starts_on date,
  p_ends_on date
) returns table (action_id uuid)
language sql
stable
set search_path = pg_catalog, public
as $$
  select eligible.action_id
  from public.review_week_eligible_actions(p_workspace_id, p_starts_on, p_ends_on) eligible
  join public.actions action
    on action.id = eligible.action_id and action.workspace_id = p_workspace_id
  where (
    select count(*)
    from public.reviews review
    where review.workspace_id = p_workspace_id
      and review.kind = 'weekly'
      and review.status = 'completed'
      and review.completed_at > action.created_at
  ) >= public.review_stalled_after_checkpoints()
  order by action.created_at, action.id
  limit public.review_max_required_actions();
$$;

revoke all on function public.review_max_required_actions() from public, anon, authenticated;
revoke all on function public.review_week_required_actions(uuid, date, date)
  from public, anon, authenticated;

create or replace function public.execute_planner_operation(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text DEFAULT 'ui'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_vision_id uuid;
  v_horizon_id uuid;
  v_target_id uuid;
  v_parent_id uuid;
  v_action_parent_id uuid;
  v_expected_version bigint;
  v_result jsonb;
  v_target_type text;
  v_risk_class text := 'low';
  v_kind text;
  v_goal_kind text;
  v_starts_on date;
  v_ends_on date;
  v_row record;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id not in (
    'vision.upsert.v1', 'goal.create.v1', 'goal.status.v1', 'goal.archive.v1',
    'action.create.v1', 'action.status.v1', 'action.archive.v1', 'capture.create.v1'
  ) then
    raise exception using errcode = 'P0001', message = 'operation_not_supported';
  end if;
  if p_surface not in ('ui', 'chat', 'mcp', 'automation', 'system') then
    raise exception using errcode = 'P0001', message = 'invalid_surface';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_idempotency_key';
  end if;

  insert into public.workspaces (owner_user_id)
  values (v_user_id)
  on conflict (owner_user_id) do nothing;

  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || p_operation_id || p_idempotency_key, 0));

  select result_json into v_result
  from public.operation_receipts
  where workspace_id = v_workspace_id
    and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key
    and status = 'succeeded';
  if found then
    return v_result;
  end if;

  if p_operation_id = 'vision.upsert.v1' then
    if jsonb_typeof(p_input -> 'bodyMarkdown') <> 'string'
      or char_length(p_input ->> 'bodyMarkdown') not between 3 and 50000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;

    insert into public.visions (workspace_id, body_markdown)
    values (v_workspace_id, p_input ->> 'bodyMarkdown')
    on conflict (workspace_id) where archived_at is null and trashed_at is null
    do update set
      body_markdown = excluded.body_markdown,
      version = public.visions.version + 1
    returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'vision';
    v_result := to_jsonb(v_row);

  elsif p_operation_id = 'goal.create.v1' then
    v_kind := p_input ->> 'horizonKind';
    v_goal_kind := coalesce(p_input ->> 'kind', 'outcome');
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    if v_kind not in ('year', 'quarter') or v_ends_on < v_starts_on
      or v_goal_kind not in ('outcome', 'initiative')
      or char_length(p_input ->> 'title') not between 3 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    -- An initiative is a standing concern, not a period. It is anchored to the
    -- year because goals.horizon_id is not null and something has to hold it;
    -- that anchor is bookkeeping, and nothing may read it as a deadline.
    if v_goal_kind = 'initiative' and v_kind <> 'year' then
      raise exception using errcode = 'P0001', message = 'initiative_is_not_a_period';
    end if;

    select id into v_vision_id from public.visions
    where workspace_id = v_workspace_id and archived_at is null and trashed_at is null;
    if v_vision_id is null then
      raise exception using errcode = 'P0001', message = 'vision_required';
    end if;

    v_parent_id := nullif(p_input ->> 'parentGoalId', '')::uuid;
    -- A yearly outcome answers to the Vision alone. An initiative may do the
    -- same, or sit under a yearly Goal when the project exists to serve one --
    -- which is the "why am I doing this" chain, on screen.
    if (v_kind = 'year' and v_goal_kind = 'outcome' and v_parent_id is not null)
      or (v_kind = 'quarter' and v_parent_id is null) then
      raise exception using errcode = 'P0001', message = 'invalid_goal_parent';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.goals g
      join public.planning_horizons h on h.id = g.horizon_id and h.workspace_id = g.workspace_id
      where g.id = v_parent_id and g.workspace_id = v_workspace_id
        and g.archived_at is null and g.trashed_at is null and h.kind = 'year'
    ) then
      raise exception using errcode = 'P0001', message = 'goal_parent_not_found';
    end if;

    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select v_workspace_id, v_kind, v_starts_on, v_ends_on, timezone
    from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;

    insert into public.goals (
      workspace_id, vision_id, horizon_id, parent_goal_id, title, status, kind, due_on
    ) values (
      v_workspace_id, v_vision_id, v_horizon_id, v_parent_id,
      p_input ->> 'title', 'active', v_goal_kind,
      -- A period Goal is due when its period ends. An initiative is never due,
      -- which is the point of it: "Real estate agent business" is not a thing
      -- that gets finished, and being asked every quarter whether it is done
      -- is how a container like that ends up filed somewhere useless.
      case when v_goal_kind = 'initiative' then null else v_ends_on end
    ) returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'goal';
    v_result := to_jsonb(v_row);

  elsif p_operation_id = 'action.create.v1' then
    v_kind := p_input ->> 'horizonKind';
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    v_parent_id := nullif(p_input ->> 'goalId', '')::uuid;
    v_action_parent_id := nullif(p_input ->> 'parentActionId', '')::uuid;
    if v_kind not in ('month', 'week') or v_ends_on < v_starts_on
      or char_length(p_input ->> 'title') not between 3 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.goals where id = v_parent_id and workspace_id = v_workspace_id
        and archived_at is null and trashed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'goal_not_found';
    end if;
    -- parent_action_id has always meant "this Action sits under that Action".
    -- The interface spent it on the monthly-to-weekly rollup and then read it
    -- straight back out as the monthly id, which is why a task could never sit
    -- under a task. Both readings are allowed here: a weekly Action may hang
    -- off its monthly parent, or off another weekly Action as a subtask.
    if (v_kind = 'month' and v_action_parent_id is not null)
      or (v_kind = 'week' and v_action_parent_id is not null and not exists (
          select 1 from public.actions parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_action_parent_id and parent.workspace_id = v_workspace_id
            and parent.goal_id is not distinct from v_parent_id
            and horizon.kind in ('month', 'week')
            and parent.archived_at is null and parent.trashed_at is null
        )) then
      raise exception using errcode = 'P0001', message = 'action_parent_not_found';
    end if;
    -- Bounded, because undo and archive cascade through the whole subtree with
    -- recursive CTEs and an unbounded tree makes their cost unpredictable.
    -- Four levels is more than the owner's own export uses.
    if v_action_parent_id is not null
      and public.action_ancestor_depth(v_workspace_id, v_action_parent_id) + 1
          > public.action_max_depth() - 1 then
      raise exception using errcode = 'P0001', message = 'action_nested_too_deep';
    end if;

    insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
    select v_workspace_id, v_kind, v_starts_on, v_ends_on, timezone
    from public.workspaces where id = v_workspace_id
    on conflict (workspace_id, kind, starts_on) do update set ends_on = excluded.ends_on
    returning id into v_horizon_id;

    insert into public.actions (
      workspace_id, goal_id, parent_action_id, horizon_id, title, status, scheduled_on
    ) values (
      v_workspace_id, v_parent_id, v_action_parent_id, v_horizon_id, p_input ->> 'title', 'open',
      coalesce(nullif(p_input ->> 'scheduledOn', '')::date, v_starts_on)
    ) returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'action';
    v_result := to_jsonb(v_row);

  elsif p_operation_id in ('goal.status.v1', 'action.status.v1') then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if p_operation_id = 'goal.status.v1' then
      if (p_input ->> 'status') not in ('draft', 'active', 'paused', 'achieved', 'abandoned') then
        raise exception using errcode = 'P0001', message = 'invalid_input';
      end if;
      update public.goals set
        status = p_input ->> 'status', version = version + 1,
        achieved_at = case
          when (p_input ->> 'status') = 'achieved' then coalesce(achieved_at, clock_timestamp())
          else null
        end
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      v_target_type := 'goal';
    else
      if (p_input ->> 'status') not in ('open', 'in_progress', 'blocked', 'done', 'dropped') then
        raise exception using errcode = 'P0001', message = 'invalid_input';
      end if;
      update public.actions set
        status = p_input ->> 'status', version = version + 1,
        completed_at = case when (p_input ->> 'status') = 'done' then clock_timestamp() else null end
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      v_target_type := 'action';
    end if;
    if not found then
      raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
    end if;
    if p_operation_id = 'action.status.v1' and (p_input ->> 'status') in ('done', 'dropped') then
      delete from public.daily_focus_items
      where workspace_id = v_workspace_id and action_id = v_target_id;
    end if;
    v_result := to_jsonb(v_row);

  elsif p_operation_id in ('goal.archive.v1', 'action.archive.v1') then
    v_target_id := (p_input ->> 'id')::uuid;
    v_expected_version := (p_input ->> 'expectedVersion')::bigint;
    if p_operation_id = 'goal.archive.v1' then
      if not exists (
        select 1 from public.goals where id = v_target_id and workspace_id = v_workspace_id
          and version = v_expected_version and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where workspace_id = v_workspace_id and trashed_at is null
        and goal_id in (
          select id from public.goals where workspace_id = v_workspace_id
            and (id = v_target_id or parent_goal_id = v_target_id)
        );
      delete from public.daily_focus_items focused
      using public.actions action
      where focused.workspace_id = action.workspace_id
        and focused.action_id = action.id
        and focused.workspace_id = v_workspace_id
        and action.archived_at is not null;
      update public.goals set archived_at = clock_timestamp(), version = version + 1
      where workspace_id = v_workspace_id and trashed_at is null
        and (id = v_target_id or parent_goal_id = v_target_id);
      select * into v_row from public.goals where id = v_target_id and workspace_id = v_workspace_id;
      v_target_type := 'goal';
    else
      -- The subtree goes with it. The confirmation dialog has always promised
      -- "and any items beneath it", and while nothing could nest an Action
      -- under an Action that promise was vacuously true. Now it is not:
      -- archiving a parent and leaving its subtasks behind orphans them,
      -- pointing at a parent the planner no longer shows.
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      if not found then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      with recursive descendants as (
        select action.id, 0 as depth
        from public.actions action
        where action.id = v_target_id and action.workspace_id = v_workspace_id
        union all
        select child.id, descendants.depth + 1
        from public.actions child
        join descendants on child.parent_action_id = descendants.id
        where child.workspace_id = v_workspace_id and descendants.depth < 32
      )
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where workspace_id = v_workspace_id and trashed_at is null and archived_at is null
        and id in (select id from descendants) and id <> v_target_id;
      delete from public.daily_focus_items focused
      using public.actions action
      where focused.workspace_id = action.workspace_id
        and focused.action_id = action.id
        and focused.workspace_id = v_workspace_id
        and action.archived_at is not null;
      v_target_type := 'action';
    end if;
    v_result := to_jsonb(v_row);

  elsif p_operation_id = 'capture.create.v1' then
    if jsonb_typeof(p_input -> 'rawText') <> 'string'
      or char_length(trim(p_input ->> 'rawText')) not between 3 and 60000
      or (p_input ->> 'source') not in ('typed', 'voice', 'import') then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    insert into public.captures (workspace_id, raw_text, source)
    values (v_workspace_id, p_input ->> 'rawText', p_input ->> 'source')
    returning * into v_row;
    v_target_id := v_row.id;
    v_target_type := 'capture';
    v_result := to_jsonb(v_row);
  end if;

  insert into public.operation_receipts (
    workspace_id, operation_id, operation_version, actor_user_id, actor_type,
    surface, idempotency_key, risk_class, target_type, target_id, status, result_json
  ) values (
    v_workspace_id, p_operation_id, 1, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_idempotency_key, v_risk_class, v_target_type, v_target_id, 'succeeded', v_result
  );

  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, outcome
  ) values (
    v_workspace_id, v_user_id,
    case when p_surface = 'chat' then 'assistant' else 'user' end,
    p_surface, p_operation_id, v_target_type, v_target_id, v_risk_class, 'succeeded'
  );

  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
end;
$function$;

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
    -- The subtree keeps the Goal its root now has. Both this operation and
    -- action.create.v1 require a child's Goal to match its parent's, so moving
    -- one Action to another Goal and leaving its children on the old one
    -- produces a tree the schema's own rules say cannot exist: the Review would
    -- group parent and child under different initiatives, and archiving the old
    -- Goal would take the children while leaving the parent active.
    with recursive descendants as (
      select action.id, 0 as depth
      from public.actions action
      where action.id = v_target_id and action.workspace_id = v_workspace_id
      union all
      select child.id, descendants.depth + 1
      from public.actions child
      join descendants on child.parent_action_id = descendants.id
      where child.workspace_id = v_workspace_id and descendants.depth < 32
    )
    update public.actions set goal_id = v_goal_id, version = version + 1
    where workspace_id = v_workspace_id and trashed_at is null
      and id in (select id from descendants) and id <> v_target_id
      and goal_id is distinct from v_goal_id;

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
