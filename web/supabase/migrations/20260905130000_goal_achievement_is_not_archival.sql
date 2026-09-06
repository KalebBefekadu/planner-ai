-- Achieving a Goal is an outcome. Archiving one is a filing decision. Marking a
-- Goal achieved conflated the two: goal.status.v1 stamped archived_at, and
-- every planner query filters on `archived_at is null`. So completing the Goal
-- you worked all year toward made it disappear -- the hierarchy fell back to
-- "No yearly goals yet. Create first goal", and the Plan overview's "Completed"
-- tile could never leave zero, because the row it counted was no longer read.
--
-- Actions never had this bug: action.status.v1 stamps completed_at and leaves
-- archived_at alone. Goals now do the same through a matching achieved_at.
--
-- Two details worth stating. Status changes no longer clear archived_at, so a
-- Goal that was deliberately archived stays archived when its status moves.
-- And achieved_at is coalesced rather than overwritten, so re-confirming an
-- already-achieved Goal keeps the date it was actually reached.

begin;

alter table public.goals add column if not exists achieved_at timestamptz;

-- Restore the Goals this hid. A Goal was hidden by the bug when it is achieved
-- and archived but was never the target of a successful goal.archive.v1 --
-- that operation is the only deliberate way to archive one, and it never
-- touches status, so the journal separates the two cases exactly rather than
-- by guesswork.
update public.goals as g set
  achieved_at = g.archived_at,
  archived_at = null
where g.status = 'achieved'
  and g.archived_at is not null
  and not exists (
    select 1 from public.operation_receipts r
    where r.workspace_id = g.workspace_id
      and r.operation_id = 'goal.archive.v1'
      and r.target_id = g.id
      and r.status = 'succeeded'
  );

-- Any remaining achieved Goal -- one that was deliberately archived after being
-- reached -- still needs a date, so the invariant asserted at the end of this
-- migration holds for every row rather than only the restored ones.
update public.goals set achieved_at = coalesce(archived_at, updated_at)
where status = 'achieved' and achieved_at is null;

