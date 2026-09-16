-- An initiative is a Goal that is never finished.
--
-- "Real estate agent business" and "Planner AI" are not outcomes. They are
-- standing concerns that recur every week with new work under them, and a Goal
-- is built to be reached: it has due_on and achieved_at, and the Review asks
-- whether it was. Filing a business as a Goal means being asked every quarter
-- whether the business is done.
--
-- One column rather than one table. An initiative inherits the goal hierarchy
-- and its link to Vision, note_goal_links, actions.goal_id, and every planner
-- and Review surface -- each of which only has to learn to filter. A new table
-- would have had to duplicate all of that plus its own RLS policies, trash
-- cascade, undo strategy, export entry and generated types.
--
-- goals.horizon_id is not null and an initiative has no period, so it is
-- anchored to the year. That anchor is bookkeeping: due_on stays null, and
-- nothing may read the anchor as a deadline. If year-anchoring starts producing
-- visible nonsense the escape is a standing horizon kind, not a nullable
-- horizon_id -- every planner query inner-joins that column.

begin;

alter table public.goals
  add column if not exists kind text not null default 'outcome';

alter table public.goals
  drop constraint if exists goals_kind_check;
alter table public.goals
  add constraint goals_kind_check check (kind in ('outcome', 'initiative'));

-- The constraint is the promise. Without it "never finished" is a convention
-- that the first careless update breaks.
alter table public.goals
  drop constraint if exists goals_initiative_has_no_deadline;
alter table public.goals
  add constraint goals_initiative_has_no_deadline check (
    kind <> 'initiative' or due_on is null
  );

create index if not exists goals_kind_idx on public.goals (workspace_id, kind, status);

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
    if (v_kind = 'month' and v_action_parent_id is not null)
      or (v_kind = 'week' and v_action_parent_id is not null and not exists (
          select 1 from public.actions parent
          join public.planning_horizons horizon
            on horizon.id = parent.horizon_id and horizon.workspace_id = parent.workspace_id
          where parent.id = v_action_parent_id and parent.workspace_id = v_workspace_id
            and parent.goal_id is not distinct from v_parent_id and horizon.kind = 'month'
            and parent.archived_at is null and parent.trashed_at is null
        )) then
      raise exception using errcode = 'P0001', message = 'action_parent_not_found';
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
      update public.actions set archived_at = clock_timestamp(), version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id
        and version = v_expected_version and trashed_at is null
      returning * into v_row;
      if not found then
        raise exception using errcode = '40001', message = 'version_conflict_or_not_found';
      end if;
      delete from public.daily_focus_items
      where workspace_id = v_workspace_id and action_id = v_target_id;
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

commit;