-- Abandoning is also an outcome rather than a filing decision, but an
-- abandoned Goal that vanishes is the behaviour someone may now be relying on
-- to keep their plan clean. Leave those rows as they are and only stop the
-- dispatcher from creating new ones.

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
    v_starts_on := (p_input ->> 'startsOn')::date;
    v_ends_on := (p_input ->> 'endsOn')::date;
    if v_kind not in ('year', 'quarter') or v_ends_on < v_starts_on
      or char_length(p_input ->> 'title') not between 3 and 1000 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;

    select id into v_vision_id from public.visions
    where workspace_id = v_workspace_id and archived_at is null and trashed_at is null;
    if v_vision_id is null then
      raise exception using errcode = 'P0001', message = 'vision_required';
    end if;

    v_parent_id := nullif(p_input ->> 'parentGoalId', '')::uuid;
    if (v_kind = 'year' and v_parent_id is not null)
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
      workspace_id, vision_id, horizon_id, parent_goal_id, title, status, due_on
    ) values (
      v_workspace_id, v_vision_id, v_horizon_id, v_parent_id,
      p_input ->> 'title', 'active', v_ends_on
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
$function$

;

create or replace function public.execute_planning_snapshot_undo(p_operation_id text, p_input jsonb, p_idempotency_key text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_original record;
  v_current record;
  v_target_id uuid;
  v_expected_version bigint;
  v_parent_id uuid;
  v_goal_id uuid;
  v_undo_receipt_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_operation_id <> 'operation.undo.v1'
    or p_surface <> 'ui'
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
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

  select receipt.* into v_original
  from public.operation_receipts receipt
  join public.operation_contracts contract on contract.operation_id = receipt.operation_id
  where receipt.id = (p_input ->> 'receiptId')::uuid
    and receipt.workspace_id = v_workspace_id
    and receipt.status = 'succeeded'
    and receipt.reversed_at is null
    and receipt.created_at >= clock_timestamp() - interval '30 days'
    and receipt.operation_id in (
      'goal.update.v1', 'goal.status.v1',
      'action.update.v1', 'action.move.v1', 'action.status.v1',
      'memory.update.v1'
    )
    and contract.reversible
  for update of receipt;
  if not found then
    raise exception using errcode = 'P0001', message = 'undo_not_available';
  end if;
  if v_original.undo_payload_json is null then
    raise exception using errcode = 'P0001', message = 'undo_not_supported';
  end if;

  v_target_id := v_original.target_id;
  v_expected_version := (v_original.result_json ->> 'version')::bigint;
  v_undo_receipt_id := extensions.gen_random_uuid();

  if v_original.operation_id in ('goal.update.v1', 'goal.status.v1') then
    select * into v_current from public.goals
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then raise exception using errcode = '40001', message = 'undo_conflict'; end if;

    if v_original.operation_id = 'goal.update.v1' then
      v_parent_id := nullif(v_original.undo_payload_json ->> 'parentGoalId', '')::uuid;
      if v_parent_id is not null and not exists (
        select 1 from public.goals where id = v_parent_id and workspace_id = v_workspace_id
          and archived_at is null and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.goals set
        title = v_original.undo_payload_json ->> 'title',
        description_markdown = nullif(v_original.undo_payload_json ->> 'descriptionMarkdown', ''),
        parent_goal_id = v_parent_id,
        target_value = nullif(v_original.undo_payload_json ->> 'targetValue', '')::numeric,
        current_value = nullif(v_original.undo_payload_json ->> 'currentValue', '')::numeric,
        unit = nullif(v_original.undo_payload_json ->> 'unit', ''),
        due_on = nullif(v_original.undo_payload_json ->> 'dueOn', '')::date,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    else
      update public.goals set
        status = v_original.undo_payload_json ->> 'status',
        archived_at = nullif(v_original.undo_payload_json ->> 'archivedAt', '')::timestamptz,
        -- Undoing an achievement has to clear the achievement date too, or the
        -- Goal comes back active while still claiming a day it was reached.
        achieved_at = case
          when (v_original.undo_payload_json ->> 'status') = 'achieved' then coalesce(achieved_at, clock_timestamp())
          else null
        end,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
    end if;

  elsif v_original.operation_id in (
    'action.update.v1', 'action.move.v1', 'action.status.v1'
  ) then
    select * into v_current from public.actions
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then raise exception using errcode = '40001', message = 'undo_conflict'; end if;

    if v_original.operation_id = 'action.update.v1' then
      update public.actions set
        title = v_original.undo_payload_json ->> 'title',
        description_markdown = nullif(v_original.undo_payload_json ->> 'descriptionMarkdown', ''),
        scheduled_on = nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
      if v_current.scheduled_on is distinct from
        nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date then
        insert into public.action_schedule_history (
          workspace_id, action_id, previous_horizon_id, new_horizon_id,
          previous_scheduled_on, new_scheduled_on, reason, actor_user_id
        ) values (
          v_workspace_id, v_target_id, v_current.horizon_id, v_current.horizon_id,
          v_current.scheduled_on,
          nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
          'undo', v_user_id
        );
      end if;
    elsif v_original.operation_id = 'action.move.v1' then
      v_parent_id := nullif(v_original.undo_payload_json ->> 'parentActionId', '')::uuid;
      v_goal_id := nullif(v_original.undo_payload_json ->> 'goalId', '')::uuid;
      if v_goal_id is not null and not exists (
        select 1 from public.goals where id = v_goal_id and workspace_id = v_workspace_id
          and archived_at is null and trashed_at is null
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      if v_parent_id is not null and (
        not exists (
          select 1 from public.actions where id = v_parent_id and workspace_id = v_workspace_id
            and archived_at is null and trashed_at is null
        ) or exists (
          with recursive descendants as (
            select id from public.actions where id = v_target_id and workspace_id = v_workspace_id
            union all
            select action.id from public.actions action
            join descendants d on action.parent_action_id = d.id
            where action.workspace_id = v_workspace_id
          )
          select 1 from descendants where id = v_parent_id
        )
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.actions set
        goal_id = v_goal_id,
        parent_action_id = v_parent_id,
        horizon_id = (v_original.undo_payload_json ->> 'horizonId')::uuid,
        scheduled_on = nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
      insert into public.action_schedule_history (
        workspace_id, action_id, previous_horizon_id, new_horizon_id,
        previous_scheduled_on, new_scheduled_on, reason, actor_user_id
      ) values (
        v_workspace_id, v_target_id, v_current.horizon_id,
        (v_original.undo_payload_json ->> 'horizonId')::uuid,
        v_current.scheduled_on,
        nullif(v_original.undo_payload_json ->> 'scheduledOn', '')::date,
        'undo', v_user_id
      );
    else
      if exists (
        select 1
        from jsonb_to_recordset(v_original.undo_payload_json -> 'focusItems')
          as prior_focus("focusOn" date, "sortOrder" smallint)
        join public.daily_focus_items current_focus
          on current_focus.workspace_id = v_workspace_id
          and current_focus.focus_on = prior_focus."focusOn"
          and current_focus.sort_order = prior_focus."sortOrder"
          and current_focus.action_id <> v_target_id
      ) then
        raise exception using errcode = '40001', message = 'undo_conflict';
      end if;
      update public.actions set
        status = v_original.undo_payload_json ->> 'status',
        completed_at = nullif(v_original.undo_payload_json ->> 'completedAt', '')::timestamptz,
        version = version + 1
      where id = v_target_id and workspace_id = v_workspace_id;
      insert into public.daily_focus_items (workspace_id, focus_on, action_id, sort_order)
      select v_workspace_id, prior_focus."focusOn", v_target_id, prior_focus."sortOrder"
      from jsonb_to_recordset(v_original.undo_payload_json -> 'focusItems')
        as prior_focus("focusOn" date, "sortOrder" smallint)
      on conflict do nothing;
    end if;

  else
    select * into v_current from public.memories
    where id = v_target_id and workspace_id = v_workspace_id
      and version = v_expected_version and trashed_at is null
    for update;
    if not found then raise exception using errcode = '40001', message = 'undo_conflict'; end if;
    update public.memories set
      statement = v_original.undo_payload_json ->> 'statement',
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_target_id and workspace_id = v_workspace_id;
  end if;

  v_result := jsonb_build_object(
    'originalReceiptId', v_original.id,
    'undoReceiptId', v_undo_receipt_id,
    'status', 'undone'
  );
  insert into public.operation_receipts (
    id, workspace_id, operation_id, actor_user_id, actor_type, surface,
    idempotency_key, risk_class, target_type, target_id, status,
    result_json, reverses_receipt_id
  ) values (
    v_undo_receipt_id, v_workspace_id, p_operation_id, v_user_id, 'user', p_surface,
    p_idempotency_key, 'medium', 'operation_receipt', v_original.id, 'succeeded',
    v_result, v_original.id
  );
  update public.operation_receipts set
    reversed_by_receipt_id = v_undo_receipt_id,
    reversed_at = clock_timestamp()
  where id = v_original.id;
  insert into public.activity_events (
    workspace_id, actor_user_id, actor_type, surface, operation_id,
    target_type, target_id, risk_class, approval_state, outcome
  ) values (
    v_workspace_id, v_user_id, 'user', p_surface, p_operation_id,
    'operation_receipt', v_original.id, 'medium', 'explicit_ui_commit', 'succeeded'
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception using errcode = 'P0001', message = 'invalid_undo_input';
end;
$function$

;

-- Both writers of goals.status now agree, so the relationship between the
-- status and its date can be stated as a rule instead of a convention. Only
-- execute_planner_operation and execute_planning_snapshot_undo set this column.
alter table public.goals
  add constraint goals_achieved_at_matches_status
  check ((status = 'achieved') = (achieved_at is not null));

commit;
